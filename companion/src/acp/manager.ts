// ACP session manager — Phase B+ live progress (default acp.enabled=false).
// Spawns configured stdio agent; streams progress via onEvent → WS broadcast.

import type { ChildProcessWithoutNullStreams } from "child_process"
import { spawnAcpChild, killAcpChild, closeAcpChild, MODE_C_TEMPFILE_TTL_MS } from "./win-spawn"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { getConfig } from "../config"
import { logger } from "../logger"
import type { AcpSessionRecord, AcpPolicyProfile } from "./types"
import { resolveAcpWorkspaceRoot } from "./workspace-bind"
import { frameAcpHandback } from "./handback"
import { markAcpHandbackSeen } from "./taint"
import { discoverCodingAgents } from "./discover"
import { resolveLaunchArgs, resolveProtocolArgs } from "./launch-presets"
import { extractDiffText, parseUnifiedDiff, applyParsedDiffs, summarizeDiffFiles } from "./diff-apply"
import { shapeHandbackBody } from "./handback-format"
import type { AcpAgentServerConfig } from "./types"
import { tryStartProtocolSession, type ProtocolSessionHandle } from "./protocol-session"
import { timelineItem, capTimeline, type TimelineItem } from "./timeline"
import { formatModeCOpenedLabel, openLocalTerminalForAgent } from "./open-local-terminal"
import {
  PROGRESS_TAIL_CLI_CHARS,
  PROGRESS_TAIL_ACP_CHARS,
  retainTerminalCommandLine,
} from "./progress-caps"
import { buildAcpAgentEnv } from "./agent-env"
import { onPtyAgentSpawned } from "../pty/session"
import { prepareWindowsJob } from "../process/windows-job"
import { captureManualEntryLaunch, prepareManualEntry, type ManualEntryLaunch } from "./manual-entry"
import { boundCodingProgress } from "./ui-progress"

export type AcpHandbackSink = (info: {
  session: AcpSessionRecord
  handback: string
}) => void

export type AcpLiveEvent = {
  type: "acp.session.event"
  session_id: string
  thread_id: string
  agent_id: string
  state: AcpSessionRecord["state"]
  /** Throttled tail of stdout for UI (not full stream). */
  progress_tail?: string
  handback?: string
  error?: string
  partial?: boolean
  goal?: string
  workspace_root?: string
  display_name?: string
  mode?: string
  transport?: "acp" | "cli"
  timeline?: import("./timeline").TimelineItem[]
  pending_diffs?: unknown[]
  /** Mode C propose-time snapshot (UI Stop honesty) */
  open_local_terminal?: boolean
  /** Mode C host terminal outcome (`embed_intent` = recorded, awaiting the user's panel click;
   *  `embed_running` = the embedded agent PTY is live; Stop does not end that process) */
  local_terminal?: "pending" | "opened" | "opened_l0" | "failed" | "skipped" | "embed_intent" | "embed_running"
  terminal_command_line?: string
  terminal_command_expires_at?: number
  output_truncated?: boolean
}

/** Trusted server-only capability; never accepted from a renderer payload or serialized. */
export type NativeLocalContext = {
  current(): boolean
  signal: AbortSignal
  requestPermission(info: { title: string; detail?: string }): Promise<boolean>
}
type NativeBinding = {
  identity: NativeLocalContext
  current: () => boolean
  signal: AbortSignal
  requestPermission: NativeLocalContext["requestPermission"]
  detach?: () => void
}

export type AcpEventListener = (ev: AcpLiveEvent) => void

function newSessionId(): string {
  return `acp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export class AcpManager {
  private sessions = new Map<string, AcpSessionRecord>()
  private manualEntryLaunches = new Map<string, ManualEntryLaunch>()
  private nativeBindings = new WeakMap<AcpSessionRecord, NativeBinding>()

  private nativeCurrent(session: AcpSessionRecord): boolean {
    const binding = this.nativeBindings.get(session)
    if (!binding) return true
    try { return !binding.signal.aborted && binding.current() === true }
    catch { return false }
  }

  private detachNativeAbort(session: AcpSessionRecord): void {
    this.nativeBindings.get(session)?.detach?.()
  }

  private nativeBinding(context: NativeLocalContext): NativeBinding | null {
    try {
      if (!context || typeof context.current !== "function" ||
          typeof context.requestPermission !== "function" || !(context.signal instanceof AbortSignal) ||
          context.signal.aborted || context.current() !== true) return null
      // Snapshot callbacks so later mutation cannot turn a pending permission into another gate.
      return { identity: context, signal: context.signal,
        current: context.current.bind(context), requestPermission: context.requestPermission.bind(context) }
    } catch { return null }
  }
  private processes = new Map<string, ChildProcessWithoutNullStreams>()
  private ownedChildren = new Set<ChildProcessWithoutNullStreams>()
  private startupPreparations = new Map<string, { controller: AbortController; done: Promise<void> }>()
  private trackChild(id: string, child: ChildProcessWithoutNullStreams): void {
    this.processes.set(id, child)
    this.ownedChildren.add(child)
    child.once("close", () => {
      this.ownedChildren.delete(child)
      const session = this.sessions.get(id)
      if (session && session.state === "closed") this.detachNativeAbort(session)
    })
  }
  private protocolHandles = new Map<string, ProtocolSessionHandle>()
  private runningCount = 0
  private shuttingDown = false
  private listeners = new Set<AcpEventListener>()
  private nativeListeners = new WeakMap<NativeLocalContext, Set<AcpEventListener>>()
  private lastProgressAt = new Map<string, number>()
  private handbackSink: AcpHandbackSink | null = null
  private terminalSink:
    | ((info: {
        session: AcpSessionRecord
        kind: "closed" | "cancelled" | "failed"
        code?: number | null
      }) => void)
    | null = null
  private terminalEmitted = new WeakSet<AcpSessionRecord>()
  /** Optional: wire L2 for ACP permission requests */
  permissionGate:
    | ((info: { title: string; detail?: string; sessionId: string }) => Promise<boolean>)
    | null = null
  private unsubscribeEmbedSpawn: () => void

  constructor() {
    // #506 A: the ACP path only RECORDS the embed intent — the PTY layer owns the real spawn, so
    // its event is the only truthful signal that the embedded agent is now running. Until it
    // fires, the session stays in `embed_intent` and the panel copy says "no process yet".
    this.unsubscribeEmbedSpawn = onPtyAgentSpawned(({ threadId }) => {
      if (threadId) this.noteEmbedAgentSpawned(threadId)
    })
  }

  /**
   * #506 A: the embedded agent PTY for `threadId` just went live — every session of that thread
   * still sitting in `embed_intent` leaves it. Closed sessions are left untouched (their banner
   * no longer renders), and a session already past the intent (or never in it) is not ours.
   */
  private noteEmbedAgentSpawned(threadId: string): void {
    for (const session of this.sessions.values()) {
      if (session.thread_id !== threadId) continue
      if (session.local_terminal !== "embed_intent" || session.state === "closed") continue
      session.local_terminal = "embed_running"
      logger.info("acp.mode_c_embed_running", {
        thread_id: threadId,
        session_id: session.session_id,
      })
      this.pushTimeline(session, [
        timelineItem(
          "status",
          "内嵌终端已启动：Agent 正在本插件终端页运行（停止会话不会结束该进程）",
          { status: "done" },
        ),
      ])
    }
  }

  onEvent(fn: AcpEventListener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  /** Private transport subscription; legacy broadcast hooks never receive native progress. */
  onNativeEvent(context: NativeLocalContext, fn: AcpEventListener): () => void {
    let listeners = this.nativeListeners.get(context)
    if (!listeners) { listeners = new Set(); this.nativeListeners.set(context, listeners) }
    listeners.add(fn)
    return () => { listeners.delete(fn) }
  }

  /** Inject completed handback into thread history (wired from server boot). */
  setHandbackSink(fn: AcpHandbackSink | null): void {
    this.handbackSink = fn
  }

  /** Alias / hygiene hook — terminal state only, never handback body. */
  setTerminalSink(
    fn:
      | ((info: {
          session: AcpSessionRecord
          kind: "closed" | "cancelled" | "failed"
          code?: number | null
        }) => void)
      | null,
  ): void {
    this.terminalSink = fn
  }

  private emitTerminal(
    session: AcpSessionRecord,
    kind: "closed" | "cancelled" | "failed",
    code?: number | null,
  ): void {
    if (this.terminalEmitted.has(session)) return
    session.terminal_kind = kind
    this.terminalEmitted.add(session)
    const child = this.processes.get(session.session_id)
    if (!child || child.exitCode != null || child.signalCode != null) this.detachNativeAbort(session)
    if (!this.terminalSink) return
    try {
      this.terminalSink({ session, kind, code })
    } catch (e: any) {
      logger.warn("acp.terminal_sink_error", { err: e?.message || String(e) })
    }
  }

  private emit(ev: AcpLiveEvent): void {
    for (const fn of this.listeners) {
      try {
        fn(ev)
      } catch (e) {
        logger.warn("acp.listener_error", { err: String((e as Error)?.message || e) })
      }
    }
  }

  private emitProgress(session: AcpSessionRecord, tail: string, force = false): void {
    const now = Date.now()
    const last = this.lastProgressAt.get(session.session_id) || 0
    if (!force && now - last < 800) return
    this.lastProgressAt.set(session.session_id, now)
    const display = this.agentDisplayName(session.agent_id)
    // Cap live WS payload: full handback only via acp.handback.message inject.
    // CLI uses PROGRESS_TAIL_CLI_CHARS (12k); UI also shows last 200 lines — see progress-caps.ts.
    const handbackPreview =
      session.state === "closed" && session.handback_text
        ? session.handback_text.slice(0, 8000)
        : undefined
    const tailCap =
      session.transport === "cli" ? PROGRESS_TAIL_CLI_CHARS : PROGRESS_TAIL_ACP_CHARS
    const localTerm =
      session.local_terminal ||
      (session.open_local_terminal_snapshot === true
        ? "pending"
        : session.open_local_terminal_snapshot === false
          ? "skipped"
          : undefined)
    const event = boundCodingProgress({
      type: "acp.session.event",
      session_id: session.session_id,
      thread_id: session.thread_id,
      agent_id: session.agent_id,
      state: session.state,
      progress_tail: tail.slice(-tailCap),
      goal: session.goal?.slice(0, 500),
      workspace_root: session.workspace_root,
      display_name: display,
      partial: session.partial,
      error: session.error,
      handback: handbackPreview,
      output_truncated: session.state === "closed" && (session.handback_text?.length || 0) > 8000 ? true : undefined,
      mode: session.mode,
      transport: session.transport,
      timeline: session.timeline ? session.timeline.slice(-60) : undefined,
      pending_diffs: session.pending_diffs,
      open_local_terminal: session.open_local_terminal_snapshot === true,
      local_terminal: localTerm,
      terminal_command_line: session.terminal_command_line,
      terminal_command_expires_at: session.terminal_command_expires_at,
    })
    if (event) {
      const native = this.nativeBindings.get(session)
      if (!native) this.emit(event)
      else if (this.nativeCurrent(session)) for (const listener of this.nativeListeners.get(native.identity) || []) {
        try { listener(event) } catch { logger.warn("acp.native_listener_failed") }
      }
    }
    else logger.warn("acp.ui_progress_oversized_metadata", { state: session.state })
  }

  private pushTimeline(session: AcpSessionRecord, items: TimelineItem[], progress?: string): void {
    const prev = session.timeline || []
    session.timeline = capTimeline([...prev, ...items])
    if (progress) this.emitProgress(session, progress, true)
    else this.emitProgress(session, items[items.length - 1]?.label || "", true)
  }

  private agentDisplayName(agentId: string): string {
    const s = getConfig().acp?.servers?.[agentId]
    if (s?.display_name) return s.display_name
    const d = discoverCodingAgents().find((a) => a.id === agentId)
    return d?.display_name || agentId
  }

  /**
   * Mode C: best-effort open host Terminal with interactive agent.
   * Fail-soft — never fails the side-panel bridge session.
   */
  private maybeOpenLocalTerminal(
    session: AcpSessionRecord,
    server: AcpAgentServerConfig,
  ): void {
    // TOCTOU: use flag snapshotted at propose/L2 confirm — not live config
    // (post-confirm toggle must not open terminal without L2 lines, nor skip if L2 promised).
    if (session.open_local_terminal_snapshot !== true) {
      session.local_terminal = "skipped"
      return
    }
    const cwd = session.workspace_root
    if (!cwd || !server.command) {
      session.local_terminal = "failed"
      return
    }
    session.local_terminal = "pending"
    session.mode_c_open_cancelled = false
    // Eligibility is computed INSIDE this opt-in branch (never hoisted above the early return).
    // #502 C Option 1: the ACP path may RECORD an embed intent — it must never CREATE anything,
    // and `embed: true` is the only way into the embed branch. A user who merely enabled the
    // embedded terminal is NOT had their outer terminal cancelled: without eligibility this call
    // behaves exactly as it did before.
    const embedEligible =
      getConfig().embedded_terminal?.enabled === true &&
      // #584: win32 放行——与 pty/session、pty/handler、open-local-terminal 的
      // 平台闸同口径。这里是 embed:true 的唯一生产者；不放行则下游三闸全是死代码。
      (process.platform === "darwin" || process.platform === "win32")
    this.emitProgress(
      session,
      embedEligible ? "Mode C: recording embedded terminal intent…" : "Mode C: opening host terminal…",
      true,
    )
    // Full browser task → interactive agent (not banner-only). Same intent as bridge prompt.
    const modeCPrompt = this.buildUserPrompt(session)
    const terminalApp =
      getConfig().coding_handoff?.local_terminal_app || "auto"
    // Conservative deadline: existing temporary-file cleanup is scheduled only after the opener
    // settles. Starting the UI deadline earlier never extends secret-bearing file retention.
    const commandDeadline = Date.now() + MODE_C_TEMPFILE_TTL_MS
    void openLocalTerminalForAgent({
      command: server.command,
      cwd,
      threadId: session.thread_id,
      agentId: session.agent_id,
      goalHint: session.goal,
      agentLabel: server.display_name || session.agent_id,
      prompt: modeCPrompt,
      terminalApp,
      ...(embedEligible ? { embed: true } : {}),
    }).then((r) => {
      // Stop/cancel raced the open — do not mutate a closed session as success.
      if (session.mode_c_open_cancelled || session.state === "closed") {
        if (session.local_terminal === "pending") session.local_terminal = "skipped"
        return
      }
      if (r.ok) {
        if (r.embedIntent) {
          // Intent recorded — nothing was opened. Never claim the terminal opened.
          session.local_terminal = "embed_intent"
          logger.info("acp.mode_c_embed_intent", {
            thread_id: session.thread_id,
            agent_file_basename: path.basename(r.embedIntent.file),
            argv_argc: r.embedIntent.argc,
            cwd: r.embedIntent.cwd,
          })
          this.pushTimeline(session, [
            timelineItem(
              "status",
              "内嵌终端待启动：请点击面板「在本插件打开终端」按钮（ACP 启动不会自动弹出终端）",
              { status: "pending", detail: r.detail },
            ),
          ])
          return
        }
        session.terminal_command_line = retainTerminalCommandLine(r.commandLine)
        session.terminal_command_expires_at = session.terminal_command_line ? commandDeadline : undefined
        session.local_terminal = r.level === "L0" ? "opened_l0" : "opened"
        const label = formatModeCOpenedLabel(r.level, r.app, terminalApp)
        this.pushTimeline(session, [
          timelineItem("status", label, {
            status: "done",
            detail: r.detail,
          }),
        ])
      } else {
        session.terminal_command_line = retainTerminalCommandLine(r.commandLine)
        session.terminal_command_expires_at = session.terminal_command_line ? commandDeadline : undefined
        session.local_terminal = "failed"
        this.pushTimeline(session, [
          timelineItem("status", `本机终端未打开[${terminalApp}]: ${r.detail}`, {
            status: "error",
            detail: r.commandLine
              ? `可手动粘贴: ${r.commandLine.slice(0, 400)}`
              : undefined,
          }),
        ])
      }
    })
  }

  /**
   * Resolve configured server or discovered PATH probe as ephemeral server.
   * Does not persist discovery into config.json.
   */
  resolveServer(agentId: string): AcpAgentServerConfig | null {
    const cfg = getConfig()
    const configured = cfg.acp?.servers?.[agentId]
    if (configured?.enabled && configured.command) return configured
    const disc = discoverCodingAgents().find((a) => a.id === agentId)
    if (!disc) return null
    return {
      enabled: true,
      display_name: disc.display_name,
      transport: "stdio",
      command: disc.command,
      args: [],
      policy: {
        profile: "review_readonly",
        allow_write: false,
        allow_exec: false,
        session_timeout_ms: 15 * 60_000,
        max_handback_chars: 48_000,
      },
    }
  }

  /**
   * List configured + PATH-discovered agents for UI/settings.
   * Independent of master `acp.enabled` — discovery must still work so users
   * can see "found Claude/Pi, enable ACP to use" instead of a false empty.
   * Spawn/propose remain gated by `acp.enabled`.
   */
  listAgents(opts: { redactPaths?: boolean } = {}): Array<{
    id: string
    display_name: string
    enabled: boolean
    profile: string
    command: string
    source?: "config" | "discovered"
  }> {
    const redact = opts.redactPaths !== false
    const redactCmd = (cmd: string) => {
      if (!redact) return cmd
      // UI only needs basename; full path stays server-side for spawn
      try {
        const base = cmd.split(/[/\\]/).filter(Boolean).pop() || cmd
        return base
      } catch {
        return "(set)"
      }
    }
    const cfg = getConfig()
    const acp = cfg.acp
    const out: Array<{
      id: string
      display_name: string
      enabled: boolean
      profile: string
      command: string
      source?: "config" | "discovered"
    }> = []
    const seen = new Set<string>()
    const seenCmd = new Set<string>()
    for (const [id, s] of Object.entries(acp?.servers || {})) {
      if (!s.command) continue
      seen.add(id)
      seenCmd.add(s.command)
      out.push({
        id,
        display_name: s.display_name,
        enabled: s.enabled !== false && !!s.command,
        profile: s.policy?.profile || "review_readonly",
        command: redactCmd(s.command),
        source: "config",
      })
    }
    for (const d of discoverCodingAgents()) {
      if (seen.has(d.id)) continue
      if (seenCmd.has(d.command)) continue
      seenCmd.add(d.command)
      out.push({
        id: d.id,
        display_name: d.display_name,
        enabled: true,
        profile: "review_readonly",
        command: redactCmd(d.command),
        source: "discovered",
      })
    }
    return out
  }

  getSession(sessionId: string): AcpSessionRecord | undefined {
    const session = this.sessions.get(sessionId)
    return session && !this.nativeBindings.has(session) ? session : undefined
  }

  getNativeSession(sessionId: string, context: NativeLocalContext): AcpSessionRecord | undefined {
    const session = this.sessions.get(sessionId)
    return session && this.nativeBindings.get(session)?.identity === context ? session : undefined
  }

  listSessionsForThread(threadId: string): AcpSessionRecord[] {
    return [...this.sessions.values()].filter((s) => s.thread_id === threadId && !this.nativeBindings.has(s))
  }

  /** Read-only metadata admission; closed UI state does not prove the owned child finished. */
  hasProjectThreadActivity(threadId: string): boolean {
    return [...this.sessions.values()].filter(session => session.thread_id === threadId).some(session => {
      const child = this.processes.get(session.session_id)
      return ["offered", "confirmed", "running"].includes(session.state) || this.startupPreparations.has(session.session_id) ||
        !!child && child.exitCode === null && child.signalCode === null
    })
  }

  propose(opts: {
    threadId: string
    agentId: string
    goal: string
    workspaceRoot?: string | null
    mode?: "review_readonly" | "propose_diff"
    parentSessionId?: string
  }): { ok: true; session: AcpSessionRecord } | { ok: false; error: string } {
    return this.proposeOwned(opts)
  }

  proposeNative(opts: Parameters<AcpManager["propose"]>[0], context: NativeLocalContext): ReturnType<AcpManager["propose"]> {
    const binding = this.nativeBinding(context)
    if (this.shuttingDown) return { ok: false, error: "acp: manager shutting down" }
    if (!binding || typeof opts.workspaceRoot !== "string" || !opts.workspaceRoot.trim())
      return { ok: false, error: "ACP_NATIVE_CONTEXT_STALE" }
    if (typeof opts.goal !== "string" || !opts.goal.trim() || opts.goal.length > 8000)
      return { ok: false, error: "ACP_NATIVE_GOAL_LIMIT" }
    return this.proposeOwned(opts, binding)
  }

  private proposeOwned(opts: {
    threadId: string
    agentId: string
    goal: string
    workspaceRoot?: string | null
    mode?: "review_readonly" | "propose_diff"
    parentSessionId?: string
  }, native?: NativeBinding): { ok: true; session: AcpSessionRecord } | { ok: false; error: string } {
    const cfg = getConfig()
    if (!cfg.acp?.enabled) {
      return { ok: false, error: "acp: feature disabled (config.acp.enabled=false)" }
    }
    const server = this.resolveServer(opts.agentId)
    if (!server || !server.enabled || !server.command) {
      return { ok: false, error: `acp: unknown or disabled agent "${opts.agentId}"` }
    }
    if (this.runningCount >= 1) {
      return { ok: false, error: "ACP_SESSION_BUSY: only one ACP session at a time" }
    }
    for (const s of this.sessions.values()) {
      if (s.thread_id === opts.threadId && (s.state === "running" || s.state === "offered")) {
        return { ok: false, error: "ACP_SESSION_BUSY: thread already has an ACP session" }
      }
    }
    const ws = resolveAcpWorkspaceRoot(opts.workspaceRoot)
    if (!ws.ok) return { ok: false, error: ws.error }

    if (server.policy.profile !== "review_readonly") {
      logger.info("acp.profile_demoted", {
        agent: opts.agentId,
        from: server.policy.profile,
        to: "review_readonly",
      })
    }
    const mode =
      opts.mode === "propose_diff" ? "propose_diff" : "review_readonly"
    const profile: AcpPolicyProfile =
      mode === "propose_diff" ? "propose_diff" : "review_readonly"

    // Snapshot Mode C flag at propose (L2 confirm copy + maybeOpenLocalTerminal both use this).
    const openLocalTerminalSnap =
      !native && getConfig().coding_handoff?.open_local_terminal === true
    const session: AcpSessionRecord = {
      session_id: newSessionId(),
      thread_id: opts.threadId,
      agent_id: opts.agentId,
      state: "offered",
      workspace_root: ws.root,
      profile,
      mode,
      goal: String(opts.goal || "").slice(0, 8000),
      created_at: new Date().toISOString(),
      partial: false,
      parent_session_id: opts.parentSessionId,
      open_local_terminal_snapshot: openLocalTerminalSnap,
    }
    if (native) {
      this.nativeBindings.set(session, native)
      if (!this.nativeCurrent(session)) return { ok: false, error: "ACP_NATIVE_CONTEXT_STALE" }
    }
    this.sessions.set(session.session_id, session)
    if (native) {
      const abort = () => { this.cancelOwned(session.session_id) }
      native.signal.addEventListener("abort", abort, { once: true })
      native.detach = () => { native.signal.removeEventListener("abort", abort); native.detach = undefined }
      if (native.signal.aborted) { abort(); return { ok: false, error: "ACP_NATIVE_CONTEXT_STALE" } }
    }
    logger.info("acp.offer", { session_id: session.session_id, agent: opts.agentId })
    this.emitProgress(session, "offered — waiting to start", true)
    return { ok: true, session }
  }

  private buildUserPrompt(session: AcpSessionRecord): string {
    const page = session.page_context ? `\nBrowser context:\n${session.page_context}\n` : ""
    if (session.mode === "propose_diff") {
      return [
        "You are running under CMspark 编程接力 (propose-diff mode).",
        "Do NOT run package installs, git push, or network exfil.",
        "You MAY reason about edits; output a unified diff the host can apply.",
        `Workspace: ${session.workspace_root}`,
        page,
        "Task:",
        session.goal,
        "",
        "Output requirements:",
        "1) Short summary of changes",
        "2) One fenced block: ```diff ... ``` with unified diffs (paths relative to workspace)",
      ].join("\n")
    }
    return [
      "You are running under CMspark 编程接力 (review mode).",
      "Do NOT modify files, run package installs, or git push.",
      `Workspace: ${session.workspace_root}`,
      page,
      "Task:",
      session.goal,
      "",
      "Return a structured code review: findings (severity), files of interest, residual risks.",
    ].join("\n")
  }

  private finishSession(
    session: AcpSessionRecord,
    body: string,
    maxOut: number,
    code: number | null,
  ): void {
    if (this.nativeBindings.has(session) && (!this.nativeCurrent(session) || session.mode_c_open_cancelled)) {
      // A retired document must not commit a late successful handback.
      this.cancelOwned(session.session_id)
      return
    }
    session.agent_text = body
    // Parse diffs first so 路径 section can list files (empty → still template headers).
    let pathList: string[] = []
    if (session.mode === "propose_diff") {
      const diffText = extractDiffText(body)
      if (diffText) {
        const parsed = parseUnifiedDiff(diffText)
        session.pending_diffs = parsed.map((p) => ({
          relPath: p.relPath,
          isNew: p.isNew,
          isDelete: p.isDelete,
          newContent: p.newContent,
          hunk: p.hunk,
          hunks: p.hunks,
          // Must match lifecycle handback mapping so closed session.event
          // does not clobber hasPendingDiff in the extension reducer.
          applyable:
            !p.isDelete &&
            ((p.isNew && p.newContent != null) ||
              (Array.isArray(p.hunks) && p.hunks.length > 0) ||
              p.newContent != null),
        }))
        session.diff_summary = summarizeDiffFiles(parsed)
        pathList = parsed.map((p) => p.relPath).filter(Boolean)
        this.pushTimeline(session, [
          timelineItem("diff", session.diff_summary || "diff ready", { status: "done" }),
        ])
      }
    }
    // Structured handback body: ### 路径 / ### 摘要 / ### 建议验收 (no LLM).
    const shaped = shapeHandbackBody({ body, paths: pathList })
    session.handback_text = frameAcpHandback({
      agentId: session.agent_id,
      sessionId: session.session_id,
      profile: session.profile,
      partial: session.partial || (code !== 0 && code != null),
      body: shaped,
      maxChars: maxOut,
    })
    session.state = "closed"
    session.terminal_kind ??= code !== 0 && code != null ? "failed" : "closed"
    markAcpHandbackSeen(session.thread_id)
    if (session.handback_text && this.handbackSink) {
      try {
        this.handbackSink({ session, handback: session.handback_text })
      } catch (e: any) {
        logger.warn("acp.handback_sink_error", { err: e?.message || String(e) })
      }
    }
    this.pushTimeline(session, [timelineItem("status", "session closed", { status: "done" })])
    this.emitProgress(session, body.slice(-400), true)
    this.emitTerminal(
      session,
      code !== 0 && code != null ? "failed" : "closed",
      code,
    )
  }

  async start(sessionId: string): Promise<
    | { ok: true; session: AcpSessionRecord }
    | { ok: false; error: string }
  > {
    if (this.shuttingDown) return { ok: false, error: "acp: manager shutting down" }
    const session = this.sessions.get(sessionId)
    if (!session) return { ok: false, error: "acp: unknown session" }
    if (session.state !== "offered" && session.state !== "confirmed") {
      return { ok: false, error: `acp: cannot start from state ${session.state}` }
    }
    if (!this.nativeCurrent(session)) {
      this.cancelOwned(sessionId)
      return { ok: false, error: "ACP_NATIVE_CONTEXT_STALE" }
    }
    // A legacy offer can predate a native start too: the live slot is global.
    if (this.runningCount >= 1) {
      if (this.nativeBindings.has(session)) this.cancelOwned(sessionId)
      return { ok: false, error: "ACP_SESSION_BUSY: only one ACP session at a time" }
    }
    const cfg = getConfig()
    if (!cfg.acp?.enabled) return { ok: false, error: "acp: feature disabled" }
    const server = this.resolveServer(session.agent_id)
    if (!server?.command) return { ok: false, error: "acp: agent config missing" }

    this.runningCount++
    session.state = "running"
    session.timeline = []
    this.pushTimeline(session, [timelineItem("status", "starting…", { status: "running" })])

    const prompt = this.buildUserPrompt(session)
    const protocolMode = server.protocol || "auto"
    // Terminal parity: full process + login-shell + user-env + server.env
    // (NOT the old PATH/HOME/LANG whitelist that stripped API keys).
    const env = buildAcpAgentEnv({
      sessionId: session.session_id,
      mode: session.mode || "review_readonly",
      serverEnv: server.env,
    })

    // Event observers may synchronously shut down/cancel during starting….
    if (this.shuttingDown || session.mode_c_open_cancelled || !this.nativeCurrent(session)) {
      this.runningCount = Math.max(0, this.runningCount - 1)
      session.state = "closed"
      if (this.nativeBindings.has(session) && !this.terminalEmitted.has(session)) this.cancelOwned(sessionId)
      return { ok: false, error: "acp: cancelled during startup" }
    }
    if (process.platform === "win32") {
      const controller = new AbortController()
      const timer = setTimeout(() => {
        session.partial = true
        controller.abort()
      }, server.policy.session_timeout_ms ?? 15 * 60_000)
      const done = prepareWindowsJob(controller.signal)
      this.startupPreparations.set(sessionId, { controller, done })
      try { await done }
      catch (e: any) {
        this.runningCount = Math.max(0, this.runningCount - 1)
        session.state = "closed"
        const error = session.mode_c_open_cancelled ? "acp: cancelled during startup" : e?.message || String(e)
        session.error = session.error || error
        this.emitTerminal(session, session.mode_c_open_cancelled ? "cancelled" : "failed")
        return { ok: false, error }
      } finally {
        clearTimeout(timer)
        this.startupPreparations.delete(sessionId)
      }
      if (this.shuttingDown || session.mode_c_open_cancelled || !this.nativeCurrent(session)) {
        this.runningCount = Math.max(0, this.runningCount - 1)
        session.state = "closed"
        if (this.nativeBindings.has(session) && !this.terminalEmitted.has(session)) this.cancelOwned(sessionId)
        return { ok: false, error: "acp: cancelled during startup" }
      }
    }
    // --- S1: try real ACP JSON-RPC Client ---
    if (protocolMode === "auto" || protocolMode === "acp") {
      let probeChild: ChildProcessWithoutNullStreams | undefined
      let handle: ProtocolSessionHandle | null
      try { handle = await tryStartProtocolSession({
        command: server.command,
        args: resolveProtocolArgs(session.agent_id, server.args),
        cwd: session.workspace_root,
        env,
        session,
        promptTimeoutMs: server.policy.session_timeout_ms,
        hooks: {
          onSpawn: (child) => {
            probeChild = child; this.trackChild(sessionId, child)
            if (!this.nativeCurrent(session)) this.cancelOwned(sessionId)
          },
          onAgentText: (text) => {
            const next = (session.agent_output_text || "") + text
            if (Buffer.byteLength(next) > 256 * 1024) {
              session.partial = true
              this.cancelOwned(sessionId)
            } else {
              session.agent_output_text = next
              session.agent_text = next
            }
          },
          onTimeline: (items, progress) => {
            // The protocol owns the cumulative timeline. Appending it repeats
            // earlier chunks and contaminates handback with status.
            session.timeline = items
            this.emitProgress(session, progress || "", false)
          },
          onAgentSessionId: (id) => {
            session.agent_session_id = id
          },
          onPermission: async ({ title, detail }) => {
            const native = this.nativeBindings.get(session)
            if (native) {
              if (!this.nativeCurrent(session) || session.mode_c_open_cancelled) return "deny"
              try {
                const ok = await native.requestPermission({ title, detail })
                return ok === true && this.nativeCurrent(session) && !session.mode_c_open_cancelled ? "allow" : "deny"
              } catch { return "deny" }
            }
            if (!this.permissionGate) return "deny"
            const ok = await this.permissionGate({
              title,
              detail,
              sessionId: session.session_id,
            })
            return ok ? "allow" : "deny"
          },
        },
      }) } catch (e: any) {
        // A failed teardown must not start the CLI fallback or release a live
        // probe's slot. Settle the public request and release only on close.
        let released = false
        const release = () => {
          if (released) return
          released = true
          this.runningCount = Math.max(0, this.runningCount - 1)
          if (this.processes.get(sessionId) === probeChild) this.processes.delete(sessionId)
        }
        if (!probeChild?.pid || probeChild.exitCode != null || probeChild.signalCode != null) release()
        else probeChild.once("close", release)
        const error = e?.message || String(e)
        session.state = "closed"; session.error = error
        this.emitTerminal(session, "failed")
        return { ok: false, error }
      }
      let released = false
      const releaseProtocolSlot = () => {
        if (released) return
        released = true
        this.runningCount = Math.max(0, this.runningCount - 1)
        if (this.protocolHandles.get(sessionId) === handle) this.protocolHandles.delete(sessionId)
        if (!handle || this.processes.get(sessionId) === handle.child) this.processes.delete(sessionId)
      }
      handle?.child.once("close", releaseProtocolSlot)
      if (session.mode_c_open_cancelled || !this.nativeCurrent(session)) {
        if (handle) {
          handle.kill()
          try { await closeAcpChild(handle.child) }
          catch (e: any) { return { ok: false, error: e?.message || String(e) } }
        }
        releaseProtocolSlot()
        if (this.nativeBindings.has(session)) this.cancelOwned(sessionId)
        return { ok: false, error: "acp: cancelled during startup" }
      }
      if (handle) {
        session.transport = "acp"
        session.pid = handle.child.pid
        this.protocolHandles.set(sessionId, handle)
        this.pushTimeline(session, [
          timelineItem("status", "ACP Client connected", { status: "done" }),
        ])
        this.maybeOpenLocalTerminal(session, server)
        const stopProtocolChild = async () => {
          handle.kill()
          await closeAcpChild(handle.child)
          releaseProtocolSlot()
        }
        try {
          await handle.prompt(prompt)
          const body = session.agent_output_text || ""
          if (!body.trim()) session.partial = true
          // A completed ACP turn need not exit the server process. Reclaim it
          // before dropping its handles so successful sessions do not leak children.
          await stopProtocolChild()
          if (this.nativeBindings.has(session) && (!this.nativeCurrent(session) || session.mode_c_open_cancelled)) {
            this.cancelOwned(sessionId)
            return { ok: false, error: "ACP_NATIVE_CONTEXT_STALE" }
          }
          this.finishSession(session, body, server.policy.max_handback_chars ?? 48_000, 0)
          return { ok: true, session }
        } catch (e: any) {
          let errMsg = e?.message || String(e)
          try { await stopProtocolChild() }
          catch (teardown: any) { errMsg += `; ${teardown?.message || String(teardown)}` }
          session.state = "closed"
          session.error = errMsg
          this.pushTimeline(session, [
            timelineItem("error", errMsg, { status: "error" }),
          ])
          this.emitTerminal(session, "failed")
          return { ok: false, error: errMsg }
        }
      }
      this.processes.delete(sessionId)
      if (protocolMode === "acp") {
        this.runningCount = Math.max(0, this.runningCount - 1)
        session.state = "closed"
        const errMsg = "agent does not speak ACP JSON-RPC"
        session.error = errMsg
        this.emitTerminal(session, "failed")
        return { ok: false, error: errMsg }
      }
      this.pushTimeline(session, [
        timelineItem("status", "ACP handshake failed — CLI bridge", { status: "done" }),
      ])
    }

    // --- CLI bridge (legacy / fallback) ---
    return this.startCliBridge(session, server, prompt)
  }

  private async startCliBridge(
    session: AcpSessionRecord,
    server: AcpAgentServerConfig,
    prompt: string,
  ): Promise<{ ok: true; session: AcpSessionRecord } | { ok: false; error: string }> {
    if (this.nativeBindings.has(session) && (!this.nativeCurrent(session) || session.mode_c_open_cancelled)) {
      this.runningCount = Math.max(0, this.runningCount - 1)
      this.cancelOwned(session.session_id)
      return { ok: false, error: "ACP_NATIVE_CONTEXT_STALE" }
    }
    session.transport = "cli"
    const sessionId = session.session_id
    const promptPath = path.join(os.tmpdir(), `cmspark-acp-${session.session_id}.md`)
    try {
      fs.writeFileSync(promptPath, prompt, { encoding: "utf8", mode: 0o600, flag: "wx" })
    } catch (e: any) {
      this.runningCount = Math.max(0, this.runningCount - 1)
      session.state = "closed"
      session.error = `cannot write prompt file: ${e?.message || e}`
      this.emitProgress(session, session.error, true)
      this.emitTerminal(session, "failed")
      return { ok: false, error: session.error }
    }

    const args = resolveLaunchArgs(session.agent_id, server.args, {
      prompt,
      promptFile: promptPath,
    })

    return await new Promise((resolve) => {
      let stdout = ""
      let stderr = ""
      const maxOut = server.policy.max_handback_chars ?? 48_000
      const timeoutMs = server.policy.session_timeout_ms ?? 15 * 60_000
      const lineBuffers = { stdout: "", stderr: "" }
      const removePrompt = () => {
        try { fs.unlinkSync(promptPath) } catch { /* best-effort */ }
      }

      let child: ChildProcessWithoutNullStreams
      try {
        child = spawnAcpChild(server.command, args, {
          cwd: session.workspace_root,
          env: buildAcpAgentEnv({
            sessionId: session.session_id,
            mode: session.mode || "review_readonly",
            serverEnv: server.env,
          }),
          stdio: ["pipe", "pipe", "pipe"],
        }) as ChildProcessWithoutNullStreams
      } catch (e: any) {
        removePrompt()
        this.runningCount = Math.max(0, this.runningCount - 1)
        session.state = "closed"
        const errMsg = e?.message || String(e)
        session.error = errMsg
        this.emitProgress(session, errMsg, true)
        this.emitTerminal(session, "failed")
        resolve({ ok: false, error: errMsg })
        return
      }

      const launchInput = { agentId: session.agent_id, command: server.command,
        cwd: session.workspace_root, args: server.args ? [...server.args] : undefined }
      child.once("spawn", () => {
        // A successful real CLI spawn is the sole provenance for this UI-only private descriptor.
        if (!this.shuttingDown && !this.nativeBindings.has(session))
          this.manualEntryLaunches.set(sessionId, captureManualEntryLaunch(launchInput))
      })
      session.pid = child.pid
      this.trackChild(sessionId, child)
      this.pushTimeline(session, [
        timelineItem("status", `CLI pid ${child.pid}`, { status: "running" }),
      ])
      this.maybeOpenLocalTerminal(session, server)

      let completed = false
      let released = false
      let escalation: ReturnType<typeof setTimeout> | undefined
      const releaseSlot = () => {
        if (released) return
        released = true
        this.runningCount = Math.max(0, this.runningCount - 1)
        if (this.processes.get(sessionId) === child) this.processes.delete(sessionId)
      }
      const stopChild = () => {
        try { killAcpChild(child, "SIGTERM") } catch { /* best-effort */ }
        // kill may synchronously emit error and reenter this cleanup. Clear
        // any prior or nested timer before registering the sole escalation.
        if (escalation) clearTimeout(escalation)
        if (!released) escalation = setTimeout(() => {
          try { killAcpChild(child, "SIGKILL") } catch { /* best-effort */ }
        }, 2000)
      }
      const timer = setTimeout(() => {
        session.partial = true
        this.emitProgress(session, "timeout — stopping…", true)
        stopChild()
      }, timeoutMs)
      const fail = (err: Error) => {
        if (completed) return
        completed = true
        clearTimeout(timer)
        // A failed spawn owns no process. Stream errors in a live child settle
        // immediately, but retain its slot until close confirms termination.
        if (!child.pid || child.exitCode != null || child.signalCode != null) releaseSlot()
        const msg = err?.message || String(err)
        session.state = "closed"
        session.error = msg
        removePrompt()
        logger.warn("acp.cli_error", { session_id: sessionId, err: msg })
        this.emitProgress(session, msg, true)
        this.emitTerminal(session, "failed")
        stopChild()
        resolve({ ok: false, error: msg })
      }
      // ChildProcess 'error' does not cover its stdio streams. Keep listeners
      // through close so late async pipe errors are consumed as well.
      child.on("error", fail)
      child.stdin.on("error", fail)
      child.stdout.on("error", fail)
      child.stderr.on("error", fail)

      const onChunk = (buf: Buffer, isErr: boolean) => {
        if (completed) return
        const s = buf.toString("utf8")
        if (isErr) {
          stderr += s
          if (stderr.length > 16_000) stderr = stderr.slice(-16_000)
        } else {
          stdout += s
          if (stdout.length > maxOut * 2) stdout = stdout.slice(-maxOut)
          // Keep agent_text for handback + UI even when lines are long without \n
          session.agent_text = (session.agent_text || "") + s
          if ((session.agent_text || "").length > maxOut * 2) {
            session.agent_text = session.agent_text!.slice(-maxOut)
          }
        }
        const stream = isErr ? "stderr" : "stdout"
        const parts = (lineBuffers[stream] + s).split("\n")
        // Retain only the largest detail we expose, even without a newline.
        lineBuffers[stream] = (parts.pop() || "").slice(-4000)
        for (const line of parts) {
          const t = line.trim()
          // Lower threshold: short progress lines still matter in the steps list
          if (t.length > 0) {
            this.pushTimeline(session, [
              timelineItem(isErr ? "status" : "agent_message", t.slice(0, 240), {
                detail: t.slice(0, 4000),
                status: "running",
              }),
            ])
          }
        }
        // Always push live stream to progress_tail (UI primary log), not only on newlines
        this.emitProgress(session, isErr ? stderr : stdout, true)
      }

      child.stdout.on("data", (buf: Buffer) => onChunk(buf, false))
      child.stderr.on("data", (buf: Buffer) => onChunk(buf, true))

      child.on("close", (code) => {
        clearTimeout(timer)
        if (escalation) clearTimeout(escalation)
        releaseSlot()
        if (completed) return
        completed = true
        if (this.nativeBindings.has(session) && (!this.nativeCurrent(session) || session.mode_c_open_cancelled)) {
          removePrompt(); this.cancelOwned(sessionId)
          resolve({ ok: false, error: "ACP_NATIVE_CONTEXT_STALE" }); return
        }
        const body =
          stdout.trim() ||
          stderr.trim() ||
          `(agent exited code=${code} with no output)`
        removePrompt()
        this.finishSession(session, body, maxOut, code)
        logger.info("acp.session_ended", {
          session_id: sessionId,
          code,
          transport: "cli",
          handback_len: session.handback_text?.length,
        })
        resolve({ ok: true, session })
      })
      // Register lifecycle handlers before the first write (including streams
      // whose _write callback reports errors asynchronously).
      try {
        if (!this.nativeCurrent(session)) { this.cancelOwned(sessionId); return }
        child.stdin.write(prompt)
        child.stdin.end()
      } catch (err) { fail(err instanceof Error ? err : new Error(String(err))) }
    })
  }

  /** Private launch data is never projected by getStatus/events/handback or model tools. */
  prepareManualEntry(sessionId: string): ReturnType<typeof prepareManualEntry> {
    if (this.shuttingDown) return { ok: false, error: "acp: manager shutting down" }
    const session = this.sessions.get(sessionId)
    if (!session || session.transport !== "cli") return { ok: false, error: "此会话没有已验证的 CLI 启动记录。" }
    return prepareManualEntry(this.manualEntryLaunches.get(sessionId))
  }

  /**
   * S2: multi-turn prompt into live ACP session (same process).
   * CLI transport: queues as followup propose (new process) for UX continuity.
   */
  async promptSession(
    sessionId: string,
    text: string,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const session = this.sessions.get(sessionId)
    if (!session) return { ok: false, error: "unknown session" }
    if (this.nativeBindings.has(session)) return { ok: false, error: "ACP_NATIVE_CONTEXT_REQUIRED" }
    const t = String(text || "").trim()
    if (!t) return { ok: false, error: "empty prompt" }

    const handle = this.protocolHandles.get(sessionId)
    if (handle && session.state === "running") {
      this.pushTimeline(session, [timelineItem("user_message", t.slice(0, 200), { detail: t })])
      try {
        await handle.prompt(t)
        return { ok: true }
      } catch (e: any) {
        return { ok: false, error: e?.message || String(e) }
      }
    }

    // CLI or closed: new turn via followup
    const fu = this.followup({ parentSessionId: sessionId, goal: t, mode: session.mode })
    if (!fu.ok) return { ok: false, error: fu.error }
    // Auto-start followup requires caller HITL — return session id for UI to confirm
    return {
      ok: false,
      error: `NEEDS_CONFIRM_FOLLOWUP:${fu.session.session_id}`,
    }
  }

  /** Native same-process turn. A missing live handle never creates a legacy offer. */
  async promptNative(sessionId: string, text: string, context: NativeLocalContext): Promise<{ ok: true } | { ok: false; error: string }> {
    const session = this.sessions.get(sessionId)
    if (!session || this.nativeBindings.get(session)?.identity !== context ||
        !this.nativeCurrent(session) || session.mode_c_open_cancelled)
      return { ok: false, error: "ACP_NATIVE_CONTEXT_STALE" }
    if (typeof text !== "string" || !text.trim() || text.length > 8000)
      return { ok: false, error: "ACP_NATIVE_GOAL_LIMIT" }
    const handle = this.protocolHandles.get(sessionId)
    if (!handle || session.state !== "running") return { ok: false, error: "ACP_NATIVE_FOLLOWUP_REQUIRED" }
    this.pushTimeline(session, [timelineItem("user_message", text.slice(0, 200), { detail: text })])
    // An event observer can retire the owner synchronously during the timeline update.
    if (!this.nativeCurrent(session) || session.mode_c_open_cancelled)
      return { ok: false, error: "ACP_NATIVE_CONTEXT_STALE" }
    try {
      await handle.prompt(text)
      if (!this.nativeCurrent(session) || session.mode_c_open_cancelled)
        return { ok: false, error: "ACP_NATIVE_CONTEXT_STALE" }
      return { ok: true }
    } catch { return { ok: false, error: "ACP_NATIVE_PROMPT_FAILED" } }
  }

  /**
   * Multi-turn: start a new session with prior handback context + user follow-up.
   */
  followup(opts: {
    parentSessionId: string
    goal: string
    mode?: "review_readonly" | "propose_diff"
  }): { ok: true; session: AcpSessionRecord } | { ok: false; error: string } {
    const parent = this.sessions.get(opts.parentSessionId)
    if (!parent) return { ok: false, error: "acp: parent session not found" }
    if (this.nativeBindings.has(parent)) return { ok: false, error: "ACP_NATIVE_CONTEXT_REQUIRED" }
    const prior = (parent.handback_text || "").slice(0, 12_000)
    const goal = [
      "Follow-up on previous coding handoff session.",
      prior ? `Previous output (untrusted):\n${prior}\n` : "",
      "User follow-up:",
      opts.goal,
    ].join("\n")
    return this.propose({
      threadId: parent.thread_id,
      agentId: parent.agent_id,
      goal,
      workspaceRoot: parent.workspace_root,
      mode: opts.mode || parent.mode,
      parentSessionId: parent.session_id,
    })
  }

  followupNative(opts: Parameters<AcpManager["followup"]>[0], context: NativeLocalContext): ReturnType<AcpManager["propose"]> {
    const parent = this.sessions.get(opts.parentSessionId)
    if (!parent || this.nativeBindings.get(parent)?.identity !== context || !this.nativeCurrent(parent))
      return { ok: false, error: "ACP_NATIVE_CONTEXT_STALE" }
    const goal = ["Follow-up on previous coding handoff session.",
      parent.handback_text ? `Previous output (untrusted):\n${parent.handback_text}\n` : "",
      "User follow-up:", opts.goal].join("\n")
    // Never let the legacy propose slice drop the new user instruction.
    if (typeof opts.goal !== "string" || !opts.goal.trim() || goal.length > 8000)
      return { ok: false, error: "ACP_NATIVE_GOAL_LIMIT" }
    return this.proposeNative({threadId:parent.thread_id, agentId:parent.agent_id, goal,
      workspaceRoot:parent.workspace_root, mode:opts.mode || parent.mode, parentSessionId:parent.session_id}, context)
  }

  /**
   * Apply pending_diffs from a propose_diff session (caller must enforce L2 HITL).
   */
  applyPendingDiffs(
    sessionId: string,
    opts: { paths?: string[]; allowDelete?: boolean } = {},
  ): {
    ok: boolean
    applied: string[]
    skipped: Array<{ path: string; reason: string }>
    error?: string
  } {
    const session = this.sessions.get(sessionId)
    if (!session || this.nativeBindings.has(session)) return { ok: false, applied: [], skipped: [], error: "unknown session" }
    if (session.mode !== "propose_diff") {
      return { ok: false, applied: [], skipped: [], error: "session is not propose_diff mode" }
    }
    let files = session.pending_diffs || []
    if (opts.paths?.length) {
      const want = new Set(opts.paths)
      files = files.filter((f) => want.has(f.relPath))
    }
    if (!files.length) {
      return { ok: false, applied: [], skipped: [], error: "no pending diffs" }
    }
    const r = applyParsedDiffs(
      session.workspace_root,
      files.map((f) => ({
        relPath: f.relPath,
        hunk: f.hunk,
        newContent: f.newContent,
        isNew: f.isNew,
        isDelete: f.isDelete,
        hunks: f.hunks || [],
      })),
      { allowDelete: opts.allowDelete === true },
    )
    logger.info("acp.apply_diff", {
      session_id: sessionId,
      applied: r.applied,
      skipped: r.skipped.length,
    })
    return r
  }

  cancel(sessionId: string): { ok: true } | { ok: false; error: string } {
    const session = this.sessions.get(sessionId)
    if (session && this.nativeBindings.has(session)) return { ok: false, error: "ACP_NATIVE_CONTEXT_REQUIRED" }
    return this.cancelOwned(sessionId)
  }

  cancelNative(sessionId: string, context: NativeLocalContext): ReturnType<AcpManager["cancel"]> {
    const session = this.sessions.get(sessionId)
    if (!session || this.nativeBindings.get(session)?.identity !== context)
      return { ok: false, error: "ACP_NATIVE_CONTEXT_STALE" }
    // Stop is allowed for the same private capability even after its document retires.
    return this.cancelOwned(sessionId)
  }

  private cancelOwned(sessionId: string): { ok: true } | { ok: false; error: string } {
    const session = this.sessions.get(sessionId)
    if (!session) return { ok: false, error: "acp: unknown session" }
    // Stop must never inject a "完成" handback — bridge killed, work may be partial
    // (and Mode C terminal agent may still be running).
    session.partial = true
    session.mode_c_open_cancelled = true
    this.startupPreparations.get(sessionId)?.controller.abort()
    if (session.local_terminal === "pending") {
      session.local_terminal = "skipped"
    }
    const handle = this.protocolHandles.get(sessionId)
    if (handle) {
      try {
        handle.cancel()
      } catch {
        /* */
      }
      this.protocolHandles.delete(sessionId)
    }
    const child = this.processes.get(sessionId)
    if (child) {
      try {
        killAcpChild(child, "SIGTERM")
      } catch {
        /* */
      }
      setTimeout(() => {
        try {
          killAcpChild(child, "SIGKILL")
        } catch {
          /* */
        }
      }, 1500)
    }
    session.error = session.error || "cancelled"
    if (session.state === "offered" || session.state === "running" || session.state === "confirmed") {
      session.state = "closed"
    }
    this.pushTimeline(session, [
      timelineItem(
        "status",
        session.open_local_terminal_snapshot
          ? "监视已停止（本机终端 Agent 可能仍在运行）"
          : "cancelled",
        { status: "error" },
      ),
    ])
    this.emitProgress(session, "cancelled", true)
    this.emitTerminal(session, "cancelled")
    return { ok: true }
  }

  async shutdown(): Promise<void> {
    this.manualEntryLaunches.clear()
    this.shuttingDown = true
    this.unsubscribeEmbedSpawn()
    const children = [...this.ownedChildren]
    const preparations = [...this.startupPreparations.values()]
    for (const [id, session] of this.sessions) {
      if (session.state === "running" || this.processes.has(id) || this.nativeBindings.has(session)) this.cancelOwned(id)
    }
    await Promise.all([...children.map(closeAcpChild), ...preparations.map(p => p.done.catch(() => {}))])
  }
}

let singleton: AcpManager | null = null

export function getAcpManager(): AcpManager {
  if (!singleton) singleton = new AcpManager()
  return singleton
}

export function _resetAcpManagerForTests(): void {
  singleton?.shutdown()
  singleton = null
}

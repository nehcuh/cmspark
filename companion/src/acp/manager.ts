// ACP session manager — Phase B+ live progress (default acp.enabled=false).
// Spawns configured stdio agent; streams progress via onEvent → WS broadcast.

import { spawn, type ChildProcessWithoutNullStreams } from "child_process"
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
import type { AcpAgentServerConfig } from "./types"

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
}

export type AcpEventListener = (ev: AcpLiveEvent) => void

function newSessionId(): string {
  return `acp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

export class AcpManager {
  private sessions = new Map<string, AcpSessionRecord>()
  private processes = new Map<string, ChildProcessWithoutNullStreams>()
  private runningCount = 0
  private listeners = new Set<AcpEventListener>()
  private lastProgressAt = new Map<string, number>()
  private handbackSink: AcpHandbackSink | null = null

  onEvent(fn: AcpEventListener): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  /** Inject completed handback into thread history (wired from server boot). */
  setHandbackSink(fn: AcpHandbackSink | null): void {
    this.handbackSink = fn
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
    this.emit({
      type: "acp.session.event",
      session_id: session.session_id,
      thread_id: session.thread_id,
      agent_id: session.agent_id,
      state: session.state,
      progress_tail: tail.slice(-400),
      goal: session.goal,
      workspace_root: session.workspace_root,
      display_name: display,
      partial: session.partial,
      error: session.error,
      handback: session.handback_text,
    })
  }

  private agentDisplayName(agentId: string): string {
    const s = getConfig().acp?.servers?.[agentId]
    if (s?.display_name) return s.display_name
    const d = discoverCodingAgents().find((a) => a.id === agentId)
    return d?.display_name || agentId
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

  listAgents(): Array<{
    id: string
    display_name: string
    enabled: boolean
    profile: string
    command: string
    source?: "config" | "discovered"
  }> {
    const cfg = getConfig()
    const acp = cfg.acp
    if (!acp?.enabled) return []
    const out: Array<{
      id: string
      display_name: string
      enabled: boolean
      profile: string
      command: string
      source?: "config" | "discovered"
    }> = []
    const seen = new Set<string>()
    for (const [id, s] of Object.entries(acp.servers || {})) {
      if (!s.command) continue
      seen.add(id)
      out.push({
        id,
        display_name: s.display_name,
        enabled: s.enabled && !!s.command,
        profile: s.policy.profile,
        command: s.command,
        source: "config",
      })
    }
    for (const d of discoverCodingAgents()) {
      if (seen.has(d.id)) continue
      // skip if same command already registered under another id
      if (out.some((a) => a.command === d.command)) continue
      out.push({
        id: d.id,
        display_name: d.display_name,
        enabled: true,
        profile: "review_readonly",
        command: d.command,
        source: "discovered",
      })
    }
    return out
  }

  getSession(sessionId: string): AcpSessionRecord | undefined {
    return this.sessions.get(sessionId)
  }

  listSessionsForThread(threadId: string): AcpSessionRecord[] {
    return [...this.sessions.values()].filter((s) => s.thread_id === threadId)
  }

  propose(opts: {
    threadId: string
    agentId: string
    goal: string
    workspaceRoot?: string | null
  }): { ok: true; session: AcpSessionRecord } | { ok: false; error: string } {
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
    const profile: AcpPolicyProfile = "review_readonly"

    const session: AcpSessionRecord = {
      session_id: newSessionId(),
      thread_id: opts.threadId,
      agent_id: opts.agentId,
      state: "offered",
      workspace_root: ws.root,
      profile,
      goal: String(opts.goal || "").slice(0, 8000),
      created_at: new Date().toISOString(),
      partial: false,
    }
    this.sessions.set(session.session_id, session)
    logger.info("acp.offer", { session_id: session.session_id, agent: opts.agentId })
    this.emitProgress(session, "offered — waiting to start", true)
    return { ok: true, session }
  }

  async start(sessionId: string): Promise<
    | { ok: true; session: AcpSessionRecord }
    | { ok: false; error: string }
  > {
    const session = this.sessions.get(sessionId)
    if (!session) return { ok: false, error: "acp: unknown session" }
    if (session.state !== "offered" && session.state !== "confirmed") {
      return { ok: false, error: `acp: cannot start from state ${session.state}` }
    }
    const cfg = getConfig()
    if (!cfg.acp?.enabled) return { ok: false, error: "acp: feature disabled" }
    const server = this.resolveServer(session.agent_id)
    if (!server?.command) return { ok: false, error: "acp: agent config missing" }

    this.runningCount++
    session.state = "running"
    this.emitProgress(session, "starting…", true)

    const prompt = [
      "You are running under CMspark 编程接力 (read-only review session).",
      "Do NOT modify files, run package installs, or git push.",
      `Workspace: ${session.workspace_root}`,
      "",
      "Task:",
      session.goal,
      "",
      "Return a structured code review: findings (severity), files of interest, residual risks.",
    ].join("\n")

    const promptPath = path.join(os.tmpdir(), `cmspark-acp-${session.session_id}.md`)
    try {
      fs.writeFileSync(promptPath, prompt, { encoding: "utf8", mode: 0o600 })
    } catch (e: any) {
      this.runningCount = Math.max(0, this.runningCount - 1)
      session.state = "closed"
      session.error = `cannot write prompt file: ${e?.message || e}`
      this.emitProgress(session, session.error, true)
      return { ok: false, error: session.error }
    }

    const args = [...(server.args || [])]

    return await new Promise((resolve) => {
      let stdout = ""
      let stderr = ""
      const maxOut = server.policy.max_handback_chars ?? 48_000
      const timeoutMs = server.policy.session_timeout_ms ?? 15 * 60_000

      let child: ChildProcessWithoutNullStreams
      try {
        child = spawn(server.command, args, {
          cwd: session.workspace_root,
          env: {
            PATH: process.env.PATH,
            HOME: process.env.HOME,
            USERPROFILE: process.env.USERPROFILE,
            LANG: process.env.LANG,
            ...(server.env || {}),
            CMSPARK_ACP_SESSION: session.session_id,
            CMSPARK_ACP_MODE: "review_readonly",
          },
          stdio: ["pipe", "pipe", "pipe"],
        })
      } catch (e: any) {
        this.runningCount = Math.max(0, this.runningCount - 1)
        session.state = "closed"
        const errMsg = e?.message || String(e)
        session.error = errMsg
        this.emitProgress(session, errMsg, true)
        resolve({ ok: false, error: errMsg })
        return
      }

      session.pid = child.pid
      this.processes.set(sessionId, child)
      this.emitProgress(session, `pid ${child.pid} running…`, true)

      try {
        child.stdin.write(prompt)
        child.stdin.end()
      } catch {
        /* some CLIs ignore stdin */
      }

      const timer = setTimeout(() => {
        session.partial = true
        this.emitProgress(session, "timeout — stopping…", true)
        try {
          child.kill("SIGTERM")
        } catch {
          /* */
        }
        setTimeout(() => {
          try {
            child.kill("SIGKILL")
          } catch {
            /* */
          }
        }, 2000)
      }, timeoutMs)

      child.stdout.on("data", (buf: Buffer) => {
        stdout += buf.toString("utf8")
        if (stdout.length > maxOut * 2) stdout = stdout.slice(-maxOut)
        this.emitProgress(session, stdout)
      })
      child.stderr.on("data", (buf: Buffer) => {
        stderr += buf.toString("utf8")
        if (stderr.length > 8000) stderr = stderr.slice(-8000)
        this.emitProgress(session, stderr)
      })

      child.on("error", (err) => {
        clearTimeout(timer)
        this.runningCount = Math.max(0, this.runningCount - 1)
        this.processes.delete(sessionId)
        session.state = "closed"
        const msg = err?.message || String(err)
        session.error = msg
        logger.warn("acp.spawn_error", { session_id: sessionId, err: msg })
        this.emitProgress(session, msg, true)
        resolve({ ok: false, error: msg })
      })

      child.on("close", (code) => {
        clearTimeout(timer)
        this.runningCount = Math.max(0, this.runningCount - 1)
        this.processes.delete(sessionId)
        const body =
          stdout.trim() ||
          stderr.trim() ||
          `(agent exited code=${code} with no output)`
        session.handback_text = frameAcpHandback({
          agentId: session.agent_id,
          sessionId: session.session_id,
          profile: session.profile,
          partial: session.partial || code !== 0,
          body,
          maxChars: maxOut,
        })
        session.state = "closed"
        markAcpHandbackSeen(session.thread_id)
        try {
          fs.unlinkSync(promptPath)
        } catch {
          /* best-effort */
        }
        if (session.handback_text && this.handbackSink) {
          try {
            this.handbackSink({ session, handback: session.handback_text })
          } catch (e: any) {
            logger.warn("acp.handback_sink_error", { err: e?.message || String(e) })
          }
        }
        logger.info("acp.session_ended", {
          session_id: sessionId,
          code,
          handback_len: session.handback_text?.length,
        })
        this.emitProgress(session, body.slice(-400), true)
        resolve({ ok: true, session })
      })
    })
  }

  cancel(sessionId: string): { ok: true } | { ok: false; error: string } {
    const session = this.sessions.get(sessionId)
    if (!session) return { ok: false, error: "acp: unknown session" }
    const child = this.processes.get(sessionId)
    if (child) {
      try {
        child.kill("SIGTERM")
      } catch {
        /* */
      }
      setTimeout(() => {
        try {
          child.kill("SIGKILL")
        } catch {
          /* */
        }
      }, 1500)
    }
    session.error = session.error || "cancelled"
    if (session.state === "offered" || session.state === "running" || session.state === "confirmed") {
      session.state = "closed"
    }
    this.emitProgress(session, "cancelled", true)
    return { ok: true }
  }

  shutdown(): void {
    for (const id of [...this.processes.keys()]) {
      this.cancel(id)
    }
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

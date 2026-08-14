// Full-height Coding Agent Panel — browser-side shell for local coding agents
// (Zed Agent Panel analogue for 320px). Primary UX for /code; not a task-package modal.

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react"
import { tokens } from "../ui/tokens"
import { codingHandoffCopy } from "../coding-handoff/copy"
import {
  buildCodingTaskPackage,
  copyTextToClipboard,
  summarizeDialogMessages,
} from "../coding-handoff/task-package"
import {
  parseRepoFromUrl,
  formatPageContext,
  cloneCommand,
} from "../coding-handoff/repo-context"
import { useAgentStore } from "../store/agentStore"
import { MinimalConfirm } from "./MinimalConfirm"

/**
 * Progress tail display caps — mirror companion/src/acp/progress-caps.ts.
 * Companion emits PROGRESS_TAIL_CLI_CHARS (12k) for CLI / 2k for ACP;
 * UI shows last PROGRESS_TAIL_DISPLAY_LINES of that tail (dual-synthesis ~200 lines / 64KB intent).
 */
const PROGRESS_TAIL_CLI_CHARS = 12_000
const PROGRESS_TAIL_DISPLAY_LINES = 200

/** Last N lines (and at most maxChars) of a progress_tail for the live log pre. */
function displayProgressTail(
  text: string,
  maxLines: number = PROGRESS_TAIL_DISPLAY_LINES,
  maxChars: number = PROGRESS_TAIL_CLI_CHARS,
): string {
  const raw = String(text || "")
  const charCapped = raw.length > maxChars ? raw.slice(-maxChars) : raw
  const lines = charCapped.split("\n")
  if (lines.length <= maxLines) return charCapped
  return lines.slice(-maxLines).join("\n")
}

/** Companion / SW errors that mean master switch still off (retry must re-enable). */
function isAcpDisabledError(s: string): boolean {
  // Prefer exact companion copy; avoid matching "agent disabled" per-server strings.
  return (
    /acp:\s*feature disabled/i.test(s) ||
    /feature disabled.*编程助手|feature disabled.*acp/i.test(s) ||
    /ACP 会话未启用|本机 Agent 会话未启用|未启用.*ACP/i.test(s)
  )
}

/** Queue head is the ACP session-start confirm (not apply_diff / unrelated tools). */
function isAcpStartConfirmTool(toolName: string | undefined): boolean {
  const t = (toolName || "").toLowerCase()
  return (
    t === "acp_start_session" ||
    t === "acp.ui_start" ||
    t === "acp_ui_start" ||
    t.includes("acp_start_session")
  )
}

/** Confirm-host label: ACP tools get specific hints; never claim Agent-start for evaluate/shell. */
function confirmHostHint(toolName: string | undefined, riskLevel?: string): string {
  const name = (toolName || "").trim()
  if (isAcpStartConfirmTool(name)) {
    return "启动本机 Agent 需要确认"
  }
  if (name === "acp_apply_diff" || name === "acp.apply_diff") {
    return "应用 diff 需要确认"
  }
  if (name === "acp_permission" || name === "acp.permission") {
    return "本机 Agent 权限请求"
  }
  if (name.startsWith("acp_") || name.startsWith("acp.")) {
    return `安全确认 · ${name}`
  }
  if (name) {
    return riskLevel ? `安全确认 · ${name}（${riskLevel}）` : `安全确认 · ${name}`
  }
  return "安全确认"
}

type AcpAgent = {
  id: string
  display_name: string
  enabled: boolean
  command: string
  source?: "config" | "discovered"
}

type TimelineRow = {
  id?: string
  kind?: string
  label?: string
  detail?: string
  path?: string
  status?: string
}

type Props = {
  open: boolean
  onClose: () => void
  workspaceRoot?: string | null
  messages: Array<{ role?: string; content?: string }>
  pageUrl?: string | null
  pageTitle?: string | null
  seedGoal?: string
  threadId?: string | null
  acpEnabled?: boolean
  acpAgents?: AcpAgent[]
  /** Mode C: config.coding_handoff.open_local_terminal (from store if available). */
  openLocalTerminal?: boolean
}

export function CodingAgentPanel({
  open,
  onClose,
  workspaceRoot,
  messages,
  pageUrl,
  pageTitle,
  seedGoal,
  threadId,
  acpEnabled = false,
  acpAgents = [],
  openLocalTerminal = false,
}: Props) {
  const { state, dispatch } = useAgentStore()
  const session = state.codingSession
  const confirmQueue = state.pendingSecurityConfirmations
  const pendingConfirm = confirmQueue.length > 0
  const headConfirm = confirmQueue[0]
  // Companion errors also land on processingStatus for ACP
  const externalStatus = state.processingStatus
  /** Store-level enabled flag (updated by acp.list / SET_ACP_LIST). */
  const storeAcpEnabled = state.acpEnabled === true
  /** Prefer prop; fall back to config store (settings optimistically sets coding_handoff). */
  const configOpenLocalTerminal =
    openLocalTerminal ||
    (state.config as { coding_handoff?: { open_local_terminal?: boolean } } | undefined)
      ?.coding_handoff?.open_local_terminal === true

  const dialogDefault = useMemo(
    () => summarizeDialogMessages(messages, 6),
    [messages],
  )
  const [goal, setGoal] = useState(seedGoal || "")
  const [agentId, setAgentId] = useState("")
  const [mode, setMode] = useState<"review_readonly" | "propose_diff">("review_readonly")
  const [cloudDisclosure, setCloudDisclosure] = useState(false)
  const [status, setStatus] = useState("")
  const [input, setInput] = useState("")
  const [showCopyOnly, setShowCopyOnly] = useState(false)
  const [starting, setStarting] = useState(false)
  /** B-lite S1: one-line git status under 工作区 (branch · dirty N / 非 git / —) */
  const [gitStatusLine, setGitStatusLine] = useState<string | null>(null)

  const wasOpenRef = useRef(false)
  const acpEnabledRef = useRef(storeAcpEnabled || acpEnabled)
  const startingRef = useRef(false)
  const messagesRef = useRef(messages)
  /** Enable-poll chain timers — clear on unmount / panel close (Claude dual nit). */
  const enablePollTimersRef = useRef<number[]>([])
  const mountedRef = useRef(true)
  /**
   * After 启动 with no workspace: open folder picker once, then auto-continue start
   * when bind lands (avoid forcing a second manual pick / second 启动 click).
   */
  const pendingStartAfterPickRef = useRef(false)
  /** Optimistic workspace from pick_result before thread.list/UPSERT re-renders prop. */
  const [localWorkspace, setLocalWorkspace] = useState<string | null>(null)
  messagesRef.current = messages
  acpEnabledRef.current = storeAcpEnabled || acpEnabled
  startingRef.current = starting

  const effectiveWorkspace =
    (workspaceRoot && String(workspaceRoot).trim()) ||
    (localWorkspace && String(localWorkspace).trim()) ||
    null

  const clearEnablePollTimers = useCallback(() => {
    for (const id of enablePollTimersRef.current) {
      window.clearTimeout(id)
    }
    enablePollTimersRef.current = []
  }, [])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      clearEnablePollTimers()
    }
  }, [clearEnablePollTimers])

  const readyAgents = useMemo(
    () => acpAgents.filter((a) => a.enabled !== false && a.command),
    [acpAgents],
  )

  // Prefer first ready agent when list arrives / changes
  useEffect(() => {
    if (!readyAgents.length) return
    if (!agentId || !readyAgents.some((a) => a.id === agentId)) {
      setAgentId(readyAgents[0].id)
    }
  }, [readyAgents, agentId])
  const repoHint = useMemo(() => parseRepoFromUrl(pageUrl), [pageUrl])
  const live = session?.state === "running" || session?.state === "offered"
  const timeline = (session?.timeline || []) as TimelineRow[]

  // P0-3: seed form only on open rising edge (optional seedGoal when open transitions).
  // Do NOT list `messages` as a dep — chat traffic must not uncheck cloudDisclosure / wipe goal.
  useEffect(() => {
    const rising = open && !wasOpenRef.current
    const falling = !open && wasOpenRef.current
    wasOpenRef.current = open
    if (falling) {
      pendingStartAfterPickRef.current = false
      // Panel hides via open=false but stays mounted — stop enable-poll / start fallbacks
      clearEnablePollTimers()
      setStarting(false)
      return
    }
    if (!open) return
    if (!rising) return
    const msgs = messagesRef.current
    setGoal(
      seedGoal?.trim() ||
        msgs
          .filter((m) => m.role === "user" && m.content)
          .slice(-1)[0]
          ?.content?.slice(0, 500) ||
        "",
    )
    setStatus("")
    setCloudDisclosure(false)
    setInput("")
    setStarting(false)
    clearEnablePollTimers()
    chrome.runtime.sendMessage({ type: "acp.list" }, () => {
      void chrome.runtime.lastError
    })
  }, [open, seedGoal, clearEnablePollTimers])

  useEffect(() => {
    if (readyAgents.length && !readyAgents.some((a) => a.id === agentId)) {
      setAgentId(readyAgents[0].id)
    }
  }, [readyAgents, agentId])

  const flash = (msg: string, ms = 3500) => {
    setStatus(msg)
    window.setTimeout(() => setStatus(""), ms)
  }

  /**
   * UI-store only: flip acpEnabled false so retry re-sends config.set.
   * Does not disable companion (next acp.list self-corrects if companion is on).
   */
  const setStoreAcpEnabledFalse = useCallback(() => {
    dispatch({
      type: "SET_ACP_LIST",
      enabled: false,
      agents: state.acpAgents.length ? state.acpAgents : (acpAgents as any),
    })
  }, [dispatch, state.acpAgents, acpAgents])

  // Clear `starting` only on: ACP start confirm, *live* session, or ACP error status.
  // Never treat closed/stale session.sessionId as start-complete (Pi dual R2).
  useEffect(() => {
    if (!starting) return
    const head = confirmQueue[0]
    const headTool =
      head?.tool_name ||
      (Array.isArray(head?.dangerous_apis) ? head?.dangerous_apis[0] : undefined)
    if (head && isAcpStartConfirmTool(String(headTool || ""))) {
      // Confirm bar is up — leave "启动中" so CTA stays disabled until user acts
      // (ctaDisabled includes pendingConfirm). Do not clear starting yet if we want
      // disabled CTA via pendingConfirm alone; clear so label returns after allow.
      setStarting(false)
      return
    }
    const liveSession =
      session?.state === "running" || session?.state === "offered"
    if (liveSession) {
      setStarting(false)
      clearEnablePollTimers()
      return
    }
    if (typeof externalStatus === "string" && externalStatus.trim()) {
      if (isAcpDisabledError(externalStatus)) {
        setStoreAcpEnabledFalse()
        setStarting(false)
        clearEnablePollTimers()
        flash(externalStatus, 6000)
        return
      }
      // Other ACP-routed errors (cloud_disclosure, spawn, …) also end starting
      if (/^acp:|acp\.|编程助手|cloud_disclosure/i.test(externalStatus)) {
        setStarting(false)
        clearEnablePollTimers()
        flash(externalStatus, 6000)
      }
    }
  }, [
    starting,
    confirmQueue,
    session?.state,
    externalStatus,
    setStoreAcpEnabledFalse,
    clearEnablePollTimers,
  ])

  const pickWorkspace = useCallback(() => {
    if (!threadId) {
      flash("请先选择对话")
      return
    }
    flash("正在打开文件夹…")
    chrome.runtime.sendMessage({ type: "workspace.pick", thread_id: threadId }, () => {
      void chrome.runtime.lastError
    })
  }, [threadId])

  // Prop is SoT when companion has bound the thread; keep local mirror in sync.
  useEffect(() => {
    if (workspaceRoot && String(workspaceRoot).trim()) {
      setLocalWorkspace(String(workspaceRoot).trim())
    }
  }, [workspaceRoot])

  // Clear optimistic path when switching threads.
  useEffect(() => {
    setLocalWorkspace(null)
    pendingStartAfterPickRef.current = false
  }, [threadId])

  // On open: refresh thread list so 场景-bound workspace_root is not stale in the panel.
  useEffect(() => {
    if (!open) return
    chrome.runtime.sendMessage({ type: "thread.list" }, () => {
      void chrome.runtime.lastError
    })
  }, [open])

  // pick_result may arrive via SW before store prop updates — bind optimistically.
  useEffect(() => {
    if (!open) return
    const onMsg = (msg: {
      type?: string
      thread?: { id?: string; workspace_root?: string | null }
      path?: string
      bound?: boolean
      error?: string
      cancelled?: boolean
    }) => {
      if (msg?.type !== "workspace.pick_result") return
      if (msg.error || msg.cancelled) {
        pendingStartAfterPickRef.current = false
        if (startingRef.current) setStarting(false)
        return
      }
      const path =
        (typeof msg.thread?.workspace_root === "string" && msg.thread.workspace_root) ||
        (typeof msg.path === "string" && msg.path) ||
        ""
      if (path.trim()) setLocalWorkspace(path.trim())
    }
    chrome.runtime.onMessage.addListener(onMsg)
    return () => chrome.runtime.onMessage.removeListener(onMsg)
  }, [open])

  /**
   * B-lite S1: fetch git status when workspace is bound.
   * Fail soft — never blocks start. Companion asserts spawn cwd == workspace_root
   * (true today), so we label under 工作区 as agent workspace status.
   */
  useEffect(() => {
    if (!open || !effectiveWorkspace) {
      setGitStatusLine(null)
      return
    }
    // Soft placeholder until response; omit spinner that would feel blocking
    setGitStatusLine("—")
    chrome.runtime.sendMessage(
      { type: "coding.git_status", workspace_root: effectiveWorkspace },
      () => {
        void chrome.runtime.lastError
      },
    )
  }, [open, effectiveWorkspace])

  useEffect(() => {
    if (!open) return
    const onGitStatus = (ev: Event) => {
      const d = (ev as CustomEvent).detail as {
        workspace_root?: string | null
        branch?: string | null
        dirty_count?: number
        is_repo?: boolean
        error?: string
        agent_cwd_is_workspace?: boolean
      } | null
      if (!d || !effectiveWorkspace) return
      // Match request path or companion realpath (basename / string equality)
      const returned = typeof d.workspace_root === "string" ? d.workspace_root : ""
      const req = effectiveWorkspace
      const pathMatch =
        !returned ||
        returned === req ||
        returned.endsWith(req) ||
        req.endsWith(returned) ||
        returned.split(/[/\\]/).pop() === req.split(/[/\\]/).filter(Boolean).pop()
      if (!pathMatch) return

      // Only show as agent workspace status when spawn cwd == workspace (true today)
      if (d.agent_cwd_is_workspace === false) {
        setGitStatusLine("工作区状态，非 Agent 目录")
        return
      }
      if (d.error && !d.is_repo) {
        // soft omit / dash — never fake clean
        setGitStatusLine("—")
        return
      }
      if (!d.is_repo) {
        setGitStatusLine("非 git")
        return
      }
      const branch = (d.branch || "HEAD").trim() || "HEAD"
      const dirty =
        typeof d.dirty_count === "number" && d.dirty_count >= 0 ? d.dirty_count : 0
      setGitStatusLine(`${branch} · dirty ${dirty}`)
    }
    window.addEventListener("cmspark:coding.git_status", onGitStatus)
    return () => window.removeEventListener("cmspark:coding.git_status", onGitStatus)
  }, [open, effectiveWorkspace])

  /** Fire acp.ui_start (Companion still L2-confirms — confirm UI is in this panel). */
  const sendUiStart = useCallback(() => {
    const ws = effectiveWorkspace
    if (!threadId || !agentId || !ws) {
      setStarting(false)
      return
    }
    flash("正在启动…请在下方确认条点「允许」")
    const page_context = formatPageContext({
      pageUrl,
      pageTitle,
      repo: repoHint,
    })
    chrome.runtime.sendMessage(
      {
        type: "acp.ui_start",
        thread_id: threadId,
        agent_id: agentId,
        goal: goal.trim(),
        workspace_root: ws,
        mode,
        cloud_disclosure_accepted: true,
        page_context,
        page_url: pageUrl || undefined,
        page_title: pageTitle || undefined,
        repo_hint: repoHint ? `${repoHint.owner}/${repoHint.name}` : undefined,
      },
      (resp?: { ok?: boolean; error?: string }) => {
        const err = chrome.runtime.lastError?.message
        if (err) {
          flash(`扩展转发失败: ${err}`, 6000)
          setStarting(false)
          return
        }
        if (resp && resp.ok === false) {
          const errMsg = resp.error || "Companion 未连接"
          flash(errMsg, 6000)
          if (isAcpDisabledError(errMsg)) {
            setStoreAcpEnabledFalse()
          }
          setStarting(false)
          return
        }
        // Fallback: if no confirm/session/error within 12s, re-enable CTA
        const tid = window.setTimeout(() => {
          if (mountedRef.current && startingRef.current) setStarting(false)
        }, 12000)
        enablePollTimersRef.current.push(tid)
      },
    )
  }, [
    threadId,
    agentId,
    effectiveWorkspace,
    goal,
    mode,
    pageUrl,
    pageTitle,
    repoHint,
    setStoreAcpEnabledFalse,
  ])

  /**
   * After config.set acp.enabled=true is *sent*, wait until store reflects enabled
   * (via acp.list / SET_ACP_LIST) before ui_start — do not treat 120ms as proof.
   */
  const waitUntilAcpEnabledThenStart = useCallback(() => {
    clearEnablePollTimers()
    const deadline = Date.now() + 4000
    let listTicks = 0
    const tick = () => {
      if (!mountedRef.current) return
      if (acpEnabledRef.current) {
        sendUiStart()
        return
      }
      if (Date.now() >= deadline) {
        if (!mountedRef.current) return
        flash("启用超时：本机 Agent 仍未开启，请检查 Companion 连接后重试", 6000)
        setStoreAcpEnabledFalse()
        setStarting(false)
        return
      }
      // Refresh list every ~400ms so SET_ACP_LIST can flip storeAcpEnabled
      if (listTicks % 2 === 0) {
        chrome.runtime.sendMessage({ type: "acp.list" }, () => {
          void chrome.runtime.lastError
        })
      }
      listTicks += 1
      const tid = window.setTimeout(tick, 200)
      enablePollTimersRef.current.push(tid)
    }
    const first = window.setTimeout(tick, 150)
    enablePollTimersRef.current.push(first)
  }, [sendUiStart, setStoreAcpEnabledFalse, clearEnablePollTimers])

  /**
   * Primary path: run local agent inside this panel (Zed-like shell).
   * If master switch still off, enable it inline then start — no detour to Settings.
   */
  const doStart = useCallback(() => {
    if (starting) return
    if (!threadId) {
      flash("请先选择对话")
      return
    }
    if (!effectiveWorkspace) {
      // One folder picker; when bind lands we auto-continue (no second 启动 / re-pick).
      flash(codingHandoffCopy.workspaceMissingBody)
      pendingStartAfterPickRef.current = true
      setStarting(true)
      pickWorkspace()
      return
    }
    if (!agentId) {
      flash(codingHandoffCopy.agentNotFoundBody)
      return
    }
    if (!cloudDisclosure) {
      flash(codingHandoffCopy.disclosureBlocked)
      return
    }
    if (!goal.trim()) {
      flash("请填写任务目标")
      return
    }

    pendingStartAfterPickRef.current = false
    setStarting(true)

    // Prefer live store flag (prop may lag; ref tracks SET_ACP_LIST from companion)
    if (acpEnabledRef.current) {
      sendUiStart()
      return
    }

    // Inline first-run enable — must reach companion config.set (acp allow-listed).
    // Do NOT optimistically SET_ACP_LIST enabled:true (would make the poll a no-op);
    // keep list honest until companion acp.list reports enabled.
    // Do NOT SET_CONFIG acp (typed LLMConfig; settings SoT is acp.list / config.updated).
    flash("正在启用本机 Agent 会话…")
    chrome.runtime.sendMessage(
      { type: "config.set", config: { acp: { enabled: true } } },
      (resp?: { ok?: boolean; error?: string }) => {
        const err = chrome.runtime.lastError?.message
        if (err) {
          flash(`启用失败: ${err}`, 6000)
          setStarting(false)
          return
        }
        if (resp && resp.ok === false) {
          flash(resp.error || "启用失败：Companion 未连接", 6000)
          setStarting(false)
          return
        }
        // Sent only — poll store via acp.list before ui_start (P0-4)
        waitUntilAcpEnabledThenStart()
      },
    )
  }, [
    starting,
    threadId,
    effectiveWorkspace,
    agentId,
    cloudDisclosure,
    goal,
    pickWorkspace,
    sendUiStart,
    waitUntilAcpEnabledThenStart,
    dispatch,
  ])

  const doCopyPackage = useCallback(async () => {
    const pkg = buildCodingTaskPackage({
      goal: goal.trim() || "（未填目标）",
      workspaceRoot: effectiveWorkspace,
      pageUrl,
      pageTitle,
      dialogSummary: dialogDefault,
      includeDialog: true,
      includeUrl: true,
      includePageExcerpt: false,
    })
    const ok = await copyTextToClipboard(pkg.markdown)
    flash(ok ? codingHandoffCopy.copiedOk : codingHandoffCopy.clipboardFailed)
  }, [goal, effectiveWorkspace, pageUrl, pageTitle, dialogDefault])

  /**
   * Workspace pick is async. If 启动 opened the picker, continue start once
   * effectiveWorkspace is set — do not force a second pick or second click.
   */
  useEffect(() => {
    if (!open || !pendingStartAfterPickRef.current) return
    if (!effectiveWorkspace) return
    if (!threadId || !agentId || !cloudDisclosure || !goal.trim()) {
      // Still missing other preconditions — clear sticky start, keep workspace.
      pendingStartAfterPickRef.current = false
      setStarting(false)
      return
    }
    pendingStartAfterPickRef.current = false
    flash("工作区已绑定，正在启动…")
    setStarting(true)
    if (acpEnabledRef.current) {
      sendUiStart()
      return
    }
    flash("正在启用本机 Agent 会话…")
    chrome.runtime.sendMessage(
      { type: "config.set", config: { acp: { enabled: true } } },
      (resp?: { ok?: boolean; error?: string }) => {
        const err = chrome.runtime.lastError?.message
        if (err || (resp && resp.ok === false)) {
          flash(err || resp?.error || "启用失败", 6000)
          setStarting(false)
          return
        }
        waitUntilAcpEnabledThenStart()
      },
    )
  }, [
    open,
    effectiveWorkspace,
    threadId,
    agentId,
    cloudDisclosure,
    goal,
    sendUiStart,
    waitUntilAcpEnabledThenStart,
  ])

  /** CLI transport is one-shot; only ACP keeps multi-turn send. */
  const isCliTransport = session?.transport === "cli"
  const composerDisabled = isCliTransport

  const onSend = () => {
    if (composerDisabled) return
    const t = input.trim()
    if (!t || !session?.sessionId) return
    chrome.runtime.sendMessage(
      { type: "acp.session.prompt", session_id: session.sessionId, text: t },
      () => {
        void chrome.runtime.lastError
      },
    )
    setInput("")
  }

  const toggleOpenLocalTerminal = useCallback((v: boolean) => {
    dispatch({
      type: "SET_CONFIG",
      config: {
        coding_handoff: {
          ...((state.config as { coding_handoff?: object } | undefined)?.coding_handoff ||
            {}),
          open_local_terminal: v,
        },
      } as any,
    })
    chrome.runtime.sendMessage({
      type: "config.set",
      config: { coding_handoff: { open_local_terminal: v } },
    })
  }, [dispatch, state.config])

  const onStop = () => {
    if (!session?.sessionId) return
    chrome.runtime.sendMessage(
      { type: "acp.session.cancel", session_id: session.sessionId },
      () => {
        void chrome.runtime.lastError
      },
    )
  }

  const onApply = () => {
    if (!session?.sessionId) return
    chrome.runtime.sendMessage(
      { type: "acp.apply_diff", session_id: session.sessionId },
      () => {
        void chrome.runtime.lastError
      },
    )
  }

  if (!open) return null

  const wsBase = effectiveWorkspace
    ? effectiveWorkspace.split(/[/\\]/).filter(Boolean).pop()
    : null

  const agentLabel =
    session?.displayName || session?.agentId || agentId || ""
  const panelTitle =
    live && agentLabel
      ? `${codingHandoffCopy.productName} · ${agentLabel}`
      : codingHandoffCopy.productName

  /**
   * Mode C honesty: prefer companion session fields (snapshot + outcome).
   * Do NOT use live settings toggle or failure timeline regex (dual-review B1/B2).
   */
  // Exclude failed/skipped: no host agent to leave running after Stop.
  const modeCLikely =
    session?.localTerminal === "opened" ||
    session?.localTerminal === "opened_l0" ||
    session?.localTerminal === "pending" ||
    (session?.openLocalTerminal === true &&
      session?.localTerminal !== "failed" &&
      session?.localTerminal !== "skipped")

  return (
    <div
      style={styles.overlay}
      role="dialog"
      aria-label={`${codingHandoffCopy.productName} 面板`}
    >
      <div style={styles.panel}>
        {/* Header */}
        <div style={styles.header}>
          <div>
            <div style={styles.title}>{panelTitle}</div>
            <div style={styles.sub}>{codingHandoffCopy.productBlurb}</div>
          </div>
          <button type="button" style={styles.iconBtn} onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>

        {/* L2 confirm must live inside this overlay — FocusBand is covered by the panel */}
        {pendingConfirm ? (
          <div style={styles.confirmHost} data-acp-confirm>
            <div style={styles.confirmHint}>
              {confirmHostHint(
                headConfirm?.tool_name ||
                  (Array.isArray(headConfirm?.dangerous_apis)
                    ? headConfirm?.dangerous_apis[0]
                    : undefined),
                headConfirm?.risk_level || headConfirm?.risk_category,
              )}
            </div>
            <MinimalConfirm />
          </div>
        ) : null}

        {/* Context strip — C1 basename + C1b B-lite git one-line (S1) */}
        <div style={styles.contextBar}>
          <div style={styles.ctxItem}>
            <span style={styles.ctxLabel}>工作区</span>
            {wsBase ? (
              <span style={styles.ctxVal} title={effectiveWorkspace || ""}>
                📁 {wsBase}
              </span>
            ) : (
              <span style={styles.ctxWarn}>未绑定</span>
            )}
            <button type="button" style={styles.linkBtn} onClick={pickWorkspace}>
              {wsBase ? "更换" : "选择…"}
            </button>
          </div>
          {wsBase && gitStatusLine ? (
            <div style={styles.ctxItem} data-git-status aria-label="工作区 git 状态">
              <span
                style={
                  gitStatusLine === "非 git" ||
                  gitStatusLine === "—" ||
                  gitStatusLine.startsWith("工作区状态")
                    ? styles.ctxMuted
                    : styles.ctxVal
                }
                title={
                  gitStatusLine === "—"
                    ? "git 状态加载中或不可用"
                    : gitStatusLine === "非 git"
                      ? "目录不是 git 仓库"
                      : "Agent 工作目录 git 状态（spawn cwd = workspace）"
                }
              >
                {gitStatusLine}
              </span>
            </div>
          ) : null}
          {repoHint ? (
            <div style={styles.ctxItem}>
              <span style={styles.ctxLabel}>页面</span>
              <span style={styles.ctxVal}>
                {repoHint.owner}/{repoHint.name}
                {repoHint.isPr ? ` #${repoHint.prNumber}` : ""}
              </span>
              <button
                type="button"
                style={styles.linkBtn}
                onClick={async () => {
                  const ok = await copyTextToClipboard(cloneCommand(repoHint))
                  flash(ok ? "已复制 git clone" : codingHandoffCopy.clipboardFailed)
                }}
              >
                复制 clone
              </button>
            </div>
          ) : pageUrl ? (
            <div style={styles.ctxItem}>
              <span style={styles.ctxLabel}>页面</span>
              <span style={styles.ctxMuted} title={pageUrl}>
                {(pageTitle || pageUrl).slice(0, 40)}
              </span>
            </div>
          ) : null}
        </div>

        {/* Setup (when no live session) — primary path is in-panel start */}
        {!live ? (
          <div style={styles.setup}>
            {readyAgents.length > 0 ? (
              <p style={styles.footnote}>{codingHandoffCopy.firstRunNote}</p>
            ) : (
              <div style={styles.banner}>{codingHandoffCopy.agentNotFoundBody}</div>
            )}

            <label style={styles.field}>
              <span style={styles.fieldLabel}>任务</span>
              <textarea
                style={styles.textarea}
                rows={3}
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                placeholder="描述要审查或修改的问题…"
              />
            </label>

            {readyAgents.length > 0 ? (
              <>
                <label style={styles.field}>
                  <span style={styles.fieldLabel}>本机 Agent</span>
                  <select
                    style={styles.select}
                    value={agentId}
                    onChange={(e) => setAgentId(e.target.value)}
                  >
                    {readyAgents.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.display_name}
                        {a.source === "discovered" ? "（已检测）" : "（已配置）"}
                      </option>
                    ))}
                  </select>
                </label>
                <label style={styles.field}>
                  <span style={styles.fieldLabel}>模式</span>
                  <select
                    style={styles.select}
                    value={mode}
                    onChange={(e) =>
                      setMode(
                        e.target.value === "propose_diff" ? "propose_diff" : "review_readonly",
                      )
                    }
                  >
                    <option value="review_readonly">{codingHandoffCopy.modeReviewOption}</option>
                    <option value="propose_diff">{codingHandoffCopy.modeDraftOption}</option>
                  </select>
                </label>
                <p style={styles.footnote}>{codingHandoffCopy.modeFootnote}</p>
                <label style={styles.check}>
                  <input
                    type="checkbox"
                    checked={cloudDisclosure}
                    onChange={(e) => setCloudDisclosure(e.target.checked)}
                  />
                  {codingHandoffCopy.disclosureCheckbox}
                </label>
                <label style={styles.check} title={codingHandoffCopy.settingsOpenLocalTerminalHint}>
                  <input
                    type="checkbox"
                    checked={configOpenLocalTerminal}
                    onChange={(e) => toggleOpenLocalTerminal(e.target.checked)}
                  />
                  {codingHandoffCopy.panelOpenLocalTerminal}
                </label>
                {(() => {
                  // Disable while starting OR any pending L2 confirm (avoid double ui_start)
                  const ctaDisabled =
                    starting ||
                    // Workspace missing: still enable CTA — doStart opens picker then auto-continues
                    pendingConfirm ||
                    !goal.trim() ||
                    !agentId ||
                    !cloudDisclosure
                  const missingPre =
                    pendingConfirm
                      ? "请先处理上方安全确认"
                      : !agentId
                        ? codingHandoffCopy.agentNotFoundBody
                        : !cloudDisclosure
                          ? codingHandoffCopy.disclosureBlocked
                          : !goal.trim()
                            ? "请填写任务目标"
                            : !effectiveWorkspace
                              ? codingHandoffCopy.workspaceMissingBody
                              : null
                  return (
                    <>
                      <button
                        type="button"
                        style={{
                          ...styles.primary,
                          ...(ctaDisabled ? styles.primaryDisabled : null),
                        }}
                        onClick={doStart}
                        disabled={ctaDisabled}
                      >
                        {starting
                          ? "启动中…"
                          : !(storeAcpEnabled || acpEnabled)
                            ? codingHandoffCopy.ctaEnableAndStart
                            : mode === "propose_diff"
                              ? codingHandoffCopy.ctaStartDraft
                              : codingHandoffCopy.ctaStartReview}
                      </button>
                      {ctaDisabled && missingPre && !starting ? (
                        <p style={styles.precondition}>{missingPre}</p>
                      ) : null}
                    </>
                  )
                })()}
                {!(storeAcpEnabled || acpEnabled) ? (
                  <p style={styles.footnote}>{codingHandoffCopy.discoveredNeedEnable}</p>
                ) : null}
              </>
            ) : null}

            <button
              type="button"
              style={styles.linkBtn}
              onClick={() => setShowCopyOnly((v) => !v)}
            >
              {showCopyOnly ? "收起备选" : codingHandoffCopy.ctaCopy}
            </button>
            {showCopyOnly ? (
              <>
                <p style={styles.footnote}>
                  没有本机 Agent、或只想粘贴到外部终端时，可复制任务包。主路径仍是上方「在本面板启动」。
                </p>
                <button type="button" style={styles.secondary} onClick={() => void doCopyPackage()}>
                  复制任务包 Markdown
                </button>
              </>
            ) : null}
          </div>
        ) : null}

        {/* Live session shell (main surface) */}
        {session ? (
          <div style={styles.session}>
            {modeCLikely ? (
              <div style={styles.modeCBanner} role="status">
                {session?.localTerminal === "failed"
                  ? "模式 C：本机终端未打开；侧栏监视仍在。停止仅结束侧栏桥。"
                  : session?.localTerminal === "opened_l0"
                    ? "模式 C：终端已开（L0 仅横幅，需手动粘贴命令）。" +
                      codingHandoffCopy.modeCDualProcessBanner
                    : session?.localTerminal === "pending"
                      ? "模式 C：正在打开本机终端…"
                      : codingHandoffCopy.modeCDualProcessBanner}
              </div>
            ) : null}
            <div style={styles.sessionHead}>
              <span>
                {session.displayName || session.agentId} ·{" "}
                {session.mode === "propose_diff"
                  ? codingHandoffCopy.modeBadgeDraft
                  : codingHandoffCopy.modeBadgeReview}
                {session.transport ? ` · ${session.transport}` : ""}
                {live ? ` · ${codingHandoffCopy.statusRunning}` : ` · ${codingHandoffCopy.statusDone}`}
              </span>
              <div style={styles.sessionBtns}>
                {live ? (
                  <button
                    type="button"
                    style={styles.dangerBtn}
                    onClick={onStop}
                    title={
                      modeCLikely
                        ? codingHandoffCopy.ctaStopMonitorTitle
                        : codingHandoffCopy.ctaStopSession
                    }
                  >
                    {modeCLikely
                      ? codingHandoffCopy.ctaStopMonitorSession
                      : codingHandoffCopy.ctaStopSession}
                  </button>
                ) : null}
                {!live && session.hasPendingDiff ? (
                  <button type="button" style={styles.secondary} onClick={onApply}>
                    {codingHandoffCopy.ctaApplyDiff}
                  </button>
                ) : null}
                {!live ? (
                  <button
                    type="button"
                    style={styles.linkBtn}
                    onClick={() => dispatch({ type: "CLEAR_CODING_SESSION" })}
                  >
                    清除会话
                  </button>
                ) : null}
              </div>
            </div>

            {session.error ? <div style={styles.err}>{session.error}</div> : null}

            {/* Transport honesty: CLI bridge ≠ embedded Claude TUI */}
            {session.transport === "cli" ? (
              <div style={styles.transportNote}>
                当前为 <strong>CLI 桥接</strong>
                （本机 Claude 未走 ACP JSON-RPC）。下方是 stdout
                文本流，不是终端里的完整 TUI；工具确认若在本机弹窗，请到 Claude
                进程/终端处理。
              </div>
            ) : session.transport === "acp" ? (
              <div style={styles.transportNoteOk}>ACP 协议会话 · 时间线为 session/update</div>
            ) : null}

            {/* Primary: live agent stdout / progress (last 200 lines of progress_tail) */}
            <div style={styles.liveLog} data-agent-live-log>
              <div style={styles.liveLogHead}>Agent 输出</div>
              {session.progressTail || session.handback ? (
                <pre style={styles.liveLogBody}>
                  {displayProgressTail(
                    (session.progressTail || session.handback || "").trim(),
                  ) || (live ? "等待 stdout…" : "（无输出）")}
                </pre>
              ) : (
                <div style={styles.empty}>
                  {live
                    ? "已启动，等待 Agent 写出内容…（无换行时可能整段结束后才出现）"
                    : "暂无输出"}
                </div>
              )}
            </div>

            {/* Secondary: status / tool steps (chronological, not reverse-only status noise) */}
            <div style={styles.timeline}>
              <div style={styles.liveLogHead}>步骤</div>
              {timeline.length === 0 ? (
                <div style={styles.empty}>{live ? "…" : "暂无步骤"}</div>
              ) : (
                timeline.map((row, idx) => (
                  <div
                    key={row.id || `${row.kind}-${idx}-${row.label}`}
                    style={{
                      ...styles.tlRow,
                      ...(row.kind === "agent_message" ? styles.tlRowMsg : null),
                    }}
                  >
                    <span style={styles.tlKind}>{kindIcon(row.kind)}</span>
                    <div style={styles.tlBody}>
                      <div style={styles.tlLabel}>
                        {row.kind === "agent_message"
                          ? row.detail || row.label
                          : row.label}
                      </div>
                      {row.path ? <div style={styles.tlPath}>{row.path}</div> : null}
                      {row.kind !== "agent_message" &&
                      row.detail &&
                      row.detail !== row.label ? (
                        <div style={styles.tlDetail}>{row.detail}</div>
                      ) : null}
                    </div>
                    {row.status ? <span style={styles.tlSt}>{row.status}</span> : null}
                  </div>
                ))
              )}
            </div>

            <div style={styles.composerCol}>
              {composerDisabled ? (
                <div style={styles.composerDisabledNote} role="status">
                  {codingHandoffCopy.cliComposerDisabled}
                </div>
              ) : null}
              <div style={styles.composer}>
                <input
                  style={{
                    ...styles.input,
                    ...(composerDisabled ? styles.inputDisabled : null),
                  }}
                  value={input}
                  placeholder={
                    composerDisabled
                      ? codingHandoffCopy.cliComposerPlaceholder
                      : codingHandoffCopy.acpComposerPlaceholder
                  }
                  disabled={composerDisabled}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (composerDisabled) return
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault()
                      onSend()
                    }
                  }}
                />
                <button
                  type="button"
                  style={{
                    ...styles.primary,
                    ...(composerDisabled || !input.trim() ? styles.primaryDisabled : null),
                  }}
                  onClick={onSend}
                  disabled={composerDisabled || !input.trim()}
                  title={
                    composerDisabled ? codingHandoffCopy.cliComposerDisabled : undefined
                  }
                >
                  发送
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div style={styles.placeholder}>
            <div style={styles.placeholderTitle}>会话区</div>
            <div style={styles.placeholderBody}>
              启动本机 Agent 后，这里会显示流式输出、工具步骤与 diff，并可继续对话。需要完整
              TUI/权限时，可在设置开启模式 C 本机终端（与侧栏监视为双进程）。
            </div>
          </div>
        )}

        {status ? <div style={styles.status}>{status}</div> : null}
        {!status && externalStatus ? (
          <div style={styles.status}>{externalStatus}</div>
        ) : null}
      </div>
    </div>
  )
}

function kindIcon(kind?: string): string {
  switch (kind) {
    case "tool":
      return "🔧"
    case "plan":
      return "📋"
    case "diff":
      return "📝"
    case "user_message":
      return "→"
    case "permission":
      return "🔐"
    case "error":
      return "!"
    case "agent_message":
      return "◆"
    default:
      return "·"
  }
}

const styles: Record<string, CSSProperties> = {
  overlay: {
    position: "absolute",
    // Leave StatusRail (~40px) visible so connection / settings still reachable
    top: 40,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 40,
    display: "flex",
    flexDirection: "column",
    background: tokens.bg || "#f8fafc",
  },
  panel: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    padding: 10,
    gap: 8,
  },
  confirmHost: {
    border: `1px solid ${tokens.border || "#fecaca"}`,
    borderRadius: 8,
    padding: 8,
    background: tokens.dangerSurface || "#fef2f2",
    flexShrink: 0,
  },
  confirmHint: {
    fontSize: 11,
    fontWeight: 600,
    color: tokens.text || "#7f1d1d",
    marginBottom: 6,
  },
  header: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 8,
  },
  title: {
    fontSize: 16,
    fontWeight: 700,
    color: tokens.text || "#0f172a",
  },
  sub: {
    fontSize: 11,
    color: tokens.textSecondary || "#64748b",
    marginTop: 2,
    lineHeight: 1.35,
  },
  iconBtn: {
    border: "none",
    background: "transparent",
    fontSize: 22,
    lineHeight: 1,
    cursor: "pointer",
    color: tokens.textSecondary || "#64748b",
    padding: "0 4px",
  },
  contextBar: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    padding: 8,
    borderRadius: 8,
    border: `1px solid ${tokens.border || "#e2e8f0"}`,
    background: tokens.bgElevated || "#fff",
  },
  ctxItem: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12,
    flexWrap: "wrap",
  },
  ctxLabel: {
    fontSize: 10,
    color: tokens.textMuted || "#94a3b8",
    textTransform: "uppercase" as const,
    letterSpacing: 0.4,
  },
  ctxVal: {
    fontWeight: 600,
    color: tokens.text || "#0f172a",
    fontFamily: tokens.fontMono || "ui-monospace, monospace",
    fontSize: 11,
  },
  ctxWarn: { color: tokens.danger || "#b91c1c", fontWeight: 600, fontSize: 12 },
  ctxMuted: {
    color: tokens.textSecondary || "#64748b",
    fontSize: 11,
    overflow: "hidden",
    textOverflow: "ellipsis",
    maxWidth: 180,
    whiteSpace: "nowrap",
  },
  linkBtn: {
    border: "none",
    background: "transparent",
    color: tokens.accent || "#4f46e5",
    fontSize: 11,
    cursor: "pointer",
    padding: 0,
  },
  setup: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    flexShrink: 0,
  },
  banner: {
    fontSize: 12,
    padding: 8,
    borderRadius: 8,
    background: tokens.accentSoft || "#eef2ff",
    color: tokens.accentText || "#3730a3",
    lineHeight: 1.4,
  },
  modeCBanner: {
    fontSize: 11,
    padding: "8px 10px",
    borderRadius: 8,
    border: `1px solid ${tokens.border || "#fcd34d"}`,
    background: "#fffbeb",
    color: "#92400e",
    lineHeight: 1.4,
    flexShrink: 0,
    position: "sticky" as const,
    top: 0,
    zIndex: 1,
  },
  bannerHint: { fontSize: 11, marginTop: 4, opacity: 0.9 },
  field: { display: "flex", flexDirection: "column", gap: 4 },
  fieldLabel: { fontSize: 11, fontWeight: 600, color: tokens.textSecondary || "#64748b" },
  textarea: {
    fontSize: 13,
    padding: 8,
    borderRadius: 8,
    border: `1px solid ${tokens.border || "#e2e8f0"}`,
    resize: "vertical" as const,
    fontFamily: "inherit",
  },
  select: {
    fontSize: 13,
    padding: "6px 8px",
    borderRadius: 8,
    border: `1px solid ${tokens.border || "#e2e8f0"}`,
  },
  footnote: {
    fontSize: 11,
    color: tokens.textSecondary || "#64748b",
    margin: 0,
    lineHeight: 1.4,
  },
  footnoteInline: {
    fontSize: 11,
    color: tokens.textSecondary || "#64748b",
    fontWeight: 400,
  },
  check: {
    display: "flex",
    gap: 8,
    alignItems: "flex-start",
    fontSize: 12,
    color: tokens.text || "#0f172a",
  },
  composerCol: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    padding: "0 0 0 0",
    borderTop: `1px solid ${tokens.border || "#e2e8f0"}`,
    flexShrink: 0,
  },
  composerDisabledNote: {
    fontSize: 11,
    lineHeight: 1.35,
    color: "#9a3412",
    background: "#fff7ed",
    borderRadius: 6,
    padding: "6px 8px",
    margin: "8px 8px 0",
  },
  inputDisabled: {
    opacity: 0.55,
    cursor: "not-allowed",
    background: tokens.bg || "#f1f5f9",
  },
  primary: {
    fontSize: 13,
    fontWeight: 600,
    padding: "8px 12px",
    borderRadius: 8,
    border: "none",
    background: tokens.accent || "#4f46e5",
    color: "#fff",
    cursor: "pointer",
  },
  primaryDisabled: {
    opacity: 0.45,
    cursor: "not-allowed",
  },
  precondition: {
    fontSize: 11,
    color: tokens.danger || "#b91c1c",
    margin: 0,
    lineHeight: 1.35,
  },
  secondary: {
    fontSize: 12,
    padding: "6px 10px",
    borderRadius: 8,
    border: `1px solid ${tokens.border || "#e2e8f0"}`,
    background: tokens.bgElevated || "#fff",
    cursor: "pointer",
  },
  dangerBtn: {
    fontSize: 11,
    padding: "4px 8px",
    borderRadius: 6,
    border: `1px solid ${tokens.danger || "#b91c1c"}`,
    background: "#fef2f2",
    color: tokens.danger || "#b91c1c",
    cursor: "pointer",
  },
  session: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    border: `1px solid ${tokens.border || "#e2e8f0"}`,
    borderRadius: 10,
    background: tokens.bgElevated || "#fff",
    overflow: "hidden",
  },
  sessionHead: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 6,
    padding: "8px 10px",
    borderBottom: `1px solid ${tokens.border || "#e2e8f0"}`,
    fontSize: 12,
    fontWeight: 600,
  },
  sessionBtns: { display: "flex", gap: 4, flexWrap: "wrap" },
  transportNote: {
    fontSize: 11,
    lineHeight: 1.4,
    padding: "6px 10px",
    background: "#fff7ed",
    color: "#9a3412",
    borderBottom: `1px solid ${tokens.border || "#fed7aa"}`,
  },
  transportNoteOk: {
    fontSize: 11,
    lineHeight: 1.4,
    padding: "6px 10px",
    background: "#f0fdf4",
    color: "#166534",
    borderBottom: `1px solid ${tokens.border || "#bbf7d0"}`,
  },
  liveLog: {
    flex: 2,
    minHeight: 100,
    maxHeight: "45%",
    display: "flex",
    flexDirection: "column",
    borderBottom: `1px solid ${tokens.border || "#e2e8f0"}`,
    background: "#0f172a",
    color: "#e2e8f0",
  },
  liveLogHead: {
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: 0.3,
    padding: "4px 8px",
    color: tokens.textMuted || "#94a3b8",
    textTransform: "uppercase" as const,
  },
  liveLogBody: {
    flex: 1,
    margin: 0,
    padding: "6px 8px 10px",
    overflow: "auto",
    fontSize: 11,
    lineHeight: 1.45,
    fontFamily: tokens.fontMono || "ui-monospace, Menlo, monospace",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  },
  timeline: {
    flex: 1,
    overflow: "auto",
    padding: 8,
    display: "flex",
    flexDirection: "column",
    gap: 6,
    minHeight: 72,
  },
  empty: { fontSize: 12, color: tokens.textSecondary || "#64748b", padding: 8 },
  tail: {
    marginTop: 6,
    fontSize: 10,
    fontFamily: tokens.fontMono || "ui-monospace, monospace",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  },
  tlRow: { display: "flex", gap: 6, alignItems: "flex-start", fontSize: 12 },
  tlRowMsg: {
    background: tokens.bg || "#f8fafc",
    borderRadius: 6,
    padding: "4px 6px",
  },
  tlKind: { width: 16, flexShrink: 0, textAlign: "center" },
  tlBody: { flex: 1, minWidth: 0 },
  tlLabel: {
    color: tokens.text || "#0f172a",
    lineHeight: 1.35,
    wordBreak: "break-word",
  },
  tlDetail: {
    fontSize: 11,
    color: tokens.textSecondary || "#64748b",
    marginTop: 2,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  },
  tlPath: {
    fontSize: 10,
    color: tokens.textSecondary || "#64748b",
    fontFamily: tokens.fontMono || "ui-monospace, monospace",
  },
  tlSt: { fontSize: 10, color: tokens.textMuted || "#94a3b8", flexShrink: 0 },
  composer: {
    display: "flex",
    gap: 6,
    padding: 8,
  },
  input: {
    flex: 1,
    fontSize: 13,
    padding: "8px 10px",
    borderRadius: 8,
    border: `1px solid ${tokens.border || "#e2e8f0"}`,
    minWidth: 0,
  },
  placeholder: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    alignItems: "center",
    padding: 16,
    border: `1px dashed ${tokens.border || "#e2e8f0"}`,
    borderRadius: 10,
    minHeight: 140,
    textAlign: "center",
  },
  placeholderTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: tokens.textSecondary || "#64748b",
    marginBottom: 6,
  },
  placeholderBody: {
    fontSize: 12,
    color: tokens.textMuted || "#94a3b8",
    lineHeight: 1.45,
    maxWidth: 280,
  },
  status: {
    fontSize: 11,
    color: tokens.accentText || "#3730a3",
    padding: "4px 0",
  },
  err: {
    fontSize: 11,
    color: tokens.danger || "#b91c1c",
    padding: "4px 10px",
  },
}

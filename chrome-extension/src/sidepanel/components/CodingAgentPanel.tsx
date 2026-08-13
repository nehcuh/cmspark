// Full-height Coding Agent Panel — browser-side shell for local coding agents
// (Zed Agent Panel analogue for 320px). Primary UX for /code; not a task-package modal.

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react"
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
}: Props) {
  const { state, dispatch } = useAgentStore()
  const session = state.codingSession

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

  useEffect(() => {
    if (!open) return
    setGoal(
      seedGoal?.trim() ||
        messages
          .filter((m) => m.role === "user" && m.content)
          .slice(-1)[0]
          ?.content?.slice(0, 500) ||
        "",
    )
    setStatus("")
    setCloudDisclosure(false)
    setInput("")
    chrome.runtime.sendMessage({ type: "acp.list" }, () => {
      void chrome.runtime.lastError
    })
  }, [open, seedGoal, messages])

  useEffect(() => {
    if (readyAgents.length && !readyAgents.some((a) => a.id === agentId)) {
      setAgentId(readyAgents[0].id)
    }
  }, [readyAgents, agentId])

  const flash = (msg: string, ms = 3500) => {
    setStatus(msg)
    window.setTimeout(() => setStatus(""), ms)
  }

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

  const doStart = useCallback(() => {
    if (!threadId) {
      flash("请先选择对话")
      return
    }
    if (!workspaceRoot) {
      flash(codingHandoffCopy.workspaceMissingBody)
      pickWorkspace()
      return
    }
    if (!acpEnabled) {
      flash(codingHandoffCopy.acpDisabled)
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
    flash("请求确认启动…")
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
        workspace_root: workspaceRoot,
        mode,
        cloud_disclosure_accepted: true,
        page_context,
        page_url: pageUrl || undefined,
        page_title: pageTitle || undefined,
        repo_hint: repoHint ? `${repoHint.owner}/${repoHint.name}` : undefined,
      },
      () => {
        void chrome.runtime.lastError
      },
    )
  }, [
    threadId,
    workspaceRoot,
    acpEnabled,
    agentId,
    cloudDisclosure,
    goal,
    mode,
    pageUrl,
    pageTitle,
    repoHint,
    pickWorkspace,
  ])

  const doCopyPackage = useCallback(async () => {
    const pkg = buildCodingTaskPackage({
      goal: goal.trim() || "（未填目标）",
      workspaceRoot,
      pageUrl,
      pageTitle,
      dialogSummary: dialogDefault,
      includeDialog: true,
      includeUrl: true,
      includePageExcerpt: false,
    })
    const ok = await copyTextToClipboard(pkg.markdown)
    flash(ok ? codingHandoffCopy.copiedOk : codingHandoffCopy.clipboardFailed)
  }, [goal, workspaceRoot, pageUrl, pageTitle, dialogDefault])

  const onSend = () => {
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

  const wsBase = workspaceRoot
    ? workspaceRoot.split(/[/\\]/).filter(Boolean).pop()
    : null

  return (
    <div style={styles.overlay} role="dialog" aria-label="编程 Agent 面板">
      <div style={styles.panel}>
        {/* Header */}
        <div style={styles.header}>
          <div>
            <div style={styles.title}>编程 Agent</div>
            <div style={styles.sub}>
              本机助手壳 · 输入/查看/设置都在这里 · 不必切终端
            </div>
          </div>
          <button type="button" style={styles.iconBtn} onClick={onClose} aria-label="关闭">
            ×
          </button>
        </div>

        {/* Context strip */}
        <div style={styles.contextBar}>
          <div style={styles.ctxItem}>
            <span style={styles.ctxLabel}>工作区</span>
            {wsBase ? (
              <span style={styles.ctxVal} title={workspaceRoot || ""}>
                📁 {wsBase}
              </span>
            ) : (
              <span style={styles.ctxWarn}>未绑定</span>
            )}
            <button type="button" style={styles.linkBtn} onClick={pickWorkspace}>
              {wsBase ? "更换" : "选择…"}
            </button>
          </div>
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

        {/* Setup (when no live session) */}
        {!live ? (
          <div style={styles.setup}>
            {!acpEnabled ? (
              <div style={styles.banner}>
                {codingHandoffCopy.acpDisabled}
                <div style={styles.bannerHint}>
                  {readyAgents.length > 0
                    ? codingHandoffCopy.discoveredNeedEnable
                    : "设置 → 编程助手 → 启用 ACP。未启用时仍可复制任务包到终端。"}
                </div>
                {readyAgents.length > 0 ? (
                  <div style={styles.bannerHint}>
                    {codingHandoffCopy.discoveredTitle}：
                    {readyAgents.map((a) => a.display_name).join(" · ")}
                  </div>
                ) : null}
              </div>
            ) : null}

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

            {acpEnabled && readyAgents.length > 0 ? (
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
                        {a.source === "discovered" ? "（已检测）" : ""}
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
                <button
                  type="button"
                  style={styles.primary}
                  onClick={doStart}
                  disabled={!goal.trim() || !agentId || !cloudDisclosure || !workspaceRoot}
                >
                  {mode === "propose_diff"
                    ? codingHandoffCopy.ctaStartDraft
                    : codingHandoffCopy.ctaStartReview}
                </button>
              </>
            ) : acpEnabled ? (
              <div style={styles.banner}>{codingHandoffCopy.agentNotFoundBody}</div>
            ) : null}

            <button type="button" style={styles.secondary} onClick={() => void doCopyPackage()}>
              {codingHandoffCopy.ctaCopy}
            </button>
            <button
              type="button"
              style={styles.linkBtn}
              onClick={() => setShowCopyOnly((v) => !v)}
            >
              {showCopyOnly ? "收起说明" : "为何是「壳」不是侧栏 IDE？"}
            </button>
            {showCopyOnly ? (
              <p style={styles.footnote}>
                底层能力是本机编程 Agent（配置与模型在本机）。本面板负责输入、时间线、确认与停
                止——类似 Zed 的 Agent Panel，不是把 Cursor 塞进 320px。
              </p>
            ) : null}
          </div>
        ) : null}

        {/* Live session shell (main surface) */}
        {session ? (
          <div style={styles.session}>
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
                  <button type="button" style={styles.dangerBtn} onClick={onStop}>
                    {codingHandoffCopy.ctaStopSession}
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

            <div style={styles.timeline}>
              {timeline.length === 0 ? (
                <div style={styles.empty}>
                  {live ? "等待 Agent 输出…" : "暂无时间线"}
                  {session.progressTail ? (
                    <pre style={styles.tail}>{session.progressTail}</pre>
                  ) : null}
                </div>
              ) : (
                timeline
                  .slice()
                  .reverse()
                  .map((row) => (
                    <div key={row.id || row.label} style={styles.tlRow}>
                      <span style={styles.tlKind}>{kindIcon(row.kind)}</span>
                      <div style={styles.tlBody}>
                        <div style={styles.tlLabel}>{row.label}</div>
                        {row.path ? <div style={styles.tlPath}>{row.path}</div> : null}
                      </div>
                      {row.status ? <span style={styles.tlSt}>{row.status}</span> : null}
                    </div>
                  ))
              )}
            </div>

            <div style={styles.composer}>
              <input
                style={styles.input}
                value={input}
                placeholder="继续对编程 Agent 说…（留在侧栏）"
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault()
                    onSend()
                  }
                }}
              />
              <button
                type="button"
                style={styles.primary}
                onClick={onSend}
                disabled={!input.trim()}
              >
                发送
              </button>
            </div>
          </div>
        ) : (
          <div style={styles.placeholder}>
            <div style={styles.placeholderTitle}>会话区</div>
            <div style={styles.placeholderBody}>
              启动本机 Agent 后，这里会显示流式输出、工具步骤与 diff，并可继续对话——无需打开终端
              TUI。
            </div>
          </div>
        )}

        {status ? <div style={styles.status}>{status}</div> : null}
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
  check: {
    display: "flex",
    gap: 8,
    alignItems: "flex-start",
    fontSize: 12,
    color: tokens.text || "#0f172a",
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
  timeline: {
    flex: 1,
    overflow: "auto",
    padding: 8,
    display: "flex",
    flexDirection: "column",
    gap: 6,
    minHeight: 120,
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
  tlKind: { width: 16, flexShrink: 0, textAlign: "center" },
  tlBody: { flex: 1, minWidth: 0 },
  tlLabel: {
    color: tokens.text || "#0f172a",
    lineHeight: 1.35,
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
    borderTop: `1px solid ${tokens.border || "#e2e8f0"}`,
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

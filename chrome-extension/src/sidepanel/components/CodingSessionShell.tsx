// Coding Session Shell — browser-side ACP Client surface (Zed-like, 320px).
// User stays here for input / timeline / stop — no forced terminal switch.

import { useState, type CSSProperties } from "react"
import { tokens } from "../ui/tokens"
import { codingHandoffCopy } from "../coding-handoff/copy"
import type { CodingSessionState } from "../store/agentStore"
import { useAgentStore } from "../store/agentStore"

export type TimelineRow = {
  id?: string
  kind?: string
  label?: string
  detail?: string
  path?: string
  status?: string
  at?: string
}

export function CodingSessionShell({
  session,
  onClose,
}: {
  session: CodingSessionState
  onClose?: () => void
}) {
  const { dispatch } = useAgentStore()
  const [text, setText] = useState("")
  const live = session.state === "running" || session.state === "offered"
  const modeBadge =
    session.mode === "propose_diff"
      ? codingHandoffCopy.modeBadgeDraft
      : codingHandoffCopy.modeBadgeReview
  const timeline = (session.timeline || []) as TimelineRow[]
  // Same Mode C honesty as Chip/Panel (exclude failed — bridge is sole process)
  const modeCMonitorStop =
    session.localTerminal === "opened" ||
    session.localTerminal === "opened_l0" ||
    session.localTerminal === "pending" ||
    (session.openLocalTerminal === true &&
      session.localTerminal !== "failed" &&
      session.localTerminal !== "skipped")

  const onStop = () => {
    chrome.runtime.sendMessage(
      { type: "acp.session.cancel", session_id: session.sessionId },
      () => {
        void chrome.runtime.lastError
      },
    )
  }

  /** CLI bridge is one-shot; multi-turn only on ACP transport. */
  const isCliTransport = session.transport === "cli"
  const composerDisabled = isCliTransport

  const onSend = () => {
    if (composerDisabled) return
    const t = text.trim()
    if (!t) return
    chrome.runtime.sendMessage(
      {
        type: "acp.session.prompt",
        session_id: session.sessionId,
        text: t,
      },
      () => {
        void chrome.runtime.lastError
      },
    )
    setText("")
  }

  const onApply = () => {
    chrome.runtime.sendMessage(
      { type: "acp.apply_diff", session_id: session.sessionId },
      () => {
        void chrome.runtime.lastError
      },
    )
  }

  const dismiss = () => {
    dispatch({ type: "CLEAR_CODING_SESSION" })
    onClose?.()
  }

  return (
    <div style={styles.root} role="region" aria-label="编程会话壳">
      <div style={styles.header}>
        <div style={styles.title}>
          {codingHandoffCopy.offerTitle} · {session.displayName || session.agentId} · {modeBadge}
        </div>
        <div style={styles.meta}>
          {live ? codingHandoffCopy.statusRunning : codingHandoffCopy.statusDone}
          {session.transport ? ` · ${session.transport}` : ""}
          {session.workspaceRoot
            ? ` · ${session.workspaceRoot.split(/[/\\]/).filter(Boolean).pop()}`
            : ""}
        </div>
        <div style={styles.headerBtns}>
          {live ? (
            <button
              type="button"
              style={styles.btn}
              onClick={onStop}
              title={
                modeCMonitorStop
                  ? codingHandoffCopy.ctaStopMonitorTitle
                  : codingHandoffCopy.ctaStopSession
              }
            >
              {modeCMonitorStop
                ? codingHandoffCopy.ctaStopMonitorSession
                : codingHandoffCopy.ctaStopSession}
            </button>
          ) : null}
          {!live && session.hasPendingDiff ? (
            <button type="button" style={styles.btn} onClick={onApply}>
              {codingHandoffCopy.ctaApplyDiff}
            </button>
          ) : null}
          <button type="button" style={styles.btnGhost} onClick={dismiss}>
            {codingHandoffCopy.ctaClose}
          </button>
        </div>
      </div>

      {session.error ? <div style={styles.err}>{session.error}</div> : null}

      <div style={styles.timeline}>
        {timeline.length === 0 ? (
          <div style={styles.empty}>
            {live ? "等待编程助手输出…" : "暂无时间线"}
            {session.progressTail ? (
              <div style={styles.tail}>{session.progressTail}</div>
            ) : null}
          </div>
        ) : (
          timeline
            .slice()
            .reverse()
            .slice(0, 40)
            .map((row) => (
              <div key={row.id || `${row.at}-${row.label}`} style={styles.row}>
                <span style={styles.kind}>{kindIcon(row.kind)}</span>
                <div style={styles.rowBody}>
                  <div style={styles.rowLabel}>{row.label}</div>
                  {row.path ? <div style={styles.path}>{row.path}</div> : null}
                </div>
                {row.status ? <span style={styles.st}>{row.status}</span> : null}
              </div>
            ))
        )}
      </div>

      <div style={styles.inputCol}>
        {composerDisabled ? (
          <div style={styles.cliNote} role="status">
            {codingHandoffCopy.cliComposerDisabled}
          </div>
        ) : null}
        <div style={styles.inputRow}>
          <input
            style={{
              ...styles.input,
              ...(composerDisabled ? { opacity: 0.55, cursor: "not-allowed" } : null),
            }}
            value={text}
            disabled={composerDisabled}
            placeholder={
              composerDisabled
                ? codingHandoffCopy.cliComposerPlaceholder
                : live
                  ? "继续对编程助手说…（侧栏监视；模式 C 时终端需自行退出）"
                  : "会话已结束 — 输入将开启新一轮（需确认）"
            }
            onChange={(e) => setText(e.target.value)}
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
            style={styles.send}
            onClick={onSend}
            disabled={composerDisabled || !text.trim()}
            title={composerDisabled ? codingHandoffCopy.cliComposerDisabled : undefined}
          >
            发送
          </button>
        </div>
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
  root: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    border: `1px solid ${tokens.border || "#e5e7eb"}`,
    borderRadius: tokens.radiusMd || 10,
    background: tokens.bgElevated || "#fff",
    padding: 8,
    maxHeight: 360,
    minHeight: 180,
  },
  header: { display: "flex", flexDirection: "column", gap: 2 },
  title: {
    fontSize: 13,
    fontWeight: 600,
    color: tokens.text || "#111",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  meta: { fontSize: 11, color: tokens.textSecondary || "#666" },
  headerBtns: { display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 },
  btn: {
    fontSize: 11,
    padding: "3px 8px",
    borderRadius: 6,
    border: `1px solid ${tokens.border || "#ddd"}`,
    background: tokens.bg || "#fafafa",
    cursor: "pointer",
  },
  btnGhost: {
    fontSize: 11,
    padding: "3px 8px",
    borderRadius: 6,
    border: "none",
    background: "transparent",
    color: tokens.textSecondary || "#666",
    cursor: "pointer",
  },
  err: { fontSize: 11, color: tokens.danger || "#b91c1c" },
  timeline: {
    flex: 1,
    overflow: "auto",
    display: "flex",
    flexDirection: "column",
    gap: 4,
    minHeight: 80,
    maxHeight: 200,
    borderTop: `1px solid ${tokens.border || "#eee"}`,
    borderBottom: `1px solid ${tokens.border || "#eee"}`,
    padding: "6px 0",
  },
  empty: { fontSize: 11, color: tokens.textSecondary || "#888", padding: 4 },
  cliNote: {
    width: "100%",
    fontSize: 11,
    lineHeight: 1.35,
    color: "#9a3412",
    background: "#fff7ed",
    borderRadius: 6,
    padding: "6px 8px",
    marginBottom: 4,
  },
  tail: {
    marginTop: 4,
    fontFamily: tokens.fontMono || "ui-monospace, monospace",
    fontSize: 10,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  },
  row: {
    display: "flex",
    gap: 6,
    alignItems: "flex-start",
    fontSize: 11,
  },
  kind: { width: 14, flexShrink: 0, textAlign: "center" },
  rowBody: { flex: 1, minWidth: 0 },
  rowLabel: {
    color: tokens.text || "#111",
    overflow: "hidden",
    textOverflow: "ellipsis",
    display: "-webkit-box",
    WebkitLineClamp: 3,
    WebkitBoxOrient: "vertical",
  } as CSSProperties,
  path: {
    fontSize: 10,
    color: tokens.textSecondary || "#888",
    fontFamily: tokens.fontMono || "ui-monospace, monospace",
  },
  st: { fontSize: 10, color: tokens.textSecondary || "#999", flexShrink: 0 },
  inputCol: { display: "flex", flexDirection: "column", gap: 4 },
  inputRow: { display: "flex", gap: 4 },
  input: {
    flex: 1,
    fontSize: 12,
    padding: "6px 8px",
    borderRadius: 6,
    border: `1px solid ${tokens.border || "#ddd"}`,
    minWidth: 0,
  },
  send: {
    fontSize: 12,
    padding: "6px 10px",
    borderRadius: 6,
    border: "none",
    background: tokens.accent || "#4f46e5",
    color: "#fff",
    cursor: "pointer",
    flexShrink: 0,
  },
}

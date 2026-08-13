// FocusBand chip for live ACP coding handoff — stop ≠ 急停 (CU).

import { useEffect, type CSSProperties } from "react"
import { tokens } from "../ui/tokens"
import { codingHandoffCopy } from "../coding-handoff/copy"
import type { CodingSessionState } from "../store/agentStore"
import { useAgentStore } from "../store/agentStore"

export function CodingSessionChip({
  session,
  compact = false,
}: {
  session: CodingSessionState
  compact?: boolean
}) {
  const { dispatch } = useAgentStore()
  const live = session.state === "running" || session.state === "offered"

  useEffect(() => {
    if (session.state !== "closed") return
    const t = window.setTimeout(() => {
      dispatch({ type: "CLEAR_CODING_SESSION" })
    }, 6000)
    return () => window.clearTimeout(t)
  }, [session.state, session.sessionId, dispatch])
  const label = session.displayName || session.agentId || "Agent"
  const tail = (session.progressTail || "").replace(/\s+/g, " ").trim().slice(0, 80)

  const onStop = () => {
    chrome.runtime.sendMessage(
      { type: "acp.session.cancel", session_id: session.sessionId },
      () => {
        void chrome.runtime.lastError
      },
    )
  }

  const onFollowup = () => {
    const goal = window.prompt("继续追问编程助手（将开新一轮并确认）")
    if (!goal?.trim()) return
    chrome.runtime.sendMessage(
      {
        type: "acp.session.followup",
        session_id: session.sessionId,
        goal: goal.trim(),
      },
      () => {
        void chrome.runtime.lastError
      },
    )
  }

  const onApply = () => {
    chrome.runtime.sendMessage(
      { type: "acp.apply_diff", session_id: session.sessionId },
      () => {
        void chrome.runtime.lastError
      },
    )
  }

  return (
    <div style={{ ...styles.row, ...(compact ? styles.compact : {}) }} role="status" aria-label="编程助手会话">
      <div style={styles.meta}>
        <span style={styles.dot} data-live={live ? "1" : "0"} />
        <span style={styles.title}>
          {codingHandoffCopy.offerTitle} · {label}
          {live ? " · 运行中" : session.state === "closed" ? " · 完成" : ` · ${session.state}`}
        </span>
      </div>
      {!compact && tail ? <div style={styles.tail}>{tail}</div> : null}
      {session.error ? <div style={styles.err}>{session.error}</div> : null}
      <div style={styles.btns}>
        {live ? (
          <button type="button" style={styles.stop} onClick={onStop}>
            {codingHandoffCopy.ctaStopSession}
          </button>
        ) : null}
        {!live && session.state === "closed" ? (
          <button type="button" style={styles.stop} onClick={onFollowup}>
            追问
          </button>
        ) : null}
        {!live && session.hasPendingDiff ? (
          <button type="button" style={styles.stop} onClick={onApply}>
            应用 diff
          </button>
        ) : null}
      </div>
    </div>
  )
}

const styles: Record<string, CSSProperties> = {
  row: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    width: "100%",
    minWidth: 0,
  },
  meta: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12,
    fontWeight: 500,
    color: tokens.text || "#111",
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 999,
    background: tokens.success || "#16a34a",
    flexShrink: 0,
  },
  title: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  tail: {
    fontSize: 11,
    color: tokens.textSecondary || "#666",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontFamily: tokens.fontMono || "ui-monospace, monospace",
  },
  err: {
    fontSize: 11,
    color: tokens.danger || "#b91c1c",
  },
  stop: {
    alignSelf: "flex-start",
    marginTop: 2,
    fontSize: 11,
    padding: "3px 8px",
    borderRadius: tokens.radiusSm || 6,
    border: `1px solid ${tokens.border || "#ddd"}`,
    background: tokens.bgElevated || "#fff",
    color: tokens.text || "#111",
    cursor: "pointer",
  },
  btns: { display: "flex", flexWrap: "wrap", gap: 4 },
  compact: { gap: 2 },
}

// FocusBand chip for live ACP coding handoff — stop ≠ 急停 (CU).

import { useEffect, type CSSProperties } from "react"
import { tokens } from "../ui/tokens"
import { codingHandoffCopy } from "../coding-handoff/copy"
import { isModeCInvolved, modeCBannerText, modeCStopLabel, modeCStopTitle } from "../coding-handoff/embed-entry"
import type { CodingSessionState } from "../store/agentStore"
import { useAgentStore, codingSessionBelongsToThread } from "../store/agentStore"

export function CodingSessionChip({
  session,
  compact = false,
}: {
  session: CodingSessionState
  compact?: boolean
}) {
  const { state, dispatch } = useAgentStore()
  const live = session.state === "running" || session.state === "offered"

  useEffect(() => {
    if (session.state !== "closed") return
    // Do not auto-dismiss while applyable diffs remain (UX: 应用 diff must stay reachable)
    if (session.hasPendingDiff) return
    const t = window.setTimeout(() => {
      dispatch({ type: "CLEAR_CODING_SESSION", sessionId: session.sessionId })
    }, 12_000)
    return () => window.clearTimeout(t)
  }, [session.state, session.sessionId, session.hasPendingDiff, dispatch])
  const label = session.displayName || session.agentId || "Agent"
  const modeBadge =
    session.mode === "propose_diff"
      ? codingHandoffCopy.modeBadgeDraft
      : codingHandoffCopy.modeBadgeReview
  const tail = (session.progressTail || "").replace(/\s+/g, " ").trim().slice(0, 80)
  // Authoritative Mode C: only when a host terminal is/was actually involved.
  // Exclude `failed` — then the bridge is the only process (Stop = 停止编程会话).
  // #502 C: `embed_intent` means an intent was recorded and NOTHING was opened, so it raises the
  // hint but must not claim a monitorable outer agent. #506: `embed_running` means the embedded
  // PTY is live and survives Stop — the Stop label/title ladder (modeCStopLabel/modeCStopTitle)
  // owns that override. Both ladders live in coding-handoff/embed-entry.
  const modeCHint = isModeCInvolved(session.localTerminal, session.openLocalTerminal)

  const onStop = () => {
    if (!codingSessionBelongsToThread(session, state.activeThreadId)) return
    chrome.runtime.sendMessage(
      { type: "acp.session.cancel", session_id: session.sessionId, thread_id: session.threadId },
      () => {
        void chrome.runtime.lastError
      },
    )
  }

  const onFollowup = () => {
    if (!codingSessionBelongsToThread(session, state.activeThreadId)) return
    const goal = window.prompt("继续追问编程助手（将开新一轮并确认）")
    if (!goal?.trim()) return
    chrome.runtime.sendMessage(
      {
        type: "acp.session.followup",
        session_id: session.sessionId, thread_id: session.threadId,
        goal: goal.trim(),
        mode: session.mode === "propose_diff" ? "propose_diff" : "review_readonly",
      },
      () => {
        void chrome.runtime.lastError
      },
    )
  }

  const onApply = () => {
    if (!codingSessionBelongsToThread(session, state.activeThreadId)) return
    chrome.runtime.sendMessage(
      { type: "acp.apply_diff", session_id: session.sessionId, thread_id: session.threadId },
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
          {codingHandoffCopy.productName} · {label} · {modeBadge}
          {session.transport ? ` · ${session.transport}` : ""}
          {live
            ? ` · ${codingHandoffCopy.statusRunning}`
            : session.state === "closed"
              ? ` · ${codingHandoffCopy.statusDone}`
              : ` · ${session.state}`}
        </span>
      </div>
      {!compact && tail ? <div style={styles.tail}>{tail}</div> : null}
      {session.error ? <div style={styles.err}>{session.error}</div> : null}
      {live && modeCHint ? (
        <div style={styles.modeCHint}>{modeCBannerText(session.localTerminal)}</div>
      ) : null}
      <div style={styles.btns}>
        {live ? (
          <button
            type="button"
            style={styles.stop}
            onClick={onStop}
            title={modeCStopTitle(session.localTerminal, session.openLocalTerminal)}
          >
            {modeCStopLabel(session.localTerminal, session.openLocalTerminal)}
          </button>
        ) : null}
        {!live && session.state === "closed" ? (
          <button type="button" style={styles.stop} onClick={onFollowup}>
            {codingHandoffCopy.ctaFollowup}
          </button>
        ) : null}
        {!live && session.hasPendingDiff ? (
          <button type="button" style={styles.stop} onClick={onApply}>
            {codingHandoffCopy.ctaApplyDiff}
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
  modeCHint: {
    fontSize: 10,
    color: "#9a3412",
    lineHeight: 1.35,
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

// L2 Panel safety strip (UI Mode P1) — TaskChip + mandatory abort + minimal confirm.
// Full ComputerTaskBar timeline moves to Cockpit; panel never loses abort.

import { useState, useEffect } from "react"
import { useAgentStore } from "../store/agentStore"
import { MinimalConfirm } from "./MinimalConfirm"

const ABORT_ACK_TIMEOUT_MS = 3000

export function SafetyStrip() {
  const { state } = useAgentStore()
  const task = state.computerTask
  const hasConfirm = state.pendingSecurityConfirmations.length > 0
  const [abortSentAt, setAbortSentAt] = useState<number | null>(null)
  const [abortUnconfirmed, setAbortUnconfirmed] = useState(false)

  useEffect(() => {
    setAbortSentAt(null)
    setAbortUnconfirmed(false)
  }, [task?.taskId])

  useEffect(() => {
    if (abortSentAt === null || !task || task.abortAcked) return
    const t = setTimeout(() => setAbortUnconfirmed(true), ABORT_ACK_TIMEOUT_MS)
    return () => clearTimeout(t)
  }, [abortSentAt, task, task?.abortAcked])

  // Show strip when L2 chrome needed: active/finished task, or pending confirm, or open affordance
  if (!task && !hasConfirm) return null

  const finished = task?.status === "finished"
  const progressText =
    task && typeof task.total === "number"
      ? `${task.steps.length}/${task.total}`
      : task
        ? `${task.steps.length} 步`
        : null

  const sendAbort = () => {
    if (!task) return
    chrome.runtime.sendMessage({ type: "computer.task.abort", task_id: task.taskId })
    setAbortSentAt(Date.now())
    setAbortUnconfirmed(false)
  }

  return (
    <div style={styles.wrap}>
      <div style={styles.chip}>
        <span style={styles.live}>
          {task && !finished ? "●" : "○"}{" "}
          {task?.task ? ellipsize(task.task, 36) : hasConfirm ? "待确认" : "Computer Use"}
        </span>
        {progressText && <span style={styles.meta}>{progressText}</span>}
        {task && !finished && !task.abortAcked && (
          <button type="button" style={styles.abortBtn} onClick={sendAbort} title="急停">
            急停
          </button>
        )}
        {task?.abortAcked && !finished && (
          <span style={styles.meta}>已急停…</span>
        )}
        <button
          type="button"
          style={styles.openBtn}
          onClick={() => chrome.runtime.sendMessage({ type: "cockpit.open" })}
        >
          打开操控台 ↗
        </button>
      </div>
      {abortUnconfirmed && task && !task.abortAcked && !finished && (
        <div style={styles.warn}>急停未确认——可用 Ctrl+Alt+End</div>
      )}
      {hasConfirm && <MinimalConfirm />}
    </div>
  )
}

function ellipsize(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + "…"
}

const styles: Record<string, React.CSSProperties> = {
  wrap: {
    margin: "0 0 0 0",
    padding: "8px 10px",
    background: "#1a1f2a",
    borderBottom: "1px solid #2a2f3a",
    color: "#e8eaed",
    fontSize: 11,
  },
  chip: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  live: {
    color: "#4ade80",
    fontWeight: 600,
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  meta: { color: "#9aa0a6", fontSize: 10, flexShrink: 0 },
  abortBtn: {
    background: "#7f1d1d",
    color: "#fca5a5",
    border: "1px solid #991b1b",
    borderRadius: 4,
    padding: "3px 8px",
    cursor: "pointer",
    fontSize: 11,
    fontWeight: 600,
  },
  openBtn: {
    background: "transparent",
    color: "#5b8def",
    border: "none",
    cursor: "pointer",
    fontSize: 11,
    textDecoration: "underline",
    padding: 0,
  },
  warn: {
    marginTop: 6,
    color: "#fbbf24",
    fontSize: 10,
  },
}

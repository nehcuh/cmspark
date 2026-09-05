// Always-on RunBusy affordance (SoT F-UX1) — independent of FocusBand primary.
// Fleet signals are scoped to the active thread (no foreign residual workers).

import { useMemo } from "react"
import { useAgentStore } from "../store/agentStore"
import { tokens } from "../ui/tokens"
import {
  buildScopedRunBusyInput,
  deriveRunBusy,
  deriveThreadBusy,
  isIntentOnlyRunBusy,
} from "../utils/thread-busy"
import { collectRunningTools } from "../utils/running-tools"

export function RunBusyChip() {
  const { state, dispatch } = useAgentStore()
  const activeId = state.activeThreadId
  const activeThread = state.threads.find((t) => t.id === activeId)
  const fleet = state.fleet
  const workers = fleet?.workers || []

  const chip = useMemo(() => {
    const runningTools = collectRunningTools(state.messages)
    const mapBusy = !!(activeId && state.threadBusyById[activeId])
    const threadBusy = deriveThreadBusy({
      streaming: !!state.streamingContent,
      isProcessing: state.isProcessing,
      runningToolCount: runningTools.length,
      mapBusy,
    })
    const busyThreadIds = Object.entries(state.threadBusyById)
      .filter(([, b]) => b)
      .map(([id]) => id)
    const { runBusyInput, workerCount } = buildScopedRunBusyInput({
      active: activeThread
        ? {
            id: activeThread.id,
            agent_role: activeThread.agent_role,
            parent_thread_id: activeThread.parent_thread_id,
            orchestrator_run_id: activeThread.orchestrator_run_id,
          }
        : activeId
          ? { id: activeId }
          : null,
      workers,
      locks: fleet?.locks,
      openIntentCount: fleet?.open_intent_count,
      openIntentsByRun: fleet?.open_intents_by_run,
      llmActiveThreadIds: fleet?.llm_active_thread_ids,
      busyThreadIds,
    })
    const runBusy = deriveRunBusy(runBusyInput)
    if (!runBusy) return null
    const intentOnly = isIntentOnlyRunBusy(runBusyInput)
    const { lockCount, openIntents } = runBusyInput
    const label = intentOnly
      ? `任务板 · ${openIntents} intent`
      : threadBusy
        ? `子任务还在跑 · ${workerCount || "…"}`
        : `子任务还在跑 · ${workerCount || lockCount || openIntents}`
    return { label, threadBusy }
  }, [
    state.messages,
    state.streamingContent,
    state.isProcessing,
    state.threadBusyById,
    activeId,
    activeThread,
    fleet,
    workers,
  ])

  if (!chip) return null

  return (
    <button
      type="button"
      style={styles.chip}
      onClick={() => dispatch({ type: "SET_FLEET_LIST_OPEN", open: true })}
      title="查看子任务"
    >
      <span style={styles.dot} aria-hidden />
      <span style={styles.text}>{chip.label}</span>
      <span style={styles.cta}>查看</span>
    </button>
  )
}

const styles: Record<string, React.CSSProperties> = {
  chip: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    width: "100%",
    border: "none",
    borderBottom: `1px solid ${tokens.border}`,
    background: tokens.bgMuted,
    padding: "4px 10px",
    cursor: "pointer",
    fontFamily: tokens.font,
    fontSize: 11,
    color: tokens.text,
    minHeight: 24,
    maxHeight: 28,
    boxSizing: "border-box",
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 99,
    background: tokens.warning,
    flexShrink: 0,
  },
  text: {
    flex: 1,
    textAlign: "left",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: tokens.textMuted,
  },
  cta: {
    color: tokens.accent,
    fontWeight: 600,
    flexShrink: 0,
  },
}

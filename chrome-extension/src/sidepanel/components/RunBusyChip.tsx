// Always-on RunBusy affordance (SoT F-UX1) — independent of FocusBand primary.

import { useMemo } from "react"
import { useAgentStore } from "../store/agentStore"
import { tokens } from "../ui/tokens"
import {
  deriveRunBusy,
  deriveThreadBusy,
  filterIdsByRun,
  isIntentOnlyRunBusy,
} from "../utils/thread-busy"
import { collectRunningTools } from "../utils/running-tools"

export function RunBusyChip() {
  const { state, dispatch } = useAgentStore()
  const activeId = state.activeThreadId
  const activeThread = state.threads.find((t) => t.id === activeId)
  const fleet = state.fleet
  const workers = fleet?.workers || []
  const runId = activeThread?.orchestrator_run_id || null

  const chip = useMemo(() => {
    const runningTools = collectRunningTools(state.messages)
    const mapBusy = !!(activeId && state.threadBusyById[activeId])
    const threadBusy = deriveThreadBusy({
      streaming: !!state.streamingContent,
      isProcessing: state.isProcessing,
      runningToolCount: runningTools.length,
      mapBusy,
    })
    const llmActiveRaw = fleet?.llm_active_thread_ids || []
    const llmActiveThreadIds = runId
      ? filterIdsByRun(llmActiveRaw, workers, runId)
      : llmActiveRaw
    const workerBusyIds = filterIdsByRun(
      Object.entries(state.threadBusyById)
        .filter(([, b]) => b)
        .map(([id]) => id),
      workers,
      runId,
    )
    let lockCount = fleet?.lock_count ?? 0
    if (runId && fleet?.locks?.length) {
      const runWorkerIds = new Set(
        workers.filter((w) => w.orchestrator_run_id === runId).map((w) => w.id),
      )
      if (activeId) runWorkerIds.add(activeId)
      lockCount = fleet.locks.filter((l) => runWorkerIds.has(l.holder_thread_id)).length
    }
    const openIntents = fleet?.open_intent_count ?? 0
    const anyHoldingTabs = runId
      ? workers.some((w) => w.orchestrator_run_id === runId && w.status === "holding_tabs")
      : workers.some((w) => w.status === "holding_tabs")
    const input = {
      lockCount,
      openIntents,
      anyHoldingTabs,
      llmActiveThreadIds,
      workerBusyIds,
    }
    const runBusy = deriveRunBusy(input)
    if (!runBusy) return null
    // When thread is busy, FocusBand/composer already show state — still show chip if multi-worker
    const workerN = workers.filter(
      (w) => w.agent_role === "worker" && (!runId || w.orchestrator_run_id === runId),
    ).length
    const intentOnly = isIntentOnlyRunBusy(input)
    const label = intentOnly
      ? `任务板 · ${openIntents} intent`
      : threadBusy
        ? `子任务还在跑 · ${workerN || "…"}`
        : `子任务还在跑 · ${workerN || lockCount || openIntents}`
    return { label, threadBusy }
  }, [
    state.messages,
    state.streamingContent,
    state.isProcessing,
    state.threadBusyById,
    activeId,
    fleet,
    workers,
    runId,
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
    borderBottom: `1px solid ${tokens.border || "#e5e7eb"}`,
    background: tokens.bgMuted || "#f3f4f6",
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
    background: "#f59e0b",
    flexShrink: 0,
  },
  text: {
    flex: 1,
    textAlign: "left",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: tokens.textMuted || "#6b7280",
  },
  cta: {
    color: tokens.accent,
    fontWeight: 600,
    flexShrink: 0,
  },
}

// #321 PR-2: the single scoped run-busy derivation for the side panel.
// App.tsx / FocusBand / ChatView / FleetStrip (and the former RunBusyChip) each
// rebuilt buildScopedRunBusyInput from the same store slices — five copies, one
// of which (FleetStrip) silently omitted busyThreadIds. They now consume this
// hook so the scoping rules (foreign residual workers / paused zombies never
// light the chip) live in exactly one place.

import { useMemo } from "react"
import { useAgentStore } from "../store/agentStore"
import {
  buildFleetStopAllMessage,
  buildScopedRunBusyInput,
  deriveRunBusy,
  deriveThreadBusy,
  isIntentOnlyRunBusy,
  type FleetScope,
  type FleetWorkerLike,
} from "../utils/thread-busy"
import { collectRunningTools } from "../utils/running-tools"

export interface ScopedRunBusyView {
  /** Fleet scope for the active thread (none = normal thread, empty signals). */
  scope: FleetScope
  scopeKind: FleetScope["kind"]
  scopedWorkers: FleetWorkerLike[]
  stopAll: ReturnType<typeof buildFleetStopAllMessage>
  /** Scoped worst worker status for fleet classification (holding_tabs > paused > idle). */
  worstStatus: "holding_tabs" | "paused" | "idle" | "none"
  workerCount: number
  lockCount: number
  openIntents: number
  runBusy: boolean
  /** Active thread busy (streaming / processing / running tool / mapBusy). */
  threadBusy: boolean
  intentOnly: boolean
  /** RunBusyChip copy (null = no chip). */
  runBusyLabel: string | null
}

export function useScopedRunBusy(): ScopedRunBusyView {
  const { state } = useAgentStore()
  const activeId = state.activeThreadId
  const activeThread = state.threads.find((t) => t.id === activeId)
  const fleet = state.fleet

  return useMemo(() => {
    const workers = fleet?.workers || []
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
    const { scope, scopedWorkers, runBusyInput, workerCount } = buildScopedRunBusyInput({
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
    const intentOnly = isIntentOnlyRunBusy(runBusyInput)
    const { lockCount, openIntents } = runBusyInput
    const runBusyLabel = runBusy
      ? intentOnly
        ? `任务板 · ${openIntents} intent`
        : threadBusy
          ? `子任务还在跑 · ${workerCount || "…"}`
          : `子任务还在跑 · ${workerCount || lockCount || openIntents}`
      : null
    const worstStatus = scopedWorkers.some((w) => w.status === "holding_tabs")
      ? "holding_tabs"
      : scopedWorkers.some((w) => w.status === "paused")
        ? "paused"
        : scopedWorkers.length > 0
          ? "idle"
          : "none"
    return {
      scope,
      scopeKind: scope.kind,
      scopedWorkers,
      stopAll: buildFleetStopAllMessage(scope),
      worstStatus,
      workerCount,
      lockCount,
      openIntents,
      runBusy,
      threadBusy,
      intentOnly,
      runBusyLabel,
    }
  }, [
    state.messages,
    state.streamingContent,
    state.isProcessing,
    state.threadBusyById,
    activeId,
    activeThread,
    fleet,
  ])
}

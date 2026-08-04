/**
 * Pure run-state predicates (SoT 2026-08-04 run-state + worker drill-down).
 * UI must not treat residual idle workers as RunBusy.
 */

export type ThreadBusyInput = {
  streaming: boolean
  isProcessing: boolean
  runningToolCount: number
  /** From threadBusyById[activeThreadId] */
  mapBusy?: boolean
}

export function deriveThreadBusy(i: ThreadBusyInput): boolean {
  return !!(i.streaming || i.isProcessing || i.runningToolCount > 0 || i.mapBusy)
}

export type RunBusyInput = {
  lockCount: number
  openIntents: number
  anyHoldingTabs: boolean
  llmActiveThreadIds: string[]
  workerBusyIds: string[]
}

/**
 * Honest RunBusy — never worker_count>0 alone / fleet idle residual.
 */
export function deriveRunBusy(i: RunBusyInput): boolean {
  if (i.lockCount > 0 || i.openIntents > 0 || i.anyHoldingTabs) return true
  if (i.llmActiveThreadIds.length > 0) return true
  if (i.workerBusyIds.length > 0) return true
  return false
}

export type ComposerMode = "l2_task" | "thread_busy" | "run_busy" | "ready"

export function resolveComposerMode(i: {
  taskActive: boolean
  threadBusy: boolean
  runBusy: boolean
}): ComposerMode {
  if (i.taskActive) return "l2_task"
  if (i.threadBusy) return "thread_busy"
  if (i.runBusy) return "run_busy"
  return "ready"
}

export function composerBusyPlaceholder(
  mode: ComposerMode,
  opts?: { lockCount?: number; isWorker?: boolean; roleLabel?: string },
): string | null {
  switch (mode) {
    case "l2_task":
      return "任务进行中 — 请在确认台发送指令或先急停"
    case "thread_busy":
      return "本对话处理中 · 停止后再指挥"
    case "run_busy": {
      const locks =
        opts?.lockCount && opts.lockCount > 0 ? ` · ${opts.lockCount} 锁仍活跃` : ""
      if (opts?.isWorker) {
        return `子任务还在跑${locks} · 发送给子任务 · ${opts.roleLabel || "worker"}`
      }
      return `子任务还在跑${locks} · 可继续指挥当前线程`
    }
    case "ready":
      if (opts?.isWorker) {
        return `发送给子任务 · ${opts.roleLabel || "worker"}`
      }
      return null
    default:
      return null
  }
}

/** F-S1: stamp-first; multi-agent without stamp → null (deny-safe, no wrong abort). */
export function resolveStopTargetId(i: {
  workerId?: string | null
  activeThreadId?: string | null
  multiAgentContext: boolean
}): string | null {
  if (i.workerId) return i.workerId
  if (i.multiAgentContext) return null
  return i.activeThreadId || null
}

export function resolveParentThreadId(i: {
  activeParentId?: string | null
  fleetParentId?: string | null
  orchestratorIdForRun?: string | null
}): string | null {
  return i.activeParentId || i.fleetParentId || i.orchestratorIdForRun || null
}

export function filterIdsByRun(
  ids: string[],
  workers: Array<{ id: string; orchestrator_run_id?: string | null }>,
  runId?: string | null,
): string[] {
  if (!runId) return ids
  const allowed = new Set(
    workers.filter((w) => w.orchestrator_run_id === runId).map((w) => w.id),
  )
  return ids.filter((id) => allowed.has(id))
}

/** Whether §6 banner is intent-only (no locks/holding/llm/workerBusy). */
export function isIntentOnlyRunBusy(i: RunBusyInput): boolean {
  if (!deriveRunBusy(i)) return false
  return (
    i.lockCount === 0 &&
    !i.anyHoldingTabs &&
    i.llmActiveThreadIds.length === 0 &&
    i.workerBusyIds.length === 0 &&
    i.openIntents > 0
  )
}

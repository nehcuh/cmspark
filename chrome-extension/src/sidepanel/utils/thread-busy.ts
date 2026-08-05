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

/** Minimal worker/thread shape for fleet scoping (UI + pure tests). */
export type FleetWorkerLike = {
  id: string
  agent_role?: string | null
  parent_thread_id?: string | null
  orchestrator_run_id?: string | null
  status?: string | null
}

export type ActiveThreadLike = {
  id?: string | null
  agent_role?: string | null
  parent_thread_id?: string | null
  orchestrator_run_id?: string | null
}

/**
 * How fleet activity is attributed to the active Side Panel thread.
 *
 * - `run`: stamped orchestrator_run_id (preferred)
 * - `parent`: multi-agent host/worker without run stamp, or host that still has children
 * - `none`: normal single-thread chat — **must not** inherit other runs' workers
 *   (process-wide fallback caused foreign "子任务还在跑" + wrong drill-down list).
 */
export type FleetScope =
  | { kind: "none" }
  | { kind: "run"; runId: string }
  | { kind: "parent"; parentId: string }

export function resolveFleetScope(
  active: ActiveThreadLike | null | undefined,
  workers: FleetWorkerLike[],
): FleetScope {
  if (!active?.id) return { kind: "none" }
  const runId = active.orchestrator_run_id
  if (typeof runId === "string" && runId.length > 0) {
    return { kind: "run", runId }
  }
  if (active.agent_role === "worker" && active.parent_thread_id) {
    return { kind: "parent", parentId: active.parent_thread_id }
  }
  if (active.agent_role === "orchestrator") {
    return { kind: "parent", parentId: active.id }
  }
  // Normal/host thread that still parents fleet rows (missing run stamp).
  if (workers.some((w) => w.parent_thread_id === active.id)) {
    return { kind: "parent", parentId: active.id }
  }
  return { kind: "none" }
}

export function workersInFleetScope(
  workers: FleetWorkerLike[],
  scope: FleetScope,
): FleetWorkerLike[] {
  if (scope.kind === "none") return []
  if (scope.kind === "run") {
    return workers.filter((w) => w.orchestrator_run_id === scope.runId)
  }
  return workers.filter(
    (w) => w.id === scope.parentId || w.parent_thread_id === scope.parentId,
  )
}

/**
 * Build fleet.stop_all payload + confirm copy from fleet scope.
 * S45 multi-lane:
 * - `run` → orchestrator_run_id (companion listWorkers by run)
 * - `parent` → parent_thread_id (companion filters workers by parent)
 * - `none` → process-wide residual cleanup (explicit confirm; button usually disabled)
 */
export function buildFleetStopAllMessage(scope: FleetScope): {
  type: "fleet.stop_all"
  orchestrator_run_id?: string
  parent_thread_id?: string
  confirmText: string
  stopTitle: string
} {
  if (scope.kind === "run") {
    return {
      type: "fleet.stop_all",
      orchestrator_run_id: scope.runId,
      confirmText:
        "停止当前 run 的全部子任务？将中止该 run 下 worker LLM、拒绝待确认，并释放相关 tab 锁。",
      stopTitle: "停止当前 run 的全部 worker",
    }
  }
  if (scope.kind === "parent") {
    return {
      type: "fleet.stop_all",
      parent_thread_id: scope.parentId,
      confirmText:
        "停止本会话相关子任务？将中止该会话下 worker LLM、拒绝待确认，并释放相关 tab 锁。",
      stopTitle: "停止本会话相关 worker",
    }
  }
  return {
    type: "fleet.stop_all",
    confirmText:
      "清理进程内全部 worker 残留？将中止全部 worker LLM、拒绝待确认，并释放相关 tab 锁。",
    stopTitle: "当前会话无子任务列表；全停会作用到进程内全部 worker",
  }
}

/** Intersect ids with workers visible under the active fleet scope. */
export function filterIdsByFleetScope(
  ids: string[],
  workers: FleetWorkerLike[],
  scope: FleetScope,
): string[] {
  if (scope.kind === "none") return []
  const allowed = new Set(workersInFleetScope(workers, scope).map((w) => w.id))
  return ids.filter((id) => allowed.has(id))
}

/**
 * SoT §2.1: when `runId` is known, only count intents for that run.
 * Do NOT fall back to process-wide `open_intent_count` (sticky false RunBusy).
 *
 * @deprecated Prefer `resolveOpenIntentsForScope` — null runId process-wide
 * fallback pollutes normal threads with foreign board intents.
 */
export function resolveOpenIntentsForRun(
  openIntentCount: number | undefined,
  openIntentsByRun: Record<string, number> | undefined,
  runId?: string | null,
): number {
  if (!runId) return openIntentCount ?? 0
  return openIntentsByRun?.[runId] ?? 0
}

/** Scope-aware open intents: never process-wide for `none` / parent-without-run. */
export function resolveOpenIntentsForScope(
  openIntentCount: number | undefined,
  openIntentsByRun: Record<string, number> | undefined,
  scope: FleetScope,
): number {
  if (scope.kind === "none") return 0
  if (scope.kind === "run") return openIntentsByRun?.[scope.runId] ?? 0
  // parent without run stamp: cannot safely attribute process-wide intents
  void openIntentCount
  return 0
}

/** Locks held by workers (and optional active host) in scope — never process-wide. */
export function scopedLockCount(
  locks: Array<{ holder_thread_id: string }> | undefined,
  workers: FleetWorkerLike[],
  scope: FleetScope,
  activeId?: string | null,
): number {
  if (scope.kind === "none") return 0
  if (!locks?.length) return 0
  const allowed = new Set(workersInFleetScope(workers, scope).map((w) => w.id))
  if (activeId) allowed.add(activeId)
  return locks.filter((l) => allowed.has(l.holder_thread_id)).length
}

/**
 * Build honest RunBusyInput for the active thread from a process-wide fleet snapshot.
 * Normal threads (`scope.none`) get empty signals so foreign residual workers cannot
 * light 「子任务还在跑」or fill the drill-down list.
 */
export function buildScopedRunBusyInput(opts: {
  active: ActiveThreadLike | null | undefined
  workers: FleetWorkerLike[]
  locks?: Array<{ holder_thread_id: string }>
  openIntentCount?: number
  openIntentsByRun?: Record<string, number>
  llmActiveThreadIds?: string[]
  /** thread ids with mapBusy true */
  busyThreadIds?: string[]
}): {
  scope: FleetScope
  scopedWorkers: FleetWorkerLike[]
  runBusyInput: RunBusyInput
  workerCount: number
} {
  const scope = resolveFleetScope(opts.active, opts.workers)
  const scopedWorkers = workersInFleetScope(opts.workers, scope)
  if (scope.kind === "none") {
    return {
      scope,
      scopedWorkers: [],
      runBusyInput: {
        lockCount: 0,
        openIntents: 0,
        anyHoldingTabs: false,
        llmActiveThreadIds: [],
        workerBusyIds: [],
      },
      workerCount: 0,
    }
  }
  const activeId = opts.active?.id || null
  const lockCount = scopedLockCount(opts.locks, opts.workers, scope, activeId)
  const openIntents = resolveOpenIntentsForScope(
    opts.openIntentCount,
    opts.openIntentsByRun,
    scope,
  )
  const llmActiveThreadIds = filterIdsByFleetScope(
    opts.llmActiveThreadIds || [],
    opts.workers,
    scope,
  )
  const workerBusyIds = filterIdsByFleetScope(
    opts.busyThreadIds || [],
    opts.workers,
    scope,
  )
  const anyHoldingTabs = scopedWorkers.some((w) => w.status === "holding_tabs")
  const workerCount = scopedWorkers.filter((w) => w.agent_role === "worker").length
  return {
    scope,
    scopedWorkers,
    runBusyInput: {
      lockCount,
      openIntents,
      anyHoldingTabs,
      llmActiveThreadIds,
      workerBusyIds,
    },
    workerCount,
  }
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

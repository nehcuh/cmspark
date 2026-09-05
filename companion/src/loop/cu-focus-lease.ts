// L-5 (#391) CU focus lease — exclusive desktop-drive right for loops/workers.
// Design: FINAL-SYNTHESIS L-5 + claude-proposal §3.2.
//
// Layered vs llm-loop-gate (ADR-015 §3.5):
//   llm-loop-gate  — concurrent LLM loops (cap 5)
//   cu-focus-lease — same moment, only ONE loop/worker may drive CU
// COMPUTER_TASK_BUSY (plan §E.6.2) stays the execution mutex (no wait inside
// the host_computer tool). This lease queues at the loop/worker scheduling
// layer so a second loop does not pop L2 / hit BUSY; it waits its turn.
//
// NEVER: extend unattended grant TTL; flip computer.coordinateEnabled;
// wait inside host_computer (that would break the single-task invariant).

import { sanitizeLoopState } from "./loop-state"
import { enqueueNextRun, type NextRunSource } from "../llm/run-queues"
import { appendCapabilityAudit } from "../packs/audit-log"
import { logger } from "../logger"

export const CU_FOCUS_LEASE_QUEUED = "CU_FOCUS_LEASE_QUEUED" as const

export type CuFocusLeaseSnapshot = {
  holder: string | null
  queued: string[]
}

type CuFocusWaiter = { threadId: string; source: NextRunSource }

let holder: string | null = null
const queue: CuFocusWaiter[] = []

/** Worker has no loop_state — drain gate drops source=loop. Use "user". */
export function cuFocusWaiterSource(
  thread: { agent_role?: string | null } | null | undefined,
): NextRunSource {
  return thread?.agent_role === "worker" ? "user" : "loop"
}

function audit(type: string, extra: Record<string, unknown>): void {
  try {
    appendCapabilityAudit({ type, at: new Date().toISOString(), ...extra })
  } catch {
    /* audit must never gate the lease */
  }
}

/** Workers always; orchestrator/main only while a loop is active. */
export function shouldUseCuFocusLease(
  thread: { agent_role?: string | null; loop_state?: unknown } | null | undefined,
): boolean {
  if (!thread) return false
  if (thread.agent_role === "worker") return true
  const st = sanitizeLoopState(thread.loop_state)
  return st?.status === "active"
}

export function peekCuFocusHolder(): string | null {
  return holder
}

export function tryAcquireCuFocusLease(holderId: string): { ok: true } | { ok: false; holder: string } {
  const id = String(holderId || "")
  if (!id) return { ok: false, holder: holder ?? "" }
  if (holder === id) return { ok: true } // re-entrant
  if (holder == null) {
    holder = id
    audit("task_loop.cu_focus_acquired", { thread_id: id, queued: queue.length })
    return { ok: true }
  }
  return { ok: false, holder }
}

/**
 * Remember a waiter. Same id is not queued twice. Does not acquire.
 * `source` is chosen at queue time: workers use "user" so gateLoopNextRunDrain
 * does not starve them (#402 MAJOR-3); loops use "loop".
 */
export function queueCuFocusWaiter(holderId: string, source: NextRunSource = "loop"): void {
  const id = String(holderId || "")
  if (!id) return
  if (holder === id) return
  if (!queue.some((w) => w.threadId === id)) {
    queue.push({ threadId: id, source: source === "user" ? "user" : "loop" })
    audit("task_loop.cu_focus_queued", { thread_id: id, holder, queued: queue.length, source })
  }
}

/**
 * Combined gate for host_computer / L2 admission.
 * acquired=true means the caller MUST releaseCuFocusLease in a finally.
 */
export function gateHostComputerFocusLease(
  thread: { agent_role?: string | null; loop_state?: unknown } | null | undefined,
  threadId: string,
):
  | { ok: true; acquired: boolean }
  | { ok: false; error_code: typeof CU_FOCUS_LEASE_QUEUED; error: string; holder: string } {
  if (!shouldUseCuFocusLease(thread)) return { ok: true, acquired: false }
  const id = String(threadId || "")
  const acq = tryAcquireCuFocusLease(id)
  if (acq.ok) return { ok: true, acquired: true }
  queueCuFocusWaiter(id, cuFocusWaiterSource(thread))
  return {
    ok: false,
    error_code: CU_FOCUS_LEASE_QUEUED,
    holder: acq.holder,
    error:
      `host_computer waiting on CU focus lease (held by ${acq.holder}) [${CU_FOCUS_LEASE_QUEUED}] — ` +
      `only one loop/worker drives CU at a time; this request is queued.`,
  }
}

export function releaseCuFocusLease(holderId: string): void {
  const id = String(holderId || "")
  if (!id || holder !== id) return
  holder = null
  audit("task_loop.cu_focus_released", { thread_id: id, queued: queue.length })
  drainCuFocusQueue()
}

function drainCuFocusQueue(): void {
  while (queue.length > 0 && holder == null) {
    const next = queue.shift()
    if (!next) break
    // Do not auto-acquire: the waiter retries host_computer on the next run
    // and takes the lease then. Auto-acquire would idle-hold the desktop.
    try {
      enqueueNextRun(
        next.threadId,
        "CU focus lease is free. Retry host_computer for remaining items. Do not enable computer.use yourself.",
        undefined,
        next.source,
      )
    } catch (e: any) {
      logger.warn("task_loop.cu_focus_drain_failed", {
        thread_id: next.threadId,
        error: e?.message || String(e),
      })
    }
    audit("task_loop.cu_focus_notified", { thread_id: next.threadId, source: next.source })
  }
}

export function cuFocusLeaseSnapshot(): CuFocusLeaseSnapshot {
  return { holder, queued: queue.map((w) => w.threadId) }
}

export function _resetCuFocusLeaseForTests(): void {
  holder = null
  queue.length = 0
}

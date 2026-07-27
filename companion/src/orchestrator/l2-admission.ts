// L2 confirmation admission control — ADR-015 §3.5 / §4
// max_active_l2_per_run=1, max_active_l2_process=2.
//
// Queue discipline is **scan-skip FIFO** (not strict head-of-line):
// waiters are ordered by arrival, but tryDequeue walks the queue and admits
// every waiter that currently `canAdmit` under process/run caps. A head waiter
// blocked only by per-run cap=1 does **not** block a later different-run waiter.
// Throughput-positive under multi-run contention; document as "FIFO among
// currently admissible waiters" — do not claim pure HOL.

import { ORCHESTRATOR_CAPS } from "./constants"

type Waiter = {
  runId: string
  resolve: (ok: boolean) => void
  timer: ReturnType<typeof setTimeout>
}

const activeByRun = new Map<string, number>()
let activeGlobal = 0
const queue: Waiter[] = []

/** Max wait in queue before L2_ADMISSION_TIMEOUT (must stay ≤ soft path budget when SOFT is taken after admission). */
export const ADMISSION_TIMEOUT_MS = 60_000

function runKey(orchestratorRunId: string | null | undefined, threadId: string | null | undefined): string {
  if (orchestratorRunId) return `run:${orchestratorRunId}`
  if (threadId) return `thread:${threadId}`
  return "run:anon"
}

function canAdmit(key: string): boolean {
  if (activeGlobal >= ORCHESTRATOR_CAPS.max_active_l2_process) return false
  const n = activeByRun.get(key) || 0
  if (n >= ORCHESTRATOR_CAPS.max_active_l2_per_run) return false
  return true
}

/**
 * Admit every currently-eligible waiter under process/run caps.
 * Scan-skip: skips head waiters that fail canAdmit so later runs can proceed.
 * Multi-admit: continues until no further waiter can take a slot (fixes
 * under-use when process cap frees more than one slot at once).
 */
function tryDequeue(): void {
  let i = 0
  while (i < queue.length) {
    const w = queue[i]
    if (!canAdmit(w.runId)) {
      i++
      continue
    }
    queue.splice(i, 1)
    clearTimeout(w.timer)
    activeGlobal++
    activeByRun.set(w.runId, (activeByRun.get(w.runId) || 0) + 1)
    w.resolve(true)
    // next element shifted into i — do not increment
  }
}

/**
 * Acquire an L2 admission slot. Returns false if timed out waiting in FIFO.
 * Always pair with releaseL2Admission in finally.
 */
export async function acquireL2Admission(opts: {
  orchestratorRunId?: string | null
  threadId?: string | null
}): Promise<{ ok: true; key: string } | { ok: false; error: string }> {
  const key = runKey(opts.orchestratorRunId, opts.threadId)
  if (canAdmit(key)) {
    activeGlobal++
    activeByRun.set(key, (activeByRun.get(key) || 0) + 1)
    return { ok: true, key }
  }
  const ok = await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      const idx = queue.findIndex((w) => w.resolve === resolve)
      if (idx >= 0) queue.splice(idx, 1)
      resolve(false)
    }, ADMISSION_TIMEOUT_MS)
    queue.push({ runId: key, resolve, timer })
  })
  if (!ok) {
    return {
      ok: false,
      error: `L2_ADMISSION_TIMEOUT: waited ${ADMISSION_TIMEOUT_MS}ms (cap per-run=${ORCHESTRATOR_CAPS.max_active_l2_per_run}, process=${ORCHESTRATOR_CAPS.max_active_l2_process})`,
    }
  }
  return { ok: true, key }
}

export function releaseL2Admission(key: string): void {
  const n = activeByRun.get(key) || 0
  if (n <= 0) {
    // Re-entrancy guard: double-release must not under-count / over-dequeue
    return
  }
  if (n <= 1) activeByRun.delete(key)
  else activeByRun.set(key, n - 1)
  if (activeGlobal > 0) activeGlobal--
  tryDequeue()
}

export function l2AdmissionSnapshot(): {
  active_global: number
  queue_len: number
  by_run: Record<string, number>
} {
  const by_run: Record<string, number> = {}
  for (const [k, v] of activeByRun) by_run[k] = v
  return { active_global: activeGlobal, queue_len: queue.length, by_run }
}

/** Test helper */
export function _resetL2AdmissionForTests(): void {
  for (const w of queue) {
    clearTimeout(w.timer)
    w.resolve(false)
  }
  queue.length = 0
  activeByRun.clear()
  activeGlobal = 0
}

// Process-wide multi-agent concurrent LLM loop cap — ADR-015 §3.5
// max_concurrent_multi_agent_llm_loops (default 5). Non multi-agent chats are unlimited.

import { ORCHESTRATOR_CAPS } from "./constants"
import { isMultiAgentThread } from "./spawn"

let activeMultiAgentLoops = 0
const holders = new Set<string>() // thread ids currently holding a slot

/**
 * #371 round-2: deferred worker kicks that could not take a slot.
 * Semantics: fire-and-forget kick that hits MULTI_AGENT_LLM_CAP is queued
 * (brief already persisted; worker waits). The next release drains FIFO.
 * Same threadId is not queued twice.
 */
type DeferredLlmRun = {
  threadId: string
  thread: unknown
  run: () => Promise<void>
}
const deferredKickQueue: DeferredLlmRun[] = []

export type LlmLoopGateResult =
  | { ok: true }
  | { ok: false; error: string; active: number; cap: number }

/**
 * Try to acquire a multi-agent LLM loop slot for this thread.
 * Non multi-agent threads always succeed without counting.
 * Re-entrant for the same threadId (no double-count).
 */
function multiAgentLlmLoopGate(thread: unknown, threadId: string, acquire: boolean): LlmLoopGateResult {
  if (!isMultiAgentThread(thread as any)) {
    return { ok: true }
  }
  if (holders.has(threadId)) {
    return { ok: true }
  }
  const cap = ORCHESTRATOR_CAPS.max_concurrent_multi_agent_llm_loops
  if (activeMultiAgentLoops >= cap) {
    return {
      ok: false,
      error: `MULTI_AGENT_LLM_CAP: max_concurrent_multi_agent_llm_loops=${cap} reached (active=${activeMultiAgentLoops}). Wait for a worker to finish or cancel one.`,
      active: activeMultiAgentLoops,
      cap,
    }
  }
  if (acquire) {
    activeMultiAgentLoops++
    holders.add(threadId)
  }
  return { ok: true }
}

export function tryAcquireMultiAgentLlmLoop(thread: unknown, threadId: string): LlmLoopGateResult {
  return multiAgentLlmLoopGate(thread, threadId, true)
}

/** Peek without taking a slot — drain pre-check before takeNextRun (N-B4). */
export function canAcquireMultiAgentLlmLoop(thread: unknown, threadId: string): LlmLoopGateResult {
  return multiAgentLlmLoopGate(thread, threadId, false)
}

export function releaseMultiAgentLlmLoop(threadId: string): void {
  if (!holders.has(threadId)) return
  holders.delete(threadId)
  if (activeMultiAgentLoops > 0) activeMultiAgentLoops--
  drainDeferredLlmRuns()
}

/**
 * Start `run` under the multi-agent LLM cap, or queue it if the cap is full.
 *
 * - started: slot taken now; `run` is fire-and-forget and releases on settle.
 * - queued: cap full; worker stays idle with its brief until a slot frees.
 *
 * Missing `thread` is treated as a worker (fail-closed: still counts toward cap).
 * Kick that cannot acquire must NOT bypass the gate by calling chatCreate naked.
 */
export function scheduleWhenLlmSlotAvailable(
  thread: unknown,
  threadId: string,
  run: () => Promise<void>,
): { started: boolean; queued: boolean; active: number; cap: number } {
  const counted = thread ?? { agent_role: "worker" }
  const id = String(threadId || "")
  if (holders.has(id)) {
    return {
      started: true,
      queued: false,
      active: multiAgentLlmLoopSnapshot().active,
      cap: ORCHESTRATOR_CAPS.max_concurrent_multi_agent_llm_loops,
    }
  }
  const gate = tryAcquireMultiAgentLlmLoop(counted, id)
  if (gate.ok) {
    startDeferredRun({ threadId: id, thread: counted, run })
    return {
      started: true,
      queued: false,
      active: multiAgentLlmLoopSnapshot().active,
      cap: ORCHESTRATOR_CAPS.max_concurrent_multi_agent_llm_loops,
    }
  }
  if (!deferredKickQueue.some((q) => q.threadId === id)) {
    deferredKickQueue.push({ threadId: id, thread: counted, run })
  }
  return {
    started: false,
    queued: true,
    active: gate.active,
    cap: gate.cap,
  }
}

export function pendingDeferredLlmKickCount(): number {
  return deferredKickQueue.length
}

/** F2: thread ids with a queued-but-not-started kick (in-flight for handback gating). */
export function pendingDeferredLlmKickThreadIds(): string[] {
  return deferredKickQueue.map((q) => q.threadId)
}

/**
 * F1 (pull 2026-09-21): message-router registers this so drain can see whether
 * a thread already has an in-flight chat run (abort map). llm-loop-gate must
 * not import message-router (cycle), so the dependency is injected. A queued
 * kick for a thread the user is manually chatting stays queued instead of
 * double-running the worker alongside the user's run.
 */
let isThreadRunActiveProbe: ((threadId: string) => boolean) | null = null

export function setThreadRunActiveProbe(probe: ((threadId: string) => boolean) | null): void {
  isThreadRunActiveProbe = probe
}

/** Drop a queued kick so stop_all / abort cannot start it later (N-1). */
export function cancelDeferredLlmKick(threadId: string): boolean {
  const id = String(threadId || "")
  if (!id) return false
  const before = deferredKickQueue.length
  for (let i = deferredKickQueue.length - 1; i >= 0; i--) {
    if (deferredKickQueue[i]!.threadId === id) deferredKickQueue.splice(i, 1)
  }
  return deferredKickQueue.length !== before
}

function startDeferredRun(item: DeferredLlmRun): void {
  void Promise.resolve()
    .then(() => item.run())
    .catch(() => {
      /* caller logs; slot must still free */
    })
    .finally(() => {
      releaseMultiAgentLlmLoop(item.threadId)
    })
}

function drainDeferredLlmRuns(): void {
  // F1: at most one pass over the queue per drain — probe-requeued items must
  // not loop forever when every queued thread is manually driven.
  let guard = deferredKickQueue.length
  while (deferredKickQueue.length > 0 && guard-- > 0) {
    const next = deferredKickQueue[0]!
    if ((next.thread as { paused?: unknown } | null)?.paused === true) {
      deferredKickQueue.shift()
      continue
    }
    if (isThreadRunActiveProbe?.(next.threadId)) {
      // F1: another run owns this thread (user manually chatting the worker).
      // Keep the kick queued; the next release retries it single-run.
      deferredKickQueue.shift()
      deferredKickQueue.push(next)
      continue
    }
    const peek = canAcquireMultiAgentLlmLoop(next.thread, next.threadId)
    if (!peek.ok) break
    deferredKickQueue.shift()
    const acq = tryAcquireMultiAgentLlmLoop(next.thread, next.threadId)
    if (!acq.ok) {
      deferredKickQueue.unshift(next)
      break
    }
    startDeferredRun(next)
  }
}

export function multiAgentLlmLoopSnapshot(): {
  active: number
  cap: number
  holders: string[]
} {
  return {
    active: activeMultiAgentLoops,
    cap: ORCHESTRATOR_CAPS.max_concurrent_multi_agent_llm_loops,
    holders: [...holders],
  }
}

/** Test helper */
export function _resetMultiAgentLlmLoopsForTests(): void {
  activeMultiAgentLoops = 0
  holders.clear()
  deferredKickQueue.length = 0
}

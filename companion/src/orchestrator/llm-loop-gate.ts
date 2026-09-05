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
  while (deferredKickQueue.length > 0) {
    const next = deferredKickQueue[0]!
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

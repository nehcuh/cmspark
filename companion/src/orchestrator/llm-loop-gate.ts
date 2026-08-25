// Process-wide multi-agent concurrent LLM loop cap — ADR-015 §3.5
// max_concurrent_multi_agent_llm_loops (default 5). Non multi-agent chats are unlimited.

import { ORCHESTRATOR_CAPS } from "./constants"
import { isMultiAgentThread } from "./spawn"

let activeMultiAgentLoops = 0
const holders = new Set<string>() // thread ids currently holding a slot

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
}

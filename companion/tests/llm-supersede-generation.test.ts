/**
 * SEC-D: abort must release multi-agent gate; generation CAS basics.
 */
import test from "node:test"
import assert from "node:assert/strict"
import {
  abortThreadChat,
  __testSetLlmActiveForTests,
} from "../src/message-router"
import {
  tryAcquireMultiAgentLlmLoop,
  releaseMultiAgentLlmLoop,
  multiAgentLlmLoopSnapshot,
  _resetMultiAgentLlmLoopsForTests,
} from "../src/orchestrator/llm-loop-gate"

test("abortThreadChat releases multi-agent LLM gate slot", () => {
  _resetMultiAgentLlmLoopsForTests()
  const fakeWorker = { agent_role: "worker", parent_thread_id: "orch" }
  const acq = tryAcquireMultiAgentLlmLoop(fakeWorker, "w1")
  assert.equal(acq.ok, true)
  assert.equal(multiAgentLlmLoopSnapshot().active, 1)
  __testSetLlmActiveForTests("w1", true)
  const aborted = abortThreadChat("w1")
  assert.equal(aborted, true)
  assert.equal(multiAgentLlmLoopSnapshot().active, 0)
  assert.deepEqual(multiAgentLlmLoopSnapshot().holders, [])
  // Can acquire again after abort
  const acq2 = tryAcquireMultiAgentLlmLoop(fakeWorker, "w1")
  assert.equal(acq2.ok, true)
  releaseMultiAgentLlmLoop("w1")
  _resetMultiAgentLlmLoopsForTests()
})

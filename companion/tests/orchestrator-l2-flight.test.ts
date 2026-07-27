import test from "node:test"
import assert from "node:assert/strict"
import {
  acquireL2Admission,
  releaseL2Admission,
  _resetL2AdmissionForTests,
  l2AdmissionSnapshot,
} from "../src/orchestrator/l2-admission"
import {
  tryAcquireFlight,
  releaseFlight,
  isFlightBusy,
  _resetFlightsForTests,
} from "../src/orchestrator/single-flight"
import {
  tryAcquireMultiAgentLlmLoop,
  releaseMultiAgentLlmLoop,
  multiAgentLlmLoopSnapshot,
  _resetMultiAgentLlmLoopsForTests,
} from "../src/orchestrator/llm-loop-gate"
import {
  forceReleaseTab,
  completeForceRelease,
  acquireOrRenewTabLease,
  getTabLease,
  _resetTabLeasesForTests,
} from "../src/orchestrator/tab-lease"
import { SecurityPolicy } from "../src/security-policy"
import { ORCHESTRATOR_CAPS } from "../src/orchestrator/constants"

test("L2 admission: process cap 2", async () => {
  _resetL2AdmissionForTests()
  const a = await acquireL2Admission({ orchestratorRunId: "r1", threadId: "t1" })
  const b = await acquireL2Admission({ orchestratorRunId: "r2", threadId: "t2" })
  assert.equal(a.ok, true)
  assert.equal(b.ok, true)
  // third blocks until release — use short wait by releasing after microtask
  const pending = acquireL2Admission({ orchestratorRunId: "r3", threadId: "t3" })
  assert.equal(l2AdmissionSnapshot().active_global, 2)
  if (a.ok) releaseL2Admission(a.key)
  const c = await pending
  assert.equal(c.ok, true)
  if (b.ok) releaseL2Admission(b.key)
  if (c.ok) releaseL2Admission(c.key)
})

test("L2 admission: per-run cap 1", async () => {
  _resetL2AdmissionForTests()
  const a = await acquireL2Admission({ orchestratorRunId: "same", threadId: "t1" })
  assert.equal(a.ok, true)
  const pending = acquireL2Admission({ orchestratorRunId: "same", threadId: "t2" })
  // different run can still take slot
  const other = await acquireL2Admission({ orchestratorRunId: "other", threadId: "t3" })
  assert.equal(other.ok, true)
  if (a.ok) releaseL2Admission(a.key)
  const b = await pending
  assert.equal(b.ok, true)
  if (other.ok) releaseL2Admission(other.key)
  if (b.ok) releaseL2Admission(b.key)
})

test("shell_exec single-flight", () => {
  _resetFlightsForTests()
  const a = tryAcquireFlight("shell_exec", "w1")
  assert.equal(a.ok, true)
  const b = tryAcquireFlight("shell_exec", "w2")
  assert.equal(b.ok, false)
  releaseFlight("shell_exec")
  const c = tryAcquireFlight("shell_exec", "w2")
  assert.equal(c.ok, true)
  releaseFlight("shell_exec")
})

test("netsec and shell flights are independent", () => {
  _resetFlightsForTests()
  assert.equal(tryAcquireFlight("shell_exec", "a").ok, true)
  assert.equal(tryAcquireFlight("netsec_port_scan", "b").ok, true)
  releaseFlight("shell_exec")
  releaseFlight("netsec_port_scan")
})

test("multi-agent LLM loop gate: process cap", () => {
  _resetMultiAgentLlmLoopsForTests()
  const worker = { agent_role: "worker", parent_thread_id: "p", orchestrator_run_id: "r" }
  const cap = ORCHESTRATOR_CAPS.max_concurrent_multi_agent_llm_loops
  for (let i = 0; i < cap; i++) {
    const r = tryAcquireMultiAgentLlmLoop(worker, `w${i}`)
    assert.equal(r.ok, true, `slot ${i}`)
  }
  const blocked = tryAcquireMultiAgentLlmLoop(worker, "w-overflow")
  assert.equal(blocked.ok, false)
  if (!blocked.ok) {
    assert.equal(blocked.cap, cap)
    assert.match(blocked.error, /MULTI_AGENT_LLM_CAP/)
  }
  // normal (non multi-agent) thread still allowed
  const normal = tryAcquireMultiAgentLlmLoop({ agent_role: "normal" }, "normal-1")
  assert.equal(normal.ok, true)
  releaseMultiAgentLlmLoop("w0")
  const after = tryAcquireMultiAgentLlmLoop(worker, "w-overflow")
  assert.equal(after.ok, true)
  for (let i = 1; i < cap; i++) releaseMultiAgentLlmLoop(`w${i}`)
  releaseMultiAgentLlmLoop("w-overflow")
  assert.equal(multiAgentLlmLoopSnapshot().active, 0)
})

test("multi-agent LLM loop gate: re-entrant same thread", () => {
  _resetMultiAgentLlmLoopsForTests()
  const worker = { agent_role: "worker", orchestrator_run_id: "r" }
  assert.equal(tryAcquireMultiAgentLlmLoop(worker, "same").ok, true)
  assert.equal(tryAcquireMultiAgentLlmLoop(worker, "same").ok, true)
  assert.equal(multiAgentLlmLoopSnapshot().active, 1)
  releaseMultiAgentLlmLoop("same")
  assert.equal(multiAgentLlmLoopSnapshot().active, 0)
})

test("forceReleaseTab: pending-aware FORCE_RELEASING then complete", () => {
  _resetTabLeasesForTests()
  const a = acquireOrRenewTabLease({ tabId: 99, holderThreadId: "w1", needsL2: false })
  assert.equal(a.ok, true)
  const drain = forceReleaseTab(99, "user", { hasPending: true })
  assert.equal(drain.draining, true)
  assert.equal(getTabLease(99)?.state, "FORCE_RELEASING")
  assert.equal(completeForceRelease(99), true)
  assert.equal(getTabLease(99), null)
})

test("forceReleaseTab: instant free when no pending", () => {
  _resetTabLeasesForTests()
  acquireOrRenewTabLease({ tabId: 7, holderThreadId: "w1", needsL2: false })
  forceReleaseTab(7, "user", { hasPending: false })
  assert.equal(getTabLease(7), null)
})

test("bindingPayloadFor: shell/spawn/ask_user non-empty", () => {
  assert.equal(SecurityPolicy.bindingPayloadFor("shell_exec", { command: "ls" }), "ls")
  assert.match(
    SecurityPolicy.bindingPayloadFor("spawn_worker", { role_label: "reviewer", pack_id: "p1" }),
    /spawn\|reviewer\|p1/,
  )
  assert.equal(SecurityPolicy.bindingPayloadFor("ask_user", { question: "Go?" }), "Go?")
})

test("L2 tryDequeue multi-admits two eligible waiters under process cap", async () => {
  _resetL2AdmissionForTests()
  // Fill process cap (2)
  const a = await acquireL2Admission({ orchestratorRunId: "r1", threadId: "t1" })
  const b = await acquireL2Admission({ orchestratorRunId: "r2", threadId: "t2" })
  assert.equal(a.ok, true)
  assert.equal(b.ok, true)
  // Queue two different runs
  const p3 = acquireL2Admission({ orchestratorRunId: "r3", threadId: "t3" })
  const p4 = acquireL2Admission({ orchestratorRunId: "r4", threadId: "t4" })
  assert.equal(l2AdmissionSnapshot().queue_len, 2)
  // Free both slots — multi-admit should admit both waiters without a second release
  if (a.ok) releaseL2Admission(a.key)
  if (b.ok) releaseL2Admission(b.key)
  const c = await p3
  const d = await p4
  assert.equal(c.ok, true)
  assert.equal(d.ok, true)
  assert.equal(l2AdmissionSnapshot().active_global, 2)
  if (c.ok) releaseL2Admission(c.key)
  if (d.ok) releaseL2Admission(d.key)
})

test("shell flight re-entrant same owner; other owner BUSY", () => {
  _resetFlightsForTests()
  assert.equal(tryAcquireFlight("shell_exec", "w1").ok, true)
  assert.equal(tryAcquireFlight("shell_exec", "w1").ok, true) // re-entrant L2→execute
  assert.equal(tryAcquireFlight("shell_exec", "w2").ok, false)
  releaseFlight("shell_exec", "w2") // wrong owner must not free
  assert.equal(tryAcquireFlight("shell_exec", "w2").ok, false)
  releaseFlight("shell_exec", "w1")
  assert.equal(tryAcquireFlight("shell_exec", "w2").ok, true)
  releaseFlight("shell_exec", "w2")
})

test("isFlightBusy probe", () => {
  _resetFlightsForTests()
  assert.equal(isFlightBusy("shell_exec").busy, false)
  tryAcquireFlight("shell_exec", "w1")
  const b = isFlightBusy("shell_exec")
  assert.equal(b.busy, true)
  if (b.busy) assert.equal(b.holder, "w1")
  releaseFlight("shell_exec", "w1")
})

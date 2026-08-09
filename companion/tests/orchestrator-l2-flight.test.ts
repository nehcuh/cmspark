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
  flightSnapshot,
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
  hardReacquireAfterConfirm,
  releaseLeasesForThreadPendingAware,
  _resetTabLeasesForTests,
} from "../src/orchestrator/tab-lease"
import { SecurityConfirmationManager } from "../src/security-confirmation"
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
  // P1: shell binds command + cwd so L2 token cannot expand working dir after approve
  assert.equal(
    SecurityPolicy.bindingPayloadFor("shell_exec", { command: "ls" }),
    "shell|ls|cwd=",
  )
  assert.equal(
    SecurityPolicy.bindingPayloadFor("shell_exec", { command: "ls", cwd: "/tmp" }),
    "shell|ls|cwd=/tmp",
  )
  assert.match(
    SecurityPolicy.bindingPayloadFor("netsec_port_scan", { targets: ["10.0.0.1"], ports: [80, 443] }),
    /netsec\|targets=.*ports=/,
  )
  assert.match(
    SecurityPolicy.bindingPayloadFor("spawn_worker", { role_label: "reviewer", pack_id: "p1" }),
    /spawn\|reviewer\|p1/,
  )
  assert.equal(SecurityPolicy.bindingPayloadFor("ask_user", { question: "Go?" }), "Go?")
})

test("bindingPayloadFor: skill_install binds mode and content fingerprint (S41)", () => {
  const pathBind = SecurityPolicy.bindingPayloadFor("skill_install", {
    path: "/tmp/Downloads/a",
  })
  assert.match(pathBind, /^skill_install\|path\|/)
  assert.ok(pathBind.includes("/tmp/Downloads/a"))
  const contentBind = SecurityPolicy.bindingPayloadFor("skill_install", {
    content: "---\nname: x\n---\nbody",
  })
  assert.match(contentBind, /^skill_install\|content\|/)
  assert.ok(contentBind.includes("len="))
  const contentBind2 = SecurityPolicy.bindingPayloadFor("skill_install", {
    content: "---\nname: y\n---\nother",
  })
  assert.notEqual(contentBind, contentBind2)
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

/**
 * GATE2: stop_all / cancel mid-confirm — rejectForWorker settles L2, frees admission+flight
 * via the same finally pattern as production; zombie approve cannot re-HARD FREE tab.
 */
test("GATE2: rejectForWorker mid-confirm clears admission; zombie approve no-op", async () => {
  _resetL2AdmissionForTests()
  _resetFlightsForTests()
  _resetTabLeasesForTests()

  const mgr = new SecurityConfirmationManager(60_000)
  const workerId = "worker-cancel-me"
  let resolvedApproved: boolean | undefined

  // Simulate L2 path: admission + SOFT + flight + pending confirm
  const admit = await acquireL2Admission({ orchestratorRunId: "run-x", threadId: workerId })
  assert.equal(admit.ok, true)
  assert.equal(tryAcquireFlight("shell_exec", workerId).ok, true)
  const soft = acquireOrRenewTabLease({
    tabId: 5,
    holderThreadId: workerId,
    needsL2: true,
    confirmId: "tool-call-1",
  })
  assert.equal(soft.ok, true)

  const confirmPromise = mgr
    .request(
      () => {
        /* sink */
      },
      {
        toolName: "evaluate",
        dangerousApis: [],
        code: "1+1",
        workerId,
        tabId: 5,
      },
    )
    .then((d) => {
      resolvedApproved = d.approved
      return d
    })

  assert.equal(mgr.pendingCount(workerId), 1)
  assert.equal(l2AdmissionSnapshot().active_global, 1)
  assert.equal(isFlightBusy("shell_exec").busy, true)

  // Cancel path order: rejectForWorker → pending tools → pending-aware lease release
  const n = mgr.rejectForWorker(workerId, "denied")
  assert.equal(n, 1)
  assert.equal(mgr.pendingCount(workerId), 0)

  const decision = await confirmPromise
  assert.equal(decision.approved, false)
  assert.equal(resolvedApproved, false)

  // Production L2 finally after request settles
  if (admit.ok) releaseL2Admission(admit.key)
  releaseFlight("shell_exec", workerId)
  releaseLeasesForThreadPendingAware(workerId, "fleet.stop_all")

  assert.equal(l2AdmissionSnapshot().active_global, 0)
  assert.deepEqual(flightSnapshot(), {})
  assert.equal(getTabLease(5), null)

  // Zombie approve path: hard reacquire on FREE → POST_CONFIRM_CANCELLED
  const zombie = hardReacquireAfterConfirm({
    tabId: 5,
    holderThreadId: workerId,
    confirmId: "tool-call-1",
  })
  assert.equal(zombie.ok, false)
  if (!zombie.ok) assert.equal(zombie.error_code, "POST_CONFIRM_CANCELLED")
  // Peer exclusivity: free tab can be taken by peer after cancel drain
  const peer = acquireOrRenewTabLease({ tabId: 5, holderThreadId: "worker-peer", needsL2: false })
  assert.equal(peer.ok, true)
})

test("GATE2: respond after rejectForWorker is unknown (zombie approve no-op)", async () => {
  const mgr = new SecurityConfirmationManager(60_000)
  let confirmId = ""
  const p = mgr.request(
    (data: any) => {
      if (data?.type === "security.confirmation.request") confirmId = data.confirmation_id
    },
    { toolName: "evaluate", dangerousApis: [], code: "x", workerId: "w-z" },
  )
  // Allow request to register
  await Promise.resolve()
  assert.ok(confirmId)
  assert.equal(mgr.rejectForWorker("w-z", "denied"), 1)
  await p
  // Zombie client approve after cancel
  const r = mgr.respondFrom(confirmId, true)
  assert.equal(r.outcome, "unknown")
})

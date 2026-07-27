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
  _resetFlightsForTests,
} from "../src/orchestrator/single-flight"

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

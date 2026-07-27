import test from "node:test"
import assert from "node:assert/strict"
import {
  acquireOrRenewTabLease,
  hardReacquireAfterConfirm,
  releaseSoftOrPendingL2,
  releaseAllLeasesForThread,
  listTabLocks,
  _resetTabLeasesForTests,
  getTabLease,
} from "../src/orchestrator/tab-lease"
import { computeWorkerWhitelist, WORKER_HARD_DENY } from "../src/orchestrator"

function reset() {
  _resetTabLeasesForTests()
}

test("grants exclusive HARD lease and blocks other holder", () => {
  reset()
  const a = acquireOrRenewTabLease({ tabId: 1, holderThreadId: "w1", needsL2: false })
  assert.equal(a.ok, true)
  const b = acquireOrRenewTabLease({ tabId: 1, holderThreadId: "w2", needsL2: false })
  assert.equal(b.ok, false)
  if (!b.ok) {
    assert.equal(b.error_code, "TAB_LOCKED")
    assert.equal(b.holder_thread_id, "w1")
  }
})

test("SOFT_RESERVED is exclusive (Q1 mutual exclusion)", () => {
  reset()
  const a = acquireOrRenewTabLease({
    tabId: 5,
    holderThreadId: "w1",
    needsL2: true,
    confirmId: "c1",
  })
  assert.equal(a.ok, true)
  if (a.ok) assert.equal(a.lease.state, "SOFT_RESERVED")

  const b = acquireOrRenewTabLease({
    tabId: 5,
    holderThreadId: "w2",
    needsL2: true,
    confirmId: "c2",
  })
  assert.equal(b.ok, false)
  if (!b.ok) assert.equal(b.error_code, "TAB_BUSY_CONFIRMING")
})

test("hard re-acquire after confirm promotes soft to HARD", () => {
  reset()
  acquireOrRenewTabLease({ tabId: 2, holderThreadId: "w1", needsL2: true, confirmId: "c" })
  const h = hardReacquireAfterConfirm({ tabId: 2, holderThreadId: "w1", confirmId: "c" })
  assert.equal(h.ok, true)
  if (h.ok) assert.equal(h.lease.state, "HARD_HELD")
})

test("deny soft releases; deny HELD_PENDING_L2 keeps HARD", () => {
  reset()
  acquireOrRenewTabLease({ tabId: 3, holderThreadId: "w1", needsL2: false })
  acquireOrRenewTabLease({
    tabId: 3,
    holderThreadId: "w1",
    needsL2: true,
    confirmId: "c2",
  })
  assert.equal(getTabLease(3)?.state, "HELD_PENDING_L2")
  releaseSoftOrPendingL2({ tabId: 3, holderThreadId: "w1" })
  assert.equal(getTabLease(3)?.state, "HARD_HELD")

  acquireOrRenewTabLease({ tabId: 4, holderThreadId: "w1", needsL2: true, confirmId: "c3" })
  releaseSoftOrPendingL2({ tabId: 4, holderThreadId: "w1" })
  assert.equal(getTabLease(4), null)
})

test("same holder can renew HARD", () => {
  reset()
  acquireOrRenewTabLease({ tabId: 7, holderThreadId: "w1", needsL2: false })
  const r = acquireOrRenewTabLease({ tabId: 7, holderThreadId: "w1", needsL2: false })
  assert.equal(r.ok, true)
})

test("releaseAllLeasesForThread frees all", () => {
  reset()
  acquireOrRenewTabLease({ tabId: 10, holderThreadId: "w1", needsL2: false })
  acquireOrRenewTabLease({ tabId: 11, holderThreadId: "w1", needsL2: false })
  assert.equal(releaseAllLeasesForThread("w1", "cancel"), 2)
  assert.equal(listTabLocks().length, 0)
})

test("computeWorkerWhitelist strips HARD_DENY but keeps evaluate", () => {
  const wl = computeWorkerWhitelist({
    parentWhitelist: null,
    roleAllow: ["evaluate", "click", "shell_exec", "host_computer", "list_tabs"],
  })
  assert.ok(wl.includes("evaluate"))
  assert.ok(wl.includes("click"))
  assert.ok(!wl.includes("shell_exec"))
  assert.ok(!wl.includes("host_computer"))
  assert.equal(WORKER_HARD_DENY.has("evaluate"), false)
})

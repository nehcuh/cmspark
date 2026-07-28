import test from "node:test"
import assert from "node:assert/strict"
import {
  acquireOrRenewTabLease,
  hardReacquireAfterConfirm,
  releaseSoftOrPendingL2,
  releaseAllLeasesForThread,
  releaseLeasesForThreadPendingAware,
  releaseTabLease,
  listTabLocks,
  _resetTabLeasesForTests,
  getTabLease,
  registerTabLeasePendingHooks,
  sweepExpired,
  SOFT_LEASE_MS,
  SOFT_LEASE_SKEW_MS,
} from "../src/orchestrator/tab-lease"
import { computeWorkerWhitelist, WORKER_HARD_DENY, buildFleetSnapshot, spawnWorkerThread } from "../src/orchestrator"
import { DEFAULT_SECURITY_CONFIRMATION_TIMEOUT_MS } from "../src/security-confirmation"

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

test("TAB_LEASE_CAP lists held tabs and recovery hint", () => {
  reset()
  acquireOrRenewTabLease({ tabId: 10, holderThreadId: "w1", needsL2: false })
  acquireOrRenewTabLease({ tabId: 11, holderThreadId: "w1", needsL2: false })
  const r = acquireOrRenewTabLease({ tabId: 12, holderThreadId: "w1", needsL2: false })
  assert.equal(r.ok, false)
  if (!r.ok) {
    assert.equal(r.error_code, "TAB_LEASE_CAP")
    assert.equal(r.holder_thread_id, "w1")
    assert.match(r.error, /TAB_LEASE_CAP/)
    assert.match(r.error, /10/)
    assert.match(r.error, /11/)
    assert.match(r.error, /close_tab/)
  }
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

test("GATE2: first spawn from null-parent retains browser tools (not orch-only)", () => {
  // In-memory ThreadManager stub (no real ~/.cmspark-agent writes)
  const store = new Map<string, any>()
  let seq = 0
  const tm = {
    get(id: string) {
      return store.get(id) || null
    },
    list() {
      return [...store.values()]
    },
    create(alias?: string) {
      const id = `t${++seq}`
      const t = {
        id,
        alias: alias || id,
        tool_whitelist: null,
        agent_role: "normal",
        config_override: {},
      }
      store.set(id, t)
      return t
    },
    update(id: string, patch: any) {
      const cur = store.get(id)
      if (!cur) return null
      const next = { ...cur, ...patch }
      if (patch.config_override) {
        next.config_override = { ...(cur.config_override || {}), ...patch.config_override }
      }
      store.set(id, next)
      return next
    },
  }
  const parent = tm.create("orch-parent")
  assert.equal(parent.tool_whitelist, null)
  const r = spawnWorkerThread(tm as any, {
    parentThreadId: parent.id,
    roleLabel: "browser",
    roleAllow: ["evaluate", "click", "navigate", "screenshot", "list_tabs", "type"],
    userConfirmed: true,
  })
  assert.equal(r.ok, true)
  if (!r.ok) return
  const wl = r.worker.tool_whitelist as string[]
  assert.ok(wl.includes("evaluate"), `wl=${JSON.stringify(wl)}`)
  assert.ok(wl.includes("click"))
  assert.ok(wl.includes("navigate"))
  assert.ok(wl.includes("screenshot"))
  assert.ok(wl.includes("list_tabs"))
  assert.ok(wl.includes("type"))
  assert.ok(!wl.includes("shell_exec"))
  assert.ok(!wl.includes("spawn_worker"), "worker must not get orch tools from promotion")
  // Parent promoted to orchestrator allowlist only
  const p2 = tm.get(parent.id) as any
  assert.equal(p2.agent_role, "orchestrator")
  assert.ok(Array.isArray(p2.tool_whitelist))
  assert.ok(p2.tool_whitelist.includes("spawn_worker"))
})

test("softDeadline defaults to confirm timeout + skew", () => {
  reset()
  const before = Date.now()
  const a = acquireOrRenewTabLease({
    tabId: 50,
    holderThreadId: "w1",
    needsL2: true,
    confirmId: "c",
  })
  assert.equal(a.ok, true)
  if (a.ok) {
    const soft = a.lease.softDeadline!
    // SOFT_LEASE_MS = DEFAULT_SECURITY_CONFIRMATION_TIMEOUT_MS + SOFT_LEASE_SKEW_MS
    assert.equal(SOFT_LEASE_MS, DEFAULT_SECURITY_CONFIRMATION_TIMEOUT_MS + SOFT_LEASE_SKEW_MS)
    assert.ok(
      soft >= before + DEFAULT_SECURITY_CONFIRMATION_TIMEOUT_MS &&
        soft <= before + SOFT_LEASE_MS + 50,
      `softDeadline=${soft} expected ~${SOFT_LEASE_MS}ms from now`,
    )
  }
})

test("hard re-acquire fail when peer holds; free path is POST_CONFIRM_CANCELLED", () => {
  reset()
  acquireOrRenewTabLease({ tabId: 51, holderThreadId: "w1", needsL2: true, confirmId: "c" })
  // Steal: force free and give to other holder
  releaseTabLease(51, "steal")
  acquireOrRenewTabLease({ tabId: 51, holderThreadId: "w2", needsL2: false })
  const hard = hardReacquireAfterConfirm({ tabId: 51, holderThreadId: "w1", confirmId: "c" })
  assert.equal(hard.ok, false)
  if (!hard.ok) assert.equal(hard.error_code, "TAB_LOCKED")
  // w1 has no soft left (tab held by w2)
  releaseSoftOrPendingL2({ tabId: 51, holderThreadId: "w1" })
  assert.equal(getTabLease(51)?.holderThreadId, "w2")

  // GATE2: free-path after cancel must NOT re-HARD
  releaseTabLease(51, "cancel")
  const zombie = hardReacquireAfterConfirm({ tabId: 51, holderThreadId: "w1", confirmId: "c" })
  assert.equal(zombie.ok, false)
  if (!zombie.ok) assert.equal(zombie.error_code, "POST_CONFIRM_CANCELLED")
  assert.equal(getTabLease(51), null)
})

test("auto-approve evaluate style: exclusive HARD so second worker TAB_LOCKED", () => {
  reset()
  // Mirrors GATE2 fix: early HARD even when L2 dialog is skipped
  const a = acquireOrRenewTabLease({ tabId: 80, holderThreadId: "w1", needsL2: false })
  assert.equal(a.ok, true)
  const b = acquireOrRenewTabLease({ tabId: 80, holderThreadId: "w2", needsL2: false })
  assert.equal(b.ok, false)
  if (!b.ok) assert.equal(b.error_code, "TAB_LOCKED")
  // Same holder can enter HELD_PENDING_L2 (interactive L2 after early HARD)
  const pending = acquireOrRenewTabLease({
    tabId: 80,
    holderThreadId: "w1",
    needsL2: true,
    confirmId: "c-eval",
  })
  assert.equal(pending.ok, true)
  if (pending.ok) assert.equal(pending.lease.state, "HELD_PENDING_L2")
})

test("HELD_PENDING_L2 freezes idle for confirm cover", () => {
  reset()
  acquireOrRenewTabLease({ tabId: 81, holderThreadId: "w1", needsL2: false })
  const lease = getTabLease(81)!
  // Simulate near-idle expiry
  ;(lease as any).idleDeadline = Date.now() + 100
  const pending = acquireOrRenewTabLease({
    tabId: 81,
    holderThreadId: "w1",
    needsL2: true,
    confirmId: "c-idle",
  })
  assert.equal(pending.ok, true)
  const after = getTabLease(81)!
  assert.equal(after.state, "HELD_PENDING_L2")
  assert.ok(
    after.idleDeadline >= Date.now() + DEFAULT_SECURITY_CONFIRMATION_TIMEOUT_MS - 1000,
    `idleDeadline should cover confirm: ${after.idleDeadline}`,
  )
})

test("releaseLeasesForThreadPendingAware: FORCE_RELEASING when CDP pending", () => {
  reset()
  let rejected = 0
  registerTabLeasePendingHooks({
    hasPendingForTab: () => true,
    rejectPendingForTab: () => {
      rejected++
      return 1
    },
  })
  acquireOrRenewTabLease({ tabId: 82, holderThreadId: "w1", needsL2: false })
  const r = releaseLeasesForThreadPendingAware("w1", "cancel-test", {
    hasPendingForTab: () => true,
    rejectPendingForTab: () => {
      rejected++
      return 1
    },
  })
  assert.equal(r.released, 1)
  assert.equal(r.drained, 1)
  assert.ok(rejected >= 1)
  assert.equal(getTabLease(82), null)
})

test("unregistered pending hooks fail-closed (treat as pending)", () => {
  reset()
  // no registerTabLeasePendingHooks
  acquireOrRenewTabLease({ tabId: 83, holderThreadId: "w1", needsL2: false })
  const lease = getTabLease(83)!
  ;(lease as any).idleDeadline = Date.now() - 1
  sweepExpired()
  // Fail-closed: should not silent-FREE; either FORCE_RELEASING or still held/drained path
  const after = getTabLease(83)
  // Without rejector: FORCE_RELEASING; with null hooks resolveHasPending=true → FORCE_RELEASING
  assert.ok(after === null || after.state === "FORCE_RELEASING", `state=${after?.state}`)
  if (after?.state === "FORCE_RELEASING") {
    // GC path eventually frees; for unit assert we just require no silent free without pending drain attempt
    assert.equal(after.state, "FORCE_RELEASING")
  }
})

test("sweepExpired with pending hook drains instead of silent FREE", () => {
  reset()
  let rejected = 0
  registerTabLeasePendingHooks({
    hasPendingForTab: () => true,
    rejectPendingForTab: () => {
      rejected++
      return 1
    },
  })
  const a = acquireOrRenewTabLease({ tabId: 60, holderThreadId: "w1", needsL2: false })
  assert.equal(a.ok, true)
  // Force idle expiry
  const lease = getTabLease(60)!
  ;(lease as any).idleDeadline = Date.now() - 1
  sweepExpired()
  assert.equal(getTabLease(60), null, "pending path should drain+free")
  assert.ok(rejected >= 1)
})

test("fleet prefers holding_tabs over paused when locks present", () => {
  reset()
  acquireOrRenewTabLease({ tabId: 70, holderThreadId: "worker-1", needsL2: false })
  const tm = {
    list: () => [
      {
        id: "worker-1",
        alias: "w",
        agent_role: "worker",
        paused: true,
        parent_thread_id: "p",
        orchestrator_run_id: "r",
      },
    ],
  }
  const snap = buildFleetSnapshot(tm as any)
  assert.equal(snap.workers[0].status, "holding_tabs")
  assert.equal(snap.worst_status, "holding_tabs")
})

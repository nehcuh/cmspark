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
  noteMutationHold,
  releaseMutationHold,
  clearCreatedHold,
  armCreatedTabHold,
  settleTimedOutLease,
  SOFT_LEASE_MS,
  SOFT_LEASE_SKEW_MS,
} from "../src/orchestrator/tab-lease"
import { ORCHESTRATOR_CAPS, TAB_LEASE_TOOLS, TAB_MUTATION_LEASE_TOOLS } from "../src/orchestrator/constants"
import { computeWorkerWhitelist, WORKER_HARD_DENY, buildFleetSnapshot, spawnWorkerThread } from "../src/orchestrator"
import { runMultiAgentToolPregate } from "../src/orchestrator/tool-pregate"
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
    roleAllow: ["evaluate", "click", "shell_exec", "host_computer", "list_tabs", "spawn_worker", "board_read"],
  })
  assert.ok(wl.includes("evaluate"))
  assert.ok(wl.includes("click"))
  assert.ok(!wl.includes("shell_exec"))
  assert.ok(!wl.includes("host_computer"))
  assert.ok(!wl.includes("spawn_worker"), "control-plane tools hard-denied")
  assert.ok(!wl.includes("board_read"))
  assert.equal(WORKER_HARD_DENY.has("evaluate"), false)
  assert.ok(WORKER_HARD_DENY.has("spawn_worker"))
})

test("second spawn from orchestrator parent does not inherit orch control tools", () => {
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
      store.set(id, next)
      return next
    },
  }
  const parent = tm.create("orch")
  const r1 = spawnWorkerThread(tm as any, {
    parentThreadId: parent.id,
    roleAllow: ["click", "navigate", "list_tabs"],
    userConfirmed: true,
  })
  assert.equal(r1.ok, true)
  // Parent is now orchestrator with control allowlist
  const p = tm.get(parent.id) as any
  assert.equal(p.agent_role, "orchestrator")
  // Second spawn without roleAllow must not get spawn_worker / board_*
  const r2 = spawnWorkerThread(tm as any, {
    parentThreadId: parent.id,
    userConfirmed: true,
  })
  assert.equal(r2.ok, true)
  if (!r2.ok) return
  const wl = r2.worker.tool_whitelist as string[]
  assert.ok(!wl.includes("spawn_worker"))
  assert.ok(!wl.includes("board_read"))
  assert.ok(!wl.includes("wait_workers"))
  assert.ok(wl.includes("list_tabs") || wl.includes("click") || wl.includes("navigate"))
})

test("worker parent cannot spawn nested workers", () => {
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
      store.set(id, next)
      return next
    },
  }
  const parent = tm.create("orch")
  const r1 = spawnWorkerThread(tm as any, {
    parentThreadId: parent.id,
    roleAllow: ["click"],
    userConfirmed: true,
  })
  assert.equal(r1.ok, true)
  if (!r1.ok) return
  const rNest = spawnWorkerThread(tm as any, {
    parentThreadId: r1.worker.id,
    roleAllow: ["click"],
    userConfirmed: true,
  })
  assert.equal(rNest.ok, false)
  if (rNest.ok) return
  assert.match(rNest.error, /nested|worker/i)
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
  // Fail-closed pending (hooks unregistered) must not idle-FREE or idle-drain.
  const after = getTabLease(83)
  assert.equal(after?.state, "HARD_HELD")
})

test("idle expiry does not drain a per-call lease that still has pending", () => {
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
  const lease = getTabLease(60)!
  ;(lease as any).idleDeadline = Date.now() - 1
  sweepExpired()
  assert.equal(getTabLease(60)?.state, "HARD_HELD")
  assert.equal(rejected, 0)
})

test("hard_max still rejects live pending and frees a per-call lease", () => {
  reset()
  let rejected = 0
  registerTabLeasePendingHooks({
    hasPendingForTab: () => true,
    rejectPendingForTab: () => {
      rejected++
      return 1
    },
  })
  acquireOrRenewTabLease({ tabId: 61, holderThreadId: "w1", needsL2: false })
  const lease = getTabLease(61)!
  ;(lease as any).hardMaxDeadline = Date.now() - 1
  sweepExpired()
  assert.equal(getTabLease(61), null)
  assert.ok(rejected >= 1)
})

test("fleet drops tab leases when a worker run has ended and was not paused", () => {
  reset()
  acquireOrRenewTabLease({ tabId: 71, holderThreadId: "worker-done", needsL2: false })
  acquireOrRenewTabLease({ tabId: 72, holderThreadId: "worker-paused", needsL2: false })
  const tm = {
    list: () => [
      {
        id: "worker-done",
        alias: "done",
        agent_role: "worker",
        paused: false,
        parent_thread_id: "p",
      },
      {
        id: "worker-paused",
        alias: "paused",
        agent_role: "worker",
        paused: true,
        parent_thread_id: "p",
      },
    ],
  }
  const snap = buildFleetSnapshot(tm as any)
  const done = snap.workers.find((w) => w.id === "worker-done")
  const paused = snap.workers.find((w) => w.id === "worker-paused")
  assert.equal(done?.status, "idle")
  assert.equal(done?.tab_locks.length, 0)
  assert.equal(paused?.status, "holding_tabs")
  assert.equal(paused?.tab_locks.length, 1)
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

test("fleet open_intents_by_run scopes board intents by orchestrator_run_id", () => {
  reset()
  const tm = {
    list: () => [
      {
        id: "host-r1",
        alias: "h1",
        agent_role: "orchestrator",
        orchestrator_run_id: "run-a",
        mission_board: {
          intents: [
            { status: "open" },
            { status: "claimed" },
            { status: "done" },
          ],
        },
      },
      {
        id: "host-r2",
        alias: "h2",
        agent_role: "orchestrator",
        orchestrator_run_id: "run-b",
        mission_board: {
          intents: [{ status: "open" }],
        },
      },
      {
        id: "worker-a",
        alias: "w",
        agent_role: "worker",
        parent_thread_id: "host-r1",
        orchestrator_run_id: "run-a",
      },
    ],
    get: (id: string) => {
      const all = tm.list()
      return all.find((t: { id: string }) => t.id === id)
    },
  }
  const snap = buildFleetSnapshot(tm as any)
  assert.equal(snap.open_intent_count, 3)
  assert.equal(snap.open_intents_by_run["run-a"], 2)
  assert.equal(snap.open_intents_by_run["run-b"], 1)
  assert.equal(snap.open_intents_by_run["missing"], undefined)
})

test("reads stay in the identity set and are not mutation leases", () => {
  for (const name of ["get_page_text", "get_page_html", "wait_for"]) {
    assert.equal(TAB_LEASE_TOOLS.has(name), true, name)
    assert.equal(TAB_MUTATION_LEASE_TOOLS.has(name), false, name)
  }
  assert.equal(TAB_MUTATION_LEASE_TOOLS.has("evaluate"), true)
  assert.equal(TAB_MUTATION_LEASE_TOOLS.has("get_element_info"), true)
  assert.equal(ORCHESTRATOR_CAPS.create_tab_auto_hold_ms, 60_000)
})

test("mutation hold releases when the call ends and no create hold remains", () => {
  reset()
  registerTabLeasePendingHooks({ hasPendingForTab: () => false })
  acquireOrRenewTabLease({ tabId: 90, holderThreadId: "w1", needsL2: false })
  noteMutationHold(90, "w1")
  releaseMutationHold(90, "w1")
  assert.equal(getTabLease(90), null)
})

test("create_tab hold survives the creating call and a later idle renew", () => {
  reset()
  registerTabLeasePendingHooks({ hasPendingForTab: () => false })
  acquireOrRenewTabLease({ tabId: 91, holderThreadId: "w1", needsL2: false })
  armCreatedTabHold(91, "w1", 60_000)
  noteMutationHold(91, "w1")
  releaseMutationHold(91, "w1")
  const held = getTabLease(91)
  assert.ok(held, "create hold keeps the lease")
  assert.ok(held!.createdHoldUntil && held!.createdHoldUntil > Date.now())
  // A later mutation renews idle past the create deadline.
  acquireOrRenewTabLease({ tabId: 91, holderThreadId: "w1", needsL2: false })
  const renewed = getTabLease(91)!
  renewed.idleDeadline = Date.now() + 120_000
  renewed.createdHoldUntil = Date.now() - 1
  sweepExpired()
  assert.equal(getTabLease(91), null)
})

test("releaseMutationHold ignores a different holder", () => {
  reset()
  registerTabLeasePendingHooks({ hasPendingForTab: () => false })
  acquireOrRenewTabLease({ tabId: 92, holderThreadId: "w1", needsL2: false })
  noteMutationHold(92, "w1")
  releaseMutationHold(92, "w2")
  assert.equal(getTabLease(92)?.mutationHolds, 1)
  assert.equal(getTabLease(92)?.holderThreadId, "w1")
})

test("hard reacquire keeps the mutation count", () => {
  reset()
  acquireOrRenewTabLease({ tabId: 93, holderThreadId: "w1", needsL2: false })
  noteMutationHold(93, "w1")
  acquireOrRenewTabLease({ tabId: 93, holderThreadId: "w1", needsL2: true, confirmId: "c" })
  const promoted = hardReacquireAfterConfirm({ tabId: 93, holderThreadId: "w1" })
  assert.equal(promoted.ok, true)
  assert.equal(getTabLease(93)?.mutationHolds, 1)
  assert.equal(getTabLease(93)?.state, "HARD_HELD")
})

test("pending blocks release until the tombstone is settled", () => {
  reset()
  let pending = true
  registerTabLeasePendingHooks({ hasPendingForTab: () => pending })
  acquireOrRenewTabLease({ tabId: 94, holderThreadId: "w1", needsL2: false })
  noteMutationHold(94, "w1")
  releaseMutationHold(94, "w1")
  assert.equal(getTabLease(94)?.state, "HARD_HELD")
  assert.equal(getTabLease(94)?.mutationHolds, 0)
  pending = false
  settleTimedOutLease(94, "w1")
  assert.equal(getTabLease(94), null)
})

test("settle does not free an outbound episode lease", () => {
  reset()
  registerTabLeasePendingHooks({ hasPendingForTab: () => false })
  acquireOrRenewTabLease({ tabId: 95, holderThreadId: "outbound_mcp:caller", needsL2: false })
  settleTimedOutLease(95, "outbound_mcp:caller")
  releaseMutationHold(95, "outbound_mcp:caller")
  assert.equal(getTabLease(95)?.holderThreadId, "outbound_mcp:caller")
})

test("outbound idle expiry still drains pending", () => {
  reset()
  let rejected = 0
  registerTabLeasePendingHooks({
    hasPendingForTab: () => true,
    rejectPendingForTab: () => {
      rejected++
      return 1
    },
  })
  acquireOrRenewTabLease({ tabId: 97, holderThreadId: "outbound_mcp:caller", needsL2: false })
  const lease = getTabLease(97)!
  lease.idleDeadline = Date.now() - 1
  sweepExpired()
  assert.equal(getTabLease(97), null)
  assert.ok(rejected >= 1)
})

test("a read is not blocked by another worker holding the tab", async () => {
  reset()
  registerTabLeasePendingHooks({ hasPendingForTab: () => false })
  const tm = {
    get: (id: string) => ({
      id,
      agent_role: id === "p" ? "orchestrator" : "worker",
      parent_thread_id: id === "p" ? null : "p",
    }),
    isToolAllowed: () => true,
  }
  const gate = {
    toolCallId: "c",
    startedAt: Date.now(),
    isOutboundMcpCall: false,
    logToolFinish: () => {},
    getThreadManager: () => tm as any,
    hasPendingForTab: () => false,
    toolDisplayNameZh: (n: string) => n,
  }
  const held = await runMultiAgentToolPregate({
    ...gate,
    toolName: "click",
    finalParams: { tabId: 7 },
    actingThreadId: "w1",
  })
  assert.equal(held.ok, true)
  if (held.ok) assert.deepEqual(held.releaseMutationHold, { tabId: 7, holderThreadId: "w1" })
  assert.equal(getTabLease(7)?.mutationHolds, 1)

  const read = await runMultiAgentToolPregate({
    ...gate,
    toolName: "get_page_text",
    finalParams: { tabId: 7 },
    toolCallId: "r",
    actingThreadId: "w2",
  })
  assert.equal(read.ok, true)
  if (read.ok) assert.equal(read.releaseMutationHold, undefined)
  assert.equal(getTabLease(7)?.holderThreadId, "w1")

  const blocked = await runMultiAgentToolPregate({
    ...gate,
    toolName: "click",
    finalParams: { tabId: 7 },
    toolCallId: "c2",
    actingThreadId: "w2",
  })
  assert.equal(blocked.ok, false)
})

test("clearCreatedHold lets the in-flight mutation finally free the tab", () => {
  reset()
  registerTabLeasePendingHooks({ hasPendingForTab: () => false })
  acquireOrRenewTabLease({ tabId: 96, holderThreadId: "w1", needsL2: false })
  armCreatedTabHold(96, "w1", 60_000)
  noteMutationHold(96, "w1")
  clearCreatedHold(96, "w1")
  releaseMutationHold(96, "w1")
  assert.equal(getTabLease(96), null)
})

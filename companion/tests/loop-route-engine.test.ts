/**
 * #389 L-3: route-directive steer, ignore→blocked, R3 unarmed, budgets,
 * IMPOSSIBLE report, checkpoint restore.
 */
import test from "node:test"
import assert from "node:assert/strict"
import {
  ROUTE_BUDGETS,
  beginRouteRun,
  buildImpossibleReport,
  buildSteerText,
  classifyToolRoute,
  closeRouteRun,
  emptyRouteEngineState,
  formatSteerPrompt,
  isPostEscalateAlternative,
  maxTotalSteers,
  noteDeclaredBlocked,
  noteTool,
  restoreAfterUnlock,
  snapshotCheckpoint,
  type RouteEngineState,
} from "../src/loop/route-engine"
import type { RunProgress } from "../src/threads/run-progress"
import { SITE_ORIGIN_FAIL_ESCALATE, recordSiteOpFailure, resetSiteOpMemoryForTests } from "../src/tool/site-op-memory"
import {
  _resetRouteSessionsForTests,
  isOriginEscalated,
  onRouteChatBegin,
  onRouteChatEnd,
  onRouteDeclaredBlocked,
  onRouteTool,
  peekPendingSteers,
  peekRouteState,
  unlockRouteItem,
} from "../src/loop/route-session"
import { getConfig } from "../src/config"

function progress(done = false): RunProgress {
  return {
    items: [{ id: "live:0", text: "提交表单", source: "seed", done, tool: "click" }],
  }
}

function caps(cuArmed: boolean, osascriptAvailable = false) {
  return { cuArmed, osascriptAvailable }
}

function runCdp(state: RouteEngineState, n = 1): RouteEngineState {
  let s = state
  for (let i = 0; i < n; i++) s = noteTool(s, "click")
  return s
}

test("evaluate / spawn_worker are not on the strategy chain", () => {
  assert.equal(classifyToolRoute("evaluate"), null)
  assert.equal(classifyToolRoute("spawn_worker"), null)
  assert.equal(classifyToolRoute("click"), "cdp-dom")
  assert.equal(classifyToolRoute("host_computer"), "host_computer")
  assert.equal(isPostEscalateAlternative("cdp-alt"), false)
  assert.equal(isPostEscalateAlternative("host_computer"), true)
})

test("escalation + 2 runs of CDP with no progress → steer to host_computer when CU armed", () => {
  let s = emptyRouteEngineState()
  const input = {
    runProgress: progress(false),
    originEscalated: true,
    caps: caps(true),
    hadProgress: false,
  }
  s = runCdp(beginRouteRun(s, []), 1)
  let r = closeRouteRun(s, input)
  assert.equal(r.pendingSteers.length, 0, "first stale run does not steer yet")
  s = runCdp(beginRouteRun(r.state, []), 1)
  r = closeRouteRun(s, input)
  assert.equal(r.pendingSteers.length, 1)
  assert.equal(r.pendingSteers[0]!.target, "host_computer")
  assert.match(r.pendingSteers[0]!.text, /host_computer/)
  assert.match(r.pendingSteers[0]!.text, /申报 blocked/)
  assert.ok(r.audits.some((a) => a.type === "task_loop.route_steer"))
  assert.equal(r.state.totalSteers, 1)
})

test("two ignored steers → item blocked model-noncompliance", () => {
  let s = emptyRouteEngineState()
  const input = {
    runProgress: progress(false),
    originEscalated: true,
    caps: caps(true),
    hadProgress: false,
  }
  s = runCdp(beginRouteRun(s, []), 1)
  let r = closeRouteRun(s, input)
  s = runCdp(beginRouteRun(r.state, []), 1)
  r = closeRouteRun(s, input)
  const steers = r.pendingSteers
  assert.equal(steers.length, 1)

  s = runCdp(beginRouteRun(r.state, steers), 1)
  r = closeRouteRun(s, input)
  assert.ok(r.audits.some((a) => a.type === "task_loop.steer_ignored"))
  assert.equal(r.state.items["live:0"]!.ignoreCount, 1)
  assert.equal(r.state.items["live:0"]!.blocked, null)
  assert.ok(r.pendingSteers.length >= 1, "same directive is re-queued once (not a steer war)")

  s = runCdp(beginRouteRun(r.state, r.pendingSteers), 1)
  r = closeRouteRun(s, input)
  const blockedItem = r.state.items["live:0"]!
  assert.notEqual(blockedItem.blocked, null)
  assert.equal(blockedItem.blocked?.blocker_class, "model-noncompliance")
  assert.ok(r.newlyBlocked.some((b) => b.itemId === "live:0"))
})

test("CU unarmed: R3 is blocked, coordinateEnabled is not flipped", () => {
  const before = getConfig().computer?.coordinateEnabled
  let s = emptyRouteEngineState()
  const input = {
    runProgress: progress(false),
    originEscalated: true,
    caps: caps(false),
    hadProgress: false,
  }
  s = runCdp(beginRouteRun(s, []), 1)
  let r = closeRouteRun(s, input)
  s = runCdp(beginRouteRun(r.state, []), 1)
  r = closeRouteRun(s, input)
  assert.equal(r.pendingSteers.length, 0, "must not steer into secretly enabling CU")
  assert.ok(r.state.items["live:0"]!.blocked)
  assert.match(r.state.items["live:0"]!.blocked!.unlock.detail, /coordinateEnabled/)
  assert.match(r.state.items["live:0"]!.blocked!.unlock.detail, /never flip/i)
  assert.equal(getConfig().computer?.coordinateEnabled, before)
  assert.ok(r.audits.some((a) => a.reason === "r3-unarmed"))
})

test("trying host_computer after steer is obedience, not ignore", () => {
  let s = emptyRouteEngineState()
  const input = {
    runProgress: progress(false),
    originEscalated: true,
    caps: caps(true),
    hadProgress: false,
  }
  s = runCdp(beginRouteRun(s, []), 1)
  let r = closeRouteRun(s, input)
  s = runCdp(beginRouteRun(r.state, []), 1)
  r = closeRouteRun(s, input)
  s = noteTool(beginRouteRun(r.state, r.pendingSteers), "host_computer")
  r = closeRouteRun(s, { ...input, hadProgress: false })
  assert.equal(r.state.items["live:0"]!.ignoreCount, 0)
  assert.equal(r.state.items["live:0"]!.blocked, null)
})

test("declare blocked is obedience and records human route", () => {
  let s = emptyRouteEngineState()
  const input = {
    runProgress: progress(false),
    originEscalated: true,
    caps: caps(true),
    hadProgress: false,
  }
  s = runCdp(beginRouteRun(s, []), 1)
  let r = closeRouteRun(s, input)
  s = runCdp(beginRouteRun(r.state, []), 1)
  r = closeRouteRun(s, input)
  s = noteDeclaredBlocked(beginRouteRun(r.state, r.pendingSteers), "live:0")
  s = noteTool(s, "loop_declare_blocked")
  r = closeRouteRun(s, input)
  assert.equal(r.state.items["live:0"]!.ignoreCount, 0)
  assert.ok(r.state.items["live:0"]!.blocked)
  assert.equal(r.newlyBlocked[0]!.itemId, "live:0")
})

test("steer budgets: per-item steer ≤2 and total ≤ runs/2", () => {
  assert.equal(maxTotalSteers(3), 1)
  assert.equal(maxTotalSteers(4), 2)
  assert.equal(ROUTE_BUDGETS.steerPerItem, 2)
  assert.equal(ROUTE_BUDGETS.crossClassPerItem, 2)
})

test("IMPOSSIBLE report lists blocked items with tried routes and unlock", () => {
  let s = emptyRouteEngineState()
  const input = {
    runProgress: progress(false),
    originEscalated: true,
    caps: caps(false),
    hadProgress: false,
  }
  s = runCdp(beginRouteRun(s, []), 1)
  let r = closeRouteRun(s, input)
  s = runCdp(beginRouteRun(r.state, []), 1)
  r = closeRouteRun(s, input)
  const report = buildImpossibleReport(r.state)
  assert.equal(report.kind, "impossible-report")
  assert.equal(report.items.length, 1)
  assert.equal(report.items[0]!.item_id, "live:0")
  assert.ok(report.items[0]!.tried_routes.length >= 1)
  assert.ok(report.items[0]!.unlock.detail)
})

test("checkpoint restore after matching unlock action", () => {
  let s = emptyRouteEngineState()
  const input = {
    runProgress: progress(false),
    originEscalated: true,
    caps: caps(false),
    hadProgress: false,
  }
  s = runCdp(beginRouteRun(s, []), 1)
  let r = closeRouteRun(s, input)
  s = runCdp(beginRouteRun(r.state, []), 1)
  r = closeRouteRun(s, input)
  const action = r.state.items["live:0"]!.blocked!.unlock.action
  const snap = snapshotCheckpoint(r.state)
  assert.ok(snap.items["live:0"]!.blocked)
  const restored = restoreAfterUnlock(r.state, { itemId: "live:0", action })
  assert.equal(restored.ok, true)
  if (!restored.ok) return
  assert.equal(restored.state.items["live:0"]!.blocked, null)
  assert.equal(restored.state.items["live:0"]!.ignoreCount, 0)
  const bad = restoreAfterUnlock(r.state, { itemId: "live:0", action: "approve-confirm" })
  assert.equal(bad.ok, false)
})

test("steer prompt forbids enabling computer.use", () => {
  const text = buildSteerText({
    itemId: "live:0",
    itemText: "提交",
    target: "host_computer",
    cuArmed: true,
  })
  assert.match(text, /L2/)
  assert.doesNotMatch(text, /set coordinateEnabled/)
  const prompt = formatSteerPrompt([
    { itemId: "live:0", itemText: "提交", target: "host_computer", text },
  ])
  assert.match(prompt, /Do not enable computer.use/)
})

test("session: originFails≥4 + 2 CDP runs injects steer and audits", () => {
  resetSiteOpMemoryForTests()
  _resetRouteSessionsForTests()
  const threadId = "t-389-steer"
  const origin = "https://example.com"
  for (let i = 0; i < SITE_ORIGIN_FAIL_ESCALATE; i++) {
    recordSiteOpFailure(threadId, "click", { tabId: 1 }, "ELEMENT_NOT_FOUND", origin)
  }
  assert.equal(isOriginEscalated(threadId), true)

  const rp = progress(false)
  onRouteChatBegin(threadId, "normal")
  onRouteTool(threadId, "click")
  onRouteChatEnd(threadId, { runProgress: rp, agentRole: "normal" })
  assert.equal(peekPendingSteers(threadId).length, 0)

  onRouteChatBegin(threadId, "normal")
  onRouteTool(threadId, "click")
  onRouteChatEnd(threadId, { runProgress: rp, agentRole: "normal" })
  const steers = peekPendingSteers(threadId)
  const armed = getConfig().computer?.coordinateEnabled === true
  if (armed) {
    assert.ok(steers.length >= 1)
    assert.match(steers[0]!.text, /host_computer|osascript|blocked/)
  } else {
    const st = peekRouteState(threadId)
    assert.ok(st.items["live:0"]?.blocked, "unarmed default config blocks R3")
  }
})

test("session unlock restores checkpoint without enabling CU", () => {
  resetSiteOpMemoryForTests()
  _resetRouteSessionsForTests()
  const threadId = "t-389-unlock"
  const origin = "https://shop.example"
  for (let i = 0; i < SITE_ORIGIN_FAIL_ESCALATE; i++) {
    recordSiteOpFailure(threadId, "click", { tabId: 2 }, "ELEMENT_NOT_FOUND", origin)
  }
  const rp = progress(false)
  onRouteChatBegin(threadId, "normal")
  onRouteTool(threadId, "click")
  onRouteChatEnd(threadId, { runProgress: rp })
  onRouteChatBegin(threadId, "normal")
  onRouteTool(threadId, "click")
  onRouteChatEnd(threadId, { runProgress: rp })
  const st = peekRouteState(threadId)
  const blocked = st.items["live:0"]?.blocked
  if (!blocked) {
    onRouteDeclaredBlocked(threadId, "live:0")
    onRouteChatEnd(threadId, { runProgress: rp })
  }
  const item = peekRouteState(threadId).items["live:0"]
  assert.ok(item?.blocked)
  const beforeFlag = getConfig().computer?.coordinateEnabled
  const action = item!.blocked!.unlock.action
  const u = unlockRouteItem(threadId, "live:0", action)
  assert.equal(u.ok, true)
  assert.equal(peekRouteState(threadId).items["live:0"]!.blocked, null)
  assert.equal(getConfig().computer?.coordinateEnabled, beforeFlag)
})

test("workers do not receive route steers", () => {
  _resetRouteSessionsForTests()
  const prompt = onRouteChatBegin("worker-1", "worker")
  assert.equal(prompt, "")
})

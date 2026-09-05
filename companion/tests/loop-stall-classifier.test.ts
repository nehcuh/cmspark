/**
 * #387 L-1: stall classifier — 受阻五分类归属、机器可读解锁契约、
 * 重复进度检测（连续 K=3 个 run Δ=0 → stalled 信号）、stall 卡结构。
 */
import test from "node:test"
import assert from "node:assert/strict"

import {
  buildStallCard,
  buildUnlockContract,
  classifyBlocker,
  computeRunDelta,
  countTrailingZeroDelta,
  createLedger,
  detectStall,
  recordRun,
  STALL_K,
  type BlockerClass,
  type BlockerSignal,
  type RunDelta,
} from "../src/loop/stall-classifier"
import type { RunProgress, RunProgressItem } from "../src/threads/run-progress"

function item(
  over: Partial<RunProgressItem> & Pick<RunProgressItem, "id" | "text" | "source">,
): RunProgressItem {
  return { done: false, ...over }
}

function progress(items: RunProgressItem[]): RunProgress {
  return { items }
}

test("五分类归属: every signal kind maps to its blocker class", () => {
  const cases: [BlockerSignal, BlockerClass][] = [
    [{ kind: "confirm-pending" }, "needs-human-confirm"],
    [{ kind: "confirm-denied" }, "needs-human-confirm"],
    [{ kind: "credential-missing" }, "needs-credential"],
    [{ kind: "grant-expired" }, "needs-credential"],
    [{ kind: "origin-refused" }, "external-wall"],
    [{ kind: "route-budget-exhausted" }, "route-exhausted"],
    [{ kind: "stall-persistent" }, "route-exhausted"],
    [{ kind: "steer-ignored" }, "model-noncompliance"],
  ]
  for (const [signal, expected] of cases) {
    assert.equal(classifyBlocker(signal), expected, signal.kind)
  }
})

test("解锁契约: per-class default unlock action + tried routes + failure causes", () => {
  const c = buildUnlockContract({
    signal: { kind: "origin-refused" },
    itemId: "live:1",
    triedRoutes: [
      { route: "cdp-dom", failure: "origin peek-refuse (originFails=4)" },
      { route: "cdp-fallback", failure: "selector not found" },
    ],
  })
  assert.equal(c.blocker_class, "external-wall")
  assert.equal(c.item_id, "live:1")
  assert.equal(c.unlock.action, "external-wait")
  assert.equal(c.tried_routes.length, 2)
  assert.equal(c.tried_routes[0]!.route, "cdp-dom")
  assert.match(c.tried_routes[0]!.failure, /peek-refuse/)
})

test("解锁契约: unlock actions differ per class (每类都有完成通道)", () => {
  const actions = new Set(
    (
      [
        { kind: "confirm-pending" },
        { kind: "credential-missing" },
        { kind: "origin-refused" },
        { kind: "route-budget-exhausted" },
        { kind: "steer-ignored" },
      ] as BlockerSignal[]
    ).map((s) => buildUnlockContract({ signal: s }).unlock.action),
  )
  assert.deepEqual(
    [...actions].sort(),
    ["approve-confirm", "external-wait", "provide-credential", "replan", "restate-directive"],
  )
})

test("解锁契约: run-level blocker has item_id null; detail override wins", () => {
  const c = buildUnlockContract({
    signal: { kind: "steer-ignored" },
    detail: "Model ignored 2 route directives; restate the goal.",
  })
  assert.equal(c.item_id, null)
  assert.equal(c.unlock.action, "restate-directive")
  assert.equal(c.unlock.detail, "Model ignored 2 route directives; restate the goal.")
})

test("解锁契约: confirm-denied 默认解锁是 replan（人已拒绝，不再求批准）", () => {
  const c = buildUnlockContract({ signal: { kind: "confirm-denied" }, itemId: "live:1" })
  assert.equal(c.blocker_class, "needs-human-confirm")
  assert.equal(c.unlock.action, "replan")
  assert.match(c.unlock.detail, /denied/)
  // confirm-pending 仍是 approve-confirm
  const p = buildUnlockContract({ signal: { kind: "confirm-pending" } })
  assert.equal(p.unlock.action, "approve-confirm")
})

function delta(runId: string, ticks: string[], failed = 0): RunDelta {
  return { runId, newTickIds: ticks, failedCount: failed }
}

test("进度停滞检测: 连续 K=3 个 run Δ=0 → stalled", () => {
  let ledger = createLedger()
  ledger = recordRun(ledger, delta("r1", ["live:0"]))
  assert.equal(detectStall(ledger).stalled, false)
  ledger = recordRun(ledger, delta("r2", []))
  ledger = recordRun(ledger, delta("r3", [], 2)) // failures do not reset Δ
  assert.equal(detectStall(ledger).stalled, false)
  assert.equal(detectStall(ledger).consecutiveZeroDelta, 2)
  ledger = recordRun(ledger, delta("r4", []))
  const s = detectStall(ledger)
  assert.equal(s.stalled, true)
  assert.equal(s.consecutiveZeroDelta, 3)
  assert.equal(STALL_K, 3)
})

test("进度停滞检测: a new tick resets the zero-delta streak", () => {
  let ledger = createLedger()
  for (const r of ["r1", "r2", "r3"]) ledger = recordRun(ledger, delta(r, []))
  assert.equal(detectStall(ledger).stalled, true)
  ledger = recordRun(ledger, delta("r4", ["live:2"]))
  const s = detectStall(ledger)
  assert.equal(s.stalled, false)
  assert.equal(s.consecutiveZeroDelta, 0)
})

test("进度停滞检测: custom K honored; ledger is capped (ring)", () => {
  let ledger = createLedger(4)
  for (const r of ["r1", "r2", "r3", "r4", "r5"]) ledger = recordRun(ledger, delta(r, []))
  assert.equal(ledger.runs.length, 4)
  assert.equal(ledger.runs[0]!.runId, "r2")
  assert.equal(detectStall(ledger, 5).stalled, false) // only 4 runs retained
  assert.equal(countTrailingZeroDelta(ledger), 4)
})

test("computeRunDelta: only non-draft false→true flips count", () => {
  const before = progress([
    item({ id: "live:0", text: "a", source: "seed", done: false }),
    item({ id: "live:1", text: "b", source: "seed", done: true }),
    item({ id: "live:2", text: "c", source: "model_draft", done: false }),
  ])
  const after = progress([
    item({ id: "live:0", text: "a", source: "seed", done: true }),
    item({ id: "live:1", text: "b", source: "seed", done: true }),
    item({ id: "live:2", text: "c", source: "model_draft", done: true }), // draft: never counts
  ])
  const d = computeRunDelta(before, after, { runId: "r1", failedCount: 1 })
  assert.deepEqual(d.newTickIds, ["live:0"])
  assert.equal(d.failedCount, 1)
})

test("computeRunDelta: already-done steady state yields no new ticks", () => {
  const before = progress([item({ id: "live:0", text: "a", source: "seed", done: true })])
  const after = progress([item({ id: "live:0", text: "a", source: "seed", done: true })])
  assert.deepEqual(computeRunDelta(before, after, { runId: "r1" }).newTickIds, [])
})

test("stall 卡: 已试路线 / 剩计划项 / 缺什么", () => {
  let ledger = createLedger()
  for (const r of ["r1", "r2", "r3"]) ledger = recordRun(ledger, delta(r, []))
  const unlock = buildUnlockContract({
    signal: { kind: "credential-missing" },
    itemId: "live:1",
    triedRoutes: [{ route: "cdp-dom", failure: "login wall" }],
  })
  const card = buildStallCard({
    runProgress: progress([
      item({ id: "live:0", text: "done step", source: "seed", done: true }),
      item({ id: "live:1", text: "登录后抓取订单", source: "seed", done: false }),
      item({ id: "live:2", text: "draft row", source: "model_draft", done: false }),
    ]),
    ledger,
    triedRoutes: unlock.tried_routes,
    unlocks: [unlock],
  })
  assert.equal(card.kind, "stall-card")
  assert.equal(card.consecutive_zero_delta, 3)
  assert.deepEqual(card.remaining_items, [{ id: "live:1", text: "登录后抓取订单" }])
  assert.equal(card.tried_routes[0]!.route, "cdp-dom")
  assert.equal(card.missing.length, 1)
  assert.equal(card.missing[0]!.blocker_class, "needs-credential")
  assert.equal(card.missing[0]!.unlock.action, "provide-credential")
})

test("stall 卡: empty progress / empty ledger yields empty card fields", () => {
  const card = buildStallCard({ runProgress: null, ledger: createLedger() })
  assert.equal(card.consecutive_zero_delta, 0)
  assert.deepEqual(card.remaining_items, [])
  assert.deepEqual(card.tried_routes, [])
  assert.deepEqual(card.missing, [])
})

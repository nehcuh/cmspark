// ADR-015 extension per-tab serialize queue (defense-in-depth).
// Companion lease remains authoritative; this only serializes SW CDP/scripting.

import test from "node:test"
import assert from "node:assert/strict"
import { TabQueue, coerceTabId } from "../src/background/tab-queue"

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

test("coerceTabId accepts finite numbers and numeric strings", () => {
  assert.equal(coerceTabId(42), 42)
  assert.equal(coerceTabId("7"), 7)
  assert.equal(coerceTabId(0), 0)
  assert.equal(coerceTabId(undefined), undefined)
  assert.equal(coerceTabId(null), undefined)
  assert.equal(coerceTabId(""), undefined)
  assert.equal(coerceTabId(NaN), undefined)
  assert.equal(coerceTabId("nope"), undefined)
})

test("same tabId serializes concurrent ops in arrival order", async () => {
  const q = new TabQueue()
  const order: string[] = []

  const a = q.run(1, async () => {
    order.push("a-start")
    await delay(30)
    order.push("a-end")
    return "A"
  })
  const b = q.run(1, async () => {
    order.push("b-start")
    await delay(5)
    order.push("b-end")
    return "B"
  })
  const c = q.run(1, async () => {
    order.push("c-start")
    return "C"
  })

  const results = await Promise.all([a, b, c])
  assert.deepEqual(results, ["A", "B", "C"])
  assert.deepEqual(order, ["a-start", "a-end", "b-start", "b-end", "c-start"])
  assert.equal(q.size(), 0)
})

test("different tabIds run in parallel", async () => {
  const q = new TabQueue()
  let tab1Entered = false
  let tab2EnteredWhile1Running = false

  const p1 = q.run(10, async () => {
    tab1Entered = true
    await delay(40)
    return 10
  })
  // Give p1 a tick to start
  await delay(5)
  const p2 = q.run(20, async () => {
    if (tab1Entered) tab2EnteredWhile1Running = true
    return 20
  })

  const [r1, r2] = await Promise.all([p1, p2])
  assert.equal(r1, 10)
  assert.equal(r2, 20)
  assert.equal(tab2EnteredWhile1Running, true)
})

test("missing tabId bypasses queue (no serialization)", async () => {
  const q = new TabQueue()
  let concurrent = 0
  let maxConcurrent = 0

  const run = () =>
    q.run(undefined, async () => {
      concurrent++
      maxConcurrent = Math.max(maxConcurrent, concurrent)
      await delay(20)
      concurrent--
      return true
    })

  await Promise.all([run(), run(), run()])
  assert.ok(maxConcurrent >= 2, `expected parallel bypass, got maxConcurrent=${maxConcurrent}`)
  assert.equal(q.size(), 0)
})

test("rejected op still releases so next waiter proceeds", async () => {
  const q = new TabQueue()
  const order: string[] = []

  const fail = q.run(3, async () => {
    order.push("fail")
    throw new Error("boom")
  })
  const ok = q.run(3, async () => {
    order.push("ok")
    return 1
  })

  let failed = false
  try {
    await fail
  } catch (e: any) {
    failed = true
    assert.match(String(e?.message || e), /boom/)
  }
  assert.ok(failed, "expected first op to throw")
  assert.equal(await ok, 1)
  assert.deepEqual(order, ["fail", "ok"])
  assert.equal(q.size(), 0)
})

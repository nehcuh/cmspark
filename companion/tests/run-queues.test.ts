import test from "node:test"
import assert from "node:assert/strict"
import {
  MAX_NEXT_RUN,
  MAX_STEER,
  _resetRunQueuesForTests,
  convertLeftoverSteerToNextRun,
  dropSteer,
  enqueueNextRun,
  enqueueSteer,
  peekNextRunCount,
  takeNextRun,
  takeSteer,
} from "../src/llm/run-queues"

test("steer drains; abort dropSteer does not keep items", () => {
  _resetRunQueuesForTests()
  enqueueSteer("t1", "focus tests")
  enqueueSteer("t1", "then lint")
  dropSteer("t1")
  assert.deepEqual(takeSteer("t1"), [])
})

test("nextRun caps at MAX_NEXT_RUN and reports false when full", () => {
  _resetRunQueuesForTests()
  for (let i = 0; i < MAX_NEXT_RUN; i++) {
    assert.equal(enqueueNextRun("t1", `m${i}`), true)
  }
  assert.equal(enqueueNextRun("t1", "overflow"), false)
  assert.equal(peekNextRunCount("t1"), MAX_NEXT_RUN)
  assert.equal(takeNextRun("t1")?.text, "m0")
})

test("enqueueSteer trims and ignores empty/whitespace", () => {
  _resetRunQueuesForTests()
  enqueueSteer("t1", "   ")
  enqueueSteer("t1", "")
  enqueueSteer("t1", "  focus tests  ")
  assert.deepEqual(takeSteer("t1"), [{ text: "focus tests" }])
})

test("steer caps at MAX_STEER and reports false when full", () => {
  _resetRunQueuesForTests()
  for (let i = 0; i < MAX_STEER; i++) {
    assert.equal(enqueueSteer("t1", `s${i}`), true)
  }
  assert.equal(enqueueSteer("t1", "overflow"), false)
  assert.equal(takeSteer("t1").length, MAX_STEER)
})

test("nextRun survives dropSteer (abort analog)", () => {
  _resetRunQueuesForTests()
  enqueueSteer("t1", "ignore me")
  enqueueNextRun("t1", "after this run")
  dropSteer("t1")
  assert.equal(peekNextRunCount("t1"), 1)
  assert.equal(takeNextRun("t1")?.text, "after this run")
  assert.equal(takeNextRun("t1"), undefined)
})

test("steer entries carry clientMessageId through enqueue/take (D6)", () => {
  _resetRunQueuesForTests()
  enqueueSteer("t1", "first", "cm-1")
  enqueueSteer("t1", "second")
  enqueueSteer("t1", "third", "cm-3")
  assert.deepEqual(takeSteer("t1"), [
    { text: "first", clientMessageId: "cm-1" },
    { text: "second" },
    { text: "third", clientMessageId: "cm-3" },
  ])
  // Queue fully drained by takeSteer.
  assert.deepEqual(takeSteer("t1"), [])
})

test("nextRun entries carry clientMessageId through enqueue/take (S-A1)", () => {
  _resetRunQueuesForTests()
  assert.equal(enqueueNextRun("t1", "queued", "cm-nr-1"), true)
  assert.equal(enqueueNextRun("t1", "plain"), true)
  const first = takeNextRun("t1")
  assert.equal(first?.text, "queued")
  assert.equal(first?.clientMessageId, "cm-nr-1")
  const second = takeNextRun("t1")
  assert.equal(second?.text, "plain")
  assert.equal(second && "clientMessageId" in second, false)
})

test("convertLeftoverSteerToNextRun does not dropSteer on queue-full (S-A3)", () => {
  _resetRunQueuesForTests()
  for (let i = 0; i < MAX_NEXT_RUN; i++) {
    assert.equal(enqueueNextRun("t1", `q${i}`), true)
  }
  assert.equal(enqueueSteer("t1", "leftover", "cm-left"), true)
  const r = convertLeftoverSteerToNextRun("t1")
  assert.equal(r.dropped, 1)
  assert.equal(r.converted, 0)
  assert.equal(enqueueSteer("t1", "concurrent after take", "cm-conc"), true)
  assert.deepEqual(takeSteer("t1"), [{ text: "concurrent after take", clientMessageId: "cm-conc" }])
})

test("convertLeftoverSteerToNextRun keeps first clientMessageId (S-A1)", () => {
  _resetRunQueuesForTests()
  enqueueSteer("t1", "a", "cm-a")
  enqueueSteer("t1", "b")
  const r = convertLeftoverSteerToNextRun("t1")
  assert.equal(r.converted, 2)
  const item = takeNextRun("t1")
  assert.equal(item?.text, "a\nb")
  assert.equal(item?.clientMessageId, "cm-a")
})

test("enqueueSteer without clientMessageId stores text-only entries", () => {
  _resetRunQueuesForTests()
  enqueueSteer("t1", "plain")
  const items = takeSteer("t1")
  assert.equal(items.length, 1)
  assert.equal(items[0].text, "plain")
  assert.equal("clientMessageId" in items[0], false)
})

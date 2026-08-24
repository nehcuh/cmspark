import test from "node:test"
import assert from "node:assert/strict"
import {
  MAX_NEXT_RUN,
  MAX_STEER,
  _resetRunQueuesForTests,
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
  assert.equal(takeNextRun("t1"), "m0")
})

test("enqueueSteer trims and ignores empty/whitespace", () => {
  _resetRunQueuesForTests()
  enqueueSteer("t1", "   ")
  enqueueSteer("t1", "")
  enqueueSteer("t1", "  focus tests  ")
  assert.deepEqual(takeSteer("t1"), ["focus tests"])
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
  assert.equal(takeNextRun("t1"), "after this run")
  assert.equal(takeNextRun("t1"), undefined)
})

import assert from "node:assert/strict"
import test from "node:test"
import {
  abortLlmLoopsForPanel, claimThreadRun, finishThreadRun, isCurrentRunGeneration,
  isThreadRunActive, ownsThreadRun,
} from "../src/llm/active-runs"

test("stale completion and panel disconnect preserve the successor without loading the router", () => {
  const id = "registry-successor"
  const first = claimThreadRun(id, "old-panel")
  const next = claimThreadRun(id, "new-panel")
  assert.equal(next.previous, first.controller)
  finishThreadRun(id, first.generation, first.controller)
  assert.equal(abortLlmLoopsForPanel("old-panel"), 0)
  assert.equal(ownsThreadRun(id, next.controller), true)
  assert.equal(next.controller.signal.aborted, false)
  finishThreadRun(id, next.generation, next.controller)
  assert.equal(isThreadRunActive(id), false)
  assert.equal(isCurrentRunGeneration(id, next.generation), true)
  assert.equal(require.cache[require.resolve("../src/message-router")], undefined)
})

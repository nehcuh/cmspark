import test from "node:test"
import assert from "node:assert/strict"
import { isContextOverflowError, isLengthStop, isTruncatedToolBatch } from "../src/llm/overflow"

test("isContextOverflowError matches common provider strings", () => {
  assert.equal(isContextOverflowError("context_length_exceeded"), true)
  assert.equal(isContextOverflowError("This model's maximum context length is 128000 tokens"), true)
  assert.equal(isContextOverflowError("prompt is too long"), true)
  assert.equal(isContextOverflowError("input is too long"), true)
  assert.equal(isContextOverflowError("request_too_large"), true)
  assert.equal(isContextOverflowError("The input token count exceeds the limit"), true)
  assert.equal(isContextOverflowError("exceeds the model's context window"), true)
  assert.equal(isContextOverflowError("API Key 无效"), false)
  assert.equal(isContextOverflowError("insufficient tool messages"), false)
})

test("isTruncatedToolBatch is length-stop with at least one tool call", () => {
  assert.equal(isTruncatedToolBatch("length", true), true)
  assert.equal(isTruncatedToolBatch("max_tokens", true), true)
  assert.equal(isTruncatedToolBatch("length", false), false)
  assert.equal(isTruncatedToolBatch("stop", true), false)
})

test("isLengthStop matches finish_reason length / max_tokens", () => {
  assert.equal(isLengthStop("length"), true)
  assert.equal(isLengthStop("max_tokens"), true)
  assert.equal(isLengthStop("stop"), false)
  assert.equal(isLengthStop("tool_calls"), false)
  assert.equal(isLengthStop(null), false)
})

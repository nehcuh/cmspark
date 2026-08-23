import test from "node:test"
import assert from "node:assert/strict"
import { classifyError } from "../src/security"
import { browserUnavailableResult, toolChatErrorPayload } from "../src/ws/l1-actuator"

test("BROWSER_UNAVAILABLE is non_recoverable even if copy mentions not connected", () => {
  const r = browserUnavailableResult()
  assert.equal(r.error_code, "BROWSER_UNAVAILABLE")
  assert.equal(r.success, false)
  assert.equal(/timeout|disconnected|not found/i.test(r.error), false)
  assert.equal(
    classifyError(r.error, { toolName: "navigate", error_code: r.error_code }),
    "non_recoverable",
  )
})

test("substring timeout without code stays recoverable", () => {
  assert.equal(classifyError("Tool execution timeout (15000ms)", { toolName: "click" }), "recoverable")
})

test("toolChatErrorPayload keeps error_code on chat.error for overlay CTA", () => {
  const r = browserUnavailableResult()
  const frame = toolChatErrorPayload({
    thread_id: "t1",
    error: r.error,
    error_code: r.error_code,
    error_level: "non_recoverable",
  })
  assert.equal(frame.type, "chat.error")
  assert.equal(frame.thread_id, "t1")
  assert.equal(frame.error_code, "BROWSER_UNAVAILABLE")
  assert.equal(frame.error_level, "non_recoverable")
})

test("error_code BROWSER_UNAVAILABLE wins over recoverable substrings", () => {
  assert.equal(
    classifyError("timeout disconnected not found", {
      toolName: "navigate",
      error_code: "BROWSER_UNAVAILABLE",
    }),
    "non_recoverable",
  )
})

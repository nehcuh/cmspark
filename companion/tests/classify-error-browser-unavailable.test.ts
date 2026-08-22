import test from "node:test"
import assert from "node:assert/strict"
import { classifyError } from "../src/security"
import { browserUnavailableResult } from "../src/ws/l1-actuator"

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

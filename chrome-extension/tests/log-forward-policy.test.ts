// Policy tests: log.event forward-failure must never re-enter companion WS.

import test from "node:test"
import assert from "node:assert/strict"
import {
  buildLogEventPayload,
  forwardFailureConsoleLevel,
  shouldReportForwardFailureToCompanion,
} from "../src/background/log-forward-policy"

test("shouldReportForwardFailureToCompanion is always false (loop break)", () => {
  for (const t of [
    "log.event",
    "config.updated",
    "chat.token",
    "security.confirmation.request",
    "computer.task.event",
    "unknown",
  ]) {
    assert.equal(
      shouldReportForwardFailureToCompanion(t),
      false,
      `must not report forward failure for ${t}`,
    )
  }
})

test("buildLogEventPayload shape for local fan-out + companion upload", () => {
  const p = buildLogEventPayload("info", "extension.ws_state_changed", { state: "connected" })
  assert.deepEqual(p, {
    type: "log.event",
    source: "extension",
    level: "info",
    event: "extension.ws_state_changed",
    data: { state: "connected" },
  })
})

test("forwardFailureConsoleLevel: first warn, then debug", () => {
  const first = forwardFailureConsoleLevel(false)
  assert.equal(first.level, "warn")
  assert.equal(first.nextWarned, true)

  const second = forwardFailureConsoleLevel(true)
  assert.equal(second.level, "debug")
  assert.equal(second.nextWarned, true)
})

test("simulates closed-panel: config.updated failure must not produce companion log.event", () => {
  // Mirrors handleCompanionMessage catch path with sidepanel closed.
  const companionSends: unknown[] = []
  const messageType = "config.updated"

  if (shouldReportForwardFailureToCompanion(messageType)) {
    companionSends.push(
      buildLogEventPayload("debug", "extension.sidepanel_forward_failed", {
        message_type: messageType,
      }),
    )
  }

  assert.equal(companionSends.length, 0, "zero log.event back to companion closes the loop")
})

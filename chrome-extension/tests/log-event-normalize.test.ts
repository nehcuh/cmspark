// Side Panel live-log field normalization (top-level wire shape).

import test from "node:test"
import assert from "node:assert/strict"
import { normalizeInboundLogEvent } from "../src/sidepanel/log-event-normalize"

test("top-level wire shape (buildLogEventPayload) maps correctly", () => {
  const entry = normalizeInboundLogEvent({
    type: "log.event",
    source: "extension",
    level: "info",
    event: "extension.ws_state_changed",
    data: { state: "connected" },
    ts: "2026-07-31T01:00:00.000Z",
  })
  assert.ok(entry)
  assert.equal(entry!.level, "info")
  assert.equal(entry!.source, "extension")
  assert.equal(entry!.event, "extension.ws_state_changed")
  assert.deepEqual(entry!.data, { state: "connected" })
  assert.equal(entry!.ts, "2026-07-31T01:00:00.000Z")
})

test("debug level is dropped", () => {
  assert.equal(
    normalizeInboundLogEvent({
      type: "log.event",
      source: "extension",
      level: "debug",
      event: "noise",
      data: {},
    }),
    null,
  )
})

test("legacy nested { data: { level, event, ... } } still works", () => {
  const entry = normalizeInboundLogEvent({
    type: "log.event",
    data: {
      level: "warn",
      source: "extension",
      event: "legacy.nested",
      data: { foo: 1 },
      ts: "2026-07-31T02:00:00.000Z",
    },
  })
  assert.ok(entry)
  assert.equal(entry!.level, "warn")
  assert.equal(entry!.source, "extension")
  assert.equal(entry!.event, "legacy.nested")
  assert.deepEqual(entry!.data, { foo: 1 })
})

test("old bug path: reading only msg.data would yield unknown — top-level is preferred", () => {
  // Regression guard for useWebSocket previously doing `const log = msg.data`
  // then log.level / log.event when data was the payload object { state: "connected" }.
  const entry = normalizeInboundLogEvent({
    type: "log.event",
    source: "extension",
    level: "info",
    event: "extension.tool.start",
    data: { tool_name: "navigate" },
  })
  assert.ok(entry)
  assert.equal(entry!.event, "extension.tool.start")
})

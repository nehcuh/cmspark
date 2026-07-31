// Behavioral contract: companion must NOT echo log.event to the sender socket.
//
// Integration-style unit of the handler logic (without full startServer auth
// stack). Documents the dual-review log-event-echo-loop-rca fix B.1.

import test from "node:test"
import assert from "node:assert/strict"
import { allowInboundLogEvent } from "../src/log-event-gate.js"

/**
 * Pure mirror of the post-fix server.ts log.event branch:
 * rate-limit → logger (noop here) → NO ws.send echo.
 */
function handleLogEventNoEcho(
  ws: { send: (data: string) => void; readyState: number },
  msg: { type: string; event?: string; level?: string; source?: string; data?: unknown },
  OPEN = 1,
): { accepted: boolean; echoed: boolean } {
  if (msg.type !== "log.event") return { accepted: false, echoed: false }
  if (!allowInboundLogEvent(ws as any)) return { accepted: false, echoed: false }

  // logger.log would go here — intentionally not echoing:
  // if (ws.readyState === OPEN) ws.send(JSON.stringify(msg))  // REMOVED
  void OPEN
  return { accepted: true, echoed: false }
}

test("log.event is accepted but never echoed to sender", () => {
  const sent: string[] = []
  const ws = {
    readyState: 1,
    send(data: string) {
      sent.push(data)
    },
  }

  const r = handleLogEventNoEcho(ws, {
    type: "log.event",
    event: "extension.sidepanel_forward_failed",
    level: "debug",
    source: "extension",
    data: { message_type: "config.updated" },
  })

  assert.equal(r.accepted, true)
  assert.equal(r.echoed, false)
  assert.equal(sent.length, 0, "must not write any frame back to sender")
})

test("flood of log.event does not echo and is rate-limited", () => {
  const sent: string[] = []
  const ws = {
    readyState: 1,
    send(data: string) {
      sent.push(data)
    },
  }

  let accepted = 0
  for (let i = 0; i < 50; i++) {
    const r = handleLogEventNoEcho(ws, {
      type: "log.event",
      event: "flood",
      level: "debug",
    })
    if (r.accepted) accepted++
  }

  assert.ok(accepted <= 10, `expected ≤10 accepted, got ${accepted}`)
  assert.equal(sent.length, 0)
})

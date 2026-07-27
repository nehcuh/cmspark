import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  parseSwiftLine,
  encodeHudOpen,
  encodeHudHydrate,
  encodeShellStandby,
  isHudConfirmResponse,
  isHudReady,
  isHudHeartbeat,
  isHudPong,
  isHudAbort,
  isHudClosed,
} from "../src/hud/protocol"

describe("hud protocol", () => {
  it("encodes hud.open as one JSON line object with cmd", () => {
    const o = encodeHudOpen({ thread_id: "t1", reason: "spike" })
    assert.equal(o.cmd, "hud.open")
    assert.equal(o.thread_id, "t1")
    assert.equal(o.reason, "spike")
  })

  it("encodes shell.standby with required message", () => {
    const o = encodeShellStandby({
      thread_id: "t1",
      active_shell: "cockpit",
      message: "任务进行中 — 在 确认台 查看",
    })
    assert.equal(o.cmd, "shell.standby")
    assert.equal(o.thread_id, "t1")
    assert.equal(o.active_shell, "cockpit")
    assert.ok(o.message.includes("确认台"))
  })

  it("encodes hud.hydrate with typed pending confirmations", () => {
    const o = encodeHudHydrate({
      thread_id: "t1",
      shell: "hud",
      connection: "connected",
      pending_confirmations: [
        {
          confirmation_id: "c1",
          tool_name: "evaluate",
          summary: "run script",
          timeout_ms: 45_000,
        },
      ],
      task: null,
      dual_track: { conclusions: [], steps: [] },
    })
    assert.equal(o.cmd, "hud.hydrate")
    assert.equal(o.shell, "hud")
    assert.equal(o.pending_confirmations.length, 1)
    assert.equal(o.pending_confirmations[0].confirmation_id, "c1")
  })

  it("parses hud.confirm.response from Swift", () => {
    const line = JSON.stringify({ type: "hud.confirm.response", id: "c1", approved: true })
    const ev = parseSwiftLine(line)
    assert.ok(isHudConfirmResponse(ev))
    assert.equal(ev.id, "c1")
    assert.equal(ev.approved, true)
  })

  it("rejects unknown cmd shapes without throwing", () => {
    const ev = parseSwiftLine("{not json")
    assert.equal(ev, null)
  })

  it("type-guards ready, heartbeat, pong, abort, closed", () => {
    assert.ok(isHudReady(parseSwiftLine(JSON.stringify({ type: "hud.ready" }))))
    assert.ok(isHudHeartbeat(parseSwiftLine(JSON.stringify({ type: "hud.heartbeat", ts: 1 }))))
    assert.ok(isHudPong(parseSwiftLine(JSON.stringify({ type: "hud.pong", nonce: "n1" }))))
    assert.ok(isHudAbort(parseSwiftLine(JSON.stringify({ type: "hud.abort", task_id: "x" }))))
    assert.ok(isHudClosed(parseSwiftLine(JSON.stringify({ type: "hud.closed", reason: "user" }))))

    assert.equal(isHudConfirmResponse({ type: "hud.confirm.response", id: 1, approved: true }), false)
    assert.equal(isHudHeartbeat({ type: "hud.heartbeat", ts: "nope" }), false)
    assert.equal(isHudPong({ type: "hud.pong" }), false)
    assert.equal(isHudClosed({ type: "hud.closed" }), false)
  })
})

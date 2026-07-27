import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  HudShellRouter,
  HUD_HEARTBEAT_STALE_MS,
  HUD_PING_TIMEOUT_MS,
} from "../src/hud/shell-router"

describe("HudShellRouter", () => {
  it("sets active shell and emits standby to previous wide shell", () => {
    const sent: Array<{ to: string; m: Record<string, unknown> }> = []
    const r = new HudShellRouter({
      sendToHud: (m) => sent.push({ to: "hud", m: m as Record<string, unknown> }),
      sendToCockpit: (m) => sent.push({ to: "cockpit", m: m as Record<string, unknown> }),
    })
    r.setActiveShell("t1", "cockpit")
    assert.equal(r.getActiveShell("t1"), "cockpit")
    assert.equal(sent.length, 0, "first set does not emit standby")

    r.setActiveShell("t1", "hud")
    const standby = sent.find((x) => x.m?.cmd === "shell.standby")
    assert.ok(standby)
    assert.equal(standby.to, "cockpit")
    assert.equal(standby.m.active_shell, "hud")
    assert.equal(standby.m.thread_id, "t1")
    assert.ok(String(standby.m.message).includes("HUD"))
    assert.equal(r.getActiveShell("t1"), "hud")
  })

  it("does not emit standby when setting the same shell again", () => {
    const sent: unknown[] = []
    const r = new HudShellRouter({
      sendToHud: (m) => sent.push(m),
      sendToCockpit: (m) => sent.push(m),
    })
    r.setActiveShell("t1", "hud")
    r.setActiveShell("t1", "hud")
    assert.equal(sent.length, 0)
  })

  it("emits standby to hud when switching to cockpit", () => {
    const sent: Array<{ to: string; m: Record<string, unknown> }> = []
    const r = new HudShellRouter({
      sendToHud: (m) => sent.push({ to: "hud", m: m as Record<string, unknown> }),
      sendToCockpit: (m) => sent.push({ to: "cockpit", m: m as Record<string, unknown> }),
    })
    r.setActiveShell("t1", "hud")
    r.setActiveShell("t1", "cockpit")
    const standby = sent.find((x) => x.m?.cmd === "shell.standby")
    assert.ok(standby)
    assert.equal(standby.to, "hud")
    assert.equal(standby.m.active_shell, "cockpit")
    assert.ok(String(standby.m.message).includes("确认台"))
  })

  it("isHealthy requires heartbeat within 3s", () => {
    const r = new HudShellRouter({ sendToHud: () => {}, sendToCockpit: () => {} })
    assert.equal(r.isHealthy(), false, "no heartbeat yet")
    const now = Date.now()
    r.noteHeartbeat(now)
    assert.equal(r.isHealthy(now + HUD_HEARTBEAT_STALE_MS - 1), true)
    assert.equal(r.isHealthy(now + HUD_HEARTBEAT_STALE_MS + 1), false)
  })

  it("records pong latency under 400ms as healthy ping", () => {
    const pings: unknown[] = []
    const r = new HudShellRouter({
      sendToHud: (m) => pings.push(m),
      sendToCockpit: () => {},
    })
    const t0 = Date.now()
    const nonce = r.beginPing(t0)
    assert.equal((pings[0] as { cmd: string }).cmd, "hud.ping")
    assert.equal((pings[0] as { nonce: string }).nonce, nonce)
    r.notePong(nonce, t0 + 100)
    assert.equal(r.lastPingOk(), true)
  })

  it("marks slow pong as not ok", () => {
    const r = new HudShellRouter({ sendToHud: () => {}, sendToCockpit: () => {} })
    const t0 = Date.now()
    const nonce = r.beginPing(t0)
    r.notePong(nonce, t0 + HUD_PING_TIMEOUT_MS + 1)
    assert.equal(r.lastPingOk(), false)
  })

  it("ignores pong with mismatched nonce", () => {
    const r = new HudShellRouter({ sendToHud: () => {}, sendToCockpit: () => {} })
    r.beginPing(Date.now())
    r.notePong("wrong-nonce", Date.now() + 50)
    assert.equal(r.lastPingOk(), false)
  })

  it("tracks hud pid for N3 PID-alive check hook", () => {
    const r = new HudShellRouter({ sendToHud: () => {}, sendToCockpit: () => {} })
    assert.equal(r.getHudPid(), null)
    r.setHudPid(12345)
    assert.equal(r.getHudPid(), 12345)
    r.setHudPid(null)
    assert.equal(r.getHudPid(), null)
  })
})

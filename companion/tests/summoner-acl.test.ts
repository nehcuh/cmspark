import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"
import { assertSummonerAllowed, applySummonerPayloadPolicy } from "../src/ws/summoner-acl"
import { validateWsMessage } from "../src/ws/validate"

function srcFile(...parts: string[]): string {
  const candidates = [
    path.join(__dirname, "..", "src", ...parts),
    path.join(__dirname, "..", "..", "src", ...parts),
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  return candidates[0]
}

test("summoner allows chat.create and ping", () => {
  assert.equal(assertSummonerAllowed("summoner", "chat.create").ok, true)
  assert.equal(assertSummonerAllowed("summoner", "system.ping").ok, true)
})

test("summoner denies trust elevation", () => {
  for (const t of [
    "config.set",
    "security.unattended.arm",
    "security.confirmation.response",
    "mcp.add",
    "executeQuickAction",
    "knowledge.get",
    "knowledge.update",
    "knowledge.export",
  ]) {
    const r = assertSummonerAllowed("summoner", t)
    assert.equal(r.ok, false)
    assert.equal(r.error_code, "SUMMONER_ACL")
  }
})

test("tray surface does not use summoner allowlist", () => {
  assert.equal(assertSummonerAllowed("tray", "skill.list").ok, true)
  assert.equal(assertSummonerAllowed(undefined, "skill.list").ok, true)
})

test("summoner allows remaining S21 methods", () => {
  for (const t of [
    "chat.abort",
    "chat.steer",
    "pack.list",
    "pack.apply",
    "thread.list",
    "thread.select",
    "thread.create",
    "history.query",
    "composer.lease.claim",
    "composer.lease.release",
    "composer.lease.release_overlay",
    "composer.lease.get",
    "companion.ui.rect",
    "voice.stt.start",
    "voice.stt.chunk",
    "voice.stt.end",
    "voice.stt.abort",
    "voice.stt.partial_request",
    "mcp.list",
    "mcp.toggle_server",
    "skill.list",
    "skill.activate",
    "skill.deactivate",
    "knowledge.list",
    "knowledge.set_active",
    "file.upload",
  ]) {
    assert.equal(assertSummonerAllowed("summoner", t).ok, true, t)
  }
})

test("summoner denies voice.model.* (STT origin does not open model control)", () => {
  for (const t of [
    "voice.model.get_state",
    "voice.model.download",
    "voice.model.set_engine",
    "voice.model.set_active",
  ]) {
    const r = assertSummonerAllowed("summoner", t)
    assert.equal(r.ok, false, t)
    assert.equal(r.error_code, "SUMMONER_ACL")
  }
})

test("summoner denies anything else not on the allowlist", () => {
  const r = assertSummonerAllowed("summoner", "config.get")
  assert.equal(r.ok, false)
  assert.equal(r.error_code, "SUMMONER_ACL")
  assert.match(r.error, /config.get/)
})

test("summoner surface thread.run_progress.toggle is denied SUMMONER_ACL", () => {
  const r = assertSummonerAllowed("summoner", "thread.run_progress.toggle")
  assert.equal(r.ok, false)
  assert.equal(r.error_code, "SUMMONER_ACL")
  assert.match(r.error, /thread\.run_progress\.toggle/)
})

test("auth.handshake accepts optional surface tray|summoner", () => {
  const proof = "a".repeat(64)
  assert.equal(validateWsMessage({ type: "auth.handshake", proof }).valid, true)
  assert.equal(
    validateWsMessage({ type: "auth.handshake", proof, surface: "tray" }).valid,
    true,
  )
  assert.equal(
    validateWsMessage({ type: "auth.handshake", proof, surface: "summoner" }).valid,
    true,
  )
})

test("voice.stt handler ctx receives lifecycle surface from wsAuth", () => {
  const life = fs.readFileSync(srcFile("ws", "lifecycle.ts"), "utf8")
  const router = fs.readFileSync(srcFile("message-router.ts"), "utf8")
  assert.match(life, /surface:\s*wsAuth\.get\(ws\)\?\.surface/)
  assert.match(router, /surface:\s*session\?\.surface/)
})

test("auth.handshake rejects surface other than tray|summoner", () => {
  const proof = "a".repeat(64)
  for (const surface of ["overlay", "panel", "", 1, null, true]) {
    const r = validateWsMessage({ type: "auth.handshake", proof, surface })
    assert.equal(r.valid, false, `surface=${JSON.stringify(surface)} should reject`)
  }
})

test("overlay pack.apply strips Trust extras (A-N2)", () => {
  const msg: Record<string, unknown> = {
    type: "pack.apply",
    pack_id: "meeting-minutes",
    thread_id: "t1",
    allowTrust: true,
    workspace_path: "/tmp/x",
    force_takeover: true,
    confirmation_phrase: "I UNDERSTAND",
  }
  const r = applySummonerPayloadPolicy("summoner", msg)
  assert.equal(r.ok, true)
  assert.equal(msg.allowTrust, undefined)
  assert.equal(msg.workspace_path, undefined)
  assert.equal(msg.force_takeover, undefined)
  assert.equal(msg.confirmation_phrase, undefined)
  assert.equal(msg.user_gesture, true)
  assert.equal(msg.pack_id, "meeting-minutes")
})

test("tray pack.apply is not rewritten", () => {
  const msg: Record<string, unknown> = {
    type: "pack.apply",
    pack_id: "meeting-minutes",
    thread_id: "t1",
    allowTrust: true,
  }
  const r = applySummonerPayloadPolicy("tray", msg)
  assert.equal(r.ok, true)
  assert.equal(msg.allowTrust, true)
})

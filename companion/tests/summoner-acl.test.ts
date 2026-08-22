import test from "node:test"
import assert from "node:assert/strict"
import { assertSummonerAllowed } from "../src/ws/summoner-acl"
import { validateWsMessage } from "../src/ws/validate"

test("summoner allows chat.create and ping", () => {
  assert.equal(assertSummonerAllowed("summoner", "chat.create").ok, true)
  assert.equal(assertSummonerAllowed("summoner", "system.ping").ok, true)
})

test("summoner denies trust elevation", () => {
  for (const t of [
    "pack.apply",
    "config.set",
    "security.unattended.arm",
    "security.confirmation.response",
    "mcp.add",
    "skill.list",
    "executeQuickAction",
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
    "thread.list",
    "thread.select",
    "thread.create",
    "history.query",
    "composer.lease.claim",
    "composer.lease.release",
    "composer.lease.get",
  ]) {
    assert.equal(assertSummonerAllowed("summoner", t).ok, true, t)
  }
})

test("summoner denies anything else not on the allowlist", () => {
  const r = assertSummonerAllowed("summoner", "config.get")
  assert.equal(r.ok, false)
  assert.equal(r.error_code, "SUMMONER_ACL")
  assert.match(r.error, /config.get/)
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

test("auth.handshake rejects surface other than tray|summoner", () => {
  const proof = "a".repeat(64)
  for (const surface of ["overlay", "panel", "", 1, null, true]) {
    const r = validateWsMessage({ type: "auth.handshake", proof, surface })
    assert.equal(r.valid, false, `surface=${JSON.stringify(surface)} should reject`)
  }
})

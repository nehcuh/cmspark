import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"
import {
  ComposerLeaseRegistry,
  assertComposerLease,
  gateChatCreateOnLease,
  handleComposerLeaseFamily,
  stampCmsparkSurface,
  OVERLAY_STANDBY,
} from "../src/ws/composer-lease"
import { validateWsMessage } from "../src/ws/validate"

test("claim overlay bumps rev; stale rev fails", () => {
  const r = new ComposerLeaseRegistry()
  const a = r.claim({ thread_id: "t1", holder: "overlay", rev: 0 })
  assert.equal(a.ok, true)
  assert.equal(a.state.holder, "overlay")
  assert.equal(a.state.rev, 1)
  const stale = r.claim({ thread_id: "t1", holder: "panel", rev: 0 })
  assert.equal(stale.ok, false)
  const ok = r.claim({ thread_id: "t1", holder: "panel", rev: 1 })
  assert.equal(ok.ok, true)
  assert.equal(ok.state.holder, "panel")
  assert.equal(ok.state.rev, 2)
})

test("absent lease defaults holder panel", () => {
  const r = new ComposerLeaseRegistry()
  assert.equal(r.get("missing").holder, "panel")
  assert.equal(r.get("missing").rev, 0)
  assert.equal(r.get("missing").thread_id, "missing")
})

test("assertComposerLease denies non-holder incoming", () => {
  const deny = assertComposerLease("overlay", "panel")
  assert.equal(deny.ok, false)
  if (!deny.ok) {
    assert.equal(deny.error_code, OVERLAY_STANDBY)
    assert.equal(deny.holder, "overlay")
    assert.equal(deny.error, "OVERLAY_STANDBY: composer is on the other surface")
  }
  assert.equal(assertComposerLease("panel", "panel").ok, true)
  assert.equal(assertComposerLease("overlay", "overlay").ok, true)
})

test("chat.create gate OVERLAY_STANDBY when overlay holds and panel incoming", () => {
  const r = new ComposerLeaseRegistry()
  r.claim({ thread_id: "t1", holder: "overlay", rev: 0 })
  const err = gateChatCreateOnLease("t1", "tray", r)
  assert.equal(err?.type, "chat.error")
  assert.equal(err?.thread_id, "t1")
  assert.equal(err?.error, "OVERLAY_STANDBY: composer is on the other surface")
  assert.equal(err?.data.error_code, OVERLAY_STANDBY)
  assert.equal(err?.data.holder, "overlay")
  assert.equal(gateChatCreateOnLease("t1", "summoner", r), null)
})

test("chat.create gate allows panel when lease absent; overlay needs claim", () => {
  const r = new ComposerLeaseRegistry()
  assert.equal(gateChatCreateOnLease("missing", "tray", r), null)
  assert.equal(gateChatCreateOnLease("missing", undefined, r), null)
  const err = gateChatCreateOnLease("missing", "summoner", r)
  assert.equal(err?.data.error_code, OVERLAY_STANDBY)
  assert.equal(err?.data.holder, "panel")
})

test("matching rev can steal overlay back to panel; release sets panel", () => {
  const r = new ComposerLeaseRegistry()
  r.claim({ thread_id: "t1", holder: "overlay", rev: 0 })
  const released = r.release({ thread_id: "t1", rev: 1 })
  assert.equal(released.ok, true)
  assert.equal(released.state.holder, "panel")
  assert.equal(released.state.rev, 2)
  const stale = r.release({ thread_id: "t1", rev: 1 })
  assert.equal(stale.ok, false)
})

test("stampCmsparkSurface overwrites client spoof always", () => {
  const msg: { type: string; __cmspark_surface?: string } = {
    type: "chat.create",
    __cmspark_surface: "summoner",
  }
  stampCmsparkSurface(msg, "tray")
  assert.equal(msg.__cmspark_surface, "tray")
  stampCmsparkSurface(msg, "summoner")
  assert.equal(msg.__cmspark_surface, "summoner")
  stampCmsparkSurface(msg, undefined)
  assert.equal(msg.__cmspark_surface, "tray")
})

test("composer.lease.get/claim/release handlers round-trip P0 fields", () => {
  const r = new ComposerLeaseRegistry()
  const got = handleComposerLeaseFamily("composer.lease.get", { thread_id: "t9" }, r)
  assert.equal(got.type, "composer.lease")
  assert.equal(got.thread_id, "t9")
  assert.equal(got.holder, "panel")
  assert.equal(got.rev, 0)

  const claimed = handleComposerLeaseFamily(
    "composer.lease.claim",
    { thread_id: "t9", holder: "overlay", rev: 0 },
    r,
  )
  assert.equal(claimed.type, "composer.lease")
  assert.equal(claimed.holder, "overlay")
  assert.equal(claimed.rev, 1)

  const stale = handleComposerLeaseFamily(
    "composer.lease.claim",
    { thread_id: "t9", holder: "panel", rev: 0 },
    r,
  )
  assert.equal(stale.type, "composer.lease.error")
  assert.equal(stale.error_code, "LEASE_REV_MISMATCH")
  assert.equal(stale.holder, "overlay")
  assert.equal(stale.rev, 1)

  const released = handleComposerLeaseFamily(
    "composer.lease.release",
    { thread_id: "t9", rev: 1 },
    r,
  )
  assert.equal(released.type, "composer.lease")
  assert.equal(released.holder, "panel")
  assert.equal(released.rev, 2)
})

test("validate composer.lease.claim/release/get", () => {
  assert.equal(
    validateWsMessage({ type: "composer.lease.get", thread_id: "t1" }).valid,
    true,
  )
  assert.equal(validateWsMessage({ type: "composer.lease.get" }).valid, false)
  assert.equal(
    validateWsMessage({
      type: "composer.lease.claim",
      thread_id: "t1",
      holder: "overlay",
      rev: 0,
    }).valid,
    true,
  )
  assert.equal(
    validateWsMessage({
      type: "composer.lease.claim",
      thread_id: "t1",
      holder: "panel",
      rev: 3,
    }).valid,
    true,
  )
  assert.equal(
    validateWsMessage({ type: "composer.lease.claim", thread_id: "t1", holder: "overlay" }).valid,
    false,
  )
  assert.equal(
    validateWsMessage({
      type: "composer.lease.claim",
      thread_id: "t1",
      holder: "summoner",
      rev: 0,
    }).valid,
    false,
  )
  assert.equal(
    validateWsMessage({ type: "composer.lease.release", thread_id: "t1", rev: 1 }).valid,
    true,
  )
  assert.equal(validateWsMessage({ type: "composer.lease.release" }).valid, false)
})

test("message-router chat.create uses composer lease gate", () => {
  const router = path.resolve(__dirname, "..", "..", "src", "message-router.ts")
  const src = fs.readFileSync(router, "utf8")
  assert.match(src, /gateChatCreateOnLease/)
  assert.match(src, /case "composer.lease.claim":/)
  assert.match(src, /case "composer.lease.release":/)
  assert.match(src, /case "composer.lease.get":/)
})

test("lifecycle stamps __cmspark_surface from auth after ACL", () => {
  const life = path.resolve(__dirname, "..", "..", "src", "ws", "lifecycle.ts")
  const src = fs.readFileSync(life, "utf8")
  assert.match(src, /assertSummonerAllowed/)
  assert.match(src, /stampCmsparkSurface\s*\(/)
  assert.match(src, /authState\.surface/)
})

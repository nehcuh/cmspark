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
  claimOverlayLeaseCas,
  releaseOverlayLeaseCas,
  shouldBroadcastLease,
  applySummonerComposerVisibility,
  overlayLeasesOnSummonerDisconnect,
  broadcastOverlayLeasesOnSocketClose,
  type LeaseRpc,
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

test("followUpCreateFromQueue stamps summoner so overlay nextRun drain keeps the lease", async () => {
  const { followUpCreateFromQueue } = await import("../src/message-router")
  const overlayMsg = followUpCreateFromQueue("t1", "queued", "summoner")
  assert.equal(overlayMsg.__cmspark_surface, "summoner")
  const r = new ComposerLeaseRegistry()
  r.claim({ thread_id: "t1", holder: "overlay", rev: 0 })
  assert.equal(gateChatCreateOnLease("t1", overlayMsg.__cmspark_surface, r), null)
  const panelMsg = followUpCreateFromQueue("t1", "queued", "tray")
  assert.equal(panelMsg.__cmspark_surface, "tray")
  assert.equal(gateChatCreateOnLease("t1", panelMsg.__cmspark_surface, r)?.data.error_code, OVERLAY_STANDBY)
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
  const regen = src.slice(src.indexOf('case "chat.regenerate"'), src.indexOf('case "chat.regenerate"') + 1800)
  assert.match(regen, /gateChatCreateOnLease/)
  assert.match(src, /case "companion.ui.rect":/)
})

test("lifecycle stamps __cmspark_surface from auth after ACL", () => {
  const life = path.resolve(__dirname, "..", "..", "src", "ws", "lifecycle.ts")
  const src = fs.readFileSync(life, "utf8")
  assert.match(src, /assertSummonerAllowed/)
  assert.match(src, /stampCmsparkSurface\s*\(/)
  assert.match(src, /authState\.surface/)
})


test("claimOverlayLeaseCas retries once after LEASE_REV_MISMATCH", async () => {
  const r = new ComposerLeaseRegistry()
  r.claim({ thread_id: "race", holder: "panel", rev: 0 }) // rev=1 panel
  const calls: string[] = []
  const result = await claimOverlayLeaseCas("race", async (type, body) => {
    calls.push(`${type}:${body.rev ?? ""}`)
    return handleComposerLeaseFamily(type, { ...body, thread_id: "race" }, r)
  })
  assert.equal(result.ok, true)
  assert.equal(result.state?.holder, "overlay")
  assert.equal(result.state?.rev, 2)
  assert.deepEqual(calls, ["composer.lease.get:", "composer.lease.claim:1"])
})

test("claimOverlayLeaseCas recovers when get is stale vs concurrent claim", async () => {
  const r = new ComposerLeaseRegistry()
  let firstClaim = true
  const result = await claimOverlayLeaseCas("stale", async (type, body) => {
    if (type === "composer.lease.get") {
      return handleComposerLeaseFamily(type, { thread_id: "stale" }, r)
    }
    if (firstClaim) {
      firstClaim = false
      // Panel steals between get(rev=0) and overlay claim
      r.claim({ thread_id: "stale", holder: "panel", rev: 0 })
    }
    return handleComposerLeaseFamily(type, { ...body, thread_id: "stale" }, r)
  })
  assert.equal(result.ok, true)
  assert.equal(result.state?.holder, "overlay")
  assert.equal(r.get("stale").holder, "overlay")
})

test("claimOverlayLeaseCas fails after exhausting retries", async () => {
  const result = await claimOverlayLeaseCas(
    "loop",
    async () => ({ type: "composer.lease.error", error_code: "LEASE_REV_MISMATCH", rev: 9 }),
    2,
  )
  assert.equal(result.ok, false)
  assert.equal(result.error_code, "LEASE_REV_MISMATCH")
})

test("shouldBroadcastLease is true only for successful claim/release mutations", () => {
  const ok = { type: "composer.lease", thread_id: "t", holder: "overlay", rev: 1 }
  assert.equal(shouldBroadcastLease("composer.lease.claim", ok), true)
  assert.equal(shouldBroadcastLease("composer.lease.release", ok), true)
  assert.equal(shouldBroadcastLease("composer.lease.get", ok), false)
  assert.equal(
    shouldBroadcastLease("composer.lease.claim", { type: "composer.lease.error", error_code: "LEASE_REV_MISMATCH" }),
    false,
  )
})

test("releaseOverlayLeaseCas returns holder to panel", async () => {
  const r = new ComposerLeaseRegistry()
  r.claim({ thread_id: "t1", holder: "overlay", rev: 0 })
  const result = await releaseOverlayLeaseCas("t1", async (type, body) => {
    return handleComposerLeaseFamily(type, { ...body, thread_id: "t1" }, r)
  })
  assert.equal(result.ok, true)
  assert.equal(result.state?.holder, "panel")
  assert.equal(r.get("t1").holder, "panel")
})

test("releaseOverlayLeaseCas is a no-op when holder is already panel", async () => {
  const r = new ComposerLeaseRegistry()
  const result = await releaseOverlayLeaseCas("missing", async (type, body) => {
    return handleComposerLeaseFamily(type, { ...body, thread_id: "missing" }, r)
  })
  assert.equal(result.ok, true)
  assert.equal(r.get("missing").holder, "panel")
})

test("applySummonerComposerVisibility claims on open and releases on close", async () => {
  const r = new ComposerLeaseRegistry()
  const rpc: LeaseRpc = async (type, body) =>
    handleComposerLeaseFamily(type, { ...body, thread_id: "vis" }, r)

  const opened = await applySummonerComposerVisibility({
    visible: true,
    threadId: "vis",
    rpc,
  })
  assert.equal(opened.ok, true)
  assert.equal(r.get("vis").holder, "overlay")

  const closed = await applySummonerComposerVisibility({
    visible: false,
    threadId: "vis",
    rpc,
  })
  assert.equal(closed.ok, true)
  assert.equal(r.get("vis").holder, "panel")
})

test("overlay claim is exclusive: claiming T2 demotes T1 overlay hold", () => {
  const r = new ComposerLeaseRegistry()
  const t1 = r.claim({ thread_id: "t1", holder: "overlay", rev: 0 })
  assert.equal(t1.ok, true)
  const t2 = r.claim({ thread_id: "t2", holder: "overlay", rev: 0 })
  assert.equal(t2.ok, true)
  assert.equal(r.get("t2").holder, "overlay")
  assert.equal(r.get("t1").holder, "panel")
  assert.ok(r.get("t1").rev > 1, "demoted sibling must bump rev so Side Panel sees the broadcast")
})

test("overlay claim does not demote a panel-held sibling", () => {
  const r = new ComposerLeaseRegistry()
  r.claim({ thread_id: "panel-t", holder: "panel", rev: 0 })
  r.claim({ thread_id: "ov", holder: "overlay", rev: 0 })
  assert.equal(r.get("panel-t").holder, "panel")
  assert.equal(r.get("ov").holder, "overlay")
})

test("composer.lease.release_overlay handler releases all overlay holds", () => {
  const r = new ComposerLeaseRegistry()
  r.claim({ thread_id: "keep-panel", holder: "panel", rev: 0 })
  r.claim({ thread_id: "ov", holder: "overlay", rev: 0 })
  const got = handleComposerLeaseFamily("composer.lease.release_overlay", {}, r)
  assert.equal(got.type, "composer.lease.released")
  assert.equal(r.get("ov").holder, "panel")
  assert.equal(r.get("keep-panel").holder, "panel")
  assert.ok(Array.isArray(got.released))
  assert.ok(got.released.some((s: { thread_id: string }) => s.thread_id === "ov"))
})

test("composer.lease.claim overlay response includes released siblings for broadcast", () => {
  const r = new ComposerLeaseRegistry()
  handleComposerLeaseFamily(
    "composer.lease.claim",
    { thread_id: "old", holder: "overlay", rev: 0 },
    r,
  )
  const claimed = handleComposerLeaseFamily(
    "composer.lease.claim",
    { thread_id: "neu", holder: "overlay", rev: 0 },
    r,
  )
  assert.equal(claimed.type, "composer.lease")
  assert.equal(claimed.thread_id, "neu")
  assert.equal(claimed.holder, "overlay")
  assert.equal(r.get("old").holder, "panel")
  assert.ok(Array.isArray(claimed.released_siblings))
  assert.equal(claimed.released_siblings[0].thread_id, "old")
  assert.equal(claimed.released_siblings[0].holder, "panel")
})

test("shouldBroadcastLease is true for release_overlay success", () => {
  assert.equal(
    shouldBroadcastLease("composer.lease.release_overlay", {
      type: "composer.lease.released",
      released: [],
    }),
    true,
  )
})

test("claimOverlayLeaseCas exclusive claim demotes prior overlay thread", async () => {
  const r = new ComposerLeaseRegistry()
  r.claim({ thread_id: "old", holder: "overlay", rev: 0 })
  const result = await claimOverlayLeaseCas("neu", async (type, body) => {
    return handleComposerLeaseFamily(type, { ...body, thread_id: body.thread_id ?? "neu" }, r)
  })
  assert.equal(result.ok, true)
  assert.equal(r.get("neu").holder, "overlay")
  assert.equal(r.get("old").holder, "panel")
})

test("close visibility releases overlay even when the given thread id is stale", async () => {
  const r = new ComposerLeaseRegistry()
  r.claim({ thread_id: "shown", holder: "overlay", rev: 0 })
  const rpc: LeaseRpc = async (type, body) => handleComposerLeaseFamily(type, body, r)

  const closed = await applySummonerComposerVisibility({
    visible: false,
    threadId: "stale-or-empty",
    rpc,
  })
  assert.equal(closed.ok, true)
  assert.equal(r.get("shown").holder, "panel")
})

test("summoner socket close releases overlay holds; tray close does not", () => {
  const r = new ComposerLeaseRegistry()
  r.claim({ thread_id: "ov", holder: "overlay", rev: 0 })
  assert.equal(overlayLeasesOnSummonerDisconnect("tray", r).length, 0)
  assert.equal(r.get("ov").holder, "overlay")
  const released = overlayLeasesOnSummonerDisconnect("summoner", r)
  assert.equal(released.length, 1)
  assert.equal(released[0].thread_id, "ov")
  assert.equal(released[0].holder, "panel")
  assert.equal(r.get("ov").holder, "panel")
  assert.deepEqual(overlayLeasesOnSummonerDisconnect(undefined, r), [])
})

test("broadcastOverlayLeasesOnSocketClose emits composer.lease per released hold", () => {
  const r = new ComposerLeaseRegistry()
  r.claim({ thread_id: "ov", holder: "overlay", rev: 0 })
  const sent: Array<{ thread_id: string; holder: string }> = []
  const n = broadcastOverlayLeasesOnSocketClose(
    "summoner",
    (msg) => {
      sent.push({ thread_id: msg.thread_id, holder: msg.holder })
    },
    r,
  )
  assert.equal(n, 1)
  assert.deepEqual(sent, [{ thread_id: "ov", holder: "panel" }])
  assert.equal(broadcastOverlayLeasesOnSocketClose("tray", () => {}, r), 0)
})

test("claim holder must match handshake surface", () => {
  const r = new ComposerLeaseRegistry()
  const panelOnSummoner = handleComposerLeaseFamily(
    "composer.lease.claim",
    { thread_id: "t1", holder: "panel", rev: 0 },
    r,
    "summoner",
  )
  assert.equal(panelOnSummoner.error_code, "LEASE_HOLDER_SURFACE_MISMATCH")
  const overlayOnTray = handleComposerLeaseFamily(
    "composer.lease.claim",
    { thread_id: "t1", holder: "overlay", rev: 0 },
    r,
    "tray",
  )
  assert.equal(overlayOnTray.error_code, "LEASE_HOLDER_SURFACE_MISMATCH")
  const ok = handleComposerLeaseFamily(
    "composer.lease.claim",
    { thread_id: "t1", holder: "overlay", rev: 0 },
    r,
    "summoner",
  )
  assert.equal(ok.type, "composer.lease")
  assert.equal(ok.holder, "overlay")
})

test("gateChatCreateOnLease is the mutate gate used by chat.create and chat.regenerate", () => {
  const r = new ComposerLeaseRegistry()
  r.claim({ thread_id: "t1", holder: "overlay", rev: 0 })
  const err = gateChatCreateOnLease("t1", "tray", r)
  assert.equal(err?.data.error_code, OVERLAY_STANDBY)
  assert.equal(gateChatCreateOnLease("t1", "summoner", r), null)
})

test("panel chat.create is OVERLAY_STANDBY on old thread until exclusive switch", () => {
  const r = new ComposerLeaseRegistry()
  r.claim({ thread_id: "old", holder: "overlay", rev: 0 })
  assert.equal(gateChatCreateOnLease("old", "tray", r)?.data.error_code, OVERLAY_STANDBY)
  r.claim({ thread_id: "neu", holder: "overlay", rev: 0 })
  assert.equal(gateChatCreateOnLease("old", "tray", r), null)
  assert.equal(gateChatCreateOnLease("neu", "tray", r)?.data.error_code, OVERLAY_STANDBY)
})

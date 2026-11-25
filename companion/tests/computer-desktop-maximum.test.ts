import "./helpers/require-isolated-config-825"
import assert from "node:assert/strict"
import test from "node:test"
import { getConfig } from "../src/config"
import { armDesktopMaximum, desktopMaximumPermit, desktopMaximumStatus, reviewDesktopMaximum, revokeDesktopMaximum } from "../src/computer/desktop-maximum"

test("one reviewed desktop grant binds the connection, existing apps, image recipient and revocation", t => {
  const peer = {}, other = {}, initial = getConfig()
  const token = "mac.app.pad"
  const pad = { token, display_name: "Pad", kind: "gui" as const, policy: "manual" as const, source: "user" as const,
    enabled: true, added_at: "test", bundleId: "test.pad", coordinateAllowed: true }
  const cfg = { ...initial, llm: { ...initial.llm, api_key: "fake-key", model_name: "test", base_url: "https://example.test/v1" },
    apps: { enabled: true, entries: { [token]: pad } }, computer: { ...initial.computer!, coordinateEnabled: true },
    vision: { ...initial.vision!, enabled: true, reuse_main_model: true } }
  const review = () => reviewDesktopMaximum(peer, cfg)
  const fields = (id: string, images: boolean) => ({ id: "websocket-request", review_id: id, confirmation_phrase: "我了解风险", images })
  const permit = () => desktopMaximumPermit(peer, token, () => true, () => cfg)
  try {
    const offer = review()
    assert.deepEqual(offer.apps, [{ token, name: "Pad" }])
    assert.equal(JSON.stringify(offer).includes("fake-key"), false)
    assert.equal(armDesktopMaximum(other, fields(offer.review_id, true), cfg).type, "computer.maximum.error")
    assert.equal(armDesktopMaximum(peer, { ...fields(offer.review_id, true), confirmation_phrase: "" }, cfg).type, "computer.maximum.error")
    assert.equal(armDesktopMaximum(peer, fields(offer.review_id, true), cfg).type, "computer.maximum.error")
    const changed = review()
    pad.display_name = "Replacement"
    assert.equal(armDesktopMaximum(peer, fields(changed.review_id, false), cfg).type, "computer.maximum.error")
    pad.display_name = "Pad"
    assert.equal(armDesktopMaximum(peer, fields(review().review_id, false), cfg).type, "computer.maximum.status")
    assert.equal(permit()?.allowsModel(cfg.llm), false)
    assert.ok(permit()?.current())
    assert.equal(desktopMaximumStatus(other).expiresAt, null)
    assert.equal(desktopMaximumPermit(other, token, () => true, () => cfg), undefined)
    const old = permit()!
    revokeDesktopMaximum(peer)
    assert.ok(old.signal.aborted)
    armDesktopMaximum(peer, fields(review().review_id, true), cfg)
    assert.equal(old.current(), false)
    const granted = permit()!
    assert.ok(granted.allowsModel(cfg.llm))
    assert.equal(granted.allowsModel({ ...cfg.llm, model_name: "other" }), false)
    assert.equal(granted.allowsModel({ ...cfg.llm, api_key: "other" }), false)
    cfg.llm.base_url = "https://different.test/v1"
    assert.equal(granted.allowsModel(cfg.llm), false)
    Object.assign(cfg.apps.entries, { "mac.app.new": { ...pad, token: "mac.app.new" } })
    assert.equal(desktopMaximumPermit(peer, "mac.app.new", () => true, () => cfg), undefined)
    assert.equal(desktopMaximumPermit(peer, token, () => false, () => cfg), undefined)
    pad.coordinateAllowed = false
    assert.equal(granted.current(), false)
    assert.equal(revokeDesktopMaximum(other), false)
    assert.equal(revokeDesktopMaximum(peer), true)
    pad.coordinateAllowed = true
    armDesktopMaximum(peer, fields(review().review_id, true), cfg)
    const last = permit()!
    const expiry = desktopMaximumStatus(peer).expiresAt!
    t.mock.method(Date, "now", () => expiry)
    assert.equal(last.current(), false)
    assert.equal(last.signal.aborted, true)
    assert.equal(desktopMaximumStatus(peer).expiresAt, null)
  } finally { revokeDesktopMaximum() }
})

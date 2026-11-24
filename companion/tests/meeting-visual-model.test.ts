import "./meeting-test-data-dir"
import assert from "node:assert/strict"
import test from "node:test"
import { getConfig, getConfigSnapshot, saveConfig } from "../src/config"
import { readModelCenter, resolveMeetingVisualModel, saveModelCenter } from "../src/model-center"

test("the meeting image role can explicitly reuse legacy vision or a named profile and never inherits chat", () => {
  const snapshot = () => getConfigSnapshot()
  const change = (action: Parameters<typeof saveModelCenter>[0]) => saveModelCenter(action, snapshot().revision)
  const bind = (profile_id: string | null) => change({ kind: "bind", scope: "meeting_visual", profile_id })
  const secret = "fixture-vision-secret"
  saveConfig({ vision: { ...getConfig().vision!, enabled: true, api_key: secret, model_name: "fixture-image", base_url: "http://localhost:1234/v1" } }, { visionKey: true })
  assert.equal(resolveMeetingVisualModel(snapshot()), null)
  bind("configured_vision")
  assert.equal(resolveMeetingVisualModel(snapshot())?.vision.api_key, secret)
  assert.equal(resolveMeetingVisualModel(snapshot())?.vision.fallback, "error")
  assert.equal(resolveMeetingVisualModel(snapshot())?.vision.cache_ttl_seconds, 0)
  assert.ok(!JSON.stringify(readModelCenter()).includes(secret))
  const state = change({ kind: "create", name: "Saved image model", provider: { protocol: "anthropic", base_url: "https://example.invalid", model_name: "image-test", api_key: "profile-fixture" } })
  const id = state.model_center.profiles.find(p => p.name === "Saved image model")!.id
  bind(id)
  assert.equal(resolveMeetingVisualModel(snapshot())?.vision.protocol, "anthropic")
  assert.equal(resolveMeetingVisualModel(snapshot())?.vision.api_key, "profile-fixture")
  assert.throws(() => change({ kind: "remove", profile_id: id }), /MODEL_PROFILE_IN_USE/)
  assert.throws(() => change({ kind: "bind", scope: "chat", profile_id: "configured_vision" }), /INVALID_MODEL_CENTER_ACTION/)
  bind(null)
  assert.equal(resolveMeetingVisualModel(snapshot()), null)
  change({ kind: "remove", profile_id: id })
})

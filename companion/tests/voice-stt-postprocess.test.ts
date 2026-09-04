import test from "node:test"
import assert from "node:assert/strict"
import {
  applyVoicePostprocess,
  defaultVoicePostprocessPrefs,
} from "../src/voice/stt-postprocess"

test("defaults all off → identity, not postprocessed", () => {
  const prefs = defaultVoicePostprocessPrefs()
  assert.equal(prefs.fillers, false)
  assert.equal(prefs.lowercase, false)
  assert.equal(prefs.stripPunct, false)
  assert.deepEqual(prefs.map, [])
  const r = applyVoicePostprocess("嗯，Hello Kubernetes!", prefs)
  assert.equal(r.text, "嗯，Hello Kubernetes!")
  assert.equal(r.postprocessed, false)
})

test("fillers: zh/en filler table strips, keeps the rest", () => {
  const on = { ...defaultVoicePostprocessPrefs(), fillers: true }
  const r = applyVoicePostprocess("嗯 那个 I um think so", on)
  assert.equal(r.postprocessed, true)
  assert.equal(r.text.includes("嗯"), false)
  assert.equal(r.text.includes("um"), false)
  assert.ok(r.text.includes("think"))
})

test("word map replaces exact tokens", () => {
  const on = { ...defaultVoicePostprocessPrefs(), map: [["kuber netes", "Kubernetes"] as [string, string]] }
  const r = applyVoicePostprocess("install kuber netes today", on)
  assert.equal(r.text, "install Kubernetes today")
  assert.equal(r.postprocessed, true)
})

test("lowercase + strip trailing punct", () => {
  const on = { ...defaultVoicePostprocessPrefs(), lowercase: true, stripPunct: true }
  const r = applyVoicePostprocess("Hello World!!!", on)
  assert.equal(r.text, "hello world")
  assert.equal(r.postprocessed, true)
})

test("empty / whitespace input stays empty, not marked", () => {
  const on = { ...defaultVoicePostprocessPrefs(), fillers: true, lowercase: true }
  const r = applyVoicePostprocess("   ", on)
  assert.equal(r.text.trim(), "")
  assert.equal(r.postprocessed, false)
})

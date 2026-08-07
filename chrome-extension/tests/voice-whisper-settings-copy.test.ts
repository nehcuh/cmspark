// Path B M0 Task 7 — pure copy matrix for Settings local STT progressive disclosure.
// Locks recommended model id + dual-engine privacy residual wording (SoT §5 / §6.1).

import test from "node:test"
import assert from "node:assert/strict"

import {
  BROWSER_PRIVACY_COPY,
  ENGINE_BROWSER_HINT,
  ENGINE_LOCAL_HINT,
  LOCAL_PRIVACY_COPY,
  OTHER_WHISPER_MODEL_IDS,
  RECOMMENDED_WHISPER_MODEL_ID,
  WHISPER_SETTINGS_MODEL_IDS,
  binaryStatusLine,
  formatDiskUsage,
  privacyCopyForEngine,
  progressPercent,
} from "../src/sidepanel/voice/whisper-settings-copy"

test("recommended model id is medium (SoT primary)", () => {
  assert.equal(RECOMMENDED_WHISPER_MODEL_ID, "medium")
  assert.ok(WHISPER_SETTINGS_MODEL_IDS.includes("medium"))
  assert.ok(!OTHER_WHISPER_MODEL_IDS.includes("medium" as never))
  assert.deepEqual([...OTHER_WHISPER_MODEL_IDS], ["small", "large-v3-turbo"])
})

test("browser privacy may mention cloud / vendor residual", () => {
  assert.match(BROWSER_PRIVACY_COPY, /云端|厂商|Chrome/)
  // M1 wording: browser path does not route audio through Companion
  assert.match(BROWSER_PRIVACY_COPY, /不经过/)
  assert.match(BROWSER_PRIVACY_COPY, /Companion/)
  assert.equal(privacyCopyForEngine("browser"), BROWSER_PRIVACY_COPY)
})

test("local privacy forbids 不经过 Companion (Path B residual)", () => {
  assert.equal(/不经过/.test(LOCAL_PRIVACY_COPY), false)
  assert.match(LOCAL_PRIVACY_COPY, /Companion/)
  assert.match(LOCAL_PRIVACY_COPY, /临时/)
  assert.match(LOCAL_PRIVACY_COPY, /Whisper|本机/)
  // Must not claim absolute privacy
  assert.equal(/完全本地|完全离线|零风险|绝对隐私/.test(LOCAL_PRIVACY_COPY), false)
  assert.equal(privacyCopyForEngine("local"), LOCAL_PRIVACY_COPY)
})

test("engine radio hints match SoT §6.1 progressive disclosure", () => {
  assert.match(ENGINE_BROWSER_HINT, /云端|无需下载/)
  assert.match(ENGINE_LOCAL_HINT, /Companion/)
  assert.match(ENGINE_LOCAL_HINT, /临时|下载/)
  assert.equal(/不经过/.test(ENGINE_LOCAL_HINT), false)
})

test("progressPercent clamps 0–100", () => {
  assert.equal(progressPercent(0, 100), 0)
  assert.equal(progressPercent(50, 100), 50)
  assert.equal(progressPercent(100, 100), 100)
  assert.equal(progressPercent(150, 100), 100)
  assert.equal(progressPercent(10, 0), 0)
  assert.equal(progressPercent(NaN, 100), 0)
})

test("formatDiskUsage and binaryStatusLine (not_found OK for M0)", () => {
  assert.match(formatDiskUsage(100, 4096), /100 MB/)
  assert.match(formatDiskUsage(100, 4096), /预算/)
  const nf = binaryStatusLine({ status: "not_found" })
  assert.match(nf, /未找到/)
  assert.match(nf, /M0/)
  assert.match(binaryStatusLine({ status: "ready", path: "/opt/w" }), /已就绪/)
})

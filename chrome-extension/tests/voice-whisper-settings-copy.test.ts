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
  SYSTEM_PRIVACY_COPY,
  VOICE_ERR_COMPANION_DISCONNECTED,
  WHISPER_SETTINGS_MODEL_IDS,
  binaryStatusLine,
  formatDiskUsage,
  mapVoiceTransportError,
  parseVoiceSettingsSendResponse,
  privacyCopyForEngine,
  modelProbeErrorLabel,
  progressPercent,
  systemChainRows,
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

test("formatDiskUsage and binaryStatusLine (not_found prompts install)", () => {
  assert.match(formatDiskUsage(100, 4096), /100 MB/)
  assert.match(formatDiskUsage(100, 4096), /预算/)
  const nf = binaryStatusLine({ status: "not_found" })
  assert.match(nf, /未找到/)
  assert.match(nf, /安装|Homebrew|组件/)
  // Must not overclaim "一键下载" on platforms without HTTPS zip
  assert.equal(/一键下载/.test(nf), false)
  assert.match(binaryStatusLine({ status: "ready", path: "/opt/w" }), /已就绪/)
  assert.match(binaryStatusLine({ status: "hash_mismatch" }), /校验失败|重新安装/)
})

test("parseVoiceSettingsSendResponse surfaces SW / disconnect failures", () => {
  assert.equal(parseVoiceSettingsSendResponse({ ok: true }).ok, true)
  const disc = parseVoiceSettingsSendResponse({
    ok: false,
    error: "Companion 未连接，请确认菜单栏 CMspark 已启动且 Side Panel 显示已连接",
  })
  assert.equal(disc.ok, false)
  if (!disc.ok) assert.match(disc.error, /Companion|未连接/)

  const lastErr = parseVoiceSettingsSendResponse(undefined, "Receiving end does not exist.")
  assert.equal(lastErr.ok, false)
  if (!lastErr.ok) assert.match(lastErr.error, /重载|未响应|扩展/)

  const noResp = parseVoiceSettingsSendResponse(null)
  assert.equal(noResp.ok, false)
  if (!noResp.ok) assert.equal(noResp.error, VOICE_ERR_COMPANION_DISCONNECTED)
})

test("mapVoiceTransportError maps unknown message type to reload hint", () => {
  assert.match(mapVoiceTransportError("Unknown message type: voice.model.download"), /重载|版本/)
})

test("modelProbeErrorLabel http/network copy points at download source", () => {
  assert.match(modelProbeErrorLabel("http-error") || "", /模型下载源|hf-mirror/)
  assert.match(modelProbeErrorLabel("network-error") || "", /模型下载源|hf-mirror/)
  assert.match(modelProbeErrorLabel("HTTP 403 (https://huggingface.co/x)") || "", /模型下载源|hf-mirror/)
})

// --- #259 Windows SAPI system engine copy + chain rows ---------------------------

test("system privacy is local-class: Companion transport + offline claim bounded", () => {
  // Same Companion transport as local — must NOT claim audio bypasses Companion
  assert.equal(/不经过 Companion/.test(SYSTEM_PRIVACY_COPY), false)
  assert.match(SYSTEM_PRIVACY_COPY, /Companion/)
  assert.match(SYSTEM_PRIVACY_COPY, /System\.Speech|系统/)
  assert.match(SYSTEM_PRIVACY_COPY, /临时/)
  // Honest limits: win32-only + unsupported-language errors surface
  assert.match(SYSTEM_PRIVACY_COPY, /仅 Windows/)
  assert.match(SYSTEM_PRIVACY_COPY, /不支持的语言/)
  assert.equal(privacyCopyForEngine("system"), SYSTEM_PRIVACY_COPY)
})

test("systemChainRows empty unless win32 mirror present", () => {
  assert.deepEqual(systemChainRows(null), [])
  assert.deepEqual(systemChainRows(undefined), [])
  assert.deepEqual(systemChainRows({ platform: "other" }), [])
})

test("systemChainRows reflect probe truth on win32", () => {
  const rows = systemChainRows({
    platform: "win32",
    helper: { ok: true, pinned: true },
    systemSpeech: { available: true },
  })
  assert.equal(rows.length, 2)
  assert.equal(rows[0]!.ok, true)
  assert.match(rows[0]!.detail!, /已安装/)
  assert.equal(rows[1]!.ok, true)
  assert.match(rows[1]!.detail!, /SHA256/)

  const bad = systemChainRows({
    platform: "win32",
    helper: { ok: false, reason: "missing", message: "helper not found" },
    systemSpeech: { available: false, reason: "no_recognizers" },
  })
  assert.equal(bad[0]!.ok, false)
  assert.match(bad[0]!.detail!, /no_recognizers/)
  assert.equal(bad[1]!.ok, false)
  assert.match(bad[1]!.detail!, /helper not found/)
})

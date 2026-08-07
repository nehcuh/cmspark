// M0.5 pure tests — voice detect + error map + mic chrome matrix

import test from "node:test"
import assert from "node:assert/strict"
import {
  detectSpeechRecognition,
  getSpeechRecognitionCtor,
  isLikelyTier1Chrome,
  VOICE_DEFAULT_LANG,
  VOICE_MAX_LISTEN_MS,
} from "../src/sidepanel/voice/detect"
import {
  mapSpeechError,
  osMicPrivacyHint,
  resolveMicChrome,
} from "../src/sidepanel/voice/error-map"

test("detectSpeechRecognition: missing", () => {
  const d = detectSpeechRecognition({})
  assert.equal(d.ok, false)
  if (!d.ok) assert.equal(d.reason, "missing_ctor")
  assert.equal(getSpeechRecognitionCtor({}), null)
})

test("detectSpeechRecognition: webkit prefix", () => {
  const Fake = function () {} as unknown as new () => never
  const d = detectSpeechRecognition({ webkitSpeechRecognition: Fake as any })
  assert.equal(d.ok, true)
  if (d.ok) assert.equal(d.ctorName, "webkitSpeechRecognition")
})

test("detectSpeechRecognition: standard name preferred", () => {
  const Fake = function () {} as unknown as new () => never
  const d = detectSpeechRecognition({
    SpeechRecognition: Fake as any,
    webkitSpeechRecognition: Fake as any,
  })
  assert.equal(d.ok, true)
  if (d.ok) assert.equal(d.ctorName, "SpeechRecognition")
})

test("isLikelyTier1Chrome", () => {
  assert.equal(
    isLikelyTier1Chrome(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    ),
    true,
  )
  assert.equal(
    isLikelyTier1Chrome(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
    ),
    false,
  )
  assert.equal(isLikelyTier1Chrome("Mozilla/5.0 Firefox/128.0"), false)
})

test("SoT constants", () => {
  assert.equal(VOICE_DEFAULT_LANG, "zh-CN")
  assert.equal(VOICE_MAX_LISTEN_MS, 45_000)
})

test("mapSpeechError §6.6", () => {
  assert.match(mapSpeechError("not-allowed").message, /麦克风/)
  assert.equal(mapSpeechError("no-speech").message, "未识别到内容")
  assert.match(mapSpeechError("network").message, /网络/)
  assert.equal(mapSpeechError("aborted").severity, "silent")
  assert.match(mapSpeechError("timeout").message, /上限/)
  assert.equal(mapSpeechError("empty").message, "未识别到内容")
})

test("S52 N6: mapSpeechError not-allowed is OS-aware", () => {
  assert.match(
    mapSpeechError("not-allowed", { userAgent: "Mozilla/5.0 (Windows NT 10.0)" }).message,
    /Windows「设置 → 隐私和安全性 → 麦克风」/,
  )
  assert.match(
    mapSpeechError("not-allowed", {
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
    }).message,
    /macOS「系统设置 → 隐私与安全性 → 麦克风」/,
  )
  assert.match(
    mapSpeechError("not-allowed", { userAgent: "Mozilla/5.0 (X11; Linux x86_64)" }).message,
    /系统麦克风隐私设置/,
  )
  assert.equal(osMicPrivacyHint("Windows NT 10.0"), "Windows「设置 → 隐私和安全性 → 麦克风」")
  // Windows checked before Mac (no dual-match false macOS on exotic UAs)
  assert.match(osMicPrivacyHint("Windows"), /Windows/)
})

test("resolveMicChrome matrix", () => {
  assert.deepEqual(
    resolveMicChrome({
      voiceInputEnabled: false,
      speechSupported: true,
      tier1Chrome: true,
    }),
    { show: false, reason: "disabled_setting" },
  )
  assert.deepEqual(
    resolveMicChrome({
      voiceInputEnabled: true,
      speechSupported: false,
      tier1Chrome: true,
    }),
    { show: false, reason: "unsupported" },
  )
  assert.deepEqual(
    resolveMicChrome({
      voiceInputEnabled: true,
      speechSupported: true,
      tier1Chrome: true,
      permissionState: "denied",
    }),
    { show: true, enabled: false, reason: "permission_denied" },
  )
  assert.deepEqual(
    resolveMicChrome({
      voiceInputEnabled: true,
      speechSupported: true,
      tier1Chrome: true,
      online: false,
    }),
    { show: true, enabled: false, reason: "offline" },
  )
  assert.deepEqual(
    resolveMicChrome({
      voiceInputEnabled: true,
      speechSupported: true,
      tier1Chrome: true,
      threadBusy: true,
    }),
    { show: true, enabled: false, reason: "thread_busy" },
  )
  assert.deepEqual(
    resolveMicChrome({
      voiceInputEnabled: true,
      speechSupported: true,
      tier1Chrome: true,
      permissionState: "granted",
      online: true,
    }),
    { show: true, enabled: true },
  )
})

// Path B M1 Task 7 — pure composer UX helpers (timer format + banner CTA).

import test from "node:test"
import assert from "node:assert/strict"

import {
  CTA_OPEN_SETTINGS,
  CTA_SWITCH_BROWSER,
  LOCAL_LISTEN_HINT,
  TOAST_SWITCHED_BROWSER,
  formatListenRemaining,
  formatListenRemainingFromElapsed,
  localListeningStatusLabel,
  localSttBannerCta,
} from "../src/sidepanel/voice/error-map"

test("formatListenRemaining: 45s → 0:45; zeros clamp", () => {
  assert.equal(formatListenRemaining(45_000), "0:45")
  assert.equal(formatListenRemaining(44_001), "0:45") // ceil partial
  assert.equal(formatListenRemaining(1_000), "0:01")
  assert.equal(formatListenRemaining(999), "0:01")
  assert.equal(formatListenRemaining(0), "0:00")
  assert.equal(formatListenRemaining(-5), "0:00")
  assert.equal(formatListenRemaining(60_000), "1:00")
  assert.equal(formatListenRemaining(Number.NaN), "0:00")
})

test("formatListenRemainingFromElapsed: elapsed vs 45s cap", () => {
  assert.equal(formatListenRemainingFromElapsed(0), "0:45")
  assert.equal(formatListenRemainingFromElapsed(15_000), "0:30")
  assert.equal(formatListenRemainingFromElapsed(45_000), "0:00")
  assert.equal(formatListenRemainingFromElapsed(50_000), "0:00")
  assert.equal(formatListenRemainingFromElapsed(5_000, 10_000), "0:05")
})

test("localListeningStatusLabel includes remaining + 结束后本机识别", () => {
  const s = localListeningStatusLabel(12_500)
  assert.match(s, /0:13/)
  assert.match(s, new RegExp(LOCAL_LISTEN_HINT))
  assert.match(s, /本机转写/)
})

test("localSttBannerCta: disconnect/binary → browser; model_missing → settings", () => {
  assert.deepEqual(localSttBannerCta("companion_disconnected"), {
    kind: "switch_browser",
    label: CTA_SWITCH_BROWSER,
  })
  assert.deepEqual(localSttBannerCta("binary_missing"), {
    kind: "switch_browser",
    label: CTA_SWITCH_BROWSER,
  })
  assert.deepEqual(localSttBannerCta("hash_fail"), {
    kind: "switch_browser",
    label: CTA_SWITCH_BROWSER,
  })
  assert.deepEqual(localSttBannerCta("model_missing"), {
    kind: "open_settings",
    label: CTA_OPEN_SETTINGS,
  })
  assert.equal(localSttBannerCta("empty_result"), null)
  assert.equal(localSttBannerCta("aborted"), null)
  assert.equal(localSttBannerCta(null), null)
  assert.equal(localSttBannerCta(""), null)
})

test("toast residual mentions cloud vendor path (SoT §5.3)", () => {
  assert.match(TOAST_SWITCHED_BROWSER, /已改用浏览器听写/)
  assert.match(TOAST_SWITCHED_BROWSER, /浏览器|厂商|云/)
})

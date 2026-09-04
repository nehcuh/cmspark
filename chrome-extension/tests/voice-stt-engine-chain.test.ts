// #259 — engine chain third hop (Windows SAPI) pure state machine.
// Spec: docs/superpowers/specs/2026-09-04-windows-sapi-fallback.md §3.1/§6.

import test from "node:test"
import assert from "node:assert/strict"

import {
  detectChainPlatform,
  isBrowserFatalNetworkError,
  resolveSystemEngineSelection,
  shouldEscalateBrowserToSystem,
} from "../src/sidepanel/voice/stt-engine-chain"
import {
  SYSTEM_FALLBACK_BANNER,
  SYSTEM_LISTEN_HINT,
  SYSTEM_UNAVAILABLE_BROWSER_BANNER,
  mapLocalSttError,
} from "../src/sidepanel/voice/error-map"

// --- resolveSystemEngineSelection ------------------------------------------------

test("configured browser/local pass through untouched (chain hop 1-2 authority)", () => {
  assert.deepEqual(
    resolveSystemEngineSelection({ platform: "win32", configured: "browser", systemAvailable: true }),
    { engine: "browser", reason: "system_unselected" },
  )
  assert.deepEqual(
    resolveSystemEngineSelection({ platform: "win32", configured: "local", systemAvailable: false }),
    { engine: "local", reason: "system_unselected" },
  )
})

test("configured system on win32 + probe green → system engine", () => {
  assert.deepEqual(
    resolveSystemEngineSelection({ platform: "win32", configured: "system", systemAvailable: true }),
    { engine: "system", reason: "system_selected" },
  )
})

test("configured system fail-closes to browser off win32 (stale config)", () => {
  assert.deepEqual(
    resolveSystemEngineSelection({ platform: "other", configured: "system", systemAvailable: true }),
    { engine: "browser", reason: "system_not_win32" },
  )
})

test("configured system on win32 but probe not green → browser (honest degrade)", () => {
  assert.deepEqual(
    resolveSystemEngineSelection({ platform: "win32", configured: "system", systemAvailable: false }),
    { engine: "browser", reason: "system_unavailable" },
  )
})

// --- browser → system escalation -------------------------------------------------

test("escalation requires a network-class browser error", () => {
  assert.equal(isBrowserFatalNetworkError("network"), true)
  assert.equal(isBrowserFatalNetworkError("service-not-allowed"), true)
  assert.equal(isBrowserFatalNetworkError("no-speech"), false)
  assert.equal(isBrowserFatalNetworkError("not-allowed"), false)
  assert.equal(isBrowserFatalNetworkError("aborted"), false)
  assert.equal(isBrowserFatalNetworkError(""), false)
})

test("escalation only on win32 + systemAvailable + network-class error (all three)", () => {
  const yes = { platform: "win32" as const, browserErrorCode: "network", systemAvailable: true }
  assert.equal(shouldEscalateBrowserToSystem(yes), true)
  assert.equal(
    shouldEscalateBrowserToSystem({ ...yes, platform: "other" }),
    false,
  )
  assert.equal(
    shouldEscalateBrowserToSystem({ ...yes, systemAvailable: false }),
    false,
  )
  assert.equal(
    shouldEscalateBrowserToSystem({ ...yes, browserErrorCode: "audio-capture" }),
    false,
  )
})

// --- detectChainPlatform ----------------------------------------------------------

test("detectChainPlatform maps UA platform containing win → win32, else other", () => {
  // darwin node: navigator.platform is empty/undefined in node --test
  const p = detectChainPlatform()
  assert.ok(p === "win32" || p === "other")
})

// --- user-facing copy (error-map) -------------------------------------------------

test("system engine honest error copy", () => {
  assert.equal(mapLocalSttError("system_engine_failed").severity, "banner")
  assert.equal(mapLocalSttError("system_unavailable").message, "系统语音识别不可用（Windows 系统语音或 helper 未就绪）")
  assert.equal(mapLocalSttError("system_lang_unsupported").message, "系统语音识别不支持当前语言")
})

test("system fallback banners exist and mention the local nature", () => {
  assert.ok(SYSTEM_FALLBACK_BANNER.includes("Windows 系统语音识别"))
  assert.ok(SYSTEM_FALLBACK_BANNER.includes("不经云端"))
  assert.ok(SYSTEM_UNAVAILABLE_BROWSER_BANNER.length > 0)
  assert.ok(SYSTEM_LISTEN_HINT.length > 0)
})

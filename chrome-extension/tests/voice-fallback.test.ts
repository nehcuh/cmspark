// Per-session local→browser fallback gating (voice.autoFallbackToBrowser).
// Review fix 2026-08-31: un-hydrated readiness must NOT engage the fallback.

import test from "node:test"
import assert from "node:assert/strict"

import { resolveLocalFallbackActive } from "../src/sidepanel/hooks/useVoiceInput"

const base = {
  configuredEngine: "local" as const,
  autoFallbackToBrowser: true,
  companionConnected: true,
  localStateHydrated: true,
  localModelReady: false,
}

test("fallback engages only when hydrated + model confirmed missing", () => {
  assert.equal(resolveLocalFallbackActive(base), true)
  // model actually ready → no fallback
  assert.equal(resolveLocalFallbackActive({ ...base, localModelReady: true }), false)
  // hydration window: state mirror not yet arrived → fail-closed, no fallback
  assert.equal(
    resolveLocalFallbackActive({ ...base, localStateHydrated: false, localModelReady: false }),
    false,
  )
  assert.equal(
    resolveLocalFallbackActive({
      ...base,
      localStateHydrated: undefined,
      localModelReady: undefined,
    }),
    false,
  )
})

test("pref / engine / connection gates", () => {
  // user disabled the pref
  assert.equal(resolveLocalFallbackActive({ ...base, autoFallbackToBrowser: false }), false)
  // default (undefined) = on
  assert.equal(resolveLocalFallbackActive({ ...base, autoFallbackToBrowser: undefined }), true)
  // browser engine never "falls back"
  assert.equal(
    resolveLocalFallbackActive({ ...base, configuredEngine: "browser" as const }),
    false,
  )
  // companion disconnected → existing fail-closed path, no fallback
  assert.equal(resolveLocalFallbackActive({ ...base, companionConnected: false }), false)
  assert.equal(resolveLocalFallbackActive({ ...base, companionConnected: undefined }), false)
})

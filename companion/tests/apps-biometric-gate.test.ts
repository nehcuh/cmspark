// WP2 biometric gate — D2 flow matrix: Hello ok / cancelled (hard deny, no
// fallback) / unavailable (manual-nonce downgrade) / non-win32 (nonce direct).
// The logger transitively imports config, so DATA_DIR is pinned first.

import "./_config-router-setup" // MUST be first — pins DATA_DIR before config/logger import.

import test from "node:test"
import * as assert from "node:assert/strict"

import { requireAppsBiometric } from "../src/apps/biometric-gate"
import type { SecurityConfirmationDetails } from "../src/security-confirmation"

function fakeConfirmationChannel(
  behavior: "approve" | "deny",
  captured: { details?: SecurityConfirmationDetails; calls: number },
) {
  return async (details: SecurityConfirmationDetails) => {
    captured.calls += 1
    captured.details = details
    return {
      confirmationId: "test-conf-id",
      approved: behavior === "approve",
      reason: behavior === "approve" ? ("approved" as const) : ("denied" as const),
    }
  }
}

test("Hello ok → approved windows-hello, nonce echoed, no confirmation fallback", async () => {
  const captured = { calls: 0, details: undefined as SecurityConfirmationDetails | undefined }
  const outcome = await requireAppsBiometric({
    action: "apps.add",
    reason: 'Add "App" as an auto-launch app',
    requestConfirmation: fakeConfirmationChannel("approve", captured),
    deps: {
      platform: "win32",
      tryHello: async () => ({ ok: true, nonce: "abc123" }),
    },
  })
  assert.deepEqual(outcome, { approved: true, method: "windows-hello", nonce: "abc123" })
  assert.equal(captured.calls, 0, "confirmation channel must NOT be used when Hello succeeds")
})

test("Hello cancelled → hard deny, NEVER falls back to manual nonce", async () => {
  const captured = { calls: 0, details: undefined as SecurityConfirmationDetails | undefined }
  const outcome = await requireAppsBiometric({
    action: "apps.set_policy",
    reason: 'Upgrade "App" to auto-launch',
    requestConfirmation: fakeConfirmationChannel("approve", captured),
    deps: {
      platform: "win32",
      tryHello: async () => ({ cancelled: true }),
    },
  })
  assert.deepEqual(outcome, { approved: false, reason: "cancelled" })
  assert.equal(captured.calls, 0, "cancel → deny: the nonce fallback must NOT be offered")
})

test("Hello unavailable → manual-nonce downgrade; request carries 6-char challenge + toolName", async () => {
  const captured = { calls: 0, details: undefined as SecurityConfirmationDetails | undefined }
  const outcome = await requireAppsBiometric({
    action: "apps.add",
    reason: 'Add "App" as an auto-launch app',
    requestConfirmation: fakeConfirmationChannel("approve", captured),
    deps: {
      platform: "win32",
      tryHello: async () => ({ unavailable: true }),
      generateNonce: () => "K7M9QX",
    },
  })
  assert.deepEqual(outcome, { approved: true, method: "manual-nonce", nonce: "K7M9QX" })
  assert.equal(captured.calls, 1)
  const d = captured.details!
  assert.equal(d.toolName, "apps.add")
  assert.equal(d.nonceChallenge, "K7M9QX")
  assert.match(String(d.code), /type the 6-char code to approve/)
  assert.deepEqual(d.dangerousApis, [])
})

test("manual-nonce denial → approved:false, denial reason propagated", async () => {
  const captured = { calls: 0, details: undefined as SecurityConfirmationDetails | undefined }
  const outcome = await requireAppsBiometric({
    action: "apps.add",
    reason: "x",
    requestConfirmation: fakeConfirmationChannel("deny", captured),
    deps: {
      platform: "win32",
      tryHello: async () => ({ unavailable: true }),
      generateNonce: () => "AAAAAA",
    },
  })
  assert.deepEqual(outcome, { approved: false, reason: "denied" })
})

test("non-win32 platform → straight to manual-nonce (no Hello attempt)", async () => {
  const captured = { calls: 0, details: undefined as SecurityConfirmationDetails | undefined }
  let helloCalled = false
  const outcome = await requireAppsBiometric({
    action: "apps.add",
    reason: "x",
    requestConfirmation: fakeConfirmationChannel("approve", captured),
    deps: {
      platform: "linux",
      tryHello: async () => { helloCalled = true; return { ok: true, nonce: "n" } },
      generateNonce: () => "BBBBBB",
    },
  })
  assert.equal(helloCalled, false)
  assert.deepEqual(outcome, { approved: true, method: "manual-nonce", nonce: "BBBBBB" })
  assert.equal(captured.calls, 1)
})

test("Hello infra exception → approved:false reason error (no silent grant)", async () => {
  const outcome = await requireAppsBiometric({
    action: "apps.add",
    reason: "x",
    requestConfirmation: fakeConfirmationChannel("approve", { calls: 0 }),
    deps: {
      platform: "win32",
      tryHello: async () => { throw new Error("nonce echo mismatch") },
    },
  })
  assert.equal(outcome.approved, false)
  if (!outcome.approved) assert.equal(outcome.reason, "error")
})

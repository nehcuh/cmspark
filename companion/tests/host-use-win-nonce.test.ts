// Unit tests for the manual-nonce flow in SecurityConfirmationManager
// (Phase 1 W8-windows fallback / W9-linux; plan §E + adversary amendments
// A1/A4):
//   - challenge stored on the pending entry + sent on the wire
//   - correct code (case-insensitive) resolves approved
//   - wrong code → security.confirmation.nonce_retry, entry stays pending
//   - 3rd wrong code → nonce_locked, confirmation resolves denied
//   - non-origin socket rejected BEFORE nonce logic; attempts not consumed
//     (amendment A1 — a rogue loopback peer must not burn attempts)

import test from "node:test"
import assert from "node:assert/strict"
import type { WebSocket } from "ws"

import {
  SecurityConfirmationManager,
  MAX_NONCE_ATTEMPTS,
} from "../src/security-confirmation.js"

/** Stub WebSocket — the manager only compares originWs by identity. */
function mockWs(label: string): WebSocket {
  return { __mockWsLabel: label } as unknown as WebSocket
}

function setup(opts?: { originWs?: WebSocket; challenge?: string }) {
  const sent: any[] = []
  const manager = new SecurityConfirmationManager(60_000)
  const pending = manager.request(
    (msg) => sent.push(msg),
    {
      toolName: "host_write",
      dangerousApis: [],
      code: "host_write create",
      nonceChallenge: opts?.challenge ?? "ABC3DEF",
    },
    opts?.originWs ? { originWs: opts.originWs } : undefined,
  )
  const confirmationId = (sent[0] as any).confirmation_id as string
  return { sent, manager, pending, confirmationId }
}

test("nonce challenge is stored on the pending entry and sent on the wire", () => {
  const { sent, manager, confirmationId } = setup({ challenge: "K7P3QX" })
  assert.equal(manager.getNonceChallenge(confirmationId), "K7P3QX")
  assert.equal(sent[0].type, "security.confirmation.request")
  assert.equal(sent[0].nonce_challenge, "K7P3QX")
  assert.equal(MAX_NONCE_ATTEMPTS, 3)
  manager.rejectAll("disconnect") // clean up the pending timer
})

test("correct nonce resolves approved (case-insensitive match)", async () => {
  const { manager, pending, confirmationId } = setup({ challenge: "ABC3DEF" })
  // Extension uppercases before sending; match must also tolerate lowercase.
  const result = manager.respondFrom(confirmationId, true, undefined, "abc3def")
  assert.equal(result.outcome, "resolved")
  const decision = await pending
  assert.equal(decision.approved, true)
  assert.equal(decision.reason, "approved")
})

test("wrong nonce → nonce_retry; entry stays pending; attempts_left reported", async () => {
  const { sent, manager, pending, confirmationId } = setup({ challenge: "ABC3DEF" })
  const wrong = manager.respondFrom(confirmationId, true, undefined, "XXXXXX")
  assert.equal(wrong.outcome, "nonce_retry")
  assert.equal(wrong.attemptsLeft, 2)
  const retryMsg = sent.find((m) => m.type === "security.confirmation.nonce_retry")
  assert.ok(retryMsg, "client must receive security.confirmation.nonce_retry")
  assert.equal(retryMsg.confirmation_id, confirmationId)
  assert.equal(retryMsg.attempts_left, 2)
  // Entry still pending — challenge unchanged, no resolved message yet.
  assert.equal(manager.getNonceChallenge(confirmationId), "ABC3DEF")
  assert.equal(sent.some((m) => m.type === "security.confirmation.resolved"), false)
  // Correct code afterwards still resolves.
  const right = manager.respondFrom(confirmationId, true, undefined, "ABC3DEF")
  assert.equal(right.outcome, "resolved")
  const decision = await pending
  assert.equal(decision.approved, true)
})

test("3rd wrong nonce → nonce_locked; confirmation resolves denied", async () => {
  const { manager, pending, confirmationId } = setup({ challenge: "ABC3DEF" })
  assert.equal(manager.respondFrom(confirmationId, true, undefined, "WRONG1").outcome, "nonce_retry")
  assert.equal(manager.respondFrom(confirmationId, true, undefined, "WRONG2").outcome, "nonce_retry")
  const third = manager.respondFrom(confirmationId, true, undefined, "WRONG3")
  assert.equal(third.outcome, "nonce_locked")
  assert.equal(third.attemptsLeft, 0)
  const decision = await pending
  assert.equal(decision.approved, false)
  assert.equal(decision.reason, "denied")
  // Entry gone.
  assert.equal(manager.getNonceChallenge(confirmationId), undefined)
  assert.equal(manager.respondFrom(confirmationId, true).outcome, "unknown")
})

test("non-origin socket rejected BEFORE nonce logic; attempts not consumed (amendment A1)", async () => {
  const originWs = mockWs("origin")
  const rogueWs = mockWs("rogue")
  const { sent, manager, pending, confirmationId } = setup({ originWs, challenge: "ABC3DEF" })

  // Rogue peer sends a WRONG nonce — must be rejected as origin_mismatch and
  // must NOT consume one of the 3 attempts.
  const rogue = manager.respondFrom(confirmationId, true, rogueWs, "WRONG1")
  assert.equal(rogue.outcome, "origin_mismatch")
  assert.equal(sent.some((m) => m.type === "security.confirmation.nonce_retry"), false)

  // Origin socket now sends a wrong nonce — this must be attempt #1 (2 left),
  // proving the rogue attempt was not consumed.
  const first = manager.respondFrom(confirmationId, true, originWs, "WRONG1")
  assert.equal(first.outcome, "nonce_retry")
  assert.equal(first.attemptsLeft, 2)

  // Origin with the right code still resolves.
  const right = manager.respondFrom(confirmationId, true, originWs, "ABC3DEF")
  assert.equal(right.outcome, "resolved")
  const decision = await pending
  assert.equal(decision.approved, true)
})

test("denial resolves immediately regardless of nonce (no retry consumed)", async () => {
  const { manager, pending, confirmationId } = setup({ challenge: "ABC3DEF" })
  const result = manager.respondFrom(confirmationId, false, undefined, "WRONG1")
  assert.equal(result.outcome, "resolved")
  const decision = await pending
  assert.equal(decision.approved, false)
  assert.equal(decision.reason, "denied")
})

test("missing nonce_response on an approval counts as a mismatch", async () => {
  const { manager, pending, confirmationId } = setup({ challenge: "ABC3DEF" })
  const result = manager.respondFrom(confirmationId, true, undefined, undefined)
  assert.equal(result.outcome, "nonce_retry")
  assert.equal(result.attemptsLeft, 2)
  manager.rejectAll("disconnect")
  const decision = await pending
  assert.equal(decision.reason, "disconnect")
})

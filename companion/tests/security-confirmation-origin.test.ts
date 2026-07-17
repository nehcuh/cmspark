// Regression tests for [C-SEC-2] + [C-SRV-1]:
//
// [C-SEC-2] history.export confirmation has no origin binding — any connected
//            WS client could self-approve. Fixed by tracking originWs on each
//            pending confirmation; only the originating socket may resolve.
//
// [C-SRV-1] securityConfirmations.rejectAll("disconnect") cleared OTHER
//            connections' prompts. Fixed by adding an optional ws filter to
//            rejectAll; only entries whose originWs matches are rejected.

import test, { before, after } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import type { WebSocket } from "ws"

let SecurityConfirmationManager: typeof import("../src/security-confirmation").SecurityConfirmationManager

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-sec-confirm-origin-"))

before(async () => {
  process.env.HOME = tempHome
  const mod = await import("../src/security-confirmation")
  SecurityConfirmationManager = mod.SecurityConfirmationManager
})

after(() => {
  fs.rmSync(tempHome, { recursive: true, force: true })
})

/**
 * Stub WebSocket. The SecurityConfirmationManager only checks originWs by
 * identity (===) — it never invokes ws methods — so a plain tagged object
 * is sufficient and avoids real socket allocation races under parallel test
 * load.
 */
function mockWs(label: string): WebSocket {
  return { __mockWsLabel: label } as unknown as WebSocket
}

test("[C-SEC-2] respondFrom rejects response from a non-origin socket; original stays pending", async () => {
  const sent: any[] = []
  const manager = new SecurityConfirmationManager(60_000)
  const originWs = mockWs("origin")
  const rogueWs = mockWs("rogue")

  const pending = manager.request(
    (msg) => sent.push(msg),
    { toolName: "history.export", dangerousApis: [], code: "export({})" },
    { originWs },
  )

  const confirmationId = sent[0].confirmation_id

  // Rogue socket attempts to approve — must be rejected (outcome
  // "origin_mismatch") and leave the pending entry intact so the legitimate
  // origin can still answer.
  const acceptedFromRogue = manager.respondFrom(confirmationId, true, rogueWs)
  assert.equal(acceptedFromRogue.outcome, "origin_mismatch", "respondFrom must reject non-origin socket")

  // Original confirmation still pending (no resolved message emitted yet).
  assert.equal(sent.some((m) => m.type === "security.confirmation.resolved"), false)

  // Origin socket approves — must succeed.
  const acceptedFromOrigin = manager.respondFrom(confirmationId, true, originWs)
  assert.equal(acceptedFromOrigin.outcome, "resolved")

  const decision = await pending
  assert.equal(decision.approved, true)
  assert.equal(decision.reason, "approved")
})

test("[C-SEC-2] respondFrom with no sourceWs is also rejected for origin-bound entries (forces callers to pass ws)", async () => {
  const sent: any[] = []
  const manager = new SecurityConfirmationManager(60_000)
  const originWs = mockWs("origin-no-source")

  manager.request(
    (msg) => sent.push(msg),
    { toolName: "history.export", dangerousApis: [], code: "export({})" },
    { originWs },
  )
  const confirmationId = sent[0].confirmation_id

  // respondFrom called with no source ws — must NOT silently resolve an
  // origin-bound confirmation. Forces call sites to pass the source ws.
  assert.equal(manager.respondFrom(confirmationId, true).outcome, "origin_mismatch")

  // Legacy privileged respond() — bypasses origin check, resolves anything.
  assert.equal(manager.respond(confirmationId, true), true)
})

test("[C-SRV-1] rejectAll('disconnect', ws) only rejects entries owned by that socket", async () => {
  const manager = new SecurityConfirmationManager(60_000)
  const ws1 = mockWs("ws1")
  const ws2 = mockWs("ws2")

  const ws1Promise = manager.request(
    () => { /* discard */ },
    { toolName: "history.export", dangerousApis: [], code: "export(ws1)" },
    { originWs: ws1 },
  )
  const ws2Promise = manager.request(
    () => { /* discard */ },
    { toolName: "history.export", dangerousApis: [], code: "export(ws2)" },
    { originWs: ws2 },
  )

  // ws1 disconnects — only ws1's confirmation should be rejected; ws2 survives.
  manager.rejectAll("disconnect", ws1)

  const ws1Decision = await ws1Promise
  assert.equal(ws1Decision.approved, false)
  assert.equal(ws1Decision.reason, "disconnect")

  // ws2 must still be pending — prove by resolving it cleanly from its own
  // origin socket via the privileged legacy respond() (no source ws needed).
  // Use a short timeout race so the test fails loudly if ws2 was wrongly
  // rejected by the ws1 disconnect.
  let ws2Resolved = false
  ws2Promise.then(() => { ws2Resolved = true })
  await new Promise((r) => setTimeout(r, 5))
  assert.equal(ws2Resolved, false, "ws2 confirmation must still be pending after ws1 disconnect")

  // Now resolve ws2 via its origin — must succeed.
  // We need the id; re-issue a request through the same manager to discover it
  // is unnecessary — instead clean up via rejectAll('disconnect', ws2).
  manager.rejectAll("disconnect", ws2)
  const ws2Decision = await ws2Promise
  assert.equal(ws2Decision.approved, false)
  assert.equal(ws2Decision.reason, "disconnect")
})

test("[C-SRV-1] rejectAll('disconnect') with no ws filter rejects everything (backward compat)", async () => {
  const manager = new SecurityConfirmationManager(60_000)
  const ws1 = mockWs("bc-ws1")
  const ws2 = mockWs("bc-ws2")

  const p1 = manager.request(
    () => { /* discard */ },
    { toolName: "evaluate", dangerousApis: [], code: "x" },
    { originWs: ws1 },
  )
  const p2 = manager.request(
    () => { /* discard */ },
    { toolName: "evaluate", dangerousApis: [], code: "y" },
    { originWs: ws2 },
  )

  manager.rejectAll("disconnect")

  const [d1, d2] = await Promise.all([p1, p2])
  assert.equal(d1.approved, false)
  assert.equal(d1.reason, "disconnect")
  assert.equal(d2.approved, false)
  assert.equal(d2.reason, "disconnect")
})

test("[backward compat] request() without originWs still works; any socket may respond", async () => {
  const manager = new SecurityConfirmationManager(60_000)
  const ws = mockWs("bc-no-origin")

  // Old-style call: no options bag → broadcast-style confirmation.
  const pending = manager.request(
    () => { /* discard */ },
    { toolName: "evaluate", dangerousApis: [], code: "z" },
  )

  // Wait for the request to be registered synchronously by flushing microtasks.
  await new Promise((r) => setTimeout(r, 0))

  // For broadcast-style confirmations (no originWs), any source ws may resolve.
  // We need the id — issue a second request with a capturing send.
  const sent: any[] = []
  const pending2 = manager.request(
    (msg) => sent.push(msg),
    { toolName: "evaluate", dangerousApis: [], code: "w" },
  )
  const id = sent[0].confirmation_id

  // A different socket responds — broadcast-style must accept it.
  assert.equal(manager.respondFrom(id, true, ws).outcome, "resolved")
  const decision = await pending2
  assert.equal(decision.approved, true)

  // pending (first one) — clear via broadcast reject.
  manager.rejectAll("disconnect")
  const d1 = await pending
  assert.equal(d1.reason, "disconnect")
})

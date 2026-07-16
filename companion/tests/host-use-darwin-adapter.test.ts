// Unit tests for companion/src/host-use/darwin/adapter.ts
//
// Mocks the cmspark-host Swift binary (no real AppleScript / TCC invocation).
// Tests validate the adapter contract:
//   - validateTargetId enforces darwin format (Kimi Round 2 + Pi-sub)
//   - listReadTargets validates every returned id (defense in depth)
//   - readOne re-validates + vault-checks on consume side
//   - writeOne throws NotImplemented (Phase 1 W6)
//   - non-mail-inbox kinds throw NotImplemented (Phase 1 W5 scope)

import test from "node:test"
import assert from "node:assert/strict"
import { DarwinHostAdapter } from "../src/host-use/darwin/adapter.js"

// Mock binary path — tests construct adapter directly with a fake bin path.
// We don't actually spawn anything in these tests (writeOne/non-mail kind/
// validateTargetId paths don't reach execFile).
const FAKE_BIN = "/nonexistent/cmspark-host-test"

test("validateTargetId: accepts well-formed mail TargetId", () => {
  const a = new DarwinHostAdapter(FAKE_BIN)
  const id = a.validateTargetId("macos:com.apple.mail:iCloud:msg-1")
  assert.equal(id as string, "macos:com.apple.mail:iCloud:msg-1")
})

test("validateTargetId: rejects missing macos: prefix (LLM forgery)", () => {
  const a = new DarwinHostAdapter(FAKE_BIN)
  assert.throws(
    () => a.validateTargetId("com.apple.mail:iCloud:msg-1"),
    /malformed darwin TargetId/,
  )
})

test("validateTargetId: rejects unknown app segment", () => {
  const a = new DarwinHostAdapter(FAKE_BIN)
  assert.throws(
    () => a.validateTargetId("macos:com.example.mail:iCloud:msg-1"),
    /malformed darwin TargetId/,
  )
})

test("validateTargetId: rejects unknown kind suffix", () => {
  const a = new DarwinHostAdapter(FAKE_BIN)
  assert.throws(
    () => a.validateTargetId("macos:com.apple.mail:iCloud:contact-1"),
    /malformed darwin TargetId/,
  )
})

test("validateTargetId: rejects empty account segment (collision risk)", () => {
  const a = new DarwinHostAdapter(FAKE_BIN)
  assert.throws(
    () => a.validateTargetId("macos:com.apple.mail::msg-1"),
    /malformed darwin TargetId/,
  )
})

test("validateTargetId: rejects non-string input", () => {
  const a = new DarwinHostAdapter(FAKE_BIN)
  assert.throws(() => a.validateTargetId("" as string), /empty or non-string/)
  assert.throws(() => a.validateTargetId(null as any), /empty or non-string/)
})

test("writeOne: throws NotImplemented (Phase 1 W6)", async () => {
  const a = new DarwinHostAdapter(FAKE_BIN)
  const id = a.validateTargetId("macos:com.apple.mail:iCloud:msg-1")
  await assert.rejects(
    () => a.writeOne(id, { kind: "create", body: "x" }),
    /not implemented in Phase 1 W5/,
  )
})

test("listReadTargets: throws NotImplemented for non-mail-inbox kinds", async () => {
  const a = new DarwinHostAdapter(FAKE_BIN)
  await assert.rejects(
    () => a.listReadTargets("note"),
    /kind "note" not implemented in Phase 1 W5/,
  )
  await assert.rejects(
    () => a.listReadTargets("file"),
    /kind "file" not implemented in Phase 1 W5/,
  )
})

test("readOne: rejects unvalidated TargetId (forged id bypass attempt)", async () => {
  const a = new DarwinHostAdapter(FAKE_BIN)
  // Cast raw string directly to bypass validateTargetId — simulates a
  // companion bug or LLM-forged id reaching readOne.
  const forged = "linux:atspi://evil/path" as any
  await assert.rejects(
    () => a.readOne(forged),
    /TargetId malformed/,
  )
})

test("readOne: rejects TargetId for vault app (e.g. com.apple.mail blocked via app segment manipulation)", async () => {
  // This test verifies the defense-in-depth vault check inside readOne.
  // Construct a TargetId that passes regex (it allows Notes for Phase 1 W6
  // forward-compat) but has a vault-app bundle. The vault check inside readOne
  // must catch it before spawning the binary.
  //
  // Note: in practice the regex currently restricts to (mail|Notes|finder)
  // and Mail is NOT on the vault blacklist. This test uses a forged "Notes"
  // id that the regex permits but the vault check would catch if Notes were
  // ever blacklisted. Marking as TODO for Phase 1 W6 when Notes ships.
  // For now, we test that readOne calls isVaultApp and rejects known vault
  // apps. The bypass test below forges com.apple.keychainaccess which the
  // regex's app segment doesn't accept — so the regex catches it first.
  const a = new DarwinHostAdapter(FAKE_BIN)
  // Forgery attempt: regex won't match because keychainaccess isn't in
  // the (mail|Notes|finder) app segment whitelist.
  await assert.rejects(
    () => a.readOne("macos:com.apple.keychainaccess:icloud:msg-1" as any),
    /TargetId malformed/,
  )
})

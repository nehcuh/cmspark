// UX-spike 2026-07-23 — per-session re-L2 suppression store unit tests.
// See src/computer/session-trust.ts for the scope/safety rationale (NOT a
// ThreadApprovals kind; suppresses re-L2 only, never the initial task L2).

import test from "node:test"
import assert from "node:assert/strict"

import { ComputerSessionTrust } from "../src/computer/session-trust"

test("ComputerSessionTrust: grant + isTrusted round-trip", () => {
  const t = new ComputerSessionTrust()
  assert.equal(t.isTrusted("s1", "win.app.a"), false)
  t.grant("s1", "win.app.a")
  assert.equal(t.isTrusted("s1", "win.app.a"), true)
  // trust is per-(session, app): same app in a different session is NOT trusted
  assert.equal(t.isTrusted("s2", "win.app.a"), false)
  // a different app in the same session is NOT trusted
  assert.equal(t.isTrusted("s1", "win.app.b"), false)
})

test("ComputerSessionTrust: grant is idempotent", () => {
  const t = new ComputerSessionTrust()
  t.grant("s1", "win.app.a")
  t.grant("s1", "win.app.a")
  assert.equal(t.size(), 1)
})

test("ComputerSessionTrust: clearSession drops only that session", () => {
  const t = new ComputerSessionTrust()
  t.grant("s1", "win.app.a")
  t.grant("s1", "win.app.b")
  t.grant("s2", "win.app.a")
  assert.equal(t.size(), 3)
  t.clearSession("s1")
  assert.equal(t.isTrusted("s1", "win.app.a"), false)
  assert.equal(t.isTrusted("s1", "win.app.b"), false)
  assert.equal(t.isTrusted("s2", "win.app.a"), true, "other session untouched")
  assert.equal(t.size(), 1)
})

test("ComputerSessionTrust: clearApp drops the token across all sessions", () => {
  const t = new ComputerSessionTrust()
  t.grant("s1", "win.app.a")
  t.grant("s2", "win.app.a")
  t.grant("s1", "win.app.b")
  const removed = t.clearApp("win.app.a")
  assert.equal(removed, 2)
  assert.equal(t.isTrusted("s1", "win.app.a"), false)
  assert.equal(t.isTrusted("s2", "win.app.a"), false)
  assert.equal(t.isTrusted("s1", "win.app.b"), true, "other app in same session kept")
})

test("ComputerSessionTrust: grant ignores empty session/app (defensive)", () => {
  const t = new ComputerSessionTrust()
  t.grant("", "win.app.a")
  t.grant("s1", "")
  assert.equal(t.size(), 0)
  assert.equal(t.isTrusted("", "win.app.a"), false)
  assert.equal(t.isTrusted("s1", ""), false)
})

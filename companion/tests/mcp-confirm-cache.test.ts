// McpConfirmCache unit tests (audit item 5a)
//
// Verifies the cross-session isolation contract documented in confirm-cache.ts:5-9.
// The cache exists specifically to prevent approval bleed across browser sessions —
// a regression here would silently share first-use approvals across sessions.

import test from "node:test"
import assert from "node:assert/strict"
import { McpConfirmCache } from "../src/mcp/confirm-cache.js"

function makeCache() {
  return new McpConfirmCache()
}

// =============================================================================

test("isApproved returns false by default for any (session, server, tool)", () => {
  const cache = makeCache()
  assert.equal(cache.isApproved({ sessionId: "s1", serverName: "fs", toolName: "read" }), false)
  assert.equal(cache.isApproved({ sessionId: "s1", serverName: "fs", toolName: "write" }), false)
  assert.equal(cache.isApproved({ sessionId: "s2", serverName: "fs", toolName: "read" }), false)
})

test("approve makes subsequent isApproved true within the same session", () => {
  const cache = makeCache()
  const key = { sessionId: "s1", serverName: "fs", toolName: "read" }
  assert.equal(cache.isApproved(key), false)
  cache.approve(key)
  assert.equal(cache.isApproved(key), true)
})

test("approve in one session does NOT bleed into a different session (cross-session isolation)", () => {
  // This is the core security property of the cache. A regression here means
  // user A's "approve once" auto-applies to user B's session — silent privilege
  // escalation if the cache keying breaks.
  const cache = makeCache()
  cache.approve({ sessionId: "s1", serverName: "fs", toolName: "read" })
  assert.equal(cache.isApproved({ sessionId: "s1", serverName: "fs", toolName: "read" }), true)
  assert.equal(cache.isApproved({ sessionId: "s2", serverName: "fs", toolName: "read" }), false,
    "approval in s1 must not apply to s2")
})

test("approve is per-tool: approving 'read' does not auto-approve 'write'", () => {
  const cache = makeCache()
  cache.approve({ sessionId: "s1", serverName: "fs", toolName: "read" })
  assert.equal(cache.isApproved({ sessionId: "s1", serverName: "fs", toolName: "read" }), true)
  assert.equal(cache.isApproved({ sessionId: "s1", serverName: "fs", toolName: "write" }), false)
})

test("approveServer bulk-trusts every tool from that server within the session", () => {
  const cache = makeCache()
  cache.approveServer("s1", "fs")
  assert.equal(cache.isApproved({ sessionId: "s1", serverName: "fs", toolName: "read" }), true)
  assert.equal(cache.isApproved({ sessionId: "s1", serverName: "fs", toolName: "write" }), true)
  assert.equal(cache.isApproved({ sessionId: "s1", serverName: "fs", toolName: "delete" }), true)
  // Other server still requires per-tool approval
  assert.equal(cache.isApproved({ sessionId: "s1", serverName: "other", toolName: "read" }), false)
})

test("approveServer does NOT bleed across sessions", () => {
  const cache = makeCache()
  cache.approveServer("s1", "fs")
  assert.equal(cache.isApproved({ sessionId: "s2", serverName: "fs", toolName: "read" }), false)
})

test("revoke drops the specific (session, server, tool) approval", () => {
  const cache = makeCache()
  const key = { sessionId: "s1", serverName: "fs", toolName: "read" }
  cache.approve(key)
  assert.equal(cache.isApproved(key), true)
  cache.revoke(key)
  assert.equal(cache.isApproved(key), false)
})

test("revoke also drops a bulk-trust server approval", () => {
  const cache = makeCache()
  cache.approveServer("s1", "fs")
  cache.revoke({ sessionId: "s1", serverName: "fs", toolName: "anything" })
  assert.equal(cache.isApproved({ sessionId: "s1", serverName: "fs", toolName: "read" }), false)
})

test("clearSession drops ALL approvals (per-tool AND bulk-trust) for that session", () => {
  const cache = makeCache()
  cache.approve({ sessionId: "s1", serverName: "fs", toolName: "read" })
  cache.approve({ sessionId: "s1", serverName: "fs", toolName: "write" })
  cache.approveServer("s1", "fs")
  cache.approve({ sessionId: "s2", serverName: "fs", toolName: "read" })

  cache.clearSession("s1")

  // s1 approvals gone
  assert.equal(cache.isApproved({ sessionId: "s1", serverName: "fs", toolName: "read" }), false)
  assert.equal(cache.isApproved({ sessionId: "s1", serverName: "fs", toolName: "write" }), false)
  // s2 untouched
  assert.equal(cache.isApproved({ sessionId: "s2", serverName: "fs", toolName: "read" }), true,
    "clearSession must not affect other sessions")
})

test("clearServer drops approvals for that server across ALL sessions", () => {
  // This is the trust_level-rollback path: when user changes a server back to
  // 'manual', every existing first-use approval across every active session
  // must drop.
  const cache = makeCache()
  cache.approve({ sessionId: "s1", serverName: "fs", toolName: "read" })
  cache.approve({ sessionId: "s2", serverName: "fs", toolName: "write" })
  cache.approve({ sessionId: "s1", serverName: "git", toolName: "commit" })
  cache.approveServer("s3", "fs")

  cache.clearServer("fs")

  // fs approvals gone across all sessions
  assert.equal(cache.isApproved({ sessionId: "s1", serverName: "fs", toolName: "read" }), false)
  assert.equal(cache.isApproved({ sessionId: "s2", serverName: "fs", toolName: "write" }), false)
  assert.equal(cache.isApproved({ sessionId: "s3", serverName: "fs", toolName: "anything" }), false)
  // Other server's approvals preserved
  assert.equal(cache.isApproved({ sessionId: "s1", serverName: "git", toolName: "commit" }), true)
})

test("clearServer only matches the exact server name (no prefix/false-positive)", () => {
  const cache = makeCache()
  cache.approve({ sessionId: "s1", serverName: "fs", toolName: "read" })
  cache.approve({ sessionId: "s1", serverName: "fs-backup", toolName: "read" })

  cache.clearServer("fs")

  // fs gone, fs-backup preserved (not a prefix match)
  assert.equal(cache.isApproved({ sessionId: "s1", serverName: "fs", toolName: "read" }), false)
  assert.equal(cache.isApproved({ sessionId: "s1", serverName: "fs-backup", toolName: "read" }), true)
})

test("pruneStaleSessions removes only inactive sessions", () => {
  const cache = makeCache()
  cache.approve({ sessionId: "active-1", serverName: "fs", toolName: "read" })
  cache.approve({ sessionId: "active-2", serverName: "fs", toolName: "read" })
  cache.approve({ sessionId: "stale-1", serverName: "fs", toolName: "read" })
  cache.approveServer("stale-2", "fs")
  cache.approveServer("active-1", "git")

  cache.pruneStaleSessions(new Set(["active-1", "active-2"]))

  // Active sessions preserved
  assert.equal(cache.isApproved({ sessionId: "active-1", serverName: "fs", toolName: "read" }), true)
  assert.equal(cache.isApproved({ sessionId: "active-2", serverName: "fs", toolName: "read" }), true)
  assert.equal(cache.isApproved({ sessionId: "active-1", serverName: "git", toolName: "anything" }), true)
  // Stale sessions dropped
  assert.equal(cache.isApproved({ sessionId: "stale-1", serverName: "fs", toolName: "read" }), false)
  assert.equal(cache.isApproved({ sessionId: "stale-2", serverName: "fs", toolName: "anything" }), false)
})

test("pruneStaleSessions with empty active set wipes everything", () => {
  const cache = makeCache()
  cache.approve({ sessionId: "s1", serverName: "fs", toolName: "read" })
  cache.approveServer("s2", "git")
  cache.pruneStaleSessions(new Set())
  assert.equal(cache.isApproved({ sessionId: "s1", serverName: "fs", toolName: "read" }), false)
  assert.equal(cache.isApproved({ sessionId: "s2", serverName: "git", toolName: "anything" }), false)
})

test("getMcpConfirmCache returns the same singleton across calls", () => {
  // The manager and router share the cache via the singleton. If this breaks,
  // approvals issued by the manager won't be visible to the router (or vice
  // versa) and every call would re-prompt.
  const { getMcpConfirmCache } = require("../src/mcp/confirm-cache.js")
  const a = getMcpConfirmCache()
  const b = getMcpConfirmCache()
  assert.equal(a, b, "getMcpConfirmCache must return the same instance")
})

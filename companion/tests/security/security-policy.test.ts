// Security Policy unit tests

import test from "node:test"
import assert from "node:assert/strict"

import { SecurityPolicy } from "../../src/security-policy"

test("issueToken binds code hash in payload", () => {
  const policy = new SecurityPolicy()
  const token = policy.issueToken("evaluate", "fetch('/api')")
  assert.ok(token.token.length > 0)
  assert.ok(token.expiresAt > Date.now())
  assert.ok(token.expiresAt <= Date.now() + 2 * 60 * 1000 + 1000)
})

test("validateToken succeeds for matching tool and code", () => {
  const policy = new SecurityPolicy()
  const { token } = policy.issueToken("evaluate", "fetch('/api')")
  const valid = policy.validateToken(token, "evaluate", "fetch('/api')")
  assert.equal(valid, true)
})

test("validateToken fails for mismatched tool name", () => {
  const policy = new SecurityPolicy()
  const { token } = policy.issueToken("evaluate", "fetch('/api')")
  const valid = policy.validateToken(token, "osascript_eval", "fetch('/api')")
  assert.equal(valid, false)
})

test("validateToken fails for mismatched code", () => {
  const policy = new SecurityPolicy()
  const { token } = policy.issueToken("evaluate", "fetch('/api')")
  const valid = policy.validateToken(token, "evaluate", "document.cookie")
  assert.equal(valid, false)
})

test("validateToken fails after single use", () => {
  const policy = new SecurityPolicy()
  const { token } = policy.issueToken("evaluate", "fetch('/api')")
  const first = policy.validateToken(token, "evaluate", "fetch('/api')")
  assert.equal(first, true)
  const second = policy.validateToken(token, "evaluate", "fetch('/api')")
  assert.equal(second, false)
})

test("validateToken fails for unknown token", () => {
  const policy = new SecurityPolicy()
  const valid = policy.validateToken("invalid-token-xyz", "evaluate", "fetch('/api')")
  assert.equal(valid, false)
})

test("validateToken is valid immediately after issue", () => {
  const policy = new SecurityPolicy()
  const { token } = policy.issueToken("evaluate", "fetch('/api')")
  assert.equal(policy.validateToken(token, "evaluate", "fetch('/api')"), true)
})

test("issueToken includes unique nonce per token", () => {
  const policy = new SecurityPolicy()
  const t1 = policy.issueToken("evaluate", "code-a")
  // Wait 2ms to ensure different timestamp
  const start = Date.now()
  while (Date.now() - start < 2) { /* busy wait */ }
  const t2 = policy.issueToken("evaluate", "code-a")
  assert.notEqual(t1.token, t2.token)
})

test("checkLength allows code within limit", () => {
  const policy = new SecurityPolicy()
  const result = policy.checkLength("evaluate", "a".repeat(1000))
  assert.equal(result.ok, true)
  assert.equal(result.error, undefined)
})

test("checkLength rejects code exceeding limit", () => {
  const policy = new SecurityPolicy()
  const result = policy.checkLength("evaluate", "a".repeat(50001))
  assert.equal(result.ok, false)
  assert.ok(result.error?.includes("exceeds maximum length"))
})

test("validateToken is case-sensitive for code comparison", () => {
  const policy = new SecurityPolicy()
  const { token } = policy.issueToken("evaluate", "Fetch('/api')")
  const valid = policy.validateToken(token, "evaluate", "fetch('/api')")
  assert.equal(valid, false)
})

test("multiple tokens can coexist independently", () => {
  const policy = new SecurityPolicy()
  const t1 = policy.issueToken("evaluate", "code-a")
  const t2 = policy.issueToken("evaluate", "code-b")
  const t3 = policy.issueToken("osascript_eval", "code-c")

  assert.equal(policy.validateToken(t1.token, "evaluate", "code-a"), true)
  assert.equal(policy.validateToken(t2.token, "evaluate", "code-b"), true)
  assert.equal(policy.validateToken(t3.token, "osascript_eval", "code-c"), true)
})

test("token signature prevents tampering", () => {
  const policy = new SecurityPolicy()
  const { token } = policy.issueToken("evaluate", "fetch('/api')")
  const tampered = token.slice(0, -5) + "XXXXX"
  const valid = policy.validateToken(tampered, "evaluate", "fetch('/api')")
  assert.equal(valid, false)
})

test("token expiration is within expected 2-minute range", () => {
  const policy = new SecurityPolicy()
  const before = Date.now()
  const { expiresAt } = policy.issueToken("evaluate", "fetch('/api')")
  const after = Date.now()
  assert.ok(expiresAt >= before + 2 * 60 * 1000 - 1000)
  assert.ok(expiresAt <= after + 2 * 60 * 1000 + 1000)
})

test("issueToken binds threadId", () => {
  const policy = new SecurityPolicy()
  const token = policy.issueToken("evaluate", "fetch('/api')", "thread-123")
  assert.ok(token.token.length > 0)
})

test("validateToken checks threadId binding", () => {
  const policy = new SecurityPolicy()
  const { token } = policy.issueToken("evaluate", "fetch('/api')", "thread-123")
  const valid = policy.validateToken(token, "evaluate", "fetch('/api')", "thread-123")
  assert.equal(valid, true)
  const invalid = policy.validateToken(token, "evaluate", "fetch('/api')", "thread-456")
  assert.equal(invalid, false)
})

// =============================================================================
// App tab WP3 — host_app binding payload (adversary 接线警示: the
// `default: return ""` footgun means a gated tool that forgot to extend the
// switch gets an EMPTY, replayable binding. These tests pin the non-empty,
// canonical payload for host_app.)
// =============================================================================

test("host_app binding payload is non-empty and canonical (app|action)", () => {
  const payload = SecurityPolicy.bindingPayloadFor("host_app", {
    app: "win.app.cloudmusic",
    action: "launch",
  })
  assert.notEqual(payload, "", "host_app binding payload must NOT fall through to the empty default")
  assert.equal(payload, "win.app.cloudmusic|launch")
  assert.ok(payload.includes("win.app.cloudmusic"), "payload must contain the app token")
  assert.ok(payload.includes("launch"), "payload must contain the action")
})

test("host_app issueTokenFor/validateTokenFor round-trip binds app+action", () => {
  const policy = new SecurityPolicy()
  const params = { app: "win.app.cloudmusic", action: "launch" }
  const { token } = policy.issueTokenFor("host_app", params, "thread-1")
  assert.equal(policy.validateTokenFor(token, "host_app", params, "thread-1"), true)
})

test("host_app token is NOT replayable across apps or actions", () => {
  const policy = new SecurityPolicy()
  const { token } = policy.issueTokenFor("host_app", { app: "win.app.a", action: "launch" })
  // Different app token → binding mismatch (token already consumed by first
  // validate in the round-trip test? No — fresh policy + fresh token here,
  // and validateToken consumes on SUCCESS only... mismatches never consume).
  assert.equal(policy.validateTokenFor(token, "host_app", { app: "win.app.b", action: "launch" }), false)
  assert.equal(policy.validateTokenFor(token, "host_app", { app: "win.app.a", action: "run_template" }), false)
  // Cross-tool replay must also fail.
  assert.equal(policy.validateTokenFor(token, "host_read", { app: "win.app.a", action: "launch" }), false)
  // The original binding still validates afterwards (failures didn't consume).
  assert.equal(policy.validateTokenFor(token, "host_app", { app: "win.app.a", action: "launch" }), true)
})

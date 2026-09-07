import test from "node:test"
import assert from "node:assert/strict"
import { contextPermissionFromRecord, OUTBOUND_CONTEXT_PROFILE, parseContextPermission, requireContextGrant, type LiveContextGrant } from "../src/outbound-mcp/context-permission"
import { ContextSessionRegistry } from "../src/outbound-mcp/context-session"

const grant = (id: string): LiveContextGrant => ({ id, caller_id: "same-caller", profile: OUTBOUND_CONTEXT_PROFILE, expires_at: null, revoked_at: null,
  allow_context_export: true, context_origins: ["https://portal.test"], context_knowledge_ids: ["doc-a"] })

test("new context permission normalizes exact origins; old page permission does not authorize knowledge", () => {
  assert.deepEqual(contextPermissionFromRecord({ allow_page_export: true }), { allow_context_export: false, context_origins: [], context_knowledge_ids: [] })
  assert.deepEqual(parseContextPermission({ allow_context_export: true, context_origins: ["https://PORTAL.test:443/"], context_knowledge_ids: ["doc-a"] }).context_origins, ["https://portal.test"])
  for (const url of ["https://*.test", "https://u:p@portal.test", "https://portal.test/path", "https://portal.test?q=x", "https://portal.test#x", "file:///tmp/x"]) assert.throws(() => parseContextPermission({ allow_context_export: true, context_origins: [url] }))
  assert.throws(() => parseContextPermission({ allow_context_export: true, context_origins: [] }))
  assert.throws(() => parseContextPermission({ context_origins: ["https://portal.test", "https://portal.test:443"] }))
  assert.equal(contextPermissionFromRecord({ allow_context_export: true, context_origins: "*" }).allow_context_export, false)
})

test("same-caller sibling grants cannot lend context permission; malformed expiry and revocation deny", () => {
  const a = grant("a"), b = { ...grant("b"), allow_context_export: false }
  const lookup = (id: string) => [a, b].find(item => item.id === id)
  assert.equal(requireContextGrant(lookup, "a", "same-caller").id, "a")
  assert.throws(() => requireContextGrant(lookup, "b", "same-caller"), /GRANT_DENIED/)
  assert.throws(() => requireContextGrant(lookup, "a", "wrong-caller"), /GRANT_DENIED/)
  a.expires_at = "bad"
  assert.throws(() => requireContextGrant(lookup, "a", "same-caller"), /GRANT_DENIED/)
  a.expires_at = null; a.revoked_at = new Date().toISOString()
  assert.throws(() => requireContextGrant(lookup, "a", "same-caller"), /GRANT_DENIED/)
})

test("Companion session handles bind one grant, survive only live permissions, and have bounded issuance", () => {
  let clock = 1000
  const a = grant("a"), b = grant("b")
  const registry = new ContextSessionRegistry(id => [a, b].find(item => item.id === id), () => clock)
  const first = registry.issue("a", "same-caller")
  assert.notEqual(first.handle, first.session_id)
  assert.deepEqual(registry.scope(first.handle, "a", "same-caller"), { kind: "mcp", grantId: "a", sessionId: first.session_id })
  assert.throws(() => registry.resolve(first.handle, "b", "same-caller"), /SCOPE_DENIED/)
  for (let i = 1; i < 16; i++) registry.issue("a", "same-caller")
  assert.throws(() => registry.issue("a", "same-caller"), /CAPACITY/)
  a.revoked_at = "now"
  assert.throws(() => registry.resolve(first.handle, "a", "same-caller"), /GRANT_DENIED/)
  a.revoked_at = null; clock += 31 * 60_000
  assert.throws(() => registry.resolve(first.handle, "a", "same-caller"), /SCOPE_DENIED/)
  assert.ok(registry.issue("a", "same-caller").handle)
})

test("#456 empty/default profiles remain exactly eight tools; context is a separate opt-in", async () => {
  const { outboundToolsForProfiles, OUTBOUND_MCP_ALLOWLIST } = await import("../src/outbound-mcp/profile")
  assert.deepEqual(outboundToolsForProfiles([]), [...OUTBOUND_MCP_ALLOWLIST])
  assert.deepEqual(outboundToolsForProfiles(["outbound_l1_default"]), [...OUTBOUND_MCP_ALLOWLIST])
  assert.deepEqual(outboundToolsForProfiles(["outbound_context_v1"]), [...OUTBOUND_MCP_ALLOWLIST, "cmspark__site_context"])
})

test("#456 experience is own session/origin only, expires and never imports chat memory", async () => {
  const { recordContextFailure, contextExperience, clearContextExperiences } = await import("../src/outbound-mcp/context-experience")
  clearContextExperiences()
  const scope = { kind: "mcp" as const, grantId: "a", sessionId: "s" }
  assert.equal(recordContextFailure({ kind: "chat", threadId: "chat" }, "https://portal.test", 1), false)
  assert.equal(recordContextFailure(scope, "https://portal.test/path", 1), false)
  assert.equal(recordContextFailure(scope, "https://portal.test", 1), true)
  assert.equal(contextExperience(scope, "https://portal.test", 2)[0].failures, 1)
  assert.equal(contextExperience(scope, "https://portal.test", 1_800_002)[0].stale, true)
  assert.deepEqual(contextExperience({ ...scope, sessionId: "other" }, "https://portal.test", 2), [])
  assert.deepEqual(contextExperience({ ...scope, grantId: "other" }, "https://portal.test", 2), [])
  assert.deepEqual(contextExperience(scope, "https://other.test", 2), [])
})

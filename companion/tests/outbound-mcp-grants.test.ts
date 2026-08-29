/**
 * Outbound MCP L4+ grant store + auth matrix tests.
 */
import "./_outbound-grants-setup.js"
import test from "node:test"
import assert from "node:assert/strict"
import type { IncomingMessage } from "http"
import {
  issueOutboundGrant,
  verifyOutboundGrantToken,
  revokeOutboundGrant,
  revokeAllOutboundGrants,
  listOutboundGrants,
  resetOutboundGrantsForTests,
  isOutboundGrantTokenShape,
  OUTBOUND_GRANT_TOKEN_PREFIX,
  DEFAULT_GRANT_TTL_MS,
  grantAllowsPageExport,
  grantAllowsPageExportById,
} from "../src/outbound-mcp/outbound-grants"
import {
  authorizeOutboundRequest,
  extractBearerToken,
} from "../src/outbound-mcp/companion-http"
import {
  hasOutboundDisclosure,
  clearAllOutboundDisclosureSessions,
} from "../src/outbound-mcp/disclosure-session"
import {
  resolveOutboundHttpBearer,
  GRANT_ENV,
} from "../src/outbound-mcp/stdio-server"

function fakeReq(auth?: string): IncomingMessage {
  return { headers: { authorization: auth } } as IncomingMessage
}

function sleepMs(ms: number): void {
  const sab = new SharedArrayBuffer(4)
  Atomics.wait(new Int32Array(sab), 0, 0, ms)
}

test.beforeEach(() => {
  resetOutboundGrantsForTests()
  delete process.env[GRANT_ENV]
})

test("issueOutboundGrant returns cmg_ token and lists without secrets", () => {
  const issued = issueOutboundGrant({ label: "t", caller_id: "agent-a" })
  assert.ok(issued.token.startsWith(OUTBOUND_GRANT_TOKEN_PREFIX))
  assert.ok(isOutboundGrantTokenShape(issued.token))
  assert.equal(issued.caller_id, "agent-a")
  assert.ok(issued.expires_at)
  const listed = listOutboundGrants()
  assert.equal(listed.length, 1)
  assert.equal(listed[0].caller_id, "agent-a")
  assert.equal((listed[0] as any).token, undefined)
})

test("verifyOutboundGrantToken happy path + caller bind", () => {
  const issued = issueOutboundGrant({ label: "t", caller_id: "bound-caller" })
  const ok = verifyOutboundGrantToken(issued.token, "bound-caller")
  assert.equal(ok.ok, true)
  if (ok.ok) {
    assert.equal(ok.caller_id, "bound-caller")
    assert.equal(ok.grant_id, issued.id)
  }
  const mismatch = verifyOutboundGrantToken(issued.token, "other")
  assert.equal(mismatch.ok, false)
  if (!mismatch.ok) {
    assert.equal(mismatch.error_code, "GRANT_CALLER_MISMATCH")
    assert.equal(mismatch.http_status, 403)
  }
})

test("verifyOutboundGrantToken rejects revoked", () => {
  const issued = issueOutboundGrant({ label: "t", caller_id: "c" })
  assert.equal(revokeOutboundGrant(issued.id), true)
  const v = verifyOutboundGrantToken(issued.token)
  assert.equal(v.ok, false)
  if (!v.ok) assert.equal(v.error_code, "GRANT_REVOKED")
})

test("verifyOutboundGrantToken rejects expired", () => {
  const issued = issueOutboundGrant({
    label: "t",
    caller_id: "c",
    ttl_ms: 1,
  })
  sleepMs(15)
  const v = verifyOutboundGrantToken(issued.token)
  assert.equal(v.ok, false)
  if (!v.ok) assert.equal(v.error_code, "GRANT_EXPIRED")
})

test("authorizeOutboundRequest: legacy ws_secret when require_grant false", () => {
  const r = authorizeOutboundRequest(fakeReq("Bearer secret-ws"), "secret-ws", {
    requireGrant: false,
  })
  assert.equal(r.ok, true)
  if (r.ok) assert.equal(r.mode, "ws_secret")
})

test("authorizeOutboundRequest: require_grant rejects ws_secret", () => {
  const r = authorizeOutboundRequest(fakeReq("Bearer secret-ws"), "secret-ws", {
    requireGrant: true,
  })
  assert.equal(r.ok, false)
  if (!r.ok) {
    assert.equal(r.error_code, "GRANT_REQUIRED")
    assert.equal(r.http_status, 401)
  }
})

test("authorizeOutboundRequest: grant accepted under require_grant", () => {
  const issued = issueOutboundGrant({ label: "g", caller_id: "ide-1" })
  const r = authorizeOutboundRequest(fakeReq(`Bearer ${issued.token}`), "ws-secret", {
    requireGrant: true,
    bodyCallerId: "ide-1",
  })
  assert.equal(r.ok, true)
  if (r.ok) {
    assert.equal(r.mode, "grant")
    assert.equal(r.bound_caller_id, "ide-1")
    assert.equal(r.grant_id, issued.id)
  }
})

test("authorizeOutboundRequest: grant caller mismatch", () => {
  const issued = issueOutboundGrant({ label: "g", caller_id: "ide-1" })
  const r = authorizeOutboundRequest(fakeReq(`Bearer ${issued.token}`), "ws", {
    requireGrant: true,
    bodyCallerId: "evil",
  })
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.error_code, "GRANT_CALLER_MISMATCH")
})

test("resolveOutboundHttpBearer: grant env preferred; else ws_secret", () => {
  const { getConfig, saveConfig } = require("../src/config") as typeof import("../src/config")
  // Default require_grant is true (MCPO-01); exercise legacy ws_secret path under false.
  saveConfig({ outbound_mcp: { require_grant: false } })
  try {
    process.env[GRANT_ENV] = OUTBOUND_GRANT_TOKEN_PREFIX + "a".repeat(64)
    const r = resolveOutboundHttpBearer()
    assert.equal(r.mode, "grant")
    delete process.env[GRANT_ENV]
    const r2 = resolveOutboundHttpBearer()
    assert.equal(r2.mode, "ws_secret")
  } finally {
    saveConfig({ outbound_mcp: { require_grant: true } })
    void getConfig
  }
})

test("revokeAllOutboundGrants", () => {
  issueOutboundGrant({ label: "a", caller_id: "a" })
  issueOutboundGrant({ label: "b", caller_id: "b" })
  assert.equal(revokeAllOutboundGrants(), 2)
  assert.equal(revokeAllOutboundGrants(), 0)
})

test("DEFAULT_GRANT_TTL_MS is 30d", () => {
  assert.equal(DEFAULT_GRANT_TTL_MS, 30 * 24 * 60 * 60 * 1000)
})

test("extractBearerToken still works", () => {
  assert.equal(extractBearerToken(fakeReq("Bearer xyz")), "xyz")
})

test("issueOutboundGrant default allow_page_export is false and listed without token", () => {
  const issued = issueOutboundGrant({ label: "t", caller_id: "agent-a" })
  assert.match(issued.token, /^cmg_/)
  const listed = listOutboundGrants()
  assert.equal(listed[0].allow_page_export, false)
  assert.equal((listed[0] as { token?: string }).token, undefined)
})

test("issueOutboundGrant allow_page_export persists on disk and does not set disclosure Map", () => {
  clearAllOutboundDisclosureSessions() // BEFORE issue — if issue wrongly arms the Map, this test must catch it
  issueOutboundGrant({ label: "t", caller_id: "exfil-caller", allow_page_export: true })
  const rec = listOutboundGrants().find((g) => g.caller_id === "exfil-caller")
  assert.equal(rec?.allow_page_export, true)
  assert.equal(hasOutboundDisclosure("exfil-caller"), false)
})

test("revoked grant cannot exfil even if allow_page_export was true", () => {
  const issued = issueOutboundGrant({
    label: "t",
    caller_id: "revoked-exfil",
    allow_page_export: true,
  })
  assert.equal(grantAllowsPageExport("revoked-exfil"), true)
  assert.equal(revokeOutboundGrant(issued.id), true)
  assert.equal(grantAllowsPageExport("revoked-exfil"), false)

  issueOutboundGrant({
    label: "t",
    caller_id: "expired-exfil",
    allow_page_export: true,
    ttl_ms: 1,
  })
  sleepMs(15)
  assert.equal(grantAllowsPageExport("expired-exfil"), false)
})

test("grantAllowsPageExportById is per-key (W2): sibling flagged grant does not leak", () => {
  const flagged = issueOutboundGrant({
    label: "flag",
    caller_id: "byid",
    allow_page_export: true,
  })
  const plain = issueOutboundGrant({ label: "plain", caller_id: "byid" })
  // caller-level still true (stdio track), per-key distinguishes
  assert.equal(grantAllowsPageExport("byid"), true)
  assert.equal(grantAllowsPageExportById(flagged.id), true)
  assert.equal(grantAllowsPageExportById(plain.id), false)
  assert.equal(grantAllowsPageExportById(""), false)
  assert.equal(grantAllowsPageExportById("g_no_such"), false)
})

test("grantAllowsPageExportById false after revoke / expiry", () => {
  const revoked = issueOutboundGrant({
    label: "t",
    caller_id: "byid-rev",
    allow_page_export: true,
  })
  assert.equal(grantAllowsPageExportById(revoked.id), true)
  assert.equal(revokeOutboundGrant(revoked.id), true)
  assert.equal(grantAllowsPageExportById(revoked.id), false)

  const expired = issueOutboundGrant({
    label: "t",
    caller_id: "byid-exp",
    allow_page_export: true,
    ttl_ms: 1,
  })
  sleepMs(15)
  assert.equal(grantAllowsPageExportById(expired.id), false)
})

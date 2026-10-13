import "./_outbound-grants-setup.js"
import test from "node:test"
import assert from "node:assert/strict"
import http from "node:http"
import { generateKeyPairSync } from "node:crypto"
import { join } from "node:path"
import { getConfigDir } from "../src/config"
import { EnterpriseBrowserService } from "../src/outbound-mcp/enterprise-service"
import { handleEnterpriseHttp } from "../src/outbound-mcp/enterprise-http"
import { registerEnterpriseInstance } from "../src/outbound-mcp/enterprise-policy"
import { issueOutboundGrant, revokeOutboundGrant } from "../src/outbound-mcp/outbound-grants"

test("actual loopback HTTP uses concrete grant-only versioned contract, no-store, strict fields and bounded bodies", async () => {
  const instance = registerEnterpriseInstance("http-test-profile", "user-a")
  const key = generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" }).toString()
  const grant = issueOutboundGrant({ caller_id: "itcra", label: "test", profile: "outbound_l1_interact", enterprise_policy: { ...instance, subject: "user-a", revision: "r1", expires_at: new Date(Date.now() + 60_000).toISOString(), authority_public_key: key,
    tools: ["create_tab"], navigation: [{ origin: "https://business.test", path: "/app" }], evidence: [], login: [], ready: [{ selector: "#ready" }], login_markers: [{ selector: "#login" }], actions: [] } })
  const api = new EnterpriseBrowserService({ monitor: false, path: join(getConfigDir(), "http-state.json"), peer: () => ({ peer: {}, epoch: "peer" }), runner: () => null })
  const server = http.createServer((req, res) => { void handleEnterpriseHttp(req, res, api) })
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve))
  const base = `http://127.0.0.1:${(server.address() as any).port}/outbound-mcp/v1/enterprise`
  const call = async (path: string, token = grant.token, body?: unknown) => {
    const response = await fetch(base + path, { headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" }, ...(body ? { method: "POST", body: JSON.stringify(body) } : {}) })
    return { status: response.status, cache: response.headers.get("cache-control"), result: await response.json() as any }
  }
  try {
    const valid = await call("/capabilities?subject=user-a")
    assert.equal(valid.status, 200); assert.equal(valid.cache, "no-store")
    assert.equal(valid.result.data.contract_version, 1)
    assert.equal(valid.result.data.login.popup, false)
    for (const token of ["pairing-secret", "", issueOutboundGrant({ caller_id: "itcra", label: "personal" }).token]) assert.notEqual((await call("/capabilities?subject=user-a", token)).status, 200)
    assert.equal((await call("/capabilities?subject=user-b")).result.error_code, "SUBJECT_MISMATCH")
    assert.equal((await call("/capabilities?subject=user-a&subject=user-b")).status, 400)
    assert.equal((await call("/sessions", grant.token, { subject: "user-a", request_key: "open", url: "https://business.test/app", approved: true })).status, 400)
    assert.equal((await call("/operations", grant.token, { subject: "user-a", overflow: "x".repeat(65_537) })).status, 413)
    revokeOutboundGrant(grant.id)
    assert.equal((await call("/capabilities?subject=user-a")).result.error_code, "GRANT_REVOKED")
  } finally { api.close(); await new Promise<void>(resolve => server.close(() => resolve())) }
})

import "./_outbound-grants-setup.js"
import test from "node:test"
import assert from "node:assert/strict"
import { generateKeyPairSync } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { getConfigDir } from "../src/config"
import { canonicalURL, inScope, parseEnterprisePolicy, registerEnterpriseInstance } from "../src/outbound-mcp/enterprise-policy"
import { issueOutboundGrant, verifyOutboundGrantToken, requireEnterpriseGrant, revokeOutboundGrant, resetOutboundGrantsForTests } from "../src/outbound-mcp/outbound-grants"
import { handleOutboundGrantCli } from "../src/outbound-mcp/grant-cli"

const instance = registerEnterpriseInstance("dedicated-test-profile", "user-a")
const key = generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" }).toString()
function policy() {
  return { ...instance, revision: "r1", expires_at: new Date(Date.now() + 60_000).toISOString(), authority_public_key: key,
    tools: ["navigate", "get_page_text", "click", "type"], navigation: [{ origin: "https://business.test", path: "/app" }], evidence: [{ origin: "https://business.test", path: "/app" }], login: [{ origin: "https://sso.test", path: "/" }],
    ready: [{ selector: "#authenticated" }], login_markers: [{ selector: "#qr-login" }], actions: [{ id: "next", tool: "click", effect: "read_only", selector: "#next", target: { tag: "button", attributes: { "data-action": "next" } } }] }
}
test.beforeEach(() => resetOutboundGrantsForTests())
test("exact grant/instance/subject bindings survive real persistence; siblings cannot borrow", () => {
  const issued = issueOutboundGrant({ caller_id: "itcra", label: "test", enterprise_policy: policy() })
  const sibling = issueOutboundGrant({ caller_id: "itcra", label: "personal" })
  assert.equal(verifyOutboundGrantToken(issued.token).ok, true)
  assert.equal(requireEnterpriseGrant(issued.id).policy.subject, "user-a")
  assert.throws(() => requireEnterpriseGrant(sibling.id))
  assert.equal(verifyOutboundGrantToken(issued.token, "other").ok, false)
  revokeOutboundGrant(issued.id)
  assert.throws(() => requireEnterpriseGrant(issued.id), /GRANT_UNAVAILABLE/)
})
test("malformed stored enterprise authority never downgrades to legacy", () => {
  const issued = issueOutboundGrant({ caller_id: "itcra", label: "test", enterprise_policy: policy() })
  const file = join(getConfigDir(), "outbound-grants.json")
  const stored = JSON.parse(readFileSync(file, "utf8"))
  stored.grants[0].enterprise_policy = null
  writeFileSync(file, JSON.stringify(stored))
  assert.equal(verifyOutboundGrantToken(issued.token).ok, false)
  assert.throws(() => requireEnterpriseGrant(issued.id))
})
test("URL aliases, path siblings, unbounded authority and unsupported tools fail closed", () => {
  for (const url of ["https://business.test/app/../admin", "https://business.test/app/%2e%2e/admin", "https://business.test\\@evil.test/app", "https://u:p@business.test/app"]) assert.throws(() => canonicalURL(url))
  assert.equal(inScope(canonicalURL("https://business.test/application"), policy().navigation), false)
  assert.equal(inScope(canonicalURL("https://business.test/app/query?q=test"), policy().navigation), true)
  assert.throws(() => parseEnterprisePolicy({ ...policy(), tools: ["evaluate"] }, "outbound_l1_interact"))
  assert.throws(() => issueOutboundGrant({ caller_id: "itcra", label: "x", ttl_ms: 0, enterprise_policy: policy() }))
  assert.throws(() => issueOutboundGrant({ caller_id: "itcra", label: "x", enterprise_policy: { ...policy(), instance_id: "wrong" } }))
  assert.throws(() => parseEnterprisePolicy({ ...policy(), expires_at: "invalid" }, "outbound_l1_default"))
  assert.throws(() => parseEnterprisePolicy({ ...policy(), actions: [{ ...policy().actions[0], tool: "type", target: { tag: "input", attributes: { type: "password" } } }] }, "outbound_l1_default"))
})
test("administrator CLI registers actual profile, issues enterprise token once without legacy HITL instructions", async () => {
  const file = join(getConfigDir(), "policy-test.json")
  writeFileSync(file, JSON.stringify(policy()))
  let stdout = "", stderr = ""
  const io = { stdout: { write: (text: string) => { stdout += text } }, stderr: { write: (text: string) => { stderr += text } } }
  assert.equal(await handleOutboundGrantCli(["issue", "--caller-id", "itcra", "--enterprise-config", file], io), 0, stderr)
  assert.equal((stdout.match(/cmg_[a-f0-9]+/g) || []).length, 1)
  assert.ok(stdout.includes("/outbound-mcp/v1/enterprise"))
  assert.ok(!stdout.includes("首次外泄"))
  assert.equal(await handleOutboundGrantCli(["register-instance", "--profile-id", "wrong-profile", "--subject", "user-a"], io), 1)
})

test("registered business identity is immutable; conflicting and unbound authorities fail closed", () => {
  assert.deepEqual(registerEnterpriseInstance(instance.profile_id, "user-a"), instance)
  assert.throws(() => registerEnterpriseInstance(instance.profile_id, "user-b"), /INSTANCE_ALREADY_REGISTERED/)
  assert.throws(() => issueOutboundGrant({ caller_id: "itcra", label: "wrong-subject", enterprise_policy: { ...policy(), subject: "user-b" } }), /ENTERPRISE_BINDING_INVALID/)
  const first = issueOutboundGrant({ caller_id: "itcra", label: "human-one", enterprise_policy: policy() })
  const second = issueOutboundGrant({ caller_id: "itcra", label: "human-two", enterprise_policy: policy() })
  assert.equal(requireEnterpriseGrant(first.id).policy.subject, requireEnterpriseGrant(second.id).policy.subject)
  const grantsFile = join(getConfigDir(), "outbound-grants.json"), grants = JSON.parse(readFileSync(grantsFile, "utf8"))
  grants.grants.find((g: any) => g.id === first.id).enterprise_policy.subject = "user-b"
  writeFileSync(grantsFile, JSON.stringify(grants))
  assert.equal(verifyOutboundGrantToken(first.token).ok, false)
  assert.throws(() => requireEnterpriseGrant(first.id), /ENTERPRISE_BINDING_INVALID/)
  const path = join(getConfigDir(), "enterprise-instance.json"), original = readFileSync(path, "utf8")
  try {
    const legacy = JSON.parse(original); delete legacy.subject; writeFileSync(path, JSON.stringify(legacy))
    assert.equal(verifyOutboundGrantToken(second.token).ok, false)
    assert.throws(() => registerEnterpriseInstance(instance.profile_id, "user-a"), /INSTANCE_UNREGISTERED/)
  } finally { writeFileSync(path, original) }
})

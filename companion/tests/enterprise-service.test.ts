import "./_outbound-grants-setup.js"
import test from "node:test"
import assert from "node:assert/strict"
import { generateKeyPairSync, sign } from "node:crypto"
import { spawnSync } from "node:child_process"
import { readFileSync, writeFileSync, statSync, existsSync, unlinkSync } from "node:fs"
import { join } from "node:path"
import { getConfigDir } from "../src/config"
import { EnterpriseBrowserService } from "../src/outbound-mcp/enterprise-service"
import { canonicalJSON, registerEnterpriseInstance } from "../src/outbound-mcp/enterprise-policy"
import { checkEnterprisePermit, claimEnterpriseDispatch } from "../src/outbound-mcp/enterprise-permit"
import { issueOutboundGrant, revokeOutboundGrant, resetOutboundGrantsForTests, verifyOutboundGrantToken, withRevokedEnterpriseGrants } from "../src/outbound-mcp/outbound-grants"
import { lockEnterpriseState, rotateEnterpriseState } from "../src/outbound-mcp/enterprise-state"
import { _resetTabLeasesForTests } from "../src/orchestrator/tab-lease"
import { companionInvokeOutbound } from "../src/outbound-mcp/companion-http"

const instance = registerEnterpriseInstance("enterprise-service-test-profile", "user-a")
const { publicKey, privateKey } = generateKeyPairSync("ed25519")
let serial = 0
function harness() {
  const path = join(getConfigDir(), `state-${serial++}.json`), tabId = 77 + serial
  const policy = { ...instance, subject: "user-a", revision: "r1", expires_at: new Date(Date.now() + 60_000).toISOString(), authority_public_key: publicKey.export({ type: "spki", format: "pem" }).toString(),
    tools: ["create_tab", "navigate", "get_page_text", "screenshot", "click", "type", "scroll"], navigation: [{ origin: "https://business.test", path: "/app" }], evidence: [{ origin: "https://business.test", path: "/app" }], login: [{ origin: "https://sso.test", path: "/" }], ready: [{ selector: "#ready" }], login_markers: [{ selector: "#login" }],
    actions: [{ id: "search", tool: "type", effect: "read_only", selector: "#search", target: { tag: "input", attributes: { type: "search", name: "query" } } }, { id: "next", tool: "click", effect: "read_only", selector: "#next", target: { tag: "button", attributes: { "data-action": "next" } } }, { id: "delete", tool: "click", effect: "write", selector: "#delete", target: { tag: "button", attributes: { "data-action": "delete" } } }] }
  const grant = issueOutboundGrant({ caller_id: "itcra", label: "test", profile: "outbound_l1_interact", enterprise_policy: policy })
  const peer = { peer: {}, epoch: "peer-epoch-1" }
  const browser = { state: "ready", url: "https://business.test/app", generation: 1, document_id: "doc-1", target_id: "node-1", effects: 0, navigations: 0, targetsAbsent: false, textFromURL: false, lastBusinessURL: "", opens: 0, inspectCalls: 0, fail: false, preEffectError: "", waitInspection: undefined as (() => Promise<void>) | undefined, onEffect: undefined as (() => void) | undefined }
  const deps = { path, monitor: false, peer: () => peer, runner: () => async (_id: string, tool: string, params: Record<string, unknown>, options: any) => {
    assert.equal(checkEnterprisePermit(options.enterprisePermit, tool, params, peer.peer), true)
    claimEnterpriseDispatch(options.enterprisePermit, tool, params, peer.peer)
    const guard = options.enterprisePermit.guard
    if (guard.mode === "probe") return { success: true, data: { enterprise_contract: 1, profile_id: instance.profile_id } }
    if (guard.mode === "open") { browser.opens++; return { success: true, data: { tab_id: tabId } } }
    if (guard.mode === "inspect") {
      browser.inspectCalls++; await browser.waitInspection?.()
      return { success: true, data: { tab_id: tabId, url: browser.state === "login_required" ? "https://sso.test/login?ticket=PRIVATE_LOGIN_TICKET" : browser.url, document_id: browser.document_id, generation: browser.generation, frames: [{ id: 0, document_id: browser.document_id, url: browser.url }], state: guard.rule && browser.targetsAbsent && browser.state === "ready" ? "target_mismatch" : browser.state, ...(browser.lastBusinessURL ? { last_business_url: browser.lastBusinessURL } : {}), ...(guard.rule ? { target: { element_token: browser.target_id, tag: guard.rule.target.tag, attributes: { type: null, name: null, role: null, "aria-label": null, "data-action": null, href: null, ...guard.rule.target.attributes } } } : {}) } }
    }
    if (browser.fail) return { success: false, error: "DISCONNECTED" }
    if (browser.preEffectError) { const error = browser.preEffectError; browser.preEffectError = ""; browser.state = "login_required"; return { success: false, error } }
    browser.effects++; browser.onEffect?.()
    if (tool === "navigate") { browser.navigations++; browser.url = String(params.url); browser.targetsAbsent = false }
    if (tool === "get_page_text") return { success: true, data: { text: browser.textFromURL ? browser.url : "VISIBLE_BUSINESS_TEXT", provenance: { coverage: "incomplete", workbook_complete: false } } }
    if (tool === "screenshot") return { success: true, data: { image_base64: "PRIVATE_LOGIN_IMAGE", width: 1, height: 1 } }
    return { success: true, data: { executed: true } }
  } }
  const api = new EnterpriseBrowserService(deps)
  const open = async () => (await api.open(grant.id, { subject: "user-a", change_id: "change-test-1", request_key: "open-1", url: "https://business.test/app" })) as any
  const prepare = async (session: string, tool = "click", rule_id = "next", request_key = "operation-1") => (await api.prepare(grant.id, { subject: "user-a", session_handle: session, request_key, tool, args: tool === "type" ? { rule_id, text: "safe query" } : tool === "click" ? { rule_id } : {} })) as any
  const proof = (challenge: unknown, decision?: string) => { const payload = { ...(challenge as object), ...(decision ? { decision } : {}) }; return { payload, signature: sign(null, Buffer.from(canonicalJSON(payload)), privateKey).toString("base64url") } }
  return { api, grant, browser, deps, peer, path, open, prepare, proof }
}
test.beforeEach(() => { resetOutboundGrantsForTests(); _resetTabLeasesForTests() })
test("state has one writer; repeated close cannot release a new owner's lock", () => {
  const h = harness()
  assert.throws(() => new EnterpriseBrowserService(h.deps), /STATE_BUSY/)
  assert.throws(() => rotateEnterpriseState(true, h.path), /STATE_BUSY/)
  h.api.close()
  const release = lockEnterpriseState(h.path)
  h.api.close()
  assert.equal(existsSync(h.path + ".lock"), true)
  release()
})
test("unexpected old owner release does not unlink a replacement lock after offline recovery", () => {
  const h = harness()
  unlinkSync(h.path + ".lock") // explicit administrator fault injection, never a supported live operation
  const release = lockEnterpriseState(h.path)
  h.api.close()
  assert.equal(existsSync(h.path + ".lock"), true)
  assert.throws(() => lockEnterpriseState(h.path), /STATE_BUSY/)
  release()
})
test("authority recovery also preserves a successor's grant writer lock", () => {
  const h = harness(), grantPath = join(getConfigDir(), "outbound-grants.json")
  revokeOutboundGrant(h.grant.id)
  let release!: () => void
  try {
    withRevokedEnterpriseGrants([h.grant.id], () => {
      unlinkSync(grantPath + ".lock") // administrator fault injection
      release = lockEnterpriseState(grantPath)
    })
    assert.equal(existsSync(grantPath + ".lock"), true)
    assert.throws(() => revokeOutboundGrant(h.grant.id), /GRANT_STORE_BUSY/)
  } finally { release?.(); h.api.close() }
})
test("session capacity preserves claims; revoked rotation archives and recovers with a fresh grant namespace", async () => {
  const h = harness()
  try {
    const first = await h.open()
    for (let i = 1; i < 128; i++) await h.api.open(h.grant.id, { subject: "user-a", change_id: "change-test-1", request_key: "open-" + (i + 1), url: "https://business.test/app" })
    const full = readFileSync(h.path, "utf8")
    await assert.rejects(h.api.open(h.grant.id, { subject: "user-a", change_id: "change-test-1", request_key: "overflow", url: "https://business.test/app" }), /CAPACITY/)
    assert.equal(readFileSync(h.path, "utf8"), full)
    assert.equal((await h.open()).session_handle, first.session_handle)
    h.api.close()
    assert.throws(() => rotateEnterpriseState(false, h.path), /QUIESCENCE_REQUIRED/)
    assert.throws(() => rotateEnterpriseState(true, h.path), /ROTATION_REQUIRES_REVOKED_GRANTS/)
    assert.equal(readFileSync(h.path, "utf8"), full)
    revokeOutboundGrant(h.grant.id)
    const rotated = rotateEnterpriseState(true, h.path)
    assert.equal(rotated.sessions, 128); assert.equal(readFileSync(rotated.archive, "utf8"), full)
    if (process.platform !== "win32") {
      assert.equal(statSync(rotated.archive).mode & 0o777, 0o600)
      assert.equal(statSync(join(getConfigDir(), "enterprise-browser-archives")).mode & 0o777, 0o700)
    }
    assert.equal(verifyOutboundGrantToken(h.grant.token).ok, false)
    const fresh = harness(); fresh.api.close()
    const next = new EnterpriseBrowserService({ ...fresh.deps, path: h.path })
    try {
      const opened = await next.open(fresh.grant.id, { subject: "user-a", change_id: "change-test-1", request_key: "open-1", url: "https://business.test/app" }) as any
      assert.notEqual(opened.session_handle, first.session_handle)
      await assert.rejects(next.status(fresh.grant.id, "user-a", first.session_handle), /SESSION_UNAVAILABLE/)
      await assert.rejects(next.status(h.grant.id, "user-a", first.session_handle), /GRANT_UNAVAILABLE/)
    } finally { next.close() }
  } finally { h.api.close() }
})
test("operation capacity keeps pending proof claims; rotation requires explicit revocation even after expiry", async () => {
  const h = harness(), session = await h.open()
  try {
    let first: any
    for (let i = 0; i < 1024; i++) { const op = await h.prepare(session.session_handle, "click", "delete", "operation-" + i); first ||= op }
    const full = readFileSync(h.path, "utf8")
    await assert.rejects(h.prepare(session.session_handle, "click", "delete", "overflow"), /CAPACITY/)
    assert.equal(readFileSync(h.path, "utf8"), full); assert.equal(h.browser.effects, 0)
    h.api.close()
    const grantPath = join(getConfigDir(), "outbound-grants.json"), grants = JSON.parse(readFileSync(grantPath, "utf8"))
    grants.grants[0].expires_at = new Date(0).toISOString(); writeFileSync(grantPath, JSON.stringify(grants))
    assert.throws(() => rotateEnterpriseState(true, h.path), /ROTATION_REQUIRES_REVOKED_GRANTS/)
    revokeOutboundGrant(h.grant.id)
    const rotated = rotateEnterpriseState(true, h.path)
    assert.equal(rotated.operations, 1024); assert.equal(readFileSync(rotated.archive, "utf8"), full)
    const fresh = harness(); fresh.api.close()
    const next = new EnterpriseBrowserService({ ...fresh.deps, path: h.path })
    try {
      assert.throws(() => next.execute(fresh.grant.id, { subject: "user-a", operation_handle: first.operation_handle, human_proof: h.proof(first.challenge, "approve") }), /OPERATION_UNAVAILABLE/)
      assert.equal(h.browser.effects, 0); assert.equal(fresh.browser.effects, 0)
    } finally { next.close() }
  } finally { h.api.close() }
})
test("closed writer cannot dispatch or overwrite reset state when a pending probe resolves late", async () => {
  const h = harness()
  let release!: () => void, entered!: () => void
  const held = new Promise<void>(r => { release = r }), started = new Promise<void>(r => { entered = r })
  const runner = h.deps.runner
  h.deps.runner = () => async (...args: Parameters<ReturnType<typeof runner>>) => {
    if ((args[3] as any).enterprisePermit.guard.mode === "probe") { entered(); await held }
    return runner()(...args)
  }
  const opening = h.open(); await started
  h.api.close(); revokeOutboundGrant(h.grant.id)
  const rotated = rotateEnterpriseState(true, h.path), empty = readFileSync(h.path, "utf8"), archived = readFileSync(rotated.archive, "utf8")
  release(); await assert.rejects(opening, /SERVICE_CLOSED/)
  assert.equal(h.browser.opens, 0)
  assert.equal(readFileSync(h.path, "utf8"), empty); assert.equal(readFileSync(rotated.archive, "utf8"), archived)
})
test("separate processes contend on the actual state writer lock", () => {
  const h = harness(), modulePath = require.resolve("../src/outbound-mcp/enterprise-state")
  const child = () => spawnSync(process.execPath, ["-e", "try { const release = require(process.argv[1]).lockEnterpriseState(process.argv[2]); release(); process.stdout.write('acquired') } catch(e) { process.stdout.write(e.message) }", modulePath, h.path], { encoding: "utf8", timeout: 5000 })
  try { const blocked = child(); assert.equal(blocked.status, 0); assert.equal(blocked.stdout, "STATE_BUSY") }
  finally { h.api.close() }
  const admitted = child(); assert.equal(admitted.status, 0); assert.equal(admitted.stdout, "acquired")
})
test("missing/corrupt authority and archive/reset failures preserve original claims", async t => {
  const fs = require("node:fs") as typeof import("node:fs")
  for (const fault of ["missing", "corrupt", "archive", "reset"] as const) {
    const h = harness(); await h.open(); h.api.close(); revokeOutboundGrant(h.grant.id)
    const original = readFileSync(h.path, "utf8"), grantPath = join(getConfigDir(), "outbound-grants.json"), grantBytes = readFileSync(grantPath, "utf8")
    try {
      if (fault === "missing") writeFileSync(grantPath, JSON.stringify({ grants: [] }))
      else if (fault === "corrupt") writeFileSync(grantPath, "{")
      else if (fault === "archive") {
        const open = fs.openSync
        t.mock.method(fs, "openSync", (path: any, ...args: any[]) => { if (String(path).includes("enterprise-browser-archives")) throw new Error("archive fault"); return (open as any)(path, ...args) })
      } else {
        const rename = fs.renameSync
        t.mock.method(fs, "renameSync", (from: any, to: any) => { if (to === h.path) throw new Error("reset fault"); return rename(from, to) })
      }
      assert.throws(() => rotateEnterpriseState(true, h.path))
      assert.equal(readFileSync(h.path, "utf8"), original)
      assert.equal(existsSync(h.path + ".lock"), false)
    } finally { t.mock.restoreAll(); writeFileSync(grantPath, grantBytes) }
  }
})
test("already-dispatched effect remains an archived ambiguous claim, never replayed after rotation", async () => {
  const h = harness(), session = await h.open(), op = await h.prepare(session.session_handle)
  let release!: () => void, entered!: () => void
  const held = new Promise<void>(r => { release = r }), started = new Promise<void>(r => { entered = r }), runner = h.deps.runner
  h.deps.runner = () => async (...args: Parameters<ReturnType<typeof runner>>) => {
    const result = await runner()(...args)
    if ((args[3] as any).enterprisePermit.guard.mode === "act") { entered(); await held }
    return result
  }
  h.api.execute(h.grant.id, { subject: "user-a", operation_handle: op.operation_handle }); await started
  assert.equal(h.browser.effects, 1)
  h.api.close(); revokeOutboundGrant(h.grant.id)
  const rotated = rotateEnterpriseState(true, h.path), fresh = readFileSync(h.path, "utf8"), archive = readFileSync(rotated.archive, "utf8")
  assert.equal(JSON.parse(archive).operations[0].state, "executing")
  release(); await h.api.drain()
  assert.equal(h.browser.effects, 1); assert.equal(readFileSync(h.path, "utf8"), fresh); assert.equal(readFileSync(rotated.archive, "utf8"), archive)
})
test("normal actions use concrete authority, durable idempotency and return real producer envelopes", async () => {
  const h = harness(), session = await h.open()
  assert.equal(h.browser.opens, 1)
  assert.equal((await h.open()).session_handle, session.session_handle)
  const op = await h.prepare(session.session_handle)
  assert.equal(op.state, "prepared"); assert.equal(h.browser.effects, 0)
  h.api.execute(h.grant.id, { subject: "user-a", operation_handle: op.operation_handle })
  await h.api.drain()
  assert.equal((h.api.operationStatus(h.grant.id, "user-a", op.operation_handle) as any).state, "completed")
  h.api.execute(h.grant.id, { subject: "user-a", operation_handle: op.operation_handle }); await h.api.drain()
  assert.equal(h.browser.effects, 1)
  assert.equal((await h.prepare(session.session_handle)).operation_handle, op.operation_handle)
  await assert.rejects(h.prepare(session.session_handle, "click", "delete"), /IDEMPOTENCY_CONFLICT/)
  assert.equal((await companionInvokeOutbound({ caller_id: "itcra", tool: "list_tabs", args: {} }, { grant_id: h.grant.id })).error_code, "ENTERPRISE_SESSION_REQUIRED")
  h.api.close()
})
test("navigation is independent of export/readiness; login return restores original business target once without returning another document", async () => {
  const h = harness(), session = await h.open()
  h.browser.state = "unsupported"
  const nav = await h.api.prepare(h.grant.id, { subject: "user-a", session_handle: session.session_handle, request_key: "safe-nav", tool: "navigate", args: { url: "https://business.test/app/target" } }) as any
  h.api.execute(h.grant.id, { subject: "user-a", operation_handle: nav.operation_handle }); await h.api.drain()
  assert.equal((h.api.operationStatus(h.grant.id, "user-a", nav.operation_handle) as any).state, "completed")
  h.browser.state = "login_required"
  const op = await h.prepare(session.session_handle, "get_page_text", "next", "restore-target")
  h.api.execute(h.grant.id, { subject: "user-a", operation_handle: op.operation_handle }); await h.api.drain()
  h.browser.state = "ready"; h.browser.url = "https://business.test/app/home"
  await h.api.tick()
  assert.equal(h.browser.url, "https://business.test/app/target")
  assert.equal((h.api.operationStatus(h.grant.id, "user-a", op.operation_handle) as any).state, "waiting_login")
  await h.api.tick()
  assert.equal((h.api.operationStatus(h.grant.id, "user-a", op.operation_handle) as any).state, "completed")
  h.api.close()
})
test("write actions need signed human authority; Agent boolean, tamper and immediate replay fail before effects", async () => {
  const h = harness(), session = await h.open(), op = await h.prepare(session.session_handle, "click", "delete")
  assert.equal(op.state, "waiting_human"); assert.equal(h.browser.effects, 0)
  assert.throws(() => h.api.execute(h.grant.id, { subject: "user-a", operation_handle: op.operation_handle, approved: true }), /INVALID_INPUT/)
  assert.throws(() => h.api.execute(h.grant.id, { subject: "user-a", operation_handle: op.operation_handle, human_proof: h.proof({ ...op.challenge, subject: "user-b" }, "approve") }), /HUMAN_PROOF_INVALID/)
  const human_proof = h.proof(op.challenge, "approve")
  h.api.execute(h.grant.id, { subject: "user-a", operation_handle: op.operation_handle, human_proof })
  assert.throws(() => h.api.execute(h.grant.id, { subject: "user-a", operation_handle: op.operation_handle, human_proof }), /APPROVAL_ALREADY_CONSUMED/)
  await h.api.drain(); assert.equal(h.browser.effects, 1)
  h.api.close()
})
test("human review identifies actual site and target without exporting private URL query or node token", async () => {
  const h = harness(), session = await h.open()
  h.browser.url = "https://business.test/app/object?ticket=PRIVATE_TARGET_QUERY"
  const op = await h.prepare(session.session_handle, "click", "delete")
  assert.deepEqual(op.review.site, { origin: "https://business.test", path: "/app/object" })
  assert.equal(op.review.target.tag, "button"); assert.equal(op.review.target.attributes["data-action"], "delete")
  assert.equal("element_token" in op.review.target, false)
  assert.equal(JSON.stringify(op.review).includes("PRIVATE_TARGET_QUERY"), false)
  assert.equal(JSON.stringify(op.review).includes(h.browser.target_id), false)
  h.api.close()
})
test("frame URLs are private snapshot input and are absent from public status and durable metadata", async () => {
  const h = harness()
  try {
    h.browser.url = "https://business.test/app?ticket=PRIVATE_FRAME_QUERY"
    const session = await h.open(), status = await h.api.status(h.grant.id, "user-a", session.session_handle)
    const op = await h.prepare(session.session_handle)
    assert.ok(!JSON.stringify({ status, op }).includes("PRIVATE_FRAME_QUERY"))
    assert.ok(!JSON.stringify(status).includes("frames"))
    const durable = readFileSync(h.path, "utf8")
    assert.ok(!durable.includes("PRIVATE_FRAME_QUERY")); assert.ok(!durable.includes("https://"))
  } finally { h.api.close() }
})
test("failed login capture consumes its proof before capture and permits only a fresh challenge retry", async () => {
  const h = harness(); h.browser.state = "login_required"
  try {
    const session = await h.open(), status = await h.api.status(h.grant.id, "user-a", session.session_handle) as any
    const oldProof = h.proof(status.presentation_challenge), body = { subject: "user-a", session_handle: session.session_handle, presentation_proof: oldProof }
    h.browser.fail = true
    await assert.rejects(h.api.loginSnapshot(h.grant.id, body), /DISCONNECTED/)
    h.browser.fail = false
    await assert.rejects(h.api.loginSnapshot(h.grant.id, body), /HUMAN_PROOF_INVALID/)
    assert.equal(h.browser.effects, 0)
    const fresh = await h.api.status(h.grant.id, "user-a", session.session_handle) as any
    assert.notEqual(fresh.presentation_challenge.nonce, status.presentation_challenge.nonce)
    const image = await h.api.loginSnapshot(h.grant.id, { ...body, presentation_proof: h.proof(fresh.presentation_challenge) }) as any
    assert.equal(image.audience, "human_only"); assert.equal(h.browser.effects, 1)
  } finally { h.api.close() }
})
test("a proof consumed on late readiness cannot capture a later relogin image", async () => {
  const h = harness(); h.browser.state = "login_required"
  try {
    const session = await h.open(), status = await h.api.status(h.grant.id, "user-a", session.session_handle) as any
    const body = { subject: "user-a", session_handle: session.session_handle, presentation_proof: h.proof(status.presentation_challenge) }
    h.browser.state = "ready"
    await assert.rejects(h.api.loginSnapshot(h.grant.id, body), /LOGIN_VIEW_UNAVAILABLE/)
    h.browser.state = "login_required"
    await assert.rejects(h.api.loginSnapshot(h.grant.id, body), /HUMAN_PROOF_INVALID/)
    assert.equal(h.browser.effects, 0)
    const fresh = await h.api.status(h.grant.id, "user-a", session.session_handle) as any
    assert.equal((await h.api.loginSnapshot(h.grant.id, { ...body, presentation_proof: h.proof(fresh.presentation_challenge) }) as any).audience, "human_only")
    assert.equal(h.browser.effects, 1)
  } finally { h.api.close() }
})
test("signed old target is rejected when identical replacement node has a different private identity", async () => {
  const h = harness(), session = await h.open(), op = await h.prepare(session.session_handle, "click", "delete")
  h.browser.target_id = "replacement-node"
  h.api.execute(h.grant.id, { subject: "user-a", operation_handle: op.operation_handle, human_proof: h.proof(op.challenge, "approve") }); await h.api.drain()
  assert.equal(h.browser.effects, 0)
  assert.equal((h.api.operationStatus(h.grant.id, "user-a", op.operation_handle) as any).error_code, "APPROVAL_TARGET_CHANGED")
  h.api.close()
})
test("fixed pre-effect login race resumes normal operation without an effect replay; slow monitor work is coalesced", async () => {
  const h = harness(), session = await h.open(), op = await h.prepare(session.session_handle)
  h.browser.preEffectError = "READINESS_CHANGED"
  h.api.execute(h.grant.id, { subject: "user-a", operation_handle: op.operation_handle }); await h.api.drain()
  assert.equal(h.browser.effects, 0)
  assert.equal((h.api.operationStatus(h.grant.id, "user-a", op.operation_handle) as any).state, "waiting_login")
  let release!: () => void, entered!: () => void
  const hold = new Promise<void>(resolve => { release = resolve }), started = new Promise<void>(resolve => { entered = resolve })
  h.browser.waitInspection = async () => { entered(); await hold }
  const before = h.browser.inspectCalls, first = h.api.tick()
  await started
  await Promise.all(Array.from({ length: 20 }, () => h.api.tick()))
  for (let i = 0; i < 20; i++) h.api.execute(h.grant.id, { subject: "user-a", operation_handle: op.operation_handle })
  release(); await first; await h.api.drain()
  assert.equal(h.browser.inspectCalls, before + 1)
  h.browser.waitInspection = undefined; h.browser.state = "ready"; h.browser.document_id = "new-authenticated-doc"
  await h.api.tick()
  assert.equal((h.api.operationStatus(h.grant.id, "user-a", op.operation_handle) as any).state, "completed")
  assert.equal(h.browser.effects, 1)
  assert.equal((h.api.operationStatus(h.grant.id, "user-a", op.operation_handle) as any).error_code, undefined)
  h.api.close()
})
test("deny, cancel, navigation ABA, wrong subject, sibling, peer replacement and revoke cannot authorize", async () => {
  const h = harness(), session = await h.open(), op = await h.prepare(session.session_handle, "click", "delete")
  h.api.execute(h.grant.id, { subject: "user-a", operation_handle: op.operation_handle, human_proof: h.proof(op.challenge, "deny") })
  assert.equal(h.browser.effects, 0)
  const cancelled = await h.prepare(session.session_handle, "click", "next", "cancel")
  h.api.cancel(h.grant.id, "user-a", cancelled.operation_handle)
  h.api.execute(h.grant.id, { subject: "user-a", operation_handle: cancelled.operation_handle }); await h.api.drain()
  assert.equal(h.browser.effects, 0)
  const changed = await h.prepare(session.session_handle, "click", "delete", "aba")
  h.browser.generation++ // same URL and target; approval must still fail
  h.api.execute(h.grant.id, { subject: "user-a", operation_handle: changed.operation_handle, human_proof: h.proof(changed.challenge, "approve") }); await h.api.drain()
  assert.equal(h.browser.effects, 0)
  assert.equal((h.api.operationStatus(h.grant.id, "user-a", changed.operation_handle) as any).error_code, "APPROVAL_TARGET_CHANGED")
  assert.throws(() => h.api.operationStatus(h.grant.id, "user-b", op.operation_handle), /SUBJECT_MISMATCH/)
  const sibling = issueOutboundGrant({ caller_id: "itcra", label: "sibling" })
  assert.throws(() => h.api.operationStatus(sibling.id, "user-a", op.operation_handle))
  h.peer.epoch = "different-peer"
  await assert.rejects(h.prepare(session.session_handle, "click", "next", "peer"), /ENTERPRISE_PEER_CHANGED/)
  revokeOutboundGrant(h.grant.id)
  assert.throws(() => h.api.operationStatus(h.grant.id, "user-a", op.operation_handle), /GRANT_UNAVAILABLE/)
  h.api.close()
})
test("login image is separately signed and consumed, never durable; normal pending operation auto resumes exactly once", async () => {
  const h = harness(); h.browser.state = "login_required"
  const session = await h.open(), status = await h.api.status(h.grant.id, "user-a", session.session_handle) as any
  await assert.rejects(h.api.loginSnapshot(h.grant.id, { subject: "user-a", session_handle: session.session_handle, presentation_proof: { payload: status.presentation_challenge, signature: "fake" } }), /HUMAN_PROOF_INVALID/)
  const presentation_proof = h.proof(status.presentation_challenge)
  const image = await h.api.loginSnapshot(h.grant.id, { subject: "user-a", session_handle: session.session_handle, presentation_proof }) as any
  assert.equal(image.audience, "human_only")
  await assert.rejects(h.api.loginSnapshot(h.grant.id, { subject: "user-a", session_handle: session.session_handle, presentation_proof }), /HUMAN_PROOF_INVALID/)
  const op = await h.prepare(session.session_handle, "get_page_text")
  h.api.execute(h.grant.id, { subject: "user-a", operation_handle: op.operation_handle }); await h.api.drain()
  assert.equal((h.api.operationStatus(h.grant.id, "user-a", op.operation_handle) as any).state, "waiting_login")
  h.browser.state = "ready"; h.browser.document_id = "authenticated-doc"; h.browser.generation++
  await h.api.tick()
  const completed = h.api.operationStatus(h.grant.id, "user-a", op.operation_handle) as any
  assert.equal(completed.state, "completed"); assert.equal(completed.data.text, "VISIBLE_BUSINESS_TEXT")
  const effects = h.browser.effects; await h.api.tick(); assert.equal(h.browser.effects, effects)
  const durable = readFileSync(h.path, "utf8")
  for (const secret of ["PRIVATE_LOGIN_TICKET", "PRIVATE_LOGIN_IMAGE", "VISIBLE_BUSINESS_TEXT", "https://", "#delete"]) assert.ok(!durable.includes(secret), secret)
  h.api.close()
})
test("ambiguous dispatch is terminal; restart kills pending approvals and retains metadata without output or replay", async () => {
  const h = harness(), session = await h.open(), unknown = await h.prepare(session.session_handle)
  h.browser.fail = true
  h.api.execute(h.grant.id, { subject: "user-a", operation_handle: unknown.operation_handle }); await h.api.drain()
  assert.equal((h.api.operationStatus(h.grant.id, "user-a", unknown.operation_handle) as any).state, "outcome_unknown")
  h.browser.fail = false
  h.api.execute(h.grant.id, { subject: "user-a", operation_handle: unknown.operation_handle }); await h.api.drain(); assert.equal(h.browser.effects, 0)
  const pending = await h.prepare(session.session_handle, "click", "delete", "pending-restart")
  h.api.close()
  const restarted = new EnterpriseBrowserService(h.deps)
  assert.equal((restarted.operationStatus(h.grant.id, "user-a", pending.operation_handle) as any).state, "terminated")
  assert.throws(() => restarted.execute(h.grant.id, { subject: "user-a", operation_handle: pending.operation_handle, human_proof: h.proof(pending.challenge, "approve") }), /SESSION_TERMINATED/)
  await restarted.tick(); assert.equal(h.browser.effects, 0); restarted.close()
  writeFileSync(h.path, "{CORRUPT")
  const corrupt = new EnterpriseBrowserService(h.deps)
  assert.throws(() => corrupt.capabilities(h.grant.id, "user-a"), /STATE_CORRUPT/); corrupt.close()
})

test("completed click A→B freezes B for later read across SSO and clears late readiness errors", async () => {
  for (const late of [false, true]) {
    const h = harness(), session = await h.open()
    h.browser.onEffect = () => { h.browser.url = "https://business.test/app/B"; h.browser.generation++; h.browser.document_id = "document-B" }
    const click = await h.prepare(session.session_handle)
    h.api.execute(h.grant.id, { subject: "user-a", operation_handle: click.operation_handle }); await h.api.drain()
    assert.equal(h.browser.effects, 1)
    h.browser.onEffect = undefined; h.browser.textFromURL = true
    const read = await h.prepare(session.session_handle, "get_page_text", "next", "read-B")
    if (late) h.browser.preEffectError = "READINESS_CHANGED"
    else h.browser.state = "login_required"
    h.api.execute(h.grant.id, { subject: "user-a", operation_handle: read.operation_handle }); await h.api.drain()
    assert.equal(h.browser.effects, 1)
    h.browser.state = "ready"; h.browser.url = "https://business.test/app/home"; h.browser.document_id = "callback"; h.browser.generation++
    await h.api.tick(); assert.equal(h.browser.url, "https://business.test/app/B")
    await h.api.tick()
    const result = h.api.operationStatus(h.grant.id, "user-a", read.operation_handle) as any
    assert.equal(result.state, "completed"); assert.equal(result.data.text, "https://business.test/app/B"); assert.equal(result.error_code, undefined)
    assert.equal(h.browser.navigations, 1); assert.equal(h.browser.effects, 3)
    assert.ok(!readFileSync(h.path, "utf8").includes("https://"))
    await h.api.tick(); assert.equal(h.browser.effects, 3); h.api.close()
  }
})
test("private pre-SSO navigation B restores target-bearing tasks before inspecting callback targets", async () => {
  for (const [tool, rule] of [["click", "next"], ["type", "search"], ["click", "delete"]]) {
    const h = harness(), session = await h.open()
    // Actual Bridge history is tested separately; here the trusted producer has
    // observed A→B→SSO before an operation can inspect a ready B document.
    h.browser.lastBusinessURL = "https://business.test/app/B"; h.browser.state = "login_required"
    const op = await h.prepare(session.session_handle, tool, rule)
    h.api.execute(h.grant.id, { subject: "user-a", operation_handle: op.operation_handle }); await h.api.drain()
    assert.equal(h.browser.effects, 0)
    h.browser.state = "ready"; h.browser.url = "https://business.test/app/home"; h.browser.targetsAbsent = true
    await h.api.tick()
    assert.equal(h.browser.navigations, 1); assert.equal(h.browser.url, "https://business.test/app/B")
    assert.equal(h.browser.effects, 1) // restoration only, no business action
    await h.api.tick()
    const result = h.api.operationStatus(h.grant.id, "user-a", op.operation_handle) as any
    if (rule === "delete") {
      assert.equal(result.state, "waiting_human"); assert.equal(h.browser.effects, 1)
      h.api.execute(h.grant.id, { subject: "user-a", operation_handle: op.operation_handle, human_proof: h.proof(result.challenge, "approve") }); await h.api.drain()
    } else assert.equal(result.state, "completed")
    assert.equal((h.api.operationStatus(h.grant.id, "user-a", op.operation_handle) as any).state, "completed")
    assert.equal(h.browser.effects, 2); await h.api.tick(); assert.equal(h.browser.effects, 2)
    assert.ok(!readFileSync(h.path, "utf8").includes("https://")); h.api.close()
  }
})

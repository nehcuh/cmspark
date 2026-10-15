import test, { before, beforeEach, afterEach, mock } from "node:test"
import assert from "node:assert/strict"
import cp = require("node:child_process")
import net from "node:net"
import { initDataDir, saveConfig } from "../src/config"
import { bindCompanionDispatchRuntime, executeCompanionTool } from "../src/tool/companion-dispatch"
import { getAcpManager, _resetAcpManagerForTests } from "../src/acp/manager"
import { classifyError } from "../src/security"
import { securityPolicy } from "../src/security-policy"

let effects = { process: 0, network: 0, issue: 0 }
before(async () => { assert.ok(process.env.CMSPARK_DATA_DIR); await initDataDir() })
beforeEach(() => {
  _resetAcpManagerForTests()
  saveConfig({ acp: { enabled: true, servers: { owned: { enabled: true, command: process.execPath, args: [], protocol: "cli", policy: { profile: "review_readonly" } } } } } as any)
  bindCompanionDispatchRuntime({ getThreadManager: () => ({}), getSkillEngine: () => null, getComputerEstopEnsureOverride: () => null } as any)
  effects = { process: 0, network: 0, issue: 0 }
  for (const n of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"] as const) mock.method(cp, n, (() => { effects.process++; throw Error("OWNED_PROCESS_FORBIDDEN") }) as any)
  mock.method(net.Socket.prototype, "connect", (() => { effects.network++; throw Error("OWNED_NETWORK_FORBIDDEN") }) as any)
  for (const n of ["issueToken", "issueTokenFor"] as const) mock.method(securityPolicy, n, (() => { effects.issue++; throw Error("OWNED_ISSUER_FORBIDDEN") }) as any)
})
afterEach(() => { assert.deepEqual(effects, { process: 0, network: 0, issue: 0 }); mock.restoreAll(); _resetAcpManagerForTests() })
function offer(threadId: string) {
  const r = getAcpManager().propose({ threadId, agentId: "owned", goal: "inert offered row", workspaceRoot: process.env.CMSPARK_DATA_DIR! })
  assert.ok(r.ok); return r.session
}
async function call(name: string, params: any) { return JSON.parse(JSON.stringify(await executeCompanionTool(name, params))) }
function feedback(r: any, code = "ACP_SESSION_ID_REQUIRED") {
  assert.equal(r.success, false); assert.equal(r.error_code, code)
  assert.equal(classifyError(r.error, { toolName: "acp_cancel_session", error_code: r.error_code }), "recoverable")
  assert.equal(r.data.data_not_instruction, true)
}
for (const value of [undefined, ""]) test(`#563 cancel ${value === undefined ? "absent" : "empty"} ID uses existing typed parameter feedback`, async () => {
  const r = await call("acp_cancel_session", { session_id: value, __thread_id: "owned-thread" }); feedback(r)
  for (const name of ["acp_get_status", "acp_collect_result"]) assert.deepEqual(r, await call(name, { session_id: value, __thread_id: "owned-thread" }))
})
test("#563 missing cancel ID lists only current-thread offered sessions without cancelling anything", async () => {
  const own = offer("owned-thread"), other = offer("foreign-thread")
  const before = JSON.stringify(getAcpManager().listSessionsForThread("owned-thread"))
  const r = await call("acp_cancel_session", { __thread_id: "owned-thread" }); feedback(r)
  assert.deepEqual(r.data.current_sessions.map((x: any) => x.session_id), [own.session_id]); assert.equal(JSON.stringify(r).includes(other.session_id), false)
  assert.equal(JSON.stringify(getAcpManager().listSessionsForThread("owned-thread")), before)
  const absent = await call("acp_cancel_session", {}); feedback(absent); assert.deepEqual(absent.data.current_sessions, [])
})
test("#563 actual cancel preserves foreign owner refusal and current offered-session cancellation", async () => {
  const own = offer("owned-thread"), other = offer("foreign-thread")
  const denied = await call("acp_cancel_session", { session_id: other.session_id, __thread_id: "owned-thread" })
  assert.equal(denied.error_code, "ACP_OWNER_MISMATCH"); assert.equal(classifyError(denied.error, { error_code: denied.error_code }), "security"); assert.equal(getAcpManager().getSession(other.session_id)?.state, "offered")
  assert.deepEqual(await call("acp_cancel_session", { session_id: own.session_id, __thread_id: "owned-thread" }), { success: true, data: { session_id: own.session_id, cancelled: true } })
  assert.equal(getAcpManager().getSession(own.session_id)?.state, "closed")
})
test("#563 unknown cancel ID retains existing typed restart feedback", async () => {
  feedback(await call("acp_cancel_session", { session_id: "owned-unknown", __thread_id: "owned-thread" }), "ACP_SESSION_NOT_FOUND")
})
test("#563 missing and invalid start/apply token gates still refuse before missing-ID handling", async () => {
  for (const name of ["acp_start_session", "acp_apply_diff"]) for (const security_token of [undefined, "owned-not-a-valid-token"]) {
    const r = await call(name, { session_id: "", __thread_id: "owned-thread", security_token })
    assert.equal(r.success, false); assert.match(r.error, /L2 security_token|Invalid or expired security token/)
    assert.notEqual(r.error_code, "ACP_SESSION_ID_REQUIRED"); assert.equal(classifyError(r.error), "non_recoverable")
  }
})

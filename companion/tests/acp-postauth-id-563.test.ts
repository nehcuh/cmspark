import test, { before, beforeEach, afterEach, mock } from "node:test"
import assert from "node:assert/strict"
import cp = require("node:child_process")
import net from "node:net"
import { initDataDir, saveConfig } from "../src/config"
import { bindCompanionDispatchRuntime, executeCompanionTool } from "../src/tool/companion-dispatch"
import { getAcpManager, _resetAcpManagerForTests } from "../src/acp/manager"
import { securityPolicy } from "../src/security-policy"
import { classifyError } from "../src/security"

// These are real, isolated, in-memory policy tokens, not human approval receipts.
let effects = { process: 0, network: 0, start: 0, apply: 0, issued: 0 }
let expected = { start: 0, apply: 0, issued: 0 }
before(async () => { assert.ok(process.env.CMSPARK_DATA_DIR); await initDataDir() })
beforeEach(() => {
  _resetAcpManagerForTests()
  saveConfig({ acp: { enabled: true, servers: { owned: { enabled: true, command: process.execPath, args: [], protocol: "cli", policy: { profile: "review_readonly" } } } } } as any)
  bindCompanionDispatchRuntime({ getThreadManager: () => ({}), getSkillEngine: () => null, getComputerEstopEnsureOverride: () => null } as any)
  effects = { process: 0, network: 0, start: 0, apply: 0, issued: 0 }
  expected = { start: 0, apply: 0, issued: 0 }
  for (const name of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"] as const) mock.method(cp, name, (() => { effects.process++; throw Error("OWNED_PROCESS_FORBIDDEN") }) as any)
  mock.method(net.Socket.prototype, "connect", (() => { effects.network++; throw Error("OWNED_NETWORK_FORBIDDEN") }) as any)
  mock.method(getAcpManager(), "start", (async () => { effects.start++; throw Error("OWNED_START_FORBIDDEN") }) as any)
  mock.method(getAcpManager(), "applyPendingDiffs", (() => { effects.apply++; throw Error("OWNED_APPLY_FORBIDDEN") }) as any)
  const issue = securityPolicy.issueTokenFor
  mock.method(securityPolicy, "issueTokenFor", function (...args: Parameters<typeof issue>) { effects.issued++; return issue.apply(securityPolicy, args) })
})
afterEach(() => {
  assert.deepEqual(effects, { process: 0, network: 0, ...expected })
  mock.restoreAll(); _resetAcpManagerForTests()
})
function offer(threadId: string) {
  const row = getAcpManager().propose({ threadId, agentId: "owned", goal: "inert offered row", workspaceRoot: process.env.CMSPARK_DATA_DIR! })
  assert.ok(row.ok); return row.session
}
function signed(tool: string, params: Record<string, any>) {
  expected.issued++
  return { ...params, security_token: securityPolicy.issueTokenFor(tool, params).token }
}
async function call(tool: string, params: Record<string, any>) { return JSON.parse(JSON.stringify(await executeCompanionTool(tool, params))) }
function feedback(tool: string, result: any) {
  assert.equal(result.success, false); assert.equal(result.error_code, "ACP_SESSION_ID_REQUIRED")
  assert.equal(classifyError(result.error, { toolName: tool, error_code: result.error_code }), "recoverable")
  assert.equal(result.data.data_not_instruction, true)
}
for (const tool of ["acp_start_session", "acp_apply_diff"]) {
  for (const id of [undefined, ""]) test(`${tool} signed ${id === undefined ? "absent" : "empty"} ID returns scoped feedback without an operation`, async () => {
    const own = offer("owned-thread"), foreign = offer("foreign-thread")
    const before = JSON.stringify(getAcpManager().listSessionsForThread("owned-thread"))
    const params = { __thread_id: "owned-thread", ...(id === undefined ? {} : { session_id: id }) }
    const result = await call(tool, signed(tool, params)); feedback(tool, result)
    assert.deepEqual(result.data.current_sessions.map((row: any) => row.session_id), [own.session_id])
    assert.equal(JSON.stringify(result).includes(foreign.session_id), false)
    assert.equal(JSON.stringify(getAcpManager().listSessionsForThread("owned-thread")), before)
  })
  test(`${tool} absent and invalid tokens still refuse before feedback`, async () => {
    offer("owned-thread")
    for (const security_token of [undefined, "OWNED_INVALID_NOT_TOKEN"]) {
      const result = await call(tool, { session_id: "", __thread_id: "owned-thread", security_token })
      assert.equal(result.success, false); assert.match(result.error, /L2 security_token|Invalid or expired security token/)
      assert.equal(result.data, undefined); assert.notEqual(result.error_code, "ACP_SESSION_ID_REQUIRED")
      assert.equal(classifyError(result.error, { toolName: tool, error_code: result.error_code }), "non_recoverable")
    }
  })
  test(`${tool} valid token does not bypass a foreign session owner`, async () => {
    const foreign = offer("foreign-thread")
    const result = await call(tool, signed(tool, { session_id: foreign.session_id, __thread_id: "owned-thread" }))
    assert.equal(result.error_code, "ACP_OWNER_MISMATCH")
    assert.equal(classifyError(result.error, { error_code: result.error_code }), "security")
    assert.equal(getAcpManager().getSession(foreign.session_id)?.state, "offered")
  })
  test(`${tool} signed missing ID without a server owner reveals no rows`, async () => {
    offer("foreign-thread")
    const result = await call(tool, signed(tool, { session_id: "" })); feedback(tool, result)
    assert.deepEqual(result.data.current_sessions, [])
  })
  test(`${tool} successful validation consumes the token even for missing-ID feedback`, async () => {
    const params = signed(tool, { session_id: "", __thread_id: "owned-thread" })
    feedback(tool, await call(tool, params))
    const replay = await call(tool, params)
    assert.match(replay.error, /Invalid or expired security token/); assert.equal(replay.data, undefined)
  })
}
test("signed current-owner nonempty IDs still reach the original start and apply outlets", async () => {
  const own = offer("owned-thread"), manager = getAcpManager()
  expected.start = 1; expected.apply = 1
  mock.method(manager, "start", (async () => { effects.start++; return { ok: true, session: own } }) as any)
  mock.method(manager, "applyPendingDiffs", (() => { effects.apply++; return { ok: true, applied: 0, skipped: [] } }) as any)
  for (const tool of ["acp_start_session", "acp_apply_diff"]) {
    const result = await call(tool, signed(tool, { session_id: own.session_id, __thread_id: "owned-thread" }))
    assert.equal(result.success, true)
  }
})

function realApplyLookup() {
  const manager = getAcpManager()
  const actual = Object.getPrototypeOf(manager).applyPendingDiffs
  mock.method(manager, "applyPendingDiffs", function (...args: any[]) {
    effects.apply++
    return actual.apply(manager, args)
  })
}
for (const owner of ["owned-thread", undefined]) test(`signed unknown apply ID offers only ${owner ? "current-owner" : "empty"} recovery rows`, async () => {
  const own = offer("owned-thread"), foreign = offer("foreign-thread")
  const before = JSON.stringify(getAcpManager().listSessionsForThread("owned-thread"))
  realApplyLookup(); expected.apply = 1
  const result = await call("acp_apply_diff", signed("acp_apply_diff", { session_id: "owned-missing-id", ...(owner ? { __thread_id: owner } : {}) }))
  assert.equal(result.success, false); assert.equal(result.error_code, "ACP_SESSION_NOT_FOUND")
  assert.equal(classifyError(result.error, { toolName: "acp_apply_diff", error_code: result.error_code }), "recoverable")
  assert.deepEqual(result.data.current_sessions.map((row: any) => row.session_id), owner ? [own.session_id] : [])
  assert.equal(JSON.stringify(result).includes(foreign.session_id), false)
  assert.equal(JSON.stringify(getAcpManager().listSessionsForThread("owned-thread")), before)
})
test("unknown apply lookup still consumes its genuine single-use policy token", async () => {
  realApplyLookup(); expected.apply = 1
  const params = signed("acp_apply_diff", { session_id: "owned-missing-id", __thread_id: "owned-thread" })
  assert.equal((await call("acp_apply_diff", params)).error_code, "ACP_SESSION_NOT_FOUND")
  const replay = await call("acp_apply_diff", params)
  assert.match(replay.error, /Invalid or expired security token/); assert.equal(replay.data, undefined)
})
test("real non-propose_diff apply refusal retains its original hard error and result data", async () => {
  const own = offer("owned-thread")
  realApplyLookup(); expected.apply = 1
  const result = await call("acp_apply_diff", signed("acp_apply_diff", { session_id: own.session_id, __thread_id: "owned-thread" }))
  assert.equal(result.success, false); assert.equal(result.error, "session is not propose_diff mode")
  assert.equal(result.error_code, undefined)
  assert.equal(classifyError(result.error, { toolName: "acp_apply_diff", error_code: result.error_code }), "non_recoverable")
  assert.deepEqual(result.data, { ok: false, applied: [], skipped: [], error: "session is not propose_diff mode" })
})

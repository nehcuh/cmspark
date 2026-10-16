/** #563: actual generic schema -> full dispatcher -> JSON -> real adapter statements.
 * Runtime is owned/inert. No effective caller grant, actual worker mutation,
 * native process, provider or human approval is claimed. */
import test, { before, beforeEach, afterEach, after, mock } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import cp from "node:child_process"
import net from "node:net"
import ts from "typescript"
const owned = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-worker-input-563-"))
process.env.CMSPARK_DATA_DIR = path.join(owned, "data")
process.env.CMSPARK_SKIP_LOGIN_ENV = "1"
let dispatch: typeof import("../src/tool/companion-dispatch")
let parseToolArgs: typeof import("../src/bridge/tool-schemas").parseToolArgs
let security: typeof import("../src/security")
let securityPolicy: typeof import("../src/security-policy").securityPolicy
let effects = { threadRead: 0, threadMutate: 0, process: 0, network: 0, issuer: 0 }
let threads: Record<string, any> = {}, trapRead = false, readIds: string[] = []
const receipts: any[] = []
const adapter = path.resolve(__dirname, "../../src/llm/adapter.ts")
const ast = ts.createSourceFile(adapter, fs.readFileSync(adapter, "utf8"), ts.ScriptTarget.Latest, true)
const statements: string[] = []
function visit(n: ts.Node): void {
  if (ts.isVariableStatement(n) && ["classCode", "errorLevel"].includes(n.declarationList.declarations[0]?.name.getText(ast))) statements.push(n.getText(ast))
  ts.forEachChild(n, visit)
}
visit(ast); assert.equal(statements.length, 2)
const consume = new Function("toolResult", "classifyError", "toolName", ts.transpile(statements.join("\n") + ";return {classCode,errorLevel};", { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }))
before(async () => {
  const config = await import("../src/config"); await config.initDataDir()
  dispatch = await import("../src/tool/companion-dispatch")
  parseToolArgs = (await import("../src/bridge/tool-schemas")).parseToolArgs
  security = await import("../src/security")
  securityPolicy = (await import("../src/security-policy")).securityPolicy
})
beforeEach(() => {
  effects = { threadRead: 0, threadMutate: 0, process: 0, network: 0, issuer: 0 }; threads = {}; trapRead = false; readIds = []
  const trap = (kind: keyof typeof effects) => () => { effects[kind]++; throw Error("OWNED_EFFECT_FORBIDDEN_" + kind) }
  const manager = new Proxy({ get(id: string) { effects.threadRead++; readIds.push(id); if (trapRead) throw Error("OWNED_ORIGINAL_OPERATION_REACHED"); return threads[id] } }, {
    get(target, key: string) { return key === "get" ? target.get : trap("threadMutate") },
  })
  dispatch.bindCompanionDispatchRuntime({ getThreadManager: () => manager, getSkillEngine: () => ({}), getComputerEstopEnsureOverride: () => null,
    computerTaskAbort: new Map(), securityConfirmations: {}, getCachedTabUrl: () => undefined, getTabUrlCache: () => new Map(), computerRateLimiter: trap("process"),
    getComputerRateLimiterSingleton: () => null, rejectPendingForThread: trap("threadMutate"), hasPendingForTab: trap("threadRead"), rejectPendingForTab: trap("threadMutate") } as any)
  for (const key of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"] as const) mock.method(cp, key, trap("process") as any)
  mock.method(net.Socket.prototype, "connect", trap("network") as any); mock.method(globalThis, "fetch", trap("network") as any)
  for (const key of ["issueToken", "issueTokenFor"] as const) mock.method(securityPolicy, key, trap("issuer") as any)
})
afterEach(() => {
  assert.deepEqual({ ...effects, threadRead: 0 }, { threadRead: 0, threadMutate: 0, process: 0, network: 0, issuer: 0 })
  mock.restoreAll()
})
after(() => { console.log("WORKER_INPUT_ACTUAL_RECEIPTS " + JSON.stringify(receipts)); fs.rmSync(owned, { recursive: true, force: true }) })
async function call(tool: string, args: Record<string, any>) {
  const parsed = parseToolArgs(tool, args)
  const wire = JSON.parse(JSON.stringify(await dispatch.executeCompanionTool(tool, parsed)))
  const actualAdapter = consume(wire, security.classifyError, tool)
  receipts.push({ tool, args, schemaAccepted: true, wire, actualAdapter, effects: { ...effects } })
  return { wire, actualAdapter }
}
function invalid(tool: string, wire: any, actualAdapter: any, message: string) {
  assert.equal(wire.success, false); assert.equal(wire.error, message)
  assert.deepEqual(wire.data, { error_code: "WORKER_INPUT_INVALID" })
  assert.equal(actualAdapter.classCode, "WORKER_INPUT_INVALID"); assert.equal(actualAdapter.errorLevel, "recoverable")
  for (const error of ["", "owned input missing", "Security Block: owned", "blocked by user", "permission denied", "timeout", "element not found"])
    assert.equal(consume({ ...wire, error }, security.classifyError, tool).errorLevel, "recoverable")
  assert.deepEqual(effects, { threadRead: 0, threadMutate: 0, process: 0, network: 0, issuer: 0 })
}
const values = [["missing", undefined], ["null", null], ["empty", ""], ["zero", 0], ["false", false]] as const
for (const tool of ["get_worker_status", "collect_handback", "worker_cancel"])
  for (const [label, value] of values) test(`#563 ${tool} ${label} worker retains original missing predicate with recoverable code`, async () => {
    const { wire, actualAdapter } = await call(tool, value === undefined ? {} : { worker_id: value })
    invalid(tool, wire, actualAdapter, "worker_id required")
  })
for (const shape of ["intent", "worker", "both"])
  for (const [label, value] of values) test(`#563 board_claim_intent ${shape} ${label} after inert parent marker has finite input feedback`, async () => {
    const args: Record<string, any> = { __thread_id: "OWNED_INERT_NOT_AUTHORIZED_HOST", intent_id: "owned-intent", worker_id: "owned-worker" }
    if (shape !== "worker") { if (value === undefined) delete args.intent_id; else args.intent_id = value }
    if (shape !== "intent") { if (value === undefined) delete args.worker_id; else args.worker_id = value }
    const { wire, actualAdapter } = await call("board_claim_intent", args)
    invalid("board_claim_intent", wire, actualAdapter, "intent_id and worker_id required")
  })
for (const [label, value] of values) test(`#563 absent ${label} board host stays before parameter feedback`, async () => {
  const { wire, actualAdapter } = await call("board_claim_intent", value === undefined ? {} : { __thread_id: value })
  assert.deepEqual(wire, { success: false, error: "board_claim_intent requires host thread" })
  assert.equal(actualAdapter.classCode, undefined); assert.equal(actualAdapter.errorLevel, "non_recoverable")
  assert.deepEqual(effects, { threadRead: 0, threadMutate: 0, process: 0, network: 0, issuer: 0 })
})
for (const tool of ["get_worker_status", "collect_handback", "worker_cancel", "board_claim_intent"])
  for (const [label, value] of [["id", "owned"], ["whitespace", " "], ["number", 42], ["object", {}]] as const)
    test(`#563 ${tool} original truthy ${label} reaches existing operation, not new feedback`, async () => {
      trapRead = true
      const args = tool === "board_claim_intent" ? { __thread_id: "OWNED_INERT_HOST", intent_id: value, worker_id: value } : { worker_id: value }
      await assert.rejects(() => call(tool, args), /OWNED_ORIGINAL_OPERATION_REACHED/)
      assert.equal(effects.threadRead, 1)
      assert.equal(readIds[0], tool === "board_claim_intent" ? "OWNED_INERT_HOST" : String(value))
      receipts.push({ tool, positiveOriginalOperationTrap: true, label, readIds, effects: { ...effects }, mutation: 0 })
    })
for (const args of [{ thread_id: "alias" }, { worker_id: 0, thread_id: "alias" }, { worker_id: null, thread_id: "alias" }, { worker_id: "first", thread_id: "ignored" }])
  test(`#563 get_worker_status keeps original worker/thread alias precedence ${JSON.stringify(args)}`, async () => {
    trapRead = true; await assert.rejects(() => call("get_worker_status", args), /OWNED_ORIGINAL_OPERATION_REACHED/)
    assert.deepEqual(readIds, [args.worker_id || args.thread_id]); assert.equal(effects.threadRead, 1)
  })
for (const tool of ["get_worker_status", "worker_cancel"])
  test(`#563 ${tool} unknown nonempty worker keeps original lookup result`, async () => {
    const { wire, actualAdapter } = await call(tool, { worker_id: "owned-unknown" })
    assert.deepEqual(wire, { success: false, error: "worker not found: owned-unknown" })
    assert.equal(actualAdapter.classCode, undefined); assert.equal(actualAdapter.errorLevel, "recoverable")
    assert.equal(effects.threadRead, 1)
  })
for (const caller of [undefined, "foreign"])
  test(`#563 worker_cancel ${caller ?? "missing"} owner remains hard before mutation`, async () => {
    threads.worker = { id: "worker", parent_thread_id: "parent", orchestrator_run_id: "owned-run", agent_role: "worker" }
    threads.foreign = { id: "foreign", orchestrator_run_id: "other-run", agent_role: "user" }
    const { wire, actualAdapter } = await call("worker_cancel", { worker_id: "worker", ...(caller ? { __thread_id: caller } : {}) })
    assert.equal(wire.success, false); assert.equal(wire.data.error_code, "WORKER_NOT_OWNED")
    assert.equal(actualAdapter.errorLevel, "non_recoverable"); assert.equal(effects.threadRead, caller ? 2 : 1)
  })
test("#563 collect_handback foreign owner still refuses without collecting/mutating", async () => {
  threads.worker = { id: "worker", parent_thread_id: "parent", agent_role: "worker" }
  threads.foreign = { id: "foreign", agent_role: "user" }
  const { wire, actualAdapter } = await call("collect_handback", { worker_id: "worker", __thread_id: "foreign" })
  assert.equal(wire.data.error_code, "WORKER_NOT_OWNED"); assert.equal(actualAdapter.errorLevel, "non_recoverable")
  assert.ok(effects.threadRead > 0 && effects.threadRead < 10)
})
test("#563 only worker input code is recoverable; old hard codes/default59 and unknown fallback stay", () => {
  assert.equal(security.ERROR_CODE_LEVELS.size, 164); assert.equal(security.DEFAULT_NON_RECOVERABLE_CODES.length, 59)
  assert.equal(security.ERROR_CODE_LEVELS.get("WORKER_INPUT_INVALID"), "recoverable")
  for (const code of ["INVALID_ARGS", "THREAD_REQUIRED", "WORKER_NOT_OWNED"])
    for (const error of ["", "timeout disconnected", "permission denied"])
      assert.equal(security.classifyError(error, { error_code: code }), "non_recoverable")
  for (const error_code of [undefined, "OWNED_UNKNOWN_CODE", "WORKER_INPUT_INVALID "])
    for (const [error, level] of [["timeout", "recoverable"], ["owned error", "non_recoverable"]])
      assert.equal(security.classifyError(error, { error_code }), level)
})

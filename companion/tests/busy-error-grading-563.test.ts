/** #563 temporary lock refusals: actual helper/JSON/AST consumers, no native or valid authority. */
import test, { before, after, beforeEach, afterEach, mock } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import cp = require("node:child_process")
import net from "node:net"
import ts from "typescript"
import { initDataDir } from "../src/config"
import { tryAcquireFlight, releaseFlight, flightSnapshot, _resetFlightsForTests } from "../src/orchestrator/single-flight"
import { classifyError, ERROR_CODE_LEVELS, DEFAULT_NON_RECOVERABLE_CODES } from "../src/security"
import { decideSameToolFailure, LOCATOR_PIVOT_INSTRUCTION } from "../src/llm/same-tool-guard"
import { securityPolicy } from "../src/security-policy"
import { ThreadManager } from "../src/threads/thread-manager"
const receipts: unknown[] = []
let effects = { process: 0, network: 0, issuer: 0 }
before(async () => { assert.ok(process.env.CMSPARK_DATA_DIR); await initDataDir() })
beforeEach(() => {
 effects = { process: 0, network: 0, issuer: 0 }; _resetFlightsForTests()
 for (const k of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"] as const) mock.method(cp, k, (() => { effects.process++; throw Error("OWNED_PROCESS_FORBIDDEN") }) as any)
 mock.method(net.Socket.prototype, "connect", (() => { effects.network++; throw Error("OWNED_NETWORK_FORBIDDEN") }) as any)
 mock.method(globalThis, "fetch", (() => { effects.network++; throw Error("OWNED_FETCH_FORBIDDEN") }) as any)
 for (const k of ["issueToken", "issueTokenFor"] as const) mock.method(securityPolicy, k, (() => { effects.issuer++; throw Error("OWNED_ISSUER_FORBIDDEN") }) as any)
})
afterEach(() => { assert.deepEqual(effects, { process: 0, network: 0, issuer: 0 }); _resetFlightsForTests(); mock.restoreAll() })
after(() => { if (process.env.CMSPARK_BUSY_563_RECEIPT) fs.writeFileSync(process.env.CMSPARK_BUSY_563_RECEIPT, JSON.stringify(receipts, null, 2) + "\n") })
function ast(file: string) { return ts.createSourceFile(file, fs.readFileSync(path.join(process.cwd(), "src", file), "utf8"), ts.ScriptTarget.Latest, true) }
function one(tree: ts.Node, pred: (n: ts.Node) => boolean) { const found: ts.Node[] = []; function walk(n: ts.Node) { if (pred(n)) found.push(n); ts.forEachChild(n, walk) }; walk(tree); assert.equal(found.length, 1); return found[0] }
function compile(body: string, ...args: string[]) { return new Function(...args, ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText) }
const adapter = ast("llm/adapter.ts")
const code = one(adapter, n => ts.isVariableDeclaration(n) && n.name.getText(adapter) === "classCode")
const level = one(adapter, n => ts.isVariableDeclaration(n) && n.name.getText(adapter) === "errorLevel" && !!n.initializer?.getText(adapter).includes("classifyError(toolResult.error"))
const halt = one(adapter, n => ts.isIfStatement(n) && n.expression.getText(adapter) === 'errorLevel === "security" || errorLevel === "non_recoverable"') as ts.IfStatement
const consume = compile(`const ${code.getText(adapter)};const ${level.getText(adapter)};return{classCode,errorLevel,stop:${halt.expression.getText(adapter)}}`, "toolResult", "toolName", "classifyError")
const dispatch = ast("tool/companion-dispatch.ts"), admission = ast("tool/l2-admission.ts")
const dispatchFrames = new Map([
 ["shell_exec", compile(one(dispatch, n => ts.isReturnStatement(n) && n.getText(dispatch).includes('error_code: "SHELL_BUSY"') && n.getText(dispatch).includes("flight.error")).getText(dispatch), "flight")],
 ["netsec_port_scan", compile(one(dispatch, n => ts.isReturnStatement(n) && n.getText(dispatch).includes('error_code: "NETSEC_BUSY"') && n.getText(dispatch).includes("flight.error")).getText(dispatch), "flight")],
])
const preL2 = one(admission, n => ts.isVariableDeclaration(n) && n.name.getText(admission) === "result" && !!n.initializer?.getText(admission).includes('toolName === "shell_exec" ? "SHELL_BUSY" : "NETSEC_BUSY"')) as ts.VariableDeclaration
const admissionFrame = compile(`return ${preL2.initializer!.getText(admission)}`, "flight", "toolName")
for (const tool of ["shell_exec", "netsec_port_scan"] as const) for (const outlet of ["dispatch", "pre-L2"] as const) for (const holder of ["OWNED_INERT_THREAD_UUID", "timeout", "element_not_found", "Security Block: permission denied"]) {
 test(`#563 ${tool} ${outlet} actual busy refuses and feeds back (${holder})`, t => {
  const expected = tool === "shell_exec" ? "SHELL_BUSY" : "NETSEC_BUSY"
  assert.deepEqual(tryAcquireFlight(tool, holder), { ok: true })
  try {
   const flight = tryAcquireFlight(tool, "OWNED_LOSING_UUID"); assert.equal(flight.ok, false); if (flight.ok) return
   const wire = JSON.parse(JSON.stringify(outlet === "dispatch" ? dispatchFrames.get(tool)!(flight) : admissionFrame(flight, tool)))
   const consumer = consume(wire, tool, classifyError); receipts.push({ tool, outlet, holder, flight, wire, consumer })
   t.diagnostic(JSON.stringify({ tool, outlet, holder, consumer }))
   assert.equal(wire.success, false); assert.equal(wire.error, flight.error); assert.match(wire.error, /Wait and retry\./)
   assert.deepEqual(wire.data, { error_code: expected, holder }); assert.deepEqual(consumer, { classCode: expected, errorLevel: "recoverable", stop: false })
   releaseFlight(tool, "OWNED_LOSING_UUID"); assert.equal(flightSnapshot()[tool], holder)
   assert.deepEqual(tryAcquireFlight(tool, holder), { ok: true, reentrant: true })
   assert.deepEqual(decideSameToolFailure({ failCount: 1, threshold: 3, errorCode: expected, errorText: wire.error, alreadyPivoted: false }), { action: "count" })
   assert.deepEqual(decideSameToolFailure({ failCount: 3, threshold: 3, errorCode: expected, errorText: wire.error + " element_not_found", alreadyPivoted: false }), { action: "stop" })
  } finally { releaseFlight(tool, holder) }
  assert.equal(flightSnapshot()[tool], undefined)
 })
}
test("#563 per-tool independence and only actual holder release admits another owner", () => {
 assert.equal(tryAcquireFlight("shell_exec", "A").ok, true); assert.equal(tryAcquireFlight("netsec_port_scan", "B").ok, true)
 releaseFlight("shell_exec", "foreign"); assert.equal(flightSnapshot().shell_exec, "A"); assert.equal(tryAcquireFlight("shell_exec", "C").ok, false)
 releaseFlight("shell_exec", "A"); assert.equal(tryAcquireFlight("shell_exec", "C").ok, true); assert.equal(flightSnapshot().netsec_port_scan, "B")
})
test("#563 unknown/no-code fallback, locator and threshold remain", () => {
 for (const errorCode of [undefined, "OWNED_UNKNOWN"]) {
  assert.equal(classifyError("timeout", { error_code: errorCode }), "recoverable"); assert.equal(classifyError("owned neutral", { error_code: errorCode }), "non_recoverable")
  assert.deepEqual(decideSameToolFailure({ failCount: 2, threshold: 3, errorCode, errorText: "element_not_found", alreadyPivoted: false }), { action: "count" })
  assert.deepEqual(decideSameToolFailure({ failCount: 3, threshold: 3, errorCode, errorText: "element_not_found", alreadyPivoted: false }), { action: "pivot", instruction: LOCATOR_PIVOT_INSTRUCTION })
  assert.deepEqual(decideSameToolFailure({ failCount: 3, threshold: 3, errorCode, errorText: "element_not_found", alreadyPivoted: true }), { action: "stop" })
 }
 assert.equal(decideSameToolFailure({ failCount: 3, threshold: 3, errorCode: "ELEMENT_NOT_FOUND", alreadyPivoted: false }).action, "pivot")
})
test("#563 actual dispatcher missing/invalid token refuses before held busy slot", async () => {
 const { executeCompanionTool, bindCompanionDispatchRuntime } = await import("../src/tool/companion-dispatch")
 const { SecurityConfirmationManager } = await import("../src/security-confirmation")
 const tm = new ThreadManager(), host = tm.create("OWNED_AUTH_NEGATIVE")
 bindCompanionDispatchRuntime({ getThreadManager: () => tm, getSkillEngine: () => null as any, getCachedTabUrl: () => undefined, getTabUrlCache: () => new Map(), computerTaskAbort: new Map(), computerRateLimiter: async () => null as any, getComputerRateLimiterSingleton: () => null, securityConfirmations: new SecurityConfirmationManager(), getComputerEstopEnsureOverride: () => null, rejectPendingForThread: () => 0, hasPendingForTab: () => false, rejectPendingForTab: () => 0 })
 for (const tool of ["shell_exec", "netsec_port_scan"] as const) {
  assert.equal(tryAcquireFlight(tool, "OWNED_HOLDER").ok, true)
  for (const token of [undefined, "OWNED_INVALID_NOT_CREDENTIAL"]) {
   const params = tool === "shell_exec" ? { command: "echo OWNED_INERT", cwd: process.cwd() } : { targets: ["owned.example.test"] }
   const wire = await executeCompanionTool(tool, { ...params, __thread_id: host.id, security_token: token }); receipts.push({ authorizationNegative: true, tool, tokenPresent: !!token, wire })
   assert.equal(wire.success, false); assert.match(wire.error!, token ? /Invalid or expired security token/ : /requires L2 security_token/)
   assert.deepEqual(wire.data, token ? { error_code: "SECURITY_TOKEN_INVALID" } : undefined); assert.equal(flightSnapshot()[tool], "OWNED_HOLDER")
  }
  releaseFlight(tool, "OWNED_HOLDER")
 }
})
test("#563 only two busy grades join original intrinsic/default policy", () => {
 assert.equal(ERROR_CODE_LEVELS.get("SHELL_BUSY"), "recoverable"); assert.equal(ERROR_CODE_LEVELS.get("NETSEC_BUSY"), "recoverable")
 assert.equal(ERROR_CODE_LEVELS.size, 165); assert.equal(DEFAULT_NON_RECOVERABLE_CODES.length, 59)
 for (const code of ["SHELL_SCOPE_DENIED", "NETSEC_SCOPE_DENIED", "SETTINGS_REQUIRED"]) assert.equal(ERROR_CODE_LEVELS.has(code), false)
 for (const code of ["SECURITY_TOKEN_INVALID", "NETSEC_TARGETS_DENIED", "GRANT_DENIED", "BOARD_TRUST_REJECTED"]) assert.equal(ERROR_CODE_LEVELS.get(code), "non_recoverable")
})

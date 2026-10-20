import { computerFailureEnvelope } from "./helpers/computer-failure-envelope"
import test, { beforeEach, afterEach, after, mock } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import cp = require("node:child_process")
import net from "node:net"
import ts from "typescript"
import { runComputerTask, type ComputerExecutorDeps } from "../src/computer/executor"
import { assertExeNotDrifted } from "../src/computer/policy"
import type { AppEntry } from "../src/apps/types"
import type { CompanionConfig } from "../src/config"
import { classifyError, ERROR_CODE_LEVELS, DEFAULT_NON_RECOVERABLE_CODES } from "../src/security"
import { decideSameToolFailure } from "../src/llm/same-tool-guard"
import { securityPolicy } from "../src/security-policy"

let effects = { process: 0, network: 0, issuer: 0 }
const receipts: unknown[] = []
beforeEach(() => {
  effects = { process: 0, network: 0, issuer: 0 }
  for (const name of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"] as const) mock.method(cp, name, (() => { effects.process++; throw Error("OWNED_PROCESS_FORBIDDEN") }) as any)
  mock.method(net.Socket.prototype, "connect", (() => { effects.network++; throw Error("OWNED_NETWORK_FORBIDDEN") }) as any)
  mock.method(globalThis, "fetch", (() => { effects.network++; throw Error("OWNED_FETCH_FORBIDDEN") }) as any)
  for (const name of ["issueToken", "issueTokenFor"] as const) mock.method(securityPolicy, name, (() => { effects.issuer++; throw Error("OWNED_ISSUER_FORBIDDEN") }) as any)
})
afterEach(() => { assert.deepEqual(effects, { process: 0, network: 0, issuer: 0 }); mock.restoreAll() })
after(() => { if (process.env.CMSPARK_D4_RECEIPT) fs.writeFileSync(process.env.CMSPARK_D4_RECEIPT, JSON.stringify(receipts, null, 2) + "\n") })
function ast(file: string) { return ts.createSourceFile(file, fs.readFileSync(path.join(process.cwd(), "src", file), "utf8"), ts.ScriptTarget.Latest, true) }
function unique(tree: ts.Node, predicate: (n: ts.Node) => boolean) {
  const nodes: ts.Node[] = []
  const walk = (n: ts.Node) => { if (predicate(n)) nodes.push(n); ts.forEachChild(n, walk) }
  walk(tree); assert.equal(nodes.length, 1); return nodes[0]
}
const dispatchAst = ast("tool/companion-dispatch.ts")
const failed = unique(dispatchAst, n => ts.isIfStatement(n) && n.expression.getText(dispatchAst) === "!result.success" && n.thenStatement.getText(dispatchAst).includes("evidence_dir") && ts.isBlock(n.thenStatement)) as ts.IfStatement
const returnNode = (failed.thenStatement as ts.Block).statements.find(ts.isReturnStatement)!
assert.ok(returnNode)
const failureEnvelope = computerFailureEnvelope( returnNode.getText(dispatchAst)) as (result: Awaited<ReturnType<typeof runComputerTask>>) => any
const adapter = ast("llm/adapter.ts")
const code = unique(adapter, n => ts.isVariableDeclaration(n) && n.name.getText(adapter) === "classCode")
const level = unique(adapter, n => ts.isVariableDeclaration(n) && n.name.getText(adapter) === "errorLevel" && !!n.initializer?.getText(adapter).includes("classifyError(toolResult.error"))
const halt = unique(adapter, n => ts.isIfStatement(n) && n.expression.getText(adapter) === 'errorLevel === "security" || errorLevel === "non_recoverable"') as ts.IfStatement
// Actual production expressions; no complete authenticated dispatcher/model/native round is claimed.
const consume = new Function(ts.transpileModule(`function consume(toolResult,toolName,classifyError){const ${code.getText(adapter)};const ${level.getText(adapter)};return {classCode,errorLevel,stop:${halt.expression.getText(adapter)}}}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText + ";return consume")() as any
function entry(folder = "ordinary"): AppEntry {
  return { token: "win.app.owned", kind: "gui", display_name: "Owned inert", source: "user", policy: "manual", enabled: true, coordinateAllowed: true, added_at: "owned", exe: { path: `C:/Owned/${folder}/app.exe`, sha256: "a".repeat(64), signer: "OWNED_NOT_A_REAL_SIGNATURE", user_writable_dir: false } }
}
async function executeDenied(subject: AppEntry, hashFile: (file: string) => string) {
  let nativeEffects = 0
  const trap = () => { nativeEffects++; throw Error("OWNED_NATIVE_EFFECT_FORBIDDEN") }
  const native = new Proxy({}, { get: () => trap })
  const config = { apps: { enabled: true, entries: { [subject.token]: subject } }, computer: { coordinateEnabled: true } } as unknown as CompanionConfig
  const produced = await runComputerTask({ task: "Owned integrity refusal", app: subject.token, actions: [{ action: "click", target: "Owned target" }] }, { config, hashFile, injector: native, capturer: native, locator: native, windows: native, securityEnv: native, evidenceFactory: trap, confirm: trap } as unknown as ComputerExecutorDeps)
  assert.equal(produced.success, false)
  assert.equal(produced.completedActions, 0)
  assert.deepEqual(produced.steps, [])
  assert.equal(nativeEffects, 0)
  const wire = JSON.parse(JSON.stringify(failureEnvelope(produced)))
  assert.equal(wire.data.error_code, produced.errorCode)
  assert.equal(wire.error, produced.error)
  return { produced, wire, consumer: consume(wire, "host_computer", classifyError), nativeEffects }
}
for (const item of [
  { id: "neutral mismatch", folder: "ordinary", hash: () => "b".repeat(64) },
  { id: "path timeout mismatch", folder: "timeout", hash: () => "b".repeat(64) },
  { id: "path disconnected mismatch", folder: "disconnected", hash: () => "b".repeat(64) },
  { id: "hash read error timeout", folder: "ordinary", hash: () => { throw Error("OWNED timeout") } },
]) test(`#563 D4 actual executable drift stays hard: ${item.id}`, async () => {
  const result = await executeDenied(entry(item.folder), item.hash)
  receipts.push({ id: item.id, ...result })
  assert.equal(result.produced.errorCode, "APP_EXE_DRIFT")
  assert.deepEqual(result.consumer, { classCode: "APP_EXE_DRIFT", errorLevel: "non_recoverable", stop: true })
  assert.deepEqual(decideSameToolFailure({ failCount: 3, threshold: 3, errorCode: result.wire.data.error_code, errorText: result.wire.error, alreadyPivoted: false }), { action: "stop" })
})
test("#563 D4 matching recorded hash remains accepted by the original integrity policy", () => {
  let calls = 0
  assertExeNotDrifted(entry(), file => { calls++; assert.equal(file, entry().exe!.path); return "a".repeat(64) })
  assert.equal(calls, 1)
})
test("#563 D4 optional missing hash remains optional without touching the file", () => {
  const subject = entry(); delete subject.exe!.sha256
  assertExeNotDrifted(subject, () => { throw Error("NO_HASH_EXPECTED") })
})
test("#563 D4 structural LOLBIN rejection still precedes hashing or native actions", async () => {
  const subject = entry(); subject.exe!.path = "C:/Owned/cmd.exe"
  const result = await executeDenied(subject, () => { throw Error("NO_HASH_BEFORE_STRUCTURAL_DENY") })
  assert.equal(result.produced.errorCode, "APP_COORDINATE_STRUCTURAL")
  assert.deepEqual(result.consumer, { classCode: "APP_COORDINATE_STRUCTURAL", errorLevel: "non_recoverable", stop: true })
})
test("#563 D4 does not remap correction, unknown or HITL denials", () => {
  assert.equal(DEFAULT_NON_RECOVERABLE_CODES.length, 59)
  assert.equal(ERROR_CODE_LEVELS.has("OUT_OF_BOUNDS"), true)
  assert.equal(classifyError("outside client rect", { error_code: "OUT_OF_BOUNDS" }), "recoverable")
  assert.equal(classifyError("timeout", { error_code: "OWNED_UNKNOWN_CODE" }), "recoverable")
  assert.equal(classifyError("neutral refusal", { error_code: "OWNED_UNKNOWN_CODE" }), "non_recoverable")
  for (const error of ["user_gesture required", "task authorization required", "host_read requires L2 security_token confirmation"]) assert.equal(classifyError(error), "non_recoverable")
  assert.equal(classifyError("timeout", { error_code: "COOKIE_TRUST_DENIED" }), "security")
})
test("#563 D4 actual dispatcher still rejects missing and invalid authority", async () => {
  const dispatch = await import("../src/tool/companion-dispatch")
  let attempts = 0
  dispatch.bindCompanionDispatchRuntime({ getThreadManager: () => null, getSkillEngine: () => null, getComputerEstopEnsureOverride: () => () => { attempts++; throw Error("NO_NATIVE_ADMISSION") } } as any)
  const params = { app: "win.app.owned", task: "Owned refused request", actions: [{ action: "click", target: "Owned target" }] }
  for (const token of [undefined, "OWNED_INVALID_NONCREDENTIAL_NOT_ISSUED"]) {
    const result = await dispatch.executeCompanionTool("host_computer", { ...params, security_token: token })
    assert.equal(result.success, false)
    assert.match(result.error!, token ? /Invalid or expired security token/ : /requires L2 security_token confirmation/)
  }
  assert.equal(attempts, 0)
})

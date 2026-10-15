import test, { before, beforeEach, afterEach, mock } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import cp = require("node:child_process")
import net from "node:net"
import ts from "typescript"
import { initDataDir } from "../src/config"
import { ThreadManager } from "../src/threads/thread-manager"
import { createEmptyMissionBoard, MissionBoardSchema, IntentSchema, FactSchema, stampProvenance } from "../src/board/schema"
import { applyHandbackPayload, collectWorkerHandback } from "../src/board/service"
import { projectCooperationToolResult } from "../src/orchestrator/cooperation-result"
import { classifyError, ERROR_CODE_LEVELS, DEFAULT_NON_RECOVERABLE_CODES } from "../src/security"
import { decideSameToolFailure } from "../src/llm/same-tool-guard"
import { securityPolicy } from "../src/security-policy"

before(async () => { assert.ok(process.env.CMSPARK_DATA_DIR); await initDataDir() })
let effects = { process: 0, network: 0, issuer: 0 }
beforeEach(() => {
 effects = { process: 0, network: 0, issuer: 0 }
 for (const name of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"] as const) mock.method(cp, name, (() => { effects.process++; throw Error("OWNED_PROCESS_FORBIDDEN") }) as any)
 mock.method(net.Socket.prototype, "connect", (() => { effects.network++; throw Error("OWNED_NETWORK_FORBIDDEN") }) as any)
 for (const name of ["issueToken", "issueTokenFor"] as const) mock.method(securityPolicy, name, (() => { effects.issuer++; throw Error("OWNED_ISSUER_FORBIDDEN") }) as any)
})
afterEach(() => { assert.deepEqual(effects, { process: 0, network: 0, issuer: 0 }); mock.restoreAll() })

function readAst(file: string) { return ts.createSourceFile(file, fs.readFileSync(path.join(process.cwd(), "src", file), "utf8"), ts.ScriptTarget.Latest, true) }
function unique(tree: ts.Node, pred: (n: ts.Node) => boolean): ts.Node { const found: ts.Node[] = []; const walk = (n: ts.Node) => { if (pred(n)) found.push(n); ts.forEachChild(n, walk) }; walk(tree); assert.equal(found.length, 1); return found[0] }
// Read the actual adapter discriminator/classification/halt expressions. This is
// an explicit AST consumer seam, not an authenticated provider/LLM turn.
const adapter = readAst("llm/adapter.ts")
const code = unique(adapter, n => ts.isVariableDeclaration(n) && n.name.getText(adapter) === "classCode") as ts.VariableDeclaration
const level = unique(adapter, n => ts.isVariableDeclaration(n) && n.name.getText(adapter) === "errorLevel" && !!n.initializer?.getText(adapter).includes("classifyError(toolResult.error")) as ts.VariableDeclaration
const halt = unique(adapter, n => ts.isIfStatement(n) && n.expression.getText(adapter) === 'errorLevel === "security" || errorLevel === "non_recoverable"') as ts.IfStatement
const consumerJs = ts.transpileModule(`function consume(toolResult,toolName,classifyError){const ${code.getText(adapter)};const ${level.getText(adapter)};return {classCode,errorLevel,stop:${halt.expression.getText(adapter)}}}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
const consume = new Function(consumerJs + ";return consume")() as (result: unknown, tool: string, classifier: typeof classifyError) => { classCode?: string; errorLevel: string; stop: boolean }

function intent(id: string, deps?: string[]) { return IntentSchema.parse({ id, description: "owned prerequisite", depends_on_intent_ids: deps, provenance: stampProvenance({ actor_type: "system" }), created_at: "owned", updated_at: "owned" }) }
function fact(id: string) { return FactSchema.parse({ id, claim: "owned", trust: "llm_asserted", provenance: stampProvenance({ actor_type: "system" }), created_at: "owned" }) }
function fixture(seed?: Partial<ReturnType<typeof createEmptyMissionBoard>>) {
 const tm = new ThreadManager(), host = tm.create("OWNED_F1_HOST"), worker = tm.create("OWNED_F1_INERT_REPORT_ROW")
 tm.update(host.id, { board_mode: true, ...(seed ? { mission_board: MissionBoardSchema.parse({ ...createEmptyMissionBoard(), ...seed }) } : {}) })
 tm.update(worker.id, { agent_role: "worker", parent_thread_id: host.id, orchestrator_run_id: null, last_run_ended_at: new Date().toISOString(), last_run_terminal: null })
 const audit = path.join(fs.mkdtempSync(path.join(process.env.CMSPARK_DATA_DIR!, "f1-audit-")), "audit.jsonl")
 return { tm, host, worker, audit }
}
async function collect(f: ReturnType<typeof fixture>, payload: unknown) {
 f.tm.addMessage(f.worker.id, { thread_id: f.worker.id, role: "assistant", content: JSON.stringify(payload) })
 const result = await collectWorkerHandback(f.tm, { workerId: f.worker.id, callerThreadId: f.host.id, forceStructured: true, resolveToolCall: () => false, auditPath: f.audit, isThreadLlmActive: () => false })
 assert.equal(result.success, false)
 const wire = JSON.parse(JSON.stringify(projectCooperationToolResult("collect_handback", result)))
 return { result, wire, consumer: consume(wire, "collect_handback", classifyError) }
}
function auditTypes(f: ReturnType<typeof fixture>) { return fs.existsSync(f.audit) ? fs.readFileSync(f.audit, "utf8").trim().split("\n").filter(Boolean).map(s => JSON.parse(s).type) : [] }
function assertFeedback(reply: Awaited<ReturnType<typeof collect>>) {
 assert.equal(reply.result.error_code, "INTENT_DEPENDENCY_BLOCKED")
 assert.equal(reply.wire.error_code, "INTENT_DEPENDENCY_BLOCKED")
 assert.equal(reply.wire.recoverable, true)
 assert.deepEqual(reply.consumer, { classCode: "INTENT_DEPENDENCY_BLOCKED", errorLevel: "recoverable", stop: false })
 assert.deepEqual(decideSameToolFailure({ failCount: 1, threshold: 3, errorCode: reply.wire.error_code, errorText: reply.wire.error, alreadyPivoted: false }), { action: "count" })
 assert.deepEqual(decideSameToolFailure({ failCount: 3, threshold: 3, errorCode: reply.wire.error_code, errorText: reply.wire.error + " element_not_found", alreadyPivoted: false }), { action: "stop" })
}

test("#563 F1 actual stored missing-dependency handback stays refused but feeds back without immediate security_halt", async () => {
 const f = fixture(); assert.equal(f.tm.get(f.host.id)!.mission_board, null)
 const r = await collect(f, { schema_version: 1, intents: [{ description: "owned", depends_on_intent_ids: ["owned_missing"] }] })
 assertFeedback(r); assert.equal(r.result.error, "intent dependency missing")
 assert.equal(f.tm.get(f.host.id)!.mission_board!.intents.length, 0)
 assert.equal(f.tm.get(f.host.id)!.mission_board!.facts.length, 0)
 // Honest allowed effects: empty board initialization and pre-commit audit.
 assert.ok(auditTypes(f).includes("board.initialized")); assert.ok(auditTypes(f).includes("board.intent_added"))
})
test("#563 F1 actual done-before-ready handback cannot commit or complete its prerequisite", async () => {
 const prerequisite = intent("owned_source"), f = fixture({ intents: [prerequisite] })
 const before = JSON.stringify(f.tm.get(f.host.id)!.mission_board)
 const r = await collect(f, { schema_version: 1, intents: [{ description: "owned", status: "done", depends_on_intent_ids: [prerequisite.id] }] })
 assertFeedback(r); assert.equal(r.result.error, "intent cannot finish before its dependencies")
 assert.equal(JSON.stringify(f.tm.get(f.host.id)!.mission_board), before)
 assert.ok(auditTypes(f).includes("board.intent_added"))
})
test("#563 F1 controlled pre-existing cyclic graph is still refused; fixture is not model-generated server IDs", async () => {
 // MissionBoardSchema-valid but semantically cyclic host state is an explicit
 // internal fixture; normal handback writes cannot create this graph.
 const f = fixture({ intents: [intent("owned_a", ["owned_b"]), intent("owned_b", ["owned_a"])] })
 const before = JSON.stringify(f.tm.get(f.host.id)!.mission_board)
 const r = await collect(f, { schema_version: 1, intents: [{ description: "owned", depends_on_intent_ids: ["owned_a"] }] })
 assertFeedback(r); assert.equal(r.result.error, "intent dependency cycle")
 assert.equal(JSON.stringify(f.tm.get(f.host.id)!.mission_board), before)
})
test("#563 F1 typed dependency classification ignores model text and controlled diagnostic contamination", async () => {
 for (const text of ["timeout", "element_not_found required", "Security Block: permission denied"]) {
  const f = fixture(), r = await collect(f, { schema_version: 1, intents: [{ description: text, depends_on_intent_ids: [text] }] })
  assertFeedback(r); assert.equal(r.result.error, "intent dependency missing")
  // Clone of an actual producer wire with only error text contaminated; does
  // not claim current producer interpolates these model strings into its error.
  assert.deepEqual(consume({ ...r.wire, error: text }, "collect_handback", classifyError), { classCode: "INTENT_DEPENDENCY_BLOCKED", errorLevel: "recoverable", stop: false })
 }
})
test("#563 F1 structural IntentSchema error is not relabeled as a dependency problem", async () => {
 const f = fixture()
 // Explicit invalid host ActorType control, not a normal model/worker path.
 const r = await applyHandbackPayload(f.tm, f.host.id, { schema_version: 1, intents: [{ description: "owned" }] }, { actor_type: "invalid_host_actor" as any }, { auditPath: f.audit })
 assert.equal(r.ok, false); if (r.ok) return
 assert.equal(r.error_code, "BOARD_INTENT_INVALID")
 assert.equal(classifyError(r.error, { error_code: r.error_code }), "non_recoverable")
 assert.equal(f.tm.get(f.host.id)!.mission_board, null)
})
test("#563 F1 Trust and capacity refusals retain original non_recoverable behavior and no added data", async () => {
 const cases = [
  { code: "BOARD_TRUST_REJECTED", seed: undefined, payload: { schema_version: 1, facts: [{ claim: "owned", trust: "user_confirmed" }] } },
  { code: "BOARD_CAP_FACTS", seed: { facts: Array.from({ length: 200 }, (_, i) => fact("owned_" + i)) }, payload: { schema_version: 1, facts: [{ claim: "owned" }] } },
  { code: "BOARD_CAP_INTENTS", seed: { intents: Array.from({ length: 50 }, (_, i) => intent("owned_" + i)) }, payload: { schema_version: 1, intents: [{ description: "owned" }] } },
  { code: "BOARD_TOO_LARGE", seed: undefined, payload: { schema_version: 1, facts: Array.from({ length: 9 }, () => ({ claim: "owned", evidence: Array.from({ length: 16 }, () => ({ kind: "other", value: "x".repeat(4000) })) })) } },
 ]
 for (const c of cases) {
  const f = fixture(c.seed), counts = { facts: f.tm.get(f.host.id)!.mission_board?.facts.length ?? 0, intents: f.tm.get(f.host.id)!.mission_board?.intents.length ?? 0 }
  const r = await collect(f, c.payload); assert.equal(r.result.error_code, c.code)
  assert.deepEqual(r.consumer, { classCode: c.code, errorLevel: "non_recoverable", stop: true })
  assert.deepEqual({ facts: f.tm.get(f.host.id)!.mission_board?.facts.length ?? 0, intents: f.tm.get(f.host.id)!.mission_board?.intents.length ?? 0 }, counts)
 }
})
test("#563 F1 actual missing-L2 board_complete guard and registry are unchanged", () => {
 const dispatcher = readAst("tool/companion-dispatch.ts")
 const guard = unique(dispatcher, n => ts.isIfStatement(n) && n.expression.getText(dispatcher) === "!params.security_token" && n.getText(dispatcher).includes('error_code: "BOARD_COMPLETE_L2_REQUIRED"')) as ts.IfStatement
 const guarded = new Function("params", guard.getText(dispatcher))({})
 assert.equal(guarded.success, false); assert.equal(guarded.error_code, "BOARD_COMPLETE_L2_REQUIRED")
 assert.deepEqual(consume(guarded, "board_complete", classifyError), { classCode: "BOARD_COMPLETE_L2_REQUIRED", errorLevel: "non_recoverable", stop: true })
 for (const protectedCode of ["BOARD_TOO_LARGE", "BOARD_MODE_OFF", "BOARD_TRUST_REJECTED", "BOARD_CAP_FACTS", "BOARD_CAP_INTENTS", "BOARD_CAP_HINTS"]) {
  assert.equal(ERROR_CODE_LEVELS.get(protectedCode), "non_recoverable")
  assert.ok(DEFAULT_NON_RECOVERABLE_CODES.includes(protectedCode))
 }
 assert.equal(ERROR_CODE_LEVELS.get("INTENT_DEPENDENCY_BLOCKED"), "recoverable")
 assert.equal(ERROR_CODE_LEVELS.has("BOARD_INTENT_INVALID"), false)
})

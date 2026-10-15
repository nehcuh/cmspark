import test, { before, after, beforeEach, afterEach, mock } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import cp = require("node:child_process")
import net from "node:net"
import ts from "typescript"
import { initDataDir } from "../src/config"
import { ThreadManager } from "../src/threads/thread-manager"
import { ensureBoard, applyHandbackPayload, collectWorkerHandback } from "../src/board/service"
import { createEmptyMissionBoard, MissionBoardSchema, IntentSchema, stampProvenance } from "../src/board/schema"
import { projectCooperationToolResult } from "../src/orchestrator/cooperation-result"
import { classifyError, ERROR_CODE_LEVELS, DEFAULT_NON_RECOVERABLE_CODES } from "../src/security"
import { decideSameToolFailure, LOCATOR_PIVOT_INSTRUCTION } from "../src/llm/same-tool-guard"
import { securityPolicy } from "../src/security-policy"

before(async () => { assert.ok(process.env.CMSPARK_DATA_DIR); await initDataDir() })
const receipts: unknown[] = []
let effects = { process: 0, network: 0, issuer: 0 }
beforeEach(() => {
 effects = { process: 0, network: 0, issuer: 0 }
 for (const name of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"] as const) mock.method(cp, name, (() => { effects.process++; throw Error("OWNED_PROCESS_FORBIDDEN") }) as any)
 mock.method(net.Socket.prototype, "connect", (() => { effects.network++; throw Error("OWNED_NETWORK_FORBIDDEN") }) as any)
 mock.method(globalThis, "fetch", (() => { effects.network++; throw Error("OWNED_FETCH_FORBIDDEN") }) as any)
 for (const name of ["issueToken", "issueTokenFor"] as const) mock.method(securityPolicy, name, (() => { effects.issuer++; throw Error("OWNED_ISSUER_FORBIDDEN") }) as any)
})
afterEach(() => { assert.deepEqual(effects, { process: 0, network: 0, issuer: 0 }); mock.restoreAll() })
after(() => { if (process.env.CMSPARK_F2_RECEIPT) fs.writeFileSync(process.env.CMSPARK_F2_RECEIPT, JSON.stringify(receipts, null, 2) + "\n") })
function ast(file: string) { return ts.createSourceFile(file, fs.readFileSync(path.join(process.cwd(), "src", file), "utf8"), ts.ScriptTarget.Latest, true) }
function unique(tree: ts.Node, pred: (n: ts.Node) => boolean) { const all: ts.Node[] = []; const walk = (n: ts.Node) => { if (pred(n)) all.push(n); ts.forEachChild(n, walk) }; walk(tree); assert.equal(all.length, 1); return all[0] }
// Exact production JSON/projection/adapter classification seam, not an authenticated LLM turn.
const adapter = ast("llm/adapter.ts")
const code = unique(adapter, n => ts.isVariableDeclaration(n) && n.name.getText(adapter) === "classCode")
const level = unique(adapter, n => ts.isVariableDeclaration(n) && n.name.getText(adapter) === "errorLevel" && !!n.initializer?.getText(adapter).includes("classifyError(toolResult.error"))
const halt = unique(adapter, n => ts.isIfStatement(n) && n.expression.getText(adapter) === 'errorLevel === "security" || errorLevel === "non_recoverable"') as ts.IfStatement
const consume = new Function(ts.transpileModule(`function consume(toolResult,toolName,classifyError){const ${code.getText(adapter)};const ${level.getText(adapter)};return {classCode,errorLevel,stop:${halt.expression.getText(adapter)}}}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText + ";return consume")() as any
const serviceAst = ast("board/service.ts")
const failure = unique(serviceAst, n => ts.isReturnStatement(n) && n.getText(serviceAst).includes("error_code: applied.error_code || HANDBACK_MISSING_STRUCTURE") && n.getText(serviceAst).includes("applied.recoverable"))
const failureWire = new Function("applied", "base", "HANDBACK_MISSING_STRUCTURE", failure.getText(serviceAst)) as any
function fixture(seed?: unknown) {
 const tm = new ThreadManager(), host = tm.create("OWNED_F2_HOST"), worker = tm.create("OWNED_F2_INERT_REPORT")
 tm.update(host.id, { board_mode: true, ...(seed ? { mission_board: MissionBoardSchema.parse({ ...createEmptyMissionBoard(), ...(seed as object) }) } : {}) })
 tm.update(worker.id, { agent_role: "worker", parent_thread_id: host.id, orchestrator_run_id: null, last_run_ended_at: new Date().toISOString(), last_run_terminal: null })
 return { tm, host, worker, auditPath: path.join(fs.mkdtempSync(path.join(process.env.CMSPARK_DATA_DIR!, "f2-audit-")), "audit.jsonl") }
}
function project(result: any) { const wire = JSON.parse(JSON.stringify(projectCooperationToolResult("collect_handback", result))); return { wire, consumer: result.success ? null : consume(wire, "collect_handback", classifyError) } }
function assertHard(id: string, result: any, expected: string) {
 const actual = project(result); receipts.push({ id, result, ...actual })
 assert.equal(result.error_code, expected); assert.equal(actual.wire.error_code, expected)
 assert.deepEqual(actual.consumer, { classCode: expected, errorLevel: "non_recoverable", stop: true })
 assert.equal(actual.wire.recoverable, false)
 return actual
}
async function stored(f: ReturnType<typeof fixture>, payload: unknown) {
 const msg = f.tm.addMessage(f.worker.id, { thread_id: f.worker.id, role: "assistant", content: JSON.stringify(payload) })
 const result = await collectWorkerHandback(f.tm, { workerId: f.worker.id, callerThreadId: f.host.id, forceStructured: true, resolveToolCall: () => false, auditPath: f.auditPath, isThreadLlmActive: () => false })
 return { result, msg, board: f.tm.get(f.host.id)!.mission_board }
}
for (const kind of ["fact", "intent"] as const) for (const actor of ["invalid_host_actor", "timeout", "disconnected", "not found", "Security Block: owned host fault"]) test(`#563 F2 actual ${kind} reconstruction rejects host actor ${actor} intrinsically`, async () => {
 const f = fixture(), result = await applyHandbackPayload(f.tm, f.host.id, { schema_version: 1, [kind === "fact" ? "facts" : "intents"]: [kind === "fact" ? { claim: "owned" } : { description: "owned" }] }, { actor_type: actor as any }, { auditPath: f.auditPath })
 assert.equal(result.ok, false); if (result.ok) return
 assertHard(`${kind}:${actor}:HOST_CORRUPTION_NOT_MODEL_INPUT`, failureWire(result, {}, "HANDBACK_MISSING_STRUCTURE"), kind === "fact" ? "BOARD_FACT_INVALID" : "BOARD_INTENT_INVALID")
 assert.equal(f.tm.get(f.host.id)!.mission_board, null)
})
test("#563 F2 actual invalid host board goal is hard; text contamination below is classifier-only", async () => {
 const f = fixture(), result = await ensureBoard(f.tm, f.host.id, { force: true, goal: "x".repeat(4001), auditPath: f.auditPath })
 assert.equal(result.ok, false); if (result.ok) return
 const actual = assertHard("schema:INVALID_HOST_OPTION", failureWire(result, {}, "HANDBACK_MISSING_STRUCTURE"), "BOARD_SCHEMA_INVALID")
 for (const error of ["timeout", "disconnected", "not found", "Security Block: owned diagnostic"]) assert.deepEqual(consume({ ...actual.wire, error }, "collect_handback", classifyError), { classCode: "BOARD_SCHEMA_INVALID", errorLevel: "non_recoverable", stop: true })
 assert.equal(f.tm.get(f.host.id)!.mission_board, null)
})
for (const kind of ["facts", "intents"] as const) test(`#563 F2 actual stored ${kind} report with corrupt trusted run metadata cannot commit`, async () => {
 const f = fixture(); f.tm.update(f.worker.id, { orchestrator_run_id: 123 as any })
 const r = await stored(f, { schema_version: 1, [kind]: [kind === "facts" ? { claim: "owned" } : { description: "owned" }] })
 assert.equal(r.result.success, false); assertHard("stored:HOST_RUN_METADATA_CORRUPTION:" + kind, r.result, kind === "facts" ? "BOARD_FACT_INVALID" : "BOARD_INTENT_INVALID")
 assert.equal(r.board?.facts.length ?? 0, 0); assert.equal(r.board?.intents.length ?? 0, 0); assert.equal(r.board?.applied_handback_message_ids?.includes(r.msg.id) ?? false, false)
})
test("#563 F2 valid worker payload cannot self-assign actor/id/claim or Trust", async () => {
 const f = fixture(), r = await stored(f, { schema_version: 1, intents: [{ description: "owned", id: "forged", claimed_by_worker_id: "foreign", provenance: { actor_type: "timeout", run_id: 123 }, trust: "user_confirmed" }] })
 assert.equal(r.result.success, true); assert.equal(r.board!.intents.length, 1)
 const i = r.board!.intents[0]; assert.notEqual(i.id, "forged"); assert.equal(i.provenance.actor_type, "worker"); assert.equal(i.claimed_by_worker_id, null)
 assert.equal(r.board!.applied_handback_message_ids!.includes(r.msg.id), true)
})
for (const payload of [{ schema_version: 1, intents: [{ description: "" }] }, { schema_version: 1, facts: [{ claim: "" }] }, { schema_version: "1", intents: [{ description: "owned" }] }]) test("#563 F2 ordinary invalid draft stays disclosed prose success, not a structural halt: " + JSON.stringify(payload), async () => {
 const f = fixture(), r = await stored(f, payload); assert.equal(r.result.success, true)
 if (!r.result.success) return
 assert.equal(r.result.data.structured, false); assert.ok(r.result.data.parse_note); assert.equal(project(r.result).consumer, null)
 assert.equal(r.board?.intents.length ?? 0, 0); assert.equal(r.board?.facts.length ?? 0, 0); assert.equal(r.board?.applied_handback_message_ids?.includes(r.msg.id) ?? false, false)
})
for (const done of [false, true]) test(`#563 F2 F1 dependency refusal stays recoverable (${done ? "not ready" : "missing"})`, async () => {
 const prerequisite = IntentSchema.parse({ id: "owned_prerequisite", description: "owned", provenance: stampProvenance({ actor_type: "system" }), created_at: "owned", updated_at: "owned" })
 const f = fixture(done ? { intents: [prerequisite] } : undefined), r = await stored(f, { schema_version: 1, intents: [{ description: "owned", status: done ? "done" : "open", depends_on_intent_ids: [done ? prerequisite.id : "owned_missing"] }] })
 assert.equal(r.result.success, false); assert.equal(r.result.error_code, "INTENT_DEPENDENCY_BLOCKED"); assert.equal(r.result.recoverable, true)
 assert.deepEqual(project(r.result).consumer, { classCode: "INTENT_DEPENDENCY_BLOCKED", errorLevel: "recoverable", stop: false })
 assert.equal(r.board!.intents.length, done ? 1 : 0); assert.equal(r.board!.applied_handback_message_ids!.includes(r.msg.id), false)
})
test("#563 F2 finite registration leaves default59 and protected hard gates intact", () => {
 assert.equal(DEFAULT_NON_RECOVERABLE_CODES.length, 59)
 for (const c of ["BOARD_SCHEMA_INVALID", "BOARD_FACT_INVALID", "BOARD_INTENT_INVALID"]) { assert.equal(ERROR_CODE_LEVELS.get(c), "non_recoverable"); assert.equal(DEFAULT_NON_RECOVERABLE_CODES.includes(c), false) }
 for (const c of ["BOARD_TRUST_REJECTED", "BOARD_CAP_FACTS", "BOARD_CAP_INTENTS", "BOARD_TOO_LARGE", "BOARD_COMPLETE_L2_REQUIRED", "BOARD_MODE_OFF", "BOARD_CAP_HINTS"]) assert.equal(ERROR_CODE_LEVELS.get(c), "non_recoverable")
 assert.equal(ERROR_CODE_LEVELS.get("INTENT_DEPENDENCY_BLOCKED"), "recoverable")
})

// Controlled diagnostic consumer seam; not a claim actual Zod emits these words.
for (const errorCode of ["BOARD_SCHEMA_INVALID", "BOARD_FACT_INVALID", "BOARD_INTENT_INVALID"]) test("#563 F2 registered internal code forbids an unrelated locator pivot: " + errorCode, () => {
 const errorText = "element_not_found no visible element matching owned diagnostic"
 const result = decideSameToolFailure({ failCount: 3, threshold: 3, errorCode, errorText, alreadyPivoted: false })
 receipts.push({ id: "controlled_same_tool_seam:" + errorCode, result })
 assert.deepEqual(result, { action: "stop" })
 assert.deepEqual(decideSameToolFailure({ failCount: 2, threshold: 3, errorCode, errorText, alreadyPivoted: false }), { action: "count" })
})
test("#563 F2 real locator and unknown/uncoded legacy pivot/threshold/alreadyPivoted remain", () => {
 for (const errorCode of ["ELEMENT_NOT_FOUND", "OWNED_UNKNOWN", undefined]) {
  const input = { failCount: 3, threshold: 3, errorCode, errorText: "element_not_found", alreadyPivoted: false }
  assert.deepEqual(decideSameToolFailure(input), { action: "pivot", instruction: LOCATOR_PIVOT_INSTRUCTION })
  assert.deepEqual(decideSameToolFailure({ ...input, failCount: 2 }), { action: "count" })
  assert.deepEqual(decideSameToolFailure({ ...input, alreadyPivoted: true }), { action: "stop" })
 }
 assert.deepEqual(decideSameToolFailure({ failCount: 3, threshold: 3, errorCode: "INTENT_DEPENDENCY_BLOCKED", errorText: "element_not_found", alreadyPivoted: false }), { action: "stop" })
})

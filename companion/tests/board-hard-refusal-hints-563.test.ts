import test, { before, after, beforeEach, afterEach, mock } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import cp = require("node:child_process")
import net from "node:net"
import ts from "typescript"
import { initDataDir } from "../src/config"
import { ThreadManager } from "../src/threads/thread-manager"
import { collectWorkerHandback, ensureBoard, addHint } from "../src/board/service"
import { createEmptyMissionBoard, MissionBoardSchema, FactSchema, IntentSchema, HintSchema, stampProvenance } from "../src/board/schema"
import { projectCooperationToolResult } from "../src/orchestrator/cooperation-result"
import { classifyError, ERROR_CODE_LEVELS, DEFAULT_NON_RECOVERABLE_CODES } from "../src/security"
import { securityPolicy } from "../src/security-policy"

before(async () => { assert.ok(process.env.CMSPARK_DATA_DIR); await initDataDir() })
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
after(() => {
  if (process.env.CMSPARK_F3_RECEIPT) fs.writeFileSync(process.env.CMSPARK_F3_RECEIPT, JSON.stringify(receipts, null, 2) + "\n")
})
function ast(file: string) { return ts.createSourceFile(file, fs.readFileSync(path.join(process.cwd(), "src", file), "utf8"), ts.ScriptTarget.Latest, true) }
function unique(tree: ts.Node, predicate: (n: ts.Node) => boolean) {
  const nodes: ts.Node[] = []
  const walk = (n: ts.Node) => { if (predicate(n)) nodes.push(n); ts.forEachChild(n, walk) }
  walk(tree); assert.equal(nodes.length, 1); return nodes[0]
}
// Execute the current consumer expressions, not a mirrored error envelope or full authenticated model turn.
const adapter = ast("llm/adapter.ts")
const code = unique(adapter, n => ts.isVariableDeclaration(n) && n.name.getText(adapter) === "classCode")
const level = unique(adapter, n => ts.isVariableDeclaration(n) && n.name.getText(adapter) === "errorLevel" && !!n.initializer?.getText(adapter).includes("classifyError(toolResult.error"))
const halt = unique(adapter, n => ts.isIfStatement(n) && n.expression.getText(adapter) === 'errorLevel === "security" || errorLevel === "non_recoverable"') as ts.IfStatement
const consume = new Function(ts.transpileModule(`function consume(toolResult,toolName,classifyError){const ${code.getText(adapter)};const ${level.getText(adapter)};return {classCode,errorLevel,stop:${halt.expression.getText(adapter)}}}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText + ";return consume")() as any
function fixture(seed?: object) {
  const tm = new ThreadManager(), host = tm.create("OWNED_F3_HOST"), worker = tm.create("OWNED_F3_INERT_REPORT")
  tm.update(host.id, { board_mode: true, ...(seed ? { mission_board: MissionBoardSchema.parse({ ...createEmptyMissionBoard(), ...seed }) } : {}) })
  tm.update(worker.id, { agent_role: "worker", parent_thread_id: host.id, orchestrator_run_id: null, last_run_ended_at: new Date().toISOString(), last_run_terminal: null })
  return { tm, host, worker, auditPath: path.join(fs.mkdtempSync(path.join(process.env.CMSPARK_DATA_DIR!, "f3-audit-")), "audit.jsonl") }
}
async function stored(f: ReturnType<typeof fixture>, payload: unknown, resolver: "absent" | ((id: string) => boolean) = () => false) {
  const msg = f.tm.addMessage(f.worker.id, { thread_id: f.worker.id, role: "assistant", content: JSON.stringify(payload) })
  const options = { workerId: f.worker.id, callerThreadId: f.host.id, forceStructured: true, auditPath: f.auditPath, isThreadLlmActive: () => false, ...(resolver === "absent" ? {} : { resolveToolCall: resolver }) }
  assert.equal(Object.hasOwn(options, "resolveToolCall"), resolver !== "absent")
  const result = await collectWorkerHandback(f.tm, options)
  const wire = JSON.parse(JSON.stringify(projectCooperationToolResult("collect_handback", JSON.parse(JSON.stringify(result)))))
  const consumer = result.success ? null : consume(wire, "collect_handback", classifyError)
  const board = f.tm.get(f.host.id)!.mission_board
  return { result, wire, consumer, board, msg }
}
function hard(id: string, r: Awaited<ReturnType<typeof stored>>, expectedCode: string, expectedError: string) {
  receipts.push({ id, result: r.result, wire: r.wire, consumer: r.consumer, final: { facts: r.board?.facts.length ?? 0, intents: r.board?.intents.length ?? 0, applied: r.board?.applied_handback_message_ids?.includes(r.msg.id) ?? false } })
  assert.equal(r.result.success, false)
  assert.equal(r.result.error_code, expectedCode)
  assert.equal(r.result.error, expectedError)
  assert.deepEqual(r.consumer, { classCode: expectedCode, errorLevel: "non_recoverable", stop: true })
  assert.equal(r.board?.applied_handback_message_ids?.includes(r.msg.id) ?? false, false)
  assert.equal(r.wire.recoverable, false, `${id}: hard refusal must not advertise recovery`)
  assert.equal(r.result.recoverable, false)
}
const provenance = () => stampProvenance({ actor_type: "system" })
const fact = (i: number) => FactSchema.parse({ id: `owned_fact_${i}`, claim: "owned", trust: "llm_asserted", provenance: provenance(), created_at: "owned" })
const intent = (i: number) => IntentSchema.parse({ id: `owned_intent_${i}`, description: "owned", provenance: provenance(), created_at: "owned", updated_at: "owned" })
const withEvidence = { schema_version: 1, facts: [{ claim: "owned", trust: "tool_verified", evidence: [{ kind: "tool_result", value: "owned", tool_call_id: "owned_not_real" }] }] }
for (const item of [
  { id: "non-user user_confirmed", payload: { schema_version: 1, facts: [{ claim: "owned", trust: "user_confirmed" }] }, error: "trust user_confirmed rejected for non-user actor", resolver: (() => false) as "absent" | ((id: string) => boolean) },
  { id: "tool_verified missing evidence ID", payload: { schema_version: 1, facts: [{ claim: "owned", trust: "tool_verified" }] }, error: "tool_verified requires evidence with resolvable tool_call_id", resolver: (() => false) as "absent" | ((id: string) => boolean) },
  { id: "tool_verified false resolver", payload: withEvidence, error: "tool_verified tool_call_id not resolvable on host/worker thread", resolver: (() => false) as "absent" | ((id: string) => boolean) },
  { id: "tool_verified genuinely absent resolver", payload: withEvidence, error: "tool_verified requires resolvable tool_call_id (no resolver)", resolver: "absent" as const },
]) test(`#563 F3 ${item.id} keeps hard rejection and truthful metadata`, async () => {
  const f = fixture(), r = await stored(f, item.payload, item.resolver)
  hard(item.id, r, "BOARD_TRUST_REJECTED", item.error)
  assert.equal(r.board?.facts.length ?? 0, 0)
  assert.equal(r.board?.intents.length ?? 0, 0)
})
test("#563 F3 size refusal preserves original 512000-byte limit and hard metadata", async () => {
  const r = await stored(fixture(), { schema_version: 1, facts: Array.from({ length: 9 }, () => ({ claim: "owned", evidence: Array.from({ length: 16 }, () => ({ kind: "other", value: "x".repeat(4000) })) })) })
  hard("size", r, "BOARD_TOO_LARGE", "board exceeds max_board_json_bytes (512000)")
  assert.equal(r.board?.facts.length ?? 0, 0)
})
test("#563 F3 fact capacity refuses rather than clearing existing 200 facts", async () => {
  const f = fixture({ facts: Array.from({ length: 200 }, (_, i) => fact(i)) }), before = JSON.stringify(f.tm.get(f.host.id)!.mission_board)
  const r = await stored(f, { schema_version: 1, facts: [{ claim: "owned new" }] })
  hard("facts cap", r, "BOARD_CAP_FACTS", "max_facts (200) would be exceeded")
  assert.equal(JSON.stringify(r.board), before)
})
test("#563 F3 intent capacity refuses rather than clearing existing 50 intents", async () => {
  const f = fixture({ intents: Array.from({ length: 50 }, (_, i) => intent(i)) }), before = JSON.stringify(f.tm.get(f.host.id)!.mission_board)
  const r = await stored(f, { schema_version: 1, intents: [{ description: "owned new" }] })
  hard("intents cap", r, "BOARD_CAP_INTENTS", "max_intents (50) would be exceeded")
  assert.equal(JSON.stringify(r.board), before)
})
test("#563 F3 ordinary lower-Trust report remains valid without elevation", async () => {
  const r = await stored(fixture(), { schema_version: 1, facts: [{ claim: "owned lower Trust", trust: "llm_asserted" }] }, "absent")
  assert.equal(r.result.success, true); assert.equal(r.board!.facts.length, 1)
  assert.equal(r.board!.facts[0].trust, "llm_asserted")
  assert.equal(r.board!.applied_handback_message_ids!.includes(r.msg.id), true)
})
test("#563 F3 dependency refusal preserves F1 recovery without committing an intent", async () => {
  const r = await stored(fixture(), { schema_version: 1, intents: [{ description: "owned", depends_on_intent_ids: ["owned_missing"] }] })
  assert.equal(r.result.success, false); assert.equal(r.result.error_code, "INTENT_DEPENDENCY_BLOCKED"); assert.equal(r.result.recoverable, true)
  assert.deepEqual(r.consumer, { classCode: "INTENT_DEPENDENCY_BLOCKED", errorLevel: "recoverable", stop: false })
  assert.equal(r.board!.intents.length, 0); assert.equal(r.board!.applied_handback_message_ids!.includes(r.msg.id), false)
})
test("#563 F3 optional board-mode-off skip retains its recoverable metadata", async () => {
  const f = fixture(); f.tm.update(f.host.id, { board_mode: false })
  const result = await ensureBoard(f.tm, f.host.id, { auditPath: f.auditPath })
  assert.equal(result.ok, false); if (result.ok) return
  assert.equal(result.error_code, "BOARD_MODE_OFF"); assert.equal(result.recoverable, true)
  assert.equal(f.tm.get(f.host.id)!.mission_board, null)
})
for (const text of [" ", "x".repeat(2001)]) test(`#563 F3 user Hint refusal remains user-recoverable (${text.length} chars)`, async () => {
  const f = fixture(), result = await addHint(f.tm, f.host.id, text, { actor_type: "user", thread_id: f.host.id }, { auditPath: f.auditPath })
  assert.equal(result.ok, false); if (result.ok) return
  assert.equal(result.error_code, "BOARD_HINT_INVALID"); assert.equal(result.recoverable, true)
  assert.equal(f.tm.get(f.host.id)!.mission_board?.hints.length ?? 0, 0)
})
test("#563 F3 user Hint capacity keeps existing 50 hints and its UI recovery hint", async () => {
  const hints = Array.from({ length: 50 }, (_, i) => HintSchema.parse({ id: `owned_hint_${i}`, text: "owned", provenance: provenance(), created_at: "owned" }))
  const f = fixture({ hints }), before = JSON.stringify(f.tm.get(f.host.id)!.mission_board)
  const result = await addHint(f.tm, f.host.id, "owned", { actor_type: "user", thread_id: f.host.id }, { auditPath: f.auditPath })
  assert.equal(result.ok, false); if (result.ok) return
  assert.equal(result.error_code, "BOARD_CAP_HINTS"); assert.equal(result.recoverable, true)
  assert.equal(JSON.stringify(f.tm.get(f.host.id)!.mission_board), before)
})
test("#563 F3 preserves finite hard levels, default bucket and F2 structural policy", () => {
  assert.equal(DEFAULT_NON_RECOVERABLE_CODES.length, 59)
  for (const name of ["BOARD_TOO_LARGE", "BOARD_TRUST_REJECTED", "BOARD_CAP_FACTS", "BOARD_CAP_INTENTS", "BOARD_SCHEMA_INVALID", "BOARD_FACT_INVALID", "BOARD_INTENT_INVALID", "BOARD_COMPLETE_L2_REQUIRED"]) assert.equal(ERROR_CODE_LEVELS.get(name), "non_recoverable")
  assert.equal(ERROR_CODE_LEVELS.get("INTENT_DEPENDENCY_BLOCKED"), "recoverable")
})

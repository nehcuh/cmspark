/** #722 actual manager offer metadata and default-one bounded config; no OS process or token. */
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import vm from "node:vm"
import ts from "typescript"
const root = path.resolve(__dirname, "../../src")
function source(file: string) { return ts.createSourceFile(file, fs.readFileSync(path.join(root, file), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS) }
function compile(code: string, globals: Record<string, unknown> = {}) { const exports: any = {}; vm.runInNewContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, { exports, ...globals }, { timeout: 2000 }); return exports }
function fixture() {
  let now = 1_000_000, serial = 0
  const effects = { external: 0, token: 0, native: 0 }, deny = () => { effects.external++; throw Error("OWNED_EXTERNAL_FORBIDDEN") }
  const sf = source("acp/manager.ts"), names = new Set(["propose", "getSession", "listSessionsForThread", "cancel", "expireOfferedSessions", "checkStartAdmission"]), selected: string[] = []
  function walk(n: ts.Node) { if (ts.isMethodDeclaration(n) && names.has(n.name.getText(sf))) selected.push(n.getText(sf)); ts.forEachChild(n, walk) } walk(sf)
  const config = { acp: { enabled: true, max_concurrent_sessions: 1 }, coding_handoff: { open_local_terminal: false } }
  class Clock extends Date { constructor(value?: any) { super(value === undefined ? now : value) } static now() { return now } }
  const Actual = compile(`export class Actual {
    sessions=new Map();executionClaims=new Map();shuttingDown=false;startupPreparations=new Map();protocolHandles=new Map();processes=new Map();manualEntryLaunches=new Map();lastProgressAt=new Map();events=[];
    resolveServer(){return{enabled:true,command:'INERT_NOT_EXECUTED',policy:{profile:'review_readonly'}}}
    emitProgress(session,tail){this.events.push(JSON.parse(JSON.stringify({session,tail}))) }pushTimeline(){};emitTerminal(){};
    ${selected.join("\n")}
  }`, { getConfig: () => config, newSessionId: () => `synthetic-${++serial}`, resolveAcpWorkspaceRoot: () => ({ ok: true, root: "/synthetic/workspace" }), logger: { info() {} }, Date: Clock,
    timelineItem: () => ({}), killAcpChild: deny, setTimeout: deny }).Actual
  const manager = new Actual()
  return { manager, config, effects, advance(ms: number) { now += ms }, clock(value: number) { now = value }, propose(threadId = "owner", agentId = "inert") { return manager.propose({ threadId, agentId, goal: "Owned synthetic task" }) } }
}
function offered(f: ReturnType<typeof fixture>, owner = "owner", agent = "inert") { const r = f.propose(owner, agent); assert.equal(r.ok, true); return r.session }
function zero(f: ReturnType<typeof fixture>) { assert.deepEqual(f.effects, { external: 0, token: 0, native: 0 }) }

test("#722 same-thread four model offers are metadata only; fifth is typed refusal", () => {
  const f = fixture(), rows = Array.from({ length: 4 }, (_, i) => f.propose("owner", `inert-${i}`))
  assert.equal(rows.filter(r => r.ok).length, 4)
  assert.ok(rows.every(r => r.session.state === "offered"))
  const refusal = f.propose("owner", "fifth"); assert.equal(refusal.ok, false); assert.equal(refusal.error_code, "ACP_SESSION_BUSY")
  assert.equal(refusal.data.holder_state, "offered"); assert.equal(f.manager.sessions.size, 4); assert.equal(f.manager.executionClaims.size, 0); zero(f)
})
test("#722 global16-nonterminal budget refuses foreign metadata without disclosing a holder", () => {
  const f = fixture(); for (let i = 0; i < 16; i++) offered(f, `owner-${i}`)
  const refusal = f.propose("new-owner"); assert.equal(refusal.ok, false); assert.equal(refusal.error_code, "ACP_CONCURRENCY_LIMIT")
  assert.equal(refusal.data.holder_session_id, undefined); assert.equal(refusal.data.holder_agent, undefined); assert.equal(f.manager.sessions.size, 16); zero(f)
})
test("#722 explicit offered cancel does not touch another owner or running slots", () => {
  const f = fixture(), one = offered(f), foreign = offered(f, "foreign")
  assert.equal(f.manager.cancel(one.session_id).ok, true); assert.equal(one.state, "closed"); assert.equal(foreign.state, "offered")
  assert.equal(f.manager.executionClaims.size, 0); offered(f); zero(f)
})
for (const access of ["get", "list", "propose", "start-admission"] as const) test(`#722 lazy ${access} retires only expired offers at15min with owner-bound closed feedback`, () => {
  const f = fixture(), row = offered(f); f.advance(900_000)
  if (access === "get") f.manager.getSession(row.session_id)
  if (access === "list") f.manager.listSessionsForThread("owner")
  if (access === "propose") f.propose()
  if (access === "start-admission") f.manager.checkStartAdmission(row.session_id)
  assert.equal(f.manager.sessions.has(row.session_id), false)
  const event = f.manager.events.find((e: any) => e.session.session_id === row.session_id && e.session.error === "expired")
  assert.ok(event); assert.equal(event.session.thread_id, "owner"); assert.equal(event.session.state, "closed"); assert.equal(f.manager.executionClaims.size, 0); zero(f)
})
test("#722 offer remains actionable immediately before the exact expiry boundary", () => {
  const f = fixture(), row = offered(f); f.advance(899_999)
  assert.equal(f.manager.getSession(row.session_id), row); assert.equal(row.state, "offered"); zero(f)
})
for (const state of ["confirmed", "running", "handback"] as const) test(`#722 expiry never retires ${state} or frees its existing execution slot`, () => {
  const f = fixture(), row = offered(f); row.state = state; f.manager.executionClaims.set(row,{children:new Set(),ending:false}); f.advance(900_001)
  assert.equal(f.manager.getSession(row.session_id), row); assert.equal(row.state, state); assert.equal(f.manager.executionClaims.size, 1); zero(f)
})
for (const resource of ["startupPreparations", "processes", "protocolHandles"] as const) test(`#722 anomalous offered row with ${resource} remains protected from retirement`, () => {
  const f = fixture(), row = offered(f); f.manager[resource].set(row.session_id, {}); f.advance(900_001)
  assert.equal(f.manager.getSession(row.session_id), row); assert.equal(row.state, "offered"); zero(f)
})
for (const badTime of ["invalid", "future", "clock", "array", "number", "null"] as const) test(`#722 unknown ${badTime} cannot expand proposal capacity`, () => {
  const f = fixture(), row = offered(f)
  if (badTime === "invalid") row.created_at = "NOT_A_TIME"
  if (badTime === "future") row.created_at = new Date(9_000_000).toISOString()
  if (badTime === "clock") f.clock(Number.NaN)
  if (badTime === "array") row.created_at = [row.created_at]
  if (badTime === "number") row.created_at = 1000000
  if (badTime === "null") row.created_at = null
  const refusal = f.propose("another-owner"); assert.equal(refusal.ok, false); assert.equal(f.manager.sessions.has(row.session_id), true); zero(f)
})
test("#722 running claim preserves admission independently of a different-agent proposal and final start admission still refuses", () => {
  const f = fixture(), running = offered(f); running.state = "running"; f.manager.executionClaims.set(running,{children:new Set(),ending:false})
  const next = offered(f, "owner", "another-agent"), check = f.manager.checkStartAdmission(next.session_id)
  assert.equal(check.ok, false); assert.equal(check.error_code, "ACP_CONCURRENCY_LIMIT"); assert.equal(check.data.holder_session_id, running.session_id)
  assert.equal(next.state, "offered"); assert.equal(f.manager.executionClaims.size, 1); zero(f)
})
test("#739 bounded configuration preserves default1 and rejects invalid explicit capacity", () => {
  const types = compile(source("acp/types.ts").text)
  assert.equal(types.DEFAULT_ACP_CONFIG.enabled, false); assert.equal(types.DEFAULT_ACP_CONFIG.max_concurrent_sessions, 1)
  assert.equal(types.sanitizeAcpConfig({ enabled: true }).max_concurrent_sessions, 1)
  for (const max of [1, 2, 3, 4]) assert.equal(types.sanitizeAcpConfig({ enabled: true, max_concurrent_sessions: max }).max_concurrent_sessions, max)
  for (const max of [undefined, -1, 0, 5, Number.NaN, "2", null]) assert.throws(() => types.sanitizeAcpConfig({ enabled: true, max_concurrent_sessions: max }))
})

test("#722 actual existing WS validation admits selected session ID without accepting malformed IDs or weakening legacy goal", () => {
  const file = source("ws/validate.ts"), rows: ts.PropertyAssignment[] = []
  function walk(n: ts.Node) { if (ts.isPropertyAssignment(n) && n.name.getText(file) === '"acp.ui_start"') rows.push(n); ts.forEachChild(n, walk) } walk(file)
  assert.equal(rows.length, 1)
  const validate = compile(`export const validate = ${rows[0].initializer.getText(file)}`).validate
  assert.equal(validate({ thread_id: "owner", session_id: "offered-id" }).valid, true)
  for (const session_id of ["", "x".repeat(101), 5, null, []]) assert.equal(validate({ thread_id: "owner", session_id }).valid, false)
  assert.equal(validate({ thread_id: "owner", agent_id: "inert", goal: "synthetic task" }).valid, true)
  assert.equal(validate({ thread_id: "owner", agent_id: "inert", goal: " " }).valid, false)
  assert.equal(validate({ session_id: "offered-id" }).valid, false)
})

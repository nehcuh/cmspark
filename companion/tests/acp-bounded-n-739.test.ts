/** #739 actual manager/config code, with explicit inert process/FS/clock seams.
 * No native child, configured CLI, provider or real config is evaluated. */
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import vm from "node:vm"
import { EventEmitter } from "node:events"
import { PassThrough } from "node:stream"
import ts from "typescript"

const root = path.resolve(__dirname, "../../src")
const source = (file: string) => fs.readFileSync(path.join(root, file), "utf8")
const options = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX }
function functions(file: string, names: string[]) {
  const sf = ts.createSourceFile(file, source(file), ts.ScriptTarget.ES2022, true)
  return names.map(name => { const matches = sf.statements.filter(n => ts.isFunctionDeclaration(n) && n.name?.text === name); assert.equal(matches.length, 1); return matches[0].getText(sf) }).join("\n")
}
function evaluate(code: string, globals: Record<string, unknown> = {}) {
  const exports: any = {}
  vm.runInNewContext(ts.transpileModule(code, { compilerOptions: options }).outputText, { exports, ...globals }, { timeout: 2000 })
  return exports
}

function configFixture() {
  const types = evaluate(source("acp/types.ts")), writes: any[] = [], events: any[] = []
  let current: any = { llm: {}, acp: types.sanitizeAcpConfig({ enabled: true, servers: { A: { enabled: true, command: "INERT" } } }) }
  const save = evaluate(`let cachedConfig, cachedConfigMtimeMs;\n${functions("config.ts", ["saveConfig", "deepMerge", "stripCompanionUiProcessContinueDeny"])}`, {
    getConfig: () => current, PROTOTYPE_POLLUTION_KEYS: new Set(["__proto__", "constructor", "prototype"]), require: (n: string) => { assert.equal(n, "./acp/types"); return types },
    getEnvApiKey: () => undefined, resolveApiKey: () => undefined, path, getConfigDir: () => "/inert/config", console: { warn() {} },
    atomicWriteJSON: (p: string, value: any) => { assert.equal(p, "/inert/config/config.json"); writes.push(value) }, configFileMtimeMs: () => 1,
    configEvents: { emit: (_: string, value: any) => { current = value; events.push(value) } }, CONFIG_CHANGE_EVENT: "inert-config",
  }).saveConfig
  const handler = evaluate(functions("message-router/handlers/config.ts", ["handleConfigFamily", "hasPrototypePollutionKey", "sanitizeConfig"]), {
    getConfig: () => current, saveConfig: save, validateAcpConcurrencyLimit: types.validateAcpConcurrencyLimit,
    PROTOTYPE_POLLUTION_KEYS: new Set(["__proto__", "constructor", "prototype"]), redactConfigForWire: (v: any) => v, isMaskedApiKey: () => false,
  }).handleConfigFamily
  return { save, handler, writes, events, current: () => current }
}

test("#739 real saveConfig/handler persist explicit N and preserve servers; invalid updates perform zero writes/events", async () => {
  const h = configFixture()
  for (const n of [2, 4, 1]) { const result = await h.handler("config.set", { config: { acp: { max_concurrent_sessions: n, servers: { injected: {} }, policy: {} } } }); assert.equal(result.type, "config.updated"); assert.equal(h.current().acp.max_concurrent_sessions, n); assert.deepEqual(Object.keys(h.current().acp.servers), ["A"]) }
  const before = JSON.stringify(h.current()), count = h.writes.length
  for (const n of [undefined, null, "2", true, [], {}, NaN, Infinity, 0, 5, 1.5]) {
    assert.throws(() => h.save({ acp: { max_concurrent_sessions: n } }))
    assert.equal((await h.handler("config.set", { config: { acp: { max_concurrent_sessions: n } } })).type, "error")
    assert.equal(h.writes.length, count); assert.equal(h.events.length, count); assert.equal(JSON.stringify(h.current()), before)
  }
})

test("#739 actual Settings capacity selector sends only explicit numeric1..4 and performs no start/terminal action", () => {
  const filename = path.resolve(root, "../../chrome-extension/src/sidepanel/components/CodingHandoffSettingsSection.tsx")
  const jsx = (type: unknown, props: unknown) => ({ type, props }), requests: number[] = []
  const component = evaluate(fs.readFileSync(filename, "utf8"), { require: (name: string) => {
    if (name === "react/jsx-runtime") return { jsx, jsxs: jsx }
    if (name === "react") return { useState: (v: unknown) => [v, () => {}] }
    if (name === "../ui/tokens") return { tokens: { colors: {}, spacing: {}, radius: {}, typography: {} } }
    if (name === "../ui/SectionHeader") return { SectionHeader: "inert-header" }
    if (name === "../coding-handoff/copy") return { codingHandoffCopy: {} }
    throw Error("UNADMITTED_SETTINGS_IMPORT")
  } }).CodingHandoffSettingsSection
  const tree = component({ maxConcurrentSessions: 2, onChangeMaxConcurrentSessions: (n: number) => requests.push(n) })
  const matches: any[] = []
  function walk(node: any) { if (!node || typeof node !== "object") return; if (Array.isArray(node)) return node.forEach(walk); if (node.props?.["aria-label"] === "编程接力并发上限") matches.push(node); walk(node.props?.children) }
  walk(tree); assert.equal(matches.length, 1); const select = matches[0]
  assert.equal(select.props.value, 2)
  for (const value of ["1", "2", "3", "4", "0", "5", "unknown"]) select.props.onChange({ target: { value } })
  assert.deepEqual(requests, [1, 2, 3, 4])
})
function fixture(n = 1, platform = "linux") {
  const config: any = { acp: { enabled: true, max_concurrent_sessions: n, servers: {} }, coding_handoff: { open_local_terminal: false } }
  for (const id of ["A", "B", "C", "D", "E"]) config.acp.servers[id] = { enabled: true, command: "INERT", protocol: "cli", policy: { profile: "review_readonly", session_timeout_ms: 5000 } }
  const children: any[] = [], killed: any[] = [], writes = new Map(), events: any[] = [], timers = new Map(), prepares: Array<{ resolve: () => void; reject: (e: Error) => void; signal: AbortSignal }> = []
  let pid = 100, tick = 0, prepare = false, spawnFailure = false, probe: any = async () => null
  const deny = () => { throw Error("UNADMITTED_INERT_IMPORT_OR_EFFECT") }
  let sawSpawn!: () => void
  const spawned = new Promise<void>(resolve => { sawSpawn = resolve })
  const child = () => Object.assign(new EventEmitter(), { pid: ++pid, exitCode: null, signalCode: null, stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough() })
  const imports: Record<string, any> = {
    "./win-spawn": { spawnAcpChild() { if (spawnFailure) throw Error("INERT_SPAWN_FAILURE"); const c = child(); children.push(c); sawSpawn(); return c }, killAcpChild(c: any) { killed.push(c) }, closeAcpChild: async (c: any) => { c.emit("close", 0) } },
    fs: { writeFileSync: (p: string, v: string) => writes.set(p, v), unlinkSync: (p: string) => writes.delete(p) }, os: { tmpdir: () => "/inert" }, path,
    "../config": { getConfig: () => config }, "../logger": { logger: { info() {}, warn() {} } },
    "./workspace-bind": { resolveAcpWorkspaceRoot: () => ({ ok: true, root: "/inert/workspace" }) },
    "./handback": { frameAcpHandback: () => "inert handback" }, "./taint": { markAcpHandbackSeen() {} }, "./discover": { discoverCodingAgents: () => [] },
    "./launch-presets": { resolveLaunchArgs: () => [], resolveProtocolArgs: () => [] }, "./diff-apply": {}, "./handback-format": { shapeHandbackBody: () => "inert body" },
    "./protocol-session": { tryStartProtocolSession: (opts: any) => probe(opts) }, "./timeline": { timelineItem: (kind: string, label: string) => ({ kind, label }), capTimeline: (x: any) => x },
    "./open-local-terminal": { openLocalTerminalForAgent: deny }, "./progress-caps": { PROGRESS_TAIL_CLI_CHARS: 12000, PROGRESS_TAIL_ACP_CHARS: 12000 },
    "./agent-env": { buildAcpAgentEnv: () => ({}) }, "../pty/session": { onPtyAgentSpawned: () => () => {} },
    "../process/windows-job": { prepareWindowsJob: (signal: AbortSignal) => prepare ? new Promise<void>((resolve, reject) => prepares.push({ resolve, reject, signal })) : Promise.resolve() },
    "./manual-entry": { captureManualEntryLaunch: () => ({}) }, "./ui-progress": { boundCodingProgress: (e: any) => e },
  }
  const Actual = evaluate(source("acp/manager.ts"), { require: (name: string) => { assert.ok(Object.hasOwn(imports, name), name); return imports[name] },
    process: { platform }, Buffer, AbortController, Date, setTimeout: (fn: any) => { timers.set(++tick, fn); return tick }, clearTimeout: (id: number) => timers.delete(id) }).AcpManager
  const manager = new Actual(); manager.onEvent((e: any) => events.push(e))
  const handlers = () => evaluate(source("acp/handlers.ts"), { require(name: string) {
    if (name === "fs") return imports.fs
    if (name === "../config") return imports["../config"]
    if (name === "../logger") return imports["../logger"]
    if (name === "./manager") return { getAcpManager: () => manager }
    if (name === "./discover") return { discoverCodingAgents: () => [] }
    if (name === "./confirm-copy") return { formatAcpStartConfirmCode: () => "INERT_CONFIRM", formatAcpApplyConfirmCode: () => "INERT_CONFIRM" }
    if (name === "./git-status") return { getWorkspaceGitStatus: deny }
    throw Error("UNADMITTED_HANDLER_IMPORT")
  } }).handleAcpWsMessage
  const offer = (agentId = "A", threadId = "owner") => { const result = manager.propose({ agentId, threadId, goal: "inert", workspaceRoot: "/inert/workspace" }); assert.equal(result.ok, true, JSON.stringify(result)); return result.session }
  const close = (c: any, code = 0) => { c.exitCode = code; c.emit("close", code) }
  return { config, manager, children, killed, handlers, events, prepares, writes, offer, close, child, spawned, prepare() { prepare = true }, failSpawn() { spawnFailure = true }, protocol(fn: any) { probe = fn } }
}

test("#739 actual handler follows two distinct parent objects and echoes each stored parent without changing L2", async () => {
  const f = fixture(2), a = f.offer("A"), b = f.offer("B"), handle = f.handlers(), confirmations: any[] = []
  a.state = "closed"; b.state = "closed"
  const ctx = { threadId: "owner", getAgentRole: () => undefined, requestConfirmation: async (details: any) => { confirmations.push(details); return { approved: true } } }
  const replies = await Promise.all([a, b].map(s => handle("acp.session.followup", { session_id: s.session_id, thread_id: "owner", goal: "inert followup" }, ctx)))
  assert.equal(confirmations.length, 2)
  assert.ok(confirmations.every(c => c.toolName === "acp_start_session" && c.autoConfirmEligible === false && c.criticalApis[0] === "acp_start_session"))
  assert.equal(replies[0].parent_session_id, a.session_id); assert.equal(replies[1].parent_session_id, b.session_id)
  assert.notEqual(replies[0].session_id, replies[1].session_id)
  assert.equal(f.children.length, 2)
  f.manager.cancel(replies[0].session_id)
  assert.ok(f.killed.every(c => c === f.children[0])); assert.equal(f.children[1].exitCode, null)
  for (const c of f.children) f.close(c)
})

test("#739 two actual handler confirmations preflight freely but final synchronous claim enforces N1", async () => {
  const f = fixture(1), a = f.offer("A", "one"), b = f.offer("B", "two"), handle = f.handlers(), approvals: Array<(x: any) => void> = []
  const ask = (s: any) => handle("acp.ui_start", { session_id: s.session_id, thread_id: s.thread_id, cloud_disclosure_accepted: true }, { threadId: s.thread_id, requestConfirmation: () => new Promise(resolve => approvals.push(resolve)) })
  const pa = ask(a), pb = ask(b)
  assert.equal(approvals.length, 2); assert.equal(f.children.length, 0)
  approvals.forEach(resolve => resolve({ approved: true }))
  const replies = await Promise.all([pa, pb])
  assert.equal(replies.filter(r => r.type === "acp.ui_start.accepted").length, 1)
  assert.equal(replies.filter(r => r.error_code === "ACP_CONCURRENCY_LIMIT").length, 1)
  assert.equal(f.children.length, 1); f.close(f.children[0])
})

test("#739 actual config preserves legal N1..4 and rejects nonnumeric/nonfinite/out-of-range explicit values", () => {
  const types = evaluate(source("acp/types.ts"))
  assert.equal(types.sanitizeAcpConfig({ enabled: true }).max_concurrent_sessions, 1)
  for (const n of [1, 2, 3, 4]) assert.equal(types.sanitizeAcpConfig({ enabled: true, max_concurrent_sessions: n }).max_concurrent_sessions, n)
  for (const n of [undefined, null, "2", true, [], {}, NaN, Infinity, 0, 5, 1.5]) assert.throws(() => types.sanitizeAcpConfig({ max_concurrent_sessions: n }))
})

for (const n of [1, 2, 4]) test(`#739 actual manager admits exactly N=${n} distinct-agent owned CLI children`, async () => {
  const f = fixture(n), rows = ["A", "B", "C", "D", "E"].map(id => f.offer(id, id)), pending: Promise<any>[] = []
  for (let i = 0; i < n; i++) pending.push(f.manager.start(rows[i].session_id))
  assert.equal(f.children.length, n)
  assert.equal((await f.manager.start(rows[n].session_id)).ok, false)
  for (const c of f.children) f.close(c)
  assert.ok((await Promise.all(pending)).every(r => r.ok))
  assert.equal(f.manager.checkStartAdmission(rows[n].session_id).ok, true)
})

test("#739 same agent across threads remains single even when a different agent has free capacity", async () => {
  const f = fixture(4), a = f.offer("A", "one"), b = f.offer("A", "two"), c = f.offer("B", "two"), pending = f.manager.start(a.session_id)
  assert.equal(f.manager.checkStartAdmission(b.session_id).ok, false)
  assert.equal(f.manager.checkStartAdmission(c.session_id).ok, true)
  f.close(f.children[0]); await pending
})

test("#739 Windows preparation synchronously reserves capacity; cancel does not release before preparation settles", async () => {
  const f = fixture(2, "win32"); f.prepare()
  const a = f.offer("A"), b = f.offer("B"), c = f.offer("C"), pa = f.manager.start(a.session_id), pb = f.manager.start(b.session_id)
  assert.equal(f.prepares.length, 2); assert.equal(f.manager.checkStartAdmission(c.session_id).ok, false)
  assert.equal(a.execution_phase, "preparing")
  f.manager.cancel(a.session_id)
  assert.equal(f.prepares[0].signal.aborted, true)
  assert.equal(f.manager.checkStartAdmission(c.session_id).ok, false)
  f.prepares[0].reject(Error("INERT_PREPARE_CANCEL")); await pa
  assert.equal(a.execution_phase, "released"); assert.equal(f.manager.checkStartAdmission(c.session_id).ok, true)
  f.manager.cancel(b.session_id); f.prepares[1].resolve(); await pb
})

test("#739 live error/cancel retains its own claim; duplicate old close cannot release a sibling", async () => {
  const f = fixture(2), a = f.offer("A"), b = f.offer("B"), c = f.offer("C"), pa = f.manager.start(a.session_id), pb = f.manager.start(b.session_id)
  f.children[0].stdout.emit("error", Error("INERT_PIPE")); assert.equal((await pa).ok, false)
  assert.equal(a.execution_phase, "closing"); assert.equal(f.manager.hasProjectThreadActivity("owner"), true)
  assert.equal(f.manager.checkStartAdmission(c.session_id).ok, false)
  f.close(f.children[0], 1); assert.equal(a.execution_phase, "released")
  const pc = f.manager.start(c.session_id); f.close(f.children[0], 1)
  assert.equal(f.manager.checkStartAdmission(f.offer("D", "foreign").session_id).ok, false)
  f.close(f.children[1]); f.close(f.children[2]); await Promise.all([pb, pc])
})

test("#739 PID-bearing exitCode before stdio close cannot release capacity; missing-PID spawn failure can", async () => {
  const f = fixture(1), a = f.offer("A"), b = f.offer("B"), pending = f.manager.start(a.session_id)
  f.children[0].exitCode = 1
  f.children[0].stdout.emit("error", Error("INERT_EXIT_BEFORE_STDIO_CLOSE"))
  assert.equal((await pending).ok, false)
  assert.equal(f.manager.checkStartAdmission(b.session_id).ok, false)
  f.close(f.children[0], 1)
  assert.equal(f.manager.checkStartAdmission(b.session_id).ok, true)
  const g = fixture(1), c = g.offer("A"), d = g.offer("B"), failed = g.manager.start(c.session_id)
  g.children[0].pid = undefined
  g.children[0].emit("error", Error("INERT_NO_PID_SPAWN_FAILURE"))
  assert.equal((await failed).ok, false)
  assert.equal(g.manager.checkStartAdmission(d.session_id).ok, true)
  g.close(g.children[0], 1)
  assert.equal(g.manager.checkStartAdmission(d.session_id).ok, true)
})

test("#739 execution phase requires owned spawn; late spawn cannot revive a closed claim", async () => {
  const f = fixture(2), a = f.offer("A"), pending = f.manager.start(a.session_id)
  assert.equal(a.execution_phase, "preparing")
  f.children[0].emit("spawn"); assert.equal(a.execution_phase, "running")
  f.manager.cancel(a.session_id); assert.equal(a.execution_phase, "closing")
  f.close(f.children[0], 1); await pending
  f.children[0].emit("spawn"); assert.equal(a.execution_phase, "released")
  const g = fixture(1), b = g.offer("A"), failed = g.manager.start(b.session_id)
  g.children[0].pid = undefined; g.children[0].emit("error", Error("INERT_FAILED_SPAWN"))
  assert.equal((await failed).ok, false); assert.equal(b.execution_phase, "released")
  assert.equal(g.events.some(e => e.execution_phase === "running"), false)
})

test("#739 synchronous starting observer cancel retires only its no-child claim, never spawns", async () => {
  const f = fixture(2), a = f.offer("A"), b = f.offer("B")
  f.manager.onEvent((e: any) => { if (e.session_id === a.session_id && e.state === "running" && e.progress_tail === "starting…") f.manager.cancel(a.session_id) })
  assert.equal((await f.manager.start(a.session_id)).ok, false)
  assert.equal(a.execution_phase, "released"); assert.equal(f.children.length, 0)
  assert.equal(f.manager.checkStartAdmission(b.session_id).ok, true)
})

test("#739 failed prepare and synchronous spawn failure release only that object's claim", async () => {
  const f = fixture(2, "win32"); f.prepare()
  const a = f.offer("A"), b = f.offer("B"), pa = f.manager.start(a.session_id), pb = f.manager.start(b.session_id)
  f.prepares[0].reject(Error("INERT_PREPARE_FAILURE")); assert.equal((await pa).ok, false)
  assert.equal(a.execution_phase, "released"); assert.equal(b.execution_phase, "preparing")
  f.failSpawn(); f.prepares[1].resolve(); assert.equal((await pb).ok, false)
  assert.equal(b.execution_phase, "released"); assert.equal(f.children.length, 0)
  assert.equal(f.manager.checkStartAdmission(f.offer("C").session_id).ok, true)
})

test("#739 reduction4→1 preserves live claims, refuses until zero, never auto-starts offers", async () => {
  const f = fixture(4), active = ["A", "B", "C", "D"].map(id => f.offer(id, id)), pending = active.map(s => f.manager.start(s.session_id)), next = f.offer("E", "next")
  f.config.acp.max_concurrent_sessions = 1
  for (const c of f.children) { assert.equal(f.manager.checkStartAdmission(next.session_id).ok, false); f.close(c) }
  await Promise.all(pending); assert.equal(f.manager.checkStartAdmission(next.session_id).ok, true); assert.equal(f.children.length, 4)
})

test("#739 N>1 rejects immutable ModeC true/unknown and existing incompatible claim; N1 retains original ModeC admission", async () => {
  const f = fixture(2), a = f.offer("A")
  for (const value of [true, undefined]) { a.open_local_terminal_snapshot = value; assert.equal(f.manager.checkStartAdmission(a.session_id).ok, false) }
  a.open_local_terminal_snapshot = false; f.config.acp.max_concurrent_sessions = 1
  const pending = f.manager.start(a.session_id), b = f.offer("B")
  a.open_local_terminal_snapshot = true; f.config.acp.max_concurrent_sessions = 2
  assert.equal(f.manager.checkStartAdmission(b.session_id).ok, false)
  f.close(f.children[0]); await pending
  b.open_local_terminal_snapshot = true; f.config.acp.max_concurrent_sessions = 1
  assert.equal(f.manager.checkStartAdmission(b.session_id).ok, true)
})

test("#739 metadata pair dedupe and nonterminal4/thread16/install do not evict legacy overages", () => {
  const f = fixture(4), a = f.offer("A"), duplicate = f.manager.propose({ threadId: "owner", agentId: "A", goal: "inert" })
  assert.equal(duplicate.ok, false)
  for (const id of ["B", "C", "D"]) f.offer(id)
  assert.equal(f.manager.propose({ threadId: "owner", agentId: "E", goal: "inert" }).ok, false)
  for (let i = 0; i < 12; i++) f.offer("A", `other-${i}`)
  assert.equal(f.manager.propose({ threadId: "fresh", agentId: "A", goal: "inert" }).ok, false)
  assert.equal(f.manager.listSessionsForThread("owner").length, 4); assert.equal(a.state, "offered")
})

test("#739 probe close→CLI fallback retains one logical claim without exposing a free admission window", async () => {
  const f = fixture(2), a = f.offer("A"), b = f.offer("A", "other")
  f.config.acp.servers.A.protocol = "auto"
  f.protocol(async (opts: any) => { const probe = f.child(); opts.hooks.onSpawn(probe); probe.emit("spawn"); probe.emit("close", 1); assert.equal(f.manager.checkStartAdmission(b.session_id).ok, false); return null })
  const pending = f.manager.start(a.session_id); await Promise.race([f.spawned, pending.then((r: any) => { throw Error(JSON.stringify(r)) })])
  assert.equal(f.children.length, 1); assert.equal(f.manager.checkStartAdmission(b.session_id).ok, false)
  assert.equal(a.execution_phase, "preparing", "fallback retains its claim but must await its own real CLI spawn")
  f.children[0].emit("spawn"); assert.equal(a.execution_phase, "running")
  f.close(f.children[0]); await pending
  assert.equal(f.manager.checkStartAdmission(b.session_id).ok, true)
})

// Owned author probe also preserves the exact finite reply shapes used by UI correlation.
test("#739 actual followup failure retains its actual child identity rather than guessing a parent", async () => {
  const f = fixture(1), a = f.offer("A"), b = f.offer("B"), handle = f.handlers()
  a.state = "closed"; b.state = "closed"
  const ctx = { threadId: "owner", requestConfirmation: async () => ({ approved: true }) }
  const first = await handle("acp.session.followup", { session_id: a.session_id, thread_id: "owner", goal: "inert" }, ctx)
  const second = await handle("acp.session.followup", { session_id: b.session_id, thread_id: "owner", goal: "inert" }, ctx)
  assert.equal(first.type, "acp.ui_start.accepted")
  assert.equal(second.error_code, "ACP_CONCURRENCY_LIMIT")
  assert.notEqual(second.session_id, b.session_id)
  assert.equal(f.manager.getSession(second.session_id).parent_session_id, b.session_id)
  assert.equal(second.parent_session_id, b.session_id, "actual preflight refusal must retain its server-owned parent correlation")
  for (const c of f.children) f.close(c)
})


test("#739 actual outer handler never echoes a foreign/replaced/result-mismatched parent", async () => {
  const text = functions("acp/handlers.ts", ["handleAcpWsMessage"])
  for (const variant of ["valid", "wrong-owner", "replaced-parent", "wrong-thread", "wrong-parent", "unknown-result"]) {
    const parent: any = { session_id: "P", thread_id: "owner" }, child: any = { session_id: "C", thread_id: "owner", parent_session_id: "P" }
    const rows = new Map<string, any>([["P", parent], ["C", child]])
    let calls = 0
    const handle = evaluate(text, { getAcpManager: () => ({ getSession: (id: string) => rows.get(id) }),
      handleAcpWsMessageInternal: async () => {
        calls++
        if (variant === "replaced-parent") rows.set("P", { ...parent })
        if (variant === "wrong-thread") child.thread_id = "foreign"
        if (variant === "wrong-parent") child.parent_session_id = "foreign-parent"
        if (variant === "unknown-result") rows.delete("C")
        return { type: "acp.ui_start.accepted", session_id: "C", parent_session_id: "SPOOFED_MESSAGE_PARENT" }
      },
    }).handleAcpWsMessage
    const reply = await handle("acp.session.followup", { session_id: "P", thread_id: variant === "wrong-owner" ? "foreign" : "owner" }, { threadId: "owner" })
    assert.equal(calls, variant === "wrong-owner" ? 0 : 1)
    assert.equal(reply.parent_session_id, variant === "valid" ? "P" : undefined, variant)
  }
})

test("#739 actual tool L2 capacity preview and dispatch enforce owner/role/token before real manager start", async () => {
  const sf = ts.createSourceFile("l2", source("tool/l2-admission.ts"), ts.ScriptTarget.ES2022, true)
  const fn = sf.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === "runL2ToolAdmission") as ts.FunctionDeclaration
  assert.equal(ts.isIfStatement(fn.body!.statements[0]), true, "actual start capacity preview must precede L2 effects")
  const preview = fn.body!.statements[0].getText(sf)
  const ds = ts.createSourceFile("dispatch", source("tool/companion-dispatch.ts"), ts.ScriptTarget.ES2022, true)
  let clause: ts.CaseClause | undefined
  const visit = (n: ts.Node) => { if (ts.isCaseClause(n) && n.expression.getText(ds) === '\"acp_start_session\"') clause = n; ts.forEachChild(n, visit) }; visit(ds)
  if (!clause) throw Error("actual dispatch clause missing")
  const f = fixture(1), a = f.offer("A"), b = f.offer("B"), pending = f.manager.start(a.session_id)
  let role: string | undefined, token = true, starts = 0
  const mgr = { getSession: (id: string) => f.manager.getSession(id), checkStartAdmission: (id: string) => f.manager.checkStartAdmission(id), start: async (id: string) => { starts++; return f.manager.start(id) } }
  const imports = (name: string) => { assert.equal(name, "../acp"); return { getAcpManager: () => mgr } }
  const pre = evaluate(`export async function run(ctx){${preview};return {ok:true}}`, { resolveAcpThreadId: (p: any, tid: any) => p.__thread_id || tid, require: imports }).run
  const dispatch = evaluate(`export async function run(params){switch("acp_start_session"){${clause.getText(ds)}}}`, {
    securityPolicy: { validateTokenFor: () => token }, threadManager: { get: () => ({ agent_role: role }) }, require: imports,
    invalidSecurityTokenResult: () => ({ success: false, error_code: "SECURITY_TOKEN_INVALID" }),
    acpSessionLookupFailure: () => ({ success: false, error: "lookup" }),
  }).run
  const ctx = (tid = "owner") => ({ toolName: "acp_start_session", finalParams: { session_id: b.session_id, __thread_id: tid }, actingThreadId: tid, getThreadManager: () => ({ get: () => ({ agent_role: role }) }) })
  assert.equal((await pre(ctx())).result.error_code, "ACP_CONCURRENCY_LIMIT")
  assert.equal((await pre(ctx("foreign"))).result.error_code, "ACP_OWNER_MISMATCH")
  for (role of ["worker", "orchestrator"]) assert.match((await pre(ctx())).result.error, /cannot start/)
  role = undefined
  assert.equal((await dispatch({ session_id: b.session_id, __thread_id: "owner" })).success, false)
  token = false; assert.equal((await dispatch({ session_id: b.session_id, __thread_id: "owner", security_token: "INERT" })).error_code, "SECURITY_TOKEN_INVALID")
  token = true; assert.equal((await dispatch({ session_id: b.session_id, __thread_id: "foreign", security_token: "INERT" })).error_code, "ACP_OWNER_MISMATCH")
  role = "worker"; assert.match((await dispatch({ session_id: b.session_id, __thread_id: "owner", security_token: "INERT" })).error, /cannot start/); role = undefined
  assert.equal(starts, 0)
  const refused = await dispatch({ session_id: b.session_id, __thread_id: "owner", security_token: "INERT" })
  assert.equal(refused.error_code, "ACP_CONCURRENCY_LIMIT"); assert.equal(starts, 1)
  assert.deepEqual(JSON.parse(JSON.stringify(refused.data)), { holder_session_id: a.session_id, holder_agent: "A", holder_state: "running", suggested_action: "wait_for_acp_capacity", data_not_instruction: true })
  const foreign = f.offer("C", "other")
  const foreignRefused = await dispatch({ session_id: foreign.session_id, __thread_id: "other", security_token: "INERT" })
  assert.deepEqual(JSON.parse(JSON.stringify(foreignRefused.data)), { suggested_action: "wait_for_acp_capacity", data_not_instruction: true })
  f.close(f.children[0]); await pending
  assert.equal((await pre(ctx())).ok, true)
})


test("#739 an unproven PID-less probe error retains its actual child and cancellation path until close", async () => {
  const f = fixture(1), a = f.offer("A"), b = f.offer("B")
  f.config.acp.servers.A.protocol = "auto"
  const probe = f.child(); (probe as any).pid = undefined
  f.protocol(async (opts: any) => { opts.hooks.onSpawn(probe); throw Error("INERT_UNPROVEN_PROBE_TEARDOWN") })
  assert.equal((await f.manager.start(a.session_id)).ok, false)
  assert.equal(a.execution_phase, "closing"); assert.equal(f.manager.checkStartAdmission(b.session_id).ok, false)
  f.manager.cancel(a.session_id)
  assert.equal(f.killed.includes(probe), true, "missing PID alone cannot remove the owned child from exact cancellation lookup")
  f.close(probe, 1)
  assert.equal(a.execution_phase, "released"); assert.equal(f.manager.checkStartAdmission(b.session_id).ok, true)
})

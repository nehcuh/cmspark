/** Actual merged manager in a deny-by-default VM. No config, provider, process,
 * terminal, native module, filesystem write or real timer is admitted. */
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import vm from "node:vm"
import { EventEmitter, getEventListeners } from "node:events"
import { PassThrough } from "node:stream"
import ts from "typescript"

const source = fs.readFileSync(path.resolve(__dirname, "../../src/acp/manager.ts"), "utf8")
function fixture(limit = 1, platform = "linux") {
  const config: any = { acp: { enabled: true, max_concurrent_sessions: limit, servers: {} }, coding_handoff: { open_local_terminal: false } }
  for (const id of ["A", "B", "C", "D", "E"]) config.acp.servers[id] = { enabled: true, command: "INERT", protocol: "cli", policy: { profile: "review_readonly" } }
  const children: any[] = [], killed: any[] = [], history: any[] = [], legacy: any[] = [], writes = new Map(), timers = new Map()
  const preparations: Array<{ resolve(): void; signal: AbortSignal }> = []
  let counter = 0, pid = 100, probe: any = async () => null
  const deny = () => { throw Error("UNADMITTED_EFFECT") }
  const child = () => Object.assign(new EventEmitter(), { pid: ++pid, exitCode: null, signalCode: null, stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough() })
  const close = (c: any, code = 0) => { c.exitCode = code; c.emit("close", code) }
  const imports: Record<string, any> = {
    "./win-spawn": { spawnAcpChild() { const c = child(); children.push(c); return c }, killAcpChild(c: any) { killed.push(c) }, closeAcpChild: async (c: any) => close(c) },
    fs: { writeFileSync: (p: string, value: string) => writes.set(p, value), unlinkSync: (p: string) => writes.delete(p) }, os: { tmpdir: () => "/inert" }, path,
    "../config": { getConfig: () => config }, "../logger": { logger: { info() {}, warn() {} } },
    "./workspace-bind": { resolveAcpWorkspaceRoot: () => ({ ok: true, root: "/inert/workspace" }) },
    "./handback": { frameAcpHandback: () => "inert handback" }, "./taint": { markAcpHandbackSeen() {} }, "./discover": { discoverCodingAgents: () => [] },
    "./launch-presets": { resolveLaunchArgs: () => [], resolveProtocolArgs: () => [] }, "./diff-apply": {}, "./handback-format": { shapeHandbackBody: () => "inert body" },
    "./protocol-session": { tryStartProtocolSession: (opts: any) => probe(opts) }, "./timeline": { timelineItem: (kind: string, label: string) => ({ kind, label }), capTimeline: (x: any) => x },
    "./open-local-terminal": { openLocalTerminalForAgent: deny }, "./progress-caps": { PROGRESS_TAIL_CLI_CHARS: 12000, PROGRESS_TAIL_ACP_CHARS: 12000 },
    "./agent-env": { buildAcpAgentEnv: () => ({}) }, "../pty/session": { onPtyAgentSpawned: () => () => {} },
    "../process/windows-job": { prepareWindowsJob: (signal: AbortSignal) => new Promise<void>(resolve => preparations.push({ resolve, signal })) },
    "./manual-entry": { captureManualEntryLaunch: () => ({}) }, "./ui-progress": { boundCodingProgress: (event: any) => event },
  }
  const exports: any = {}
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, {
    exports, require: (name: string) => { assert.ok(Object.hasOwn(imports, name), name); return imports[name] },
    process: { platform }, Buffer, AbortController, AbortSignal, Date,
    setTimeout: (fn: any) => { timers.set(++counter, fn); return counter }, clearTimeout: (id: number) => timers.delete(id),
  }, { timeout: 2000 })
  const manager = new exports.AcpManager({ note: (session: any) => history.push(session.session_id), list: async (_: string, live: any[]) => ({ status: "ok", rows: live }) })
  manager.onEvent((event: any) => legacy.push(event))
  const owner = () => {
    const controller = new AbortController(); let current = true
    const context = { current: () => current, signal: controller.signal, requestPermission: async () => true }
    return { controller, context, stale: () => { current = false } }
  }
  const offer = (agentId: string, context?: ReturnType<typeof owner>["context"], threadId = "owner") => {
    const opts = { agentId, threadId, goal: "owned goal", workspaceRoot: "/inert/workspace" }
    const result = context ? manager.proposeNative(opts, context) : manager.propose(opts)
    assert.equal(result.ok, true, JSON.stringify(result)); return result.session
  }
  return { manager, config, children, killed, history, legacy, preparations, owner, offer, close, child, writes, protocol: (fn: any) => { probe = fn } }
}

test("#705+#739 native and legacy offers reserve no execution; a native cancelled child retains N1 until close", async () => {
  const f = fixture(), owner = f.owner(), native = f.offer("A", owner.context), legacy = f.offer("B")
  assert.equal(f.children.length, 0); assert.equal(f.manager.checkStartAdmission(legacy.session_id).ok, true)
  const run = f.manager.start(native.session_id)
  owner.controller.abort()
  assert.equal(native.execution_phase, "closing")
  assert.equal((await f.manager.start(legacy.session_id)).error_code, "ACP_CONCURRENCY_LIMIT")
  assert.equal(f.children.length, 1); assert.equal(f.manager.hasProjectThreadActivity("owner"), true)
  f.children[0].exitCode = 0 // exit status alone does not prove stdio/owned child close
  assert.equal(f.manager.checkStartAdmission(legacy.session_id).ok, false)
  f.close(f.children[0]); assert.equal((await run).ok, false)
  assert.equal(native.execution_phase, "released"); assert.equal(getEventListeners(owner.controller.signal, "abort").length, 0)
  assert.equal(f.manager.checkStartAdmission(legacy.session_id).ok, true)
})

test("#705+#739 explicit N2 admits distinct agents across native/legacy; same-agent and N overflow stay blocked", async () => {
  const f = fixture(2), owner = f.owner(), a = f.offer("A", owner.context), b = f.offer("B"), c = f.offer("C"), same = f.offer("A", undefined, "other")
  const pa = f.manager.start(a.session_id), pb = f.manager.start(b.session_id)
  assert.equal(f.children.length, 2)
  assert.equal(f.manager.checkStartAdmission(c.session_id).ok, false)
  assert.equal(f.manager.checkStartAdmission(same.session_id).ok, false)
  f.close(f.children[0]); await pa
  assert.equal(f.manager.checkStartAdmission(c.session_id).ok, true)
  f.close(f.children[0]) // duplicate old close cannot release sibling's claim
  assert.equal(f.manager.executionClaims.size, 1)
  f.close(f.children[1]); await pb
})

test("#705+#739 native bridge error settles its request but holds capacity until actual close", async () => {
  const f = fixture(), owner = f.owner(), native = f.offer("A", owner.context), legacy = f.offer("B")
  const pending = f.manager.start(native.session_id), c = f.children[0]
  c.exitCode = 1
  c.stdout.emit("error", Error("INERT_STDIO_FAILURE_BEFORE_CLOSE"))
  assert.equal((await pending).ok, false); assert.equal(native.execution_phase, "closing")
  assert.equal(f.manager.checkStartAdmission(legacy.session_id).ok, false)
  f.close(c, 1); assert.equal(native.execution_phase, "released")
  assert.equal(f.manager.checkStartAdmission(legacy.session_id).ok, true)
})

test("#705+#739 native always snapshots bridge-only while legacy Mode C still prevents parallel execution", async () => {
  const f = fixture(2), owner = f.owner(); f.config.coding_handoff.open_local_terminal = true
  const native = f.offer("A", owner.context), legacy = f.offer("B")
  assert.equal(native.open_local_terminal_snapshot, false); assert.equal(legacy.open_local_terminal_snapshot, true)
  const pending = f.manager.start(native.session_id)
  assert.equal((await f.manager.start(legacy.session_id)).error_code, "ACP_CONCURRENCY_LIMIT")
  f.config.coding_handoff.open_local_terminal = false
  assert.equal(f.manager.checkStartAdmission(legacy.session_id).ok, false)
  assert.equal(legacy.open_local_terminal_snapshot, true); assert.equal(f.children.length, 1)
  f.close(f.children[0]); await pending
})

test("#705+#739 native start refusal retires only that confirmed operation; read-only preflight does not", async () => {
  const f = fixture(), owner = f.owner(), legacy = f.offer("A"), native = f.offer("B", owner.context)
  const pending = f.manager.start(legacy.session_id)
  assert.equal(f.manager.checkStartAdmission(native.session_id).ok, false); assert.equal(native.state, "offered")
  assert.equal((await f.manager.start(native.session_id)).error_code, "ACP_CONCURRENCY_LIMIT")
  assert.equal(native.state, "closed"); assert.equal(f.killed.length, 0)
  assert.equal(getEventListeners(owner.controller.signal, "abort").length, 0)
  assert.equal(f.manager.executionClaims.size, 1); f.close(f.children[0]); await pending
})

test("#705+#722 expiration retains native private lookup and legacy history without retaining abort listeners", async () => {
  const f = fixture(), owner = f.owner(), native = f.offer("A", owner.context), legacy = f.offer("B")
  assert.equal(f.manager.getSession(native.session_id), undefined)
  assert.equal(f.manager.getNativeSession(native.session_id, { ...owner.context }), undefined)
  assert.equal(f.manager.getNativeSession(native.session_id, owner.context), native)
  native.created_at = legacy.created_at = new Date(Date.now() - 16 * 60_000).toISOString()
  assert.equal(f.manager.getNativeSession(native.session_id, owner.context), undefined)
  assert.equal(f.manager.getSession(legacy.session_id), undefined)
  assert.equal(native.state, "closed"); assert.equal(legacy.state, "closed")
  assert.equal(getEventListeners(owner.controller.signal, "abort").length, 0)
  assert.equal(f.history.includes(native.session_id), false); assert.equal(f.history.includes(legacy.session_id), true)
  assert.equal(f.legacy.some(e => e.session_id === native.session_id), false)
  assert.equal((await f.manager.listHistoryForThread("owner")).rows.length, 0)
})

test("#705+#722+#732 private offers consume real capacity but never disclose holder IDs or enter legacy history", async () => {
  const f = fixture(), owner = f.owner(), native = f.offer("A", owner.context), legacy = f.offer("B")
  const privateId = native.session_id
  const pair = f.manager.propose({ agentId: "A", threadId: "owner", goal: "owned", workspaceRoot: "/inert/workspace" })
  assert.equal(pair.error_code, "ACP_SESSION_BUSY"); assert.equal(JSON.stringify(pair).includes(privateId), false)
  const stranger = f.manager.proposeNative({ agentId: "A", threadId: "owner", goal: "owned", workspaceRoot: "/inert/workspace" }, f.owner().context)
  assert.equal(JSON.stringify(stranger).includes(privateId), false)
  const own = f.manager.proposeNative({ agentId: "A", threadId: "owner", goal: "owned", workspaceRoot: "/inert/workspace" }, owner.context)
  assert.equal(own.data.holder_session_id, privateId)
  const pending = f.manager.start(privateId), refusal = f.manager.checkStartAdmission(legacy.session_id)
  assert.equal(refusal.error_code, "ACP_CONCURRENCY_LIMIT"); assert.equal(JSON.stringify(refusal).includes(privateId), false)
  assert.equal(f.history.includes(privateId), false)
  assert.equal((await f.manager.listHistoryForThread("owner")).rows.some((s: any) => s.session_id === privateId), false)
  f.close(f.children[0]); await pending
  assert.equal(f.history.includes(privateId), false); assert.equal(f.history.includes(legacy.session_id), true)
})

test("#705+#739 native stale during synchronous progress releases no-child claim and dispatches nothing", async () => {
  const f = fixture(2), owner = f.owner(), native = f.offer("A", owner.context), legacy = f.offer("B")
  f.manager.onNativeEvent(owner.context, (event: any) => { if (event.state === "running") owner.stale() })
  assert.equal((await f.manager.start(native.session_id)).ok, false)
  assert.equal(native.execution_phase, "released"); assert.equal(f.children.length, 0); assert.equal(f.writes.size, 0)
  assert.equal(f.manager.checkStartAdmission(legacy.session_id).ok, true)
  assert.equal(getEventListeners(owner.controller.signal, "abort").length, 0)
})

test("#705+#739 native Windows preparation retains claim until its promise settles after abort", async () => {
  const f = fixture(1, "win32"), owner = f.owner(), native = f.offer("A", owner.context), legacy = f.offer("B")
  const pending = f.manager.start(native.session_id)
  assert.equal(f.preparations.length, 1); owner.controller.abort()
  assert.equal(f.preparations[0].signal.aborted, true)
  assert.equal(f.manager.checkStartAdmission(legacy.session_id).ok, false)
  f.preparations[0].resolve(); assert.equal((await pending).ok, false)
  assert.equal(native.execution_phase, "released"); assert.equal(f.children.length, 0)
  assert.equal(f.manager.checkStartAdmission(legacy.session_id).ok, true)
})

test("#705+#739 actual protocol onSpawn keeps exact native claim and rejects owner-retired permission/handback", async () => {
  const f = fixture(2), owner = f.owner(), native = f.offer("A", owner.context)
  f.config.acp.servers.A.protocol = "acp"
  let hooks: any, finish!: () => void, approve!: (v: boolean) => void, globalPermissions = 0
  // Re-propose captures callbacks, so the initial context installs its deferred gate first.
  f.manager.cancelNative(native.session_id, owner.context)
  owner.context.requestPermission = () => new Promise<boolean>(r => { approve = r })
  const next = f.offer("A", owner.context)
  f.manager.permissionGate = async () => { globalPermissions++; return true }
  const prompt = new Promise<void>(r => { finish = r }), c = f.child(), saved: any[] = []
  f.protocol(async (opts: any) => { hooks = opts.hooks; hooks.onSpawn(c); return { child: c, prompt: async () => prompt, kill() {}, cancel() {} } })
  f.manager.setHandbackSink((info: any) => saved.push(info))
  const run = f.manager.start(next.session_id)
  const permission = hooks.onPermission({ title: "owned permission" }); owner.stale(); approve(true)
  assert.equal(await permission, "deny"); assert.equal(globalPermissions, 0)
  hooks.onAgentText("late output"); finish(); assert.equal((await run).ok, false)
  assert.equal(saved.length, 0); assert.equal(next.execution_phase, "released")
  assert.equal(f.manager.executionClaims.size, 0)
})

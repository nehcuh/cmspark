// Actual PTY module + terminal handler in closed CPU VMs. No real PTY/env/native.
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import vm from "node:vm"
import ts from "typescript"
function cpuModule(rel: string, globals: Record<string, unknown>) {
  const source = fs.readFileSync(path.resolve(__dirname, "../../src", rel), "utf8"), exports = {}
  const inspect = rel === "pty/session.ts" ? "\nexports.ownedState = () => live;" : ""
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText + inspect, { exports, ...globals }, { timeout: 1000 })
  return exports as any
}
// Newly imported pure production tail/policy helpers stay source-coupled;
// no placeholder consent implementation or weakened existing assertions.
function tailModule() {
  return cpuModule("pty/tail.ts", { Buffer, require(id: string) {
    if (id === "../llm/text-sanitize") return cpuModule("llm/text-sanitize.ts", {})
    throw Error("UNADMITTED_TAIL_IMPORT")
  } })
}
function fixture() {
  const frames: any[] = [], beats: Array<() => void> = []
  let clock = 100, output: ((text: string) => void) | undefined, exit: ((data: unknown) => void) | undefined
  let pauses = 0, resumes = 0, native = 0
  const deny = () => { native++; throw Error("NATIVE_FORBIDDEN") }
  const handle = { pid: 0, write() {}, resize() {}, kill() {}, pause() { pauses++ }, resume() { resumes++ },
    onData(fn: typeof output) { output = fn }, onExit(fn: typeof exit) { exit = fn } }
  const pty = cpuModule("pty/session.ts", { Buffer, Date, performance: { now: () => clock },
    process: { platform: "darwin", env: {}, on() {}, kill: deny },
    setInterval: (fn: () => void) => { beats.push(fn); return { unref() {} } }, clearInterval() {},
    require(id: string) {
      if (id === "./tail") return tailModule()
      if (id === "./windows-tree") return { killWindowsPtyTree: deny }
      if (id === "node:path") return path.posix
      if (id === "../packs/audit-log") return { appendCapabilityAudit() {} }
      if (id === "./load-native") return { loadNodePty: deny }
      if (id === "./env") return { buildTerminalEnv: () => ({}) }
      if (id === "./kimi-task-prefill") return { createKimiTaskPrefill: () => () => false }
      return deny()
    },
  })
  pty.__testSetPtySpawn(() => handle)
  const owner = { readyState: 1 }
  const open = (id = "owned") => pty.spawnPtySession({ id, cwd: "/inert", cols: 80, rows: 24, owner, send: (frame: unknown) => frames.push(frame) })
  const heartbeat = () => { beats.at(-1)!(); return frames.at(-1) }
  return { pty, frames, open, heartbeat, owner, emit: (text: string) => output!(text), age: (ms: number) => { clock += ms }, invalidClock: () => { clock = NaN },
    exit: () => exit!({ exitCode: 0 }), pauses: () => pauses, resumes: () => resumes, noNative: () => assert.equal(native, 0) }
}
test("#724 actual heartbeat distinguishes quiet from emitted output with monotonic age", () => {
  const f = fixture(); assert.equal(f.open().ok, true)
  assert.deepEqual(JSON.parse(JSON.stringify(f.heartbeat().metrics)), { seq: 0, output_bytes: 0, unacked_frames: 0, unacked_bytes: 0, ack_frames: 0, pause_count: 0, paused: false, last_output_age_ms: null })
  f.emit("中文"); f.age(23)
  const metrics = f.heartbeat().metrics
  assert.equal(metrics.seq, 1); assert.equal(metrics.output_bytes, 6); assert.equal(metrics.unacked_bytes, 6); assert.equal(metrics.last_output_age_ms, 23)
  f.pty.ackPty("owned", 1)
  assert.equal(f.heartbeat().metrics.ack_frames, 1); assert.equal(f.heartbeat().metrics.unacked_bytes, 0)
  f.pty.ackPty("owned", 1); assert.equal(f.heartbeat().metrics.ack_frames, 1)
  f.invalidClock(); assert.equal(f.heartbeat().metrics.last_output_age_ms, null)
  f.noNative()
})
test("#724 original chunk/watermark/overflow controls stay actual, metrics do not control them", () => {
  const f = fixture(); f.open(); f.emit("x".repeat(64 * 1024))
  assert.equal(f.frames.filter(frame => frame.type === "terminal.data").length, 4)
  assert.ok(f.frames.filter(frame => frame.type === "terminal.data").every(frame => Buffer.from(frame.b64, "base64").length <= 16 * 1024))
  assert.equal(f.pauses(), 1); assert.equal(f.heartbeat().metrics.pause_count, 1)
  f.pty.ackPty("owned", 4); assert.equal(f.resumes(), 1)
  f.pty.pausePty("owned"); f.pty.pausePty("owned")
  assert.equal(f.heartbeat().metrics.pause_count, 2, "count transitions, not repeated pause requests")
  f.pty.resumePty("owned")
  f.emit("x".repeat(256 * 1024)); f.emit("x")
  assert.equal(f.frames.at(-1).type, "terminal.closed"); assert.equal(f.frames.at(-1).code, "output_overflow")
  f.noNative()
})
test("#724 original owner and single/closing session constraints remain", () => {
  const f = fixture(); f.open()
  assert.equal(f.pty.getOwnedPtyContext("owned", f.owner)?.id, "owned")
  assert.equal(f.pty.getOwnedPtyContext("owned", { readyState: 1 }), null)
  assert.equal(f.open("foreign").error, "terminal_busy")
  f.emit("a"); f.exit(); assert.equal(f.pty.isPtyBusy(), false)
  assert.equal(f.open("later").ok, true)
  assert.equal(f.heartbeat().metrics.seq, 0); assert.equal(f.heartbeat().metrics.last_output_age_ms, null)
  f.noNative()
})
test("#724 diagnostic counters saturate without changing flow and uncertain monotonic age stays null", () => {
  const f = fixture(); f.open()
  // Private state is reachable only in this VM's appended inspector, never in shipping code.
  const state = f.pty.ownedState()
  state.outputBytes = Number.MAX_SAFE_INTEGER - 1
  state.ackFrames = Number.MAX_SAFE_INTEGER
  state.pauseCount = Number.MAX_SAFE_INTEGER
  f.emit("ab"); f.pty.ackPty("owned", 1); f.pty.pausePty("owned")
  const metrics = f.heartbeat().metrics
  assert.equal(metrics.output_bytes, Number.MAX_SAFE_INTEGER)
  assert.equal(metrics.ack_frames, Number.MAX_SAFE_INTEGER); assert.equal(metrics.pause_count, Number.MAX_SAFE_INTEGER)
  assert.equal(metrics.unacked_bytes, 0)
  f.age(-1); assert.equal(f.heartbeat().metrics.last_output_age_ms, null)
  f.noNative()
})
function handlerFixture(kind: "local_shell" | "embedded_agent", surface = "panel", approve = true) {
  let intent: any = kind === "embedded_agent" ? { file: "/inert/agent", args: [], cwd: "/inert" } : null
  let spawns = 0
  const real = fixture(); real.pty.__testSetPtyPlatform("win32")
  const owner = { readyState: 1 }
  const handler = cpuModule("pty/handler.ts", { require(id: string) {
    if (id === "./tail") return tailModule()
    if (id === "../tool/plan-readonly") return cpuModule("tool/plan-readonly.ts", {})
    if (id === "../config") return { getConfig: () => ({ embedded_terminal: { enabled: true } }) }
    if (id === "../code-review/service") return { CodeReviewService: class {} }
    if (id === "../code-review/report") return {}
    if (id === "path") return path.posix
    if (id === "../acp/open-local-terminal") return { peekEmbedIntent: () => intent, takeEmbedIntent: () => { const value = intent; intent = null; return value }, sameEmbedIntent: (a: unknown, b: unknown) => a === b, recordEmbedIntent() {} }
    if (id === "./cwd") return { resolveTerminalStartCwd: () => ({ ok: true, cwd: "/inert" }) }
    if (id === "./session") return { ...real.pty, spawnPtySession: (opts: any) => { spawns++; return real.pty.spawnPtySession(opts) } }
    throw Error("UNADMITTED_HANDLER_IMPORT")
  } })
  return { open: () => handler.handleTerminalMessage("terminal.open", { id: "owned", user_gesture: true, thread_id: "thread", launch_kind: "FORGED", argv: undefined }, { threadManager: { get: () => ({ workspace_root: "/inert" }) } },
    { surface, originWs: owner, sendToExtension() {}, requestConfirmation: async () => ({ approved: approve }) }, surface), spawns: () => spawns }
}
for (const kind of ["local_shell", "embedded_agent"] as const) test(`#724 actual owned handler derives ${kind} only from consumed descriptor`, async () => {
  const f = handlerFixture(kind), opened = await f.open()
  assert.equal(opened.type, "terminal.opened"); assert.equal(opened.launch_kind, kind); assert.equal(f.spawns(), 1)
})
for (const [surface, approve] of [["summoner", true], ["panel", false]] as const) test(`#724 ${surface}/${approve} refusal never emits launch metadata or calls spawn`, async () => {
  const f = handlerFixture("embedded_agent", surface, approve), refused = await f.open()
  assert.notEqual(refused.type, "terminal.opened"); assert.equal(refused.launch_kind, undefined); assert.equal(f.spawns(), 0)
})

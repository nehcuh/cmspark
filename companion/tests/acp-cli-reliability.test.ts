// #603: asynchronous stream failures must settle locally; error -> close must
// release only this session's slot, without admitting another live session.
import "./integration/_security-gates-setup"
import test, { type TestContext } from "node:test"
import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { PassThrough, Writable } from "node:stream"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import cp from "node:child_process"
import * as launch from "../src/acp/win-spawn"
import { AcpManager } from "../src/acp/manager"
import { initDataDir, saveConfig } from "../src/config"

// Error injection and fake-clock advancement belong after the real start
// path installs child listeners, including asynchronous Windows preparation.
function observeMockSpawn(t: TestContext, child: any) {
  let observed!: () => void
  const spawned = new Promise<void>(resolve => { observed = resolve })
  t.mock.method(launch, "spawnAcpChild", () => { observed(); return child })
  return (pending: ReturnType<AcpManager["start"]>) => Promise.race([
    spawned,
    pending.then(result => { throw new Error(`owned startup ended before spawn: ${JSON.stringify(result)}`) }),
  ])
}

async function setup(t: TestContext) {
  await initDataDir()
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-cli-owned-")))
  saveConfig({ acp: { enabled: true, policy: { require_workspace: true, force_confirm_session_start: true, default_profile: "review_readonly" }, servers: {
    missing: { display_name: "Missing owned fixture", transport: "stdio", enabled: true, command: path.join(root, "does-not-exist.exe"), protocol: "cli", args: [], policy: { profile: "review_readonly", session_timeout_ms: 5000 } },
    owned: { display_name: "Owned fixture", transport: "stdio", enabled: true, command: process.execPath, protocol: "cli", args: ["-e", "process.stdin.resume();setTimeout(()=>console.log('owned output'),500)"], policy: { profile: "review_readonly", session_timeout_ms: 5000 } },
  } }, coding_handoff: { open_local_terminal: false } })
  const manager = new AcpManager()
  const terminals: string[] = [], handbacks: string[] = []
  manager.setTerminalSink(info => terminals.push(info.session.session_id))
  manager.setHandbackSink(info => handbacks.push(info.session.session_id))
  t.after(() => { manager.shutdown(); fs.rmSync(root, { recursive: true, force: true }) })
  const offer = (thread: string, agent = "owned") => {
    const result = manager.propose({ threadId: thread, agentId: agent, goal: "owned reliability fixture", workspaceRoot: root })
    assert.ok(result.ok, JSON.stringify(result)); return result.session
  }
  return { manager, offer, root, terminals, handbacks }
}

for (const stream of ["stdin", "stdout", "stderr"] as const) {
  test(`CLI ${stream} asynchronous error is handled and settles failure`, { timeout: 6000 }, async t => {
    const { manager, offer, terminals } = await setup(t)
    const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough() })
    if (stream === "stdin") child.stdin = new Writable({ write(_b, _e, done) { setImmediate(() => done(Object.assign(new Error("owned EPIPE"), { code: "EPIPE" }))) } }) as PassThrough
    const waitForSpawn = observeMockSpawn(t, child)
    t.mock.method(launch, "killAcpChild", () => {})
    const session = offer(stream), pending = manager.start(session.session_id)
    await waitForSpawn(pending)
    if (stream !== "stdin") setImmediate(() => child[stream].emit("error", new Error("owned stream failure")))
    const result = await pending
    assert.equal(result.ok, false)
    assert.match(session.error!, /owned/)
    assert.equal(session.terminal_kind, "failed")
    assert.equal(terminals.length, 1)
    child.emit("close", 1)
    assert.equal(terminals.length, 1)
    assert.equal(fs.existsSync(path.join(os.tmpdir(), `cmspark-acp-${session.session_id}.md`)), false)
    assert.ok(manager.propose({ threadId: "next", agentId: "owned", goal: "next", workspaceRoot: session.workspace_root }).ok)
  })
}

test("CLI synchronous spawn failure removes its owned prompt and releases its slot once", async t => {
  const { manager, offer, terminals, handbacks } = await setup(t)
  t.mock.method(launch, "spawnAcpChild", () => { throw Object.assign(new Error("owned synchronous ENOENT"), { code: "ENOENT" }) })
  const a = offer("A", "missing"), prompt = path.join(os.tmpdir(), `cmspark-acp-${a.session_id}.md`)
  assert.equal((await manager.start(a.session_id)).ok, false)
  assert.match(a.error!, /owned synchronous ENOENT/)
  assert.equal(fs.existsSync(prompt), false)
  assert.equal(terminals.filter(id => id === a.session_id).length, 1)
  assert.equal(handbacks.length, 0)
  const b = offer("B")
  assert.equal((await manager.start(b.session_id)).ok, false)
  assert.equal(fs.existsSync(path.join(os.tmpdir(), `cmspark-acp-${b.session_id}.md`)), false)
  assert.ok(offer("C"), "each synchronous failure releases exactly its own slot")
})

test("native CLI spawn error then close cannot release a replacement session's slot", { timeout: 8000 }, async t => {
  const { manager, offer, root, terminals, handbacks } = await setup(t)
  const children: cp.ChildProcess[] = [], closes: Promise<void>[] = []
  const spawn = launch.spawnAcpChild
  t.mock.method(launch, "spawnAcpChild", (...args: Parameters<typeof spawn>) => {
    // A missing executable can now fail synchronously in the owned Windows
    // launcher. A valid executable with a missing cwd produces a real native
    // asynchronous error followed by close, on every platform.
    const child = args[0].endsWith("does-not-exist.exe")
      ? spawn(process.execPath, [], { ...args[2], cwd: path.join(root, "does-not-exist-cwd") })
      : spawn(...args)
    children.push(child)
    closes.push(new Promise(resolve => child.once("close", () => resolve())))
    return child
  })
  const a = offer("A", "missing")
  assert.equal((await manager.start(a.session_id)).ok, false)
  assert.equal(children.length, 1, "failed native spawn must still return A's ChildProcess")
  assert.equal(children[0].pid, undefined)
  assert.match(a.error!, /ENOENT/)
  const b = offer("B"), bResult = manager.start(b.session_id)
  await closes[0]
  assert.equal(b.state, "running")
  assert.ok(children[1].pid)
  assert.equal(children[1].exitCode, null)
  const c = manager.propose({ threadId: "C", agentId: "owned", goal: "must wait", workspaceRoot: root })
  assert.equal(c.ok, false, "old close must not release B's live slot")
  if (!c.ok) {
    assert.equal(c.error_code, "ACP_CONCURRENCY_LIMIT", "foreign live slot is capacity, not same-thread busy")
    assert.equal(c.error, "ACP_CONCURRENCY_LIMIT: only one ACP session at a time")
    assert.deepEqual(c.data, { suggested_action: "wait_for_acp_capacity", data_not_instruction: true }, "foreign B identity/task must not leak to C")
  }
  assert.equal((await bResult).ok, true)
  assert.equal(terminals.filter(id => id === a.session_id).length, 1)
  assert.equal(handbacks.filter(id => id === a.session_id).length, 0, "failed spawn has no successful handback")
  assert.ok(offer("D"))
})

for (const afterTimeout of [false, true]) test(`CLI late pipe errors retain ownership and clear escalation (afterTimeout=${afterTimeout})`, async t => {
  const { manager, offer, root } = await setup(t)
  const child = Object.assign(new EventEmitter(), { pid: 98765, exitCode: null, signalCode: null,
    stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough() })
  const waitForSpawn = observeMockSpawn(t, child)
  let kills = 0
  t.mock.timers.enable({ apis: ["setTimeout"] })
  t.mock.method(launch, "killAcpChild", () => { kills++ })
  const session = offer("failing"), pending = manager.start(session.session_id)
  await waitForSpawn(pending)
  if (afterTimeout) t.mock.timers.tick(5000)
  child.stdout.emit("error", new Error("owned read error"))
  assert.equal((await pending).ok, false)
  child.stdin.emit("error", new Error("late owned EPIPE"))
  assert.equal(kills, afterTimeout ? 2 : 1)
  assert.equal(manager.propose({ threadId: "blocked", agentId: "owned", goal: "wait", workspaceRoot: root }).ok, false)
  child.emit("close", 1)
  child.emit("close", 1)
  t.mock.timers.tick(6000)
  assert.equal(kills, afterTimeout ? 2 : 1, "close must clear every delayed kill before PID reuse")
  assert.ok(offer("next"))
})

test("CLI timeout handles synchronous ChildProcess.kill error reentry without orphaning a timer", async t => {
  const { manager, offer } = await setup(t)
  // Keep Node's real kill/error emission behavior; this owned handle never
  // sends a signal to an OS PID. Real close clears _handle before callbacks.
  const child = Object.assign(new cp.ChildProcess(), { pid: 98765, exitCode: null, signalCode: null,
    stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough() })
  const eperm = [...require("node:util").getSystemErrorMap()].find(([, value]: [number, string[]]) => value[0] === "EPERM")![0]
  ;(child as any)._handle = { kill: () => eperm }
  const waitForSpawn = observeMockSpawn(t, child)
  t.mock.timers.enable({ apis: ["setTimeout"] })
  let stops = 0
  t.mock.method(launch, "killAcpChild", (_child: cp.ChildProcess, signal: NodeJS.Signals) => { stops++; child.kill(signal) })
  const session = offer("reentrant"), pending = manager.start(session.session_id)
  await waitForSpawn(pending)
  t.mock.timers.tick(5000)
  assert.equal((await pending).ok, false)
  assert.match(session.error!, /EPERM/)
  assert.equal(stops, 2, "kill synchronously emitted error and entered failure cleanup")
  ;(child as any)._handle = null
  child.emit("close", null)
  t.mock.timers.tick(6000)
  assert.equal(stops, 2, "close must clear the timer registered by nested cleanup too")
})

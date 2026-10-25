/** Actual ACP helper/manager close contract, with inert child/clock boundaries.
 * No native process, Windows Job bootstrap, provider or real configuration runs. */
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import vm from "node:vm"
import { EventEmitter } from "node:events"
import { PassThrough } from "node:stream"
import ts from "typescript"

// Normal test output lives under .test-dist/tests; whole-CJS CPU execution
// may retain the source tests filename. Probe only the two real source layouts.
const root = [path.resolve(__dirname, "../src"), path.resolve(__dirname, "../../src")]
  .find(candidate => fs.existsSync(path.join(candidate, "acp/win-spawn.ts")))
assert.ok(root, "actual ACP helper source must exist in a declared source layout")
const source = (file: string) => fs.readFileSync(path.join(root, file), "utf8")
const compilerOptions = { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true }

function clock() {
  let now = 0, id = 0
  const timers = new Map<number, { at: number; delay: number; run: () => void }>()
  return {
    setTimeout(run: () => void, delay: number) { const token = ++id; timers.set(token, { at: now + delay, delay, run }); return token },
    clearTimeout(token: number) { timers.delete(token) },
    delays: () => [...timers.values()].map(t => t.delay).sort((a, b) => a - b),
    advance(ms: number) {
      const target = now + ms
      for (;;) {
        const next = [...timers].filter(([, row]) => row.at <= target).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0]
        if (!next) break
        timers.delete(next[0]); now = next[1].at; next[1].run()
      }
      now = target
    },
  }
}
class InertChild extends EventEmitter {
  exitCode: number | null = null
  signalCode: NodeJS.Signals | null = null
  stdin = new PassThrough()
  stdout = new PassThrough()
  stderr = new PassThrough()
  kills: Array<NodeJS.Signals | undefined> = []
  private exited = false
  constructor(public pid: number | undefined) { super() }
  kill(signal?: NodeJS.Signals) { this.kills.push(signal); return true }
  exit(code: number | null, signal: NodeJS.Signals | null = null) {
    if (this.exited) return
    this.exited = true; this.exitCode = code; this.signalCode = signal
    this.emit("exit", code, signal)
  }
  close(code = 0) {
    if (this.pid) this.exit(code, this.signalCode)
    this.stdin.end(); this.stdout.end(); this.stderr.end()
    this.emit("close", this.exitCode, this.signalCode)
  }
}
function evaluate(file: string, imports: Record<string, unknown>, globals: Record<string, unknown>) {
  const compiled = ts.transpileModule(source(file), { fileName: file, compilerOptions, reportDiagnostics: true })
  assert.deepEqual(compiled.diagnostics, [])
  const exports: any = {}
  vm.runInNewContext(compiled.outputText, { exports, require(name: string) {
    assert.equal(Object.hasOwn(imports, name), true, `unadmitted inert import ${name}`)
    return imports[name]
  }, ...globals }, { filename: file, timeout: 2000 })
  return exports
}
function fixture(platform: "linux" | "win32", pid: number | null = 401) {
  const time = clock(), children: InertChild[] = [], spawns: Array<{ command: string; args: string[]; options: any; child: InertChild }> = []
  const groupKills: Array<{ pid: number; signal: NodeJS.Signals }> = [], jobs = new WeakSet<InertChild>()
  const allocate = (command: string, args: string[], options: any) => {
    const child = new InertChild(pid === null ? undefined : pid + children.length)
    children.push(child); spawns.push({ command, args, options, child }); return child
  }
  // Explicit native Job supplier seam only. The actual helper chooses this
  // dependency and observes its returned object; no Job/bootstrap success is claimed.
  const job = {
    spawnWindowsJob(command: string, args: string[], options: any) { const child = allocate(command, args, options); jobs.add(child); return child },
    isOwnedWindowsJobChild: (child: InertChild) => jobs.has(child),
  }
  const helper = evaluate("acp/win-spawn.ts", {
    child_process: { spawn: allocate }, fs, path,
    "../process/windows-job": job,
  }, { process: { platform, env: {}, execPath: "/inert/node", kill(target: number, signal: NodeJS.Signals) { groupKills.push({ pid: target, signal }) } },
    setTimeout: time.setTimeout, clearTimeout: time.clearTimeout })
  const spawn = () => {
    const child = helper.spawnAcpChild("INERT.exe", [], { stdio: ["pipe", "pipe", "pipe"] }) as InertChild
    assert.equal(child, children[children.length - 1])
    const admitted = spawns[spawns.length - 1]
    if (platform === "win32") { assert.equal(jobs.has(child), true); assert.equal(admitted.options.windowsHide, true) }
    else { assert.equal(admitted.options.detached, true); assert.equal(admitted.options.shell, false) }
    return child
  }
  return { time, helper, spawn, children, spawns, groupKills, platform }
}

for (const platform of ["linux", "win32"] as const) {
  test(`476 actual ${platform} ACP close waits beyond exitCode and signalCode until the same child close`, async () => {
    for (const exit of ["exitCode", "signalCode"] as const) {
      const f = fixture(platform), child = f.spawn()
      if (exit === "exitCode") child.exit(1)
      else child.exit(null, "SIGTERM")
      let settled = false
      const pending = f.helper.closeAcpChild(child) as Promise<void>
      pending.then(() => { settled = true })
      assert.equal(f.helper.closeAcpChild(child), pending, "repeat call must reuse the same object-bound promise")
      try {
        // The original bug synchronously clears this timer and resolves merely
        // from exit/signal. This is a real old-helper assertion RED, not a new API.
        assert.deepEqual(f.time.delays(), [2000])
        await Promise.resolve()
        assert.equal(settled, false)
        child.close(1)
        await pending
        assert.equal(settled, true)
        assert.deepEqual(f.time.delays(), [])
        assert.equal(f.helper.closeAcpChild(child), pending)
      } finally { child.close(1) }
    }
  })
  test(`476 actual ${platform} ACP close recognizes prior close and no-PID failure without future events`, async () => {
    const f = fixture(platform), closed = f.spawn()
    closed.close(0)
    const before = f.helper.closeAcpChild(closed) as Promise<void>
    assert.deepEqual(f.time.delays(), [])
    await before
    assert.equal(f.helper.closeAcpChild(closed), before)
    const sibling = f.spawn()
    let siblingSettled = false
    const siblingPending = f.helper.closeAcpChild(sibling) as Promise<void>
    siblingPending.then(() => { siblingSettled = true })
    try {
      assert.deepEqual(f.time.delays(), [2000], "one object's prior close cannot settle a sibling")
      await Promise.resolve()
      assert.equal(siblingSettled, false)
      sibling.close(0)
      await siblingPending
      assert.deepEqual(f.time.delays(), [])
    } finally { sibling.close(0) }
    const g = fixture(platform, null), failed = g.spawn()
    assert.equal(failed.pid, undefined)
    const missing = g.helper.closeAcpChild(failed) as Promise<void>
    await missing
    assert.deepEqual(g.time.delays(), [])
    assert.equal(g.helper.closeAcpChild(failed), missing)
    assert.deepEqual(failed.kills, [])
    assert.deepEqual(g.groupKills, [])
  })
  test(`476 actual ${platform} ACP no-close teardown preserves the 2000 plus 1000ms rejection boundary`, async () => {
    const f = fixture(platform), child = f.spawn()
    const pending = f.helper.closeAcpChild(child) as Promise<void>
    const rejected = assert.rejects(pending, /ACP subprocess teardown timed out/)
    assert.equal(f.helper.closeAcpChild(child), pending)
    assert.deepEqual(f.time.delays(), [2000])
    f.time.advance(1999)
    assert.deepEqual(f.time.delays(), [2000])
    if (platform === "linux") assert.deepEqual(f.groupKills, [{ pid: -401, signal: "SIGTERM" }])
    else assert.deepEqual(child.kills, [undefined])
    f.time.advance(1)
    assert.deepEqual(f.time.delays(), [1000])
    if (platform === "linux") assert.deepEqual(f.groupKills, [{ pid: -401, signal: "SIGTERM" }, { pid: -401, signal: "SIGKILL" }])
    else assert.deepEqual(child.kills, [undefined, undefined])
    let settled = false
    pending.then(() => { settled = true }, () => { settled = true })
    f.time.advance(999)
    await Promise.resolve()
    assert.equal(settled, false)
    f.time.advance(1)
    await rejected
    assert.equal(settled, true)
    assert.deepEqual(f.time.delays(), [])
    child.close(1)
    assert.equal(f.helper.closeAcpChild(child), pending, "late close cannot create a second teardown")
    await assert.rejects(pending, /ACP subprocess teardown timed out/)
  })
}

function managerFixture() {
  const f = fixture("linux"), events: any[] = [], writes = new Map<string, string>()
  const config = { acp: { enabled: true, max_concurrent_sessions: 1, servers: {
    A: { enabled: true, command: "INERT.exe", protocol: "cli", args: [], policy: { profile: "review_readonly", session_timeout_ms: 5000 } },
    B: { enabled: true, command: "INERT.exe", protocol: "cli", args: [], policy: { profile: "review_readonly", session_timeout_ms: 5000 } },
  } }, coding_handoff: { open_local_terminal: false } }
  const forbidden = () => { throw new Error("unadmitted manager dependency effect") }
  const imports = {
    "./win-spawn": f.helper,
    fs: { writeFileSync(file: string, text: string) { assert.equal(writes.has(file), false); writes.set(file, text) }, unlinkSync(file: string) { writes.delete(file) } },
    os: { tmpdir: () => "/inert" }, path,
    "../config": { getConfig: () => config }, "../logger": { logger: { info() {}, warn() {} } },
    "./workspace-bind": { resolveAcpWorkspaceRoot: () => ({ ok: true, root: "/inert/workspace" }) },
    "./handback": { frameAcpHandback: () => "inert handback" }, "./taint": { markAcpHandbackSeen() {} }, "./discover": { discoverCodingAgents: () => [] },
    "./launch-presets": { resolveLaunchArgs: () => [], resolveProtocolArgs: forbidden }, "./diff-apply": {}, "./handback-format": { shapeHandbackBody: () => "inert body" },
    "./protocol-session": { tryStartProtocolSession: forbidden },
    "./timeline": { timelineItem: (kind: string, label: string) => ({ kind, label }), capTimeline: (items: unknown) => items },
    "./open-local-terminal": { openLocalTerminalForAgent: forbidden },
    "./progress-caps": { PROGRESS_TAIL_CLI_CHARS: 12000, PROGRESS_TAIL_ACP_CHARS: 12000 },
    "./agent-env": { buildAcpAgentEnv: () => ({}) }, "../pty/session": { onPtyAgentSpawned: () => () => {} },
    "../process/windows-job": { prepareWindowsJob: forbidden },
    "./manual-entry": { captureManualEntryLaunch: () => ({}) }, "./ui-progress": { boundCodingProgress: (event: unknown) => event },
  }
  const Actual = evaluate("acp/manager.ts", imports, { process: { platform: "linux" }, Buffer, AbortController, AbortSignal, Date,
    setTimeout: f.time.setTimeout, clearTimeout: f.time.clearTimeout }).AcpManager
  const manager = new Actual()
  manager.onEvent((event: unknown) => events.push(event))
  const offer = (agentId: string) => {
    const result = manager.propose({ threadId: "owned-thread", agentId, goal: "inert close fence", workspaceRoot: "/inert/workspace" })
    assert.equal(result.ok, true)
    return result.session
  }
  return { ...f, manager, offer, events, writes }
}

test("476 actual manager shutdown retains an exited child's closing claim until the real helper observes close", async () => {
  for (const exit of ["exitCode", "signalCode"] as const) {
    const f = managerFixture(), session = f.offer("A"), waiting = f.offer("B")
    const started = f.manager.start(session.session_id)
    assert.equal(f.children.length, 1)
    const child = f.children[0]
    child.emit("spawn")
    if (exit === "exitCode") child.exit(1)
    else child.exit(null, "SIGTERM")
    child.stdout.emit("error", new Error("INERT_EXIT_BEFORE_CLOSE"))
    assert.equal((await started).ok, false)
    assert.equal(session.execution_phase, "closing")
    assert.equal(f.manager.checkStartAdmission(waiting.session_id).ok, false)
    assert.equal(f.manager.ownedChildren.has(child), true)
    let settled = false
    const priorCloseTimers = f.time.delays().filter(delay => delay === 2000).length
    const shutdown = f.manager.shutdown() as Promise<void>
    shutdown.then(() => { settled = true })
    try {
      assert.equal(f.time.delays().filter(delay => delay === 2000).length, priorCloseTimers + 1, "actual shutdown must retain the real helper's close wait")
      await Promise.resolve()
      assert.equal(settled, false)
      assert.equal(f.manager.hasProjectThreadActivity("owned-thread"), true)
      assert.equal(session.execution_phase, "closing")
      child.close(1)
      await shutdown
      assert.equal(settled, true)
      assert.equal(session.execution_phase, "released")
      assert.equal(f.manager.ownedChildren.has(child), false)
      assert.equal(f.writes.size, 0)
      // cancelOwned's original delayed escalation is fake-clock state here.
      // Its late callback must be harmless after close; drain it explicitly.
      assert.deepEqual(f.time.delays(), [1500])
      const killsBefore = JSON.stringify({ group: f.groupKills, child: child.kills })
      f.time.advance(1500)
      assert.deepEqual(f.time.delays(), [])
      assert.equal(JSON.stringify({ group: f.groupKills, child: child.kills }), killsBefore)
    } finally { child.close(1) }
  }
})

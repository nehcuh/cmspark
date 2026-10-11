import "./_security-gates-setup"
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import net from "node:net"
import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import { AcpManager } from "../../src/acp/manager"
import { initDataDir, saveConfig, getConfig, getConfigDir } from "../../src/config"
import { requestDaemonStop } from "../../src/daemon"
import { getLockPath } from "../../src/platform"
import { spawnAcpChild } from "../../src/acp/win-spawn"
import { OwnedStdioTransport } from "../../src/mcp/stdio-transport"
import { quoteWindowsJobArg, spawnWindowsJob } from "../../src/process/windows-job"

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const alive = (pid?: number) => { if (!pid) return false; try { process.kill(pid, 0); return true } catch { return false } }
async function until(check: () => boolean, budget = 8000) {
  const end = Date.now() + budget
  while (!check()) { assert.ok(Date.now() < end, "owned process condition timed out"); await pause(20) }
}
function ownedRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), "cmspark 605 & 中文 owned-")) }
async function stop(child?: ChildProcess) {
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL"); await until(() => child.exitCode !== null || child.signalCode !== null)
  }
}
function childFixture(root: string, mode: string) {
  const script = path.join(root, "owned wrapper.cjs"), marker = path.join(root, "descendant.pid")
  fs.writeFileSync(script, `const cp=require('node:child_process'),fs=require('node:fs');
    const child=cp.spawn(process.execPath,['-e','setTimeout(()=>{},20000)'],{stdio:'ignore',windowsHide:true});
    fs.writeFileSync(${JSON.stringify(marker)},String(child.pid));
    ${mode === "complete" ? "setTimeout(()=>process.exit(0),300);" : "process.stdin.resume();setTimeout(()=>{},20000);"}`)
  return { script, marker }
}

for (const mode of ["cancel", "timeout", "complete", "shutdown"] as const) {
  test(`public ACP ${mode} reclaims its native process tree`, { timeout: 30000 }, async () => {
    await initDataDir()
    const root = ownedRoot(), f = childFixture(root, mode), manager = new AcpManager()
    const sentinel = spawn(process.execPath, ["-e", "setTimeout(()=>{},25000)"], { stdio: "ignore", windowsHide: true })
    let descendant = 0
    try {
      saveConfig({ acp: { policy: getConfig().acp!.policy, enabled: true, servers: { owned: { display_name: "Owned", transport: "stdio", enabled: true, command: process.execPath, args: [f.script], protocol: "cli",
        policy: { profile: "review_readonly", session_timeout_ms: mode === "timeout" ? 4000 : 20000 } } } }, coding_handoff: { open_local_terminal: false } })
      const offered = manager.propose({ threadId: "owned", agentId: "owned", goal: "owned fixture", workspaceRoot: root })
      assert.ok(offered.ok)
      const pending = manager.start(offered.session.session_id)
      await until(() => fs.existsSync(f.marker)); descendant = Number(fs.readFileSync(f.marker, "utf8"))
      if (mode === "cancel") manager.cancel(offered.session.session_id)
      if (mode === "shutdown") await manager.shutdown()
      await pending
      await until(() => !alive(descendant))
      assert.equal(offered.session.state, "closed")
      if (mode === "cancel" || mode === "shutdown") assert.equal(offered.session.terminal_kind, "cancelled")
      assert.ok(alive(sentinel.pid), "unrelated process must survive")
    } finally {
      await manager.shutdown(); if (alive(descendant)) try { process.kill(descendant, "SIGKILL") } catch {}
      await stop(sentinel); fs.rmSync(root, { recursive: true, force: true })
    }
  })
}

test("MCP natural wrapper exit drains its final response and reclaims descendants", { timeout: 30000 }, async () => {
  const root = ownedRoot(), marker = path.join(root, "descendant.pid"), script = path.join(root, "stdio wrapper.cjs")
  fs.writeFileSync(script, `const cp=require('node:child_process'),fs=require('node:fs');
    const child=cp.spawn(process.execPath,['-e','setTimeout(()=>{},20000)'],{stdio:['ignore',process.stdout,process.stderr],windowsHide:true});
    fs.writeFileSync(${JSON.stringify(marker)},String(child.pid));
    require('node:readline').createInterface({input:process.stdin}).on('line',line=>{
      const m=JSON.parse(line); process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{content:[{type:'text',text:'FINAL_RESPONSE'}]}})+'\\n',()=>process.exit(0));
    });setTimeout(()=>process.exit(2),20000);`)
  const sentinel = spawn(process.execPath, ["-e", "setTimeout(()=>{},25000)"], { stdio: "ignore", windowsHide: true })
  let command = process.execPath, args = [script]
  if (process.platform === "win32") {
    command = path.join(root, "owned.cmd"); args = []
    fs.writeFileSync(command, `@echo off\r\n"${process.execPath}" "%~dp0stdio wrapper.cjs"\r\n`)
  }
  const transport = new OwnedStdioTransport({ command, args })
  let response: any, closed = 0, descendant = 0
  transport.onmessage = value => { response = value }; transport.onclose = () => { closed++ }
  try {
    await transport.start(); await until(() => fs.existsSync(marker))
    descendant = Number(fs.readFileSync(marker, "utf8"))
    await transport.send({ jsonrpc: "2.0", id: 1, method: "owned" })
    await until(() => closed === 1)
    assert.equal(response.result.content[0].text, "FINAL_RESPONSE")
    await until(() => !alive(descendant)); assert.ok(alive(sentinel.pid))
    await transport.close(); assert.equal(closed, 1)
  } finally {
    await transport.close(); if (alive(descendant)) try { process.kill(descendant, "SIGKILL") } catch {}
    await stop(sentinel); fs.rmSync(root, { recursive: true, force: true })
  }
})

test("public daemon stop refuses an unrelated stale PID, including misleading product words", { timeout: 15000 }, async () => {
  const root = ownedRoot(), sentinel = spawn(process.execPath, ["-e", "/* cmspark daemon */ setTimeout(()=>{},20000)"], { stdio: "ignore", windowsHide: true })
  let stopper: ChildProcess | undefined
  try {
    fs.writeFileSync(path.join(root, "daemon.pid"), String(sentinel.pid))
    stopper = spawn(process.execPath, [path.resolve(__dirname, "../../src/index.js"), "daemon", "stop"], {
      env: { ...process.env, CMSPARK_DATA_DIR: root, CMSPARK_SKIP_LOGIN_ENV: "1" }, stdio: "ignore", windowsHide: true,
    })
    await until(() => stopper!.exitCode !== null)
    assert.equal(stopper.exitCode, 1); assert.ok(alive(sentinel.pid))
    assert.equal(fs.readFileSync(path.join(root, "daemon.pid"), "utf8"), String(sentinel.pid))
  } finally { await stop(stopper); await stop(sentinel); fs.rmSync(root, { recursive: true, force: true }) }
})

for (const method of ["daemon-stop", "daemon-stop-without-pid", ...(process.platform === "win32" ? [] : ["SIGTERM", "SIGINT"])] as const) {
  test(`actual server ${method} awaits ACP cleanup and rejects unauthenticated control`, { timeout: 35000 }, async () => {
    const root = ownedRoot(), f = childFixture(root, "shutdown"), bootstrap = path.join(root, "server.cjs")
    const base = path.resolve(__dirname, "../../src"), ready = path.join(root, "ready")
    fs.writeFileSync(bootstrap, `const cfg=require(${JSON.stringify(path.join(base, "config.js"))});
      (async()=>{await cfg.initDataDir();require(${JSON.stringify(path.join(base, "daemon.js"))}).writePidFile(cfg.getPidFilePath(),process.pid);
        await require(${JSON.stringify(path.join(base, "server.js"))}).startServer();
        const manager=require(${JSON.stringify(path.join(base, "acp/manager.js"))}).getAcpManager();
        const offered=manager.propose({threadId:'owned',agentId:'owned',goal:'owned fixture',workspaceRoot:${JSON.stringify(root)}});
        if(!offered.ok)throw Error(offered.error);manager.start(offered.session.session_id).catch(()=>{});
        require('node:fs').writeFileSync(${JSON.stringify(ready)},'ready');})().catch(e=>{console.error(e);process.exit(1)});`)
    const listener = net.createServer(); await new Promise<void>(resolve => listener.listen(0, "127.0.0.1", resolve))
    const port = (listener.address() as net.AddressInfo).port; await new Promise<void>(resolve => listener.close(() => resolve()))
    fs.writeFileSync(path.join(root, "config.json"), JSON.stringify({ port, llm: { api_key: "", base_url: "http://127.0.0.1:1/v1", model_name: "owned" },
      mcp: { enabled: false, servers: {} }, acp: { enabled: true, servers: { owned: { display_name: "Owned", transport: "stdio", enabled: true, command: process.execPath, args: [f.script], protocol: "cli", policy: { profile: "review_readonly", session_timeout_ms: 25000 } } } }, coding_handoff: { open_local_terminal: false } }))
    const env = { ...process.env, CMSPARK_DATA_DIR: root, CMSPARK_SKIP_LOGIN_ENV: "1", DEEPSEEK_API_KEY: "", OPENAI_API_KEY: "" }
    const server = spawn(process.execPath, [bootstrap], { env, stdio: "ignore", windowsHide: true })
    let descendant = 0, stopper: ChildProcess | undefined
    try {
      await until(() => fs.existsSync(ready) && fs.existsSync(f.marker), 15000)
      descendant = Number(fs.readFileSync(f.marker, "utf8"))
      for (const frame of [null, 7, true, "stop", []]) {
        await new Promise<void>((resolve, reject) => {
          const socket = net.createConnection(process.platform === "win32" ? getLockPath() : path.join(root, "daemon.sock"))
          const timer = setTimeout(() => { socket.destroy(); reject(new Error("malformed control did not close")) }, 3000)
          socket.resume()
          socket.on("error", reject); socket.on("connect", () => socket.write(JSON.stringify(frame) + "\n"))
          socket.on("close", () => { clearTimeout(timer); resolve() })
        })
        await pause(30); assert.ok(alive(server.pid), "malformed unauthenticated input must not crash the server")
      }
      // A wrong data directory cannot authenticate even on the global Windows pipe.
      const wrong = path.join(root, "wrong"); fs.mkdirSync(wrong); fs.writeFileSync(path.join(wrong, "daemon.pid"), String(server.pid)); fs.writeFileSync(path.join(wrong, "ws_secret"), "wrong-secret")
      stopper = spawn(process.execPath, [path.join(base, "index.js"), "daemon", "stop"], { env: { ...env, CMSPARK_DATA_DIR: wrong }, stdio: "ignore", windowsHide: true })
      await until(() => stopper!.exitCode !== null); assert.equal(stopper.exitCode, 1); assert.ok(alive(server.pid)); assert.ok(alive(descendant))
      if (method === "daemon-stop-without-pid") fs.unlinkSync(path.join(root, "daemon.pid"))
      if (method === "daemon-stop" || method === "daemon-stop-without-pid") {
        stopper = spawn(process.execPath, [path.join(base, "index.js"), "daemon", "stop"], { env, stdio: "ignore", windowsHide: true })
        await until(() => stopper!.exitCode !== null, 15000); assert.equal(stopper.exitCode, 0)
      } else server.kill(method as NodeJS.Signals)
      await until(() => server.exitCode !== null, 15000); assert.equal(server.exitCode, 0)
      await until(() => !alive(descendant))
    } finally {
      await stop(stopper); await stop(server); if (alive(descendant)) try { process.kill(descendant, "SIGKILL") } catch {}
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
}

test("job launcher CRT quoting preserves empty, quote and trailing-backslash operands", () => {
  assert.equal(quoteWindowsJobArg(""), '""')
  assert.equal(quoteWindowsJobArg('space 中文 & % "value"'), '"space 中文 & % \\"value\\""')
  assert.equal(quoteWindowsJobArg("C:\\owned path\\"), '"C:\\owned path\\\\"')
})


test("native Windows job survives hostile server env and preserves literal argv", { skip: process.platform !== "win32", timeout: 30000 }, async () => {
  const root = ownedRoot(), marker = path.join(root, "argv.json"), script = path.join(root, "literal argv.cjs")
  const args = ["", 'space 中文 & % "value"', "C:\\owned path\\", "x".repeat(2048)]
  fs.writeFileSync(script, `require('node:fs').writeFileSync(${JSON.stringify(marker)},JSON.stringify({args:process.argv.slice(2),cwd:process.cwd()}));process.stdin.resume();setTimeout(()=>{},20000);`)
  let child: ChildProcess | undefined
  try {
    child = spawnWindowsJob(process.execPath, [script, ...args], { env: { ...process.env, SystemRoot: root, ComSpec: path.join(root, "fake.exe") }, cwd: path.relative(process.cwd(), root), stdio: "pipe" })
    child.stderr?.on("data", () => {})
    await until(() => fs.existsSync(marker), 15000)
    const observed = JSON.parse(fs.readFileSync(marker, "utf8"))
    assert.deepEqual(observed.args, args); assert.equal(observed.cwd, fs.realpathSync.native(root))
  } finally { await stop(child); fs.rmSync(root, { recursive: true, force: true }) }
})

test("native Windows owner crash reclaims its job without touching a sentinel", { skip: process.platform !== "win32", timeout: 30000 }, async () => {
  const root = ownedRoot(), f = childFixture(root, "shutdown"), controllerScript = path.join(root, "controller.cjs"), launcherMarker = path.join(root, "launcher.pid")
  const jobModule = path.resolve(__dirname, "../../src/process/windows-job.js")
  fs.writeFileSync(controllerScript, `const c=require(${JSON.stringify(jobModule)}).spawnWindowsJob(process.execPath,[${JSON.stringify(f.script)}],{stdio:'ignore'});require('node:fs').writeFileSync(${JSON.stringify(launcherMarker)},String(c.pid));setTimeout(()=>{},20000);`)
  const sentinel = spawn(process.execPath, ["-e", "setTimeout(()=>{},25000)"], { stdio: "ignore", windowsHide: true })
  const controller = spawn(process.execPath, [controllerScript], { stdio: "ignore", windowsHide: true })
  let descendant = 0, launcher = 0
  try {
    await until(() => fs.existsSync(f.marker) && fs.existsSync(launcherMarker), 15000)
    descendant = Number(fs.readFileSync(f.marker, "utf8")); launcher = Number(fs.readFileSync(launcherMarker, "utf8"))
    await stop(controller)
    await until(() => !alive(descendant) && !alive(launcher))
    assert.ok(alive(sentinel.pid), "owner crash must only reclaim the owned job")
  } finally {
    await stop(controller); await stop(sentinel)
    for (const pid of [launcher, descendant]) if (alive(pid)) try { process.kill(pid, "SIGKILL") } catch {}
    fs.rmSync(root, { recursive: true, force: true })
  }
})


test("daemon stop rejects scalar challenge frames without crashing the client", { timeout: 10000 }, async () => {
  await initDataDir(); fs.writeFileSync(path.join(getConfigDir(), "ws_secret"), "owned-control-secret")
  const root = ownedRoot()
  try {
    for (const frame of [null, 7, true, "challenge", []]) {
      const endpoint = process.platform === "win32" ? String.raw`\\?\pipe\cmspark-605-owned-${process.pid}` : path.join(root, "fake.sock")
      const server = net.createServer(socket => { socket.on("error", () => {}); socket.end(JSON.stringify(frame) + "\n") })
      await new Promise<void>(resolve => server.listen(endpoint, resolve))
      try { assert.equal(await requestDaemonStop(endpoint, process.pid), false) }
      finally { await new Promise<void>(resolve => server.close(() => resolve())) }
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

test("native Windows ACP extensionless npm shim uses its sibling cmd through the owned job", { skip: process.platform !== "win32", timeout: 30000 }, async () => {
  const root = ownedRoot(), marker = path.join(root, "argv.json"), shim = path.join(root, "owned-cli"), script = path.join(root, "main.cjs")
  fs.writeFileSync(shim, "#!/bin/sh\nexec node main.cjs \"$@\"\n")
  fs.writeFileSync(shim + ".cmd", `@echo off\r\n"${process.execPath}" "%~dp0main.cjs" %*\r\n`)
  fs.writeFileSync(script, `require('node:fs').writeFileSync(${JSON.stringify(marker)},JSON.stringify(process.argv.slice(2)));process.stdin.resume();setTimeout(()=>{},20000);`)
  let child: ChildProcess | undefined
  try {
    child = spawnAcpChild(shim, ["owned argument"], { stdio: "pipe" }); child.stderr?.on("data", () => {})
    await until(() => fs.existsSync(marker), 15000); assert.deepEqual(JSON.parse(fs.readFileSync(marker, "utf8")), ["owned argument"])
  } finally { await stop(child); fs.rmSync(root, { recursive: true, force: true }) }
})


for (const mode of ["handshake-pending", "reentrant-start"] as const) {
  test(`ACP shutdown during ${mode} prevents an escaping process`, { timeout: 30000 }, async () => {
    await initDataDir(); const root = ownedRoot(), marker = path.join(root, "pid"), stage = path.join(root, "initialize"), script = path.join(root, "pending.cjs"), manager = new AcpManager()
    fs.writeFileSync(script, `require('node:fs').writeFileSync(${JSON.stringify(marker)},String(process.pid));require('node:readline').createInterface({input:process.stdin}).on('line',line=>{if(JSON.parse(line).method==='initialize')require('node:fs').writeFileSync(${JSON.stringify(stage)},'initialize')});setTimeout(()=>{},20000);`)
    let pending: ReturnType<AcpManager["start"]> | undefined, shutdown: Promise<void> | undefined, pid = 0
    try {
      saveConfig({ acp: { enabled: true, policy: { require_workspace: true, force_confirm_session_start: true, default_profile: "review_readonly" }, servers: { owned: { display_name: "Owned", transport: "stdio", enabled: true, command: process.execPath, args: [script], protocol: mode === "handshake-pending" ? "acp" : "cli", policy: { profile: "review_readonly", session_timeout_ms: 18000 } } } }, coding_handoff: { open_local_terminal: false } })
      const offered = manager.propose({ threadId: "owned", agentId: "owned", goal: "owned fixture", workspaceRoot: root }); assert.ok(offered.ok)
      if (mode === "reentrant-start") manager.onEvent(event => { if (!shutdown && event.state === "running" && event.progress_tail === "starting…") shutdown = manager.shutdown() })
      pending = manager.start(offered.session.session_id)
      if (mode === "handshake-pending") { await until(() => fs.existsSync(stage), 15000); pid = Number(fs.readFileSync(marker, "utf8")); shutdown = manager.shutdown() }
      assert.ok(shutdown); await shutdown; const result = await pending
      assert.equal(result.ok, false); assert.equal(offered.session.state, "closed")
      if (mode === "handshake-pending") assert.ok(!alive(pid))
      else assert.ok(!fs.existsSync(marker), "reentrant shutdown must win before spawn")
    } finally {
      await manager.shutdown(); await pending
      if (alive(pid)) try { process.kill(pid, "SIGKILL") } catch {}
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
}


test("daemon stop with no PID distinguishes an absent socket from a live inaccessible owner", { skip: process.platform === "win32" || process.getuid?.() === 0, timeout: 15000 }, async () => {
  const root = ownedRoot(), endpoint = path.join(root, "daemon.sock"), metadata = path.join(root, "keep.txt")
  const server = net.createServer(socket => socket.end())
  const invoke = () => spawnSync(process.execPath, [path.resolve(__dirname, "../../src/index.js"), "daemon", "stop"], {
    env: { ...process.env, CMSPARK_DATA_DIR: root, CMSPARK_SKIP_LOGIN_ENV: "1" }, encoding: "utf8", timeout: 5000,
  })
  fs.writeFileSync(metadata, "owned metadata")
  try {
    const absent = invoke(); assert.equal(absent.error, undefined); assert.equal(absent.status, 0, absent.stdout + absent.stderr)
    await new Promise<void>(resolve => server.listen(endpoint, resolve))
    fs.chmodSync(endpoint, 0o000)
    const error = await new Promise<NodeJS.ErrnoException>((resolve, reject) => {
      const socket = net.createConnection(endpoint)
      socket.on("connect", () => { socket.destroy(); reject(Error("fixture socket unexpectedly accessible")) })
      socket.on("error", resolve)
    })
    assert.equal(error.code, "EACCES", "real nonroot permissions must exercise access failure")
    const inaccessible = invoke(); assert.equal(inaccessible.error, undefined)
    assert.equal(inaccessible.status, 1, inaccessible.stdout + inaccessible.stderr)
    assert.match(inaccessible.stderr, /Refusing to stop an unverified process/)
    assert.equal(fs.readFileSync(metadata, "utf8"), "owned metadata"); assert.ok(server.listening)
    fs.chmodSync(endpoint, 0o600)
    fs.writeFileSync(path.join(root, "daemon.pid"), "9007199254740993")
    const invalidPid = invoke(); assert.equal(invalidPid.error, undefined)
    assert.equal(invalidPid.status, 1, "an invalid PID cannot establish endpoint absence")
    assert.equal(fs.readFileSync(path.join(root, "daemon.pid"), "utf8"), "9007199254740993")
    assert.ok(server.listening)
  } finally {
    if (fs.existsSync(endpoint)) fs.chmodSync(endpoint, 0o600)
    if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()))
    fs.rmSync(root, { recursive: true, force: true })
  }
})

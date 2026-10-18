import "./_security-gates-setup"
import test, { type TestContext } from "node:test"
import { EventEmitter, errorMonitor } from "node:events"
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
import { prepareWindowsJob, quoteWindowsJobArg, spawnWindowsJob } from "../../src/process/windows-job"
import { windowsTargetEnvironment } from "../../src/process/windows-env"

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const alive = (pid?: number) => { if (!pid) return false; try { process.kill(pid, 0); return true } catch { return false } }
async function until(check: () => boolean, budget = 8000, details?: () => string) {
  const end = Date.now() + budget
  while (!check()) { assert.ok(Date.now() < end, `owned process condition timed out${details ? ": " + details() : ""}`); await pause(20) }
}
// Test-only finite observations. Never emit the launcher command, error message,
// output bytes, paths or environment; never consume the child's error event.
function observeHostileJobStartup() {
  const stderrWords = ["ncrypto::CSPRNG", "uv_thread_create", "node::InitializeOncePerProcessInternal"] as const
  const stderrFixed = new Set<string>()
  const stderrTailBound = Math.max(...stderrWords.map(word => word.length)) - 1
  let stderrTail = ""
  const observeStderr = (chunk: unknown) => safe(() => {
    // ASCII literals only. Keep at most the longest literal-minus-one for
    // split chunks; never emit stderr, paths, environment or an exception.
    const text = stderrTail + (Buffer.isBuffer(chunk) ? chunk.toString("latin1") : typeof chunk === "string" ? chunk : "")
    for (const word of stderrWords) if (text.includes(word)) stderrFixed.add(word)
    stderrTail = text.slice(-stderrTailBound)
  })
  const facts = {
    spawn_observed: false, error_observed: false, exit_observed: false, close_observed: false,
    error_code: null as string | null,
    exit_code: null as number | null, exit_signal: null as string | null,
    close_code: null as number | null, close_signal: null as string | null,
    stdout_bytes: 0 as number | null, stderr_bytes: 0 as number | null,
  }
  const safe = (action: () => void) => { try { action() } catch { /* Observation only. */ } }
  const status = (value: unknown) => typeof value === "number" && Number.isInteger(value)
    && value >= -2147483648 && value <= 4294967295 ? value : null
  const signal = (value: unknown) => value === null ? null
    : ["SIGTERM", "SIGKILL", "SIGINT", "SIGABRT", "SIGSEGV", "SIGPIPE"].includes(value as string) ? value as string : "OTHER"
  const count = (role: "stdout_bytes" | "stderr_bytes", chunk: unknown) => safe(() => {
    const bytes = Buffer.isBuffer(chunk) ? chunk.length : typeof chunk === "string" ? Buffer.byteLength(chunk) : 0
    if (facts[role] === null) return
    const sum = facts[role] + bytes
    facts[role] = Number.isSafeInteger(sum) && sum >= 0 ? sum : null
  })
  return {
    attach(child: ChildProcess) {
      safe(() => child.once("spawn", () => safe(() => { facts.spawn_observed = true })))
      safe(() => (child as EventEmitter).once(errorMonitor, (error: unknown) => safe(() => {
        facts.error_observed = true
        const code = (error as { code?: unknown } | null)?.code
        facts.error_code = ["ABORT_ERR", "ENOENT", "EACCES", "EPERM", "ETIMEDOUT", "EINVAL", "ENOMEM", "EIO", "EPIPE"].includes(code as string) ? code as string : "OTHER"
      })))
      safe(() => child.once("exit", (code, endedSignal) => safe(() => {
        facts.exit_observed = true; facts.exit_code = status(code); facts.exit_signal = signal(endedSignal)
      })))
      safe(() => child.once("close", (code, endedSignal) => safe(() => {
        facts.close_observed = true; facts.close_code = status(code); facts.close_signal = signal(endedSignal)
      })))
      safe(() => child.stdout?.on("data", (chunk: unknown) => count("stdout_bytes", chunk)))
      safe(() => child.stderr?.on("data", (chunk: unknown) => { count("stderr_bytes", chunk); observeStderr(chunk) }))
    },
    snapshot() { return { ...facts, stderr_fixed_words: [...stderrFixed].sort() } },
    emit(t: Pick<TestContext, "diagnostic">) {
      safe(() => t.diagnostic(JSON.stringify({ schema: "owned-hostile-job-startup-v2", ...facts, stderr_fixed_words: [...stderrFixed].sort() })))
    },
  }
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
    child.once('error',()=>process.exit(1));
    child.once('spawn',()=>{
      if(!Number.isSafeInteger(child.pid)||child.pid<=0)throw Error('OWNED_CHILD_PID_UNAVAILABLE');
      fs.writeFileSync(${JSON.stringify(marker + ".pending")},String(child.pid),{flag:'wx',mode:0o600});
      fs.renameSync(${JSON.stringify(marker + ".pending")},${JSON.stringify(marker)});
    });
    ${mode === "complete" ? "setTimeout(()=>process.exit(0),300);" : "process.stdin.resume();setTimeout(()=>{},20000);"}`)
  return { script, marker }
}

test("owned descendant PID marker is absent until its complete native publication", { timeout: 30000 }, async () => {
  const root = ownedRoot(), f = childFixture(root, "shutdown"), release = path.join(root, "release")
  const preload = path.join(root, "hold-publication.cjs")
  fs.writeFileSync(preload, `const fs=require('node:fs'),write=fs.writeFileSync;
    fs.writeFileSync=function(file,data,options){
      if(file!==${JSON.stringify(f.marker)} && file!==${JSON.stringify(f.marker + ".pending")})return write.apply(this,arguments);
      const fd=fs.openSync(file,options?.flag||'w',options?.mode||0o600);
      try{process.send({phase:'opened',pid:Number(data),finalVisible:fs.existsSync(${JSON.stringify(f.marker)})});
        while(!fs.existsSync(${JSON.stringify(release)}))Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,10);
        fs.writeSync(fd,String(data));
      }finally{fs.closeSync(fd)}
    };`)
  let wrapper: ChildProcess | undefined, descendant = 0, opened: any
  try {
    wrapper = spawn(process.execPath, ["--require", preload, f.script], { stdio: ["ignore", "ignore", "pipe", "ipc"], windowsHide: true })
    wrapper.on("message", message => { opened = message })
    await until(() => opened?.phase === "opened")
    descendant = opened.pid
    assert.ok(Number.isSafeInteger(descendant) && descendant > 0)
    assert.ok(alive(descendant)); assert.ok(alive(wrapper.pid))
    assert.equal(opened.finalVisible, false, "opening an incomplete PID must not publish the final marker")
    assert.equal(fs.existsSync(f.marker), false)
    fs.writeFileSync(release, "release", { flag: "wx" })
    await until(() => fs.existsSync(f.marker))
    assert.equal(Number(fs.readFileSync(f.marker, "utf8")), descendant)
    assert.ok(alive(descendant), "the same real child survives complete publication")
  } finally {
    if (!fs.existsSync(release)) fs.writeFileSync(release, "release", { flag: "wx" })
    await stop(wrapper)
    if (alive(descendant)) try { process.kill(descendant, "SIGKILL") } catch {}
    fs.rmSync(root, { recursive: true, force: true })
  }
})

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
  let errors = ""; transport.stderr.on("data", chunk => { errors += chunk })
  transport.onmessage = value => { response = value }; transport.onclose = () => { closed++ }
  try {
    await transport.start(); await until(() => fs.existsSync(marker), 8000, () => errors)
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

test("native Windows job preserves bidirectional protocol pipes and ignored stdio", { skip: process.platform !== "win32", timeout: 30000 }, async () => {
  const root = ownedRoot(), script = path.join(root, "protocol.cjs"), marker = path.join(root, "ready")
  fs.writeFileSync(script, `require('node:fs').writeFileSync(${JSON.stringify(marker)},JSON.stringify({cwd:process.cwd()}));
    process.stdout.write('READY\\n');process.stderr.write('OWNED_STDERR\\n');
    require('node:readline').createInterface({input:process.stdin}).on('line',line=>process.stdout.write(JSON.stringify({echo:JSON.parse(line)})+'\\n'));
    setTimeout(()=>{},20000);`)
  let child: ChildProcess | undefined, output = "", errors = ""
  try {
    await prepareWindowsJob()
    child = spawnWindowsJob(process.execPath, [script], { stdio: "pipe" })
    child.stdout!.on("data", chunk => { output += chunk }); child.stderr!.on("data", chunk => { errors += chunk })
    try {
      await until(() => output.includes("READY\n") && errors.includes("OWNED_STDERR\n"), 10000)
      assert.equal(fs.realpathSync.native(JSON.parse(fs.readFileSync(marker, "utf8")).cwd), fs.realpathSync.native(process.cwd()), "omitted cwd inherits the actual parent directory")
      child.stdin!.write(JSON.stringify({ owned: "中文 & literal" }) + "\n")
      await until(() => output.includes(JSON.stringify({ echo: { owned: "中文 & literal" } })), 5000)
    } catch (error) { throw new Error(`protocol pipe failure (exit=${child.exitCode}): ${output}\n${errors}`, { cause: error }) }
    await stop(child); fs.unlinkSync(marker)
    child = spawnWindowsJob(process.execPath, [script], { stdio: "ignore" })
    await until(() => fs.existsSync(marker), 10000)
    assert.equal(fs.realpathSync.native(JSON.parse(fs.readFileSync(marker, "utf8")).cwd), fs.realpathSync.native(process.cwd()))
    assert.ok(alive(child.pid), "ignored stdio does not prevent native startup")
  } finally { await stop(child); fs.rmSync(root, { recursive: true, force: true }) }
})


// Test-owned overrides must be unique under the actual Windows case-folding
// rule. Do not rewrite the parent environment or production target semantics.
function hostileJobEnvironment(runtimeRoot: string, fakeComSpec: string, host: NodeJS.ProcessEnv = process.env) {
  const env: NodeJS.ProcessEnv = Object.create(null)
  for (const key of Object.keys(host)) if (!["SYSTEMROOT", "COMSPEC"].includes(key.toUpperCase())) env[key] = host[key]
  env.SystemRoot = runtimeRoot; env.ComSpec = fakeComSpec
  const block = windowsTargetEnvironment(env, host).toString("utf16le").split("\0").filter(Boolean)
  for (const [name, expected] of [["SYSTEMROOT", runtimeRoot], ["COMSPEC", fakeComSpec]]) {
    const entries = block.filter(entry => entry.slice(0, entry.indexOf("=")).toUpperCase() === name)
    assert.ok(entries.length === 1 && entries[0].slice(entries[0].indexOf("=") + 1) === expected, "owned target override must reach the effective environment exactly once")
  }
  return env
}

for (const runtime of ["invalid-root", "trusted-root"] as const) {
  test(`native Windows job ${runtime} keeps explicit env and literal argv`, { skip: process.platform !== "win32", timeout: 30000 }, async t => {
    const root = ownedRoot(), marker = path.join(root, "argv.json"), script = path.join(root, "literal argv.cjs")
    const args = ["", 'space 中文 & % "value"', "C:\\owned path\\", "x".repeat(2048)]
    fs.writeFileSync(script, `require('node:fs').writeFileSync(${JSON.stringify(marker)},JSON.stringify({args:process.argv.slice(2),cwd:process.cwd()}));process.stdin.resume();setTimeout(()=>{},20000);`)
    let child: ChildProcess | undefined
    const observation = observeHostileJobStartup()
    try {
      // Node itself needs a valid Windows runtime root before it can execute
      // the argv marker. The separate invalid-root control is not a retry or
      // a passing substitute for this required real argv/cwd positive.
      const hostKey = Object.keys(process.env).sort().find(key => key.toUpperCase() === "SYSTEMROOT")
      const trustedRoot = hostKey === undefined ? undefined : process.env[hostKey]
      assert.ok(typeof trustedRoot === "string" && trustedRoot.length > 0, "trusted parent runtime root is required")
      const env = hostileJobEnvironment(runtime === "invalid-root" ? root : trustedRoot, path.join(root, "fake.exe"))
      await prepareWindowsJob()
      child = spawnWindowsJob(process.execPath, [script, ...args], { env, cwd: path.relative(process.cwd(), root), stdio: "pipe" })
      observation.attach(child)
      child.stderr?.on("data", () => {})
      if (runtime === "invalid-root") {
        await until(() => observation.snapshot().close_observed, 15000)
        const observed = observation.snapshot()
        assert.equal(observed.spawn_observed, true); assert.equal(observed.error_observed, false)
        assert.equal(observed.exit_observed, true); assert.equal(observed.exit_code, 134); assert.equal(observed.exit_signal, null)
        assert.equal(observed.close_code, 134); assert.equal(observed.close_signal, null)
        assert.ok(observed.stderr_fixed_words.includes("ncrypto::CSPRNG") && observed.stderr_fixed_words.includes("node::InitializeOncePerProcessInternal"), "invalid runtime must expose the observed fixed startup assertion")
        assert.equal(fs.existsSync(marker), false, "invalid runtime must fail before target JavaScript")
      } else {
        await until(() => fs.existsSync(marker), 15000)
        const observed = JSON.parse(fs.readFileSync(marker, "utf8"))
        assert.deepEqual(observed.args, args); assert.equal(fs.realpathSync.native(observed.cwd), fs.realpathSync.native(root))
      }
    } finally { observation.emit(t); await stop(child); fs.rmSync(root, { recursive: true, force: true }) }
  })
}

test("owned hostile job environment pins effective root and shell across casing collisions", () => {
  const host = { ...JSON.parse('{"__proto__":"owned-prototype-key"}'), SYSTEMROOT: "C:\\Windows", SystemRoot: "C:\\shadow-root", COMSPEC: "C:\\Windows\\cmd.exe", ComSpec: "C:\\shadow-shell", OWNED: "retained" }
  const before = { ...host }, fake = "C:\\owned\\fake.exe"
  const bad = hostileJobEnvironment("C:\\owned", fake, host), good = hostileJobEnvironment("C:\\Windows", fake, host)
  assert.deepEqual(host, before)
  for (const [env, root] of [[bad, "C:\\owned"], [good, "C:\\Windows"]] as const) {
    const rows = windowsTargetEnvironment(env, host).toString("utf16le").split("\0").filter(Boolean)
    assert.equal(rows.filter(row => /^systemroot=/i.test(row)).length, 1)
    assert.equal(rows.filter(row => /^comspec=/i.test(row)).length, 1)
    assert.ok(rows.includes(`SystemRoot=${root}`)); assert.ok(rows.includes(`ComSpec=${fake}`))
    assert.equal(env.OWNED, "retained")
    assert.equal(Object.hasOwn(env, "__proto__"), true)
    assert.ok(rows.includes("__proto__=owned-prototype-key"), "all non-override own keys must survive the actual environment block")
  }
  const withoutRoot = (env: NodeJS.ProcessEnv) => Object.fromEntries(Object.entries(env).filter(([key]) => key.toUpperCase() !== "SYSTEMROOT"))
  assert.deepEqual(withoutRoot(bad), withoutRoot(good), "test-owned pair differs only in the effective runtime root")
})

test("native Windows owner crash reclaims its job without touching a sentinel", { skip: process.platform !== "win32", timeout: 30000 }, async () => {
  const root = ownedRoot(), f = childFixture(root, "shutdown"), controllerScript = path.join(root, "controller.cjs"), launcherMarker = path.join(root, "launcher.pid")
  const jobModule = path.resolve(__dirname, "../../src/process/windows-job.js")
  fs.writeFileSync(controllerScript, `(async()=>{const job=require(${JSON.stringify(jobModule)});await job.prepareWindowsJob();const c=job.spawnWindowsJob(process.execPath,[${JSON.stringify(f.script)}],{stdio:'ignore'});require('node:fs').writeFileSync(${JSON.stringify(launcherMarker)},String(c.pid));setTimeout(()=>{},20000)})().catch(e=>{console.error(e);process.exit(1)});`)
  const sentinel = spawn(process.execPath, ["-e", "setTimeout(()=>{},25000)"], { stdio: "ignore", windowsHide: true })
  const controller = spawn(process.execPath, [controllerScript], { stdio: ["ignore", "ignore", "pipe"], windowsHide: true })
  let errors = ""; controller.stderr!.on("data", chunk => { errors += chunk })
  let descendant = 0, launcher = 0
  try {
    await until(() => fs.existsSync(f.marker) && fs.existsSync(launcherMarker), 15000, () => `controller exit=${controller.exitCode}; ${errors}`)
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
  let errors = ""
  try {
    await prepareWindowsJob()
    child = spawnAcpChild(shim, ["owned argument"], { stdio: "pipe" }); child.stderr?.on("data", chunk => { errors += chunk })
    await until(() => fs.existsSync(marker), 15000, () => `launcher exit=${child?.exitCode}; ${errors}`); assert.deepEqual(JSON.parse(fs.readFileSync(marker, "utf8")), ["owned argument"])
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

test("hostile launcher observation keeps only finite fields and does not consume errors", () => {
  const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter() })
  const observation = observeHostileJobStartup(), records: string[] = []
  observation.attach(child as unknown as ChildProcess)
  const attack = "UNKNOWN_PRIVATE_MARKER/path/body/env"
  const error = Object.assign(new Error(attack), { code: attack })
  assert.equal(child.listenerCount("error"), 0)
  assert.throws(() => child.emit("error", error), value => value === error)
  child.emit("spawn"); child.stdout.emit("data", Buffer.from("中")); child.stderr.emit("data", "ab")
  child.emit("exit", -2147483648, attack); child.emit("close", 4294967295, "SIGTERM")
  observation.emit({ diagnostic: value => { records.push(value) } })
  const actual = JSON.parse(records[0])
  assert.deepEqual(actual, { schema: "owned-hostile-job-startup-v2", spawn_observed: true,
    error_observed: true, exit_observed: true, close_observed: true, error_code: "OTHER",
    exit_code: -2147483648, exit_signal: "OTHER", close_code: 4294967295, close_signal: "SIGTERM",
    stdout_bytes: 3, stderr_bytes: 2, stderr_fixed_words: [] })
  assert.equal(records[0].includes(attack), false)
  assert.equal(child.listenerCount("error"), 0)
})

test("hostile launcher observation distinguishes exited and pending and contains a throwing sink", () => {
  const record = (exited: boolean) => {
    const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter() })
    const observation = observeHostileJobStartup(); observation.attach(child as unknown as ChildProcess)
    if (exited) { child.emit("exit", 1, null); child.emit("close", 1, null) }
    assert.doesNotThrow(() => observation.emit({ diagnostic() { throw Error("OWNED_SINK_FAILURE") } }))
    let text = ""; observation.emit({ diagnostic: value => { text = value } }); return JSON.parse(text)
  }
  const pending = record(false), exited = record(true)
  assert.equal(pending.exit_observed, false); assert.equal(pending.close_observed, false)
  assert.equal(pending.exit_code, null); assert.equal(pending.close_code, null)
  assert.equal(exited.exit_observed, true); assert.equal(exited.close_observed, true)
  assert.equal(exited.exit_code, 1); assert.equal(exited.close_code, 1)
  const child = new EventEmitter(), observation = observeHostileJobStartup()
  observation.attach(child as unknown as ChildProcess); child.emit("exit", 4294967296, "UNKNOWN_SIGNAL")
  let text = ""; observation.emit({ diagnostic: value => { text = value } })
  assert.equal(JSON.parse(text).exit_code, null); assert.equal(JSON.parse(text).exit_signal, "OTHER")
})


test("hostile target fatal observation is bounded closed words across stderr chunks", () => {
  const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter() })
  const observation = observeHostileJobStartup(); observation.attach(child as unknown as ChildProcess)
  const words = ["ncrypto::CSPRNG", "uv_thread_create", "node::InitializeOncePerProcessInternal"]
  for (const word of words) {
    for (let offset = 1; offset < word.length; offset++) {
      child.stderr.emit("data", Buffer.from("OWNED_PRIVATE_SENTINEL/" + word.slice(0, offset)))
      child.stderr.emit("data", Buffer.from(word.slice(offset) + "/OWNED_PRIVATE_SENTINEL"))
    }
  }
  let record = ""; observation.emit({ diagnostic: value => { record = value } })
  const actual = JSON.parse(record)
  assert.equal(actual.schema, "owned-hostile-job-startup-v2")
  assert.deepEqual(actual.stderr_fixed_words, [...words].sort())
  assert.equal(record.includes("OWNED_PRIVATE_SENTINEL"), false)
  assert.equal(record.includes("/"), false)
  assert.equal(child.listenerCount("error"), 0)
})

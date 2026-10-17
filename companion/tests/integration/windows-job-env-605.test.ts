import "./_security-gates-setup"
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { type ChildProcess } from "node:child_process"
import { errorMonitor, type EventEmitter } from "node:events"
import { prepareWindowsJob, spawnWindowsJob } from "../../src/process/windows-job"
import { buildMcpStdioEnv } from "../../src/mcp/transport"
import { McpClient } from "../../src/mcp/client"
import { observeWindowsOwnerFailures } from "../fixtures/windows-owner-diagnostics"
import { observeWindowsJobPhases } from "../fixtures/windows-job-phase-diagnostics"

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
function assertProtocol(condition: boolean, details: () => string): asserts condition {
  if (condition) return
  let message = "Owned protocol assertion failed; diagnostic unavailable"
  try { message = details() } catch { /* Observation cannot replace the assertion. */ }
  assert.ok(false, message)
}
async function wait(check: () => boolean, details: () => string) {
  const deadline = Date.now() + 8000
  while (!check()) { assertProtocol(Date.now() < deadline, details); await pause(20) }
}

// Test-only observations of this owned launcher. A spawn event is not target readiness.
function observeProtocolStartup() {
  let started: number | null = null
  try { started = performance.now() } catch { /* Observation only. */ }
  const facts: Record<string, number | string | null> = {
    prepared_ms: null, spawn_return_ms: null, spawn_event_ms: null,
    stdout_first_ms: null, stderr_first_ms: null, stdin_callback_ms: null,
    error_ms: null, exit_ms: null, close_ms: null, stdout_bytes: 0, stderr_bytes: 0,
    error_code: null, exit_code: null, exit_signal: null,
  }
  const safe = (action: () => void) => { try { action() } catch { /* Passive only. */ } }
  const point = (key: string) => {
    const elapsed = started === null ? null : Math.round(performance.now() - started)
    facts[key] = elapsed !== null && Number.isSafeInteger(elapsed) && elapsed >= 0 ? elapsed : null
  }
  const code = (error: unknown) => {
    const value = (error as { code?: unknown } | null)?.code
    return ["ABORT_ERR", "ENOENT", "EACCES", "EPERM", "ETIMEDOUT", "EINVAL", "ENOMEM", "EIO", "EPIPE"].includes(value as string) ? value as string : "OTHER"
  }
  const data = (role: "stdout" | "stderr", chunk: unknown) => safe(() => {
    const bytes = Buffer.isBuffer(chunk) ? chunk.length : typeof chunk === "string" ? Buffer.byteLength(chunk) : 0
    if (bytes === 0) return
    if (facts[role + "_first_ms"] === null) point(role + "_first_ms")
    const sum = Number(facts[role + "_bytes"]) + bytes
    facts[role + "_bytes"] = Number.isSafeInteger(sum) && sum >= 0 ? sum : null
  })
  return {
    prepared: () => safe(() => point("prepared_ms")),
    spawned: (child: ChildProcess) => safe(() => {
      point("spawn_return_ms")
      child.once("spawn", () => safe(() => point("spawn_event_ms")))
      // errorMonitor preserves the existing unhandled-error behavior.
      ;(child as EventEmitter).once(errorMonitor, (error: unknown) => safe(() => { point("error_ms"); facts.error_code = code(error) }))
      child.stdout?.on("data", (chunk: unknown) => data("stdout", chunk))
      child.stderr?.on("data", (chunk: unknown) => data("stderr", chunk))
      child.once("exit", (value, signal) => safe(() => {
        point("exit_ms")
        facts.exit_code = typeof value === "number" && Number.isInteger(value) && value >= -2147483648 && value <= 4294967295 ? value : null
        facts.exit_signal = ["SIGTERM", "SIGKILL", "SIGINT", "SIGABRT", "SIGSEGV", "SIGPIPE"].includes(signal as string) ? signal : signal === null ? null : "OTHER"
      }))
      child.once("close", () => safe(() => point("close_ms")))
    }),
    written: (error?: Error | null) => safe(() => { point("stdin_callback_ms"); if (error) facts.error_code = code(error) }),
    emit: (t: { diagnostic(message: string): void }, environment: "full" | "minimal", timing: "immediate" | "ready") => safe(() => {
      if (!["full", "minimal"].includes(environment) || !["immediate", "ready"].includes(timing)) return
      t.diagnostic(JSON.stringify({ schema: "owned-protocol-startup-v1", environment, timing, ...facts }))
    }),
  }
}
async function stop(child?: ChildProcess) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  child.kill(); await wait(() => child.exitCode !== null || child.signalCode !== null, () => "owned launcher did not exit")
}

for (const environment of ["full", "minimal"] as const) {
  for (const timing of ["immediate", "ready"] as const) {
    test(`native Windows protocol with ${environment} env and ${timing} input`, { skip: process.platform !== "win32", timeout: 20000 }, async t => {
      observeWindowsOwnerFailures(t)
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-env-605-")), marker = path.join(root, "stage.json"), script = path.join(root, "echo.cjs")
      fs.writeFileSync(script, String.raw`const fs=require('node:fs');
        const env={secret:process.env.CMSPARK_ENV_HOST_SECRET,configured:process.env.CMSPARK_ENV_VALUE,empty:process.env.CMSPARK_ENV_EMPTY,largeLength:process.env.CMSPARK_ENV_LARGE?.length,carrier:Object.keys(process.env).some(k=>k.startsWith('CMSPARK_OWNED_JOB_ENV_'))};
        fs.writeFileSync(${JSON.stringify(marker)},JSON.stringify({stage:'started',cwd:process.cwd(),env}));
        process.stdout.write('READY\n');process.stderr.write('OWNED_STDERR\n');
        require('node:readline').createInterface({input:process.stdin}).on('line',line=>{
          fs.writeFileSync(${JSON.stringify(marker)},JSON.stringify({stage:'input',cwd:process.cwd(),env}));
          process.stdout.write(JSON.stringify({echo:JSON.parse(line)})+'\n');
        });setTimeout(()=>{},20000);`)
      let child: ChildProcess | undefined, output = "", errors = ""
      let phases: ReturnType<typeof observeWindowsJobPhases> | undefined
      const details = () => JSON.stringify({ environment, timing, exit: child?.exitCode, output, errors,
        target: fs.existsSync(marker) ? JSON.parse(fs.readFileSync(marker, "utf8")) : "not started", phases: phases?.snapshot() })
      const previousSecret = process.env.CMSPARK_ENV_HOST_SECRET
      const observation = observeProtocolStartup()
      process.env.CMSPARK_ENV_HOST_SECRET = "owned-probe-secret"
      try {
        phases = observeWindowsJobPhases(t, root)
        const env = { ...(environment === "minimal" ? buildMcpStdioEnv() : process.env), CMSPARK_ENV_VALUE: "中文=x&literal", CMSPARK_ENV_EMPTY: "", CMSPARK_ENV_LARGE: "中".repeat(20000) }
        await prepareWindowsJob()
        observation.prepared()
        child = spawnWindowsJob(process.execPath, [script], { env, stdio: "pipe" })
        observation.spawned(child)
        child.stdout!.on("data", chunk => { output += chunk }); child.stderr!.on("data", chunk => { errors += chunk })
        child.stdin!.on("error", error => { errors += error.message })
        if (timing === "ready") await wait(() => output.includes("READY\n"), details)
        child.stdin!.write(JSON.stringify({ owned: "中文 & literal" }) + "\n", observation.written)
        await wait(() => output.includes(JSON.stringify({ echo: { owned: "中文 & literal" } })) && errors.includes("OWNED_STDERR\n"), details)
        assertProtocol(errors.includes("OWNED_STDERR\n"), details)
        const actual = JSON.parse(fs.readFileSync(marker, "utf8"))
        assert.equal(actual.stage, "input")
        assert.deepEqual(actual.env, { ...(environment === "full" ? { secret: "owned-probe-secret" } : {}), configured: "中文=x&literal", empty: "", largeLength: 20000, carrier: false })
        assert.equal(phases.snapshot().capture_state, "complete", details())
      } catch (error) {
        observation.emit(t, environment, timing)
        throw error
      } finally {
        if (previousSecret === undefined) delete process.env.CMSPARK_ENV_HOST_SECRET
        else process.env.CMSPARK_ENV_HOST_SECRET = previousSecret
        await stop(child); fs.rmSync(root, { recursive: true, force: true })
      }
    })
  }
}

test("native Windows public MCP handshake preserves minimal child environment", { skip: process.platform !== "win32", timeout: 20000 }, async t => {
  observeWindowsOwnerFailures(t)
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-mcp-env-605-")), marker = path.join(root, "stage.json"), script = path.join(root, "mcp.cjs")
  fs.writeFileSync(script, String.raw`const fs=require('node:fs');const env={secret:process.env.CMSPARK_ENV_HOST_SECRET,configured:process.env.CMSPARK_ENV_VALUE,empty:process.env.CMSPARK_ENV_EMPTY,carrier:Object.keys(process.env).some(k=>k.startsWith('CMSPARK_OWNED_JOB_ENV_'))};fs.writeFileSync(${JSON.stringify(marker)},JSON.stringify({stage:'started',env}));
    require('node:readline').createInterface({input:process.stdin}).on('line',line=>{
      const m=JSON.parse(line);fs.writeFileSync(${JSON.stringify(marker)},JSON.stringify({stage:m.method,env}));if(m.id===undefined)return;
      const result=m.method==='initialize'?{protocolVersion:m.params.protocolVersion,capabilities:{tools:{}},serverInfo:{name:'owned',version:'1'}}
        :m.method==='tools/list'?{tools:[{name:'read_value',inputSchema:{type:'object'}}]}:{content:[{type:'text',text:'owned'}]};
      process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\n');
    });setTimeout(()=>{},20000);`)
  const previousSecret = process.env.CMSPARK_ENV_HOST_SECRET
  process.env.CMSPARK_ENV_HOST_SECRET = "owned-probe-secret"
  const client = new McpClient("owned", { transport: "stdio", command: process.execPath, args: [script], env: { CMSPARK_ENV_VALUE: "中文=x&literal", CMSPARK_ENV_EMPTY: "" }, enabled: true, trust_level: "manual", startup_timeout_ms: 8000 })
  try {
    try { await client.connect() }
    catch (error) { throw new Error(JSON.stringify({ error: String(error), lastError: client.connection.last_error, stderr: client.stderrTail,
      target: fs.existsSync(marker) ? JSON.parse(fs.readFileSync(marker, "utf8")) : "not started" }), { cause: error }) }
    assert.equal((await client.callTool("read_value", {})).content[0].text, "owned")
    assert.deepEqual(JSON.parse(fs.readFileSync(marker, "utf8")).env, { configured: "中文=x&literal", empty: "", carrier: false })
  } finally {
    if (previousSecret === undefined) delete process.env.CMSPARK_ENV_HOST_SECRET
    else process.env.CMSPARK_ENV_HOST_SECRET = previousSecret
    await client.close(); fs.rmSync(root, { recursive: true, force: true })
  }
})

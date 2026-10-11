import "./_security-gates-setup"
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { type ChildProcess } from "node:child_process"
import { spawnWindowsJob } from "../../src/process/windows-job"
import { buildMcpStdioEnv } from "../../src/mcp/transport"
import { McpClient } from "../../src/mcp/client"

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
async function wait(check: () => boolean, details: () => string) {
  const deadline = Date.now() + 8000
  while (!check()) { assert.ok(Date.now() < deadline, details()); await pause(20) }
}
async function stop(child?: ChildProcess) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  child.kill(); await wait(() => child.exitCode !== null || child.signalCode !== null, () => "owned launcher did not exit")
}

for (const environment of ["full", "minimal"] as const) {
  for (const timing of ["immediate", "ready"] as const) {
    test(`native Windows protocol with ${environment} env and ${timing} input`, { skip: process.platform !== "win32", timeout: 20000 }, async () => {
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
      const details = () => JSON.stringify({ environment, timing, exit: child?.exitCode, output, errors,
        target: fs.existsSync(marker) ? JSON.parse(fs.readFileSync(marker, "utf8")) : "not started" })
      const previousSecret = process.env.CMSPARK_ENV_HOST_SECRET
      process.env.CMSPARK_ENV_HOST_SECRET = "owned-probe-secret"
      try {
        const env = { ...(environment === "minimal" ? buildMcpStdioEnv() : process.env), CMSPARK_ENV_VALUE: "中文=x&literal", CMSPARK_ENV_EMPTY: "", CMSPARK_ENV_LARGE: "中".repeat(20000) }
        child = spawnWindowsJob(process.execPath, [script], { env, stdio: "pipe" })
        child.stdout!.on("data", chunk => { output += chunk }); child.stderr!.on("data", chunk => { errors += chunk })
        child.stdin!.on("error", error => { errors += error.message })
        if (timing === "ready") await wait(() => output.includes("READY\n"), details)
        child.stdin!.write(JSON.stringify({ owned: "中文 & literal" }) + "\n")
        await wait(() => output.includes(JSON.stringify({ echo: { owned: "中文 & literal" } })) && errors.includes("OWNED_STDERR\n"), details)
        assert.ok(errors.includes("OWNED_STDERR\n"), details())
        const actual = JSON.parse(fs.readFileSync(marker, "utf8"))
        assert.equal(actual.stage, "input")
        assert.deepEqual(actual.env, { ...(environment === "full" ? { secret: "owned-probe-secret" } : {}), configured: "中文=x&literal", empty: "", largeLength: 20000, carrier: false })
      } finally {
        if (previousSecret === undefined) delete process.env.CMSPARK_ENV_HOST_SECRET
        else process.env.CMSPARK_ENV_HOST_SECRET = previousSecret
        await stop(child); fs.rmSync(root, { recursive: true, force: true })
      }
    })
  }
}

test("native Windows public MCP handshake preserves minimal child environment", { skip: process.platform !== "win32", timeout: 20000 }, async () => {
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

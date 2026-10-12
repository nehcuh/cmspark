// Intended placement: companion/tests/integration/process-isolation-607.test.ts
// Compile/run with the existing tsconfig.test.json + node:test workflow.
// The first import isolates config before any application import.
import "./_security-gates-setup"
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { spawn, type ChildProcess } from "node:child_process"
import { OwnedStdioTransport } from "../../src/mcp/stdio-transport"
import { AcpManager } from "../../src/acp/manager"
import { initDataDir, saveConfig } from "../../src/config"

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const alive = (pid?: number) => {
  if (!pid) return false
  try { process.kill(pid, 0); return true } catch { return false }
}
async function until(check: () => boolean, budget = 20_000, detail = "owned fixture condition") {
  const deadline = Date.now() + budget
  while (!check()) {
    assert.ok(Date.now() < deadline, `${detail} timed out`)
    await pause(20)
  }
}
function rootForTest() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-607-owned-")))
}
// Only this test's held ChildProcess is terminated. Never taskkill by image,
// invoke daemon/task/service commands, or signal a PID read from user state.
async function stopOwnedController(child: ChildProcess) {
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM")
  await until(() => child.exitCode !== null || child.signalCode !== null, 5000, "owned controller exit")
}

test("MCP stderr EIO closes only its owned transport and reports the error", { timeout: 40_000 }, async () => {
  const root = rootForTest(), script = path.join(root, "ready.cjs")
  fs.writeFileSync(script, `process.stdout.write(JSON.stringify({jsonrpc:'2.0',method:'owned/ready'})+'\\n');process.stdin.resume();setTimeout(()=>{},30000);`)
  const transport = new OwnedStdioTransport({ command: process.execPath, args: [script] })
  const errors: Error[] = []
  let ready = false, closeCount = 0
  transport.onmessage = message => { if ("method" in message && message.method === "owned/ready") ready = true }
  transport.onerror = error => errors.push(error)
  transport.onclose = () => { closeCount++ }
  try {
    await transport.start()
    // Windows 'spawn' names the PowerShell launcher, not the target's readiness.
    await until(() => ready, 20_000, "native protocol target ready")
    const pid = transport.pid
    const ownChild = (transport as unknown as { child: ChildProcess }).child
    assert.ok(ownChild.stderr)
    ownChild.stderr.destroy(Object.assign(new Error("owned stderr EIO"), { code: "EIO" }))
    await until(() => closeCount === 1, 5000, "MCP local EIO teardown")
    assert.equal(errors.filter(error => error.message === "owned stderr EIO").length, 1)
    assert.equal(alive(pid), false)
    await Promise.all([transport.close(), transport.close()])
    assert.equal(closeCount, 1)
    // An unhandled stream error makes node:test fail before this assertion.
    assert.ok(true, "host test runner survived the peer stream error")
  } finally {
    await transport.close()
    fs.rmSync(root, { recursive: true, force: true })
  }
})

for (const protocol of ["acp", "auto"] as const) {
  test(`true ${protocol} respects configured prompt deadline after native startup`, { timeout: 45_000 }, async () => {
    await initDataDir()
    const root = rootForTest(), script = path.join(root, "hung-acp.cjs"), marker = path.join(root, "prompt.json")
    fs.writeFileSync(script, `process.on('SIGTERM',()=>{});require('node:readline').createInterface({input:process.stdin}).on('line',line=>{
      const m=JSON.parse(line);
      if(m.method==='session/prompt'){require('node:fs').writeFileSync(${JSON.stringify(marker)},JSON.stringify({pid:process.pid,at:Date.now()}));return}
      if(m.id!==undefined)process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:m.method==='initialize'?{protocolVersion:1,agentCapabilities:{},agentInfo:{name:'owned',version:'1'}}:{sessionId:'owned'}})+'\\n');
    });setTimeout(()=>{},30000);`)
    saveConfig({ acp: { enabled: true, policy: { require_workspace: true, force_confirm_session_start: true, default_profile: "review_readonly" }, servers: {
      owned: { display_name: "Owned deadline fixture", transport: "stdio", enabled: true, command: process.execPath, args: [script], protocol,
        policy: { profile: "review_readonly", session_timeout_ms: 2000, max_handback_chars: 1000 } },
    } }, coding_handoff: { open_local_terminal: false } })
    const manager = new AcpManager()
    let pending: ReturnType<AcpManager["start"]> | undefined
    try {
      const offered = manager.propose({ threadId: protocol, agentId: "owned", goal: "owned policy deadline fixture", workspaceRoot: root })
      assert.ok(offered.ok)
      let settled = false
      pending = manager.start(offered.session.session_id).then(result => { settled = true; return result })
      // Exclude Windows Add-Type/CreateProcess startup from the prompt deadline.
      await until(() => fs.existsSync(marker), 20_000, "real ACP prompt received")
      const observed = JSON.parse(fs.readFileSync(marker, "utf8")) as { pid: number; at: number }
      // The prompt timed out, but an agent ignoring TERM still owns its slot.
      if (process.platform !== "win32") {
        await pause(2200)
        assert.equal(alive(observed.pid), true, "fixture deliberately ignores TERM")
        assert.equal(manager.propose({ threadId: "during-teardown", agentId: "owned", goal: "must wait", workspaceRoot: root }).ok, false)
      }
      await until(() => settled, 7000, "configured ACP policy expiry")
      const result = await pending
      assert.equal(result.ok, false)
      if (!result.ok) assert.match(result.error, /timeout|timed out|deadline/i)
      assert.equal(offered.session.state, "closed")
      assert.ok(Date.now() - observed.at < 7000, "the 15-minute fallback deadline must not win")
      await until(() => !alive(observed.pid), 5000, "owned ACP target reaped")
      const next = manager.propose({ threadId: "next", agentId: "owned", goal: "slot released", workspaceRoot: root })
      assert.ok(next.ok, "policy expiry releases the old session slot")
    } finally {
      await manager.shutdown()
      await pending
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
}

// The separate controller loads the compiled real manager only after isolation,
// and its nested CLI is reclaimed through manager.shutdown on every path.
// The controller holds an original process handle; Windows nested CLI ownership
// is the existing Job Object with an owner watcher, not a raw taskkill/PID loop.
const memoryController = String.raw`
const fs=require('node:fs'),path=require('node:path');
const [base,root,mode]=process.argv.slice(2);
process.env.CMSPARK_DATA_DIR=root;process.env.HOME=root;process.env.CMSPARK_SKIP_LOGIN_ENV='1';
const {AcpManager}=require(path.join(base,'acp','manager.js'));
const {initDataDir,saveConfig}=require(path.join(base,'config.js'));
const script=path.join(root,'large-owned-cli.cjs');
fs.writeFileSync(script,
  "const fs=require('node:fs'),path=require('node:path');const root="+JSON.stringify(root)+",mode="+JSON.stringify(mode)+";"+
  "const chunk=mode==='newline'?('x'.repeat(1023)+'\\n').repeat(64):'x'.repeat(65536);"+
  "const waitAck=n=>new Promise(resolve=>{const t=setInterval(()=>{if(fs.existsSync(path.join(root,'ack'+n))){clearInterval(t);resolve()}},10)});"+
  "(async()=>{for(let round=0;round<3;round++){await waitAck(round);for(let i=0;i<128;i++)await new Promise((resolve,reject)=>process.stdout.write(chunk,err=>err?reject(err):resolve()));}await waitAck(3)})();setTimeout(()=>{},60000);"
);
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
(async()=>{
 const manager=new AcpManager();let pending,child;
 // A harness timeout must reclaim its detached POSIX CLI before the controller
 // exits; Windows also retains its existing owner/job crash protection.
 process.on('SIGTERM',()=>{void manager.shutdown().finally(()=>process.exit(1))});
 try{
  await initDataDir();saveConfig({acp:{enabled:true,policy:{require_workspace:true,force_confirm_session_start:true,default_profile:'review_readonly'},servers:{owned:{display_name:'Owned memory fixture',transport:'stdio',enabled:true,command:process.execPath,args:[script],protocol:'cli',policy:{profile:'review_readonly',max_handback_chars:1000,session_timeout_ms:50000}}}},coding_handoff:{open_local_terminal:false}});
  const offered=manager.propose({threadId:'owned',agentId:'owned',goal:'bounded line fixture',workspaceRoot:root});if(!offered.ok)throw Error(JSON.stringify(offered));
  let startResult;pending=manager.start(offered.session.session_id).then(result=>{startResult=result;return result});
  // Cold Windows ownership preparation is asynchronous. Observe the actual
  // tracked child before sampling; never warm the cache or skip native spawn.
  const startupDeadline=Date.now()+20000;
  while(!(child=manager.processes.get(offered.session.session_id))){
   if(startResult)throw Error('owned startup ended before tracking: '+JSON.stringify(startResult));
   if(Date.now()>startupDeadline)throw Error('owned child tracking deadline');await pause(10);
  }
  child.stderr.on('data',()=>{});let bytes=0;child.stdout.on('data',buf=>{bytes+=buf.length});
  const sample=async phase=>{await pause(50);for(let i=0;i<3;i++)global.gc();await pause(30);console.log(JSON.stringify({ownedMemory:true,mode,phase,bytes,heap:process.memoryUsage().heapUsed,agentTextChars:offered.session.agent_text?.length||0,state:offered.session.state}));};
  await sample(0);
  for(let round=0;round<3;round++){
   fs.writeFileSync(path.join(root,'ack'+round),'go');const target=(round+1)*8388608,deadline=Date.now()+20000;
   while(bytes<target){if(Date.now()>deadline)throw Error('owned stream deadline');await pause(10)}await sample(round+1);
  }
 }finally{await manager.shutdown();await pending;}
})().catch(error=>{console.error(error);process.exitCode=1});
`

test("CLI no-newline retention stays bounded beside equal-byte newline control", { timeout: 150_000 }, async () => {
  const roots: string[] = []
  const samples = new Map<string, Array<{ phase: number; bytes: number; heap: number; agentTextChars: number }>>()
  try {
    for (const mode of ["continuous", "newline"]) {
      const root = rootForTest(); roots.push(root)
      const controller = path.join(root, "controller.cjs")
      fs.writeFileSync(controller, memoryController)
      const child = spawn(process.execPath, ["--expose-gc", "--max-old-space-size=192", controller, path.resolve(__dirname, "../../src"), root, mode], {
        env: { ...process.env, CMSPARK_DATA_DIR: root, HOME: root, CMSPARK_SKIP_LOGIN_ENV: "1" },
        stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
      })
      let output = "", errors = ""
      child.stdout!.on("data", chunk => { output += chunk })
      child.stderr!.on("data", chunk => { errors = (errors + chunk).slice(-10_000) })
      // Start errors must not become an unhandled ChildProcess event.
      let launchError: Error | undefined
      child.on("error", error => { launchError = error })
      try {
        await until(() => child.exitCode !== null || child.signalCode !== null || !!launchError, 70_000, `owned ${mode} controller`)
        assert.equal(launchError, undefined)
        assert.equal(child.exitCode, 0, output + "\n" + errors)
        const rows = output.split("\n").filter(line => line.startsWith("{")).map(line => JSON.parse(line)).filter(row => row.ownedMemory)
        assert.equal(rows.length, 4, output + "\n" + errors)
        assert.equal(rows[3].bytes, 24 * 1024 * 1024)
        assert.equal(rows[3].agentTextChars, 1000)
        samples.set(mode, rows)
      } finally {
        await stopOwnedController(child)
      }
    }
    const continuous = samples.get("continuous")!, newline = samples.get("newline")!
    const retained = continuous[3].heap - continuous[0].heap
    const controlRetained = newline[3].heap - newline[0].heap
    // Old code retains ~23 MiB versus ~0.5 MiB control. Leave generous room
    // for Node/V8/platform variation while still catching the 24-MiB buffer.
    assert.ok(retained <= Math.max(4 * 1024 * 1024, controlRetained + 2 * 1024 * 1024),
      JSON.stringify({ retained, controlRetained, continuous, newline }))
  } finally {
    for (const root of roots) fs.rmSync(root, { recursive: true, force: true })
  }
})


test("failed ACP session setup reaps the resistant peer before auto CLI fallback", { timeout: 40000 }, async () => {
  await initDataDir()
  const root = rootForTest(), script = path.join(root, "fallback.cjs"), first = path.join(root, "first.json"), second = path.join(root, "second.json")
  fs.writeFileSync(script, `const fs=require('node:fs'),first=${JSON.stringify(first)},second=${JSON.stringify(second)};
    if(fs.existsSync(first)){const old=JSON.parse(fs.readFileSync(first));let alive=false;try{process.kill(old.pid,0);alive=true}catch{};fs.writeFileSync(second,JSON.stringify({alive}));process.stdout.write('owned CLI result'+String.fromCharCode(10));}
    else {fs.writeFileSync(first,JSON.stringify({pid:process.pid}));process.on('SIGTERM',()=>{});require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(m.id===undefined)return;process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,...(m.method==='session/new'?{error:{code:-32603,message:'owned setup failure'}}:{result:{protocolVersion:1,agentCapabilities:{},agentInfo:{name:'owned',version:'1'}}})})+String.fromCharCode(10))});setTimeout(()=>{},30000);}`)
  saveConfig({ acp: { enabled: true, policy: { require_workspace: true, force_confirm_session_start: true, default_profile: "review_readonly" }, servers: {
    owned: { display_name: "Owned fallback fixture", transport: "stdio", enabled: true, command: process.execPath, args: [script], protocol: "auto", policy: { profile: "review_readonly", session_timeout_ms: 5000 } },
  } }, coding_handoff: { open_local_terminal: false } })
  const manager = new AcpManager()
  try {
    const offered = manager.propose({ threadId: "fallback", agentId: "owned", goal: "owned setup failure", workspaceRoot: root })
    assert.ok(offered.ok)
    const result = await manager.start(offered.session.session_id)
    assert.ok(result.ok, JSON.stringify(result))
    assert.equal(JSON.parse(fs.readFileSync(second, "utf8")).alive, false, "fallback cannot overlap the rejected protocol peer")
    assert.match(offered.session.agent_text ?? "", /owned CLI result/)
  } finally { await manager.shutdown(); fs.rmSync(root, { recursive: true, force: true }) }
})

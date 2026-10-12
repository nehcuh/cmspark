// Intended companion/tests/integration/acp-slot-boundaries-607.test.ts.
// All scripts/PIDs are created by this fixture. Never register a service/task.
import "./_security-gates-setup"
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { AcpManager } from "../../src/acp/manager"
import { initDataDir, saveConfig } from "../../src/config"

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
const alive = (pid: number) => { try { process.kill(pid, 0); return true } catch { return false } }
async function until(check: () => boolean, budget = 20_000) {
  const deadline = Date.now() + budget
  while (!check()) { assert.ok(Date.now() < deadline, "owned ACP fixture deadline"); await pause(10) }
}

for (const mode of ["init-fail", "new-fail", "success", "failure", "cancel", "startup-cancel"] as const) {
  test(`ACP admission waits for owned process close: ${mode}`, { timeout: 45_000 }, async () => {
    await initDataDir()
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-607-slot-")))
    const script = path.join(root, "owned.cjs"), proto = path.join(root, "protocol.json")
    const newStage = path.join(root, "new.json"), prompt = path.join(root, "prompt.json"), cli = path.join(root, "cli.json")
    fs.writeFileSync(script, `const fs=require('node:fs');const mode=${JSON.stringify(mode)};process.on('SIGTERM',()=>{});let raw=false;
      const publish=(file,value)=>{fs.writeFileSync(file+'.tmp',JSON.stringify(value));fs.renameSync(file+'.tmp',file)};
      const write=(id,result,error)=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',id,...(error?{error:{code:-1,message:error}}:{result})})+String.fromCharCode(10));
      require('node:readline').createInterface({input:process.stdin}).on('line',line=>{
        let m;try{m=JSON.parse(line)}catch{
          if(raw)return;raw=true;const old=JSON.parse(fs.readFileSync(${JSON.stringify(proto)},'utf8'));
          let oldAlive=true;try{process.kill(old.pid,0)}catch{oldAlive=false}
          publish(${JSON.stringify(cli)},{pid:process.pid,oldAlive});
          process.stdout.write('owned cli');setTimeout(()=>process.exit(0),100);return;
        }
        if(m.method==='initialize'){
          publish(${JSON.stringify(proto)},{pid:process.pid});
          if(mode==='init-fail')write(m.id,null,'owned initialize rejected');
          else write(m.id,{protocolVersion:1,agentCapabilities:{},agentInfo:{name:'owned',version:'1'}});
        }
        if(m.method==='session/new'){
          fs.writeFileSync(${JSON.stringify(newStage)},'new');
          if(mode==='new-fail')write(m.id,null,'owned new rejected');
          else if(mode==='startup-cancel')setTimeout(()=>write(m.id,{sessionId:'owned'}),500);
          else write(m.id,{sessionId:'owned'});
        }
        if(m.method==='session/prompt'){
          fs.writeFileSync(${JSON.stringify(prompt)},'prompt');
          if(mode==='success')write(m.id,{stopReason:'end_turn'});
          if(mode==='failure')write(m.id,null,'owned prompt rejected');
        }
      });setTimeout(()=>{},30000);`)
    saveConfig({ acp: { enabled: true, policy: { require_workspace: true, force_confirm_session_start: true, default_profile: "review_readonly" }, servers: {
      owned: { display_name: "Owned slot fixture", transport: "stdio", enabled: true, command: process.execPath, args: [script],
        protocol: mode === "init-fail" || mode === "new-fail" ? "auto" : "acp",
        policy: { profile: "review_readonly", session_timeout_ms: 10_000, max_handback_chars: 1000 } },
    } }, coding_handoff: { open_local_terminal: false } })
    const manager = new AcpManager()
    let pending: ReturnType<AcpManager["start"]> | undefined
    const offerReplacement = (threadId: string) => manager.propose({ threadId, agentId: "owned", goal: "replacement", workspaceRoot: root })
    try {
      const offered = manager.propose({ threadId: "old", agentId: "owned", goal: "owned lifecycle fixture", workspaceRoot: root })
      assert.ok(offered.ok)
      let settled = false
      pending = manager.start(offered.session.session_id).then(result => { settled = true; return result })
      if (mode === "init-fail" || mode === "new-fail") {
        await until(() => fs.existsSync(cli))
        assert.equal(JSON.parse(fs.readFileSync(cli, "utf8")).oldAlive, false, "CLI fallback cannot overlap its probe agent")
        assert.equal((await pending).ok, true)
        assert.equal(offered.session.transport, "cli")
      } else {
        await until(() => fs.existsSync(mode === "startup-cancel" ? newStage : prompt))
        const pid = JSON.parse(fs.readFileSync(proto, "utf8")).pid as number
        if (mode === "cancel" || mode === "startup-cancel") manager.cancel(offered.session.session_id)
        if (process.platform !== "win32") {
          // Windows terminates the owned launcher/job immediately; POSIX must
          // preserve admission through the deliberate SIGTERM grace window.
          await pause(100)
          assert.equal(alive(pid), true)
          assert.equal(settled, false)
          const blocked = offerReplacement("during-close")
          assert.equal(blocked.ok, false)
          if (!blocked.ok) assert.match(blocked.error, /ACP_SESSION_BUSY/)
        }
        const result = await pending
        assert.equal(result.ok, mode === "success")
        assert.equal(alive(pid), false, "terminal result cannot precede owned target exit")
        assert.equal(offered.session.state, "closed")
        assert.equal(fs.existsSync(cli), false, "explicit ACP cancellation never becomes CLI fallback")
      }
      assert.ok(offerReplacement("after-close").ok)
    } finally {
      await manager.shutdown()
      await pending
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
}

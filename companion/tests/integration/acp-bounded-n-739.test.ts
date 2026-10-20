/** #739 CI-only real owned Node bridges. Not a configured Agent/provider or PTY.
 * Local CPU producers are separate; this fixture must run on actual Windows. */
import test, { after } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

let dataRoot: string | undefined, previousDataDir: string | undefined
after(() => {
  if (!dataRoot) return
  if (previousDataDir === undefined) delete process.env.CMSPARK_DATA_DIR; else process.env.CMSPARK_DATA_DIR = previousDataDir
  fs.rmSync(dataRoot, { recursive: true, force: true })
})

for (const n of [1, 2, 4] as const) test(`#739 Windows owned bridge capacity N=${n}, same-agent refusal and isolated cancellation`, {
  skip: process.platform !== "win32", timeout: 45_000,
}, async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-739-owned-")))
  if (!dataRoot) {
    previousDataDir = process.env.CMSPARK_DATA_DIR
    dataRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-739-data-")))
    process.env.CMSPARK_DATA_DIR = dataRoot
  }
  const { initDataDir, saveConfig } = await import("../../src/config")
  const { AcpManager } = await import("../../src/acp/manager")
  await initDataDir()
  const script = path.join(root, "owned.cjs")
  fs.writeFileSync(script, `const fs=require('node:fs');const marker=process.argv[2];
    fs.writeFileSync(marker+'.pending',JSON.stringify({pid:process.pid}),{flag:'wx',mode:0o600});fs.renameSync(marker+'.pending',marker);
    process.stdin.resume();setInterval(()=>{},1000);`, { flag: "wx", mode: 0o600 })
  const servers: Record<string, any> = {}
  for (let i = 0; i <= n; i++) servers[`owned${i}`] = { display_name: `Owned bridge ${i}`, transport: "stdio", enabled: true,
    command: process.execPath, args: [script, path.join(root, `${i}.json`)], protocol: "cli",
    policy: { profile: "review_readonly", session_timeout_ms: 10_000, max_handback_chars: 1000 } }
  saveConfig({ acp: { enabled: true, max_concurrent_sessions: n, servers, policy: { require_workspace: true, force_confirm_session_start: true, default_profile: "review_readonly" } }, coding_handoff: { open_local_terminal: false } })
  const manager = new AcpManager(), pending: Array<Promise<any>> = [], settled: boolean[] = [], pids: number[] = []
  const alive = (pid: number) => { try { process.kill(pid, 0); return true } catch { return false } }
  const offer = (agentId: string, threadId: string) => {
    const r = manager.propose({ agentId, threadId, workspaceRoot: root, goal: "owned capacity fixture" })
    assert.ok(r.ok); return r.session
  }
  try {
    const rows = Array.from({ length: n }, (_, i) => offer(`owned${i}`, `owner${i}`))
    for (let i = 0; i < n; i++) {
      settled[i] = false
      const p = manager.start(rows[i].session_id)
      // Observe rejection immediately; retain original promise for finally.
      void p.then(() => { settled[i] = true }, () => { settled[i] = true }); pending.push(p)
    }
    const deadline = Date.now() + 20_000
    while (!rows.every((_, i) => fs.existsSync(path.join(root, `${i}.json`)))) {
      assert.equal(settled.some(Boolean), false, "owned bridge must not settle before overlap")
      assert.ok(Date.now() < deadline, "owned bridge marker deadline")
      await new Promise(resolve => setTimeout(resolve, 10))
    }
    for (let i = 0; i < n; i++) pids.push(JSON.parse(fs.readFileSync(path.join(root, `${i}.json`), "utf8")).pid)
    assert.equal(new Set(pids).size, n); assert.ok(pids.every(pid => Number.isInteger(pid) && pid > 0 && alive(pid)))
    assert.ok(rows.every(row => row.execution_phase === "running"))
    const duplicate = offer("owned0", "different-thread")
    assert.equal(manager.checkStartAdmission(duplicate.session_id).ok, false)
    const overflow = offer(`owned${n}`, "overflow")
    assert.equal((await manager.start(overflow.session_id)).ok, false)
    manager.cancel(rows[0].session_id)
    await pending[0]
    assert.equal(alive(pids[0]), false, "cancel result requires actual owned close")
    assert.equal(rows[0].execution_phase, "released")
    assert.ok(pids.slice(1).every(alive), "cancelling one owned bridge must not terminate siblings")
    assert.ok(rows.slice(1).every(row => row.execution_phase === "running"))
    assert.equal(manager.checkStartAdmission(duplicate.session_id).ok, true, "same agent can enter only after its true close")
    assert.equal(manager.checkStartAdmission(overflow.session_id).ok, true, "only one completed claim was released")
    if (n > 1) {
      const stillActiveAgent = offer("owned1", "same-agent-with-free-capacity")
      const denied = await manager.start(stillActiveAgent.session_id)
      assert.equal(denied.ok, false, "same agent remains single while an unrelated free slot exists")
      assert.ok(pids.slice(1).every(alive))
    }
  } finally {
    await manager.shutdown()
    await Promise.allSettled(pending)
    fs.rmSync(root, { recursive: true, force: true })
  }
})

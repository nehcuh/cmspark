/**
 * C6 multi-adv: WORKER_HARD_DENY re-enforced at isToolAllowed + thread.update filter.
 */
import test, { before, after } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-whd-"))
process.env.HOME = tempHome
process.env.CMSPARK_DATA_DIR = path.join(tempHome, ".cmspark-agent")

let ThreadManager: typeof import("../src/threads/thread-manager").ThreadManager
let WORKER_HARD_DENY: typeof import("../src/orchestrator/constants").WORKER_HARD_DENY
let initDataDir: typeof import("../src/config").initDataDir

before(async () => {
  const configMod = await import("../src/config")
  initDataDir = configMod.initDataDir
  await initDataDir()
  ThreadManager = (await import("../src/threads/thread-manager")).ThreadManager
  WORKER_HARD_DENY = (await import("../src/orchestrator/constants")).WORKER_HARD_DENY
})

after(() => {
  fs.rmSync(tempHome, { recursive: true, force: true })
})

test("C6 isToolAllowed: worker denies HARD_DENY even if whitelist includes them", () => {
  const tm = new ThreadManager()
  const t = tm.create("worker-hd-1")
  tm.update(t.id, {
    agent_role: "worker",
    tool_whitelist: ["list_tabs", "shell_exec", "host_computer", "evaluate"],
  } as any)
  assert.equal(tm.isToolAllowed(t.id, "list_tabs"), true)
  assert.equal(tm.isToolAllowed(t.id, "evaluate"), true)
  assert.equal(tm.isToolAllowed(t.id, "shell_exec"), false)
  assert.equal(tm.isToolAllowed(t.id, "host_computer"), false)
  assert.equal(tm.isToolAllowed(t.id, "spawn_worker"), false)
  assert.equal(tm.isToolAllowed(t.id, "spawn_expert_team"), false)
  assert.equal(tm.isToolAllowed(t.id, "propose_expert_team"), false)
  for (const tool of WORKER_HARD_DENY) {
    assert.equal(tm.isToolAllowed(t.id, tool), false, `worker must deny ${tool}`)
  }
})

test("C6 isToolAllowed: normal thread with null whitelist allows shell", () => {
  const tm = new ThreadManager()
  const t = tm.create("normal-hd-1")
  assert.equal(t.tool_whitelist, null)
  assert.equal(tm.isToolAllowed(t.id, "shell_exec"), true)
})

test("C6 isToolAllowed: worker with null whitelist still denies HARD_DENY", () => {
  const tm = new ThreadManager()
  const t = tm.create("worker-hd-null")
  tm.update(t.id, { agent_role: "worker", tool_whitelist: null } as any)
  // null whitelist would mean full surface for normal; worker still hard-denies
  assert.equal(tm.isToolAllowed(t.id, "list_tabs"), true)
  assert.equal(tm.isToolAllowed(t.id, "shell_exec"), false)
  assert.equal(tm.isToolAllowed(t.id, "host_write"), false)
})

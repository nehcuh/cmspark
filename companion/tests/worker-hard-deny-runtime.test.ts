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

test("worker tool settings inherit concrete parent grants and obey later revocation", async () => {
  const { handleMessage } = await import("../src/message-router")
  const { spawnWorkerThread } = await import("../src/orchestrator/spawn")
  const tm = new ThreadManager()
  const services = { threadManager: tm, skillEngine: {} as any, historyStore: {} as any }
  const update = (threadId: string, updates: object) => handleMessage({ type: "thread.update", thread_id: threadId, updates }, services)
  const parent = tm.create("restricted parent")
  tm.update(parent.id, { tool_whitelist: ["get_page_text", "browser_download", "evaluate", "shell_exec"] })
  const first = spawnWorkerThread(tm, { parentThreadId: parent.id, userConfirmed: true, roleAllow: ["get_page_text"], roleDeny: ["evaluate"] })
  assert.ok(first.ok)
  const worker = first.worker
  assert.deepEqual(worker.tool_whitelist, ["get_page_text"])
  const second = spawnWorkerThread(tm, { parentThreadId: parent.id, userConfirmed: true, roleAllow: ["host_read", "get_page_text", "navigate"] })
  assert.ok(second.ok)
  assert.deepEqual(second.worker.tool_whitelist, ["get_page_text"], "promotion retains a custom parent grant")

  const inherited = await update(worker.id, { inherit_parent_tools: true })
  assert.equal(inherited.type, "thread.updated")
  assert.deepEqual(new Set(inherited.thread.tool_whitelist), new Set(["get_page_text", "browser_download"]))
  assert.equal(tm.isToolAllowed(worker.id, "browser_download"), true)
  assert.equal(tm.isToolAllowed(worker.id, "shell_exec"), false)
  assert.equal(tm.isToolAllowed(worker.id, "evaluate"), false)
  tm.update(parent.id, { tool_whitelist: ["get_page_text"] })
  assert.equal(tm.isToolAllowed(worker.id, "browser_download"), false)
  const custom = await update(worker.id, { tool_whitelist: ["get_page_text", "browser_download", "shell_exec"] })
  assert.deepEqual(custom.thread.tool_whitelist, ["get_page_text"])
  assert.equal((await update(worker.id, { tool_whitelist: null })).type, "error")
})

test("unrestricted parent delegates eligible tools only on request and role settings stay bounded", async () => {
  const { handleMessage } = await import("../src/message-router")
  const { spawnWorkerThread } = await import("../src/orchestrator/spawn")
  const tm = new ThreadManager()
  const services = { threadManager: tm, skillEngine: {} as any, historyStore: {} as any }
  const inherit = (threadId: string) => handleMessage({ type: "thread.update", thread_id: threadId, updates: { inherit_parent_tools: true } }, services)
  const parent = tm.create("normal parent")
  const result = spawnWorkerThread(tm, { parentThreadId: parent.id, userConfirmed: true })
  assert.ok(result.ok)
  assert.ok(!result.worker.tool_whitelist.includes("browser_download"))
  const saved = await inherit(result.worker.id)
  assert.equal(saved.type, "thread.updated")
  assert.ok(saved.thread.tool_whitelist.includes("browser_download"))
  assert.ok(!saved.thread.tool_whitelist.includes("spawn_worker"))
  assert.ok(!saved.thread.tool_whitelist.includes("shell_exec"))

  tm.update(result.worker.id, { mission_pack_id: "role", tool_whitelist: ["get_page_text"] })
  assert.deepEqual((await inherit(result.worker.id)).thread.tool_whitelist, ["get_page_text"])
  tm.update(result.worker.id, { parent_thread_id: "missing" })
  assert.equal((await inherit(result.worker.id)).type, "error")
  assert.equal((await inherit(parent.id)).type, "error")
})

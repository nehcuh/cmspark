/**
 * SEC-A: thread_id must not escape ~/.cmspark-agent/threads/
 */
import test, { before } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-thread-path-"))

let initDataDir: typeof import("../src/config").initDataDir
let getConfigDir: typeof import("../src/config").getConfigDir
let ThreadManager: typeof import("../src/threads/thread-manager").ThreadManager

before(async () => {
  process.env.HOME = tempHome
  process.env.CMSPARK_DATA_DIR = path.join(tempHome, ".cmspark-agent")
  delete process.env.DEEPSEEK_API_KEY
  const config = await import("../src/config")
  const tm = await import("../src/threads/thread-manager")
  initDataDir = config.initDataDir
  getConfigDir = config.getConfigDir
  ThreadManager = tm.ThreadManager
  await initDataDir()
})

test("isSafeThreadId rejects path traversal and separators", () => {
  assert.equal(ThreadManager.isSafeThreadId("../config"), false)
  assert.equal(ThreadManager.isSafeThreadId("..\\config"), false)
  assert.equal(ThreadManager.isSafeThreadId("foo/bar"), false)
  assert.equal(ThreadManager.isSafeThreadId("a".repeat(65)), false)
  assert.equal(ThreadManager.isSafeThreadId("ok-id_01"), true)
})

test("addMessage with ../config does not write outside threads/", () => {
  const manager = new ThreadManager()
  const dataDir = getConfigDir()
  const configPath = path.join(dataDir, "config.json")
  const before = fs.existsSync(configPath) ? fs.readFileSync(configPath, "utf-8") : null

  assert.throws(
    () => manager.addMessage("../config", { thread_id: "../config", role: "user", content: "pwn" } as any),
    /Invalid thread id/,
  )

  // config.json content unchanged (no overwrite via path escape)
  if (before !== null) {
    assert.equal(fs.readFileSync(configPath, "utf-8"), before)
  }
  const threadsDir = path.join(dataDir, "threads")
  if (fs.existsSync(threadsDir)) {
    for (const f of fs.readdirSync(threadsDir)) {
      assert.ok(!f.includes(".."), `unexpected thread file name: ${f}`)
    }
  }
})

test("delete with ../config does not unlink config.json", () => {
  const manager = new ThreadManager()
  const dataDir = getConfigDir()
  const configPath = path.join(dataDir, "config.json")
  fs.writeFileSync(configPath, JSON.stringify({ keep: true }), "utf-8")
  manager.delete("../config")
  assert.ok(fs.existsSync(configPath))
  assert.equal(JSON.parse(fs.readFileSync(configPath, "utf-8")).keep, true)
})

test("getMessages with unsafe id returns empty", () => {
  const manager = new ThreadManager()
  assert.deepEqual(manager.getMessages("../config"), [])
  assert.deepEqual(manager.getMessages("foo/bar"), [])
})

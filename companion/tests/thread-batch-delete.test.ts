/**
 * Thread History IA P0 — batch_delete contract tests.
 * Pins: max 50, busy reject, trust release per id, continue-on-fail, previews.
 */
import "./_threads-history-setup.js"
import test, { after, before, beforeEach } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-agent-test-batch-delete-"))

let ThreadManager: typeof import("../src/threads/thread-manager").ThreadManager
let getConfigDir: typeof import("../src/config").getConfigDir
let initDataDir: typeof import("../src/config").initDataDir
let handleMessage: typeof import("../src/message-router").handleMessage
let __testSetLlmActiveForTests: typeof import("../src/message-router").__testSetLlmActiveForTests

before(async () => {
  process.env.HOME = tempHome
  delete process.env.DEEPSEEK_API_KEY

  const configMod = await import("../src/config")
  getConfigDir = configMod.getConfigDir
  initDataDir = configMod.initDataDir
  await initDataDir()

  const tmMod = await import("../src/threads/thread-manager")
  ThreadManager = tmMod.ThreadManager

  const routerMod = await import("../src/message-router")
  handleMessage = routerMod.handleMessage
  __testSetLlmActiveForTests = routerMod.__testSetLlmActiveForTests
})

after(() => {
  fs.rmSync(tempHome, { recursive: true, force: true })
})

beforeEach(() => {
  const threadsDir = path.join(getConfigDir(), "threads")
  if (fs.existsSync(threadsDir)) {
    for (const f of fs.readdirSync(threadsDir)) {
      try {
        fs.rmSync(path.join(threadsDir, f), { recursive: true, force: true })
      } catch {
        /* ignore */
      }
    }
  }
})

function services(tm: InstanceType<typeof ThreadManager>) {
  return { threadManager: tm, skillEngine: {} as any, historyStore: {} as any }
}

function makeSession() {
  const broadcasts: any[] = []
  return {
    broadcasts,
    session: {
      sendToExtension: () => {},
      executeTool: async () => ({ success: true }),
      broadcast: (m: any) => {
        broadcasts.push(m)
      },
    },
  }
}

test("listWithPreviews includes first user message", () => {
  const tm = new ThreadManager()
  const t = tm.create("T1", "prev1")
  tm.addMessage(t.id, { thread_id: t.id, role: "user", content: "帮我对比三家 SaaS 定价方案" })
  tm.addMessage(t.id, { thread_id: t.id, role: "assistant", content: "ok" })
  const list = tm.listWithPreviews()
  const row = list.find((x) => x.id === "prev1")
  assert.ok(row)
  assert.match(row!.first_user_preview, /对比三家/)
})

test("batch_delete: deletes multiple, broadcasts per id, returns ok", async () => {
  const tm = new ThreadManager()
  tm.create("A", "ba")
  tm.create("B", "bb")
  const c = tm.create("C", "bc")
  assert.equal(tm.list().length, 3)

  const { session, broadcasts } = makeSession()
  const resp = await handleMessage(
    { type: "thread.batch_delete", thread_ids: ["ba", "bb"], mode: "trash" },
    services(tm),
    session as any,
  )

  assert.equal(resp?.type, "thread.batch_deleted")
  assert.equal(resp.mode, "trash")
  assert.deepEqual([...resp.ok].sort(), ["ba", "bb"])
  assert.equal(resp.failed.length, 0)
  // soft-delete: excluded from default list, still on disk
  assert.equal(tm.list().length, 1)
  assert.equal(tm.list()[0].id, c.id)
  assert.ok(tm.get("ba")?.trashed_at)
  assert.equal(broadcasts.filter((m) => m.type === "thread.trashed").length, 2)
})

test("batch_delete: not_found continues", async () => {
  const tm = new ThreadManager()
  tm.create("A", "ok1")
  const { session } = makeSession()
  const resp = await handleMessage(
    { type: "thread.batch_delete", thread_ids: ["ok1", "missing-id"], mode: "hard" },
    services(tm),
    session as any,
  )
  assert.equal(resp?.type, "thread.batch_deleted")
  assert.deepEqual(resp.ok, ["ok1"])
  assert.equal(resp.failed.length, 1)
  assert.equal(resp.failed[0].id, "missing-id")
  assert.equal(resp.failed[0].reason, "not_found")
})

test("batch_delete: max 50 enforced", async () => {
  const tm = new ThreadManager()
  const ids = Array.from({ length: 51 }, (_, i) => `id${i}`)
  const { session } = makeSession()
  const resp = await handleMessage(
    { type: "thread.batch_delete", thread_ids: ids },
    services(tm),
    session as any,
  )
  assert.equal(resp?.type, "error")
  assert.match(String(resp.error), /max 50/)
})

test("batch_delete: rejects busy threads, deletes free ones", async () => {
  const tm = new ThreadManager()
  tm.create("Busy", "busy1")
  tm.create("Free", "free1")
  __testSetLlmActiveForTests("busy1", true)
  try {
    const { session, broadcasts } = makeSession()
    const resp = await handleMessage(
      { type: "thread.batch_delete", thread_ids: ["busy1", "free1"], mode: "hard" },
      services(tm),
      session as any,
    )
    assert.equal(resp?.type, "thread.batch_deleted")
    assert.deepEqual(resp.ok, ["free1"])
    assert.equal(resp.failed.length, 1)
    assert.equal(resp.failed[0].id, "busy1")
    assert.equal(resp.failed[0].reason, "thread_busy")
    assert.equal(tm.get("busy1")?.id, "busy1")
    assert.equal(tm.get("free1"), undefined)
    assert.equal(broadcasts.length, 1)
    assert.equal(broadcasts[0].thread_id, "free1")
  } finally {
    __testSetLlmActiveForTests("busy1", false)
  }
})

test("batch_delete: empty thread_ids errors", async () => {
  const tm = new ThreadManager()
  const { session } = makeSession()
  const resp = await handleMessage(
    { type: "thread.batch_delete", thread_ids: [] },
    services(tm),
    session as any,
  )
  assert.equal(resp?.type, "error")
})

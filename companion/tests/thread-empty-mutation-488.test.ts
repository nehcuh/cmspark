import test, { before, after } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { validateWsMessage } from "../src/ws/validate"

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-488-empty-mutation-"))
process.env.CMSPARK_DATA_DIR = dir
let ThreadManager: typeof import("../src/threads/thread-manager").ThreadManager
let handleMessage: typeof import("../src/message-router").handleMessage
let setBusy: typeof import("../src/message-router").__testSetLlmActiveForTests
before(async () => {
  await (await import("../src/config")).initDataDir()
  ThreadManager = (await import("../src/threads/thread-manager")).ThreadManager
  const router = await import("../src/message-router")
  handleMessage = router.handleMessage
  setBusy = router.__testSetLlmActiveForTests
})
after(() => { fs.rmSync(dir, { recursive: true, force: true }) })

test("empty cleanup rechecks durable content, trash and busy after confirmation", async () => {
  const tm = new ThreadManager()
  const ids = ["empty", "became-nonempty", "trashed", "busy", "missing"]
  for (const id of ids.slice(0, -1)) tm.create(id, id)
  // At confirmation time every candidate was empty. Then other work changes it.
  tm.addMessage("became-nonempty", { thread_id: "became-nonempty", role: "user", content: "keep this conversation" })
  tm.trash("trashed")
  setBusy("busy", true)
  const broadcasts: any[] = []
  try {
    const response = await handleMessage({ type: "thread.batch_delete", thread_ids: ids, mode: "hard", only_empty: true },
      { threadManager: tm, skillEngine: {} as any, historyStore: {} as any },
      { broadcast: (msg: any) => broadcasts.push(msg) } as any)
    assert.deepEqual(response, {
      type: "thread.batch_deleted", ok: ["empty"],
      failed: [
        { id: "became-nonempty", reason: "not_empty" },
        { id: "trashed", reason: "trashed" },
        { id: "busy", reason: "thread_busy" },
        { id: "missing", reason: "not_found" },
      ], deleted_ids: ["empty"], deleted_count: 1, mode: "hard",
    })
    assert.equal(tm.get("empty"), undefined)
    assert.equal(tm.getMessages("became-nonempty")[0].content, "keep this conversation")
    assert.ok(tm.get("trashed")?.trashed_at)
    assert.ok(tm.get("busy"))
    assert.deepEqual(broadcasts.map(b => b.thread_id), ["empty"])
  } finally { setBusy("busy", false) }
})

test("only_empty malformed/soft modes fail closed; legacy hard deletion is unchanged", async () => {
  const tm = new ThreadManager()
  tm.create("legacy", "legacy")
  tm.addMessage("legacy", { thread_id: "legacy", role: "user", content: "explicit regular hard delete remains available" })
  const services = { threadManager: tm, skillEngine: {} as any, historyStore: {} as any }
  for (const extra of [{ mode: "trash", only_empty: true }, { mode: "hard", only_empty: "true" }]) {
    const message = { type: "thread.batch_delete", thread_ids: ["legacy"], ...extra }
    assert.equal(validateWsMessage(message).valid, false)
    assert.equal((await handleMessage(message, services))?.type, "error")
    assert.ok(tm.get("legacy"))
  }
  const response = await handleMessage({ type: "thread.batch_delete", thread_ids: ["legacy"], mode: "hard" }, services)
  assert.deepEqual(response.ok, ["legacy"])
  assert.equal(tm.get("legacy"), undefined)
})

test("capability probe has empty targets and cannot mutate; malformed probes are rejected", async () => {
  const tm = new ThreadManager()
  tm.create("probe-keep", "probe-keep")
  const services = { threadManager: tm, skillEngine: {} as any, historyStore: {} as any }
  const probe = { type: "thread.batch_delete", thread_ids: [], probe: "only_empty" }
  assert.equal(validateWsMessage(probe).valid, true)
  assert.deepEqual(await handleMessage(probe, services), { type: "thread.batch_delete.capabilities", only_empty: true })
  for (const malformed of [
    { ...probe, thread_ids: ["probe-keep"], mode: "hard" },
    { ...probe, probe: "unknown" },
  ]) {
    assert.equal(validateWsMessage(malformed).valid, false)
    assert.equal((await handleMessage(malformed, services))?.type, "error")
  }
  assert.ok(tm.get("probe-keep"))
})

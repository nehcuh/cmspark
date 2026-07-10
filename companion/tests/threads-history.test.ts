import "./_threads-history-setup.js"
import test, { after, before, beforeEach, describe } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-agent-test-threads-history-"))

let ThreadManager: typeof import("../src/threads/thread-manager").ThreadManager
let HistoryStore: typeof import("../src/history/store").HistoryStore
let getConfigDir: typeof import("../src/config").getConfigDir
let initDataDir: typeof import("../src/config").initDataDir

before(async () => {
  process.env.HOME = tempHome
  delete process.env.DEEPSEEK_API_KEY

  const threadManagerMod = await import("../src/threads/thread-manager")
  const historyMod = await import("../src/history/store")
  const configMod = await import("../src/config")

  ThreadManager = threadManagerMod.ThreadManager
  HistoryStore = historyMod.HistoryStore
  getConfigDir = configMod.getConfigDir
  initDataDir = configMod.initDataDir

  await initDataDir()
})

after(() => {
  fs.rmSync(tempHome, { recursive: true, force: true })
})

// Each test assumes a clean ThreadManager (e.g. "list returns all threads in reverse creation
// order" asserts exactly 2 threads it just created). The file shares one DATA_DIR, so without
// wiping threads/ between tests, earlier tests' threads accumulate and break count/ordering
// assertions. Clear the threads directory before every test.
beforeEach(() => {
  const threadsDir = path.join(getConfigDir(), "threads")
  if (fs.existsSync(threadsDir)) {
    for (const f of fs.readdirSync(threadsDir)) {
      try { fs.rmSync(path.join(threadsDir, f), { recursive: true, force: true }) } catch { /* ignore */ }
    }
  }
})

// ============================================
// ThreadManager Tests
// ============================================

describe("ThreadManager - Normal Paths", () => {
  test("create thread with alias only", () => {
    const tm = new ThreadManager()
    const thread = tm.create("Test Thread")
    assert.equal(thread.alias, "Test Thread")
    assert.ok(thread.id, "thread should have an id")
    assert.equal(thread.tool_whitelist, null)
    assert.deepEqual(thread.pinned_tabs, [])
    assert.deepEqual(thread.active_skill_ids, ["browse"])
    assert.ok(thread.created_at, "should have created_at")
    assert.ok(thread.updated_at, "should have updated_at")
  })

  test("create thread with explicit id", () => {
    const tm = new ThreadManager()
    const thread = tm.create("Custom ID Thread", "my-custom-id")
    assert.equal(thread.id, "my-custom-id")
    assert.equal(thread.alias, "Custom ID Thread")
  })

  test("create thread with config_override", () => {
    const tm = new ThreadManager()
    const config = { temperature: 0.5, model_name: "gpt-4" }
    const thread = tm.create("Config Thread", undefined, config)
    assert.equal(thread.config_override.temperature, 0.5)
    assert.equal(thread.config_override.model_name, "gpt-4")
  })

  test("list returns all threads in reverse creation order", () => {
    const tm = new ThreadManager()
    tm.create("First")
    tm.create("Second")
    const list = tm.list()
    assert.equal(list.length, 2)
    assert.equal(list[0].alias, "Second")
    assert.equal(list[1].alias, "First")
  })

  test("get returns existing thread", () => {
    const tm = new ThreadManager()
    const created = tm.create("Gettable")
    const found = tm.get(created.id)
    assert.ok(found, "should find thread")
    assert.equal(found!.alias, "Gettable")
  })

  test("get returns undefined for nonexistent id", () => {
    const tm = new ThreadManager()
    assert.equal(tm.get("nonexistent-id"), undefined)
  })

  test("update modifies thread fields", () => {
    const tm = new ThreadManager()
    const thread = tm.create("Update Me")
    const createdAt = thread.updated_at // capture value: update() mutates the same object in-place
    const updated = tm.update(thread.id, { alias: "Updated" })
    assert.ok(updated, "update should return thread")
    assert.equal(updated!.alias, "Updated")
    assert.ok(updated!.updated_at > createdAt, "updated_at should be newer")
  })

  test("update with config_override validates and sanitizes", () => {
    const tm = new ThreadManager()
    const thread = tm.create("Config Update")
    const updated = tm.update(thread.id, { config_override: { temperature: 0.9 } })
    assert.equal(updated!.config_override.temperature, 0.9)
  })

  test("update accepts all valid mcp_selection_mode values", () => {
    const tm = new ThreadManager()
    const thread = tm.create("MCP Mode")
    for (const mode of ["auto", "all", "manual"] as const) {
      const updated = tm.update(thread.id, { mcp_selection_mode: mode })
      assert.equal(updated!.mcp_selection_mode, mode)
    }
  })

  test("update rejects invalid mcp_selection_mode", () => {
    const tm = new ThreadManager()
    const thread = tm.create("MCP Mode Bad")
    assert.throws(
      () => tm.update(thread.id, { mcp_selection_mode: "unknown" as any }),
      /Invalid mcp_selection_mode/,
    )
  })

  test("update accepts active_mcp_server_ids array", () => {
    const tm = new ThreadManager()
    const thread = tm.create("MCP Servers")
    const updated = tm.update(thread.id, { active_mcp_server_ids: ["filesystem", "brave-search"] })
    assert.deepEqual(updated!.active_mcp_server_ids, ["filesystem", "brave-search"])
  })

  test("delete removes thread from index and filesystem", () => {
    const tm = new ThreadManager()
    const thread = tm.create("Delete Me")
    const threadFile = path.join(getConfigDir(), "threads", `${thread.id}.json`)
    assert.ok(fs.existsSync(threadFile), "thread file should exist before delete")
    tm.delete(thread.id)
    assert.equal(tm.get(thread.id), undefined)
    assert.ok(!fs.existsSync(threadFile), "thread file should be deleted")
  })

  test("cleanupEmpty removes only threads without messages", () => {
    const tm = new ThreadManager()
    const emptyA = tm.create("Empty A")
    const emptyB = tm.create("Empty B")
    const withMessage = tm.create("Has Message")
    tm.addMessage(withMessage.id, { thread_id: withMessage.id, role: "user", content: "hello" })

    const deletedIds = tm.cleanupEmpty()

    assert.ok(deletedIds.includes(emptyA.id), "should delete empty thread A")
    assert.ok(deletedIds.includes(emptyB.id), "should delete empty thread B")
    assert.ok(!deletedIds.includes(withMessage.id), "should not delete thread with messages")
    assert.equal(tm.get(emptyA.id), undefined)
    assert.equal(tm.get(emptyB.id), undefined)
    assert.ok(tm.get(withMessage.id), "thread with messages should be kept")
  })

  test("addMessage stores message and returns it with id and created_at", () => {
    const tm = new ThreadManager()
    const thread = tm.create("Message Test")
    const msg = tm.addMessage(thread.id, { thread_id: thread.id, role: "user", content: "hello" })
    assert.ok(msg.id, "message should have id")
    assert.ok(msg.created_at, "message should have created_at")
    assert.equal(msg.role, "user")
    assert.equal(msg.content, "hello")
  })

  test("getMessages returns all messages for thread", () => {
    const tm = new ThreadManager()
    const thread = tm.create("Messages Test")
    tm.addMessage(thread.id, { thread_id: thread.id, role: "user", content: "msg1" })
    tm.addMessage(thread.id, { thread_id: thread.id, role: "assistant", content: "msg2" })
    const messages = tm.getMessages(thread.id)
    assert.equal(messages.length, 2)
    assert.equal(messages[0].content, "msg1")
    assert.equal(messages[1].content, "msg2")
  })

  test("updateMessage modifies message content", () => {
    const tm = new ThreadManager()
    const thread = tm.create("Update Message Test")
    const msg = tm.addMessage(thread.id, { thread_id: thread.id, role: "user", content: "original" })
    tm.updateMessage(thread.id, msg.id, { content: "modified" })
    const messages = tm.getMessages(thread.id)
    assert.equal(messages[0].content, "modified")
  })

  test("deleteMessagesFrom removes messages from given point onwards", () => {
    const tm = new ThreadManager()
    const thread = tm.create("Delete From Test")
    const msg1 = tm.addMessage(thread.id, { thread_id: thread.id, role: "user", content: "1" })
    const msg2 = tm.addMessage(thread.id, { thread_id: thread.id, role: "user", content: "2" })
    const msg3 = tm.addMessage(thread.id, { thread_id: thread.id, role: "user", content: "3" })
    const result = tm.deleteMessagesFrom(thread.id, msg2.id)
    assert.equal(result, true)
    const messages = tm.getMessages(thread.id)
    assert.equal(messages.length, 1)
    assert.equal(messages[0].content, "1")
  })
})

describe("ThreadManager - Abnormal/Boundary Paths", () => {
  test("create with empty alias sanitizes to empty string", () => {
    const tm = new ThreadManager()
    const thread = tm.create("")
    assert.equal(thread.alias, "")
  })

  test("create with non-string alias coerces to empty string", () => {
    const tm = new ThreadManager()
    const thread = tm.create(null as any)
    assert.equal(thread.alias, "")
  })

  test("create with alias containing control characters strips them", () => {
    const tm = new ThreadManager()
    const thread = tm.create("Hello\x00World\x1F\x7F")
    assert.equal(thread.alias, "HelloWorld")
  })

  test("create with alias > 200 chars truncates", () => {
    const tm = new ThreadManager()
    const longAlias = "a".repeat(300)
    const thread = tm.create(longAlias)
    assert.equal(thread.alias.length, 200)
  })

  test("create with invalid id sanitizes to valid id", () => {
    const tm = new ThreadManager()
    const thread = tm.create("Bad ID", "bad@id#with!chars")
    assert.ok(!thread.id.includes("@"))
    assert.ok(!thread.id.includes("#"))
    assert.ok(!thread.id.includes("!"))
  })

  test("create with empty string id generates random id", () => {
    const tm = new ThreadManager()
    const thread = tm.create("Empty ID", "")
    assert.ok(thread.id.length > 0, "should generate an id")
  })

  test("create with id > 64 chars truncates", () => {
    const tm = new ThreadManager()
    const longId = "a".repeat(100)
    const thread = tm.create("Long ID", longId)
    assert.equal(thread.id.length, 64)
  })

  test("create with invalid config_override throws", () => {
    const tm = new ThreadManager()
    assert.throws(() => {
      tm.create("Bad Config", undefined, { invalid_key: "value" })
    }, /Unknown config_override key/)
  })

  test("create with prototype pollution keys throws", () => {
    const tm = new ThreadManager()
    assert.throws(() => {
      // JSON.parse creates `__proto__` as an OWN key (the real threat vector — config arrives
      // as JSON over WS). The object literal `{__proto__: ...}` would just set the prototype and
      // not surface as an own key, so it's not a valid pollution PoC.
      tm.create("Proto", undefined, JSON.parse('{"__proto__":"pollute"}') as any)
    }, /Invalid config key/)
    assert.throws(() => {
      tm.create("Proto", undefined, { constructor: "pollute" } as any)
    }, /Invalid config key/)
  })

  test("create with out-of-range number throws", () => {
    const tm = new ThreadManager()
    assert.throws(() => {
      tm.create("Big Num", undefined, { temperature: 2000000 })
    }, /out of range/)
    assert.throws(() => {
      tm.create("Neg Big Num", undefined, { temperature: -2000000 })
    }, /out of range/)
  })

  test("create with string exceeding max length throws", () => {
    const tm = new ThreadManager()
    assert.throws(() => {
      tm.create("Long String", undefined, { model_name: "x".repeat(3000) })
    }, /exceeds max length/)
  })

  test("update with invalid config_override throws", () => {
    const tm = new ThreadManager()
    const thread = tm.create("Update Config")
    assert.throws(() => {
      tm.update(thread.id, { config_override: { invalid_key: "value" } })
    }, /Unknown config_override key/)
  })

  test("getMessages returns empty array for nonexistent thread", () => {
    const tm = new ThreadManager()
    const messages = tm.getMessages("nonexistent")
    assert.deepEqual(messages, [])
  })

  test("addMessage creates new file if thread file missing", () => {
    const tm = new ThreadManager()
    const thread = tm.create("Missing File")
    const threadFile = path.join(getConfigDir(), "threads", `${thread.id}.json`)
    fs.unlinkSync(threadFile)
    const msg = tm.addMessage(thread.id, { thread_id: thread.id, role: "user", content: "hello" })
    assert.ok(msg.id, "should still create message")
    assert.ok(fs.existsSync(threadFile), "should recreate file")
  })

  test("addMessage trims messages when exceeding cap", () => {
    const tm = new ThreadManager()
    const thread = tm.create("Cap Test")
    // Add MAX_MESSAGES_PER_THREAD + 150 messages
    for (let i = 0; i < 1150; i++) {
      tm.addMessage(thread.id, { thread_id: thread.id, role: "user", content: `msg${i}` })
    }
    const messages = tm.getMessages(thread.id)
    assert.equal(messages.length, 1000, "should cap at 1000 messages")
    assert.equal(messages[0].content, "msg150", "should trim oldest messages")
  })

  test("deleteMessagesFrom returns false for nonexistent message", () => {
    const tm = new ThreadManager()
    const thread = tm.create("Delete From")
    const result = tm.deleteMessagesFrom(thread.id, "nonexistent-msg")
    assert.equal(result, false)
  })

  test("deleteMessagesFrom returns false for nonexistent thread", () => {
    const tm = new ThreadManager()
    const result = tm.deleteMessagesFrom("nonexistent", "msg")
    assert.equal(result, false)
  })

  test("handles corrupted thread JSON gracefully", () => {
    const tm = new ThreadManager()
    const thread = tm.create("Corrupted")
    const threadFile = path.join(getConfigDir(), "threads", `${thread.id}.json`)
    fs.writeFileSync(threadFile, "not json at all {{{")
    const messages = tm.getMessages(thread.id)
    assert.deepEqual(messages, [], "should return empty array for corrupted file")
    // Should still be able to add messages
    const msg = tm.addMessage(thread.id, { thread_id: thread.id, role: "user", content: "works" })
    assert.equal(msg.content, "works")
  })

  test("handles corrupted index JSON by returning empty threads", () => {
    const tm = new ThreadManager()
    tm.create("Before Corruption")
    // Corrupt the index
    const indexPath = path.join(getConfigDir(), "threads", "index.json")
    fs.writeFileSync(indexPath, "corrupted json")
    // Create new instance to trigger reload
    const tm2 = new ThreadManager()
    assert.deepEqual(tm2.list(), [], "should return empty threads for corrupted index")
  })

  test("concurrent writes do not corrupt index", () => {
    const tm = new ThreadManager()
    const threads: string[] = []
    // Create multiple threads rapidly
    for (let i = 0; i < 50; i++) {
      threads.push(tm.create(`Concurrent ${i}`).id)
    }
    const list = tm.list()
    assert.equal(list.length, 50, "all threads should exist")
    // Verify all IDs are unique
    const uniqueIds = new Set(list.map(t => t.id))
    assert.equal(uniqueIds.size, 50, "all IDs should be unique")
  })
})

// ============================================
// HistoryStore Tests
// ============================================

describe("HistoryStore - Normal Paths", () => {
  test("record and query operations", async () => {
    const store = new HistoryStore()
    await store.waitReady()
    const id = store.record({
      thread_id: "thread-1",
      tool_name: "test_tool",
      params: '{"key": "value"}',
      result_summary: "success",
      error: null,
      success: 1,
      duration_ms: 100,
      created_at: new Date().toISOString(),
    })
    assert.ok(id > 0, "should return positive id")
    const results = store.query({ thread_id: "thread-1" })
    assert.equal(results.length, 1)
    assert.equal(results[0].tool_name, "test_tool")
  })

  test("query filters by tool_name", async () => {
    const store = new HistoryStore()
    await store.waitReady()
    store.record({ thread_id: "thread-2", tool_name: "tool_a", params: "{}", result_summary: "", error: null, success: 1, duration_ms: 0, created_at: new Date().toISOString() })
    store.record({ thread_id: "thread-2", tool_name: "tool_b", params: "{}", result_summary: "", error: null, success: 1, duration_ms: 0, created_at: new Date().toISOString() })
    const results = store.query({ thread_id: "thread-2", tool_name: "tool_a" })
    assert.equal(results.length, 1)
    assert.equal(results[0].tool_name, "tool_a")
  })

  test("query filters by keyword", async () => {
    const store = new HistoryStore()
    await store.waitReady()
    store.record({ thread_id: "thread-3", tool_name: "search", params: "{}", result_summary: "found hello world", error: null, success: 1, duration_ms: 0, created_at: new Date().toISOString() })
    store.record({ thread_id: "thread-3", tool_name: "fetch", params: "{}", result_summary: "nothing here", error: null, success: 1, duration_ms: 0, created_at: new Date().toISOString() })
    const results = store.query({ thread_id: "thread-3", keyword: "hello" })
    assert.equal(results.length, 1)
    assert.ok(results[0].result_summary.includes("hello"))
  })

  test("query with date range", async () => {
    const store = new HistoryStore()
    await store.waitReady()
    const now = new Date()
    const yesterday = new Date(now)
    yesterday.setDate(yesterday.getDate() - 1)
    const tomorrow = new Date(now)
    tomorrow.setDate(tomorrow.getDate() + 1)
    store.record({ thread_id: "thread-4", tool_name: "test", params: "{}", result_summary: "", error: null, success: 1, duration_ms: 0, created_at: now.toISOString() })
    const results = store.query({ thread_id: "thread-4", from: yesterday.toISOString(), to: tomorrow.toISOString() })
    assert.equal(results.length, 1)
  })

  test("query with limit and offset", async () => {
    const store = new HistoryStore()
    await store.waitReady()
    for (let i = 0; i < 5; i++) {
      store.record({ thread_id: "thread-5", tool_name: `tool_${i}`, params: "{}", result_summary: "", error: null, success: 1, duration_ms: 0, created_at: new Date().toISOString() })
    }
    const allResults = store.query({ thread_id: "thread-5" })
    assert.equal(allResults.length, 5)
    const limited = store.query({ thread_id: "thread-5", limit: 2 })
    assert.equal(limited.length, 2)
    const offset = store.query({ thread_id: "thread-5", limit: 2, offset: 2 })
    assert.equal(offset.length, 2)
    assert.notEqual(offset[0].tool_name, limited[0].tool_name)
  })

  test("exportJSON returns all matching records without limit", async () => {
    const store = new HistoryStore()
    await store.waitReady()
    for (let i = 0; i < 5; i++) {
      store.record({ thread_id: "thread-6", tool_name: `tool_${i}`, params: "{}", result_summary: "", error: null, success: 1, duration_ms: 0, created_at: new Date().toISOString() })
    }
    const exported = store.exportJSON({ thread_id: "thread-6" })
    assert.equal(exported.length, 5)
  })

  test("record with error stores error text", async () => {
    const store = new HistoryStore()
    await store.waitReady()
    store.record({ thread_id: "thread-7", tool_name: "fail", params: "{}", result_summary: "", error: "Something went wrong", success: 0, duration_ms: 0, created_at: new Date().toISOString() })
    const results = store.query({ thread_id: "thread-7" })
    assert.equal(results.length, 1)
    assert.equal(results[0].error, "Something went wrong")
    assert.equal(results[0].success, 0)
  })
})

describe("HistoryStore - Abnormal/Boundary Paths", () => {
  test("query returns empty array when db not initialized", async () => {
    const store = new HistoryStore()
    await store.waitReady()
    // Close the db to simulate failure
    store.close()
    const results = store.query({ thread_id: "thread-x" })
    assert.deepEqual(results, [])
  })

  test("record returns 0 when db not initialized", async () => {
    const store = new HistoryStore()
    await store.waitReady()
    store.close()
    const id = store.record({ thread_id: "thread-x", tool_name: "test", params: "{}", result_summary: "", error: null, success: 1, duration_ms: 0, created_at: new Date().toISOString() })
    assert.equal(id, 0)
  })

  test("query with no matching filters returns empty", async () => {
    const store = new HistoryStore()
    await store.waitReady()
    const results = store.query({ thread_id: "nonexistent-thread" })
    assert.deepEqual(results, [])
  })

  test("query with empty params returns all records up to default limit", async () => {
    const store = new HistoryStore()
    await store.waitReady()
    for (let i = 0; i < 5; i++) {
      store.record({ thread_id: "thread-empty", tool_name: `tool_${i}`, params: "{}", result_summary: "", error: null, success: 1, duration_ms: 0, created_at: new Date().toISOString() })
    }
    const results = store.query({})
    assert.ok(results.length >= 5, "should return at least the 5 records we added")
  })

  test("handles large number of records", async () => {
    const store = new HistoryStore()
    await store.waitReady()
    for (let i = 0; i < 500; i++) {
      store.record({
        thread_id: "thread-bulk",
        tool_name: `tool_${i}`,
        params: JSON.stringify({ index: i }),
        result_summary: `Result ${i}`,
        error: null,
        success: 1,
        duration_ms: i,
        created_at: new Date().toISOString(),
      })
    }
    const results = store.query({ thread_id: "thread-bulk", limit: 1000 })
    assert.equal(results.length, 500)
    // Verify order is DESC by created_at
    for (let i = 0; i < results.length - 1; i++) {
      assert.ok(results[i].created_at >= results[i + 1].created_at, "should be ordered descending")
    }
  })

  test("exportJSON with date range filters correctly", async () => {
    const store = new HistoryStore()
    await store.waitReady()
    const oldDate = "2020-01-01T00:00:00.000Z"
    const newDate = "2024-01-01T00:00:00.000Z"
    store.record({ thread_id: "thread-dates", tool_name: "old", params: "{}", result_summary: "", error: null, success: 1, duration_ms: 0, created_at: oldDate })
    store.record({ thread_id: "thread-dates", tool_name: "new", params: "{}", result_summary: "", error: null, success: 1, duration_ms: 0, created_at: newDate })
    const exported = store.exportJSON({ thread_id: "thread-dates", from: "2023-01-01T00:00:00.000Z" })
    assert.equal(exported.length, 1)
    assert.equal(exported[0].tool_name, "new")
  })

  test("handles special characters in keyword search", async () => {
    const store = new HistoryStore()
    await store.waitReady()
    store.record({ thread_id: "thread-special", tool_name: "test", params: "{}", result_summary: "hello%world_test", error: null, success: 1, duration_ms: 0, created_at: new Date().toISOString() })
    const results = store.query({ thread_id: "thread-special", keyword: "%world" })
    assert.equal(results.length, 1)
  })

  test("close is idempotent", async () => {
    const store = new HistoryStore()
    await store.waitReady()
    store.close()
    // Should not throw
    store.close()
    assert.ok(true)
  })
})

// ============================================
// Integration Tests
// ============================================

describe("Integration: ThreadManager + HistoryStore", () => {
  test("full workflow: create thread, add messages, record operations, query", async () => {
    const tm = new ThreadManager()
    const store = new HistoryStore()
    await store.waitReady()

    const thread = tm.create("Integration Test")
    tm.addMessage(thread.id, { thread_id: thread.id, role: "user", content: "Hello" })
    tm.addMessage(thread.id, { thread_id: thread.id, role: "assistant", content: "Hi there" })

    store.record({
      thread_id: thread.id,
      tool_name: "respond",
      params: "{}",
      result_summary: "Responded to user",
      error: null,
      success: 1,
      duration_ms: 150,
      created_at: new Date().toISOString(),
    })

    const messages = tm.getMessages(thread.id)
    assert.equal(messages.length, 2)

    const history = store.query({ thread_id: thread.id })
    assert.equal(history.length, 1)
    assert.equal(history[0].tool_name, "respond")

    tm.delete(thread.id)
    assert.equal(tm.get(thread.id), undefined)
  })
})

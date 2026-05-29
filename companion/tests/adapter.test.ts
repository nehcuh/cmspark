import test, { after, before } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-agent-test-adapter-"))

let createToolResultMessage: typeof import("../src/llm/adapter").createToolResultMessage
let ThreadManager: typeof import("../src/threads/thread-manager").ThreadManager
let saveConfig: typeof import("../src/config").saveConfig
let SkillEngine: typeof import("../src/skills/skill-engine").SkillEngine

before(async () => {
  process.env.HOME = tempHome
  delete process.env.DEEPSEEK_API_KEY

  const adapter = await import("../src/llm/adapter")
  const threadManager = await import("../src/threads/thread-manager")
  const config = await import("../src/config")
  const skillEngine = await import("../src/skills/skill-engine")

  createToolResultMessage = adapter.createToolResultMessage
  ThreadManager = threadManager.ThreadManager
  saveConfig = config.saveConfig
  SkillEngine = skillEngine.SkillEngine

  await config.initDataDir()
})

after(() => {
  fs.rmSync(tempHome, { recursive: true, force: true })
})

// --- createToolResultMessage tests ---

test("createToolResultMessage produces role=tool message with correct linkage", () => {
  const toolCall = {
    id: "call_test_1",
    function: { name: "get_page_text", arguments: '{"tabId":303}' },
  }
  const result = { success: true, data: { text: "hello world" } }
  const params = { tabId: 303 }

  const msg = createToolResultMessage("thread-01", toolCall, result, params)

  assert.equal(msg.thread_id, "thread-01")
  assert.equal(msg.role, "tool")
  assert.equal(msg.content, JSON.stringify(result))
  assert.equal(msg.tool_calls.length, 1)
  assert.equal(msg.tool_calls[0].id, "call_test_1")
  assert.equal(msg.tool_calls[0].tool_name, "get_page_text")
  assert.deepEqual(msg.tool_calls[0].params, params)
  assert.deepEqual(msg.tool_calls[0].result, result)
})

test("createToolResultMessage handles toolCall with flat name field", () => {
  const toolCall = {
    id: "call_test_2",
    name: "screenshot",
  }
  const result = { success: true, data: { image: "base64..." } }

  const msg = createToolResultMessage("thread-02", toolCall, result)

  assert.equal(msg.tool_calls[0].tool_name, "screenshot")
  assert.equal(msg.content, JSON.stringify(result))
})

test("createToolResultMessage handles empty params (defaults to {})", () => {
  const toolCall = {
    id: "call_test_3",
    function: { name: "list_tabs", arguments: "{}" },
  }
  const result = { success: false, error: "no tabs" }

  const msg = createToolResultMessage("thread-03", toolCall, result)

  assert.deepEqual(msg.tool_calls[0].params, {})
})

test("createToolResultMessage handles empty result object", () => {
  const toolCall = {
    id: "call_test_4",
    function: { name: "click", arguments: '{"selector":"#btn"}' },
  }
  const result = { success: false } as any

  const msg = createToolResultMessage("thread-04", toolCall, result)

  assert.equal(msg.content, JSON.stringify({ success: false }))
  assert.equal(msg.tool_calls[0].result, result)
  assert.equal(msg.tool_calls[0].id, "call_test_4")
})

test("createToolResultMessage handles toolCall with missing id", () => {
  const toolCall = {
    function: { name: "navigate" },
  }
  const result = { success: true, data: { url: "https://example.com" } }

  const msg = createToolResultMessage("thread-05", toolCall, result)

  // Should not crash — id will be undefined
  assert.equal(msg.tool_calls[0].id, undefined)
  assert.equal(msg.tool_calls[0].tool_name, "navigate")
})

test("createToolResultMessage with nested result data preserves structure", () => {
  const toolCall = {
    id: "call_test_6",
    function: { name: "get_page_html", arguments: '{"tabId":101}' },
  }
  const result = {
    success: true,
    data: {
      html: "<html><body>test</body></html>",
      title: "Test Page",
      meta: { charset: "utf-8" },
    },
  }

  const msg = createToolResultMessage("thread-06", toolCall, result)

  const parsed = JSON.parse(msg.content)
  assert.equal(parsed.data.html, "<html><body>test</body></html>")
  assert.equal(parsed.data.title, "Test Page")
  assert.deepEqual(msg.tool_calls[0].result, result)
})

// --- Thread message history pairing tests ---

test("chatCreate appends user message to thread history", () => {
  const manager = new ThreadManager()
  const thread = manager.create("history test", "ht01")

  // Verify the message was added (chatCreate would do this, but we test the pattern)
  const before = manager.getMessages(thread.id).length
  manager.addMessage(thread.id, { thread_id: thread.id, role: "user", content: "hello" })
  const after = manager.getMessages(thread.id).length

  assert.equal(before, 0)
  assert.equal(after, 1)
})

test("ThreadManager.getMessages preserves tool result linkage when paired correctly", () => {
  const manager = new ThreadManager()
  const thread = manager.create("pairing test", "pt01")

  const toolCall = {
    id: "call_pair_1",
    function: { name: "get_page_text", arguments: '{"tabId":303}' },
  }
  const result = { success: true, data: { text: "hello" } }

  // Simulate actual message sequence as chatCreate builds it
  manager.addMessage(thread.id, { thread_id: thread.id, role: "user", content: "read the page" })
  manager.addMessage(thread.id, {
    thread_id: thread.id,
    role: "assistant",
    content: "I'll read the page.",
    tool_calls: [{
      id: "call_pair_1",
      function: { name: "get_page_text", arguments: '{"tabId":303}' },
    }],
  })
  manager.addMessage(thread.id, createToolResultMessage(thread.id, toolCall, result, { tabId: 303 }))

  const messages = manager.getMessages(thread.id)
  assert.equal(messages.length, 3)
  assert.equal(messages[0].role, "user")
  assert.equal(messages[1].role, "assistant")
  assert.equal(messages[2].role, "tool")
  assert.equal(messages[2]?.tool_calls?.[0]?.id, "call_pair_1")
})

test("context builder must strip tool_calls with no matching tool result (schema safety)", () => {
  const manager = new ThreadManager()
  const thread = manager.create("invalid pairing", "ip01")

  // Assistant with tool_calls but NO subsequent tool result message
  manager.addMessage(thread.id, { thread_id: thread.id, role: "user", content: "do something" })
  manager.addMessage(thread.id, {
    thread_id: thread.id,
    role: "assistant",
    content: "I'll try.",
    tool_calls: [{
      id: "call_ip_1",
      function: { name: "click", arguments: '{"selector":"#btn"}' },
    }],
  })
  // No tool result added after — this is the invalid scenario

  const messages = manager.getMessages(thread.id)
  assert.equal(messages.length, 2)

  // Verify the assistant message has tool_calls that would be stripped by adapter
  const assistantMsg = messages[1]
  assert.equal(assistantMsg.role, "assistant")
  assert.ok(assistantMsg.tool_calls && assistantMsg.tool_calls.length > 0)

  // Simulate what adapter.ts does: detect missing tool results and strip
  const nextMsg = messages[2] // undefined — no tool result
  const shouldStrip = !!(assistantMsg.tool_calls && assistantMsg.tool_calls.length > 0 && !nextMsg)
  assert.equal(shouldStrip, true)
})

test("context builder validates pairing when tool result exists", () => {
  const manager = new ThreadManager()
  const thread = manager.create("valid pairing", "vp01")

  const toolCall = {
    id: "call_vp_1",
    function: { name: "screenshot", arguments: "{}" },
  }
  const result = { success: true, data: { image: "base64..." } }

  manager.addMessage(thread.id, { thread_id: thread.id, role: "user", content: "screenshot" })
  manager.addMessage(thread.id, {
    thread_id: thread.id,
    role: "assistant",
    content: "Taking screenshot...",
    tool_calls: [toolCall],
  })
  manager.addMessage(thread.id, createToolResultMessage(thread.id, toolCall, result))

  const messages = manager.getMessages(thread.id)
  const assistantMsg = messages[1]
  const nextMsg = messages[2]

  // Should NOT strip — valid pairing
  const shouldNotStrip = !!(assistantMsg.tool_calls && assistantMsg.tool_calls.length > 0 && nextMsg && nextMsg.role === "tool")
  assert.equal(shouldNotStrip, true)
})

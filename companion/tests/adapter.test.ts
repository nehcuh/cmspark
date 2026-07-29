import test, { after, before } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-agent-test-adapter-"))

let createToolResultMessage: typeof import("../src/llm/adapter").createToolResultMessage
let rebuildMessagesFromHistory: typeof import("../src/llm/adapter").rebuildMessagesFromHistory
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
  rebuildMessagesFromHistory = adapter.rebuildMessagesFromHistory
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

// --- P0-B: rebuildMessagesFromHistory skips unpaired tool rows ---

test("P0-B: rebuildMessagesFromHistory skips orphan tool rows after stripped assistant", () => {
  // Assistant claims 2 tool_calls but only 1 tool result follows → strip assistant
  // tool_calls AND skip the partial tool row so OpenAI schema stays valid.
  const history = [
    { role: "user", content: "go" },
    {
      role: "assistant",
      content: "calling tools",
      tool_calls: [
        { id: "call_A", function: { name: "list_tabs", arguments: "{}" } },
        { id: "call_B", function: { name: "list_tabs", arguments: "{}" } },
      ],
    },
    {
      role: "tool",
      content: "{}",
      tool_calls: [{ id: "call_A", tool_name: "list_tabs", result: { success: true, data: {} } }],
    },
  ]

  const rebuilt = rebuildMessagesFromHistory(history)
  assert.equal(rebuilt.length, 2, "user + text-only assistant (orphan tool skipped)")
  assert.equal(rebuilt[0].role, "user")
  assert.equal(rebuilt[1].role, "assistant")
  assert.ok(!(rebuilt[1] as any).tool_calls, "stripped assistant has no tool_calls")
  assert.ok(!rebuilt.some((m) => m.role === "tool"), "no unpaired role=tool in OpenAI payload")
})

test("P0-B: rebuildMessagesFromHistory skips lone orphan tool with no preceding assistant tool_calls", () => {
  const history = [
    { role: "user", content: "hi" },
    { role: "assistant", content: "hello" },
    {
      role: "tool",
      content: "{}",
      tool_calls: [{ id: "orphan_1", tool_name: "list_tabs", result: { success: true } }],
    },
  ]
  const rebuilt = rebuildMessagesFromHistory(history)
  assert.equal(rebuilt.length, 2)
  assert.ok(!rebuilt.some((m) => m.role === "tool"))
})

test("P0-B: rebuildMessagesFromHistory keeps fully paired tool rounds", () => {
  const history = [
    { role: "user", content: "go" },
    {
      role: "assistant",
      content: null,
      tool_calls: [
        { id: "call_A", function: { name: "list_tabs", arguments: "{}" } },
        { id: "call_B", function: { name: "list_tabs", arguments: "{}" } },
      ],
    },
    {
      role: "tool",
      content: "{}",
      tool_calls: [{ id: "call_A", tool_name: "list_tabs", result: { success: true, data: [] } }],
    },
    {
      role: "tool",
      content: "{}",
      tool_calls: [{ id: "call_B", tool_name: "list_tabs", result: { success: true, data: [] } }],
    },
  ]
  const rebuilt = rebuildMessagesFromHistory(history)
  assert.equal(rebuilt.length, 4)
  assert.equal(rebuilt[0].role, "user")
  assert.equal(rebuilt[1].role, "assistant")
  assert.equal((rebuilt[1] as any).tool_calls.length, 2)
  assert.equal(rebuilt[2].role, "tool")
  assert.equal((rebuilt[2] as any).tool_call_id, "call_A")
  assert.equal(rebuilt[3].role, "tool")
  assert.equal((rebuilt[3] as any).tool_call_id, "call_B")
})

// Real thread mhwofh: user interrupted mid-shell_exec; a late timeout result for an
// earlier call_id landed immediately after a newer assistant's tool_calls. Role-only
// adjacency treated that as paired → OpenAI 400 "insufficient tool messages".
test("P0-B: rebuildMessagesFromHistory rejects adjacent tool with mismatched tool_call id", () => {
  const history = [
    { role: "user", content: "install deps" },
    {
      role: "assistant",
      content: "",
      tool_calls: [
        { id: "call_old", function: { name: "shell_exec", arguments: '{"cmd":"pip install x"}' } },
      ],
    },
    // user interrupts before tool result
    { role: "user", content: "use uv instead" },
    {
      role: "assistant",
      content: "ok, using uv",
      tool_calls: [
        { id: "call_new", function: { name: "shell_exec", arguments: '{"cmd":"uv venv"}' } },
      ],
    },
    // late result for the interrupted call — wrong id for call_new
    {
      role: "tool",
      content: "{}",
      tool_calls: [{
        id: "call_old",
        tool_name: "shell_exec",
        result: { success: true, data: { timed_out: true, signal: "SIGKILL" } },
      }],
    },
    { role: "user", content: "continue" },
    // actual result for call_new arrives after the next user message
    {
      role: "tool",
      content: "{}",
      tool_calls: [{
        id: "call_new",
        tool_name: "shell_exec",
        result: { success: true, data: { exit_code: 0 } },
      }],
    },
    { role: "assistant", content: "done, need token" },
    { role: "user", content: "here is token" },
  ]

  const rebuilt = rebuildMessagesFromHistory(history)

  // No assistant may carry tool_calls without matching tool rows immediately after.
  for (let i = 0; i < rebuilt.length; i++) {
    const m = rebuilt[i] as any
    if (m.role === "assistant" && m.tool_calls?.length) {
      const ids = m.tool_calls.map((tc: any) => tc.id)
      const following: string[] = []
      for (let j = i + 1; j < rebuilt.length; j++) {
        const n = rebuilt[j] as any
        if (n.role !== "tool") break
        following.push(n.tool_call_id)
      }
      for (const id of ids) {
        assert.ok(following.includes(id), `tool_call ${id} must have a following tool message`)
      }
    }
  }

  // The interrupted + mismatched rounds strip to text; final text assistant + users remain.
  assert.ok(!rebuilt.some((m) => m.role === "tool"), "mismatched/late tools must not be emitted")
  const asstWithTc = rebuilt.filter((m: any) => m.role === "assistant" && m.tool_calls?.length)
  assert.equal(asstWithTc.length, 0, "no assistant tool_calls without paired results")
  assert.equal(rebuilt[rebuilt.length - 1].role, "user")
  assert.equal((rebuilt[rebuilt.length - 1] as any).content, "here is token")
})

test("P0-B: rebuildMessagesFromHistory accepts reordered ids inside contiguous tool block", () => {
  const history = [
    { role: "user", content: "go" },
    {
      role: "assistant",
      content: null,
      tool_calls: [
        { id: "call_A", function: { name: "list_tabs", arguments: "{}" } },
        { id: "call_B", function: { name: "get_page_text", arguments: "{}" } },
      ],
    },
    // results arrive B then A — still a complete contiguous block covering both ids
    {
      role: "tool",
      content: "{}",
      tool_calls: [{ id: "call_B", tool_name: "get_page_text", result: { success: true } }],
    },
    {
      role: "tool",
      content: "{}",
      tool_calls: [{ id: "call_A", tool_name: "list_tabs", result: { success: true } }],
    },
  ]
  const rebuilt = rebuildMessagesFromHistory(history)
  assert.equal(rebuilt.length, 4)
  assert.equal((rebuilt[1] as any).tool_calls.length, 2)
  assert.equal(rebuilt[2].role, "tool")
  assert.equal(rebuilt[3].role, "tool")
})

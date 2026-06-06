import test, { before, after } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-agent-test-bridge-server-"))

// Module imports (lazy after env setup)
let resolveTargetTab: typeof import("../src/bridge/tab-resolver").resolveTargetTab
let getToolDefinitions: typeof import("../src/bridge/tool-definitions").getToolDefinitions
let createToolExecutor: typeof import("../src/server/tool-executor").createToolExecutor
let handleToolResult: typeof import("../src/server/tool-executor").handleToolResult
let executeCompanionTool: typeof import("../src/server/tool-executor").executeCompanionTool
let setRuntimeConfig: typeof import("../src/server/tool-executor").setRuntimeConfig
let getDomainFromUrl: typeof import("../src/server/log-helpers").getDomainFromUrl
let summarizeToolParams: typeof import("../src/server/log-helpers").summarizeToolParams
let summarizeToolResult: typeof import("../src/server/log-helpers").summarizeToolResult
let summarizeMessage: typeof import("../src/server/log-helpers").summarizeMessage
let logToolFinish: typeof import("../src/server/log-helpers").logToolFinish
let ThreadManager: typeof import("../src/threads/thread-manager").ThreadManager
let SkillEngine: typeof import("../src/skills/skill-engine").SkillEngine
let HistoryStore: typeof import("../src/history/store").HistoryStore
let initDataDir: typeof import("../src/config").initDataDir
let saveConfig: typeof import("../src/config").saveConfig
let isTrustedDomain: typeof import("../src/security").isTrustedDomain
let checkHighRiskExecution: typeof import("../src/security").checkHighRiskExecution
let handleMessage: typeof import("../src/message-router").handleMessage

interface TabInfo {
  id: number
  url: string
  title: string
  active: boolean
  index: number
  status: string
}

before(async () => {
  process.env.HOME = tempHome
  delete process.env.DEEPSEEK_API_KEY

  const tabResolverMod = await import("../src/bridge/tab-resolver")
  const toolDefsMod = await import("../src/bridge/tool-definitions")
  const toolExecutorMod = await import("../src/server/tool-executor")
  const logHelpersMod = await import("../src/server/log-helpers")
  const threadManagerMod = await import("../src/threads/thread-manager")
  const skillEngineMod = await import("../src/skills/skill-engine")
  const historyMod = await import("../src/history/store")
  const configMod = await import("../src/config")
  const securityMod = await import("../src/security")
  const messageRouterMod = await import("../src/message-router")

  resolveTargetTab = tabResolverMod.resolveTargetTab
  getToolDefinitions = toolDefsMod.getToolDefinitions
  createToolExecutor = toolExecutorMod.createToolExecutor
  handleToolResult = toolExecutorMod.handleToolResult
  executeCompanionTool = toolExecutorMod.executeCompanionTool
  setRuntimeConfig = toolExecutorMod.setRuntimeConfig
  getDomainFromUrl = logHelpersMod.getDomainFromUrl
  summarizeToolParams = logHelpersMod.summarizeToolParams
  summarizeToolResult = logHelpersMod.summarizeToolResult
  summarizeMessage = logHelpersMod.summarizeMessage
  logToolFinish = logHelpersMod.logToolFinish
  ThreadManager = threadManagerMod.ThreadManager
  SkillEngine = skillEngineMod.SkillEngine
  HistoryStore = historyMod.HistoryStore
  initDataDir = configMod.initDataDir
  saveConfig = configMod.saveConfig
  isTrustedDomain = securityMod.isTrustedDomain
  checkHighRiskExecution = securityMod.checkHighRiskExecution
  handleMessage = messageRouterMod.handleMessage

  await initDataDir()
})

after(() => {
  fs.rmSync(tempHome, { recursive: true, force: true })
})

// ============================================================
// tab-resolver.ts
// ============================================================

function makeTab(id: number, url: string, title: string, active = false, index = 0, status = "complete"): TabInfo {
  return { id, url, title, active, index, status }
}

test("resolveTargetTab explicit tabId takes highest priority", () => {
  const tabs = [
    makeTab(1, "https://a.com", "A", false, 0),
    makeTab(2, "https://b.com", "B", true, 1),
    makeTab(3, "https://c.com", "C", false, 2),
  ]
  const result = resolveTargetTab(tabs, [], "query", 3)
  assert.equal(result.tabId, 3)
  assert.equal(result.matched, "explicit")
})

test("resolveTargetTab explicit tabId not in list falls through", () => {
  const tabs = [makeTab(1, "https://a.com", "A", true, 0)]
  const result = resolveTargetTab(tabs, [], "query", 99)
  assert.equal(result.tabId, 1)
  assert.equal(result.matched, "active")
})

test("resolveTargetTab pinned tab priority", () => {
  const tabs = [
    makeTab(1, "https://a.com", "A", false, 0),
    makeTab(2, "https://b.com", "B", true, 1),
  ]
  const result = resolveTargetTab(tabs, [1], "query")
  assert.equal(result.tabId, 1)
  assert.equal(result.matched, "pinned")
})

test("resolveTargetTab pinned tab missing falls through to active", () => {
  const tabs = [makeTab(2, "https://b.com", "B", true, 1)]
  const result = resolveTargetTab(tabs, [99], "query")
  assert.equal(result.tabId, 2)
  assert.equal(result.matched, "active")
})

test("resolveTargetTab active tab relevance matching", () => {
  const tabs = [
    makeTab(1, "https://github.com", "GitHub", true, 0),
    makeTab(2, "https://twitter.com", "Twitter", false, 1),
  ]
  // Query about "twitter" should match tab 2
  const result = resolveTargetTab(tabs, [], "twitter login")
  assert.equal(result.tabId, 2)
  assert.equal(result.matched, "semantic")
})

test("resolveTargetTab active tab stays when relevant", () => {
  const tabs = [makeTab(1, "https://github.com", "GitHub", true, 0)]
  const result = resolveTargetTab(tabs, [], "github repo")
  assert.equal(result.tabId, 1)
  assert.equal(result.matched, "active")
})

test("resolveTargetTab fallback to first tab when no active", () => {
  const tabs = [
    makeTab(1, "https://a.com", "A", false, 0),
    makeTab(2, "https://b.com", "B", false, 1),
  ]
  const result = resolveTargetTab(tabs, [], "query")
  assert.equal(result.tabId, 1)
  assert.equal(result.matched, "active")
})

test("resolveTargetTab throws when no tabs available", () => {
  assert.throws(() => resolveTargetTab([], [], "query"), /No tabs available/)
})

test("resolveTargetTab empty query assumes relevance", () => {
  const tabs = [makeTab(5, "https://example.com", "Example", true, 0)]
  const result = resolveTargetTab(tabs, [], "")
  assert.equal(result.tabId, 5)
  assert.equal(result.matched, "active")
})

test("resolveTargetTab short query (<3 chars) assumes relevance", () => {
  const tabs = [makeTab(5, "https://example.com", "Example", true, 0)]
  const result = resolveTargetTab(tabs, [], "ab")
  assert.equal(result.tabId, 5)
  assert.equal(result.matched, "active")
})

test("resolveTargetTab semantic matching with Chinese bigrams", () => {
  const tabs = [
    makeTab(1, "https://a.com", "A页面", true, 0),
    makeTab(2, "https://b.com", "B页面", false, 1),
  ]
  const result = resolveTargetTab(tabs, [], "B页面内容")
  assert.equal(result.tabId, 2)
  assert.equal(result.matched, "semantic")
})

// ============================================================
// tool-definitions.ts
// ============================================================

test("getToolDefinitions returns non-empty array", () => {
  const defs = getToolDefinitions()
  assert.ok(Array.isArray(defs))
  assert.ok(defs.length > 0)
})

test("getToolDefinitions contains expected tab tools", () => {
  const defs = getToolDefinitions()
  const names = defs.map((d: any) => d.function?.name)
  assert.ok(names.includes("list_tabs"))
  assert.ok(names.includes("create_tab"))
  assert.ok(names.includes("close_tab"))
  assert.ok(names.includes("navigate"))
  assert.ok(names.includes("screenshot"))
})

test("getToolDefinitions contains expected page read tools", () => {
  const defs = getToolDefinitions()
  const names = defs.map((d: any) => d.function?.name)
  assert.ok(names.includes("get_page_text"))
  assert.ok(names.includes("get_page_html"))
  assert.ok(names.includes("get_element_info"))
})

test("getToolDefinitions contains expected interaction tools", () => {
  const defs = getToolDefinitions()
  const names = defs.map((d: any) => d.function?.name)
  assert.ok(names.includes("click"))
  assert.ok(names.includes("type"))
  assert.ok(names.includes("scroll"))
  assert.ok(names.includes("press_key"))
  assert.ok(names.includes("evaluate"))
})

test("getToolDefinitions contains cookie tools", () => {
  const defs = getToolDefinitions()
  const names = defs.map((d: any) => d.function?.name)
  assert.ok(names.includes("get_cookies"))
  assert.ok(names.includes("set_cookie"))
  assert.ok(names.includes("delete_cookie"))
  assert.ok(names.includes("list_all_cookies"))
})

test("getToolDefinitions contains companion tools", () => {
  const defs = getToolDefinitions()
  const names = defs.map((d: any) => d.function?.name)
  assert.ok(names.includes("use_skill"))
  assert.ok(names.includes("osascript_eval"))
  assert.ok(names.includes("record_experience"))
})

test("getToolDefinitions each item has function type and parameters", () => {
  const defs = getToolDefinitions()
  for (const def of defs) {
    assert.equal(def.type, "function")
    assert.ok(typeof def.function.name === "string")
    assert.ok(typeof def.function.description === "string")
    assert.ok(typeof def.function.parameters === "object")
  }
})

test("getToolDefinitions navigate requires tabId and url", () => {
  const defs = getToolDefinitions()
  const navigate = defs.find((d: any) => d.function.name === "navigate")
  assert.ok(navigate, "navigate tool should exist")
  assert.deepEqual(navigate.function.parameters.required, ["tabId", "url"])
})

test("getToolDefinitions evaluate requires tabId and code", () => {
  const defs = getToolDefinitions()
  const evaluate = defs.find((d: any) => d.function.name === "evaluate")
  assert.ok(evaluate, "evaluate tool should exist")
  assert.deepEqual(evaluate.function.parameters.required, ["tabId", "code"])
})

// ============================================================
// server/log-helpers.ts
// ============================================================

test("getDomainFromUrl extracts hostname from valid URL", () => {
  assert.equal(getDomainFromUrl("https://example.com/path"), "example.com")
  assert.equal(getDomainFromUrl("http://sub.domain.co.uk:8080/page"), "sub.domain.co.uk")
})

test("getDomainFromUrl returns empty string for invalid URL", () => {
  assert.equal(getDomainFromUrl("not-a-url"), "")
  assert.equal(getDomainFromUrl(""), "")
})

test("summarizeToolParams extracts keys and hides code/expression", () => {
  const params = {
    tabId: 42,
    selector: "#btn",
    code: "document.cookie",
    expression: "fetch('/api')",
    other: "value",
  }
  const summary = summarizeToolParams(params)
  assert.deepEqual(summary.keys, ["tabId", "selector", "code", "expression", "other"])
  assert.equal(summary.tabId, 42)
  assert.equal(summary.selector, "#btn")
  assert.equal(summary.code_length, 15)
  assert.equal(summary.expression_length, 15)
  assert.equal(Object.prototype.hasOwnProperty.call(summary, "code"), false)
  assert.equal(Object.prototype.hasOwnProperty.call(summary, "expression"), false)
})

test("summarizeToolParams handles null/undefined params", () => {
  const summary = summarizeToolParams(null)
  assert.deepEqual(summary.keys, [])
  const summary2 = summarizeToolParams(undefined)
  assert.deepEqual(summary2.keys, [])
})

test("summarizeToolResult normalizes success and data presence", () => {
  const r1 = summarizeToolResult({ success: true, data: "hello" })
  assert.equal(r1.success, true)
  assert.equal(r1.has_data, true)
  assert.equal(r1.data_type, "string")
  assert.equal(r1.data_size, 5)
  assert.equal(r1.has_error, false)

  const r2 = summarizeToolResult({ success: false, error: "boom" })
  assert.equal(r2.success, false)
  assert.equal(r2.has_data, false)
  assert.equal(r2.has_error, true)
  assert.equal(r2.error_preview, "boom")
})

test("summarizeToolResult handles null/undefined result", () => {
  const r = summarizeToolResult(null)
  assert.equal(r.success, false)
  assert.equal(r.has_data, false)
})

test("summarizeMessage extracts known fields", () => {
  const msg = {
    id: "msg1",
    type: "chat.create",
    thread_id: "t1",
    content: "hello world",
    params: { tabId: 5 },
    result: { success: true },
  }
  const s = summarizeMessage(msg)
  assert.equal(s.id, "msg1")
  assert.equal(s.type, "chat.create")
  assert.equal(s.thread_id, "t1")
  assert.equal(s.content_length, 11)
  assert.ok(typeof s.params === "object")
  assert.ok(typeof s.result === "object")
})

test("summarizeMessage handles null message", () => {
  const s = summarizeMessage(null)
  assert.equal(s.type, "null")
})

test("logToolFinish calls log function with correct shape", () => {
  const calls: any[] = []
  const mockLog = (level: string, source: string, event: string, data: Record<string, unknown>) => {
    calls.push({ level, source, event, data })
  }
  logToolFinish(mockLog, "tc1", "click", 123, { success: true, data: "ok" })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].level, "info")
  assert.equal(calls[0].source, "tool_executor")
  assert.equal(calls[0].event, "tool.finish")
  assert.equal(calls[0].data.tool_call_id, "tc1")
  assert.equal(calls[0].data.tool_name, "click")
  assert.equal(calls[0].data.duration_ms, 123)
})

// ============================================================
// server/tool-executor.ts
// ============================================================

function createMockWebSocket() {
  const sent: any[] = []
  return {
    send: (data: string) => sent.push(JSON.parse(data)),
    _sent: sent,
  }
}

test("createToolExecutor sends tool.execute over WebSocket", async () => {
  saveConfig({ trusted_domains: ["example.com"] })
  setRuntimeConfig({ trusted_domains: ["example.com"] })

  const ws = createMockWebSocket()
  const executor = createToolExecutor(ws, new ThreadManager(), new SkillEngine(), new HistoryStore())

  const promise = executor("tc1", "click", { tabId: 1, selector: "#btn" })

  // Should have sent tool.execute
  assert.equal(ws._sent.length, 1)
  assert.equal(ws._sent[0].type, "tool.execute")
  assert.equal(ws._sent[0].tool_call_id, "tc1")
  assert.equal(ws._sent[0].tool_name, "click")

  // Simulate result
  const pending = new Map<string, any>()
  // We need to access internal pending map; instead simulate via handleToolResult on a fresh map
  // Since createToolExecutor closes over its own pending map, we can't easily reach it.
  // We'll resolve by faking the message shape the executor expects.
  // Actually: createToolExecutor uses its own closed-over pendingTools, so we must resolve via its returned handler.
  // There is no handler exposed. Let's test handleToolResult separately instead.

  // For timeout test, we'll just let it timeout or resolve manually.
  // Since we can't access the internal map, let's resolve the promise by sending back via a second executor? No.
  // Instead, we test the security gates here and test handleToolResult separately.
})

test("createToolExecutor blocks get_cookies for untrusted domain", async () => {
  saveConfig({ trusted_domains: ["example.com"] })
  setRuntimeConfig({ trusted_domains: ["example.com"] })

  const ws = createMockWebSocket()
  const executor = createToolExecutor(ws, new ThreadManager(), new SkillEngine(), new HistoryStore())

  const result = await executor("tc2", "get_cookies", { domain: "evil.com" })
  assert.equal(result.success, false)
  assert.ok(result.error && /Cookie security/.test(result.error))
  assert.equal(ws._sent.length, 0)
})

test("createToolExecutor allows get_cookies for trusted domain", async () => {
  saveConfig({ trusted_domains: ["example.com"] })
  setRuntimeConfig({ trusted_domains: ["example.com"] })

  const ws = createMockWebSocket()
  const executor = createToolExecutor(ws, new ThreadManager(), new SkillEngine(), new HistoryStore())

  const promise = executor("tc3", "get_cookies", { domain: "example.com" })
  assert.equal(ws._sent.length, 1)
  assert.equal(ws._sent[0].type, "tool.execute")
})

test("createToolExecutor blocks list_all_cookies without wildcard trust", async () => {
  saveConfig({ trusted_domains: ["example.com"] })
  setRuntimeConfig({ trusted_domains: ["example.com"] })

  const ws = createMockWebSocket()
  const executor = createToolExecutor(ws, new ThreadManager(), new SkillEngine(), new HistoryStore())

  const result = await executor("tc4", "list_all_cookies", {})
  assert.equal(result.success, false)
  assert.ok(result.error && /list_all_cookies requires/.test(result.error))
})

test("createToolExecutor blocks evaluate with dangerous APIs", async () => {
  saveConfig({ trusted_domains: ["example.com"] })
  setRuntimeConfig({ trusted_domains: ["example.com"] })

  const ws = createMockWebSocket()
  const executor = createToolExecutor(ws, new ThreadManager(), new SkillEngine(), new HistoryStore())

  const result = await executor("tc5", "evaluate", { tabId: 1, code: "fetch('https://evil.com')" })
  assert.equal(result.success, false)
  assert.ok(result.error && /Security Block/.test(result.error))
  assert.ok(Array.isArray(result.data?.dangerous_apis_found))
})

test("createToolExecutor allows safe evaluate", async () => {
  saveConfig({ trusted_domains: ["example.com"] })
  setRuntimeConfig({ trusted_domains: ["example.com"] })

  const ws = createMockWebSocket()
  const executor = createToolExecutor(ws, new ThreadManager(), new SkillEngine(), new HistoryStore())

  const promise = executor("tc6", "evaluate", { tabId: 1, code: "document.title" })
  assert.equal(ws._sent.length, 1)
  assert.equal(ws._sent[0].tool_name, "evaluate")
})

test("handleToolResult resolves pending tool and clears timer", () => {
  const pending = new Map<string, { resolve: (v: any) => void; timer: NodeJS.Timeout }>()
  let resolved: any = null
  const timer = setTimeout(() => {}, 99999)
  pending.set("tc7", {
    resolve: (v: any) => { resolved = v },
    timer,
  })

  const handled = handleToolResult({ tool_call_id: "tc7", success: true, data: "ok" }, pending, new ThreadManager())
  assert.equal(handled, true)
  assert.equal(resolved.success, true)
  assert.equal(resolved.data, "ok")
  assert.equal(pending.has("tc7"), false)
})

test("handleToolResult returns false for unknown tool_call_id", () => {
  const pending = new Map<string, any>()
  const handled = handleToolResult({ tool_call_id: "missing" }, pending, new ThreadManager())
  assert.equal(handled, false)
})

test("executeCompanionTool use_skill returns content when skill exists", async () => {
  const engine = new SkillEngine()
  const skillsDir = path.join(os.homedir(), ".cmspark-agent", "skills")
  fs.writeFileSync(path.join(skillsDir, "test-skill.md"), [
    "---",
    "name: test-skill",
    "description: A test skill",
    "---",
    "# Test Skill Content",
  ].join("\n"))
  engine.refresh()

  const result = await executeCompanionTool("use_skill", { skill_name: "test-skill" }, engine)
  assert.equal(result.success, true)
  assert.ok(result.data?.content.includes("Test Skill Content"))
  assert.equal(result.data?.skill_name, "test-skill")

  fs.unlinkSync(path.join(skillsDir, "test-skill.md"))
})

test("executeCompanionTool use_skill returns error when skill missing", async () => {
  const engine = new SkillEngine()
  const result = await executeCompanionTool("use_skill", { skill_name: "missing-skill" }, engine)
  assert.equal(result.success, false)
  assert.ok(result.error && /not found/.test(result.error))
})

test("executeCompanionTool osascript_eval returns error without session", async () => {
  const result = await executeCompanionTool("osascript_eval", { url: "example.com", expression: "1+1" }, new SkillEngine())
  assert.equal(result.success, false)
  assert.ok(result.error && /requires an active WebSocket session/.test(result.error))
})

test("executeCompanionTool unknown tool returns error", async () => {
  const result = await executeCompanionTool("unknown_tool", {}, new SkillEngine())
  assert.equal(result.success, false)
  assert.ok(result.error && /Unknown companion tool/.test(result.error))
})

// ============================================================
// server.ts (via message-router integration)
// ============================================================

test("config.get masks API key", async () => {
  saveConfig({ llm: { api_key: "sk-secret123" } as any })

  const response = await handleMessage(
    { type: "config.get" },
    { threadManager: new ThreadManager(), skillEngine: new SkillEngine(), historyStore: new HistoryStore() },
  )
  assert.equal(response.type, "config.updated")
  assert.equal(response.config.llm.api_key, "***")
})

test("config.set rejects prototype pollution keys", async () => {
  const response = await handleMessage(
    { type: "config.set", config: { "__proto__": { polluted: true } } },
    { threadManager: new ThreadManager(), skillEngine: new SkillEngine(), historyStore: new HistoryStore() },
  )
  assert.equal(response.type, "error")
  assert.match(response.error, /Invalid config keys/)
})

test("config.set normalizes flat LLM fields", async () => {
  saveConfig({ llm: { api_key: "" } as any })

  const response = await handleMessage(
    { type: "config.set", config: { model_name: "gpt-4", temperature: 0.5 } },
    { threadManager: new ThreadManager(), skillEngine: new SkillEngine(), historyStore: new HistoryStore() },
  )
  assert.equal(response.type, "config.updated")
  assert.equal(response.config.llm.model_name, "gpt-4")
  assert.equal(response.config.llm.temperature, 0.5)
})

test("config.test returns false when no API key", async () => {
  saveConfig({ llm: { api_key: "" } as any })

  const response = await handleMessage(
    { type: "config.test" },
    { threadManager: new ThreadManager(), skillEngine: new SkillEngine(), historyStore: new HistoryStore() },
  )
  assert.equal(response.type, "config.testResult")
  assert.equal(response.ok, false)
  assert.ok(response.error)
})

test("thread.create with duplicate id throws error via router", async () => {
  const manager = new ThreadManager()
  manager.create("First", "dup01")

  const response = await handleMessage(
    { type: "thread.create", alias: "Second", id: "dup01" },
    { threadManager: manager, skillEngine: new SkillEngine(), historyStore: new HistoryStore() },
  )
  assert.equal(response.type, "error")
  assert.ok(response.error)
})

test("thread.fork copies messages and metadata", async () => {
  const manager = new ThreadManager()
  const thread = manager.create("Source", "fork01")
  manager.addMessage(thread.id, { thread_id: thread.id, role: "user", content: "hello" })
  manager.addMessage(thread.id, { thread_id: thread.id, role: "assistant", content: "hi" })

  const messages = manager.getMessages(thread.id)
  const userMsg = messages[0]

  const response = await handleMessage(
    { type: "thread.fork", thread_id: thread.id, message_id: userMsg.id },
    { threadManager: manager, skillEngine: new SkillEngine(), historyStore: new HistoryStore() },
  )
  assert.equal(response.type, "thread.forked")
  assert.ok(response.thread.id !== thread.id)
  assert.equal(response.messages.length, 1)
  assert.equal(response.messages[0].content, "hello")
})

test("thread.fork with nonexistent thread returns error", async () => {
  const manager = new ThreadManager()
  const response = await handleMessage(
    { type: "thread.fork", thread_id: "missing", message_id: "m1" },
    { threadManager: manager, skillEngine: new SkillEngine(), historyStore: new HistoryStore() },
  )
  assert.equal(response.type, "error")
  assert.match(response.error, /not found/)
})

test("skill.export returns skill data", async () => {
  const engine = new SkillEngine()
  const skillsDir = path.join(os.homedir(), ".cmspark-agent", "skills")
  fs.writeFileSync(path.join(skillsDir, "export-test.md"), [
    "---",
    "name: export-test",
    "description: Export test",
    "---",
    "# Export",
  ].join("\n"))
  engine.refresh()

  const response = await handleMessage(
    { type: "skill.export", skill_name: "export-test" },
    { threadManager: new ThreadManager(), skillEngine: engine, historyStore: new HistoryStore() },
  )
  assert.equal(response.type, "skill.exported")
  assert.ok(response.content || response.markdown)

  fs.unlinkSync(path.join(skillsDir, "export-test.md"))
})

test("skill.delete removes skill", async () => {
  const engine = new SkillEngine()
  const skillsDir = path.join(os.homedir(), ".cmspark-agent", "skills")
  fs.writeFileSync(path.join(skillsDir, "delete-test.md"), [
    "---",
    "name: delete-test",
    "description: Delete test",
    "---",
    "# Delete",
  ].join("\n"))
  engine.refresh()

  const response = await handleMessage(
    { type: "skill.delete", skill_name: "delete-test" },
    { threadManager: new ThreadManager(), skillEngine: engine, historyStore: new HistoryStore() },
  )
  assert.equal(response.type, "skill.deleted")
  assert.equal(response.skill_name, "delete-test")
})

test("history.export returns JSON data", async () => {
  const history = new HistoryStore()
  const response = await handleMessage(
    { type: "history.export" },
    { threadManager: new ThreadManager(), skillEngine: new SkillEngine(), historyStore: history },
  )
  assert.equal(response.type, "history.exported")
  assert.ok(typeof response.data === "string" || typeof response.data === "object")
})

test("system.ping returns pong", async () => {
  const response = await handleMessage(
    { type: "system.ping" },
    { threadManager: new ThreadManager(), skillEngine: new SkillEngine(), historyStore: new HistoryStore() },
  )
  assert.equal(response.type, "system.pong")
})

test("unknown message type returns error", async () => {
  const response = await handleMessage(
    { type: "unknown.type" },
    { threadManager: new ThreadManager(), skillEngine: new SkillEngine(), historyStore: new HistoryStore() },
  )
  assert.equal(response.type, "error")
  assert.match(response.error, /Unknown message type/)
})

// ============================================================
// Security helpers (security.ts)
// ============================================================

test("isTrustedDomain with wildcards", () => {
  saveConfig({ trusted_domains: ["example.com", "*.company.com"] })
  assert.equal(isTrustedDomain("example.com"), true)
  assert.equal(isTrustedDomain("hr.company.com"), true)
  assert.equal(isTrustedDomain("company.com"), true)
  assert.equal(isTrustedDomain("evil.com"), false)
})

test("checkHighRiskExecution detects dangerous APIs", () => {
  const result = checkHighRiskExecution("evaluate", "fetch('https://evil.com')")
  assert.equal(result.blocked, true)
  assert.ok(result.dangerousApis.includes("fetch"))
  assert.ok(result.error)
})

test("checkHighRiskExecution allows safe code", () => {
  const result = checkHighRiskExecution("evaluate", "document.title")
  assert.equal(result.blocked, false)
  assert.equal(result.dangerousApis.length, 0)
})

test("checkHighRiskExecution detects bracket obfuscation", () => {
  const result = checkHighRiskExecution("evaluate", "window['fetch']('url')")
  assert.equal(result.blocked, true)
  assert.ok(result.dangerousApis.includes("bracket-fetch"))
})

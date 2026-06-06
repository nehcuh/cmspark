// Server module tests — log-helpers.ts and tool-executor.ts
import test, { before, after } from "node:test"
import assert from "node:assert/strict"
import * as os from "node:os"
import * as path from "node:path"
import * as fs from "node:fs"

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-agent-test-server-"))

let getDomainFromUrl: typeof import("../src/server/log-helpers").getDomainFromUrl
let summarizeToolParams: typeof import("../src/server/log-helpers").summarizeToolParams
let summarizeToolResult: typeof import("../src/server/log-helpers").summarizeToolResult
let summarizeMessage: typeof import("../src/server/log-helpers").summarizeMessage
let logToolFinish: typeof import("../src/server/log-helpers").logToolFinish
let createToolExecutor: typeof import("../src/server/tool-executor").createToolExecutor
let executeCompanionTool: typeof import("../src/server/tool-executor").executeCompanionTool
let handleToolResult: typeof import("../src/server/tool-executor").handleToolResult
let setRuntimeConfig: typeof import("../src/server/tool-executor").setRuntimeConfig
let getRuntimeConfig: typeof import("../src/server/tool-executor").getRuntimeConfig
let isTrustedDomain: typeof import("../src/security").isTrustedDomain
let checkHighRiskExecution: typeof import("../src/security").checkHighRiskExecution
let initDataDir: typeof import("../src/config").initDataDir
let saveConfig: typeof import("../src/config").saveConfig
let ThreadManager: typeof import("../src/threads/thread-manager").ThreadManager
let SkillEngine: typeof import("../src/skills/skill-engine").SkillEngine
let HistoryStore: typeof import("../src/history/store").HistoryStore

before(async () => {
  process.env.HOME = tempHome
  delete process.env.DEEPSEEK_API_KEY

  const logHelpers = await import("../src/server/log-helpers")
  const toolExecutor = await import("../src/server/tool-executor")
  const security = await import("../src/security")
  const config = await import("../src/config")
  const threadManager = await import("../src/threads/thread-manager")
  const skillEngine = await import("../src/skills/skill-engine")
  const historyStore = await import("../src/history/store")

  getDomainFromUrl = logHelpers.getDomainFromUrl
  summarizeToolParams = logHelpers.summarizeToolParams
  summarizeToolResult = logHelpers.summarizeToolResult
  summarizeMessage = logHelpers.summarizeMessage
  logToolFinish = logHelpers.logToolFinish
  createToolExecutor = toolExecutor.createToolExecutor
  executeCompanionTool = toolExecutor.executeCompanionTool
  handleToolResult = toolExecutor.handleToolResult
  setRuntimeConfig = toolExecutor.setRuntimeConfig
  getRuntimeConfig = toolExecutor.getRuntimeConfig
  isTrustedDomain = security.isTrustedDomain
  checkHighRiskExecution = security.checkHighRiskExecution
  initDataDir = config.initDataDir
  saveConfig = config.saveConfig
  ThreadManager = threadManager.ThreadManager
  SkillEngine = skillEngine.SkillEngine
  HistoryStore = historyStore.HistoryStore

  await initDataDir()
})

after(() => {
  fs.rmSync(tempHome, { recursive: true, force: true })
})

// ============================================================================
// log-helpers.ts tests
// ============================================================================

test("getDomainFromUrl extracts hostname from valid URLs", () => {
  assert.equal(getDomainFromUrl("https://example.com/path"), "example.com")
  assert.equal(getDomainFromUrl("http://sub.domain.co.uk:8080/page?q=1"), "sub.domain.co.uk")
  assert.equal(getDomainFromUrl("https://127.0.0.1:23401"), "127.0.0.1")
  assert.equal(getDomainFromUrl("ftp://files.example.org/download"), "files.example.org")
  assert.equal(getDomainFromUrl("https://user:pass@example.com/path"), "example.com")
})

test("getDomainFromUrl returns empty string for invalid URLs", () => {
  assert.equal(getDomainFromUrl("not-a-url"), "")
  assert.equal(getDomainFromUrl(""), "")
  assert.equal(getDomainFromUrl("javascript:alert(1)"), "")
  assert.equal(getDomainFromUrl("data:text/plain,hello"), "")
})

test("summarizeToolParams extracts whitelisted keys and hides code/expression content", () => {
  const params = {
    tabId: 303,
    selector: "#btn",
    code: "fetch('/api')".repeat(50),
    expression: "document.cookie",
    other: "value",
    url: "https://example.com",
    domain: "example.com",
  }
  const summary = summarizeToolParams(params)

  assert.deepEqual(summary.keys, ["tabId", "selector", "code", "expression", "other", "url", "domain"])
  assert.equal(summary.tabId, 303)
  assert.equal(summary.selector, "#btn")
  assert.equal(summary.code_length, 650) // "fetch('/api')" * 50 = 13 * 50
  assert.equal(summary.expression_length, 15)
  assert.equal(summary.other, undefined) // not whitelisted
  assert.equal(summary.code, undefined) // code content not exposed
  assert.equal(summary.expression, undefined) // expression content not exposed
})

test("summarizeToolParams handles threadId and thread_id variants", () => {
  const summary1 = summarizeToolParams({ threadId: "abc123" })
  assert.equal(summary1.threadId, "abc123")

  const summary2 = summarizeToolParams({ thread_id: "xyz789" })
  assert.equal(summary2.thread_id, "xyz789")
})

test("summarizeToolParams handles empty and null params", () => {
  assert.deepEqual(summarizeToolParams(null), { keys: [] })
  assert.deepEqual(summarizeToolParams(undefined), { keys: [] })
  assert.deepEqual(summarizeToolParams({}), { keys: [] })
})

test("summarizeToolParams omits length fields when code/expression are undefined", () => {
  const summary = summarizeToolParams({ tabId: 42 })
  assert.equal(summary.code_length, undefined)
  assert.equal(summary.expression_length, undefined)
})

test("summarizeToolResult summarizes successful results", () => {
  const result = {
    success: true,
    data: { title: "Example", text: "Hello" },
  }
  const summary = summarizeToolResult(result)

  assert.equal(summary.success, true)
  assert.equal(summary.has_data, true)
  assert.equal(summary.data_type, "object")
  assert.equal(summary.data_size, "N/A")
  assert.equal(summary.has_error, false)
  assert.equal(summary.error_preview, undefined)
})

test("summarizeToolResult summarizes failed results", () => {
  const result = {
    success: false,
    error: "Element not found",
    data: null,
  }
  const summary = summarizeToolResult(result)

  assert.equal(summary.success, false)
  assert.equal(summary.has_data, false)
  assert.equal(summary.data_type, "none")
  assert.equal(summary.has_error, true)
  assert.equal(summary.error_preview, "Element not found")
})

test("summarizeToolResult handles string data and reports size", () => {
  const result = { success: true, data: "x".repeat(100) }
  const summary = summarizeToolResult(result)

  assert.equal(summary.data_type, "string")
  assert.equal(summary.data_size, 100)
})

test("summarizeToolResult truncates long error messages", () => {
  const longError = "A".repeat(100)
  const result = { success: false, error: longError }
  const summary = summarizeToolResult(result)

  assert.equal(summary.error_preview, "A".repeat(80))
})

test("summarizeToolResult handles null/undefined result", () => {
  assert.deepEqual(summarizeToolResult(null), { success: false })
  assert.deepEqual(summarizeToolResult(undefined), { success: false })
})

test("summarizeMessage summarizes message with common fields", () => {
  const msg = {
    id: "msg-1",
    type: "tool.execute",
    thread_id: "th-123",
    tool_call_id: "tc-456",
    tool_name: "click",
    params: { selector: "#btn" },
    result: { success: true, data: "clicked" },
  }
  const summary = summarizeMessage(msg)

  assert.equal(summary.type, "tool.execute")
  assert.equal(summary.thread_id, "th-123")
  assert.equal(summary.tool_call_id, "tc-456")
  assert.equal(summary.tool_name, "click")
  assert.ok(summary.params)
  assert.ok(summary.result)
})

test("summarizeMessage handles skill-related messages", () => {
  const msg = {
    type: "skill.list",
    skill_ids: ["browse", "analyze"],
    skill_name: "browse",
  }
  const summary = summarizeMessage(msg)

  assert.equal(summary.skill_ids, undefined)
  assert.equal(summary.skill_count, 2)
  assert.equal(summary.skill_name, "browse")
})

test("summarizeMessage handles messages with content field", () => {
  const msg = { type: "chat.create", content: "hello world" }
  const summary = summarizeMessage(msg)

  assert.equal(summary.content_length, 11)
})

test("summarizeMessage handles null message", () => {
  assert.deepEqual(summarizeMessage(null), { type: "null" })
})

test("logToolFinish calls log function with summarized data", () => {
  const calls: any[] = []
  const mockLog = ((level: string, source: string, event: string, data: Record<string, unknown>) => {
    calls.push({ level, source, event, data })
  }) as any

  logToolFinish(mockLog, "tc-123", "click", 150, { success: true, data: "ok" })

  assert.equal(calls.length, 1)
  assert.equal(calls[0].level, "info")
  assert.equal(calls[0].source, "tool_executor")
  assert.equal(calls[0].event, "tool.finish")
  assert.equal(calls[0].data.tool_call_id, "tc-123")
  assert.equal(calls[0].data.tool_name, "click")
  assert.equal(calls[0].data.duration_ms, 150)
  assert.equal(calls[0].data.success, true)
})

test("logToolFinish includes error preview when provided", () => {
  const calls: any[] = []
  const mockLog = ((level: string, source: string, event: string, data: Record<string, unknown>) => {
    calls.push({ level, source, event, data })
  }) as any

  logToolFinish(mockLog, "tc-124", "evaluate", 50, null, "Timeout after 15s")

  assert.equal(calls[0].data.error_preview, "Timeout after 15s")
})

// ============================================================================
// tool-executor.ts tests
// ============================================================================

// Mock WebSocket
function createMockWebSocket() {
  const messages: any[] = []
  return {
    send: (data: string) => messages.push(JSON.parse(data)),
    readyState: 1, // WebSocket.OPEN
    getMessages: () => messages,
  }
}

test("createToolExecutor creates an executor function", () => {
  const mockWs = createMockWebSocket()
  const threadManager = new ThreadManager()
  const skillEngine = new SkillEngine()
  const historyStore = new HistoryStore()

  const executor = createToolExecutor(mockWs as any, threadManager, skillEngine, historyStore)
  assert.equal(typeof executor, "function")
})

test("createToolExecutor sends tool.execute message via WebSocket", async () => {
  const mockWs = createMockWebSocket()
  const threadManager = new ThreadManager()
  const skillEngine = new SkillEngine()
  const historyStore = new HistoryStore()

  const executor = createToolExecutor(mockWs as any, threadManager, skillEngine, historyStore)

  // Call executor but don't wait for result (it will timeout)
  const promise = executor("tc-1", "click", { selector: "#btn" })

  assert.equal(mockWs.getMessages().length, 1)
  const sentMsg = mockWs.getMessages()[0]
  assert.equal(sentMsg.type, "tool.execute")
  assert.equal(sentMsg.tool_call_id, "tc-1")
  assert.equal(sentMsg.tool_name, "click")
  assert.deepEqual(sentMsg.params, { selector: "#btn" })

  // Clean up pending promise to avoid test hanging
  // Let it timeout naturally
  await promise
})

test("Cookie security: blocks get_cookies for untrusted domain", async () => {
  saveConfig({ trusted_domains: ["example.com", "*.trusted.com"] })
  const mockWs = createMockWebSocket()
  const threadManager = new ThreadManager()
  const skillEngine = new SkillEngine()
  const historyStore = new HistoryStore()

  const executor = createToolExecutor(mockWs as any, threadManager, skillEngine, historyStore)
  const result = await executor("tc-2", "get_cookies", { domain: "evil.com" })

  assert.equal(result.success, false)
  assert.ok(result.error?.includes('domain "evil.com"'))
  assert.ok(result.error?.includes("not in trusted list"))
})

test("Cookie security: allows get_cookies for trusted domain", async () => {
  saveConfig({ trusted_domains: ["example.com", "*.trusted.com"] })
  const mockWs = createMockWebSocket()
  const threadManager = new ThreadManager()
  const skillEngine = new SkillEngine()
  const historyStore = new HistoryStore()

  const executor = createToolExecutor(mockWs as any, threadManager, skillEngine, historyStore)

  // Will timeout but should not be blocked by security
  const promise = executor("tc-3", "get_cookies", { domain: "example.com" })

  assert.equal(mockWs.getMessages().length, 1)
  assert.equal(mockWs.getMessages()[0].tool_name, "get_cookies")

  // Clean up
  await promise
})

test("Cookie security: blocks get_cookies when domain extracted from untrusted URL", async () => {
  saveConfig({ trusted_domains: ["example.com", "*.trusted.com"] })
  const mockWs = createMockWebSocket()
  const threadManager = new ThreadManager()
  const skillEngine = new SkillEngine()
  const historyStore = new HistoryStore()

  const executor = createToolExecutor(mockWs as any, threadManager, skillEngine, historyStore)
  const result = await executor("tc-4", "get_cookies", { url: "https://evil.com/page" })

  assert.equal(result.success, false)
  assert.ok(result.error?.includes('domain "evil.com"'))
})

test("Cookie security: allows wildcard subdomain matching", async () => {
  saveConfig({ trusted_domains: ["example.com", "*.trusted.com"] })
  const mockWs = createMockWebSocket()
  const threadManager = new ThreadManager()
  const skillEngine = new SkillEngine()
  const historyStore = new HistoryStore()

  const executor = createToolExecutor(mockWs as any, threadManager, skillEngine, historyStore)

  // Will timeout but should not be blocked
  const promise = executor("tc-5", "set_cookie", { domain: "sub.trusted.com" })

  assert.equal(mockWs.getMessages().length, 1)

  // Clean up
  await promise
})

test("Cookie security: blocks list_all_cookies without wildcard trust", async () => {
  saveConfig({ trusted_domains: ["example.com"] })
  const mockWs = createMockWebSocket()
  const threadManager = new ThreadManager()
  const skillEngine = new SkillEngine()
  const historyStore = new HistoryStore()

  const executor = createToolExecutor(mockWs as any, threadManager, skillEngine, historyStore)
  const result = await executor("tc-6", "list_all_cookies", {})

  assert.equal(result.success, false)
  assert.ok(result.error?.includes("list_all_cookies requires '*'"))
})

test("Cookie security: allows list_all_cookies with wildcard trust", async () => {
  saveConfig({ trusted_domains: ["*"] })
  const mockWs = createMockWebSocket()
  const threadManager = new ThreadManager()
  const skillEngine = new SkillEngine()
  const historyStore = new HistoryStore()

  const executor = createToolExecutor(mockWs as any, threadManager, skillEngine, historyStore)

  // Will timeout but should not be blocked
  const promise = executor("tc-7", "list_all_cookies", {})

  assert.equal(mockWs.getMessages().length, 1)

  // Clean up
  await promise
})

test("Cookie security: blocks set_cookie with untrusted domain from URL", async () => {
  saveConfig({ trusted_domains: ["example.com"] })
  const mockWs = createMockWebSocket()
  const threadManager = new ThreadManager()
  const skillEngine = new SkillEngine()
  const historyStore = new HistoryStore()

  const executor = createToolExecutor(mockWs as any, threadManager, skillEngine, historyStore)
  const result = await executor("tc-8", "set_cookie", {
    url: "https://malicious.com",
    name: "session",
    value: "abc",
  })

  assert.equal(result.success, false)
  assert.ok(result.error?.includes('domain "malicious.com"'))
})

test("Cookie security: blocks delete_cookie with untrusted domain", async () => {
  saveConfig({ trusted_domains: ["example.com"] })
  const mockWs = createMockWebSocket()
  const threadManager = new ThreadManager()
  const skillEngine = new SkillEngine()
  const historyStore = new HistoryStore()

  const executor = createToolExecutor(mockWs as any, threadManager, skillEngine, historyStore)
  const result = await executor("tc-9", "delete_cookie", { domain: "unknown.com" })

  assert.equal(result.success, false)
  assert.ok(result.error?.includes('domain "unknown.com"'))
})

test("Cookie security: handles empty domain gracefully", async () => {
  saveConfig({ trusted_domains: ["example.com"] })
  const mockWs = createMockWebSocket()
  const threadManager = new ThreadManager()
  const skillEngine = new SkillEngine()
  const historyStore = new HistoryStore()

  const executor = createToolExecutor(mockWs as any, threadManager, skillEngine, historyStore)
  const result = await executor("tc-10", "get_cookies", { domain: "" })

  assert.equal(result.success, false)
  assert.ok(result.error?.includes('domain ""'))
})

test("High-risk API detection: blocks evaluate with fetch API", async () => {
  const mockWs = createMockWebSocket()
  const threadManager = new ThreadManager()
  const skillEngine = new SkillEngine()
  const historyStore = new HistoryStore()

  const executor = createToolExecutor(mockWs as any, threadManager, skillEngine, historyStore)
  const result = await executor("tc-11", "evaluate", {
    code: "fetch('/api/data').then(r => r.json())",
  })

  assert.equal(result.success, false)
  assert.ok(result.error?.includes("Security Block"))
  assert.deepEqual(result.data?.dangerous_apis_found, ["fetch"])
})

test("High-risk API detection: blocks evaluate with document.cookie", async () => {
  const mockWs = createMockWebSocket()
  const threadManager = new ThreadManager()
  const skillEngine = new SkillEngine()
  const historyStore = new HistoryStore()

  const executor = createToolExecutor(mockWs as any, threadManager, skillEngine, historyStore)
  const result = await executor("tc-12", "evaluate", {
    code: "console.log(document.cookie)",
  })

  assert.equal(result.success, false)
  assert.deepEqual(result.data?.dangerous_apis_found, ["document.cookie"])
})

test("High-risk API detection: blocks osascript_eval with dangerous APIs", async () => {
  const mockWs = createMockWebSocket()
  const threadManager = new ThreadManager()
  const skillEngine = new SkillEngine()
  const historyStore = new HistoryStore()

  const executor = createToolExecutor(mockWs as any, threadManager, skillEngine, historyStore)
  const result = await executor("tc-13", "osascript_eval", {
    expression: "localStorage.getItem('token')",
  })

  assert.equal(result.success, false)
  assert.deepEqual(result.data?.dangerous_apis_found, ["localStorage"])
})

test("High-risk API detection: allows evaluate with safe code", async () => {
  const mockWs = createMockWebSocket()
  const threadManager = new ThreadManager()
  const skillEngine = new SkillEngine()
  const historyStore = new HistoryStore()

  const executor = createToolExecutor(mockWs as any, threadManager, skillEngine, historyStore)

  // Will timeout but should not be blocked
  const promise = executor("tc-14", "evaluate", {
    code: "document.querySelector('.btn').click()",
  })

  assert.equal(mockWs.getMessages().length, 1)

  // Clean up
  await promise
})

test("High-risk API detection: detects bracket notation obfuscation", async () => {
  const mockWs = createMockWebSocket()
  const threadManager = new ThreadManager()
  const skillEngine = new SkillEngine()
  const historyStore = new HistoryStore()

  const executor = createToolExecutor(mockWs as any, threadManager, skillEngine, historyStore)
  const result = await executor("tc-15", "evaluate", {
    code: "window['fetch']('/api')",
  })

  assert.equal(result.success, false)
  assert.ok(result.data?.dangerous_apis_found.includes("bracket-fetch"))
})

test("High-risk API detection: detects Reflect.apply usage", async () => {
  const mockWs = createMockWebSocket()
  const threadManager = new ThreadManager()
  const skillEngine = new SkillEngine()
  const historyStore = new HistoryStore()

  const executor = createToolExecutor(mockWs as any, threadManager, skillEngine, historyStore)
  const result = await executor("tc-16", "evaluate", {
    code: "Reflect.apply(String.fromCharCode, null, [72, 105])",
  })

  assert.equal(result.success, false)
  assert.deepEqual(result.data?.dangerous_apis_found, ["Reflect.apply"])
})

test("High-risk API detection: detects setTimeout with string argument", async () => {
  const mockWs = createMockWebSocket()
  const threadManager = new ThreadManager()
  const skillEngine = new SkillEngine()
  const historyStore = new HistoryStore()

  const executor = createToolExecutor(mockWs as any, threadManager, skillEngine, historyStore)
  const result = await executor("tc-17", "evaluate", {
    code: "setTimeout('alert(1)', 1000)",
  })

  assert.equal(result.success, false)
  assert.deepEqual(result.data?.dangerous_apis_found, ["setTimeout-string"])
})

test("High-risk API detection: allows setTimeout with function argument", async () => {
  const mockWs = createMockWebSocket()
  const threadManager = new ThreadManager()
  const skillEngine = new SkillEngine()
  const historyStore = new HistoryStore()

  const executor = createToolExecutor(mockWs as any, threadManager, skillEngine, historyStore)

  // Will timeout but should not be blocked
  const promise = executor("tc-18", "evaluate", {
    code: "setTimeout(() => console.log('ok'), 1000)",
  })

  assert.equal(mockWs.getMessages().length, 1)

  // Clean up
  await promise
})

test("executeCompanionTool returns skill content for use_skill", async () => {
  const skillEngine = new SkillEngine()
  // Mock loadContent
  skillEngine.loadContent = (name: string) => {
    if (name === "test-skill") return "## Skill Instructions\nDo this..."
    return null
  }

  const result = await executeCompanionTool("use_skill", { skill_name: "test-skill" }, skillEngine)

  assert.equal(result.success, true)
  assert.equal(result.data?.skill_name, "test-skill")
  assert.equal(result.data?.content, "## Skill Instructions\nDo this...")
  assert.ok(result.data?.instruction?.includes("Use the following skill instructions"))
})

test("executeCompanionTool returns error for non-existent skill", async () => {
  const skillEngine = new SkillEngine()
  skillEngine.loadContent = () => null

  const result = await executeCompanionTool("use_skill", { skill_name: "nonexistent" }, skillEngine)

  assert.equal(result.success, false)
  assert.ok(result.error?.includes("not found"))
})

test("executeCompanionTool blocks osascript_eval without session", async () => {
  const skillEngine = new SkillEngine()

  const result = await executeCompanionTool("osascript_eval", { code: "1+1" }, skillEngine)

  assert.equal(result.success, false)
  assert.ok(result.error?.includes("requires an active WebSocket session"))
})

test("executeCompanionTool returns error for unknown companion tool", async () => {
  const skillEngine = new SkillEngine()

  const result = await executeCompanionTool("unknown_tool" as any, {}, skillEngine)

  assert.equal(result.success, false)
  assert.ok(result.error?.includes("Unknown companion tool"))
})

test("handleToolResult resolves pending tool promise with result", () => {
  const pendingTools = new Map<string, any>()
  const mockResolve = (() => {}) as any
  const mockTimer = setTimeout(() => {}, 10000)

  let resolvedValue: any = null
  pendingTools.set("tc-1", {
    resolve: (v: any) => { resolvedValue = v },
    timer: mockTimer,
  })

  const msg = {
    tool_call_id: "tc-1",
    success: true,
    data: "result data",
  }

  const handled = handleToolResult(msg, pendingTools, new ThreadManager())

  assert.equal(handled, true)
  assert.deepEqual(resolvedValue, { success: true, data: "result data" })
  assert.equal(pendingTools.has("tc-1"), false)
})

test("handleToolResult returns false for unknown tool_call_id", () => {
  const pendingTools = new Map<string, any>()
  const msg = { tool_call_id: "unknown", success: false }

  const handled = handleToolResult(msg, pendingTools, new ThreadManager())

  assert.equal(handled, false)
})

test("handleToolResult handles error result", () => {
  const pendingTools = new Map<string, any>()
  let resolvedValue: any = null
  const mockTimer = setTimeout(() => {}, 10000)

  pendingTools.set("tc-2", {
    resolve: (v: any) => { resolvedValue = v },
    timer: mockTimer,
  })

  const msg = {
    tool_call_id: "tc-2",
    error: "Something went wrong",
  }

  handleToolResult(msg, pendingTools, new ThreadManager())

  assert.deepEqual(resolvedValue, { error: "Something went wrong" })
})

test("Runtime config helpers: sets and gets runtime config", () => {
  const config = { trusted_domains: ["example.com"] }
  setRuntimeConfig(config)
  assert.deepEqual(getRuntimeConfig(), config)
})

test("Runtime config helpers: maintains config across calls", () => {
  setRuntimeConfig({ trusted_domains: ["*"] })
  const config1 = getRuntimeConfig()

  setRuntimeConfig({ trusted_domains: ["specific.com"] })
  const config2 = getRuntimeConfig()

  assert.deepEqual(config1.trusted_domains, ["*"])
  assert.deepEqual(config2.trusted_domains, ["specific.com"])
})

// ============================================================================
// security.ts tests (used by tool-executor)
// ============================================================================

test("isTrustedDomain: blocks empty list", () => {
  saveConfig({ trusted_domains: [] })
  assert.equal(isTrustedDomain("example.com"), false)
})

test("isTrustedDomain: allows exact match", () => {
  saveConfig({ trusted_domains: ["example.com"] })
  assert.equal(isTrustedDomain("example.com"), true)
  assert.equal(isTrustedDomain("other.com"), false)
})

test("isTrustedDomain: allows wildcard matching", () => {
  saveConfig({ trusted_domains: ["*.company.com"] })
  assert.equal(isTrustedDomain("hr.company.com"), true)
  assert.equal(isTrustedDomain("finance.company.com"), true)
  assert.equal(isTrustedDomain("company.com"), true)
  assert.equal(isTrustedDomain("evil.com"), false)
})

test("isTrustedDomain: allows global wildcard", () => {
  saveConfig({ trusted_domains: ["*"] })
  assert.equal(isTrustedDomain("anywhere.com"), true)
  assert.equal(isTrustedDomain("*"), true)
})

test("checkHighRiskExecution: blocks fetch", () => {
  const result = checkHighRiskExecution("evaluate", "fetch('/api')")
  assert.equal(result.blocked, true)
  assert.deepEqual(result.dangerousApis, ["fetch"])
  assert.ok(result.error?.includes("Security Block"))
})

test("checkHighRiskExecution: allows safe code", () => {
  const result = checkHighRiskExecution("evaluate", "document.querySelector('.btn')")
  assert.equal(result.blocked, false)
  assert.deepEqual(result.dangerousApis, [])
})

test("checkHighRiskExecution: detects multiple dangerous APIs", () => {
  const result = checkHighRiskExecution("evaluate", "fetch() && localStorage.getItem()")
  assert.equal(result.blocked, true)
  assert.ok(result.dangerousApis.length >= 2)
  assert.ok(result.dangerousApis.includes("fetch"))
  assert.ok(result.dangerousApis.includes("localStorage"))
})

import test, { after, before } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-agent-test-"))

let initDataDir: typeof import("../src/config").initDataDir
let getConfig: typeof import("../src/config").getConfig
let saveConfig: typeof import("../src/config").saveConfig
let ThreadManager: typeof import("../src/threads/thread-manager").ThreadManager
let isTrustedDomain: typeof import("../src/security").isTrustedDomain
let detectDangerousApis: typeof import("../src/security").detectDangerousApis
let checkHighRiskExecution: typeof import("../src/security").checkHighRiskExecution
let classifyError: typeof import("../src/security").classifyError
let handleMessage: typeof import("../src/message-router").handleMessage
let createToolResultMessage: typeof import("../src/llm/adapter").createToolResultMessage
let SecurityConfirmationManager: typeof import("../src/security-confirmation").SecurityConfirmationManager
let redactLogData: typeof import("../src/logger").redactLogData
let logEvent: typeof import("../src/logger").logEvent
let getLogFilePath: typeof import("../src/logger").getLogFilePath

before(async () => {
  process.env.HOME = tempHome
  delete process.env.DEEPSEEK_API_KEY

  const config = await import("../src/config")
  const threadManager = await import("../src/threads/thread-manager")
  const security = await import("../src/security")
  const messageRouter = await import("../src/message-router")
  const adapter = await import("../src/llm/adapter")
  const securityConfirmation = await import("../src/security-confirmation")
  const logger = await import("../src/logger")

  initDataDir = config.initDataDir
  getConfig = config.getConfig
  saveConfig = config.saveConfig
  ThreadManager = threadManager.ThreadManager
  isTrustedDomain = security.isTrustedDomain
  detectDangerousApis = security.detectDangerousApis
  checkHighRiskExecution = security.checkHighRiskExecution
  classifyError = security.classifyError
  handleMessage = messageRouter.handleMessage
  createToolResultMessage = adapter.createToolResultMessage
  SecurityConfirmationManager = securityConfirmation.SecurityConfirmationManager
  redactLogData = logger.redactLogData
  logEvent = logger.logEvent
  getLogFilePath = logger.getLogFilePath

  await initDataDir()
})

test("tool result messages persist with OpenAI-compatible tool call linkage", () => {
  const manager = new ThreadManager()
  const thread = manager.create("Tool result regression", "tool01")
  const toolCall = {
    id: "call_123",
    function: { name: "get_page_text", arguments: "{\"tabId\":303}" },
  }
  const result = { success: true, data: { text: "hello" } }

  manager.addMessage(thread.id, createToolResultMessage(thread.id, toolCall, result, { tabId: 303 }))

  const [message] = manager.getMessages(thread.id)
  assert.equal(message.role, "tool")
  assert.equal(message.thread_id, thread.id)
  assert.equal(message.content, JSON.stringify(result))
  assert.deepEqual(message.tool_calls?.[0], {
    id: "call_123",
    tool_name: "get_page_text",
    params: { tabId: 303 },
    result,
  })
})

test("thread.update route persists pinned tabs through the message router", async () => {
  const manager = new ThreadManager()
  const thread = manager.create("Router update regression", "upd123")

  const response = await handleMessage(
    { type: "thread.update", thread_id: thread.id, updates: { pinned_tabs: [303] } },
    { threadManager: manager, skillEngine: {} as any, historyStore: {} as any },
  )

  assert.equal(response.type, "thread.updated")
  assert.deepEqual(response.thread.pinned_tabs, [303])
  assert.deepEqual(new ThreadManager().get(thread.id)?.pinned_tabs, [303])
})

test("config.set persists trusted domains without saving masked API keys", async () => {
  saveConfig({ llm: { api_key: "real-key" } as any, trusted_domains: [] })

  const response = await handleMessage(
    {
      type: "config.set",
      config: {
        base_url: "https://example.test/v1",
        api_key: "***",
        model_name: "model-x",
        temperature: 0.2,
        context_window: 4096,
        trusted_domains: ["example.com", "*.company.com"],
      },
    },
    { threadManager: new ThreadManager(), skillEngine: {} as any, historyStore: {} as any },
  )

  assert.equal(response.type, "config.updated")
  assert.deepEqual(getConfig().trusted_domains, ["example.com", "*.company.com"])
  assert.equal(getConfig().llm.api_key, "real-key")
  assert.equal(response.config.llm.api_key, "***")

  await handleMessage(
    { type: "config.set", config: { trusted_domains: [] } },
    { threadManager: new ThreadManager(), skillEngine: {} as any, historyStore: {} as any },
  )

  assert.deepEqual(getConfig().trusted_domains, [])
})

after(() => {
  fs.rmSync(tempHome, { recursive: true, force: true })
})

test("ThreadManager.update persists pinned tab state", () => {
  const manager = new ThreadManager()
  const thread = manager.create("Pinned tabs regression", "pin123")

  const updated = manager.update(thread.id, { pinned_tabs: [101, 202] })

  assert.deepEqual(updated?.pinned_tabs, [101, 202])
  const reloaded = new ThreadManager()
  assert.deepEqual(reloaded.get(thread.id)?.pinned_tabs, [101, 202])
})

test("trusted domain matching supports exact, wildcard, and global patterns", () => {
  // Apex collapse is INTENTIONAL per ADR-007: a user typing `*.company.com`
  // wants the apex covered too. Bare-TLD wildcards (`*`, `*.com`) are filtered
  // at saveConfig time (see "saveConfig filters dangerous wildcards" test below).
  saveConfig({ trusted_domains: ["example.com", "*.company.com"] })

  assert.equal(isTrustedDomain("example.com"), true)
  assert.equal(isTrustedDomain("hr.company.com"), true)
  assert.equal(isTrustedDomain("company.com"), true) // apex collapse, ADR-007
  assert.equal(isTrustedDomain("evil.com"), false)
})

test("security: saveConfig filters dangerous wildcards (S-P0-4, 2026-07-24)", () => {
  // S-P0-4: saveConfig drops bare-TLD / global wildcards from trusted_domains
  // and auto_approved_domains to prevent global auto-approve bypasses.
  // Deep wildcards like `*.evil.com` survive — they're legitimate scoped grants.
  // Apex-match semantics in matchDomain intentionally preserved for legitimate
  // `*.example.com` use cases.
  saveConfig({ trusted_domains: ["*", "*.com", "*.org", "example.com"] })
  assert.deepEqual(getConfig().trusted_domains, ["example.com"])

  saveConfig({ auto_approved_domains: ["*", "*.com", "*.evil.com", "good.com"] })
  assert.deepEqual(getConfig().auto_approved_domains, ["*.evil.com", "good.com"])
})

test("security: saveConfig filters multi-tenant eTLD wildcards (A10, Grok round 2)", () => {
  // A10 (Grok round 2): multi-tenant eTLD wildcards (`*.github.io`,
  // `*.appspot.com`, etc.) — these would auto-approve EVERY user-project
  // subdomain on those platforms. Hardcoded partial list (see A8 residual
  // in security.ts — full PSL package is P1).
  saveConfig({ trusted_domains: ["*.github.io", "*.appspot.com", "*.vercel.app", "*.example.com"] })
  assert.deepEqual(getConfig().trusted_domains, ["*.example.com"])
})

test("security: matchDomain honors legacy `*` when config bypasses saveConfig", () => {
  // Direct call to matchDomain still honors `*` — saveConfig is the gate, the
  // runtime matcher is permissive so hand-edited config.json on disk still
  // behaves the way it always did (no surprise breakage for existing users).
  const { matchDomain } = require("../src/security") as typeof import("../src/security")
  assert.equal(matchDomain(["*"], "anywhere.test"), true)
  assert.equal(matchDomain(["*.example.com"], "example.com"), true) // apex collapse
})

test("dangerous JavaScript APIs are detected before evaluate-style execution", () => {
  assert.deepEqual(
    detectDangerousApis("fetch('/api'); document.cookie; localStorage.getItem('k')"),
    ["fetch", "localStorage", "document.cookie"],
  )
  assert.deepEqual(detectDangerousApis("document.body?.innerText || ''"), [])
})

test("high-risk regex still flags fetch; tokenless osascript is not a fake confirm-block", async () => {
  const safety = checkHighRiskExecution("evaluate", "fetch('/api')")
  assert.equal(safety.blocked, true)
  assert.deepEqual(safety.dangerousApis, ["fetch"])

  // Verify no false positives: "prefetch" should NOT match
  const safeResult = checkHighRiskExecution("evaluate", "prefetch('/api')")
  assert.equal(safeResult.blocked, false)

  const response = await handleMessage(
    { type: "osascript_eval", id: "tool_1", url: "example.com", expression: "document.cookie" },
    { threadManager: new ThreadManager(), skillEngine: {} as any, historyStore: {} as any },
  )

  assert.equal(response.type, "tool.result")
  assert.equal(response.success, false)
  // non-darwin: platform early-reject. darwin without a session must not
  // pretend confirmation was refused (L2 lives on executeTool).
  if (process.platform !== "darwin") {
    assert.match(response.error, /macos-only/i)
  } else {
    assert.match(response.error, /No session available/)
    assert.doesNotMatch(response.error, /Execution requires user confirmation/)
  }
})

test("security block errors are classified as security stops", () => {
  assert.equal(classifyError("Security Block: evaluate contains high-risk APIs (fetch(). User denied execution."), "security")
})

test("script injection failures are recoverable so the agent can try fallback tools", () => {
  assert.equal(classifyError("Script injection failed in both ISOLATED and MAIN worlds", { toolName: "get_page_html" }), "recoverable")
  assert.equal(classifyError("Script injection failed in both ISOLATED and MAIN worlds; DOM fallback failed: Debugger attach failed", { toolName: "get_page_html" }), "recoverable")
})

test("classifyError 'No tab with id 303' is recoverable", () => {
  assert.equal(classifyError("No tab with id 303", { toolName: "get_page_text" }), "recoverable")
})

test("classifyError 'unknown error' defaults to non_recoverable", () => {
  assert.equal(classifyError("completely unknown error message"), "non_recoverable")
})

test("MCP capability mismatch is recoverable so the LLM can switch to the namespaced tool", () => {
  assert.equal(
    classifyError("MCP server filesystem does not advertise the resources capability, so mcp_list_resources cannot be used here. Use namespaced tools instead: mcp__filesystem__list_directory."),
    "recoverable",
  )
})

test("classifyError 'permission denied: camera' is non_recoverable", () => {
  assert.equal(classifyError("permission denied: camera access"), "non_recoverable")
})

test("classifyError scene tool_not_allowed is recoverable", () => {
  assert.equal(
    classifyError("当前场景不允许「列出工作区文件」。可退出场景后重试，或改用场景内允许的工具。", {
      toolName: "workspace_list_dir",
    }),
    "recoverable",
  )
  assert.equal(
    classifyError("tool_not_allowed:workspace_list_dir — not in thread tool_whitelist"),
    "recoverable",
  )
})

test("classifyError MCP EPERM (.Trash TCC denial) is recoverable", () => {
  // Repro: directory_tree on /Users/huchen hits macOS TCC at ~/.Trash. Upstream
  // MCP server-filesystem surfaces this as "EPERM: operation not permitted,
  // scandir '/Users/huchen/.Trash'" and the LLM should narrow scope and retry
  // — not have the whole conversation killed by the non_recoverable default.
  // See security.ts:recoverable list (added 2026-07-14).
  assert.equal(
    classifyError("MCP filesystem/directory_tree returned error: EPERM: operation not permitted, scandir '/Users/huchen/.Trash'"),
    "recoverable",
  )
  assert.equal(classifyError("EPERM: operation not permitted"), "recoverable")
})

test("classifyError 'timeout waiting for selector' is recoverable", () => {
  assert.equal(classifyError("timeout waiting for selector '#btn'"), "recoverable")
})

test("classifyError workspace_root not set is recoverable (Mission Pack DevSec)", () => {
  assert.equal(
    classifyError(
      "需要先绑定工作区，才能读写本机文件夹。\n下一步：打开侧栏「场景」→ 点「选择工作区」\n[workspace_root not set — pick a folder first]",
      { toolName: "workspace_list_dir" },
    ),
    "recoverable",
  )
  assert.equal(classifyError("module_disabled:devsec-workspace"), "recoverable")
})

test("classifyError default_sandbox_unavailable is recoverable (Scheme 1 N4)", () => {
  assert.equal(
    classifyError(
      "cannot create default sandbox ~/CMspark-projects: EACCES [default_sandbox_unavailable]",
      { toolName: "workspace_list_dir" },
    ),
    "recoverable",
  )
  assert.equal(
    classifyError(
      "cannot use default sandbox ~/CMspark-projects: path is a symbolic link (refusing in-home redirect) [default_sandbox_unavailable]",
    ),
    "recoverable",
  )
})

test("classifyError MCP parent directory / allowlist path is recoverable", () => {
  assert.equal(
    classifyError(
      "MCP filesystem/create_directory returned error: Parent directory does not exist: /Users/huchen/foo",
      { toolName: "mcp__filesystem__create_directory" },
    ),
    "recoverable",
  )
  assert.equal(
    classifyError("Access denied - path outside allowed directories: /etc"),
    "recoverable",
  )
})

test("formatChatErrorLine high-risk: deny mentions 弹窗; leftover after-approve does not", async () => {
  const { formatChatErrorLine, looksLikeUserDeniedGateCopy } = await import("../src/capability/user-gate-copy")
  assert.equal(looksLikeUserDeniedGateCopy("User denied execution."), true)
  assert.equal(looksLikeUserDeniedGateCopy("你拒绝了这次页面脚本"), true)
  assert.equal(looksLikeUserDeniedGateCopy("不是你拒绝了弹窗"), false)
  const denied = formatChatErrorLine(
    "security",
    "Security Block: osascript_eval contains high-risk APIs (fetch). User denied execution.",
  )
  assert.match(denied, /拒绝/)
  assert.match(denied, /若你已拒绝弹窗/)

  const timeout = formatChatErrorLine(
    "security",
    "Security Block: osascript_eval contains high-risk APIs (fetch). User confirmation timed out.",
  )
  assert.match(timeout, /超时/)
  assert.ok(!timeout.includes("若你已拒绝弹窗"))

  const leftover = formatChatErrorLine(
    "security",
    "Security Block: osascript_eval contains high-risk APIs (fetch). Execution requires user confirmation.",
  )
  assert.match(leftover, /这不是确认弹窗/)
  assert.ok(!leftover.includes("若你已拒绝弹窗"))

  const notDenied = formatChatErrorLine(
    "security",
    "页面脚本（fetch）需要确认，但确认通道不可用。\n这不是确认弹窗：侧栏未连上或确认台不可用，不是你拒绝了。",
  )
  assert.ok(!notDenied.includes("若你已拒绝弹窗"), `got: ${notDenied}`)
})

test("formatChatErrorLine scheme/cage hard-blocks do not mention 弹窗", async () => {
  const { formatChatErrorLine } = await import("../src/capability/user-gate-copy")
  const scheme = formatChatErrorLine(
    "security",
    "Security Block: create_tab to javascript: scheme is not allowed. Only http/https URLs are permitted.",
  )
  assert.match(scheme, /这不是确认弹窗/)
  assert.ok(!scheme.includes("若你已拒绝弹窗"))
  assert.ok(!scheme.startsWith("操作未通过安全确认"))

  const cage = formatChatErrorLine(
    "security",
    "Security Block: navigate to local path is not allowed (sensitive/system/unc).",
  )
  assert.match(cage, /这不是确认弹窗/)
  assert.match(cage, /不是 MCP/)
  assert.ok(!cage.includes("若你已拒绝弹窗"))

  const invalid = formatChatErrorLine(
    "security",
    "Security Block: create_tab to file: URL is invalid. This is not a confirmation dialog.",
  )
  assert.match(invalid, /这不是确认弹窗/)
  assert.ok(!invalid.includes("若你已拒绝弹窗"))
})

test("humanizeChatErrorForUser: files.example.com WS drop is not mislabeled as local file error (L4)", async () => {
  const { humanizeChatErrorForUser } = await import("../src/capability/user-gate-copy")
  const mislabel = humanizeChatErrorForUser(
    'Security Block: navigate to untrusted domain "files.example.com" requires user confirmation, but the WebSocket is not connected.',
  )
  assert.ok(!mislabel.includes("无法打开该本地文件地址"), `got: ${mislabel}`)

  const fileDisconnect = humanizeChatErrorForUser(
    "Security Block: create_tab to local file requires user confirmation, but the WebSocket is not connected. This is not a denied popup.",
  )
  assert.match(fileDisconnect, /无法打开该本地文件地址/)

  const invalid = humanizeChatErrorForUser(
    "Security Block: create_tab to file: URL is invalid. This is not a confirmation dialog.",
  )
  assert.match(invalid, /无法打开该本地文件地址/)
})

test("cage copy says common credential paths, no 凭据目录 overclaim (L3)", async () => {
  const { humanizeChatErrorForUser } = await import("../src/capability/user-gate-copy")
  const cage = humanizeChatErrorForUser(
    "Security Block: navigate to local path is not allowed (sensitive/system/unc).",
  )
  assert.match(cage, /常见凭据路径/)
  assert.ok(!cage.includes("凭据目录"))
})

test("formatChatErrorLine softens workspace / scene gates (not 安全阻断)", async () => {
  const { formatChatErrorLine, WORKSPACE_ROOT_NOT_SET_ERROR } = await import(
    "../src/capability/user-gate-copy"
  )
  const w = formatChatErrorLine("non_recoverable", WORKSPACE_ROOT_NOT_SET_ERROR)
  assert.ok(
    w.includes("默认沙箱") ||
      w.includes("CMspark-projects") ||
      w.includes("选择工作区") ||
      w.includes("绑定"),
  )
  assert.ok(!w.includes("安全阻断"))
  assert.ok(!w.startsWith("不可恢复"))

  const s = formatChatErrorLine(
    "security",
    "当前场景不允许「工作区列表」。可退出场景后重试。 [tool_not_allowed]",
  )
  assert.ok(s.includes("场景") || s.includes("退出") || s.includes("工具面") || s.includes("全工具"))
  assert.ok(!s.startsWith("安全阻断:"))
  assert.ok(!s.includes("God-mode 不会放开"))
  assert.ok(!/新建对话/.test(s) || /勿新建|不要新建/.test(s))
})

test("classifyError ENOENT / no such file is recoverable (workspace missing path)", () => {
  // Regression n2486l: workspace_read_file on a non-existent path returned
  // raw Node "ENOENT: no such file or directory, stat '…'" which defaulted to
  // non_recoverable → chat.error "不可恢复错误" and killed the turn.
  // "not found" does NOT match "no such file" — keep both explicit.
  assert.equal(
    classifyError(
      "ENOENT: no such file or directory, stat '/Users/huchen/Downloads/tmp/test.txt'",
      { toolName: "workspace_read_file" },
    ),
    "recoverable",
  )
  assert.equal(classifyError("no such file or directory"), "recoverable")
  assert.equal(classifyError("ENOENT"), "recoverable")
  assert.equal(
    classifyError(
      "file not found: test.txt (list the directory with workspace_list_dir and pick an existing path)",
      { toolName: "workspace_read_file" },
    ),
    "recoverable",
  )
})

test("classifyError wait_for missing selector/network_idle is recoverable (thread 1snvlv)", () => {
  assert.equal(
    classifyError("selector or network_idle is required", { toolName: "wait_for" }),
    "recoverable",
  )
  assert.equal(
    classifyError("WAIT_CONDITION_REQUIRED: selector or network_idle is required", { toolName: "wait_for" }),
    "recoverable",
  )
})

test("classifyError osascript missing url/expression is recoverable (not chat-killing)", () => {
  // Regression l74du8: LLM often omitted url; runtime error was default non_recoverable
  // → "不可恢复错误: url and expression required" and the whole turn stopped.
  assert.equal(
    classifyError("url and expression required", { toolName: "osascript_eval" }),
    "recoverable",
  )
  assert.equal(
    classifyError(
      "osascript_eval requires expression. Pass tabId from list_tabs, or the exact url list_tabs returned. Fragments like zhihu.com are rejected. Got url=missing, tabId=missing, expression=set.",
      { toolName: "osascript_eval" },
    ),
    "recoverable",
  )
})

test("classifyError web act-loop codes are recoverable (not chat.error)", () => {
  assert.equal(classifyError("CDP_ATTACH_FAILED: debugger attach failed"), "recoverable")
  assert.equal(classifyError("DOM_SCRIPT_VOLUME_CAPPED: stop or change the task"), "recoverable")
  assert.equal(classifyError("EVAL_DEAD_WORLD: probe failed"), "recoverable")
  assert.equal(classifyError("SITE_OP_BANNED: already failed text:写文章"), "recoverable")
  assert.equal(classifyError("TAB_ATTACH_FROZEN: CDP attach already failed"), "recoverable")
})

test("classifyError TAB_LEASE_CAP is recoverable so agent can close_tab and retry", () => {
  assert.equal(
    classifyError(
      "TAB_LEASE_CAP: worker already holds 2 tab leases (tabs [10, 11]). close_tab one of those tabs before leasing tab 12",
      { toolName: "get_page_text" },
    ),
    "recoverable",
  )
  assert.equal(classifyError("worker already holds 2 tab leases"), "recoverable")
  assert.equal(classifyError("process tab lease cap 10 reached"), "recoverable")
})
test("logger redacts sensitive keys recursively", () => {
  const redacted = redactLogData({
    api_key: "sk-secret",
    headers: {
      authorization: "Bearer token",
      cookie: "sid=123",
      safe: "value",
    },
    nested: [
      {
        password: "pw",
        access_token: "token",
        ok: true,
      },
    ],
  }) as any

  assert.equal(redacted.api_key, "[REDACTED]")
  assert.equal(redacted.headers.authorization, "[REDACTED]")
  assert.equal(redacted.headers.cookie, "[REDACTED]")
  assert.equal(redacted.headers.safe, "value")
  assert.equal(redacted.nested[0].password, "[REDACTED]")
  assert.equal(redacted.nested[0].access_token, "[REDACTED]")
  assert.equal(redacted.nested[0].ok, true)
})

test("logger writes redacted JSONL entries under logs directory", () => {
  const now = new Date("2026-01-02T03:04:05.000Z")
  const filePath = getLogFilePath(now)
  fs.rmSync(path.dirname(filePath), { recursive: true, force: true })

  logEvent("info", "test.event", { api_key: "sk-secret", count: 1 }, "test", now)

  const [line] = fs.readFileSync(filePath, "utf-8").trim().split("\n")
  const entry = JSON.parse(line)
  assert.equal(entry.ts, "2026-01-02T03:04:05.000Z")
  assert.equal(entry.level, "info")
  assert.equal(entry.source, "test")
  assert.equal(entry.event, "test.event")
  assert.equal(entry.data.api_key, "[REDACTED]")
  assert.equal(entry.data.count, 1)
})

test("security confirmation manager resolves approval and denial responses", async () => {
  const sent: any[] = []
  const manager = new SecurityConfirmationManager(1000)

  const approvedPromise = manager.request((msg) => sent.push(msg), {
    toolName: "evaluate",
    dangerousApis: ["fetch("],
    code: "fetch('/api')",
  })
  assert.equal(sent[0].type, "security.confirmation.request")
  assert.equal(manager.respond(sent[0].confirmation_id, true), true)
  assert.deepEqual(await approvedPromise, {
    confirmationId: sent[0].confirmation_id,
    approved: true,
    reason: "approved",
  })
  assert.equal(sent[1].type, "security.confirmation.resolved")

  const deniedPromise = manager.request((msg) => sent.push(msg), {
    toolName: "osascript_eval",
    dangerousApis: ["document.cookie"],
    code: "document.cookie",
  })
  const deniedRequest = sent[sent.length - 1]
  assert.equal(manager.respond(deniedRequest.confirmation_id, false), true)
  assert.deepEqual(await deniedPromise, {
    confirmationId: deniedRequest.confirmation_id,
    approved: false,
    reason: "denied",
  })
})

test("security confirmation manager times out unresolved requests", async () => {
  const sent: any[] = []
  const manager = new SecurityConfirmationManager(5)

  const decision = await manager.request((msg) => sent.push(msg), {
    toolName: "evaluate",
    dangerousApis: ["localStorage"],
    code: "localStorage.getItem('k')",
  })

  assert.equal(decision.approved, false)
  assert.equal(decision.reason, "timeout")
  assert.equal(sent[1].type, "security.confirmation.expired")
})

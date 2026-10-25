// Actual confirmation producer -> actual MCP dispatch -> actual user copy.
// All config, routing, transport and clocks are inert CPU seams; no MCP process,
// provider, socket, personal configuration or native API is imported/executed.
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import vm from "node:vm"
import ts from "typescript"
import { formatChatErrorLine, humanizeChatErrorForUser } from "../src/capability/user-gate-copy"

const root = process.env.CMSPARK_SOURCE_ROOT ?? path.resolve(__dirname, "../../src")
function source(name: string) { return fs.readFileSync(path.join(root, name), "utf8") }
function compile(text: string, globals: Record<string, unknown> = {}): any {
  const exports = {}
  const js = ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  vm.runInNewContext(js, { exports, ...globals }, { timeout: 1000 })
  return exports
}

function fixture(reason: "denied" | "timeout" | "disconnect" | "approved") {
  let external = 0, calls = 0, cached = 0, confirmations = 0
  const forbidden = (name: string): never => { external++; throw Error(`FORBIDDEN_EXTERNAL_DEPENDENCY:${name}`) }
  let serial = 0
  const timers = new Map<number, () => void>()
  const Manager = compile(source("security-confirmation.ts"), {
    setTimeout(callback: () => void) { const id = ++serial; timers.set(id, callback); return id },
    clearTimeout(id: number) { timers.delete(id) },
    require(name: string) {
      if (name === "crypto") return { randomUUID: () => `owned-confirmation-${++serial}` }
      if (name === "./computer/preview-availability") return { normalizePreviewUnavailableReason: () => undefined }
      return forbidden(name)
    },
  }).SecurityConfirmationManager
  const manager = new Manager() // Its production deadline is unchanged; the CPU clock is controlled.
  const socket = { readyState: 1 }
  const identity = {}
  const mcp = {
    resolveToolName: () => ({ serverName: "filesystem", toolName: "edit_file" }),
    getAuthorizationIdentity: () => identity,
    getAuthorizationContract: () => identity,
    getTrustLevel: () => "manual",
    getServerConfig: () => ({}),
    callTool: async () => { calls++; return { content: [{ type: "text", text: "owned result" }] } },
    readResource: async () => { calls++; return { contents: [] } },
  }
  const actual = compile(source("mcp/dispatch.ts"), {
    require(name: string) {
      if (name === "ws") return { WebSocket: { OPEN: 1 } }
      if (name === "../config") return { getConfig: () => ({ security: { auto_approve_dangerous: false, auto_approve_enterprise_tools: false, allow_all_schemes: false } }) }
      if (name === "../logger") return { logger: { info() {}, warn() {} } }
      if (name === "../security") return {
        classifyMcpCall: () => ["file-write"], mergeCapabilities: (capabilities: string[]) => ({ capabilities, declaredResolvedUnknown: false }),
        CRITICAL_MCP_CAPABILITIES: new Set(["file-write"]), CRITICAL_MCP_META_TOOLS: new Set(["mcp_read_resource"]),
      }
      if (name === "../tool/l2-admission") return { isFullAutonomyCruise: () => false }
      if (name === "./workspace-observation") return { carryMcpWorkspaceObservation() {} }
      if (name === "./manager") return { getMcpManager: () => mcp }
      if (name === "./confirm-cache") return { getMcpConfirmCache: () => ({ isApproved: () => false, approve() { cached++ }, recordCall() {} }) }
      if (name === "./confirm-target") return { resolveMcpConfirmTarget: () => ({}) }
      if (name === "./confirm-fanout") return {
        pickExtensionWsFromAuth: () => null,
        resolveConfirmBinding: ({ originatingWs }: any) => ({ originWs: originatingWs }),
        fanOutConfirmRequest({ data }: any) {
          if (data.type !== "security.confirmation.request") return
          confirmations++
          if (reason === "timeout") {
            const callback = [...timers.values()][0]
            assert.ok(callback)
            callback() // Real SecurityConfirmationManager timeout decision, no hand-written DTO.
          } else if (reason === "disconnect") manager.rejectAll("disconnect", socket)
          else manager.respondFrom(data.confirmation_id, reason === "approved", socket)
        },
      }
      if (name === "../ws/extension-peer") return { ensureExtensionPeerForOverlayConfirm: () => forbidden(name) }
      return forbidden(name)
    },
  })
  actual.bindMcpDispatchRuntime({
    getThreadManager: () => null, securityConfirmations: manager, broadcastToClients() {},
    getWsSurface: () => "panel", getClients: () => [socket], wsAuthGet: () => ({ authenticated: true }),
  })
  return {
    async call(meta: boolean) {
      return meta
        ? actual.executeMcpMetaTool("mcp_read_resource", { server: "filesystem", uri: "owned:fixture" }, "owned-session", socket)
        : actual.executeMcpTool("mcp__filesystem__edit_file", { path: "/owned/fixture.txt", edits: [] }, "owned-session", socket)
    },
    actual,
    effects: () => ({ external, calls, cached, confirmations }),
  }
}

function actualLegacyClassifier() {
  const text = source("security.ts")
  const sf = ts.createSourceFile("security.ts", text, ts.ScriptTarget.Latest, true)
  const fn = sf.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "classifyError")
  assert.ok(fn)
  // No error_code is supplied: this exercises the real legacy prefix branch,
  // not a synthetic replacement or a claimed review of the global code table.
  return compile(fn.getText(sf), { ERROR_CODE_LEVELS: new Map(), isTrustedDomain: () => true }).classifyError
}

test("776 real confirmation timeout refuses both MCP dispatch families without blaming the user", async () => {
  const classify = actualLegacyClassifier()
  for (const meta of [false, true]) {
    const f = fixture("timeout"), result = await f.call(meta)
    assert.equal(result.success, false)
    assert.match(result.error, /^Security Block: MCP (?:tool|meta-tool) /)
    assert.match(result.error, /confirmation timed out before dispatch$/)
    assert.doesNotMatch(result.error, /by user/)
    assert.equal(classify(result.error), "security")
    const copy = formatChatErrorLine("security", result.error)
    assert.match(copy, /等待超时/)
    assert.match(copy, /工具未执行/)
    assert.doesNotMatch(copy, /你拒绝了|批准后被误拦|若刚批过/)
    assert.deepEqual(f.effects(), { external: 0, calls: 0, cached: 0, confirmations: 1 })
  }
})

test("776 real explicit denial retains the legacy security refusal for both MCP dispatch families", async () => {
  const classify = actualLegacyClassifier()
  for (const meta of [false, true]) {
    const f = fixture("denied"), result = await f.call(meta)
    assert.equal(result.success, false)
    assert.match(result.error, / denied by user$/)
    assert.equal(classify(result.error), "security")
    assert.match(formatChatErrorLine("security", result.error), /你拒绝了这次 MCP 工具调用/)
    assert.doesNotMatch(formatChatErrorLine("security", result.error), /等待超时|批准后被误拦/)
    assert.deepEqual(f.effects(), { external: 0, calls: 0, cached: 0, confirmations: 1 })
  }
})

test("776 real disconnect refuses both MCP dispatch families without inventing a missing or rejected prompt", async () => {
  const classify = actualLegacyClassifier()
  for (const meta of [false, true]) {
    const f = fixture("disconnect"), result = await f.call(meta)
    assert.equal(result.success, false)
    assert.match(result.error, /confirmation channel disconnected before dispatch$/)
    assert.equal(classify(result.error), "security")
    const copy = formatChatErrorLine("security", result.error)
    assert.match(copy, /确认连接已断开/)
    assert.doesNotMatch(copy, /你拒绝了|确认没送到|批准后被误拦/)
    assert.deepEqual(f.effects(), { external: 0, calls: 0, cached: 0, confirmations: 1 })
  }
})

test("776 original approval still reaches exactly one inert MCP operation without weakening refusal gates", async () => {
  for (const meta of [false, true]) {
    const f = fixture("approved"), result = await f.call(meta)
    assert.equal(result.success, true)
    assert.deepEqual(f.effects(), { external: 0, calls: 1, cached: 0, confirmations: 1 })
  }
})

test("776 old installed MCP timeout/disconnect strings receive accurate copy while ordinary execution timeouts do not", () => {
  const legacyTimeout = "Security Block: MCP tool filesystem/edit_file timeout by user"
  const legacyDisconnect = "Security Block: MCP meta-tool mcp_read_resource (filesystem) disconnect by user"
  assert.match(formatChatErrorLine("security", legacyTimeout), /确认等待超时/)
  assert.match(formatChatErrorLine("security", legacyDisconnect), /确认连接已断开/)
  for (const error of [legacyTimeout, legacyDisconnect]) assert.doesNotMatch(formatChatErrorLine("security", error), /你拒绝了|批准后被误拦/)
  const serverTimeout = "MCP call to filesystem/edit_file timed out. Underlying error: MCP timeout"
  assert.equal(humanizeChatErrorForUser(serverTimeout), serverTimeout)
  assert.doesNotMatch(formatChatErrorLine("recoverable", serverTimeout), /工具未执行|确认等待超时/)
  const f = fixture("denied")
  const unavailable = f.actual.mcpConfirmationFailureMessage("MCP tool filesystem/edit_file", "approved")
  assert.match(formatChatErrorLine("security", unavailable), /确认通道不可用/)
  assert.doesNotMatch(formatChatErrorLine("security", unavailable), /by user|你拒绝了|批准后被误拦/)
})

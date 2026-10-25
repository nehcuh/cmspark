// #776: real filesystem producer, actual dispatch and allow-dir admission.
// Only owned stdio/file IO; live configuration and authorization are inert.
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import vm from "node:vm"
import { EventEmitter } from "node:events"
import ts from "typescript"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"

const root = process.env.CMSPARK_SOURCE_ROOT ?? path.resolve(__dirname, "../../src")

function loopGrade(toolResult: unknown): string {
  const source = (name: string) => {
    const text = fs.readFileSync(path.join(root, name), "utf8")
    return ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true)
  }
  const security = source("security.ts"), adapter = source("llm/adapter.ts")
  const classify = security.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === "classifyError")
  assert.ok(classify)
  const rows: string[] = [], declarations: Record<string, string[]> = { classCode: [], errorLevel: [] }
  const visit = (node: ts.Node) => {
    if (ts.isArrayLiteralExpression(node) && node.elements.length === 2 &&
        ts.isStringLiteral(node.elements[0]) && node.elements[0].text === "MCP_EDIT_MATCH_NOT_FOUND") rows.push(node.getText(security))
    ts.forEachChild(node, visit)
  }
  visit(security)
  const consumer = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && declarations[node.name.text]) {
      declarations[node.name.text].push(node.parent.parent.getText(adapter))
    }
    ts.forEachChild(node, consumer)
  }
  consumer(adapter)
  assert.equal(rows.length, 1)
  assert.equal(declarations.classCode.length, 1)
  assert.equal(declarations.errorLevel.length, 1)
  const text = `const ERROR_CODE_LEVELS = new Map([${rows[0]}]);\n${classify.getText(security)}\n` +
    `function grade(toolResult, toolName) { ${declarations.classCode[0]} ${declarations.errorLevel[0]} return errorLevel; } exports.grade = grade;`
  const exports: any = {}
  vm.runInNewContext(ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText,
    { exports, isTrustedDomain: () => true }, { timeout: 1000 })
  return exports.grade(toolResult, "mcp__filesystem__edit_file")
}

function fixture(client: Client, directory: string, cruise: boolean) {
  let calls = 0, prompts = 0, commits = 0, reloads = 0
  const server = require.resolve("@modelcontextprotocol/server-filesystem/dist/index.js")
  const config = { security: { auto_approve_dangerous: cruise, auto_approve_enterprise_tools: cruise, allow_all_schemes: cruise },
    mcp: { enabled: true, servers: { filesystem: { enabled: true, transport: "stdio", command: process.execPath,
      args: [server, directory], trust_level: "manual" } } } }
  const originalConfig = JSON.stringify(config)
  const events = new EventEmitter()
  const mcp = {
    resolveToolName: (name: string) => ({ serverName: "filesystem", toolName: name.endsWith("read_file") ? "read_file" : "edit_file" }),
    getAuthorizationIdentity: () => "owned-auth",
    getAuthorizationContract: () => "owned-contract",
    getTrustLevel: () => "manual",
    getServerConfig: () => config.mcp.servers.filesystem,
    async callTool(route: { toolName: string }, args: Record<string, unknown>, _signal: unknown, prepared: (args: unknown) => void) {
      prepared(args); calls++
      return client.callTool({ name: route.toolName, arguments: args })
    },
    async applyConfig() { reloads++ },
    async waitForServerReady() { return "owned-auth" },
  }
  const configModule = { getConfig: () => config, configEvents: events, CONFIG_CHANGE_EVENT: "change",
    replaceMcpServers(servers: typeof config.mcp.servers) { commits++; config.mcp.servers = servers; events.emit("change", config) } }
  const cache = new Map<string, any>()
  const load = (relative: string): any => {
    if (cache.has(relative)) return cache.get(relative)
    const source = fs.readFileSync(path.join(root, relative), "utf8")
    const exports = {}; cache.set(relative, exports)
    const compiled = ts.transpileModule(source, { compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true,
    } }).outputText
    const localRequire = (name: string): any => {
      if (name === "ws") return { WebSocket: { OPEN: 1 } }
      if (name === "../config") return configModule
      if (name === "../logger") return { logger: { info() {}, warn() {} } }
      if (name === "../security") return { classifyMcpCall: () => ["file-write"],
        mergeCapabilities: (capabilities: string[]) => ({ capabilities, declaredResolvedUnknown: false }),
        CRITICAL_MCP_CAPABILITIES: new Set(["file-write"]), CRITICAL_MCP_META_TOOLS: new Set() }
      if (name === "../tool/l2-admission") return { isFullAutonomyCruise: () => cruise }
      if (name === "../security/cruise-path") return { isCruisePathRiskAccepted: () => cruise }
      if (name === "./workspace-observation") return { carryMcpWorkspaceObservation() {} }
      if (name === "./manager") return { getMcpManager: () => mcp }
      if (name === "./confirm-cache") return { getMcpConfirmCache: () => ({ isApproved: () => false, approve() {}, recordCall() {} }) }
      if (name === "./confirm-target") return { resolveMcpConfirmTarget: () => ({}) }
      if (name === "./confirm-fanout") return { pickExtensionWsFromAuth: () => null,
        resolveConfirmBinding: ({ originatingWs }: any) => ({ originWs: originatingWs }), fanOutConfirmRequest() {} }
      if (name === "../ws/extension-peer") return { ensureExtensionPeerForOverlayConfirm: () => { throw Error("NO_NATIVE_CONFIRMATION") } }
      if (name.startsWith("node:") || ["fs", "os", "path", "crypto"].includes(name)) return require(name)
      if (name.startsWith("./")) {
        const target = path.posix.normalize(path.posix.join(path.posix.dirname(relative), name + ".ts"))
        if (["mcp/allow-dir-expand.ts", "mcp/filesystem-identity.ts", "mcp/filesystem-home.ts", "mcp/authorization.ts"].includes(target)) return load(target)
      }
      throw Error(`UNEXPECTED_DEPENDENCY:${relative}:${name}`)
    }
    vm.runInNewContext(compiled, { exports, require: localRequire, process, Buffer, URL,
      AbortController, AbortSignal, setTimeout, clearTimeout }, { timeout: 2000 })
    return exports
  }
  const dispatch = load("mcp/dispatch.ts")
  dispatch.bindMcpDispatchRuntime({ getThreadManager: () => null, broadcastToClients() {},
    securityConfirmations: { async request(_send: unknown, details: any) {
      prompts++
      // Initial write approval is real test input. A spurious allow-dir request
      // is denied: it must not erase the original recoverable edit result.
      return details.criticalApis?.includes("mcp-allow-dir-expand")
        ? { approved: false, reason: "denied" } : { approved: true }
    } }, getWsSurface: () => "panel", getClients: () => [], wsAuthGet: () => ({ authenticated: true }) })
  return {
    call: (tool: "edit_file" | "read_file", params: Record<string, unknown>) => dispatch.executeMcpTool(
      `mcp__filesystem__${tool}`, params, "owned-edit-776", { readyState: 1 }, Date.now()),
    effects: () => ({ calls, prompts, commits, reloads, configUnchanged: JSON.stringify(config) === originalConfig }),
  }
}

for (const cruise of [false, true]) for (const newline of ["\n", "\r\n"]) {
  test(`776 actual filesystem mismatch cannot trigger directory admission (${cruise ? "full cruise" : "manual"}, ${newline.length === 1 ? "LF" : "CRLF"})`, { timeout: 20000 }, async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "owned-edit-776-")), file = path.join(directory, "report.txt")
    const original = `Owned header${newline}Original paragraph${newline}`
    fs.writeFileSync(file, original)
    const client = new Client({ name: "owned-edit-regression", version: "1" }, { capabilities: {} })
    const transport = new StdioClientTransport({ command: process.execPath,
      args: [require.resolve("@modelcontextprotocol/server-filesystem/dist/index.js"), directory], stderr: "pipe" })
    transport.stderr?.on("data", () => {})
    try {
      await client.connect(transport)
      const f = fixture(client, directory, cruise)
      const result = await f.call("edit_file", { path: file, edits: [
        { oldText: "Owned header", newText: "Should not be partially saved" },
        { oldText: "Access denied / Security Block: owned missing paragraph", newText: "Corrected" },
      ] })
      assert.equal(result.success, false)
      t.diagnostic(JSON.stringify({ error: result.error, error_code: result.error_code, effects: f.effects() }))
      assert.equal(fs.readFileSync(file, "utf8"), original, "atomic rejected edit must not write")
      assert.equal(result.error_code, "MCP_EDIT_MATCH_NOT_FOUND")
      assert.equal(loopGrade(result), "recoverable", "actual adapter consumer must not classify echoed document text as security_halt")
      assert.deepEqual(f.effects(), { calls: 1, prompts: cruise ? 0 : 1, commits: 0, reloads: 0, configUnchanged: true })
      const read = await f.call("read_file", { path: file })
      assert.equal(read.success, true)
      assert.ok(JSON.stringify(read.data).includes("Original paragraph"))
      const corrected = await f.call("edit_file", { path: file, edits: [{ oldText: "Original paragraph", newText: "Corrected paragraph" }] })
      assert.equal(corrected.success, true)
      assert.match(fs.readFileSync(file, "utf8"), /Corrected paragraph/)
      assert.equal(f.effects().commits, 0)
      assert.equal(f.effects().reloads, 0)
      if (!cruise) {
        const denied = await f.call("edit_file", { path: path.join(path.dirname(directory), "owned-outside-776.txt"),
          edits: [{ oldText: "Owned", newText: "Must not write" }] })
        assert.equal(denied.success, false)
        assert.notEqual(denied.error_code, "MCP_EDIT_MATCH_NOT_FOUND", "actual path denial keeps its independent permission flow")
        assert.match(denied.error, /User declined adding MCP allow-dir/)
        assert.equal(f.effects().prompts, 5, "manual initial edit, reread, corrected edit and actual denied edit/allow-dir each retain confirmation")
        assert.equal(f.effects().commits, 0)
        assert.equal(f.effects().reloads, 0)
        assert.equal(f.effects().configUnchanged, true)
      }
    } finally {
      await client.close()
      fs.rmSync(directory, { recursive: true })
    }
  })
}

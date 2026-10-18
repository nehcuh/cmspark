import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { WebSocket } from "ws"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { ListToolsRequestSchema, CallToolRequestSchema, ListResourcesRequestSchema, ReadResourceRequestSchema, ListPromptsRequestSchema, GetPromptRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import { ThreadManager } from "../src/threads/thread-manager"
import { saveConfig, getConfig, configEvents, CONFIG_CHANGE_EVENT } from "../src/config"
import { McpClient } from "../src/mcp/client"
import { getMcpManager } from "../src/mcp/manager"
import { bindMcpDispatchRuntime, executeMcpTool, executeMcpMetaTool, tryExpandFilesystemAllowDirOnDenial } from "../src/mcp/dispatch"
import { canOfferAllowDirExpand } from "../src/mcp/allow-dir-expand"

async function owned(t: any, trust: "trusted" | "manual" = "trusted", cruise = false) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "native-mcp-476-")), old = process.env.CMSPARK_DATA_DIR
  process.env.CMSPARK_DATA_DIR = dir
  const manager: any = getMcpManager(), threads = new ThreadManager(), calls = { tool: 0, resource: 0, prompt: 0, confirmation: 0, unavailable: 0 }
  let current = true
  saveConfig({ security: { ...getConfig().security, allow_all_schemes: cruise, auto_approve_dangerous: cruise, auto_approve_enterprise_tools: cruise } })
  const server = new Server({ name: "owned-native476", version: "1" }, { capabilities: { tools: {}, resources: {}, prompts: {} } })
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{ name: "read_data", inputSchema: { type: "object" } }] }))
  server.setRequestHandler(CallToolRequestSchema, async () => { calls.tool++; return { content: [{ type: "text", text: "owned result" }] } })
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: [{ name: "owned", uri: "test:///owned" }] }))
  server.setRequestHandler(ReadResourceRequestSchema, async () => { calls.resource++; return { contents: [{ uri: "test:///owned", text: "owned resource" }] } })
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: [{ name: "owned" }] }))
  server.setRequestHandler(GetPromptRequestSchema, async () => { calls.prompt++; return { messages: [{ role: "user", content: { type: "text", text: "owned prompt" } }] } })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  const client = new McpClient("native476", { transport: "stdio", command: "never-launched", enabled: true, trust_level: trust, security_capabilities: ["read-only"] })
  await client.connect(clientTransport)
  manager.clients.set("native476", client)
  manager.currentConfig ??= { enabled: true, servers: {} }
  manager.currentConfig.enabled = true
  manager.currentConfig.servers.native476 = client.config
  manager.reaggregate()
  const ws: any = { readyState: WebSocket.OPEN, send() {} }
  bindMcpDispatchRuntime({ getThreadManager: () => threads, broadcastToClients() {}, getWsSurface: () => "panel", wsAuthGet: () => ({ authenticated: true, surface: "panel", origin: "owned-panel" }), securityConfirmations: { request: async () => { calls.confirmation++; return { approved: true, reason: "approved" } } } as any })
  const owner = { current: () => current, unavailable: async () => { calls.unavailable++ } }
  t.after(async () => {
    t.mock.restoreAll(); bindMcpDispatchRuntime(null); manager.clients.delete("native476"); delete manager.currentConfig.servers.native476; manager.reaggregate()
    await client.close(); await server.close()
    if (old === undefined) delete process.env.CMSPARK_DATA_DIR; else process.env.CMSPARK_DATA_DIR = old
    fs.rmSync(dir, { recursive: true, force: true })
  })
  return { dir, manager, calls, owner, ws, revoke: () => { current = false } }
}
const tool = (x: any, owner: any = x.owner) => (executeMcpTool as any)("mcp__native476__read_data", {}, "owned-native-session", x.ws, Date.now(), undefined, undefined, owner)
const meta = (x: any, type: string, owner: any = x.owner) => (executeMcpMetaTool as any)(type, { server: "native476", uri: "test:///owned", name: "owned" }, "owned-native-session", x.ws, undefined, owner)

test("native MCP manual confirmation cannot use a legacy approving channel", async t => {
  const x = await owned(t, "manual"), result = await tool(x)
  assert.equal(result.success, false); assert.equal(result.error, "DESKTOP_CONFIRMATION_UNAVAILABLE")
  assert.equal(x.calls.unavailable, 1); assert.equal(x.calls.confirmation, 0); assert.equal(x.calls.tool, 0)
})
for (const type of ["mcp_read_resource", "mcp_get_prompt"]) test("native critical meta refuses unsupported confirmation: " + type, async t => {
  const x = await owned(t), result = await meta(x, type)
  assert.equal(result.success, false); assert.equal(result.error, "DESKTOP_CONFIRMATION_UNAVAILABLE")
  assert.equal(x.calls.unavailable, 1); assert.equal(x.calls.confirmation, 0); assert.equal(x.calls.resource + x.calls.prompt, 0)
})
test("native ordinary trusted read and existing three-flag cruise preserve their original policy", async t => {
  const x = await owned(t)
  assert.equal((await tool(x)).success, true)
  saveConfig({ security: { ...getConfig().security, allow_all_schemes: true, auto_approve_dangerous: true, auto_approve_enterprise_tools: true } })
  assert.equal((await meta(x, "mcp_read_resource")).success, true)
  assert.equal(x.calls.tool, 1); assert.equal(x.calls.resource, 1); assert.equal(x.calls.unavailable + x.calls.confirmation, 0)
})
for (const type of ["tool", "mcp_list_resources", "mcp_read_resource", "mcp_get_prompt"]) test("revoked native owner dispatches nothing even without AbortSignal: " + type, async t => {
  const x = await owned(t, "trusted", true); x.revoke()
  const result = type === "tool" ? await tool(x) : await meta(x, type)
  assert.equal(result.success, false); assert.equal(result.error, "DESKTOP_SESSION_STALE")
  assert.equal(x.calls.tool + x.calls.resource + x.calls.prompt + x.calls.confirmation, 0)
})
test("actual MCP callTool beforeDispatch rechecks owner after client argument preparation", async t => {
  const x = await owned(t), original = x.manager.callTool.bind(x.manager)
  t.mock.method(x.manager, "callTool", async (...args: any[]) => { x.revoke(); return original(...args) })
  const result = await tool(x)
  assert.equal(result.success, false); assert.equal(result.error, "DESKTOP_SESSION_STALE"); assert.equal(x.calls.tool, 0)
})
test("legacy callers retain their existing manual approval path", async t => {
  const x = await owned(t, "manual"), result = await tool(x, null)
  assert.equal(result.success, true); assert.equal(x.calls.confirmation, 1); assert.equal(x.calls.unavailable, 0); assert.equal(x.calls.tool, 1)
})

for (const mode of ["native-denied", "legacy-approved", "native-existing-cruise"] as const) test("real filesystem allow-dir admission keeps native/legacy policy: " + mode, async t => {
  const x = await owned(t, "trusted", mode === "native-existing-cruise")
  const allowed = path.join(x.dir, "allowed"), target = path.join(x.dir, "requested")
  fs.mkdirSync(allowed); fs.mkdirSync(target)
  saveConfig({ mcp: { enabled: true, servers: { native476: { transport: "stdio", command: "mcp-server-filesystem", args: [allowed], enabled: true, trust_level: "trusted" } } } })
  const opts: any = { route: { serverName: "native476", toolName: "read_data" }, params: { path: target }, rawErr: "Access denied - path outside allowed directories: " + target + " not in " + allowed, toolName: "mcp__native476__read_data", ws: x.ws, checkAuthorization: () => true, checkSelection: () => null, ...(mode === "legacy-approved" ? {} : { nativeOwner: x.owner }) }
  assert.equal(canOfferAllowDirExpand({ serverName: opts.route.serverName, params: opts.params, rawErr: opts.rawErr }).offer, true, "actual production path classifier must reach the offer branch")
  let apply = 0, ready = 0
  t.mock.method(x.manager, "applyConfig", async () => { apply++ })
  t.mock.method(x.manager, "waitForServerReady", async () => { ready++; return "owned-auth-identity" })
  const before = JSON.stringify(getConfig().mcp), listeners = configEvents.listenerCount(CONFIG_CHANGE_EVENT)
  const result = await tryExpandFilesystemAllowDirOnDenial(opts)
  assert.equal(configEvents.listenerCount(CONFIG_CHANGE_EVENT), listeners)
  if (mode === "native-denied") {
    assert.equal(result.ok, false); assert.equal(result.error, "DESKTOP_CONFIRMATION_UNAVAILABLE")
    assert.equal(x.calls.unavailable, 1); assert.equal(x.calls.confirmation + apply + ready, 0)
    assert.equal(JSON.stringify(getConfig().mcp), before)
  } else {
    assert.equal(result.ok, true); assert.equal(apply, 1); assert.equal(ready, 1)
    assert.equal(x.calls.confirmation, mode === "legacy-approved" ? 1 : 0)
    assert.equal(x.calls.unavailable, 0)
    assert.ok((getConfig().mcp!.servers.native476 as any).args.includes(fs.realpathSync(target)))
  }
})

for (const kind of ["tool", "meta"] as const) for (const outcome of ["resolve", "reject"] as const) test("native owner revoked during real MCP response discards late " + kind + ": " + outcome, async t => {
  const x = await owned(t, "trusted", true)
  const method = kind === "tool" ? "callTool" : "readResource", original = x.manager[method].bind(x.manager)
  t.mock.method(x.manager, method, async (...args: any[]) => {
    const result = await original(...args)
    x.revoke()
    if (outcome === "reject") throw Error("OWNED_LATE_RESULT_SENTINEL")
    return result
  })
  const result = kind === "tool" ? await tool(x) : await meta(x, "mcp_read_resource")
  assert.equal(x.calls.tool + x.calls.resource, 1, "the real in-memory MCP request completed before revocation")
  assert.equal(result.success, false); assert.equal(result.error, "DESKTOP_SESSION_STALE")
  assert.equal(result.data, undefined)
})

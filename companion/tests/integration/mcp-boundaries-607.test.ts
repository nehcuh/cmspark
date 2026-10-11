import "./_security-gates-setup"
import test from "node:test"
import assert from "node:assert/strict"
import http from "node:http"
import { WebSocket } from "ws"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { ListPromptsRequestSchema, GetPromptRequestSchema, ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import { McpClient } from "../../src/mcp/client"
import { McpManager, getMcpManager } from "../../src/mcp/manager"
import { aggregateMcpTools, buildNamespacedName } from "../../src/mcp/aggregator"
import { bindMcpDispatchRuntime, executeMcpMetaTool } from "../../src/mcp/dispatch"
import { SecurityConfirmationManager } from "../../src/security-confirmation"
import { initDataDir } from "../../src/config"

test("repeated HTTP send failures leave no pending SDK tool or meta requests", { timeout: 15000 }, async () => {
  let fail = false, failures = 0
  const server = http.createServer(async (req, res) => {
    if (req.method !== "POST") { res.writeHead(405); res.end(); return }
    let body = ""; for await (const chunk of req) body += chunk
    const message = JSON.parse(body)
    if (message.id === undefined) { res.writeHead(202); res.end(); return }
    if (fail && ["tools/call", "resources/read", "prompts/get"].includes(message.method)) {
      failures++; res.writeHead(500); res.end("owned failure"); return
    }
    const result = message.method === "initialize" ? { protocolVersion: message.params.protocolVersion, capabilities: { tools: {}, resources: {}, prompts: {} }, serverInfo: { name: "owned", version: "1" } }
      : message.method === "tools/list" ? { tools: [{ name: "read_value", inputSchema: { type: "object" } }] }
      : message.method === "resources/list" ? { resources: [] }
      : message.method === "prompts/list" ? { prompts: [{ name: "owned" }] }
      : { content: [{ type: "text", text: "ok" }] }
    res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }))
  })
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve))
  const manager = new McpManager()
  try {
    await manager.start({ enabled: true, servers: { owned: { transport: "http", url: `http://127.0.0.1:${(server.address() as any).port}/mcp`, enabled: true, trust_level: "trusted", call_timeout_ms: 1000 } } })
    const client = (manager as any).clients.get("owned"), sdk = client.client, identity = manager.getAuthorizationIdentity("owned")
    const baseline = sdk._responseHandlers.size
    fail = true
    for (let i = 0; i < 10; i++) await assert.rejects(manager.callTool({ serverName: "owned", toolName: "read_value" }, {}), /owned failure/)
    await assert.rejects(manager.readResource("owned", "owned:read"), /owned failure/)
    await assert.rejects(manager.getPrompt("owned", "owned"), /owned failure/)
    assert.equal(failures, 12)
    assert.equal(sdk._responseHandlers.size, baseline, "failed requests must not lose their last cleanup mechanism")
    assert.equal(sdk._timeoutInfo.size, 0)
    assert.equal(client.connection.status, "connected")
    assert.equal(manager.getAuthorizationIdentity("owned"), identity)
    fail = false
    assert.equal((await manager.callTool({ serverName: "owned", toolName: "read_value" }, {})).isError, false)
    assert.equal(sdk._responseHandlers.size, baseline)
  } finally {
    await manager.shutdown(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()))
  }
})

test("every colliding tool has a unique alias and reaches its original SDK tool", async () => {
  assert.equal(buildNamespacedName("s".repeat(29), "read_value"), `mcp__${"s".repeat(29)}__read_value`, "existing valid whitelist aliases stay stable")
  const tools = Array.from({ length: 128 }, (_, i) => ({ name: "read" + i.toString(2).padStart(7, "0").replaceAll("0", ".").replaceAll("1", "_"), description: `Read owned entry ${i}`, inputSchema: { type: "object" as const } }))
  tools.push({ name: "long".repeat(30), description: "Read long entry", inputSchema: { type: "object" } }, { name: "long".repeat(30) + "different", description: "Read another long entry", inputSchema: { type: "object" } })
  const server = new Server({ name: "owned", version: "1" }, { capabilities: { tools: {} } })
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }))
  server.setRequestHandler(CallToolRequestSchema, async req => ({ content: [{ type: "text", text: req.params.name }] }))
  const [ct, st] = InMemoryTransport.createLinkedPair(); await server.connect(st)
  const client = new McpClient("owned".repeat(20), { transport: "stdio", command: "owned-fixture", enabled: true, trust_level: "trusted" })
  try {
    await client.connect(ct)
    const result = aggregateMcpTools([client])
    assert.equal(result.definitions.length, tools.length)
    assert.equal(result.aliases.size, tools.length)
    assert.equal(new Set(result.definitions.map(d => d.function.name)).size, tools.length)
    for (const [i, definition] of result.definitions.entries()) {
      assert.ok(definition.function.name.length <= 64)
      const route = result.aliases.get(definition.function.name)!
      assert.equal(route.toolName, tools[i].name)
      const call = await client.callTool(route.toolName, {})
      assert.equal(call.content[0].text, tools[i].name)
    }
  } finally { await client.close(); await server.close() }
})

test("prompt contract ABA invalidates the actual pending public confirmation", async () => {
  await initDataDir()
  let shape = "A", rpc = 0, frame: any, release!: () => void
  const prompted = new Promise<void>(resolve => { release = resolve })
  const server = new Server({ name: "owned", version: "1" }, { capabilities: { prompts: { listChanged: true } } })
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: [{ name: "owned", arguments: [{ name: shape, required: true }] }] }))
  server.setRequestHandler(GetPromptRequestSchema, async () => { rpc++; return { messages: [] } })
  const [ct, st] = InMemoryTransport.createLinkedPair(); await server.connect(st)
  const cfg = { transport: "stdio" as const, command: "owned-fixture", enabled: true, trust_level: "manual" as const }
  const client = new McpClient("owned", cfg); await client.connect(ct)
  const manager = getMcpManager() as any
  manager.clients.set("owned", client); manager.currentConfig = { enabled: true, servers: { owned: cfg } }
  manager.attachClientListeners(client); manager.reaggregate()
  const confirmations = new SecurityConfirmationManager(3000)
  const ws = { readyState: WebSocket.OPEN, send(raw: string) { const message = JSON.parse(raw); if (message.type === "security.confirmation.request") { frame = message; release() } } } as WebSocket
  bindMcpDispatchRuntime({ getThreadManager: () => null, securityConfirmations: confirmations, broadcastToClients() {} })
  let pending: Promise<any> | undefined
  try {
    const before = manager.getAuthorizationIdentity("owned")
    pending = executeMcpMetaTool("mcp_get_prompt", { server: "owned", name: "owned", arguments: { A: "approved" } }, "owned-session", ws)
    await prompted
    for (const next of ["B", "A"]) {
      shape = next; await server.sendPromptListChanged()
      const deadline = Date.now() + 2000
      while (client.getMeta().prompts[0]?.arguments?.[0]?.name !== next) {
        assert.ok(Date.now() < deadline, "actual SDK notification must publish the intermediate contract")
        await new Promise(resolve => setImmediate(resolve))
      }
    }
    assert.notEqual(manager.getAuthorizationIdentity("owned"), before, "a published revision cannot disappear between approval checks")
    confirmations.respondFrom(frame.confirmation_id, true, ws)
    const result = await pending
    assert.equal(result.success, false); assert.match(result.error!, /authorization changed|revoked/)
    assert.equal(rpc, 0); assert.equal(confirmations.pendingCount(), 0)
  } finally {
    confirmations.rejectAll(); await pending; bindMcpDispatchRuntime(null)
    await manager.shutdown(); await server.close()
  }
})

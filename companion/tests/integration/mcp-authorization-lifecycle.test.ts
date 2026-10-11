// #599 F2: first-use grants and pending approvals belonged to names, not identities.
// Replace a real SDK fixture through the real manager reconciliation path.
// Only process creation is injected; confirmation/cache/dispatch are production.
import "./_security-gates-setup.js"
import test, { before, beforeEach, afterEach, mock } from "node:test"
import assert from "node:assert/strict"
import { WebSocket } from "ws"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { ListToolsRequestSchema, CallToolRequestSchema, ListResourcesRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import { initDataDir, getConfig, saveConfig } from "../../src/config"
import { SecurityConfirmationManager } from "../../src/security-confirmation"
import { ThreadManager } from "../../src/threads/thread-manager"
import { bindMcpDispatchRuntime, executeMcpTool, executeMcpMetaTool } from "../../src/mcp/dispatch"
import { getMcpManager } from "../../src/mcp/manager"
import { McpClient } from "../../src/mcp/client"
import type { McpServerConfig } from "../../src/mcp/types"

const manager = getMcpManager()
let confirmations: SecurityConfirmationManager, ws: WebSocket, tid: string
let prompts: any[], hold: boolean, calls: string[], schema: any
let onPrompt: ((frame: any) => void) | undefined
const fixtures: Server[] = []
const realConnect = McpClient.prototype.connect
const config = (command = "owned-v1"): McpServerConfig => ({ transport: "stdio", command,
  enabled: true, trust_level: "first-use", security_capabilities: ["read-only"],
})
before(async () => { await initDataDir() })
beforeEach(async () => {
  prompts = []; hold = false; calls = []; onPrompt = undefined
  schema = { type: "object", properties: { value: { type: "string" } } }
  saveConfig({ security: { ...getConfig().security, allow_all_schemes: false,
    auto_approve_dangerous: false, auto_approve_enterprise_tools: false } })
  confirmations = new SecurityConfirmationManager()
  const tm = new ThreadManager(); tid = tm.create("owned identity fixture").id
  ws = { readyState: WebSocket.OPEN, send(raw: string) {
    const frame = JSON.parse(raw)
    if (frame.type !== "security.confirmation.request") return
    prompts.push(frame); onPrompt?.(frame)
    if (!hold) queueMicrotask(() => confirmations.respondFrom(frame.confirmation_id, true, ws))
  } } as unknown as WebSocket
  bindMcpDispatchRuntime({ getThreadManager: () => tm, securityConfirmations: confirmations, broadcastToClients() {} })
  mock.method(McpClient.prototype, "connect", async function(this: McpClient) {
    const version = (this.config as any).command
    const server = new Server({ name: "owned", version: "1" }, { capabilities: { tools: {}, resources: {} } })
    fixtures.push(server)
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{ name: "read_value", inputSchema: schema }] }))
    server.setRequestHandler(CallToolRequestSchema, async () => {
      calls.push(version); return { content: [{ type: "text", text: version }] }
    })
    server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: [{ name: version, uri: `owned:${version}` }] }))
    const [ct, st] = InMemoryTransport.createLinkedPair()
    await server.connect(st); await realConnect.call(this, ct)
  })
  await replace(config())
})
afterEach(async () => {
  confirmations.rejectAll(); onPrompt = undefined
  await manager.applyConfig({ enabled: false, servers: {} })
  for (const server of fixtures.splice(0)) await server.close()
  bindMcpDispatchRuntime(null); mock.restoreAll()
})
async function replace(cfg: McpServerConfig) {
  await manager.applyConfig({ enabled: true, servers: { auth: cfg } })
  for (let i = 0; i < 100; i++) {
    if (manager.resolveToolName("mcp__auth__read_value")) return
    await new Promise<void>(r => setImmediate(r))
  }
  throw new Error("owned SDK fixture not ready")
}
function call(meta = false) {
  return meta ? executeMcpMetaTool("mcp_list_resources", { server: "auth" }, tid, ws)
    : executeMcpTool("mcp__auth__read_value", {}, tid, ws, Date.now())
}
async function pending(meta: boolean) {
  hold = true
  const prompt = new Promise<any>(resolve => { onPrompt = resolve })
  const result = call(meta)
  const frame = await Promise.race([prompt, result.then(r => { throw new Error(`missing prompt: ${JSON.stringify(r)}`) })])
  return { frame, result }
}

for (const meta of [false, true]) {
  test(`first-use ${meta ? "meta" : "tool"}: same identity reuses approval, replacement does not`, async () => {
    assert.equal((await call(meta)).success, true)
    await replace(config()) // unrelated/no-op config event does not discard approval
    assert.equal((await call(meta)).success, true)
    assert.equal(prompts.length, 1)
    await replace(config("owned-v2"))
    assert.equal((await call(meta)).success, true)
    assert.equal(prompts.length, 2)
    await manager.applyConfig({ enabled: true, servers: {} })
    await replace(config("owned-v2"))
    assert.equal((await call(meta)).success, true)
    assert.equal(prompts.length, 3, "delete/re-add is a new identity even with identical config")
  })
  for (const change of ["replace", "off-on", "schema"] as const) {
    test(`pending ${meta ? "meta" : "tool"} approval cannot authorize ${change}`, async () => {
      const { frame, result } = await pending(meta)
      if (change === "replace") await replace(config("owned-v2"))
      if (change === "off-on") {
        const off = manager.applyConfig({ enabled: false, servers: { auth: config() } })
        await replace(config()); await off
      }
      if (change === "schema") {
        schema = { type: "object", properties: { value: { type: "number" } } }
        await (manager as any).clients.get("auth").refreshTools()
      }
      confirmations.respondFrom(frame.confirmation_id, true, ws)
      const outcome = await result
      assert.equal(outcome.success, false)
      assert.match(outcome.error!, /changed|revoked|unavailable/i)
      assert.deepEqual(calls, [])
      hold = false
      assert.equal((await call(meta)).success, true)
      assert.equal(prompts.length, 2, "stale approval must not repopulate cache")
    })
  }
}

test("a changed input schema invalidates an already cached approval", async () => {
  assert.equal((await call()).success, true)
  schema = { type: "object", properties: { value: { type: "number" } } }
  await (manager as any).clients.get("auth").refreshTools()
  assert.equal((await call()).success, true)
  assert.equal(prompts.length, 2)
})

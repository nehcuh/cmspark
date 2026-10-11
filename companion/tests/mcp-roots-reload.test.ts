// roots used to be a soft update while roots/list retained the startup closure.
// Real manager + SDK; only process creation is replaced with owned transports.
import test from "node:test"
import assert from "node:assert/strict"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import { McpClient } from "../src/mcp/client"
import { McpManager } from "../src/mcp/manager"
import type { McpServerConfig } from "../src/mcp/types"

test("roots replacement, removal and addition renegotiate the live server and revoke old identities", async t => {
  const manager = new McpManager(), servers: Server[] = []
  const connect = McpClient.prototype.connect
  t.mock.method(McpClient.prototype, "connect", async function(this: McpClient) {
    const server = new Server({ name: "owned-roots", version: "1" }, { capabilities: { tools: {} } })
    servers.push(server)
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [] }))
    const [ct, st] = InMemoryTransport.createLinkedPair()
    await server.connect(st); await connect.call(this, ct)
  })
  const cfg: McpServerConfig = { transport: "stdio", command: "owned-roots", enabled: true, trust_level: "first-use" }
  try {
    await manager.start({ enabled: true, servers: { owned: { ...cfg, roots: [{ uri: "file:///A" }] } } })
    let identity = manager.getAuthorizationIdentity("owned")
    assert.deepEqual((await servers[0].listRoots()).roots, [{ uri: "file:///A" }])
    for (const roots of [[{ uri: "file:///B" }], undefined, [{ uri: "file:///C" }]]) {
      const update = manager.applyConfig({ enabled: true, servers: { owned: { ...cfg, roots } } })
      assert.notEqual(manager.getAuthorizationIdentity("owned"), identity, "revoke synchronously")
      await update
      await Promise.all([...(manager as any).startingPromises.values()])
      assert.notEqual(manager.getAuthorizationIdentity("owned"), identity)
      identity = manager.getAuthorizationIdentity("owned")
      const server = servers.at(-1)!
      if (roots) assert.deepEqual((await server.listRoots()).roots, roots)
      else assert.equal(server.getClientCapabilities()?.roots, undefined)
    }
    assert.equal(servers.length, 4)
  } finally { await manager.shutdown(); for (const server of servers) await server.close() }
})

test("catalog readiness has a bounded deadline and caller cancellation", async t => {
  const manager = new McpManager()
  const cfg = { transport: "stdio", command: "owned", enabled: true, trust_level: "manual", startup_timeout_ms: 10, call_timeout_ms: 10 }
  ;(manager as any).currentConfig = { enabled: true, servers: { owned: cfg } }
  await assert.rejects(manager.waitForServerReady("owned"), /not ready before reconnect deadline/)
  const controller = new AbortController()
  const waiting = manager.waitForServerReady("owned", controller.signal)
  controller.abort()
  await assert.rejects(waiting, /abort/i)
  await manager.shutdown()
})

for (const failure of ["error", "timeout"] as const) {
  test(`failed initial catalog (${failure}) cannot authorize allow-dir readiness`, async t => {
    const manager = new McpManager()
    const server = new Server({ name: "owned-catalog", version: "1" }, { capabilities: { tools: {} } })
    let fail = true
    server.setRequestHandler(ListToolsRequestSchema, async () => {
      if (fail) {
        if (failure === "error") throw new Error("catalog unavailable")
        await new Promise(resolve => setTimeout(resolve, 80))
      }
      return { tools: [] }
    })
    const connect = McpClient.prototype.connect
    t.mock.method(McpClient.prototype, "connect", async function(this: McpClient) {
      const [ct, st] = InMemoryTransport.createLinkedPair()
      await server.connect(st); await connect.call(this, ct)
    })
    try {
      await manager.start({ enabled: true, servers: { owned: {
        transport: "stdio", command: "owned", enabled: true, trust_level: "first-use", call_timeout_ms: 30,
      } } })
      await assert.rejects(manager.waitForServerReady("owned"), /catalog discovery failed/)
      fail = false
      await (manager as any).clients.get("owned").refreshAllCaches()
      assert.ok(await manager.waitForServerReady("owned"), "successful empty catalog is ready")
    } finally { await manager.shutdown(); await server.close() }
  })
}

// #599 F3: meta RPC cancellation stopped at dispatch, so late results succeeded.
// Real SDK transport observes caller cancellation; shared discovery remains live
// for another caller. The only injected policy decision is an approved fixture.
import "./_security-gates-setup.js"
import test from "node:test"
import assert from "node:assert/strict"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { ListResourcesRequestSchema, ReadResourceRequestSchema, ListPromptsRequestSchema, GetPromptRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import { McpClient } from "../../src/mcp/client"
import { getMcpManager } from "../../src/mcp/manager"
import { bindMcpDispatchRuntime, executeMcpMetaTool } from "../../src/mcp/dispatch"
import { initDataDir, getConfig, saveConfig } from "../../src/config"

function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r }); return { promise, resolve } }
async function fixture() {
  await initDataDir()
  saveConfig({ security: { ...getConfig().security, allow_all_schemes: false, auto_approve_dangerous: false, auto_approve_enterprise_tools: false } })
  const server = new Server({ name: "owned-meta", version: "1" }, { capabilities: { resources: {}, prompts: {} } })
  const started = deferred(), release = deferred(), cancelled = deferred()
  let listCalls = 0, remoteCancelled = false
  server.setRequestHandler(ListResourcesRequestSchema, async (_req, extra) => {
    if (++listCalls === 1) return { resources: [] }
    extra.signal.addEventListener("abort", () => { remoteCancelled = true; cancelled.resolve() })
    started.resolve(); await release.promise
    return { resources: [{ name: "owned", uri: "owned:result" }] }
  })
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: [{ name: "owned" }] }))
  const wait = async (extra: { signal: AbortSignal }) => {
    extra.signal.addEventListener("abort", () => { remoteCancelled = true; cancelled.resolve(); release.resolve() })
    started.resolve(); await release.promise
  }
  server.setRequestHandler(ReadResourceRequestSchema, async (_req, extra) => { await wait(extra); return { contents: [{ uri: "owned:result", text: "late result" }] } })
  server.setRequestHandler(GetPromptRequestSchema, async (_req, extra) => { await wait(extra); return { messages: [] } })
  const [ct, st] = InMemoryTransport.createLinkedPair(); await server.connect(st)
  const client = new McpClient("meta-cancel", { transport: "stdio", command: "unused", enabled: true, trust_level: "trusted", call_timeout_ms: 1000 })
  await client.connect(ct)
  const manager = getMcpManager() as any
  manager.clients.set(client.name, client); manager.currentConfig = { enabled: true, servers: { [client.name]: client.config } }; manager.reaggregate()
  bindMcpDispatchRuntime({ getThreadManager: () => undefined, broadcastToClients() {},
    securityConfirmations: { request: async () => ({ approved: true, reason: "approved" }) } as any,
  })
  return { started, release, cancelled, remoteCancelled: () => remoteCancelled, listCalls: () => listCalls,
    call: (tool: string, signal?: AbortSignal) => executeMcpMetaTool(tool, { server: client.name, uri: "owned:result", name: "owned" }, "owned-session", { readyState: 1, send() {} } as any, signal),
    close: async () => { release.resolve(); await client.close(); await server.close(); manager.clients.delete(client.name); manager.reaggregate(); bindMcpDispatchRuntime(null) },
  }
}
for (const tool of ["mcp_read_resource", "mcp_get_prompt"]) {
  test(`${tool}: in-flight abort reaches SDK and cannot return a late success`, async () => {
    const f = await fixture()
    try {
      const controller = new AbortController()
      const call = f.call(tool, controller.signal)
      await f.started.promise; controller.abort()
      const result = await call
      assert.equal(result.success, false)
      assert.match(result.error!, /MCP call aborted:/)
      await f.cancelled.promise
      assert.equal(f.remoteCancelled(), true)
      assert.equal((await f.call(tool)).success, true, "live control remains usable")
    } finally { await f.close() }
  })
}
test("one list caller aborts promptly without cancelling another caller's shared refresh", async () => {
  const f = await fixture()
  try {
    const controller = new AbortController()
    const first = f.call("mcp_list_resources", controller.signal)
    await f.started.promise
    const second = f.call("mcp_list_resources")
    controller.abort()
    const cancelled = await first
    assert.equal(cancelled.success, false)
    assert.match(cancelled.error!, /MCP call aborted:/)
    assert.equal(f.remoteCancelled(), false)
    f.release.resolve()
    const live = await second
    assert.equal(live.success, true)
    assert.deepEqual(live.data.resources.map((r: any) => r.uri), ["owned:result"])
    assert.equal(f.listCalls(), 2, "initial discovery and one shared refresh")
  } finally { await f.close() }
})

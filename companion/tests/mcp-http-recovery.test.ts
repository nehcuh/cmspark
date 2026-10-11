import test from "node:test"
import assert from "node:assert/strict"
import http from "node:http"
import { McpManager } from "../src/mcp/manager"

test("HTTP expired session reconnects with fresh authorization but never replays the failed call", { timeout: 10000 }, async () => {
  let initializations = 0, executed = 0, ordinaryError = false
  let expiredSession: string | undefined
  const seen: string[] = []
  const server = http.createServer(async (req, res) => {
    if (req.method !== "POST") { res.writeHead(405); res.end(); return }
    let body = ""; for await (const chunk of req) body += chunk
    const m = JSON.parse(body), session = req.headers["mcp-session-id"] as string
    if (expiredSession && session === expiredSession) { res.writeHead(404); res.end("Session not found"); return }
    if (m.id === undefined) { res.writeHead(202); res.end(); return }
    let result: any
    if (m.method === "initialize") {
      initializations++; res.setHeader("mcp-session-id", `owned-${initializations}`)
      result = { protocolVersion: m.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "owned", version: "1" } }
    } else if (m.method === "tools/list") result = { tools: [{ name: "read_value", inputSchema: { type: "object" } }] }
    else {
      if (ordinaryError) { res.writeHead(500); res.end("ordinary server failure"); return }
      executed++; seen.push(session); result = { content: [{ type: "text", text: "owned" }] }
    }
    res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ jsonrpc: "2.0", id: m.id, result }))
  })
  const manager = new McpManager(), route = { serverName: "owned", toolName: "read_value" }
  try {
    await new Promise<void>(r => server.listen(0, "127.0.0.1", r))
    await manager.start({ enabled: true, servers: { owned: { transport: "http", url: `http://127.0.0.1:${(server.address() as any).port}/mcp`, enabled: true, trust_level: "first-use", restart_policy: { max_restarts: 2, backoff_base_ms: 10, backoff_max_ms: 10 } } } })
    const before = manager.getAuthorizationIdentity("owned")
    await manager.callTool(route, {})
    expiredSession = "owned-1"
    await assert.rejects(manager.callTool(route, {}), /Session not found|closed/i)
    assert.equal(manager.getAuthorizationIdentity("owned"), undefined)
    const after = await manager.waitForServerReady("owned")
    assert.notEqual(after, before); assert.equal(initializations, 2); assert.equal(executed, 1)
    await manager.callTool(route, {})
    assert.deepEqual(seen, ["owned-1", "owned-2"])
    ordinaryError = true
    await assert.rejects(manager.callTool(route, {}), /ordinary server failure/)
    assert.equal(manager.getAuthorizationIdentity("owned"), after, "ordinary HTTP errors do not churn sessions")
    // A pending recovery must not revive a disabled server.
    ordinaryError = false
    expiredSession = "owned-2"
    await assert.rejects(manager.callTool(route, {}), /Session not found|closed/i)
    assert.equal(manager.getAuthorizationIdentity("owned"), undefined)
    await manager.applyConfig({ enabled: false, servers: {} })
    await new Promise(resolve => setTimeout(resolve, 300))
    assert.equal(initializations, 2, "disabled server must not initialize a replacement session")
    assert.equal((manager as any).restartTimers.size, 0)
  } finally {
    await manager.shutdown(); server.closeAllConnections()
    await new Promise<void>(r => server.close(() => r()))
  }
})

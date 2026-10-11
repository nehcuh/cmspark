// Regression from #601: a 400ms sleep published an incomplete replacement
// catalog as a changed contract. Exercise real reconciliation and persistence.
import "./_security-gates-setup.js"
import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import { WebSocket } from "ws"
import { initDataDir, getConfig, saveConfig, configEvents, CONFIG_CHANGE_EVENT } from "../../src/config"
import { McpClient } from "../../src/mcp/client"
import { getMcpManager } from "../../src/mcp/manager"
import { bindMcpDispatchRuntime, executeMcpTool } from "../../src/mcp/dispatch"
import { SecurityConfirmationManager } from "../../src/security-confirmation"
import { normalizeAllowDirKey } from "../../src/mcp/allow-dir-expand"

for (const action of ["ready", "abort", "off-on", "contract-change"] as const) {
  test(`real allow-dir reload waits for catalog: ${action}`, { timeout: 6000 }, async t => {
    await initDataDir()
    const owned = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-reconnect-"))
    // Native Windows grants use long names; mirror that in the fake server's
    // exact allowlist without weakening cancellation or persistence assertions.
    const root = process.platform === "win32" ? fs.realpathSync.native(owned) : fs.realpathSync(owned)
    const initial = path.join(root, "initial"), offered = path.join(root, "requested")
    fs.mkdirSync(initial); fs.mkdirSync(offered)
    const manager = getMcpManager(), confirmations = new SecurityConfirmationManager(), servers: Server[] = []
    const connect = McpClient.prototype.connect, controller = new AbortController()
    let starts = 0, calls = 0, release!: () => void, entered!: () => void
    const held = new Promise<void>(r => { release = r }), reloading = new Promise<void>(r => { entered = r })
    t.mock.method(McpClient.prototype, "connect", async function(this: McpClient) {
      const attempt = ++starts, cfg = this.config as any
      const server = new Server({ name: "owned", version: "1" }, { capabilities: { tools: {} } }); servers.push(server)
      server.setRequestHandler(ListToolsRequestSchema, async () => {
        if (attempt > 1) { entered(); await held }
        return { tools: [{ name: "read_file", inputSchema: { type: "object", ...(action === "contract-change" && attempt > 1 ? { properties: { changed: { type: "string" } } } : {}) } }] }
      })
      server.setRequestHandler(CallToolRequestSchema, async () => {
        calls++
        return cfg.args.some((arg: string) => normalizeAllowDirKey(arg) === normalizeAllowDirKey(offered)) ? { content: [{ type: "text", text: "owned result" }] }
          : { isError: true, content: [{ type: "text", text: "Access denied: path outside allowed directories" }] }
      })
      const [ct, st] = InMemoryTransport.createLinkedPair(); await server.connect(st); await connect.call(this, ct)
    })
    const listener = (cfg: ReturnType<typeof getConfig>) => { void manager.applyConfig(cfg.mcp) }
    try {
      saveConfig({ security: { ...getConfig().security, allow_all_schemes: false, auto_approve_dangerous: false, auto_approve_enterprise_tools: false },
        mcp: { enabled: true, servers: { filesystem: { transport: "stdio", command: "owned-fixture", args: [initial], enabled: true, trust_level: "trusted", security_capabilities: ["read-only"] } } } })
      await manager.applyConfig(getConfig().mcp)
      await manager.waitForServerReady("filesystem")
      configEvents.on(CONFIG_CHANGE_EVENT, listener)
      const ws = { readyState: WebSocket.OPEN, send(raw: string) {
        const frame = JSON.parse(raw)
        if (frame.type === "security.confirmation.request") queueMicrotask(() => confirmations.respondFrom(frame.confirmation_id, true, ws as WebSocket))
      } } as WebSocket
      bindMcpDispatchRuntime({ getThreadManager: () => null, securityConfirmations: confirmations, broadcastToClients() {} })
      let settled = false
      const call = executeMcpTool("mcp__filesystem__read_file", { path: offered }, "owned", ws, Date.now(), controller.signal).finally(() => { settled = true })
      await reloading
      await new Promise(r => setTimeout(r, 450))
      assert.equal(settled, false, "must still await the replacement catalog after 400ms")
      if (action === "abort") controller.abort()
      if (action === "off-on") {
        const mcp = getConfig().mcp!
        saveConfig({ mcp: { ...mcp, enabled: false } }); saveConfig({ mcp })
      }
      release()
      const result = await call
      assert.equal(result.success, action === "ready", result.error)
      assert.equal(calls, action === "ready" ? 2 : 1)
      if (action === "abort") assert.match(result.error!, /cancel/i)
      if (action === "off-on") assert.match(result.error!, /revoked/i)
      if (action === "contract-change") assert.match(result.error!, /contract changed/i)
      assert.ok((getConfig().mcp!.servers.filesystem as any).args.some((arg: string) => normalizeAllowDirKey(arg) === normalizeAllowDirKey(offered)), "approved commit is preserved")
      assert.equal(confirmations.pendingCount(), 0)
    } finally {
      release(); controller.abort(); confirmations.rejectAll()
      configEvents.off(CONFIG_CHANGE_EVENT, listener); bindMcpDispatchRuntime(null)
      await manager.applyConfig({ enabled: false, servers: {} })
      for (const server of servers) await server.close()
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
}

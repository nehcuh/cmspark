// MCP_CAPABILITY_GATE Phase 2-A (follow-up C, §6.3) — the META-tool gate.
//
// Phase 1 (PR #44) gated namespaced tools (mcp__<server>__<tool>) via
// executeMcpTool. But mcp_list_resources / mcp_read_resource / mcp_get_prompt
// are NOT namespaced → isMcpNamespaced is false → they dispatch through a
// SEPARATE path, executeMcpMetaTool, which historically had NO gate. So
// mcp_read_resource({server, uri}) read arbitrary URIs (file:///etc/passwd,
// data:, http://…) on a trusted server zero-confirmation.
//
// Phase 2-A: mcp_read_resource + mcp_get_prompt force-confirm
// (CRITICAL_MCP_META_TOOLS, never cached, god-mode-unaware); mcp_list_resources
// is gated purely by trust_level (D8-consistent with namespaced read tools).
//
// These integration tests drive createToolExecutor → executeMcpMetaTool over a
// real WS pair, with an in-memory MCP server (tools + resources + prompts caps)
// injected into the singleton manager.

import "./_mcp-gate-setup.js"
import test, { before, after, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import * as os from "node:os"
import * as path from "node:path"
import * as fs from "node:fs"
import { WebSocketServer, WebSocket } from "ws"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from "@modelcontextprotocol/sdk/types.js"

import {
  createToolExecutor,
  pendingToolCalls,
  securityConfirmations,
} from "../../src/server.js"
import { CRITICAL_MCP_META_TOOLS } from "../../src/security.js"
import { getMcpManager, getMcpConfirmCache } from "../../src/mcp/index.js"
import { McpClient } from "../../src/mcp/client.js"
import { saveConfig, getConfig } from "../../src/config.js"

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-mcpmeta-"))

let wss: WebSocketServer
let serverSideWs: WebSocket
let clientSideWs: WebSocket
let serverPort: number
const injected: Array<{ server: any; client: McpClient; name: string }> = []

before(() => {
  process.env.HOME = tempDir
  delete process.env.CMSPARK_DATA_DIR
})

after(() => {
  fs.rmSync(tempDir, { recursive: true, force: true })
})

beforeEach(async () => {
  for (const id of Array.from(pendingToolCalls.keys())) {
    const pending = pendingToolCalls.get(id)!
    clearTimeout(pending.timer)
    pendingToolCalls.delete(id)
  }
  securityConfirmations.rejectAll("disconnect")
  saveConfig({
    trusted_domains: [],
    auto_approved_domains: [],
    security: { ...getConfig().security, allow_all_schemes: false, auto_approve_dangerous: false },
  })

  await new Promise<void>((resolve) => {
    wss = new WebSocketServer({ port: 0, host: "127.0.0.1" }, () => resolve())
  })
  serverPort = (wss.address() as { port: number }).port

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("client connect timeout")), 2000)
    wss.once("connection", (ws) => {
      clearTimeout(timeout)
      serverSideWs = ws
      ws.on("error", () => { /* expected during teardown */ })
      ws.on("message", (raw) => {
        try {
          const msg = JSON.parse(raw.toString())
          if (msg.type === "security.confirmation.response") {
            securityConfirmations.respond(String(msg.confirmation_id || ""), msg.approved === true)
          }
        } catch { /* ignore malformed */ }
      })
      resolve()
    })
    clientSideWs = new WebSocket(`ws://127.0.0.1:${serverPort}`)
    clientSideWs.on("error", () => { /* expected during teardown */ })
  })
})

afterEach(async () => {
  for (const id of Array.from(pendingToolCalls.keys())) {
    const pending = pendingToolCalls.get(id)!
    clearTimeout(pending.timer)
    pendingToolCalls.delete(id)
  }
  securityConfirmations.rejectAll("disconnect")
  const manager: any = getMcpManager()
  for (const { server, client, name } of injected) {
    try { (manager.clients as Map<string, McpClient>).delete(name) } catch { /* */ }
    await client.close().catch(() => {})
    await server?.close?.().catch(() => {})
  }
  injected.length = 0
  try { (manager as any).reaggregate?.() } catch { /* */ }

  const safeTerminate = (ws: WebSocket | undefined) => { try { (ws as any)?.terminate?.() } catch { /* */ } }
  safeTerminate(clientSideWs)
  safeTerminate(serverSideWs)
  try { wss?.clients.forEach((c) => safeTerminate(c)) } catch { /* */ }
  await new Promise<void>((resolve) => {
    try { wss?.close(() => resolve()) } catch { resolve() }
  })
})

function expectClientMessage(type: string, timeoutMs = 2000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`timeout waiting for ${type}`)), timeoutMs)
    const handler = (raw: any) => {
      try {
        const msg = JSON.parse(raw.toString())
        if (msg.type === type) {
          clearTimeout(timeout)
          clientSideWs.off("message", handler)
          resolve(msg)
        }
      } catch { /* ignore */ }
    }
    clientSideWs.on("message", handler)
  })
}

function expectNoClientMessage(type: string, stabilizationMs = 250): Promise<void> {
  return new Promise((resolve, reject) => {
    const handler = (raw: any) => {
      try {
        const msg = JSON.parse(raw.toString())
        if (msg.type === type) {
          clientSideWs.off("message", handler)
          reject(new Error(`unexpected ${type} arrived: ${JSON.stringify(msg).slice(0, 200)}`))
        }
      } catch { /* ignore */ }
    }
    clientSideWs.on("message", handler)
    setTimeout(() => { clientSideWs.off("message", handler); resolve() }, stabilizationMs)
  })
}

/**
 * Inject an in-memory MCP server advertising tools + resources + prompts, so the
 * meta-tools can actually execute after the gate approves. Returns nothing — the
 * meta-tools address the server by `name` (args.server).
 */
async function injectServer(
  name: string,
  trustLevel: "manual" | "first-use" | "trusted",
): Promise<void> {
  const server = new Server(
    { name: `mock-${name}`, version: "1.0.0" },
    { capabilities: { tools: {}, resources: {}, prompts: {} } },
  )
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [] }))
  server.setRequestHandler(CallToolRequestSchema, async () => ({ content: [{ type: "text", text: "ok" }] }))
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: [{ uri: "file:///x", name: "x" }] }))
  server.setRequestHandler(ReadResourceRequestSchema, async (req: any) => ({
    contents: [{ uri: req.params?.uri, text: `content:${req.params?.uri}` }],
  }))
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: [{ name: "p", description: "d" }] }))
  server.setRequestHandler(GetPromptRequestSchema, async (req: any) => ({
    messages: [{ role: "user", content: { type: "text", text: `prompt:${req.params?.name}` } }],
  }))
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  const client = new McpClient(name, {
    transport: "stdio", command: "node", args: [], enabled: true, trust_level: trustLevel,
  })
  await client.connect(clientTransport)

  const manager: any = getMcpManager()
  ;(manager.clients as Map<string, McpClient>).set(name, client)
  manager.reaggregate()
  injected.push({ server, client, name })
}

// =============================================================================
// Unit: CRITICAL_MCP_META_TOOLS membership (the gate's source of truth)
// =============================================================================

test("CRITICAL_MCP_META_TOOLS: read_resource + get_prompt critical; list_resources not", () => {
  assert.equal(CRITICAL_MCP_META_TOOLS.has("mcp_read_resource"), true)
  assert.equal(CRITICAL_MCP_META_TOOLS.has("mcp_get_prompt"), true)
  assert.equal(CRITICAL_MCP_META_TOOLS.has("mcp_list_resources"), false)
})

// =============================================================================
// Integration: executeMcpMetaTool gate behavior
// =============================================================================

test("mcp_read_resource on TRUSTED server → STILL confirms (force-confirm)", async () => {
  await injectServer("fs", "trusted")
  const executeTool = createToolExecutor(serverSideWs)
  const confp = expectClientMessage("security.confirmation.request")
  const rp = executeTool("m1", "mcp_read_resource", { server: "fs", uri: "file:///etc/passwd" })
  const conf = await confp
  assert.equal(conf.risk_level, "high")
  assert.equal(conf.auto_confirm_eligible, false)
  assert.ok(conf.critical_apis?.includes("resource-read"), `got ${JSON.stringify(conf.critical_apis)}`)
  clientSideWs.send(JSON.stringify({ type: "security.confirmation.response", confirmation_id: conf.confirmation_id, approved: true }))
  const result = await rp
  assert.equal(result.success, true, `approved read should succeed; got: ${result.error}`)
})

test("mcp_read_resource DENIED → Security Block (no read happens)", async () => {
  await injectServer("fs", "trusted")
  const executeTool = createToolExecutor(serverSideWs)
  const confp = expectClientMessage("security.confirmation.request")
  const rp = executeTool("m2", "mcp_read_resource", { server: "fs", uri: "file:///etc/passwd" })
  const conf = await confp
  clientSideWs.send(JSON.stringify({ type: "security.confirmation.response", confirmation_id: conf.confirmation_id, approved: false }))
  const result = await rp
  assert.equal(result.success, false)
  assert.match(result.error || "", /denied|unavailable|by user/)
})

test("mcp_read_resource god-mode ON → STILL confirms (god-mode-unaware)", async () => {
  saveConfig({ security: { ...getConfig().security, allow_all_schemes: true, auto_approve_dangerous: true } })
  await injectServer("fs", "trusted")
  const executeTool = createToolExecutor(serverSideWs)
  const confp = expectClientMessage("security.confirmation.request")
  const rp = executeTool("m3", "mcp_read_resource", { server: "fs", uri: "data:text/plain,exfil" })
  const conf = await confp
  clientSideWs.send(JSON.stringify({ type: "security.confirmation.response", confirmation_id: conf.confirmation_id, approved: true }))
  const result = await rp
  assert.equal(result.success, true, "god-mode must not auto-approve mcp_read_resource")
})

test("mcp_read_resource is NEVER cached — 2nd call still confirms (same session)", async () => {
  await injectServer("fs", "trusted")
  const executeTool = createToolExecutor(serverSideWs)

  // Call 1: confirm + approve.
  const conf1p = expectClientMessage("security.confirmation.request")
  const r1p = executeTool("m4a", "mcp_read_resource", { server: "fs", uri: "file:///a" })
  const conf1 = await conf1p
  clientSideWs.send(JSON.stringify({ type: "security.confirmation.response", confirmation_id: conf1.confirmation_id, approved: true }))
  assert.equal((await r1p).success, true)

  // Call 2: SAME server+session. Critical → must re-prompt (not cached).
  const conf2p = expectClientMessage("security.confirmation.request")
  const r2p = executeTool("m4b", "mcp_read_resource", { server: "fs", uri: "file:///b" })
  const conf2 = await conf2p
  clientSideWs.send(JSON.stringify({ type: "security.confirmation.response", confirmation_id: conf2.confirmation_id, approved: true }))
  assert.equal((await r2p).success, true)
})

test("mcp_get_prompt on TRUSTED server → confirms (prompt-injection surface)", async () => {
  await injectServer("fs", "trusted")
  const executeTool = createToolExecutor(serverSideWs)
  const confp = expectClientMessage("security.confirmation.request")
  const rp = executeTool("m5", "mcp_get_prompt", { server: "fs", name: "p" })
  const conf = await confp
  assert.ok(conf.critical_apis?.includes("prompt-injection"), `got ${JSON.stringify(conf.critical_apis)}`)
  assert.equal(conf.risk_level, "high")
  clientSideWs.send(JSON.stringify({ type: "security.confirmation.response", confirmation_id: conf.confirmation_id, approved: true }))
  const result = await rp
  assert.equal(result.success, true)
})

test("mcp_list_resources on TRUSTED server → NO confirm (trust_level skip)", async () => {
  await injectServer("fs", "trusted")
  const executeTool = createToolExecutor(serverSideWs)
  const noPrompt = expectNoClientMessage("security.confirmation.request")
  const result = await executeTool("m6", "mcp_list_resources", { server: "fs" })
  await noPrompt
  assert.equal(result.success, true, `trusted list_resources should skip+succeed; got: ${result.error}`)
})

test("mcp_list_resources FIRST-USE: 1st call confirms+ caches, 2nd uses cache", async () => {
  await injectServer("fs", "first-use")
  const executeTool = createToolExecutor(serverSideWs)

  // Call 1: first-use, uncached → confirm. Approve → cached.
  const conf1p = expectClientMessage("security.confirmation.request")
  const r1p = executeTool("m7a", "mcp_list_resources", { server: "fs" })
  const conf1 = await conf1p
  assert.equal(conf1.risk_level, "medium", "list_resources is non-critical → medium risk")
  clientSideWs.send(JSON.stringify({ type: "security.confirmation.response", confirmation_id: conf1.confirmation_id, approved: true }))
  assert.equal((await r1p).success, true)

  // Call 2: cached → no prompt.
  const noPrompt = expectNoClientMessage("security.confirmation.request")
  const r2 = await executeTool("m7b", "mcp_list_resources", { server: "fs" })
  await noPrompt
  assert.equal(r2.success, true)
})

test("mcp_list_resources MANUAL → confirms (manual always prompts)", async () => {
  await injectServer("fs", "manual")
  const executeTool = createToolExecutor(serverSideWs)
  const confp = expectClientMessage("security.confirmation.request")
  const rp = executeTool("m8", "mcp_list_resources", { server: "fs" })
  const conf = await confp
  clientSideWs.send(JSON.stringify({ type: "security.confirmation.response", confirmation_id: conf.confirmation_id, approved: true }))
  assert.equal((await rp).success, true)
})

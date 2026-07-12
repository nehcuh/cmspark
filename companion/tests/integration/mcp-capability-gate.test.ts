// MCP_CAPABILITY_GATE (follow-up C, §6.3) — capability gate that survives
// trusted/first-use-cache/god-mode. Mirrors §6.2 CRITICAL_API_GATE for MCP.
//
// Two test layers:
//   * Unit: classifyMcpCall + CRITICAL_MCP_CAPABILITIES (the gap-closing logic).
//   * Integration: createToolExecutor → executeMcpTool gate behavior, driven via
//     a real WS pair + an in-memory MCP server injected into the singleton manager.

import "./_mcp-gate-setup.js"
import test, { before, after, beforeEach, afterEach } from "node:test"
import assert from "node:assert/strict"
import * as os from "node:os"
import * as path from "node:path"
import * as fs from "node:fs"
import { WebSocketServer, WebSocket } from "ws"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js"

import {
  createToolExecutor,
  pendingToolCalls,
  securityConfirmations,
} from "../../src/server.js"
import { classifyMcpCall, mergeCapabilities, CRITICAL_MCP_CAPABILITIES } from "../../src/security.js"
import type { McpCapability } from "../../src/security.js"
import { getMcpManager, getMcpConfirmCache } from "../../src/mcp/index.js"
import { McpClient } from "../../src/mcp/client.js"
import { saveConfig, getConfig } from "../../src/config.js"

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-mcpgate-"))

let wss: WebSocketServer
let serverSideWs: WebSocket
let clientSideWs: WebSocket
let serverPort: number
// Track in-memory MCP servers/clients injected into the singleton manager so
// afterEach can tear them down (avoid leaking handles across tests).
const injected: Array<{ server: any; client: McpClient; name: string }> = []

before(() => {
  process.env.HOME = tempDir
  delete process.env.CMSPARK_DATA_DIR
})

after(() => {
  fs.rmSync(tempDir, { recursive: true, force: true })
})

beforeEach(async () => {
  // Clear leaked executor + confirmation state.
  for (const id of Array.from(pendingToolCalls.keys())) {
    const pending = pendingToolCalls.get(id)!
    clearTimeout(pending.timer)
    pendingToolCalls.delete(id)
  }
  securityConfirmations.rejectAll("disconnect")
  // Reset god-mode / auto-approve so a prior test's state can't leak.
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
  // Remove injected clients from the singleton manager + close their transports.
  const manager: any = getMcpManager()
  for (const { server, client, name } of injected) {
    try { (manager.clients as Map<string, McpClient>).delete(name) } catch { /* */ }
    await client.close().catch(() => {})
    await server?.close?.().catch(() => {})
  }
  injected.length = 0
  try { (manager as any).reaggregate?.() } catch { /* */ }
  // §6.3 Phase 2-B: reset currentConfig so a declared-capabilities test's
  // currentConfig.servers[name] entry (set by injectServerWithCaps) doesn't leak
  // into the next test's getServerConfig() read.
  try { (manager as any).currentConfig = null } catch { /* */ }

  const safeTerminate = (ws: WebSocket | undefined) => { try { (ws as any)?.terminate?.() } catch { /* */ } }
  safeTerminate(clientSideWs)
  safeTerminate(serverSideWs)
  try { wss?.clients.forEach((c) => safeTerminate(c)) } catch { /* */ }
  await new Promise<void>((resolve) => {
    try { wss?.close(() => resolve()) } catch { resolve() }
  })
})

/**
 * Subscribe to a message type. MUST be called BEFORE the action that produces it.
 */
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

/** Assert NO message of `type` arrives within `stabilizationMs` (gate skipped). */
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
 * Build an in-memory MCP server advertising `tools`, connect an McpClient with
 * `trustLevel`, and inject it into the singleton manager (so executeMcpTool can
 * resolve + dispatch). Returns the namespaced-name builder. The client is the
 * test-only cast `clients.set` + `reaggregate()` — McpManager has no public
 * inject hook because production only ever populates it via startClient (spawn).
 *
 * NOTE: each tool's `inputSchema` MUST be `{ type: "object", properties: {} }`
 * (or richer) — never `{}`. The SDK validates the listTools response against the
 * MCP schema and rejects an inputSchema missing `type:"object"`. With an invalid
 * schema, refreshTools() throws inside connect()'s refreshAllCaches(), the
 * rejection is swallowed, _toolsCache stays empty → aggregator yields no aliases
 * → resolveToolName fails → executeMcpTool returns "not found" before the gate.
 */
async function injectServer(
  name: string,
  trustLevel: "manual" | "first-use" | "trusted",
  tools: Array<{ name: string; description?: string; inputSchema?: any }>,
): Promise<(tool: string) => string> {
  const server = new Server({ name: `mock-${name}`, version: "1.0.0" }, { capabilities: { tools: {} } })
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }))
  server.setRequestHandler(CallToolRequestSchema, async (req: any) => ({
    content: [{ type: "text", text: `ok:${req.params?.name}` }],
  }))
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  const client = new McpClient(name, {
    transport: "stdio",
    command: "node",
    args: [],
    enabled: true,
    trust_level: trustLevel,
  })
  await client.connect(clientTransport)

  const manager: any = getMcpManager()
  ;(manager.clients as Map<string, McpClient>).set(name, client)
  manager.reaggregate()
  injected.push({ server, client, name })
  return (tool: string) => `mcp__${name}__${tool}`
}

// =============================================================================
// Unit: classifyMcpCall + CRITICAL_MCP_CAPABILITIES
// =============================================================================

test("classify: write-named tools → file-write (critical); broader than DESTRUCTIVE regex", () => {
  // save/put/create/mkdir evade DESTRUCTIVE_MCP_TOOL_PATTERN (server.ts:137) but
  // are caught here — closing the §3.1 row-3 name-evasion gap.
  for (const n of ["write_file", "save_record", "put_data", "create_file", "mkdir_logs", "upload_blob"]) {
    const caps = classifyMcpCall(n, {})
    assert.ok(caps.includes("file-write"), `${n} → file-write`)
    assert.equal(caps.some(c => CRITICAL_MCP_CAPABILITIES.has(c)), true, `${n} critical`)
  }
})

test("classify: exec / db-mutate / network-egress names → critical", () => {
  assert.ok(classifyMcpCall("exec_cmd", {}).includes("exec"))
  assert.ok(classifyMcpCall("run_shell", {}).includes("exec"))
  assert.ok(classifyMcpCall("spawn_proc", {}).includes("exec"))
  assert.ok(classifyMcpCall("insert_record", {}).includes("db-mutate"))
  assert.ok(classifyMcpCall("drop_table", {}).includes("db-mutate"))
  assert.ok(classifyMcpCall("fetch_url", {}).includes("network-egress"))
  assert.ok(classifyMcpCall("download_file", {}).includes("network-egress"))
})

test("classify: read-named tools → read-only (NON-critical, D8 trade-off)", () => {
  for (const n of ["read_file", "get_info", "search_docs", "query_db", "list_records", "show_status"]) {
    const caps = classifyMcpCall(n, {})
    assert.ok(caps.includes("read-only"), `${n} → read-only`)
    assert.equal(caps.some(c => CRITICAL_MCP_CAPABILITIES.has(c)), false, `${n} non-critical`)
  }
  // Even a sensitive path doesn't escalate reads (D8: reads rely on M2 + trust_level).
  const caps = classifyMcpCall("read_file", { path: "/etc/shadow" })
  assert.equal(caps.some(c => CRITICAL_MCP_CAPABILITIES.has(c)), false, "read of sensitive path stays non-critical (D8)")
})

test("classify: name-evasion caught by ARG scan (the §3.1 gap-closer)", () => {
  // get_info name → read-only (non-critical). But an external-URL arg adds
  // network-egress → critical, regardless of the benign tool name.
  let caps = classifyMcpCall("get_info", { url: "https://attacker.example.com/exfil" })
  assert.ok(caps.includes("network-egress"), "external URL arg → network-egress")
  assert.equal(caps.some(c => CRITICAL_MCP_CAPABILITIES.has(c)), true)

  // Shell verb in args → exec.
  caps = classifyMcpCall("get_info", { cmd: "bash -c 'cat /etc/shadow'" })
  assert.ok(caps.includes("exec"), "shell verb in args → exec")

  // path + content args → file-write.
  caps = classifyMcpCall("query", { path: "/etc/passwd", content: "evil" })
  assert.ok(caps.includes("file-write"), "path+content args → file-write")
})

test("classify: loopback URLs are NOT network-egress", () => {
  for (const url of ["http://127.0.0.1:23401", "http://localhost:8080", "http://[::1]/x"]) {
    const caps = classifyMcpCall("get_info", { url })
    assert.equal(caps.includes("network-egress"), false, `${url} should not be egress`)
  }
})

test("classify: loopback-PREFIXED attacker domains ARE network-egress (host-boundary fix)", () => {
  // These start with a loopback literal but are attacker-controlled domains —
  // a prefix-based (?!localhost) lookahead would let them exfil zero-confirmation.
  // The host-terminator guard (not-followed-by-[a-z0-9.-]) closes the bypass.
  for (const url of [
    "https://localhost.attacker.com/exfil",
    "https://127.0.0.1.attacker.com/x",
    "http://localhoststats.attacker.com/x",
    "https://localhost.evil.io/p",
  ]) {
    const caps = classifyMcpCall("get_info", { url })
    assert.ok(caps.includes("network-egress"), `${url} must be egress (attacker domain, not loopback)`)
    assert.equal(caps.some(c => CRITICAL_MCP_CAPABILITIES.has(c)), true, `${url} must be critical`)
  }
})

test("classify: NIT-1 non-http(s) network schemes trigger network-egress", () => {
  for (const url of ["ftp://evil.com/x", "ftps://evil.com/x", "ws://evil.com/ws", "wss://evil.com/ws"]) {
    const caps = classifyMcpCall("get_info", { url })
    assert.ok(caps.includes("network-egress"), `${url} must be egress`)
    assert.equal(caps.some(c => CRITICAL_MCP_CAPABILITIES.has(c)), true, `${url} must be critical`)
  }
  // Non-egress schemes must NOT be flagged.
  for (const url of ["file:///etc/passwd", "data:text/plain,hello", "mailto:evil@example.com"]) {
    const caps = classifyMcpCall("get_info", { url })
    assert.equal(caps.includes("network-egress"), false, `${url} is not network egress`)
  }
})

test("classify: NIT-2 bare host:port triggers network-egress (scheme-less target)", () => {
  // Domain + port and public IPv4 + port.
  for (const target of ["evil.attacker.com:443/exfil", "1.2.3.4:8080"]) {
    const caps = classifyMcpCall("get_info", { target })
    assert.ok(caps.includes("network-egress"), `${target} must be egress`)
  }
  // Loopback host:port is excluded.
  assert.equal(classifyMcpCall("get_info", { ip: "127.0.0.1:8080" }).includes("network-egress"), false)
  // Private ranges are intentionally treated as egress (SSRF pivot).
  assert.ok(classifyMcpCall("get_info", { ip: "192.168.1.5:80" }).includes("network-egress"), "RFC1918 is egress")
  assert.ok(classifyMcpCall("get_info", { ip: "10.0.0.1:80" }).includes("network-egress"), "10.x is egress")
  // Bare hostname without port is too noisy — not an egress signal.
  assert.equal(classifyMcpCall("get_info", { desc: "see docs.example.com for help" }).includes("network-egress"), false)
})

test("classify: NIT-3 very large args scan head + tail, not just prefix", () => {
  const padding = "a".repeat(5000)
  const caps = classifyMcpCall("get_info", { padding, url: "https://evil.com/x" })
  assert.ok(caps.includes("network-egress"), "URL hidden near the tail is still detected")

  // Accepted gap: a marker in the middle (between head and tail windows) may be
  // missed. This is a deliberate trade-off to bound regex cost on huge blobs.
  const prefix = "a".repeat(4500)
  const middle = "https://middle-gap.example.com/x"
  const suffix = "b".repeat(2500)
  const capsGap = classifyMcpCall("get_info", { prefix, middle, suffix })
  assert.equal(capsGap.includes("network-egress"), false, "middle-gap marker is accepted miss")
})

test("classify: unclassifiable → unknown (critical, force confirm)", () => {
  const caps = classifyMcpCall("zzz", {})
  assert.deepEqual(caps, ["unknown"])
  assert.equal(CRITICAL_MCP_CAPABILITIES.has("unknown" as McpCapability), true)
})

test("CRITICAL_MCP_CAPABILITIES membership", () => {
  for (const c of ["file-write", "exec", "network-egress", "db-mutate", "unknown"] as McpCapability[]) {
    assert.equal(CRITICAL_MCP_CAPABILITIES.has(c), true, `${c} critical`)
  }
  for (const c of ["file-read", "db-read", "read-only"] as McpCapability[]) {
    assert.equal(CRITICAL_MCP_CAPABILITIES.has(c), false, `${c} non-critical`)
  }
})

// =============================================================================
// Integration: executeMcpTool gate behavior via createToolExecutor
// =============================================================================

test("trusted server + critical capability (write_file) → STILL confirms", async () => {
  const ns = await injectServer("fs", "trusted", [{ name: "write_file", inputSchema: { type: "object", properties: {} } }])
  const executeTool = createToolExecutor(serverSideWs)
  const confirmationPromise = expectClientMessage("security.confirmation.request")
  const resultPromise = executeTool("tc1", ns("write_file"), { path: "/tmp/x", content: "y" })

  const conf = await confirmationPromise
  // forceMcpConfirm surfaces the matched capabilities in the request.
  assert.ok(conf.critical_apis?.includes("file-write"), `critical_apis=${JSON.stringify(conf.critical_apis)}`)
  assert.equal(conf.risk_level, "high")
  assert.equal(conf.auto_confirm_eligible, false)

  // Approve → callTool runs → success.
  clientSideWs.send(JSON.stringify({ type: "security.confirmation.response", confirmation_id: conf.confirmation_id, approved: true }))
  const result = await resultPromise
  assert.equal(result.success, true, `approved critical call should succeed; got: ${result.error}`)
})

test("trusted server + non-critical (read_file) → NO confirm (trust_level skip)", async () => {
  const ns = await injectServer("fs", "trusted", [{ name: "read_file", inputSchema: { type: "object", properties: {} } }])
  const executeTool = createToolExecutor(serverSideWs)
  const noPrompt = expectNoClientMessage("security.confirmation.request")
  const result = await executeTool("tc2", ns("read_file"), { path: "/tmp/x" })
  await noPrompt
  assert.equal(result.success, true, `trusted non-critical read should skip+succeed; got: ${result.error}`)
})

test("first-use cached + critical → confirms AND is NOT cached (next call still confirms)", async () => {
  const ns = await injectServer("fs", "first-use", [{ name: "write_file", inputSchema: { type: "object", properties: {} } }])
  const executeTool = createToolExecutor(serverSideWs) // same executor → same sessionId

  // Call 1: prompts (critical). Register listener, THEN fire the call, THEN await.
  const conf1p = expectClientMessage("security.confirmation.request")
  const r1p = executeTool("tc3a", ns("write_file"), { path: "/tmp/a", content: "x" })
  const conf1 = await conf1p
  clientSideWs.send(JSON.stringify({ type: "security.confirmation.response", confirmation_id: conf1.confirmation_id, approved: true }))
  const r1 = await r1p
  assert.equal(r1.success, true)

  // Call 2: SAME tool, SAME executor. Critical → must re-prompt (not cached).
  const conf2p = expectClientMessage("security.confirmation.request")
  const r2p = executeTool("tc3b", ns("write_file"), { path: "/tmp/b", content: "y" })
  const conf2 = await conf2p
  clientSideWs.send(JSON.stringify({ type: "security.confirmation.response", confirmation_id: conf2.confirmation_id, approved: true }))
  const r2 = await r2p
  assert.equal(r2.success, true)
})

test("first-use cached + non-critical → second call uses cache (no re-prompt)", async () => {
  const ns = await injectServer("fs", "first-use", [{ name: "read_file", inputSchema: { type: "object", properties: {} } }])
  const executeTool = createToolExecutor(serverSideWs)

  // Call 1: prompts (first-use, unapproved). Approve → cached.
  const conf1p = expectClientMessage("security.confirmation.request")
  const r1p = executeTool("tc4a", ns("read_file"), { path: "/tmp/a" })
  const conf1 = await conf1p
  clientSideWs.send(JSON.stringify({ type: "security.confirmation.response", confirmation_id: conf1.confirmation_id, approved: true }))
  assert.equal((await r1p).success, true)

  // Call 2: cached, non-critical → no prompt.
  const noPrompt = expectNoClientMessage("security.confirmation.request")
  const r2 = await executeTool("tc4b", ns("read_file"), { path: "/tmp/b" })
  await noPrompt
  assert.equal(r2.success, true)
})

test("manual trust + non-critical → still confirms (manual always prompts)", async () => {
  const ns = await injectServer("fs", "manual", [{ name: "read_file", inputSchema: { type: "object", properties: {} } }])
  const executeTool = createToolExecutor(serverSideWs)
  const confp = expectClientMessage("security.confirmation.request")
  const rp = executeTool("tc5", ns("read_file"), { path: "/tmp/x" })
  const conf = await confp
  clientSideWs.send(JSON.stringify({ type: "security.confirmation.response", confirmation_id: conf.confirmation_id, approved: true }))
  assert.equal((await rp).success, true)
})

test("god-mode ON + critical MCP → STILL confirms (gate is god-mode-unaware)", async () => {
  saveConfig({ security: { ...getConfig().security, allow_all_schemes: true, auto_approve_dangerous: true } })
  const ns = await injectServer("fs", "trusted", [{ name: "write_file", inputSchema: { type: "object", properties: {} } }])
  const executeTool = createToolExecutor(serverSideWs)
  const confp = expectClientMessage("security.confirmation.request")
  const rp = executeTool("tc6", ns("write_file"), { path: "/tmp/x", content: "y" })
  const conf = await confp
  clientSideWs.send(JSON.stringify({ type: "security.confirmation.response", confirmation_id: conf.confirmation_id, approved: true }))
  assert.equal((await rp).success, true, "god-mode must not auto-approve critical MCP")
})

test("DESTRUCTIVE name (exec_cmd) on trusted server → confirms (existing force-manual + new forceMcpConfirm)", async () => {
  const ns = await injectServer("fs", "trusted", [{ name: "exec_cmd", inputSchema: { type: "object", properties: {} } }])
  const executeTool = createToolExecutor(serverSideWs)
  const confp = expectClientMessage("security.confirmation.request")
  const rp = executeTool("tc7", ns("exec_cmd"), { cmd: "ls" })
  const conf = await confp
  assert.ok(conf.critical_apis?.includes("exec"), `exec should be in critical_apis; got ${JSON.stringify(conf.critical_apis)}`)
  clientSideWs.send(JSON.stringify({ type: "security.confirmation.response", confirmation_id: conf.confirmation_id, approved: true }))
  assert.equal((await rp).success, true)
})

test("name-evasion: get_info + external URL arg on trusted server → forceMcpConfirm", async () => {
  const ns = await injectServer("net", "trusted", [{ name: "get_info", inputSchema: { type: "object", properties: {} } }])
  const executeTool = createToolExecutor(serverSideWs)
  const confp = expectClientMessage("security.confirmation.request")
  const rp = executeTool("tc8", ns("get_info"), { url: "https://attacker.example.com/exfil" })
  const conf = await confp
  assert.ok(conf.critical_apis?.includes("network-egress"), `egress from arg; got ${JSON.stringify(conf.critical_apis)}`)
  clientSideWs.send(JSON.stringify({ type: "security.confirmation.response", confirmation_id: conf.confirmation_id, approved: false }))
  const result = await rp
  assert.equal(result.success, false, "denied critical call must fail")
  assert.match(result.error || "", /denied|unavailable|by user/)
})

test("NIT-3 integration: get_info + tail-hidden URL arg on trusted server → forceMcpConfirm", async () => {
  const ns = await injectServer("net", "trusted", [{ name: "get_info", inputSchema: { type: "object", properties: {} } }])
  const executeTool = createToolExecutor(serverSideWs)
  const padding = "a".repeat(5000)
  const confp = expectClientMessage("security.confirmation.request")
  const rp = executeTool("tc8-tail", ns("get_info"), { padding, url: "https://attacker.example.com/exfil" })
  const conf = await confp
  assert.ok(conf.critical_apis?.includes("network-egress"), `tail egress detected; got ${JSON.stringify(conf.critical_apis)}`)
  clientSideWs.send(JSON.stringify({ type: "security.confirmation.response", confirmation_id: conf.confirmation_id, approved: false }))
  const result = await rp
  assert.equal(result.success, false, "denied critical call must fail")
})

test("unclassifiable tool (zzz) on trusted server → forceMcpConfirm (unknown=critical)", async () => {
  const ns = await injectServer("fs", "trusted", [{ name: "zzz", inputSchema: { type: "object", properties: {} } }])
  const executeTool = createToolExecutor(serverSideWs)
  const confp = expectClientMessage("security.confirmation.request")
  const rp = executeTool("tc9", ns("zzz"), {})
  const conf = await confp
  assert.ok(conf.critical_apis?.includes("unknown"), `unknown should be critical; got ${JSON.stringify(conf.critical_apis)}`)
  clientSideWs.send(JSON.stringify({ type: "security.confirmation.response", confirmation_id: conf.confirmation_id, approved: true }))
  assert.equal((await rp).success, true)
})

// =============================================================================
// §6.3 Phase 2-B: mergeCapabilities unit tests (fail-safe union, Option C)
// =============================================================================

test("merge: inferred critical + no declaration → unchanged (I4 regression)", () => {
  const m = mergeCapabilities(["file-write"], undefined)
  assert.deepEqual(m.capabilities, ["file-write"])
  assert.equal(m.declaredResolvedUnknown, false)
})

test("merge: inferred unknown + no declaration → unknown, not resolved (Phase 1 default)", () => {
  const m = mergeCapabilities(["unknown"], undefined)
  assert.deepEqual(m.capabilities, ["unknown"])
  assert.equal(m.declaredResolvedUnknown, false)
})

test("merge: inferred unknown + declared read-only → resolves unknown (I2)", () => {
  const m = mergeCapabilities(["unknown"], ["read-only"])
  assert.deepEqual(m.capabilities, ["read-only"])
  assert.equal(m.declaredResolvedUnknown, true)
})

test("merge: inferred file-write + declared read-only → STILL file-write (I1, the Option-B bypass stays closed)", () => {
  // The critical case: a declaration must NEVER suppress a positively-inferred
  // critical capability. {file-write} ∪ {read-only} → file-write forces confirm.
  const m = mergeCapabilities(["file-write"], ["read-only"])
  assert.ok(m.capabilities.includes("file-write"), "inferred critical must survive")
  assert.equal(m.capabilities.some(c => CRITICAL_MCP_CAPABILITIES.has(c)), true)
  assert.equal(m.declaredResolvedUnknown, false)
})

test("merge: inferred read-only + declared exec → escalates to critical (I3)", () => {
  const m = mergeCapabilities(["read-only"], ["exec"])
  assert.ok(m.capabilities.includes("exec"), "declared exec added")
  assert.equal(m.capabilities.some(c => CRITICAL_MCP_CAPABILITIES.has(c)), true)
  assert.equal(m.declaredResolvedUnknown, false)
})

test("merge: union of two criticals stays critical", () => {
  const m = mergeCapabilities(["file-write"], ["exec"])
  assert.ok(m.capabilities.includes("file-write"))
  assert.ok(m.capabilities.includes("exec"))
  assert.equal(m.capabilities.some(c => CRITICAL_MCP_CAPABILITIES.has(c)), true)
})

test("merge: invalid declared values ignored (defensive filter)", () => {
  // "bogus" is not a valid declared capability; merge ignores it → behaves as
  // empty declaration → unknown stays (sanitization also strips, but merge is
  // robust to direct callers).
  const m1 = mergeCapabilities(["unknown"], ["bogus"])
  assert.deepEqual(m1.capabilities, ["unknown"])
  assert.equal(m1.declaredResolvedUnknown, false, "invalid-only declaration does not resolve unknown")

  // Mixed: valid + invalid → valid kept, invalid dropped, unknown resolved.
  const m2 = mergeCapabilities(["unknown"], ["read-only", "bogus", "unknown" as any])
  assert.deepEqual(m2.capabilities, ["read-only"])
  assert.equal(m2.declaredResolvedUnknown, true)
})

test("merge: empty inferred + declared read-only → read-only, resolved (defensive)", () => {
  // classifyMcpCall never returns an empty array (always at least ["unknown"]),
  // but mergeCapabilities treats empty inferred as unknown-equivalent for safety.
  const m = mergeCapabilities([], ["read-only"])
  assert.deepEqual(m.capabilities, ["read-only"])
  assert.equal(m.declaredResolvedUnknown, true)
})

// =============================================================================
// §6.3 Phase 2-B integration: declared security_capabilities gate behavior
// =============================================================================

/**
 * Like injectServer, but ALSO seeds the singleton manager's currentConfig with a
 * server entry carrying `security_capabilities`, so executeMcpTool's
 * `manager.getServerConfig(name)?.security_capabilities` read finds the declaration.
 * (Plain injectServer only sets the clients Map, not currentConfig.)
 */
async function injectServerWithCaps(
  name: string,
  trustLevel: "manual" | "first-use" | "trusted",
  tools: Array<{ name: string; description?: string; inputSchema?: any }>,
  securityCapabilities: string[],
): Promise<(tool: string) => string> {
  const ns = await injectServer(name, trustLevel, tools)
  const manager: any = getMcpManager()
  if (!manager.currentConfig) manager.currentConfig = { enabled: true, servers: {} }
  manager.currentConfig.servers[name] = {
    transport: "stdio",
    command: "node",
    args: [],
    enabled: true,
    trust_level: trustLevel,
    security_capabilities: securityCapabilities,
  }
  return ns
}

test("P2B: trusted + save_file (inferred file-write) + declared [read-only] → STILL confirms (Option-B bypass closed)", async () => {
  // The hole pure-REPLACE (Option B) would open: declaring read-only must NOT
  // suppress the inferred file-write on a trusted server.
  const ns = await injectServerWithCaps("fs", "trusted",
    [{ name: "save_file", inputSchema: { type: "object", properties: {} } }], ["read-only"])
  const executeTool = createToolExecutor(serverSideWs)
  const confp = expectClientMessage("security.confirmation.request")
  const rp = executeTool("p2b1", ns("save_file"), { path: "/tmp/x", content: "y" })
  const conf = await confp
  assert.ok(conf.critical_apis?.includes("file-write"), `inferred file-write survived; got ${JSON.stringify(conf.critical_apis)}`)
  assert.equal(conf.risk_level, "high")
  clientSideWs.send(JSON.stringify({ type: "security.confirmation.response", confirmation_id: conf.confirmation_id, approved: true }))
  assert.equal((await rp).success, true)
})

test("P2B: trusted + unclassifiable (foobar) + declared [read-only] → NO confirm (resolves unknown, I2)", async () => {
  // foobar → inferred unknown (would force-confirm under Phase 1). The user
  // declares read-only → unknown resolved → trusted server skips confirmation.
  const ns = await injectServerWithCaps("fs", "trusted",
    [{ name: "foobar", inputSchema: { type: "object", properties: {} } }], ["read-only"])
  const executeTool = createToolExecutor(serverSideWs)
  const noPrompt = expectNoClientMessage("security.confirmation.request")
  const result = await executeTool("p2b2", ns("foobar"), { x: 1 })
  await noPrompt
  assert.equal(result.success, true, `resolved-unknown + trusted should skip+succeed; got: ${result.error}`)
})

test("P2B: trusted + unclassifiable (foobar) + declared [exec] → forceMcpConfirm (declaration escalates, I3)", async () => {
  // foobar → inferred unknown. User declares exec → union {unknown, exec} →
  // critical → force-confirm despite trusted server + benign name.
  const ns = await injectServerWithCaps("fs", "trusted",
    [{ name: "foobar", inputSchema: { type: "object", properties: {} } }], ["exec"])
  const executeTool = createToolExecutor(serverSideWs)
  const confp = expectClientMessage("security.confirmation.request")
  const rp = executeTool("p2b3", ns("foobar"), { x: 1 })
  const conf = await confp
  assert.ok(conf.critical_apis?.includes("exec"), `declared exec escalated; got ${JSON.stringify(conf.critical_apis)}`)
  clientSideWs.send(JSON.stringify({ type: "security.confirmation.response", confirmation_id: conf.confirmation_id, approved: true }))
  assert.equal((await rp).success, true)
})

test("P2B: trusted + read_file (inferred read-only) + declared [file-write] → escalates to confirm", async () => {
  // read_file name → inferred read-only (non-critical). User declares file-write
  // → union → critical → force-confirm even on a trusted server.
  const ns = await injectServerWithCaps("fs", "trusted",
    [{ name: "read_file", inputSchema: { type: "object", properties: {} } }], ["file-write"])
  const executeTool = createToolExecutor(serverSideWs)
  const confp = expectClientMessage("security.confirmation.request")
  const rp = executeTool("p2b4", ns("read_file"), { path: "/tmp/x" })
  const conf = await confp
  assert.ok(conf.critical_apis?.includes("file-write"), `declared file-write escalated a read tool; got ${JSON.stringify(conf.critical_apis)}`)
  clientSideWs.send(JSON.stringify({ type: "security.confirmation.response", confirmation_id: conf.confirmation_id, approved: true }))
  assert.equal((await rp).success, true)
})

test("P2B: trusted + read_file, NO declaration → NO confirm (Phase 1 regression intact)", async () => {
  // With no security_capabilities, behavior is pure Phase 1 inference:
  // read_file → read-only → non-critical → trusted skip.
  const ns = await injectServer("fs", "trusted",
    [{ name: "read_file", inputSchema: { type: "object", properties: {} } }])
  const executeTool = createToolExecutor(serverSideWs)
  const noPrompt = expectNoClientMessage("security.confirmation.request")
  const result = await executeTool("p2b5", ns("read_file"), { path: "/tmp/x" })
  await noPrompt
  assert.equal(result.success, true, `no-declaration read on trusted should skip (Phase 1); got: ${result.error}`)
})

test("P2B: first-use + unclassifiable + declared [read-only], approved once → cached, 2nd skips (non-critical caching)", async () => {
  // Resolving unknown to read-only makes the call non-critical → first-use
  // approval IS cached (critical calls never are). 2nd call uses cache.
  const ns = await injectServerWithCaps("fs", "first-use",
    [{ name: "foobar", inputSchema: { type: "object", properties: {} } }], ["read-only"])
  const executeTool = createToolExecutor(serverSideWs)

  // Call 1: first-use, uncached → confirm. Approve → cached (non-critical).
  const conf1p = expectClientMessage("security.confirmation.request")
  const r1p = executeTool("p2b6a", ns("foobar"), { x: 1 })
  const conf1 = await conf1p
  assert.equal(conf1.risk_level, "medium", "resolved-to-read-only is non-critical → medium risk")
  clientSideWs.send(JSON.stringify({ type: "security.confirmation.response", confirmation_id: conf1.confirmation_id, approved: true }))
  assert.equal((await r1p).success, true)

  // Call 2: cached → no prompt.
  const noPrompt = expectNoClientMessage("security.confirmation.request")
  const r2 = await executeTool("p2b6b", ns("foobar"), { x: 2 })
  await noPrompt
  assert.equal(r2.success, true)
})

// #598: cancelling an allow-dir prompt used to leave it actionable, allowing
// a late approval to persist configuration even though the MCP retry stopped.
// Missing cancellation plumbing was the cause. Exercise real config writes
// inside an isolated fixture; no real stdio server or user config is touched.
import "./_security-gates-setup.js"
import test, { before, beforeEach, afterEach, mock } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { WebSocket } from "ws"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import { initDataDir, getConfig, getConfigDir, saveConfig } from "../../src/config"
import { SecurityConfirmationManager } from "../../src/security-confirmation"
import { ThreadManager } from "../../src/threads/thread-manager"
import { bindMcpDispatchRuntime, executeMcpTool, tryExpandFilesystemAllowDirOnDenial } from "../../src/mcp/dispatch"
import { addFilesystemAllowDir, normalizeAllowDirKey, pathToFileUri } from "../../src/mcp/allow-dir-expand"
import { getMcpManager } from "../../src/mcp/manager"
import { McpClient } from "../../src/mcp/client"

let root: string
let offered: string
let cfgBefore: string
let confirmations: SecurityConfirmationManager
let tm: ThreadManager
let tid: string
let ws: WebSocket
let frames: any[]
let onRequest: ((frame: any) => void) | undefined
let calls: number
let reloads: number
let onReload: (() => Promise<void> | void) | undefined
let client: McpClient
let server: Server
const configText = () => fs.readFileSync(path.join(getConfigDir(), "config.json"), "utf8")

before(async () => { await initDataDir() })
beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-allow-cancel-"))
  const initial = path.join(root, "initial")
  offered = path.join(root, "requested")
  fs.mkdirSync(initial)
  fs.mkdirSync(offered)
  offered = fs.realpathSync(offered)
  calls = 0; reloads = 0; onReload = undefined; onRequest = undefined; frames = []
  confirmations = new SecurityConfirmationManager()
  tm = new ThreadManager()
  tid = tm.create("allow-dir cancellation").id
  tm.update(tid, { mcp_selection_mode: "manual", active_mcp_server_ids: ["filesystem"] })
  ws = { readyState: WebSocket.OPEN, send(raw: string) {
    const frame = JSON.parse(raw)
    frames.push(frame)
    if (frame.type === "security.confirmation.request") onRequest?.(frame)
  } } as unknown as WebSocket
  bindMcpDispatchRuntime({ getThreadManager: () => tm, securityConfirmations: confirmations,
    broadcastToClients: () => {},
  })
  const cfg = { transport: "stdio" as const, command: "node", args: [initial], roots: [], enabled: true,
    trust_level: "trusted" as const, security_capabilities: ["read-only" as const],
  }
  saveConfig({ security: { ...getConfig().security, allow_all_schemes: false,
    auto_approve_dangerous: false, auto_approve_enterprise_tools: false,
  }, mcp: { enabled: true, servers: { filesystem: cfg } } })
  server = new Server({ name: "owned-filesystem-fixture", version: "1" }, { capabilities: { tools: {} } })
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{ name: "read_file", inputSchema: { type: "object" } }] }))
  server.setRequestHandler(CallToolRequestSchema, async () => {
    calls++
    const config = getConfig().mcp!.servers.filesystem
    const allowed = config.transport === "stdio" && config.args?.some(arg => normalizeAllowDirKey(arg) === normalizeAllowDirKey(offered))
    return allowed ? { content: [{ type: "text", text: "owned fixture result" }] }
      : { isError: true, content: [{ type: "text", text: "Access denied: path outside allowed directories" }] }
  })
  const [ct, st] = InMemoryTransport.createLinkedPair()
  await server.connect(st)
  client = new McpClient("filesystem", getConfig().mcp!.servers.filesystem)
  await client.connect(ct)
  const manager = getMcpManager() as any
  manager.clients.set(client.name, client)
  manager.currentConfig = getConfig().mcp
  manager.reaggregate()
  // Persist real isolated config, but replace only the process-restart effect.
  mock.method(getMcpManager(), "applyConfig", async () => { reloads++; await onReload?.() })
  cfgBefore = configText()
})
afterEach(async () => {
  onRequest = undefined
  confirmations.rejectAll()
  mock.restoreAll()
  bindMcpDispatchRuntime(null)
  const manager = getMcpManager() as any
  manager.clients.delete(client.name)
  manager.reaggregate()
  await client.close()
  await server.close()
  fs.rmSync(root, { recursive: true, force: true })
})
function cruise() {
  saveConfig({ security: { ...getConfig().security, allow_all_schemes: true,
    auto_approve_dangerous: true, auto_approve_enterprise_tools: true,
  } })
  cfgBefore = configText()
}
function call(signal?: AbortSignal, target = offered) {
  return executeMcpTool("mcp__filesystem__read_file", { __thread_id: tid, path: target }, tid, ws, Date.now(), signal)
}
function expand(signal?: AbortSignal) {
  return tryExpandFilesystemAllowDirOnDenial({
    route: { serverName: "filesystem", toolName: "read_file" },
    params: { path: offered }, rawErr: "Access denied", toolName: "mcp__filesystem__read_file", ws, signal,
  })
}
function prompt() {
  return new Promise<any>(resolve => { onRequest = resolve })
}
function unchanged(expectedCalls: number) {
  assert.equal(configText(), cfgBefore)
  assert.equal(reloads, 0)
  assert.equal(calls, expectedCalls)
}
function persisted() {
  const cfg = JSON.parse(configText()).mcp.servers.filesystem
  const original = JSON.parse(cfgBefore).mcp.servers.filesystem
  const dirArg = process.platform === "win32" ? offered.replace(/\\/g, "/") : offered
  assert.deepEqual(cfg.args, [...original.args, dirArg])
  assert.deepEqual(cfg.roots, [{ uri: pathToFileUri(offered), name: path.basename(offered) }])
  assert.equal(reloads, 1)
}
async function getPrompt(pending: Promise<any>, result: Promise<any>) {
  return Promise.race([pending, result.then(value => { throw new Error(`Prompt not reached: ${JSON.stringify(value)}`) })])
}

test("abort drains only its allow-dir confirmation; late approval cannot persist or retry", { timeout: 5000 }, async () => {
  const controller = new AbortController()
  const requested = prompt()
  const result = call(controller.signal)
  const frame = await getPrompt(requested, result)
  assert.ok(frame.critical_apis.includes("mcp-allow-dir-expand"))
  let otherId = ""
  const other = confirmations.request(data => {
    if (data.type === "security.confirmation.request") otherId = data.confirmation_id
  }, { toolName: "other", dangerousApis: [], code: "fixture" }, { originWs: ws })
  controller.abort()
  assert.equal(confirmations.pendingCount(), 1)
  assert.equal(confirmations.respondFrom(frame.confirmation_id, true, ws).outcome, "unknown")
  const outcome = await result
  assert.equal(outcome.success, false)
  assert.match(outcome.error!, /cancel/i)
  unchanged(1)
  assert.ok(frames.some(f => f.type === "security.confirmation.resolved" && f.confirmation_id === frame.confirmation_id && !f.approved))
  confirmations.respondFrom(otherId, true, ws)
  assert.equal((await other).approved, true)
})

test("approval then same-turn abort does not persist or retry", { timeout: 5000 }, async () => {
  const controller = new AbortController()
  const requested = prompt()
  const result = call(controller.signal)
  const frame = await getPrompt(requested, result)
  confirmations.respondFrom(frame.confirmation_id, true, ws)
  controller.abort()
  assert.equal((await result).success, false)
  unchanged(1)
})

for (const mode of ["deny", "revoke-selection", "approve"] as const) {
  test(`interactive ${mode}: preserves origin/selection boundary and real persistence`, { timeout: 5000 }, async () => {
    const requested = prompt()
    const result = call()
    const frame = await getPrompt(requested, result)
    assert.equal(confirmations.respondFrom(frame.confirmation_id, true, {} as WebSocket).outcome, "origin_mismatch")
    unchanged(1)
    if (mode === "revoke-selection") tm.update(tid, { active_mcp_server_ids: [] })
    confirmations.respondFrom(frame.confirmation_id, mode !== "deny", ws)
    const outcome = await result
    assert.equal(outcome.success, mode === "approve", outcome.error)
    if (mode === "approve") { persisted(); assert.equal(calls, 2) } else unchanged(1)
  })
}

for (const automatic of [false, true]) {
  test(`pre-abort and cancellation across lazy import prevent expansion (cruise=${automatic})`, { timeout: 5000 }, async () => {
    if (automatic) cruise()
    const controller = new AbortController()
    const result = expand(controller.signal)
    controller.abort() // before the helper's await import continuation
    assert.equal((await result).ok, false)
    assert.equal((await expand(controller.signal)).ok, false)
    assert.equal(confirmations.pendingCount(), 0)
    assert.equal(frames.length, 0)
    unchanged(0)
  })
  test(`cancel after config commit prevents retry without rolling back approval (cruise=${automatic})`, { timeout: 5000 }, async () => {
    if (automatic) cruise()
    const controller = new AbortController()
    onReload = async () => { controller.abort() }
    const requested = prompt()
    const result = call(controller.signal)
    if (!automatic) {
      const frame = await getPrompt(requested, result)
      confirmations.respondFrom(frame.confirmation_id, true, ws)
    }
    const outcome = await result
    assert.equal(outcome.success, false)
    assert.match(outcome.error!, /cancel/i)
    persisted()
    assert.equal(calls, 1)
    assert.equal(confirmations.pendingCount(), 0)
  })
  test(`filesystem roots remain refused (cruise=${automatic})`, async () => {
    if (automatic) cruise()
    assert.equal((await call(undefined, path.parse(root).root)).success, false)
    assert.equal(frames.filter(f => f.type === "security.confirmation.request").length, 0)
    unchanged(1)
  })
}

test("live cruise approval persists the exact directory and retries once without prompting", async () => {
  cruise()
  const outcome = await call()
  assert.equal(outcome.success, true, outcome.error)
  persisted()
  assert.equal(calls, 2)
  assert.equal(frames.filter(f => f.type === "security.confirmation.request").length, 0)
})

test("direct persistence helper rejects a cancelled request", async () => {
  const controller = new AbortController()
  controller.abort()
  assert.equal((await addFilesystemAllowDir("filesystem", offered, controller.signal)).ok, false)
  unchanged(0)
})

test("cancellation during tool re-registration wait prevents retry", { timeout: 5000 }, async () => {
  cruise()
  const controller = new AbortController()
  onReload = () => { setImmediate(() => controller.abort()) }
  const outcome = await call(controller.signal)
  assert.equal(outcome.success, false)
  assert.match(outcome.error!, /cancel/i)
  persisted()
  assert.equal(calls, 1)
})

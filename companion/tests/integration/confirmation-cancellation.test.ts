// #595: real dispatch + confirmation manager, with owned fixtures only.
// Regression: cancellation left prompts/cache live or allowed a late host write.
// Attribution: missing signal plumbing and post-await cancellation checks.
// Protects existing trust/origin/nonce gates without granting new authority.
import "./_security-gates-setup.js"
import test, { before, beforeEach, afterEach, mock } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { WebSocket } from "ws"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { ListToolsRequestSchema, CallToolRequestSchema, ListResourcesRequestSchema,
  ReadResourceRequestSchema, ListPromptsRequestSchema, GetPromptRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import { initDataDir, getConfig, saveConfig } from "../../src/config"
import { createToolExecutor, seedThreadManagerForTests, seedExtensionWsAuthForTests,
  securityConfirmations, getSessionIdForTests } from "../../src/server"
import { executeMcpTool } from "../../src/mcp/dispatch"
import { getMcpManager } from "../../src/mcp/manager"
import { getMcpConfirmCache } from "../../src/mcp/confirm-cache"
import { McpClient } from "../../src/mcp/client"

let frames: any[]
let onFrame: ((frame: any) => void) | undefined
let ws: WebSocket
const fixtures: Array<{ server: Server; client: McpClient }> = []
const roots: string[] = []
before(async () => { await initDataDir() })
beforeEach(() => {
  frames = []
  onFrame = undefined
  ws = { readyState: WebSocket.OPEN, send(raw: string) {
    const frame = JSON.parse(raw)
    frames.push(frame)
    onFrame?.(frame)
  } } as unknown as WebSocket
  seedExtensionWsAuthForTests(ws)
  seedThreadManagerForTests()
  saveConfig({ security: { ...getConfig().security,
    allow_all_schemes: false, auto_approve_dangerous: false, auto_approve_enterprise_tools: false,
  } })
})
afterEach(async () => {
  onFrame = undefined
  securityConfirmations.rejectAll()
  mock.restoreAll()
  const manager = getMcpManager() as any
  for (const { client, server } of fixtures.splice(0)) {
    manager.clients.delete(client.name)
    delete manager.currentConfig.servers[client.name]
    await client.close()
    await server.close()
  }
  manager.reaggregate()
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

function requested() {
  let resolve!: (frame: any) => void
  const promise = new Promise<any>(r => { resolve = r })
  onFrame = frame => { if (frame.type === "security.confirmation.request") resolve(frame) }
  return promise
}
async function awaitPrompt(prompt: Promise<any>, call: Promise<any>) {
  return Promise.race([prompt, call.then(result => {
    throw new Error(`Confirmation not reached: ${JSON.stringify(result)}`)
  })])
}
async function mcp(trust: "manual" | "first-use") {
  let calls = 0
  const server = new Server({ name: "cancel-fixture", version: "1" }, {
    capabilities: { tools: {}, resources: {}, prompts: {} },
  })
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{
    name: "read_value", inputSchema: { type: "object" },
  }] }))
  server.setRequestHandler(CallToolRequestSchema, async () => {
    calls++
    return { content: [{ type: "text", text: "fixture" }] }
  })
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: [{ name: "fixture", uri: "fixture:///read" }] }))
  server.setRequestHandler(ReadResourceRequestSchema, async () => {
    calls++
    return { contents: [{ uri: "fixture:///read", text: "owned fixture" }] }
  })
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: [{ name: "fixture" }] }))
  server.setRequestHandler(GetPromptRequestSchema, async () => {
    calls++
    return { messages: [{ role: "user", content: { type: "text", text: "owned fixture" } }] }
  })
  const [ct, st] = InMemoryTransport.createLinkedPair()
  await server.connect(st)
  const client = new McpClient("cancel-fixture", { transport: "stdio", command: "node", args: [],
    enabled: true, trust_level: trust, security_capabilities: ["read-only"],
  })
  await client.connect(ct)
  const manager = getMcpManager() as any
  manager.clients.set(client.name, client)
  manager.currentConfig ??= { enabled: true, servers: {} }
  manager.currentConfig.servers[client.name] = client.config
  manager.reaggregate()
  fixtures.push({ client, server })
  const thread = seedThreadManagerForTests().create("cancel confirmation")
  const key = { sessionId: thread.id, serverName: client.name, toolName: "read_value" }
  const executor = createToolExecutor(ws)
  const metaSessionId = getSessionIdForTests(ws)!
  return {
    call: (signal?: AbortSignal) => executeMcpTool("mcp__cancel-fixture__read_value", {}, thread.id, ws, Date.now(), signal),
    calls: () => calls,
    approved: () => getMcpConfirmCache().isApproved(key),
    meta: (toolName: string, signal?: AbortSignal) => executor(`cancel-${toolName}`, toolName, {
      server: client.name, uri: "fixture:///read", name: "fixture",
    }, signal),
    metaApproved: (toolName: string) => getMcpConfirmCache().isApproved({ ...key, sessionId: metaSessionId, toolName }),
  }
}

for (const trust of ["manual", "first-use"] as const) {
  test(`MCP ${trust}: abort closes only its prompt; late approval cannot dispatch/cache`, { timeout: 5000 }, async () => {
    const fixture = await mcp(trust)
    const controller = new AbortController()
    const prompt = requested()
    const call = fixture.call(controller.signal)
    const frame = await awaitPrompt(prompt, call)
    let otherId = ""
    const other = securityConfirmations.request(data => {
      if (data.type === "security.confirmation.request") otherId = data.confirmation_id
    }, { toolName: "other", dangerousApis: [], code: "fixture" }, { originWs: ws })
    controller.abort()
    assert.equal(securityConfirmations.pendingCount(), 1)
    assert.equal(securityConfirmations.respondFrom(frame.confirmation_id, true, ws).outcome, "unknown")
    assert.equal((await call).success, false)
    assert.equal(fixture.calls(), 0)
    assert.equal(fixture.approved(), false)
    assert.ok(frames.some(f => f.type === "security.confirmation.resolved" && f.confirmation_id === frame.confirmation_id && !f.approved))
    securityConfirmations.respondFrom(otherId, true, ws)
    assert.equal((await other).approved, true)
  })
}

test("MCP first-use: approval then same-turn abort cannot promote cache", { timeout: 5000 }, async () => {
  const fixture = await mcp("first-use")
  const controller = new AbortController()
  const prompt = requested()
  const call = fixture.call(controller.signal)
  const frame = await awaitPrompt(prompt, call)
  assert.equal(securityConfirmations.respondFrom(frame.confirmation_id, true, ws).outcome, "resolved")
  controller.abort()
  assert.equal((await call).success, false)
  assert.equal(fixture.approved(), false)
  assert.equal(fixture.calls(), 0)
})

test("MCP: pre-abort emits no prompt; live approval still caches and dispatches", { timeout: 5000 }, async () => {
  const fixture = await mcp("first-use")
  const controller = new AbortController()
  controller.abort()
  const cancelled = fixture.call(controller.signal)
  await new Promise<void>(resolve => setImmediate(resolve))
  assert.equal(securityConfirmations.pendingCount(), 0)
  assert.equal((await cancelled).success, false)
  assert.equal(frames.length, 0)
  const prompt = requested()
  const call = fixture.call()
  const frame = await awaitPrompt(prompt, call)
  assert.equal(securityConfirmations.respondFrom(frame.confirmation_id, true, {} as WebSocket).outcome, "origin_mismatch")
  securityConfirmations.respondFrom(frame.confirmation_id, true, ws)
  assert.equal((await call).success, true)
  assert.equal(fixture.approved(), true)
  assert.equal((await fixture.call()).success, true)
  assert.equal(fixture.calls(), 2)
})

// Pi caught that meta tools enter via another server branch but share the same
// first-use cache. Exercise that production branch, not a direct helper call.
for (const [toolName, method] of [
  ["mcp_list_resources", "listResources"],
  ["mcp_read_resource", "readResource"],
  ["mcp_get_prompt", "getPrompt"],
] as const) {
  test(`${toolName}: abort closes prompt and prevents late approval/cache/dispatch`, { timeout: 5000 }, async () => {
    const fixture = await mcp("first-use")
    const dispatch = mock.method(getMcpManager(), method)
    const controller = new AbortController()
    const prompt = requested()
    const call = fixture.meta(toolName, controller.signal)
    const frame = await awaitPrompt(prompt, call)
    controller.abort()
    assert.equal(securityConfirmations.pendingCount(), 0)
    assert.equal(securityConfirmations.respondFrom(frame.confirmation_id, true, ws).outcome, "unknown")
    assert.equal((await call).success, false)
    assert.equal(fixture.metaApproved(toolName), false)
    assert.equal(dispatch.mock.callCount(), 0)
    assert.equal(fixture.calls(), 0)
  })
  test(`${toolName}: same-turn abort after approval still blocks cache/dispatch`, { timeout: 5000 }, async () => {
    const fixture = await mcp("first-use")
    const dispatch = mock.method(getMcpManager(), method)
    const controller = new AbortController()
    const prompt = requested()
    const call = fixture.meta(toolName, controller.signal)
    const frame = await awaitPrompt(prompt, call)
    securityConfirmations.respondFrom(frame.confirmation_id, true, ws)
    controller.abort()
    assert.equal((await call).success, false)
    assert.equal(fixture.metaApproved(toolName), false)
    assert.equal(dispatch.mock.callCount(), 0)
    assert.equal(fixture.calls(), 0)
  })
  test(`${toolName}: pre-abort never prompts; normal approval still dispatches`, { timeout: 5000 }, async () => {
    const fixture = await mcp("first-use")
    const dispatch = mock.method(getMcpManager(), method)
    const controller = new AbortController()
    controller.abort()
    assert.equal((await fixture.meta(toolName, controller.signal)).success, false)
    assert.equal(frames.length, 0)
    const prompt = requested()
    const call = fixture.meta(toolName)
    const frame = await awaitPrompt(prompt, call)
    assert.equal(securityConfirmations.respondFrom(frame.confirmation_id, true, {} as WebSocket).outcome, "origin_mismatch")
    securityConfirmations.respondFrom(frame.confirmation_id, true, ws)
    const result = await call
    assert.equal(result.success, true, result.error)
    assert.equal(dispatch.mock.callCount(), 1)
    assert.equal(fixture.metaApproved(toolName), toolName === "mcp_list_resources")
  })
}

function windowsFixture(hello?: () => Promise<any>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-confirm-cancel-"))
  roots.push(root)
  const source = path.join(root, "source.txt")
  const destination = path.join(root, "moved.txt")
  fs.writeFileSync(source, "owned fixture")
  let writes = 0
  let helloCalls = 0
  mock.method(os, "platform", () => "win32")
  mock.method(require("../../src/host-use/win"), "tryWindowsHello", async () => {
    helloCalls++
    return hello ? hello() : { unavailable: true }
  })
  // No native dialogs, COM, or user filesystem paths, including on Windows CI.
  mock.method(require("../../src/host-use/win/adapter"), "getWinAdapter", () => ({
    validateTargetId: (id: string) => id,
    writeOne: async (_id: string, payload: any) => {
      assert.equal(payload.source_path, source)
      assert.equal(payload.destination, destination)
      writes++
      fs.renameSync(source, destination)
      return { target_id: "win:fs:default:file-source" }
    },
  }))
  saveConfig({ security: { ...getConfig().security,
    allow_all_schemes: true, auto_approve_dangerous: true, auto_approve_enterprise_tools: true,
  } })
  const execute = createToolExecutor(ws)
  return {
    call: (signal?: AbortSignal) => execute("cancel-host-write", "host_write", {
      kind: "move", source_path: source, destination,
    }, signal),
    writes: () => writes,
    helloCalls: () => helloCalls,
    sourceExists: () => fs.existsSync(source),
    destinationExists: () => fs.existsSync(destination),
  }
}

test("Windows fallback: cancellation drains prompt and ignores late valid nonce", { timeout: 5000 }, async () => {
  const fixture = windowsFixture()
  const controller = new AbortController()
  const prompt = requested()
  const call = fixture.call(controller.signal)
  const frame = await awaitPrompt(prompt, call)
  assert.equal(frame.tool_name, "host_write")
  assert.ok(frame.nonce_challenge)
  controller.abort()
  assert.equal(securityConfirmations.pendingCount(), 0)
  assert.equal(securityConfirmations.respondFrom(frame.confirmation_id, true, ws, frame.nonce_challenge).outcome, "unknown")
  assert.equal((await call).success, false)
  assert.equal(fixture.writes(), 0)
  assert.equal(fixture.sourceExists(), true)
  assert.equal(fixture.destinationExists(), false)
})

test("Windows fallback: approval then same-turn cancellation cannot reach writeOne", { timeout: 5000 }, async () => {
  const fixture = windowsFixture()
  const controller = new AbortController()
  const prompt = requested()
  const call = fixture.call(controller.signal)
  const frame = await awaitPrompt(prompt, call)
  assert.equal(securityConfirmations.respondFrom(frame.confirmation_id, true, ws, frame.nonce_challenge).outcome, "resolved")
  controller.abort()
  assert.equal((await call).success, false)
  assert.equal(fixture.writes(), 0)
  assert.equal(fixture.sourceExists(), true)
})

test("Windows fallback: origin and nonce remain required; live approval moves owned fixture", { timeout: 5000 }, async () => {
  const fixture = windowsFixture()
  const prompt = requested()
  const call = fixture.call()
  const frame = await awaitPrompt(prompt, call)
  assert.equal(securityConfirmations.respondFrom(frame.confirmation_id, true, {} as WebSocket, frame.nonce_challenge).outcome, "origin_mismatch")
  assert.equal(securityConfirmations.respondFrom(frame.confirmation_id, true, ws, "wrong").outcome, "nonce_retry")
  assert.equal(fixture.writes(), 0)
  assert.equal(securityConfirmations.respondFrom(frame.confirmation_id, true, ws, frame.nonce_challenge).outcome, "resolved")
  const result = await call
  assert.equal(result.success, true, result.error)
  assert.equal(fixture.writes(), 1)
  assert.equal(fixture.sourceExists(), false)
  assert.equal(fixture.destinationExists(), true)
})

for (const hello of [{ unavailable: true }, { ok: true, nonce: "fixture" }]) {
  test(`Windows: abort while native verification awaits (${JSON.stringify(hello)}) blocks fallback/write`, { timeout: 5000 }, async () => {
    const controller = new AbortController()
    const fixture = windowsFixture(async () => { controller.abort(); return hello })
    const result = await fixture.call(controller.signal)
    assert.equal(result.success, false)
    assert.equal(fixture.writes(), 0)
    assert.equal(securityConfirmations.pendingCount(), 0)
    assert.equal(frames.filter(f => f.type === "security.confirmation.request").length, 0)
  })
}

test("Windows: already cancelled request never starts verification", async () => {
  const fixture = windowsFixture()
  const controller = new AbortController()
  controller.abort()
  assert.equal((await fixture.call(controller.signal)).success, false)
  assert.equal(fixture.helloCalls(), 0)
  assert.equal(fixture.writes(), 0)
})

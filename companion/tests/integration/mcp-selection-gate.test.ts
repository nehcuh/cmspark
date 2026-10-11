import "./_mcp-gate-setup.js"
import test, { before, beforeEach, afterEach, mock } from "node:test"
import assert from "node:assert/strict"
import { WebSocket } from "ws"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import {
  ListToolsRequestSchema, CallToolRequestSchema,
  ListResourcesRequestSchema, ReadResourceRequestSchema,
  ListPromptsRequestSchema, GetPromptRequestSchema,
} from "@modelcontextprotocol/sdk/types.js"
import { initDataDir, saveConfig, getConfig } from "../../src/config"
import { ThreadManager } from "../../src/threads/thread-manager"
import { McpClient } from "../../src/mcp/client"
import { getMcpManager } from "../../src/mcp/manager"
import { bindMcpDispatchRuntime, executeMcpMetaTool, executeMcpTool } from "../../src/mcp/dispatch"

const ws = { readyState: WebSocket.OPEN, send() {} } as unknown as WebSocket
const fixtureServers: Array<{ server: Server; client: McpClient }> = []
let tm: ThreadManager
let confirmationCount: number
let onConfirm: (() => void) | undefined
let toolResponse: (() => any) | undefined
let calls: { tools: number; reads: number; prompts: number }

before(async () => { await initDataDir() })
beforeEach(() => {
  tm = new ThreadManager()
  confirmationCount = 0
  onConfirm = undefined
  toolResponse = undefined
  calls = { tools: 0, reads: 0, prompts: 0 }
  saveConfig({ security: { ...getConfig().security,
    allow_all_schemes: false, auto_approve_dangerous: false, auto_approve_enterprise_tools: false,
  } })
  bindMcpDispatchRuntime({
    getThreadManager: () => tm,
    broadcastToClients: () => {},
    securityConfirmations: {
      request: async () => {
        confirmationCount++
        onConfirm?.()
        return { approved: true, reason: "approved" }
      },
    } as any,
  })
})
afterEach(async () => {
  mock.restoreAll()
  bindMcpDispatchRuntime(null)
  const manager = getMcpManager() as any
  for (const { server, client } of fixtureServers.splice(0)) {
    manager.clients.delete(client.name)
    await client.close()
    await server.close()
  }
  manager.reaggregate()
})

async function server(name: string, trust: "trusted" | "manual" = "trusted") {
  const server = new Server({ name, version: "1" }, {
    capabilities: { tools: {}, resources: {}, prompts: {} },
  })
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{
    name: "read_data", inputSchema: { type: "object" },
  }] }))
  server.setRequestHandler(CallToolRequestSchema, async () => {
    calls.tools++
    if (toolResponse) return toolResponse()
    return { content: [{ type: "text", text: "tool result" }] }
  })
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: [{
    name: "sample", uri: "test:///sample",
  }] }))
  server.setRequestHandler(ReadResourceRequestSchema, async () => {
    calls.reads++
    return { contents: [{ uri: "test:///sample", text: "resource result" }] }
  })
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: [{ name: "sample" }] }))
  server.setRequestHandler(GetPromptRequestSchema, async () => {
    calls.prompts++
    return { messages: [{ role: "user", content: { type: "text", text: "prompt result" } }] }
  })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  const client = new McpClient(name, { transport: "stdio", command: "node", args: [],
    enabled: true, trust_level: trust, security_capabilities: ["read-only"],
  })
  await client.connect(clientTransport)
  const manager = getMcpManager() as any
  manager.clients.set(name, client)
  manager.currentConfig ??= { enabled: true, servers: {} }
  manager.currentConfig.servers[name] = client.config
  manager.reaggregate()
  fixtureServers.push({ server, client })
}

function thread(selected: string[]) {
  const created = tm.create("MCP selection regression")
  tm.update(created.id, { mcp_selection_mode: "manual", active_mcp_server_ids: selected })
  return created.id
}
const metaCalls = [
  ["mcp_list_resources", {}],
  ["mcp_read_resource", { uri: "test:///sample" }],
  ["mcp_get_prompt", { name: "sample" }],
] as const
function call(name: string, threadId: string, serverName = "selected", args: object = {}) {
  const params = { server: serverName, __thread_id: threadId, ...args }
  return name === "namespaced"
    ? executeMcpTool(`mcp__${serverName}__read_data`, params, "connection", ws, Date.now())
    : executeMcpMetaTool(name, params, "connection", ws)
}

for (const [name, args] of metaCalls) {
  test(`${name}: excluded server denied before confirmation; selected server remains usable`, async () => {
    await server("selected")
    await server("excluded")
    const tid = thread(["selected"])
    const denied = await call(name, tid, "excluded", args)
    assert.equal(denied.success, false)
    assert.match(denied.error!, /active selection/)
    assert.equal(confirmationCount, 0)
    assert.deepEqual(calls, { tools: 0, reads: 0, prompts: 0 })
    const allowed = await call(name, tid, "selected", args)
    assert.equal(allowed.success, true, allowed.error)
    assert.equal(confirmationCount, name === "mcp_list_resources" ? 0 : 1)
  })
}

for (const [name, args] of [...metaCalls, ["namespaced", {}] as const]) {
  test(`${name}: selection revoked during confirmation prevents dispatch`, async () => {
    await server("selected", "manual")
    const tid = thread(["selected"])
    onConfirm = () => { tm.update(tid, { active_mcp_server_ids: [] }) }
    const result = await call(name, tid, "selected", args)
    assert.equal(result.success, false)
    assert.match(result.error!, /active selection/)
    assert.equal(confirmationCount, 1)
    assert.deepEqual(calls, { tools: 0, reads: 0, prompts: 0 })
  })
}

test("worker auto mode follows parent's live selection for meta and namespaced tools", async () => {
  await server("selected")
  await server("excluded")
  const parent = thread(["selected"])
  const worker = tm.create("worker")
  tm.update(worker.id, { agent_role: "worker", parent_thread_id: parent } as any)
  for (const name of ["mcp_list_resources", "namespaced"]) {
    assert.equal((await call(name, worker.id, "selected")).success, true)
    const denied = await call(name, worker.id, "excluded")
    assert.equal(denied.success, false)
    assert.match(denied.error!, /active selection/)
    tm.update(parent, { active_mcp_server_ids: [] })
    assert.equal((await call(name, worker.id, "selected")).success, false)
    tm.update(parent, { active_mcp_server_ids: ["selected"] })
  }
  assert.equal(calls.tools, 1)
})

test("worker can narrow parent's selection and cannot widen it with manual or all mode", async () => {
  await server("selected")
  await server("excluded")
  const parent = thread(["selected"])
  const worker = tm.create("worker")
  tm.update(worker.id, { agent_role: "worker", parent_thread_id: parent,
    mcp_selection_mode: "manual", active_mcp_server_ids: ["excluded"],
  } as any)
  assert.equal((await call("mcp_list_resources", worker.id)).success, false)
  assert.equal((await call("mcp_list_resources", worker.id, "excluded")).success, false)
  tm.update(worker.id, { mcp_selection_mode: "all" })
  assert.equal((await call("mcp_list_resources", worker.id, "excluded")).success, false)
})

test("legacy thread-id spelling cannot bypass selection; unbound direct callers remain compatible", async () => {
  await server("selected")
  const tid = thread([])
  const params = { server: "selected", _thread_id: tid }
  assert.equal((await executeMcpMetaTool("mcp_list_resources", params, "connection", ws)).success, false)
  assert.equal((await executeMcpTool("mcp__selected__read_data", params, "connection", ws, Date.now())).success, false)
  assert.equal((await executeMcpMetaTool("mcp_list_resources", { server: "selected" }, "connection", ws)).success, true)
})

test("unknown thread, missing worker parent, ancestry cycles and lookup failures fail closed", async () => {
  await server("selected")
  const worker = tm.create("worker")
  tm.update(worker.id, { agent_role: "worker", parent_thread_id: "missing-parent" } as any)
  for (const tid of ["missing-thread", worker.id]) {
    const result = await call("mcp_list_resources", tid)
    assert.equal(result.success, false)
    assert.match(result.error!, /mcp_selection_unavailable/)
  }
  tm.update(worker.id, { parent_thread_id: worker.id } as any)
  assert.equal((await call("mcp_list_resources", worker.id)).success, false)
  const get = tm.get
  tm.get = () => { throw new Error("storage unavailable") }
  try {
    for (const name of ["mcp_list_resources", "namespaced"]) {
      assert.equal((await call(name, worker.id)).success, false)
    }
  } finally { tm.get = get }
  assert.equal(confirmationCount, 0)
  assert.deepEqual(calls, { tools: 0, reads: 0, prompts: 0 })
})

test("worker's parent selection revoked during read confirmation prevents resource RPC", async () => {
  await server("selected")
  const parent = thread(["selected"])
  const worker = tm.create("worker")
  tm.update(worker.id, { agent_role: "worker", parent_thread_id: parent } as any)
  onConfirm = () => { tm.update(parent, { active_mcp_server_ids: [] }) }
  const result = await call("mcp_read_resource", worker.id, "selected", { uri: "test:///sample" })
  assert.equal(result.success, false)
  assert.equal(confirmationCount, 1)
  assert.equal(calls.reads, 0)
})

test("sessionId fallback enforces selection and keeps its binding when lookup disappears during confirmation", async () => {
  await server("selected", "manual")
  const tid = thread([])
  const params = { server: "selected" }
  for (const name of ["mcp_list_resources", "namespaced"]) {
    const execute = () => name === "namespaced"
      ? executeMcpTool("mcp__selected__read_data", params, tid, ws, Date.now())
      : executeMcpMetaTool(name, params, tid, ws)
    assert.equal((await execute()).success, false)
    tm.update(tid, { active_mcp_server_ids: ["selected"] })
    onConfirm = () => { mock.method(tm, "get", () => undefined) }
    const revoked = await execute()
    assert.equal(revoked.success, false)
    assert.match(revoked.error!, /mcp_selection_unavailable/)
    mock.restoreAll()
    tm.update(tid, { active_mcp_server_ids: [] })
  }
  assert.deepEqual(calls, { tools: 0, reads: 0, prompts: 0 })
})

test("selection revoked during allow-directory confirmation prevents permission expansion", async () => {
  await server("selected")
  const tid = thread(["selected"])
  toolResponse = () => ({ isError: true, content: [{ type: "text", text: "Access denied" }] })
  const expand = require("../../src/mcp/allow-dir-expand") as typeof import("../../src/mcp/allow-dir-expand")
  mock.method(expand, "canOfferAllowDirExpand", () => ({ offer: true, dir: "/fixture" }))
  const add = mock.method(expand, "addFilesystemAllowDir", async () => ({ ok: true }))
  onConfirm = () => { tm.update(tid, { active_mcp_server_ids: [] }) }
  const result = await call("namespaced", tid)
  assert.equal(result.success, false)
  assert.match(result.error!, /active selection/)
  assert.equal(calls.tools, 1)
  assert.equal(confirmationCount, 1)
  assert.equal(add.mock.callCount(), 0)
})

test("selection revoked during server reload prevents the filesystem retry", async () => {
  await server("selected")
  const tid = thread(["selected"])
  toolResponse = () => ({ isError: true, content: [{ type: "text", text: "Access denied" }] })
  const expand = require("../../src/mcp/allow-dir-expand") as typeof import("../../src/mcp/allow-dir-expand")
  mock.method(expand, "canOfferAllowDirExpand", () => ({ offer: true, dir: "/fixture" }))
  const add = mock.method(expand, "addFilesystemAllowDir", async () => {
    tm.update(tid, { active_mcp_server_ids: [] })
    return { ok: true }
  })
  const result = await call("namespaced", tid)
  assert.equal(result.success, false)
  assert.match(result.error!, /active selection/)
  assert.equal(calls.tools, 1)
  assert.equal(confirmationCount, 1)
  assert.equal(add.mock.callCount(), 1)
})

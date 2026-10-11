import test, { before, type TestContext } from "node:test"
import assert from "node:assert/strict"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import { initDataDir } from "../src/config"
import { ThreadManager } from "../src/threads/thread-manager"
import { McpClient } from "../src/mcp/client"
import { getMcpManager } from "../src/mcp/manager"
import { createCooperationPlan, plannedSpawnCheck, bindPlannedWorker, cooperationPlanSnapshot, plannedWorkerMcpError } from "../src/orchestrator/cooperation-plan"
import { computeWorkerWhitelist, spawnWorkerThread } from "../src/orchestrator/spawn"
import { bindCompanionDispatchRuntime, executeCompanionTool } from "../src/tool/companion-dispatch"
import { securityPolicy } from "../src/security-policy"
import { bindMcpDispatchRuntime, executeMcpTool } from "../src/mcp/dispatch"

before(initDataDir)

const name = "mcp__filesystem__read_value"
const task = (required = name) => ({
  id: "inspect", goal: "Read the MCP value", required_tools: [required],
  criteria: [{ id: "evidence", description: "Record the returned value" }],
})

async function setup(t: TestContext) {
  const server = new Server({ name: "filesystem", version: "1" }, { capabilities: { tools: {} } })
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [
    { name: "read_value", inputSchema: { type: "object", properties: {} } },
    { name: "read_other", inputSchema: { type: "object", properties: {} } },
  ] }))
  let toolCalls = 0
  server.setRequestHandler(CallToolRequestSchema, async () => {
    toolCalls++
    return { content: [{ type: "text", text: "value" }] }
  })
  const config = { transport: "stdio" as const, command: "unused", enabled: true, trust_level: "trusted" as const,
    env: { FIXTURE_CREDENTIAL: "not-a-real-credential" } }
  const client = new McpClient("filesystem", config)
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  await client.connect(clientTransport)
  const manager: any = getMcpManager()
  manager.clients.set("filesystem", client)
  manager.currentConfig = { enabled: true, servers: { filesystem: config } }
  manager.reaggregate()
  const tm = new ThreadManager(), parent = tm.create("MCP cooperation contract")
  tm.update(parent.id, { mcp_selection_mode: "manual", active_mcp_server_ids: ["filesystem"] })
  const kicks: Array<{ threadId: string; message: string }> = []
  bindCompanionDispatchRuntime({
    getThreadManager: () => tm, getSkillEngine: () => null as any,
    getCachedTabUrl: () => undefined, getTabUrlCache: () => new Map(), computerTaskAbort: new Map(),
    computerRateLimiter: async () => null as any, getComputerRateLimiterSingleton: () => null,
    securityConfirmations: {} as any, getComputerEstopEnsureOverride: () => null,
    rejectPendingForThread: () => 0, hasPendingForTab: () => false, rejectPendingForTab: () => 0,
  })
  bindMcpDispatchRuntime({ getThreadManager: () => tm, securityConfirmations: {} as any, broadcastToClients: () => {} })
  t.after(async () => {
    bindMcpDispatchRuntime(null)
    manager.clients.delete("filesystem")
    manager.currentConfig = null
    manager.reaggregate()
    await client.close()
    await server.close()
  })
  const plan = () => createCooperationPlan(tm, parent.id, { tasks: [task()] })
  const params = (p: ReturnType<typeof plan>, toolAllow = [name]) => ({
    __thread_id: parent.id, plan_id: p.id, plan_task_id: "inspect", plan_task_attempt: 1,
    goal: task().goal, tool_allow: toolAllow,
  })
  const spawn = async (p: ReturnType<typeof params>) => {
    const token = securityPolicy.issueTokenFor("spawn_worker", p).token
    return executeCompanionTool("spawn_worker", { ...p, security_token: token }, undefined, {
      kickWorkerChat: row => { kicks.push(row) },
    })
  }
  return { tm, parent, manager, client, server, config, plan, params, spawn, kicks, toolCalls: () => toolCalls }
}

test("live MCP requirements persist identity without credentials, spawn, and inherit manual selection", async t => {
  const c = await setup(t)
  c.tm.update(c.parent.id, { tool_whitelist: ["mcp__fs__*"] })
  const plan = c.plan()
  assert.equal(plan.tasks[0].mcp_bindings?.[name].server_name, "filesystem")
  assert.equal(plan.tasks[0].mcp_bindings?.[name].tool_name, "read_value")
  assert.match(plan.tasks[0].mcp_bindings![name].identity, /^[a-f0-9]{64}$/)
  assert.equal(JSON.stringify(plan).includes(c.config.env.FIXTURE_CREDENTIAL), false)
  const reloaded = new ThreadManager()
  assert.deepEqual(reloaded.get(c.parent.id)?.cooperation_plan, plan)
  assert.equal(cooperationPlanSnapshot(reloaded, c.parent.id, () => false)?.tasks[0].required_capabilities_available, true)
  const result = await c.spawn(c.params(plan, ["mcp__*"]))
  assert.equal(result.success, true, result.error)
  assert.equal(c.kicks.length, 1)
  const worker = c.tm.get(c.kicks[0].threadId)!
  assert.deepEqual(worker.active_mcp_server_ids, ["filesystem"])
  assert.equal(worker.mcp_selection_mode, "manual")
  assert.equal(c.tm.isToolAllowed(worker.id, name), true)
  assert.equal(c.tm.isToolAllowed(worker.id, "mcp__other__read_value"), false)
  assert.equal(c.tm.get(c.parent.id)?.cooperation_plan?.tasks[0].attempts.length, 1)
})

test("planning rejects fabricated, disconnected, unselected and unauthorized MCP requirements", async t => {
  const c = await setup(t)
  assert.throws(() => createCooperationPlan(c.tm, c.parent.id, { tasks: [task("mcp__invented__read")] }), /unknown or unavailable/)
  c.tm.update(c.parent.id, { active_mcp_server_ids: [] })
  assert.throws(c.plan, /outside parent selection/)
  c.tm.update(c.parent.id, { active_mcp_server_ids: ["filesystem"], tool_whitelist: ["get_page_text"] })
  assert.throws(c.plan, /parent lacks/)
  c.tm.update(c.parent.id, { tool_whitelist: null })
  await c.client.close()
  assert.throws(c.plan, /unavailable or changing/)
  assert.equal(c.tm.get(c.parent.id)?.cooperation_plan, undefined)
})

test("selection or whitelist revocation after confirmation blocks spawn without consuming an attempt", async t => {
  const c = await setup(t), plan = c.plan(), params = c.params(plan)
  plannedSpawnCheck(c.tm, c.parent.id, params, () => false)
  const token = securityPolicy.issueTokenFor("spawn_worker", params).token
  c.tm.update(c.parent.id, { active_mcp_server_ids: [] })
  assert.equal(cooperationPlanSnapshot(c.tm, c.parent.id, () => false)?.tasks[0].ready, false)
  const result = await executeCompanionTool("spawn_worker", { ...params, security_token: token }, undefined, {
    kickWorkerChat: row => { c.kicks.push(row) },
  })
  assert.equal(result.success, false)
  assert.match(result.error, /outside parent selection/)
  assert.equal(c.kicks.length, 0)
  assert.equal(c.tm.get(c.parent.id)?.cooperation_plan?.tasks[0].attempts.length, 0)
  c.tm.update(c.parent.id, { active_mcp_server_ids: ["filesystem"], tool_whitelist: [] })
  assert.throws(() => plannedSpawnCheck(c.tm, c.parent.id, params, () => false), /lacks required/)
  assert.equal(cooperationPlanSnapshot(c.tm, c.parent.id, () => false)?.tasks[0].required_capabilities_available, false)
})

test("changed aliases, config and schema cannot retarget a persisted MCP requirement", async t => {
  const c = await setup(t), plan = c.plan(), params = c.params(plan)
  const original = c.manager.aggregated.aliases.get(name)
  c.manager.aggregated.aliases.set(name, { ...original, toolName: "read_other" })
  assert.throws(() => plannedSpawnCheck(c.tm, c.parent.id, params, () => false), /changed since planning/)
  c.manager.aggregated.aliases.set(name, original)
  const changed = { ...c.config, command: "different-server" }
  c.manager.currentConfig.servers.filesystem = changed
  assert.throws(() => plannedSpawnCheck(c.tm, c.parent.id, params, () => false), /unavailable or changing/)
  c.client.updateConfig(changed)
  assert.throws(() => plannedSpawnCheck(c.tm, c.parent.id, params, () => false), /changed since planning/)
  c.client.updateConfig(c.config)
  c.manager.currentConfig.servers.filesystem = c.config
  c.manager.aggregated.metas.get(name).inputSchema = { type: "object", properties: { newRequired: { type: "string" } }, required: ["newRequired"] }
  assert.throws(() => plannedSpawnCheck(c.tm, c.parent.id, params, () => false), /changed since planning/)
  const restarted = new ThreadManager()
  assert.equal(cooperationPlanSnapshot(restarted, c.parent.id, () => false)?.tasks[0].required_capabilities_available, false)
})

test("required MCP bindings fail closed when a legacy checkpoint has no identity", async t => {
  const c = await setup(t), plan = c.plan()
  const legacy = { ...plan, tasks: plan.tasks.map(({ mcp_bindings: _binding, ...rest }) => rest) }
  c.tm.update(c.parent.id, { cooperation_plan: legacy })
  assert.throws(() => plannedSpawnCheck(c.tm, c.parent.id, c.params(plan), () => false), /changed since planning/)
})

test("binding rechecks worker restrictions and parent selection immediately before launch", async t => {
  const c = await setup(t), plan = c.plan(), params = c.params(plan)
  const spawned = spawnWorkerThread(c.tm, { parentThreadId: c.parent.id, roleAllow: [name], userConfirmed: true })
  assert.equal(spawned.ok, true)
  if (!spawned.ok) return
  c.tm.update(spawned.worker.id, { active_mcp_server_ids: [] })
  assert.throws(() => bindPlannedWorker(c.tm, c.parent.id, params, spawned.worker.id, () => false), /worker selection/)
  c.tm.update(spawned.worker.id, { active_mcp_server_ids: ["filesystem"], tool_whitelist: ["get_page_text"] })
  assert.throws(() => bindPlannedWorker(c.tm, c.parent.id, params, spawned.worker.id, () => false), /worker lacks/)
  c.tm.update(spawned.worker.id, { tool_whitelist: ["mcp__*"] })
  c.tm.update(c.parent.id, { active_mcp_server_ids: [] })
  assert.throws(() => bindPlannedWorker(c.tm, c.parent.id, params, spawned.worker.id, () => false), /outside parent selection/)
  c.tm.update(c.parent.id, { active_mcp_server_ids: ["filesystem"] })
  assert.equal(bindPlannedWorker(c.tm, c.parent.id, params, spawned.worker.id, () => false).attempt, 1)
})

test("MCP wildcard intersection and denial match dispatch semantics without widening a parent grant", async t => {
  await setup(t)
  assert.deepEqual(computeWorkerWhitelist({ parentWhitelist: ["mcp__fs__*"], roleAllow: [name] }), [name])
  assert.deepEqual(computeWorkerWhitelist({ parentWhitelist: [name], roleAllow: ["mcp__*"] }), [name])
  assert.deepEqual(computeWorkerWhitelist({ parentWhitelist: null, roleAllow: ["mcp__*"], roleDeny: [name] }), ["mcp__filesystem__read_other"])
  assert.deepEqual(computeWorkerWhitelist({ parentWhitelist: null, roleAllow: [name], roleDeny: ["mcp__fs__*"] }), [])
  assert.deepEqual(computeWorkerWhitelist({ parentWhitelist: null, roleAllow: [name, "shell_exec"] }), [name])
})

test("a running planned worker cannot follow a retargeted route or revoked capability", async t => {
  const c = await setup(t), plan = c.plan()
  assert.equal((await c.spawn(c.params(plan))).success, true)
  const workerId = c.kicks[0].threadId
  assert.equal(plannedWorkerMcpError(c.tm, workerId, name), null)
  const original = c.manager.aggregated.aliases.get(name)
  c.manager.aggregated.aliases.set(name, { ...original, toolName: "read_other" })
  assert.match(plannedWorkerMcpError(c.tm, workerId, name)!, /changed since planning/)
  for (const params of [{ __thread_id: workerId }, { _thread_id: workerId }, {}]) {
    const denied = await executeMcpTool(name, params, workerId, {} as any, Date.now())
    assert.equal(denied.success, false)
    assert.match(denied.error!, /changed since planning/)
  }
  assert.equal(c.toolCalls(), 0)
  c.manager.aggregated.aliases.set(name, original)
  c.tm.update(workerId, { tool_whitelist: [] })
  assert.match(plannedWorkerMcpError(c.tm, workerId, name)!, /worker lacks/)
  c.tm.update(workerId, { tool_whitelist: [name] })
  c.tm.update(c.parent.id, { active_mcp_server_ids: [] })
  assert.match(plannedWorkerMcpError(c.tm, workerId, name)!, /outside parent selection/)
})

test("colliding MCP aliases cannot bypass a bound capability after real catalog reordering", async t => {
  const c = await setup(t)
  const plainSchema = { type: "object" as const, properties: {} }
  let catalog = [
    { name: "read_value", inputSchema: plainSchema },
    { name: "read__value", inputSchema: plainSchema },
  ]
  c.server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: catalog }))
  await c.client.refreshTools()
  c.manager.reaggregate()
  const plan = c.plan()
  assert.equal((await c.spawn(c.params(plan, ["mcp__*"]))).success, true)
  const workerId = c.kicks[0].threadId, alternative = `${name}_2`
  const calls: string[] = []
  c.server.setRequestHandler(CallToolRequestSchema, async request => {
    calls.push(request.params.name)
    return { content: [{ type: "text", text: "value" }] }
  })
  // A different alias for the unchanged capability remains subject to its binding.
  catalog.reverse()
  await c.client.refreshTools()
  c.manager.reaggregate()
  assert.deepEqual(c.manager.resolveToolName(alternative), { serverName: "filesystem", toolName: "read_value" })
  assert.match(plannedWorkerMcpError(c.tm, workerId, name)!, /changed since planning/)
  assert.equal(plannedWorkerMcpError(c.tm, workerId, alternative), null)
  const allowed = await executeMcpTool(alternative, { __thread_id: workerId }, workerId, {} as any, Date.now())
  assert.equal(allowed.success, true, allowed.error)
  assert.deepEqual(calls, ["read_value"])
  catalog[1] = { name: "read_value", inputSchema: { type: "object", properties: { changed: { type: "boolean" } } } }
  await c.client.refreshTools()
  c.manager.reaggregate()
  for (const alias of [name, alternative]) {
    assert.match(plannedWorkerMcpError(c.tm, workerId, alias)!, /changed since planning/)
    for (const params of [{ __thread_id: workerId }, { _thread_id: workerId }, {}]) {
      const denied = await executeMcpTool(alias, params, workerId, {} as any, Date.now())
      assert.equal(denied.success, false)
      assert.match(denied.error!, /changed since planning/)
    }
  }
  assert.deepEqual(calls, ["read_value"], "changed capability must never reach the actual SDK server")
})

for (const retargetDuringConfirmation of [false, true]) {
test(`a colliding alias rechecks ${retargetDuringConfirmation ? "its dispatch route" : "its bound identity"} after confirmation`, async t => {
  const c = await setup(t)
  const manual = { ...c.config, trust_level: "manual" as const }
  c.client.updateConfig(manual)
  c.manager.currentConfig.servers.filesystem = manual
  const plainSchema = { type: "object" as const, properties: {} }
  let catalog = [
    { name: "read_value", inputSchema: plainSchema },
    { name: "read__value", inputSchema: plainSchema },
  ]
  c.server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: catalog }))
  await c.client.refreshTools()
  c.manager.reaggregate()
  const plan = c.plan()
  assert.equal((await c.spawn(c.params(plan, ["mcp__*"]))).success, true)
  const workerId = c.kicks[0].threadId, alternative = `${name}_2`
  catalog.reverse()
  await c.client.refreshTools()
  c.manager.reaggregate()
  let confirmations = 0
  bindMcpDispatchRuntime({
    getThreadManager: () => c.tm, broadcastToClients: () => {},
    securityConfirmations: { request: async () => {
      confirmations++
      catalog[1] = { name: "read_value", inputSchema: { type: "object", properties: { changed: { type: "boolean" } } } }
      if (retargetDuringConfirmation) catalog.reverse()
      await c.client.refreshTools()
      c.manager.reaggregate()
      return { approved: true, reason: "approved" }
    } } as any,
  })
  const denied = await executeMcpTool(alternative, { __thread_id: workerId }, workerId, { readyState: 1 } as any, Date.now())
  assert.equal(confirmations, 1, denied.error)
  assert.equal(denied.success, false)
  assert.match(denied.error!, retargetDuringConfirmation ? /route changed during authorization/ : /changed since planning/)
  assert.equal(c.toolCalls(), 0)
})
}

test("MCP identity is checked again after a worker's tool confirmation resolves", async t => {
  const c = await setup(t)
  const manual = { ...c.config, trust_level: "manual" as const }
  c.client.updateConfig(manual)
  c.manager.currentConfig.servers.filesystem = manual
  const plan = c.plan()
  assert.equal((await c.spawn(c.params(plan))).success, true)
  const workerId = c.kicks[0].threadId
  let confirmations = 0
  bindMcpDispatchRuntime({
    getThreadManager: () => c.tm, broadcastToClients: () => {},
    securityConfirmations: { request: async () => {
      confirmations++
      c.manager.aggregated.aliases.set(name, { serverName: "filesystem", toolName: "read_other" })
      return { approved: true, reason: "approved" }
    } } as any,
  })
  const result = await executeMcpTool(name, { __thread_id: workerId }, workerId, { readyState: 1 } as any, Date.now())
  assert.equal(confirmations, 1)
  assert.equal(result.success, false)
  assert.match(result.error!, /changed since planning/)
  assert.equal(c.toolCalls(), 0)
})

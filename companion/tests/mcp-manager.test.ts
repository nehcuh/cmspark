// McpManager unit tests (audit item 5b)
//
// Tests the diff-aware applyConfig logic, restart-policy resolution, and the
// scheduleRestart crash-loop protection. McpClient is mocked (no real stdio
// subprocess spawns); tests observe side effects on the manager's internal
// state (clients Map, deadServers Set, restartAttempts Map).

import test from "node:test"
import assert from "node:assert/strict"
import { EventEmitter } from "events"
import { McpManager } from "../src/mcp/manager.js"
import {
  requiresRestart,
  resolveRestartPolicy,
  DEFAULT_RESTART_POLICY,
} from "../src/mcp/types.js"
import type { McpServerConfig, McpServerMeta, McpConnectionStatus } from "../src/mcp/types.js"

// =============================================================================
// Pure-function tests: requiresRestart + resolveRestartPolicy
// =============================================================================

const stdioCfg = (overrides: Partial<any> = {}): McpServerConfig => ({
  transport: "stdio",
  command: "npx",
  args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
  enabled: true,
  trust_level: "first-use",
  ...overrides,
} as McpServerConfig)

const httpCfg = (overrides: Partial<any> = {}): McpServerConfig => ({
  transport: "http",
  url: "http://127.0.0.1:9999/mcp",
  enabled: true,
  trust_level: "first-use",
  ...overrides,
} as McpServerConfig)

test("requiresRestart: returns false when configs are identical", () => {
  assert.equal(requiresRestart(stdioCfg(), stdioCfg()), false)
})

test("requiresRestart: returns true when transport changes (stdio → http)", () => {
  assert.equal(requiresRestart(stdioCfg(), httpCfg()), true)
})

test("requiresRestart: returns true when stdio command changes", () => {
  const a = stdioCfg({ command: "npx" })
  const b = stdioCfg({ command: "uvx" })
  assert.equal(requiresRestart(a, b), true)
})

test("requiresRestart: returns true when args array changes", () => {
  const a = stdioCfg({ args: ["-y", "pkg-a"] })
  const b = stdioCfg({ args: ["-y", "pkg-b"] })
  assert.equal(requiresRestart(a, b), true)
})

test("requiresRestart: returns true when env changes", () => {
  const a = stdioCfg({ env: { API_KEY: "old" } })
  const b = stdioCfg({ env: { API_KEY: "new" } })
  assert.equal(requiresRestart(a, b), true)
})

test("requiresRestart: returns true when cwd changes", () => {
  const a = stdioCfg({ cwd: "/old" })
  const b = stdioCfg({ cwd: "/new" })
  assert.equal(requiresRestart(a, b), true)
})

test("requiresRestart: returns true when http url changes", () => {
  const a = httpCfg({ url: "http://a:9999/mcp" })
  const b = httpCfg({ url: "http://b:9999/mcp" })
  assert.equal(requiresRestart(a, b), true)
})

test("requiresRestart: returns true when http headers change", () => {
  const a = httpCfg({ headers: { Authorization: "old" } })
  const b = httpCfg({ headers: { Authorization: "new" } })
  assert.equal(requiresRestart(a, b), true)
})

test("requiresRestart: returns FALSE when only trust_level changes (soft update path)", () => {
  // trust_level is NOT in RESTART_FIELD_KEYS — it's a soft update via
  // client.updateConfig without restarting the subprocess.
  const a = stdioCfg({ trust_level: "first-use" })
  const b = stdioCfg({ trust_level: "manual" })
  assert.equal(requiresRestart(a, b), false)
})

test("requiresRestart: returns FALSE when only enabled flag changes (soft update path)", () => {
  const a = stdioCfg({ enabled: true })
  const b = stdioCfg({ enabled: false })
  assert.equal(requiresRestart(a, b), false)
})

test("requiresRestart: returns FALSE when only restart_policy changes (soft update path)", () => {
  const a = stdioCfg({ restart_policy: { max_restarts: 3 } })
  const b = stdioCfg({ restart_policy: { max_restarts: 10 } })
  assert.equal(requiresRestart(a, b), false)
})

test("resolveRestartPolicy: returns DEFAULT when cfg has no override", () => {
  const policy = resolveRestartPolicy(stdioCfg())
  assert.deepEqual(policy, DEFAULT_RESTART_POLICY)
})

test("resolveRestartPolicy: merges cfg.restart_policy over DEFAULT", () => {
  const cfg = stdioCfg({ restart_policy: { max_restarts: 99, backoff_base_ms: 1234 } })
  const policy = resolveRestartPolicy(cfg)
  assert.equal(policy.max_restarts, 99)
  assert.equal(policy.backoff_base_ms, 1234)
  // Unspecified fields fall through to DEFAULT
  assert.equal(policy.backoff_max_ms, DEFAULT_RESTART_POLICY.backoff_max_ms)
})

// =============================================================================
// McpManager.applyConfig diff logic — mocked McpClient
// =============================================================================

/**
 * Fake McpClient that records every method call. Mimics the EventEmitter
 * surface the manager attaches listeners to.
 */
function makeFakeClient(name: string, cfg: McpServerConfig) {
  const ee = Object.assign(new EventEmitter(), {
    name,
    config: cfg,
    connection: { status: "connected" as McpConnectionStatus, restart_count: 0 },
    trustLevel: cfg.trust_level,
    stderrTail: "",
    connect: async () => { ee.connection.status = "connected"; return },
    close: async () => { ee.connection.status = "disconnected" },
    updateConfig: (next: McpServerConfig) => { ee.config = next },
    getMeta: (): McpServerMeta => ({
      name,
      transport: cfg.transport,
      enabled: cfg.enabled,
      trust_level: cfg.trust_level,
      connection: ee.connection,
      capabilities: { tools: true, resources: false, prompts: false },
      tools: [],
      resources: [],
      prompts: [],
      config: { ...cfg },
    }),
    markDead: (reason: string) => {
      ee.connection.status = "dead"
      ;(ee as any)._deadReason = reason
    },
  })
  return ee
}

/**
 * Cast helper — McpManager has private fields we need to manipulate / inspect
 * for the diff tests. Same pattern as item 16 test.
 */
type ManagerInternals = {
  clients: Map<string, any>
  currentConfig: any
  deadServers: Set<string>
  restartAttempts: Map<string, number[]>
  restartTimers: Map<string, NodeJS.Timeout>
  startClient: (name: string, cfg: McpServerConfig) => Promise<void>
  stopClient: (name: string) => Promise<void>
}

function makeManagerWithFakeClient(name: string, cfg: McpServerConfig): { manager: McpManager; fake: any; internals: ManagerInternals } {
  const manager = new McpManager()
  const internals = manager as unknown as ManagerInternals
  const fake = makeFakeClient(name, cfg)
  internals.clients.set(name, fake)
  internals.currentConfig = { enabled: true, servers: { [name]: cfg } }
  return { manager, fake, internals }
}

test("applyConfig: removed server triggers stopClient (client.close called)", async () => {
  const { manager, fake, internals } = makeManagerWithFakeClient("fs", stdioCfg())
  let closeCalled = false
  const originalClose = fake.close
  fake.close = async () => { closeCalled = true; await originalClose() }

  // Apply config WITHOUT fs (server removed)
  await manager.applyConfig({ enabled: true, servers: {} })

  assert.equal(closeCalled, true, "stopClient should call close() on the removed client")
  assert.equal(internals.clients.has("fs"), false, "removed server should be gone from clients Map")
})

test("applyConfig: changed server (requiresRestart) triggers stop + start", async () => {
  const { manager, fake, internals } = makeManagerWithFakeClient("fs", stdioCfg({ command: "npx" }))
  let closeCalled = false
  fake.close = async () => { closeCalled = true; (fake.connection as any).status = "disconnected" }

  // Patch startClient so it doesn't actually try to spawn a subprocess — just
  // inject a fresh fake so the test stays hermetic.
  let startCalled = false
  ;(manager as any).startClient = async (name: string, cfg: McpServerConfig) => {
    startCalled = true
    internals.clients.set(name, makeFakeClient(name, cfg))
  }

  // Apply config with changed command (requiresRestart = true)
  await manager.applyConfig({
    enabled: true,
    servers: { fs: stdioCfg({ command: "uvx" }) },
  })

  assert.equal(closeCalled, true, "stopClient should be called on the old client")
  assert.equal(startCalled, true, "startClient should be called with the new config")
})

test("applyConfig: soft-only change (trust_level) does NOT restart, calls updateConfig", async () => {
  const { manager, fake } = makeManagerWithFakeClient("fs", stdioCfg({ trust_level: "first-use" }))

  let updateConfigCalled = false
  let capturedConfig: McpServerConfig | null = null
  fake.updateConfig = (next: McpServerConfig) => {
    updateConfigCalled = true
    capturedConfig = next
    fake.config = next
  }
  let closeCalled = false
  fake.close = async () => { closeCalled = true }

  // Apply config with only trust_level changed
  await manager.applyConfig({
    enabled: true,
    servers: { fs: stdioCfg({ trust_level: "manual" }) },
  })

  assert.equal(closeCalled, false, "soft-only change must NOT close the client")
  assert.equal(updateConfigCalled, true, "soft-only change must call client.updateConfig")
  assert.equal(capturedConfig!.trust_level, "manual")
})

test("applyConfig: when mcp.enabled=false, stops all clients", async () => {
  const { manager, internals } = makeManagerWithFakeClient("a", stdioCfg())
  // Add a second client
  internals.clients.set("b", makeFakeClient("b", stdioCfg()))
  internals.currentConfig.servers.b = stdioCfg()

  const closed: string[] = []
  for (const [name, client] of internals.clients) {
    client.close = async () => { closed.push(name) }
  }

  await manager.applyConfig({ enabled: false, servers: {} })

  assert.deepEqual(closed.sort(), ["a", "b"], "both clients should be closed when mcp.enabled=false")
  assert.equal(internals.clients.size, 0)
})

// =============================================================================
// scheduleRestart crash-loop protection
// =============================================================================

test("scheduleRestart: marks server dead after max_restarts+1 attempts in the sliding window", async () => {
  // We simulate N prior restart attempts by pre-populating restartAttempts
  // with timestamps inside the sliding window. The next scheduleRestart call
  // should push the count past max_restarts and trigger markDead.
  const cfgWithCap = stdioCfg({ restart_policy: { max_restarts: 3 } })
  const { manager, internals } = makeManagerWithFakeClient("fs", cfgWithCap)

  // Pre-populate 3 attempts (the policy cap) — all within the 5-min window.
  const now = Date.now()
  internals.restartAttempts.set("fs", [now, now, now])

  let markDeadCalled = false
  let markDeadReason = ""
  internals.clients.get("fs")!.markDead = (reason: string) => {
    markDeadCalled = true
    markDeadReason = reason
  }

  // Pass the SAME capped config so resolveRestartPolicy reads max_restarts=3.
  ;(manager as any).scheduleRestart("fs", cfgWithCap, "test failure")

  assert.equal(markDeadCalled, true, "scheduleRestart should mark server dead after exceeding max_restarts")
  assert.match(markDeadReason, /Crashed 4 times/, "markDead reason should reflect the attempt count")
  assert.equal(internals.deadServers.has("fs"), true, "server should be in deadServers after giving up")
})

test("scheduleRestart: bails immediately if server is already dead (no further restart attempts)", async () => {
  const { manager, internals } = makeManagerWithFakeClient("fs", stdioCfg())
  internals.deadServers.add("fs")

  // scheduleRestart should short-circuit. We verify by checking restartAttempts
  // did NOT grow.
  const attemptsBefore = (internals.restartAttempts.get("fs") || []).length
  ;(manager as any).scheduleRestart("fs", stdioCfg(), "test failure")
  const attemptsAfter = (internals.restartAttempts.get("fs") || []).length

  assert.equal(attemptsAfter, attemptsBefore, "scheduleRestart must not record attempts for an already-dead server")
})

test("scheduleRestart: bails if cfg.enabled=false (no point restarting a disabled server)", async () => {
  const { manager, internals } = makeManagerWithFakeClient("fs", stdioCfg({ enabled: false }))
  const attemptsBefore = (internals.restartAttempts.get("fs") || []).length
  ;(manager as any).scheduleRestart("fs", stdioCfg({ enabled: false }), "test failure")
  const attemptsAfter = (internals.restartAttempts.get("fs") || []).length
  assert.equal(attemptsAfter, attemptsBefore, "scheduleRestart must not record attempts for a disabled server")
})

test("McpManager.stopClient clears deadServers + restartAttempts + restartTimers (audit item 16 regression)", async () => {
  // This is a regression test for the bug fixed in item 16 — a name reused
  // after a prior crash must get a fresh restart budget, not inherit the dead
  // state from the previous incarnation.
  const { manager, internals } = makeManagerWithFakeClient("fs", stdioCfg())
  internals.deadServers.add("fs")
  internals.restartAttempts.set("fs", [1, 2, 3, 4, 5])
  // Fake a timer entry too
  const fakeTimer = setTimeout(() => {}, 10000)
  internals.restartTimers.set("fs", fakeTimer)

  await manager.stopClient("fs")

  assert.equal(internals.deadServers.has("fs"), false, "deadServers must be cleared (item 16)")
  assert.equal(internals.restartAttempts.has("fs"), false, "restartAttempts must be cleared (item 16)")
  assert.equal(internals.restartTimers.has("fs"), false, "restartTimers must be cleared")
  clearTimeout(fakeTimer)
})

// =============================================================================
// Signal threading (audit item 17 regression check)
// =============================================================================

test("manager.callTool passes AbortSignal through to client.callTool", async () => {
  // Regression test for item 17: the chat-level abort signal must reach the
  // SDK's RequestOptions.signal. We verify the manager → client hop here; the
  // client → SDK hop is verified at runtime via SDK cancellation behavior.
  const { manager, internals } = makeManagerWithFakeClient("fs", stdioCfg())
  let capturedSignal: AbortSignal | undefined
  internals.clients.get("fs")!.callTool = async (
    _toolName: string,
    _args: Record<string, any>,
    signal?: AbortSignal,
  ) => {
    capturedSignal = signal
    return { content: [], isError: false }
  }

  const controller = new AbortController()
  await manager.callTool({ serverName: "fs", toolName: "read" }, {}, controller.signal)

  assert.equal(capturedSignal, controller.signal,
    "manager.callTool must forward the AbortSignal to client.callTool verbatim")
})

test("manager.callTool works without a signal (back-compat for non-chat callers)", async () => {
  // Some call sites (e.g. mcp.read_resource via executeMcpMetaTool) don't have
  // a chat-level signal. They should still work — signal is optional.
  const { manager, internals } = makeManagerWithFakeClient("fs", stdioCfg())
  internals.clients.get("fs")!.callTool = async () => ({ content: [], isError: false })

  const result = await manager.callTool({ serverName: "fs", toolName: "read" }, {})
  assert.deepEqual(result, { content: [], isError: false })
})

// =============================================================================
// getAggregatedToolsForServers — per-thread MCP selection (audit item 7)
// =============================================================================

test("getAggregatedToolsForServers returns ONLY tools whose server is in the allow-set", () => {
  const { manager, internals } = makeManagerWithFakeClient("fs", stdioCfg())
  // Add a second fake client
  internals.clients.set("git", makeFakeClient("git", stdioCfg()))

  // Stub getMeta on both — inject tools with server-distinct names
  internals.clients.get("fs")!.getMeta = () => ({
    name: "fs", transport: "stdio", enabled: true, trust_level: "first-use",
    connection: { status: "connected", restart_count: 0 },
    capabilities: { tools: true, resources: false, prompts: false },
    tools: [
      { name: "read_file", description: "Read", inputSchema: {}, namespacedName: "" },
      { name: "write_file", description: "Write", inputSchema: {}, namespacedName: "" },
    ],
    resources: [], prompts: [],
    config: stdioCfg() as any,
  })
  internals.clients.get("git")!.getMeta = () => ({
    name: "git", transport: "stdio", enabled: true, trust_level: "first-use",
    connection: { status: "connected", restart_count: 0 },
    capabilities: { tools: true, resources: false, prompts: false },
    tools: [
      { name: "commit", description: "Commit", inputSchema: {}, namespacedName: "" },
    ],
    resources: [], prompts: [],
    config: stdioCfg() as any,
  })
  // Recompute aggregated via reaggregate (private, but we can call it)
  ;(manager as any).reaggregate()

  // Allow-list only "fs"
  const filtered = manager.getAggregatedToolsForServers(new Set(["fs"]))
  assert.equal(filtered.length, 2, "should expose only the 2 fs tools")
  assert.ok(filtered.every((d: any) => d.function.name.startsWith("mcp__fs__")),
    "every tool should be namespaced under fs")

  // Allow-list both
  const both = manager.getAggregatedToolsForServers(new Set(["fs", "git"]))
  assert.equal(both.length, 3, "should expose all 3 tools (2 fs + 1 git)")

  // Empty allow-list → empty result
  assert.equal(manager.getAggregatedToolsForServers(new Set()).length, 0)
})

test("getAggregatedToolsForServers with unknown server name returns empty for that server", () => {
  const { manager, internals } = makeManagerWithFakeClient("fs", stdioCfg())
  internals.clients.get("fs")!.getMeta = () => ({
    name: "fs", transport: "stdio", enabled: true, trust_level: "first-use",
    connection: { status: "connected", restart_count: 0 },
    capabilities: { tools: true, resources: false, prompts: false },
    tools: [{ name: "read", description: "Read", inputSchema: {}, namespacedName: "" }],
    resources: [], prompts: [],
    config: stdioCfg() as any,
  })
  ;(manager as any).reaggregate()

  // Only an unknown server in allow-list → empty
  assert.equal(manager.getAggregatedToolsForServers(new Set(["nonexistent"])).length, 0)
})

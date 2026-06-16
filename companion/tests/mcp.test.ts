// MCP module tests
import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import { McpClient } from "../src/mcp/client.js"
import { McpManager } from "../src/mcp/manager.js"
import {
  aggregateMcpTools,
  buildNamespacedName,
  isMcpNamespaced,
  sanitizeSegment,
} from "../src/mcp/aggregator.js"
import { buildSpawnPath } from "../src/mcp/transport.js"
import type { McpToolMeta } from "../src/mcp/types.js"

// ============================================================================
// Aggregator tests
// ============================================================================

test("sanitizeSegment removes special characters", () => {
  assert.equal(sanitizeSegment("hello world"), "hello_world")
  assert.equal(sanitizeSegment("foo.bar"), "foo_bar")
  // Leading digits are left as-is by the current implementation.
  assert.equal(sanitizeSegment("123abc"), "123abc")
  assert.equal(sanitizeSegment(""), "unnamed")
})

test("buildNamespacedName creates mcp__<server>__<tool> format", () => {
  assert.equal(buildNamespacedName("filesystem", "read_file"), "mcp__filesystem__read_file")
})

test("isMcpNamespaced detects namespaced tools", () => {
  assert.equal(isMcpNamespaced("mcp__filesystem__read_file"), true)
  assert.equal(isMcpNamespaced("read_file"), false)
})

test("aggregateMcpTools skips disconnected clients", () => {
  const fakeClient = {
    name: "filesystem",
    connection: { status: "disconnected", restart_count: 0 },
    config: { enabled: true, trust_level: "first-use" as const, transport: "stdio" as const, command: "echo" },
    getMeta: () => ({
      name: "filesystem",
      transport: "stdio" as const,
      enabled: true,
      trust_level: "first-use" as const,
      connection: { status: "disconnected", restart_count: 0 },
      capabilities: { tools: true, resources: false, prompts: false },
      tools: [{ name: "read_file", namespacedName: "", description: "Read file", inputSchema: {} }],
      resources: [],
      prompts: [],
      config: { enabled: true, trust_level: "first-use" as const, transport: "stdio" as const, command: "echo" },
    }),
  } as unknown as InstanceType<typeof McpClient>

  const result = aggregateMcpTools([fakeClient])
  assert.equal(result.definitions.length, 0)
})

test("aggregateMcpTools exposes tools from connected clients", () => {
  const fakeClient = {
    name: "filesystem",
    connection: { status: "connected", restart_count: 0 },
    config: { enabled: true, trust_level: "first-use" as const, transport: "stdio" as const, command: "echo" },
    getMeta: () => ({
      name: "filesystem",
      transport: "stdio" as const,
      enabled: true,
      trust_level: "first-use" as const,
      connection: { status: "connected", restart_count: 0 },
      capabilities: { tools: true, resources: false, prompts: false },
      tools: [{ name: "read_file", namespacedName: "", description: "Read a file", inputSchema: { type: "object", properties: {} } }],
      resources: [],
      prompts: [],
      config: { enabled: true, trust_level: "first-use" as const, transport: "stdio" as const, command: "echo" },
    }),
  } as unknown as InstanceType<typeof McpClient>

  const result = aggregateMcpTools([fakeClient])
  assert.equal(result.definitions.length, 1)
  assert.equal(result.definitions[0].function.name, "mcp__filesystem__read_file")
  assert.equal(result.aliases.get("mcp__filesystem__read_file")?.toolName, "read_file")
})

// ============================================================================
// McpClient capability-gating tests
// ============================================================================

test("McpClient readResource throws helpful error when server lacks resources", async () => {
  // Construct a client and mock the connection/capabilities state.
  const client = new McpClient("filesystem", {
    transport: "stdio",
    command: "echo",
    enabled: true,
    trust_level: "first-use",
  })

  // Force internal state to simulate a connected server that only supports tools.
  ;(client as any).client = {} as any
  ;(client as any)._capabilities = { tools: true, resources: false, prompts: false }
  ;(client as any)._toolsCache = [
    { name: "read_file", description: "Read file", inputSchema: {} },
    { name: "list_directory", description: "List dir", inputSchema: {} },
  ] as McpToolMeta[]

  await assert.rejects(
    () => client.readResource("file:///some/path"),
    /does not advertise the resources capability/,
  )

  try {
    await client.readResource("file:///some/path")
  } catch (err: any) {
    assert.match(err.message, /read_file/)
    assert.match(err.message, /list_directory/)
    assert.match(err.message, /mcp__filesystem__read_file/)
    assert.match(err.message, /mcp__filesystem__list_directory/)
  }
})

test("McpClient listResources throws helpful error when server lacks resources", async () => {
  const client = new McpClient("filesystem", {
    transport: "stdio",
    command: "echo",
    enabled: true,
    trust_level: "first-use",
  })

  ;(client as any)._capabilities = { tools: true, resources: false, prompts: false }
  ;(client as any)._toolsCache = [
    { name: "read_file", description: "Read file", inputSchema: {} },
    { name: "list_directory", description: "List dir", inputSchema: {} },
  ] as McpToolMeta[]

  await assert.rejects(
    () => client.listResources(),
    /does not advertise the resources capability/,
  )

  try {
    await client.listResources()
  } catch (err: any) {
    assert.match(err.message, /mcp__filesystem__read_file/)
    assert.match(err.message, /mcp__filesystem__list_directory/)
  }
})

// ============================================================================
// Integration: official filesystem server is tools-only
// ============================================================================

test("McpClient connects to official filesystem server and reports tools-only capabilities", async () => {
  const client = new McpClient("filesystem", {
    transport: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/Users/chenhu/Projects/cmspark"],
    enabled: true,
    trust_level: "first-use",
    roots: [{ uri: "file:///Users/chenhu/Projects/cmspark" }],
  })

  await client.connect()
  try {
    const meta = client.getMeta()
    assert.equal(meta.capabilities.tools, true)
    assert.equal(meta.capabilities.resources, false)
    assert.ok(meta.tools.length > 0, "filesystem server should expose tools")
    assert.ok(
      meta.tools.some((t) => t.name === "read_text_file"),
      "filesystem server should expose read_text_file tool",
    )

    await assert.rejects(
      () => client.listResources(),
      /does not advertise the resources capability/,
      "official filesystem server does not support resources",
    )
  } finally {
    await client.close().catch(() => {})
  }
})

// ============================================================================
// PATH resolution for stdio transports
// ============================================================================

test("buildSpawnPath includes the running node's bin directory so npx is findable", () => {
  const p = buildSpawnPath()
  const segments = p.split(path.delimiter)
  // The directory of the running node binary (which holds npx/npm) must be present.
  const nodeBin = path.dirname(process.execPath)
  assert.ok(
    segments.includes(nodeBin),
    `buildSpawnPath should include node's bin dir (${nodeBin}); got: ${p}`,
  )
})

test("buildSpawnPath fills in common macOS/Linux locations when PATH is stripped", () => {
  const saved = process.env.PATH
  try {
    // Simulate launchd / GUI launch: minimal PATH without nvm/homebrew.
    process.env.PATH = "/usr/bin:/bin"
    const p = buildSpawnPath()
    const segments = p.split(path.delimiter)
    assert.ok(segments.includes("/usr/bin"), "should preserve existing /usr/bin")
    assert.ok(segments.includes("/usr/local/bin"), "should add /usr/local/bin fallback")
    assert.ok(
      segments.includes(path.dirname(process.execPath)),
      "should prepend the running node's bin dir even when PATH lacks it",
    )
  } finally {
    process.env.PATH = saved
  }
})

// ============================================================================
// McpManager state cleanup tests (audit item 16)
// ============================================================================

test("McpManager.stopClient clears deadServers so a reused server name can restart", async () => {
  const manager = new McpManager()
  const internal = manager as unknown as {
    deadServers: Set<string>
    restartAttempts: Map<string, number[]>
    restartTimers: Map<string, NodeJS.Timeout>
  }

  // Simulate prior crash-loop detection: server hit the max_restarts cap and was
  // marked permanently dead, with restart history populated by scheduleRestart.
  internal.deadServers.add("reused-name")
  internal.restartAttempts.set("reused-name", [1, 2, 3, 4, 5, 6])

  // stopClient must clear ALL per-name state, even when no live client is in the map
  // (the common case: server was marked dead without ever successfully connecting).
  await manager.stopClient("reused-name")

  assert.equal(
    internal.deadServers.has("reused-name"),
    false,
    "deadServers must be cleared so scheduleRestart does not bail on the first new failure when the name is reused",
  )
  assert.equal(
    internal.restartAttempts.has("reused-name"),
    false,
    "restartAttempts must be cleared so the new server gets a fresh sliding-window restart budget",
  )
  assert.equal(
    internal.restartTimers.has("reused-name"),
    false,
    "restartTimers must be cleared (already pre-existing behavior, asserting for completeness)",
  )
})

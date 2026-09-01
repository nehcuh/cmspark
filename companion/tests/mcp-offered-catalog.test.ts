// B3 / #268: offered-catalog gate.
//
// listen-first can snapshot an empty MCP catalog on the first chat.create while
// rule 10 still names mcp__filesystem__*. executeMcpTool used live resolveToolName,
// so an invented mcp__filesystem__read_text_file after reaggregate would home-read
// with no confirm (default filesystem is trusted; reads skip L2).
//
// Dispatch of a namespaced tool that was NOT in this-turn offered set must fail
// with tool_not_offered even if getMcpManager().resolveToolName would succeed.

import test, { afterEach } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { WebSocket } from "ws"
import { getMcpManager } from "../src/mcp"
import {
  bindMcpDispatchRuntime,
  executeMcpTool,
  gateUnofferedMcpTool,
} from "../src/mcp/dispatch"
import type { McpClient } from "../src/mcp/client"
import type { McpServerConfig, McpToolMeta } from "../src/mcp/types"

const TOOL = "mcp__filesystem__read_text_file"
const HOME_PATH = path.join(os.homedir(), ".cmspark-agent", "config.json")

afterEach(() => {
  bindMcpDispatchRuntime(null)
  const manager: any = getMcpManager()
  manager.clients?.delete?.("filesystem")
  manager.reaggregate?.()
})

function fakeWs(): WebSocket {
  return { readyState: 1, send() {} } as unknown as WebSocket
}

function injectConnectedFilesystem(callToolHits: { n: number; lastArgs?: unknown }): () => void {
  const manager: any = getMcpManager()
  const tools: McpToolMeta[] = [
    {
      name: "read_text_file",
      namespacedName: TOOL,
      description: "Read a text file",
      inputSchema: { type: "object", properties: { path: { type: "string" } } },
    },
  ]
  const config: McpServerConfig = {
    transport: "stdio",
    command: "node",
    args: [],
    enabled: true,
    trust_level: "trusted",
  }
  const client = {
    name: "filesystem",
    connection: { status: "connected", restart_count: 0 },
    config,
    get trustLevel() {
      return "trusted" as const
    },
    tools,
    getMeta: () => ({
      name: "filesystem",
      transport: "stdio" as const,
      enabled: true,
      trust_level: "trusted" as const,
      connection: { status: "connected" as const, restart_count: 0 },
      capabilities: { tools: true, resources: false, prompts: false },
      tools,
      resources: [],
      prompts: [],
      config,
    }),
    callTool: async (toolName: string, args: unknown) => {
      callToolHits.n += 1
      callToolHits.lastArgs = args
      return {
        content: [{ type: "text", text: `HOME_READ:${toolName}:${String((args as any)?.path || "")}` }],
        isError: false,
      }
    },
  }
  manager.clients.set("filesystem", client as unknown as McpClient)
  manager.reaggregate()
  return () => {
    manager.clients.delete("filesystem")
    manager.reaggregate()
  }
}

test("adapter.ts snapshots offered names after filterToolsForSurface and gates mcp__", () => {
  const candidates = [
    path.join(__dirname, "..", "..", "src", "llm", "adapter.ts"),
    path.join(process.cwd(), "src", "llm", "adapter.ts"),
    path.join(process.cwd(), "companion", "src", "llm", "adapter.ts"),
  ]
  const srcPath = candidates.find((p) => fs.existsSync(p))
  assert.ok(srcPath, "missing adapter.ts")
  const src = fs.readFileSync(srcPath!, "utf8")
  const idxFilter = src.indexOf("filterToolsForSurface(tools")
  assert.ok(idxFilter >= 0, "adapter must filter tools for surface")
  const afterFilter = src.slice(idxFilter)
  assert.ok(afterFilter.includes("offeredToolNames"), "offered snapshot must follow filterToolsForSurface")
  assert.ok(
    afterFilter.includes("gateUnofferedMcpTool"),
    "gateUnofferedMcpTool must wrap execute after the snapshot",
  )
})

test("gateUnofferedMcpTool: mcp__ missing from snapshot → tool_not_offered", () => {
  const empty = new Set<string>()
  const blocked = gateUnofferedMcpTool(TOOL, empty)
  assert.equal(blocked?.success, false)
  assert.match(blocked?.error || "", /tool_not_offered/)

  const offered = new Set([TOOL])
  assert.equal(gateUnofferedMcpTool(TOOL, offered), null)
  assert.equal(gateUnofferedMcpTool(TOOL, undefined), null)
  assert.equal(gateUnofferedMcpTool("list_tabs", empty), null)
})

test("executeMcpTool: unoffered mcp__filesystem__read_text_file is tool_not_offered even if resolveToolName succeeds", async () => {
  const hits = { n: 0 }
  const cleanup = injectConnectedFilesystem(hits)
  bindMcpDispatchRuntime({
    getThreadManager: () => null,
    securityConfirmations: {} as any,
    broadcastToClients: () => {},
  })

  try {
    const route = getMcpManager().resolveToolName(TOOL)
    assert.ok(route, "resolveToolName must succeed after filesystem connected + reaggregate")
    assert.equal(route?.serverName, "filesystem")
    assert.equal(route?.toolName, "read_text_file")

    const offeredThisTurn = new Set<string>() // chat.create snapshotted an empty MCP catalog
    const result = await executeMcpTool(
      TOOL,
      { path: HOME_PATH },
      "sess-offered-catalog",
      fakeWs(),
      Date.now(),
      undefined,
      offeredThisTurn,
    )

    assert.equal(result.success, false, `expected gate deny, got: ${JSON.stringify(result)}`)
    assert.match(result.error || "", /tool_not_offered/)
    assert.doesNotMatch(result.error || "", /HOME_READ/)
    assert.equal(hits.n, 0, "must not callTool / home-read when not offered this turn")
  } finally {
    cleanup()
  }
})

test("executeMcpTool: offered mcp__filesystem__read_text_file may resolve (not tool_not_offered)", async () => {
  const hits = { n: 0 }
  const cleanup = injectConnectedFilesystem(hits)
  bindMcpDispatchRuntime({
    getThreadManager: () => null,
    securityConfirmations: {} as any,
    broadcastToClients: () => {},
  })
  try {
    const result = await executeMcpTool(
      TOOL,
      { path: HOME_PATH },
      "sess-offered-ok",
      fakeWs(),
      Date.now(),
      undefined,
      new Set([TOOL]),
    )
    assert.notEqual(result.error && /tool_not_offered/.test(result.error), true)
    assert.ok(hits.n >= 1, "offered tool may reach callTool")
  } finally {
    cleanup()
  }
})

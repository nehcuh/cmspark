import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { runInNewContext } from "node:vm"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js"
import { MCP_FIXTURE_SOURCE, MCP_FIXTURE_SOURCE_SHA256 } from "./sources"

export const ORIGINAL_GUIDE = "Original CUA initialization guide."
export function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

/** Actual upstream payload expression, with only its branch-selector variables supplied. */
export async function upstreamElicitation(code = "approval-native"): Promise<any> {
  assert.equal(createHash("sha256").update(MCP_FIXTURE_SOURCE).digest("hex"), MCP_FIXTURE_SOURCE_SHA256)
  const start = MCP_FIXTURE_SOURCE.indexOf("const decision = await server.elicitInput(") + "const decision = await server.elicitInput(".length
  const end = MCP_FIXTURE_SOURCE.indexOf("\n    });", start)
  assert.ok(start > 0 && end > start)
  return await runInNewContext(`(${MCP_FIXTURE_SOURCE.slice(start, end)}\n})`, {
    args: { code }, browser: false, otherEmpty: false, form: code === "approval-form", native: code.startsWith("approval-native"), piOrigin: false, origin: "http://127.0.0.1:8080",
  })
}

export async function mcpFixture(options: {
  instructions?: string
  omitTool?: string
  onCall?: (params: any) => Promise<CallToolResult | undefined>
} = {}) {
  assert.equal(createHash("sha256").update(MCP_FIXTURE_SOURCE).digest("hex"), MCP_FIXTURE_SOURCE_SHA256)
  assert.ok(MCP_FIXTURE_SOURCE.includes(`instructions: '${ORIGINAL_GUIDE}'`))
  const catalogStart = MCP_FIXTURE_SOURCE.indexOf("server.setRequestHandler(ListToolsRequestSchema, async () => (") + "server.setRequestHandler(ListToolsRequestSchema, async () => (".length
  const catalogEnd = MCP_FIXTURE_SOURCE.indexOf("));\nserver.setRequestHandler(CallToolRequestSchema", catalogStart)
  assert.ok(catalogStart > 0 && catalogEnd > catalogStart)
  const catalog = JSON.parse(JSON.stringify(runInNewContext(`(${MCP_FIXTURE_SOURCE.slice(catalogStart, catalogEnd)})`)))
  const server = new Server({ name: "original-cua-contract-fixture", version: "1" }, {
    capabilities: { tools: {} }, instructions: options.instructions ?? ORIGINAL_GUIDE,
  })
  const calls: any[] = []
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: catalog.tools.filter((tool: any) => tool.name !== options.omitTool) }))
  server.setRequestHandler(CallToolRequestSchema, async request => {
    const params = structuredClone(request.params)
    calls.push(params)
    const overridden = await options.onCall?.(params)
    if (overridden) return overridden
    const { name, arguments: args } = params
    if (name === "js" && typeof args?.code === "string" && args.code.startsWith("approval-")) {
      const decision = await server.elicitInput(await upstreamElicitation(args.code))
      return { content: [{ type: "text", text: JSON.stringify(decision) }] }
    }
    return { content: [{ type: "text", text: name === "js" ? String(args?.code) : name }] }
  })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  return { transport: clientTransport, calls, close: () => server.close() }
}

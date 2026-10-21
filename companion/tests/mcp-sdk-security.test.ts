import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import path from "node:path"
import vm from "node:vm"
import ts from "typescript"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { ReadBuffer, serializeMessage } from "@modelcontextprotocol/sdk/shared/stdio.js"
import { CallToolRequestSchema, ListToolsRequestSchema, JSONRPCMessageSchema } from "@modelcontextprotocol/sdk/types.js"

// Execute the actual application HTTP constructor branch with the real installed
// SDK. The omitted imports belong only to the unexecuted stdio branch; no logger,
// user configuration, process environment or configured MCP server is imported.
function actualHttpTransport(): StreamableHTTPClientTransport {
  const file = path.resolve(__dirname, "../../src/mcp/transport.ts")
  const text = fs.readFileSync(file, "utf8")
  const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  const nodes = ast.statements.filter((n): n is ts.FunctionDeclaration => ts.isFunctionDeclaration(n) && n.name?.text === "createTransport")
  assert.equal(nodes.length, 1)
  const output = ts.transpileModule(nodes[0].getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  const exports: Record<string, any> = {}
  vm.runInNewContext(output, { exports, URL, StreamableHTTPClientTransport })
  return exports.createTransport({ transport: "http", url: "https://owned.invalid/mcp", headers: { "X-API-Key": "owned_private_header" } })
}

// Controlled Fetch boundary implements only the redirect behavior exercised here:
// automatic default-follow vs manual response. It sends nothing on a real socket.
// The SDK itself must request manual responses and enforce same-origin traversal.
async function redirectedCall(status: 307 | 308, sameOrigin: boolean) {
  const original = globalThis.fetch
  const requests: Array<{ origin: string; privateHeader: boolean; privateBody: boolean; redirect: RequestInit["redirect"] }> = []
  const target = sameOrigin ? "https://owned.invalid/final" : "https://foreign.invalid/final"
  let initialized = false
  const reply = (id: number) => new Response(JSON.stringify({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: "owned response" }] } }), { status: 200, headers: { "Content-Type": "application/json" } })
  const record = (url: string | URL | Request, init: RequestInit | undefined) => {
    const endpoint = new URL(typeof url === "string" || url instanceof URL ? String(url) : url.url)
    const headers = new Headers(init?.headers)
    requests.push({ origin: endpoint.origin, privateHeader: headers.get("X-API-Key") === "owned_private_header", privateBody: typeof init?.body === "string" && init.body.includes("owned_private_body"), redirect: init?.redirect })
    return endpoint
  }
  globalThis.fetch = async (url, init) => {
    const endpoint = record(url, init)
    if (init?.method === "GET") return new Response(null, { status: 405 })
    const message = JSON.parse(String(init?.body))
    if (!initialized) {
      initialized = true
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "owned-fetch-fixture", version: "1" } } }), { status: 200, headers: { "Content-Type": "application/json", "Mcp-Session-Id": "owned_session" } })
    }
    if (endpoint.pathname === "/final") return reply(message.id)
    if (init?.redirect === "manual") return new Response(null, { status, headers: { Location: target } })
    // Model Fetch's default 307/308 follow preserving method/body and custom
    // headers. This is a test transport boundary, not a real disclosure claim.
    record(target, init)
    return reply(message.id)
  }
  const transport = actualHttpTransport()
  transport.onerror = () => {}
  let rejected = false
  try {
    await transport.start()
    await transport.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "owned", version: "1" } } })
    try { await transport.send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "owned", arguments: { value: "owned_private_body" } } }) } catch { rejected = true }
    return { requests, rejected, session: transport.sessionId }
  } finally { await transport.close(); globalThis.fetch = original }
}

for (const status of [307, 308] as const) test(`installed SDK and actual HTTP factory reject cross-origin ${status} without resending private fields`, async () => {
  const result = await redirectedCall(status, false)
  assert.equal(result.requests.filter(x => x.origin === "https://foreign.invalid").length, 0)
  assert.equal(result.rejected, true)
  assert.equal(result.session, "owned_session")
  assert.equal(result.requests.some(x => x.privateHeader && x.privateBody), true, "the original owned request really carries the synthetic fields")
})
test("installed SDK preserves same-origin redirect request/body and normal session handling", async () => {
  const result = await redirectedCall(307, true)
  assert.equal(result.rejected, false)
  assert.equal(result.requests.filter(x => x.origin === "https://foreign.invalid").length, 0)
  assert.equal(result.requests.filter(x => x.privateHeader && x.privateBody).length, 2)
  assert.equal(result.session, "owned_session")
})
test("installed SDK client and server preserve initialize/list/call/close over memory-only transports", async () => {
  const [a, b] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: "owned-client", version: "1" })
  const server = new Server({ name: "owned-peer", version: "1" }, { capabilities: { tools: {} } })
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{ name: "owned_echo", inputSchema: { type: "object" as const } }] }))
  server.setRequestHandler(CallToolRequestSchema, async request => ({ content: [{ type: "text" as const, text: String(request.params.arguments?.value) }] }))
  try {
    await server.connect(b); await client.connect(a)
    assert.equal((await client.listTools()).tools[0].name, "owned_echo")
    const result = await client.callTool({ name: "owned_echo", arguments: { value: "中文 owned" } })
    assert.deepEqual(result.content, [{ type: "text", text: "中文 owned" }])
  } finally { await client.close(); await server.close() }
})
test("installed shared stdio framing preserves split UTF-8 and rejects malformed JSON", () => {
  const message = JSONRPCMessageSchema.parse({ jsonrpc: "2.0", id: 1, method: "owned", params: { value: "中文" } })
  const bytes = Buffer.from(serializeMessage(message)), reader = new ReadBuffer()
  const cut = bytes.indexOf(Buffer.from("中文")) + 1
  reader.append(bytes.subarray(0, cut)); assert.equal(reader.readMessage(), null)
  reader.append(bytes.subarray(cut)); assert.deepEqual(reader.readMessage(), message)
  reader.append(Buffer.from("not JSON\n")); assert.throws(() => reader.readMessage())
})

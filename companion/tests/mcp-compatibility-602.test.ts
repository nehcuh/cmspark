import test from "node:test"
import assert from "node:assert/strict"
import { once } from "node:events"
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { ListToolsRequestSchema, ListResourcesRequestSchema, ListPromptsRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import { buildMcpStdioEnv, createTransport } from "../src/mcp/transport"
import { McpClient } from "../src/mcp/client"
import { McpManager } from "../src/mcp/manager"

test("MCP Windows system environment is inherited without unrelated ambient secrets", () => {
  const values = { SYSTEMDRIVE: "C:", PROCESSOR_ARCHITECTURE: "AMD64", CMSPARK_602_SECRET: "owned-test-secret" }
  const saved = Object.fromEntries(Object.keys(values).map(k => [k, process.env[k]]))
  try {
    Object.assign(process.env, values)
    const env = buildMcpStdioEnv()
    assert.equal(env.SYSTEMDRIVE, "C:")
    assert.equal(env.PROCESSOR_ARCHITECTURE, "AMD64")
    assert.equal(env.CMSPARK_602_SECRET, undefined)
    assert.equal(buildMcpStdioEnv({ SYSTEMDRIVE: "D:" }).SYSTEMDRIVE, "D:")
    assert.throws(() => buildMcpStdioEnv({ NODE_OPTIONS: "--require ./owned" }), /loader key/)
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v }
  }
})

test("native Windows MCP child receives system drive and architecture", { skip: process.platform !== "win32", timeout: 10000 }, async () => {
  assert.ok(process.env.SYSTEMDRIVE)
  assert.ok(process.env.PROCESSOR_ARCHITECTURE)
  const transport = createTransport({ transport: "stdio", enabled: true, trust_level: "manual", command: process.execPath,
    args: ["-e", "console.log(JSON.stringify({jsonrpc:'2.0',id:1,result:{drive:process.env.SYSTEMDRIVE,arch:process.env.PROCESSOR_ARCHITECTURE}}))"],
  })
  const messages: any[] = []
  const closed = new Promise<void>(resolve => { transport.onclose = resolve })
  transport.onmessage = message => messages.push(message)
  try {
    await transport.start(); await closed
    assert.equal(messages.length, 1)
    assert.deepEqual(messages[0].result, { drive: process.env.SYSTEMDRIVE, arch: process.env.PROCESSOR_ARCHITECTURE })
  } finally { await transport.close() }
})

for (const failed of ["resources", "prompts"] as const) {
  test(`authorization readiness distinguishes failed ${failed} catalog`, async t => {
    const manager = new McpManager()
    const server = new Server({ name: "owned-602", version: "1" }, { capabilities: { tools: {}, resources: {}, prompts: {} } })
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{ name: "read_value", inputSchema: { type: "object" } }] }))
    server.setRequestHandler(ListResourcesRequestSchema, async () => {
      if (failed === "resources") throw new Error("owned resources unavailable")
      return { resources: [] }
    })
    server.setRequestHandler(ListPromptsRequestSchema, async () => {
      if (failed === "prompts") throw new Error("owned prompts unavailable")
      return { prompts: [] }
    })
    const connect = McpClient.prototype.connect
    t.mock.method(McpClient.prototype, "connect", async function(this: McpClient) {
      const [ct, st] = InMemoryTransport.createLinkedPair()
      await server.connect(st); await connect.call(this, ct)
    })
    try {
      await manager.start({ enabled: true, servers: { owned: { transport: "stdio", command: "owned", enabled: true, trust_level: "first-use" } } })
      if (failed === "resources") assert.ok(await manager.waitForServerReady("owned"))
      else await assert.rejects(manager.waitForServerReady("owned"), /catalog discovery failed/)
    } finally { await manager.shutdown(); await server.close() }
  })
}

for (const resume of [true, false]) {
  test(`natural stdio exit ${resume ? "drains a queued final response" : "bounds a stalled stdout drain"}`, { timeout: 10000 }, async t => {
    const text = "final-response-".repeat(100)
    const transport = createTransport({ transport: "stdio", enabled: true, trust_level: "manual", command: process.execPath,
      args: ["-e", `process.stdin.once('data',()=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:1,result:{text:${JSON.stringify(text)}}})+'\\n',()=>process.exit(0)));setTimeout(()=>process.exit(2),5000)`],
    })
    const messages: any[] = []
    let closeCount = 0
    const closed = new Promise<void>(resolve => { transport.onclose = () => { closeCount++; resolve() } })
    transport.onmessage = message => messages.push(message)
    try {
      await transport.start()
      const child = (transport as any).child
      const resumeOutput = child.stdout.resume.bind(child.stdout)
      // Node also resumes child stdout during exit cleanup; hold that resumption
      // to exercise the exit-before-data ordering on every supported platform.
      t.mock.method(child.stdout, "resume", () => child.stdout)
      child.stdout.pause() // Hold queued bytes until AFTER root exit, deterministically.
      const exited = once(child, "exit")
      await transport.send({ jsonrpc: "2.0", id: 1, method: "owned" })
      await exited
      assert.equal(child.exitCode, 0)
      const duplicateClose = transport.close()
      if (resume) {
        await new Promise(resolve => setTimeout(resolve, 30))
        resumeOutput()
      }
      await closed
      await duplicateClose
      if (resume) assert.deepEqual(messages.map(message => message.result.text), [text])
      assert.equal(closeCount, 1)
      await assert.rejects(transport.send({ jsonrpc: "2.0", id: 2, method: "owned" }), /not connected/)
    } finally { await transport.close() }
  })
}

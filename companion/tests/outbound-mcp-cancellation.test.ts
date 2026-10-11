import "./_outbound-grants-setup.js"
import test, { afterEach } from "node:test"
import assert from "node:assert/strict"
import http from "node:http"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import { createOutboundMcpServer } from "../src/outbound-mcp/stdio-server"
import { setOutboundDispatcher } from "../src/outbound-mcp/bridge"
import { createHttpOutboundDispatcher } from "../src/outbound-mcp/http-client"
import { handleOutboundMcpHttp, setOutboundToolRunner, setOutboundExfilConfirmer, resetOutboundCompanionHttpForTests } from "../src/outbound-mcp/companion-http"
import { issueOutboundGrant, resetOutboundGrantsForTests, OUTBOUND_L1_DEFAULT_PROFILE } from "../src/outbound-mcp/outbound-grants"
import { SecurityConfirmationManager } from "../src/security-confirmation"
import { hasOutboundDisclosure } from "../src/outbound-mcp/disclosure-session"
import { WebSocket } from "ws"

afterEach(() => { setOutboundDispatcher(null); resetOutboundCompanionHttpForTests(); resetOutboundGrantsForTests() })
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}
async function fixture(caller: string, allow_page_export = false) {
  const priorCaller = process.env.CMSPARK_OUTBOUND_CALLER_ID
  process.env.CMSPARK_OUTBOUND_CALLER_ID = caller
  const token = issueOutboundGrant({ label: "cancellation fixture", caller_id: caller, allow_page_export }).token
  const httpServer = http.createServer((req, res) => { void handleOutboundMcpHttp(req, res, "unused-secret") })
  await new Promise<void>(resolve => httpServer.listen(0, "127.0.0.1", resolve))
  const address = httpServer.address() as { port: number }
  const dispatch = createHttpOutboundDispatcher({ port: address.port, token })
  setOutboundDispatcher(req => dispatch({ ...req, caller_id: caller }))
  const server = createOutboundMcpServer([OUTBOUND_L1_DEFAULT_PROFILE])
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  await server.connect(serverSide)
  const client = new Client({ name: "cancel-test", version: "1" })
  await client.connect(clientSide)
  return { client, close: async () => {
    if (priorCaller === undefined) delete process.env.CMSPARK_OUTBOUND_CALLER_ID
    else process.env.CMSPARK_OUTBOUND_CALLER_ID = priorCaller
    await client.close(); await server.close(); httpServer.closeAllConnections()
    await new Promise<void>(resolve => httpServer.close(() => resolve()))
  } }
}
test("SDK cancellation reaches HTTP runner signal before a queued action executes", { timeout: 8000 }, async (t) => {
  const entered = deferred(), cancelled = deferred()
  let acted = false, received: AbortSignal | undefined
  setOutboundToolRunner(async (_id, _tool, _args, options) => {
    received = options?.signal
    assert.ok(received)
    entered.resolve()
    await new Promise<void>(resolve => received!.addEventListener("abort", () => { cancelled.resolve(); resolve() }, { once: true }))
    if (!received.aborted) acted = true
    return { success: false, error: "cancelled before action" }
  })
  const f = await fixture("cancel-queued")
  t.after(() => f.close())
  const controller = new AbortController()
  const call = f.client.callTool({ name: "list_tabs", arguments: {} }, undefined, { signal: controller.signal })
  await Promise.race([entered.promise, call.then(result => { throw new Error(`Runner was not reached: ${JSON.stringify(result)}`) })])
  const rejected = assert.rejects(call, /abort/i)
  controller.abort(); await rejected; await cancelled.promise
  assert.equal(received?.aborted, true); assert.equal(acted, false)
})
test("SDK cancellation removes its pending exfil prompt without granting disclosure", { timeout: 8000 }, async (t) => {
  const manager = new SecurityConfirmationManager(), requested = deferred(), cancelled = deferred()
  let calls = 0
  const ws = { readyState: WebSocket.OPEN, send(raw: string) {
    const frame = JSON.parse(raw)
    if (frame.type === "security.confirmation.request") requested.resolve()
    if (frame.type === "security.confirmation.resolved") cancelled.resolve()
  } } as unknown as WebSocket
  setOutboundExfilConfirmer({ securityConfirmations: manager, getClients: () => [ws], wsAuthGet: () => ({ authenticated: true, origin: "chrome-extension://fixture", surface: "tray" }), getOriginatingWs: () => ws })
  setOutboundToolRunner(async () => { calls++; return { success: true } })
  const f = await fixture("cancel-exfil", true)
  t.after(async () => { manager.rejectAll(); await f.close() })
  const controller = new AbortController()
  const call = f.client.callTool({ name: "get_page_text", arguments: { tabId: 1 } }, undefined, { signal: controller.signal })
  await Promise.race([requested.promise, call.then(result => { throw new Error(`Confirmation was not reached: ${JSON.stringify(result)}`) })])
  const rejected = assert.rejects(call, /abort/i)
  assert.equal(manager.pendingCount(), 1)
  controller.abort(); await rejected; await cancelled.promise
  assert.equal(manager.pendingCount(), 0); assert.equal(calls, 0)
  assert.equal(hasOutboundDisclosure("cancel-exfil"), false)
})
test("confirmation cancellation only rejects its own request and ignores late approval", async () => {
  const manager = new SecurityConfirmationManager(), controller = new AbortController()
  const ids: string[] = []
  const send = (frame: any) => { if (frame.type === "security.confirmation.request") ids.push(frame.confirmation_id) }
  const details = { toolName: "fixture", dangerousApis: [], code: "fixture" }
  const first = manager.request(send, details, { signal: controller.signal })
  const second = manager.request(send, details)
  controller.abort()
  assert.equal((await first).approved, false)
  assert.equal(manager.respond(ids[0], true), false)
  assert.equal(manager.pendingCount(), 1)
  manager.respond(ids[1], true)
  assert.equal((await second).approved, true)
  const alreadyAborted = await manager.request(send, details, { signal: controller.signal })
  assert.equal(alreadyAborted.approved, false); assert.equal(ids.length, 2)
})

test("confirmation cancellation settles even when the disconnected peer cannot receive its terminal frame", async () => {
  const manager = new SecurityConfirmationManager(), controller = new AbortController()
  let terminals = 0
  manager.setOnTerminal(() => { terminals++ })
  const result = manager.request(frame => {
    if (frame.type === "security.confirmation.resolved") throw new Error("socket closed")
  }, { toolName: "fixture", dangerousApis: [], code: "fixture" }, { signal: controller.signal })
  controller.abort()
  assert.equal((await result).approved, false)
  assert.equal(manager.pendingCount(), 0)
  assert.equal(terminals, 1)
})

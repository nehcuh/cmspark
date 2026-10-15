import test from "node:test"
import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { PassThrough, Writable } from "node:stream"
import type { ChildProcessWithoutNullStreams } from "node:child_process"
import * as winSpawn from "../src/acp/win-spawn"
import { tryStartProtocolSession } from "../src/acp/protocol-session"
import { JsonRpcStdioClient, tryAcpInitialize } from "../src/acp/jsonrpc-stdio"

// The request seam below invokes the complete production initialize helper;
// owned stdio + protocol-session lifecycle is also exercised in the peer gate.
for (const result of [null, [], "owned", true, 1, {}, { protocolVersion: "1" }, { protocolVersion: 0 }, { protocolVersion: 2 }, { protocolVersion: 999 }]) {
  test(`ACP initialize refuses unsupported response ${JSON.stringify(result)}`, async () => {
    let requests = 0
    const client = { request: async (method: string, params: unknown, timeout: number) => {
      requests++
      assert.equal(method, "initialize")
      assert.equal((params as { protocolVersion: number }).protocolVersion, 1)
      assert.equal(timeout, 4000)
      return result
    } } as unknown as JsonRpcStdioClient
    const initialized = await tryAcpInitialize(client)
    assert.equal(initialized.ok, false)
    if (!initialized.ok) assert.equal(initialized.error, "ACP initialize returned an unsupported protocol version (expected 1)")
    assert.equal(requests, 1)
  })
}

test("ACP initialize preserves the supported response and caller timeout", async () => {
  const result = { protocolVersion: 1, agentCapabilities: {}, authMethods: [] }
  const client = { request: async (_method: string, _params: unknown, timeout: number) => {
    assert.equal(timeout, 1234)
    return result
  } } as unknown as JsonRpcStdioClient
  assert.deepEqual(await tryAcpInitialize(client, 1234), { ok: true, result })
})

test("ACP initialize retains ordinary request failures", async () => {
  const client = { request: async () => { throw new Error("owned request failure") } } as unknown as JsonRpcStdioClient
  assert.deepEqual(await tryAcpInitialize(client), { ok: false, error: "owned request failure" })
})


for (const mode of ["rpc-error", "unsupported"] as const) {
  test(`ACP ${mode} rejection awaits cleanup when its timeline sink throws`, async t => {
    // Inert stdio and spawn/close seams: no OS child or native owner fixture.
    // The peer gate separately verifies actual owned Node process closure.
    const child = new EventEmitter() as ChildProcessWithoutNullStreams
    const stdout = new PassThrough(), stderr = new PassThrough()
    const methods: string[] = [], events: string[] = []
    const stdin = new Writable({ write(chunk, _encoding, done) {
      const request = JSON.parse(String(chunk))
      methods.push(request.method)
      queueMicrotask(() => stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, ...(mode === "rpc-error" ? { error: { code: -32603, message: "owned initialize error" } } : { result: { protocolVersion: 999 } }) }) + "\n"))
      done()
    } })
    Object.assign(child, { stdin, stdout, stderr, pid: undefined, exitCode: null, signalCode: null })
    t.after(() => { stdin.destroy(); stdout.destroy(); stderr.destroy() })
    t.mock.method(winSpawn, "spawnAcpChild", () => child)
    let closeCalls = 0
    t.mock.method(winSpawn, "closeAcpChild", async (received: ChildProcessWithoutNullStreams) => {
      assert.equal(received, child)
      closeCalls++
      await Promise.resolve()
      events.push("cleanup-settled")
      child.emit("close", 0, null)
    })
    const failure = Object.assign(new Error("owned timeline sink EIO"), { code: "OWNED_TIMELINE_EIO" })
    await assert.rejects(tryStartProtocolSession({
      command: "owned-inert", args: [], cwd: process.cwd(), env: {}, session: {} as any,
      hooks: { onTimeline: items => { if (items.some(item => item.kind === "error")) throw failure } },
    }), error => error === failure)
    events.push("rejected")
    assert.equal(closeCalls, 1)
    assert.deepEqual(events, ["cleanup-settled", "rejected"])
    assert.deepEqual(methods, ["initialize"])
  })
}

test("ACP initial status rejection awaits owned teardown before propagating", async t => {
  // Complete protocol module and inert stdio/spawn seams; real owned-child
  // closure is separately checked by the independent wire acceptance.
  const child = new EventEmitter() as ChildProcessWithoutNullStreams
  const stdout = new PassThrough(), stderr = new PassThrough()
  let writes = 0
  const stdin = new Writable({ write(_chunk, _encoding, done) { writes++; done() } })
  Object.assign(child, { stdin, stdout, stderr, pid: undefined, exitCode: null, signalCode: null })
  t.after(() => { stdin.destroy(); stdout.destroy(); stderr.destroy() })
  t.mock.method(winSpawn, "spawnAcpChild", () => child)
  const events: string[] = []
  let closeCalls = 0
  t.mock.method(winSpawn, "closeAcpChild", async (received: ChildProcessWithoutNullStreams) => {
    assert.equal(received, child)
    closeCalls++
    await Promise.resolve()
    events.push("cleanup-settled")
    child.emit("close", 0, null)
  })
  const failure = Object.assign(new Error("owned initial status EIO"), { code: "OWNED_STATUS_EIO" })
  await assert.rejects(tryStartProtocolSession({
    command: "owned-inert", args: [], cwd: process.cwd(), env: {}, session: {} as any,
    hooks: { onTimeline: items => {
      if (items.some(item => item.kind === "status" && item.label === "ACP initialize…")) throw failure
    } },
  }), error => error === failure)
  events.push("rejected")
  assert.equal(closeCalls, 1)
  assert.deepEqual(events, ["cleanup-settled", "rejected"])
  assert.equal(writes, 0)
})

for (const phase of ["spawn", "initialized"] as const) {
  test(`ACP ${phase} callback rejection awaits bootstrap teardown`, async t => {
    const child = new EventEmitter() as ChildProcessWithoutNullStreams
    const stdout = new PassThrough(), stderr = new PassThrough()
    const methods: string[] = [], events: string[] = []
    const stdin = new Writable({ write(chunk, _encoding, done) {
      const request = JSON.parse(String(chunk))
      methods.push(request.method)
      queueMicrotask(() => stdout.write(JSON.stringify({
        jsonrpc: "2.0", id: request.id, result: { protocolVersion: 1 },
      }) + "\n"))
      done()
    } })
    Object.assign(child, { stdin, stdout, stderr, pid: undefined, exitCode: null, signalCode: null })
    t.after(() => { stdin.destroy(); stdout.destroy(); stderr.destroy() })
    t.mock.method(winSpawn, "spawnAcpChild", () => child)
    let closeCalls = 0
    t.mock.method(winSpawn, "closeAcpChild", async (received: ChildProcessWithoutNullStreams) => {
      assert.equal(received, child)
      closeCalls++
      await Promise.resolve()
      events.push("cleanup-settled")
      child.emit("close", 0, null)
    })
    const failure = Object.assign(new Error(`owned bootstrap ${phase}`), { code: "OWNED_BOOTSTRAP_EIO" })
    await assert.rejects(tryStartProtocolSession({
      command: "owned-inert", args: [], cwd: process.cwd(), env: {}, session: {} as any,
      hooks: {
        onSpawn: () => { if (phase === "spawn") throw failure },
        onTimeline: items => {
          if (phase === "initialized" && items.some(item => item.kind === "status" && item.label === "ACP initialized")) throw failure
        },
      },
    }), error => error === failure)
    events.push("rejected")
    assert.equal(closeCalls, 1)
    assert.deepEqual(events, ["cleanup-settled", "rejected"])
    assert.deepEqual(methods, phase === "spawn" ? [] : ["initialize"])
  })
}

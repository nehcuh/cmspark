import test from "node:test"
import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { PassThrough } from "node:stream"
import { JsonRpcStdioClient } from "../src/acp/jsonrpc-stdio"
function peer() {
  const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough() })
  const client = new JsonRpcStdioClient(child as any)
  return { child, client }
}
for (const frame of [null, [], 1, { jsonrpc: "2.0", id: {}, result: true }, { jsonrpc: "2.0", id: 1, error: null }, { jsonrpc: "2.0", id: 1, error: { code: 1 } }]) {
  test(`invalid ACP JSON object ${JSON.stringify(frame)} closes only that peer`, async () => {
    const bad = peer(), good = peer()
    const failed = assert.rejects(bad.client.request("initialize"), /killed/)
    const healthy = good.client.request("initialize")
    assert.doesNotThrow(() => bad.child.stdout.write(JSON.stringify(frame) + "\n"))
    good.child.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { protocolVersion: 1 } }) + "\n")
    await failed
    assert.deepEqual(await healthy, { protocolVersion: 1 })
    good.client.shutdown()
  })
}
test("unbounded ACP line is rejected before parse without affecting healthy peer", async () => {
  const bad = peer()
  const failed = assert.rejects(bad.client.request("initialize"), /killed/)
  bad.child.stdout.write("x".repeat(1024 * 1024 + 1))
  await failed
})
test("ACP stdin EPIPE and synchronous write failure close client without an unhandled error event", async () => {
  const a = peer(), b = peer()
  const rejected = assert.rejects(a.client.request("initialize"), /EPIPE/)
  assert.doesNotThrow(() => a.child.stdin.emit("error", new Error("EPIPE")))
  await rejected
  b.child.stdin.write = () => { throw new Error("closed pipe") }
  await assert.rejects(b.client.request("initialize"), /closed pipe/)
})

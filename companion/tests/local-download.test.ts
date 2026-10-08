import test from "node:test"
import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { Readable } from "node:stream"
import { createHash } from "node:crypto"
import { downloadArtifact } from "../src/code-review/local-download"
import { LOCAL_LIMITS } from "../src/code-review/local-contract"
const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex")
function transport(t: any, options: { status?: number; headers?: any; bytes?: Buffer; addresses?: any[] } = {}) {
  let calls = 0
  t.mock.method(require("node:dns/promises"), "lookup", async () => options.addresses || [{ address: "8.8.8.8", family: 4 }])
  t.mock.method(require("node:https"), "get", (url: URL, opts: any, callback: any) => {
    calls++
    assert.equal(url.hostname, "fixture.test")
    assert.equal(opts.agent, false)
    assert.deepEqual(Object.keys(opts.headers).sort(), ["Accept", "User-Agent"])
    opts.lookup("fixture.test", {}, (err: any, address: string, family: number) => {
      assert.equal(err, null); assert.equal(address, "8.8.8.8"); assert.equal(family, 4)
    })
    const request = new EventEmitter() as any
    request.setTimeout = () => request
    request.destroy = (error: Error) => request.emit("error", error)
    process.nextTick(() => {
      const response = Readable.from([options.bytes || Buffer.from("zip fixture")]) as any
      response.statusCode = options.status || 200; response.headers = options.headers || {}
      callback(response)
    })
    return request
  })
  return () => calls
}
test("HTTPS download pins the approved DNS answer and validates SHA without cookies, credentials or proxy", async t => {
  const calls = transport(t)
  const bytes = Buffer.from("zip fixture")
  assert.deepEqual(await downloadArtifact("https://fixture.test/a.zip", digest(bytes), new AbortController().signal), bytes)
  assert.equal(calls(), 1)
  await assert.rejects(downloadArtifact("https://fixture.test/a.zip", "0".repeat(64), new AbortController().signal), /HASH_MISMATCH/)
})
test("mixed public/private DNS and rebinding preflight refuse request", async t => {
  const calls = transport(t, { addresses: [{ address: "8.8.8.8", family: 4 }, { address: "127.0.0.1", family: 4 }] })
  await assert.rejects(downloadArtifact("https://fixture.test/a.zip", "0".repeat(64), new AbortController().signal), /DNS_DENIED/)
  assert.equal(calls(), 0)
})
test("redirects never follow an arbitrary target", async t => {
  const calls = transport(t, { status: 302, headers: { location: "https://127.0.0.1/private" } })
  await assert.rejects(downloadArtifact("https://fixture.test/a.zip", "0".repeat(64), new AbortController().signal), /STATUS_OR_REDIRECT/)
  assert.equal(calls(), 1)
})
test("advertised and streamed download limits stop oversized artifacts", async t => {
  transport(t, { headers: { "content-length": LOCAL_LIMITS.downloadBytes + 1 } })
  await assert.rejects(downloadArtifact("https://fixture.test/a.zip", "0".repeat(64), new AbortController().signal), /DOWNLOAD_LIMIT/)
  t.mock.restoreAll()
  transport(t, { bytes: Buffer.alloc(LOCAL_LIMITS.downloadBytes + 1) })
  await assert.rejects(downloadArtifact("https://fixture.test/a.zip", "0".repeat(64), new AbortController().signal), /DOWNLOAD_LIMIT/)
})

test("cancel during stalled DNS releases task without initiating HTTPS", async t => {
  t.mock.method(require("node:dns/promises"), "lookup", () => new Promise(() => {}))
  t.mock.method(require("node:https"), "get", () => assert.fail("network after DNS cancellation"))
  const abort = new AbortController()
  const request = downloadArtifact("https://fixture.test/a.zip", "0".repeat(64), abort.signal)
  abort.abort()
  await assert.rejects(request, /CANCELLED/)
})

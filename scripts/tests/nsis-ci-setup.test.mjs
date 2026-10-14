import test from "node:test"
import assert from "node:assert/strict"
import { fetchNsisPackage, verifiedNsisSetup, requireWindowsCi, NSIS_PACKAGE_URL, MAX_PACKAGE_BYTES } from "../ensure-ci-nsis.mjs"

test("the failed metadata lookup is replaced by the exact same pinned installer package", async () => {
  let calls = 0
  const bytes = await fetchNsisPackage({ fetchImpl: async (url, options) => {
    calls++
    assert.equal(url, NSIS_PACKAGE_URL)
    assert.ok(options.signal instanceof AbortSignal)
    return new Response("isolated transport bytes")
  } })
  assert.equal(calls, 1)
  assert.equal(bytes.toString(), "isolated transport bytes")
  assert.throws(() => verifiedNsisSetup(bytes), /checksum mismatch/, "unverified bytes cannot reach parsing/execution")
})

test("504 retries are bounded and recover without skipping integrity checks", async () => {
  let calls = 0
  const delays = []
  const bytes = await fetchNsisPackage({ fetchImpl: async () => {
    calls++
    return calls === 3 ? new Response("fixture") : new Response("gateway unavailable", { status: 504 })
  }, sleep: async ms => { delays.push(ms) } })
  assert.equal(calls, 3)
  assert.deepEqual(delays, [500, 1000])
  assert.throws(() => verifiedNsisSetup(bytes), /checksum mismatch/)
  calls = 0
  await assert.rejects(fetchNsisPackage({ fetchImpl: async () => { calls++; return new Response("", { status: 504 }) }, sleep: async () => {} }), /HTTP 504/)
  assert.equal(calls, 3)
})

test("wrong version, authentication failures and payload limits are not retried", async () => {
  for (const status of [400, 401, 403, 404]) {
    let calls = 0
    await assert.rejects(fetchNsisPackage({ fetchImpl: async () => { calls++; return new Response("", { status }) } }), new RegExp(`HTTP ${status}`))
    assert.equal(calls, 1)
  }
  let calls = 0
  await assert.rejects(fetchNsisPackage({ fetchImpl: async () => {
    calls++; return new Response("tiny", { headers: { "content-length": String(MAX_PACKAGE_BYTES + 1) } })
  } }), /size limit/)
  assert.equal(calls, 1)
  await assert.rejects(fetchNsisPackage({ fetchImpl: async () => new Response(new Uint8Array(MAX_PACKAGE_BYTES + 1)) }), /size limit/)
})

test("transient network errors are bounded; certificate failures fail immediately", async () => {
  let calls = 0
  await assert.rejects(fetchNsisPackage({ fetchImpl: async () => {
    calls++; throw Object.assign(new Error("reset"), { cause: { code: "ECONNRESET" } })
  }, sleep: async () => {} }), /transport failed/)
  assert.equal(calls, 3)
  calls = 0
  await assert.rejects(fetchNsisPackage({ fetchImpl: async () => {
    calls++; throw Object.assign(new Error("certificate"), { cause: { code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE" } })
  } }), /transport failed/)
  assert.equal(calls, 1)
})

test("empty or oversized packages fail closed, and local platforms cannot invoke installer", () => {
  assert.throws(() => verifiedNsisSetup(Buffer.alloc(0)), /checksum mismatch/)
  assert.throws(() => verifiedNsisSetup(Buffer.alloc(MAX_PACKAGE_BYTES + 1)), /size limit/)
  assert.throws(() => requireWindowsCi("darwin", { GITHUB_ACTIONS: "true" }), /restricted/)
  assert.throws(() => requireWindowsCi("win32", {}), /restricted/)
  requireWindowsCi("win32", { GITHUB_ACTIONS: "true" })
})

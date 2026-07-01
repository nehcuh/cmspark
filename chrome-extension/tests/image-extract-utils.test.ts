import test from "node:test"
import assert from "node:assert/strict"
import { bytesToBase64, decodeDataUrl, fetchImageAsBase64 } from "../src/background/image-extract-utils"

/** Decode base64 back to bytes via atob (DOM global, available in the node test runtime). */
function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

test("bytesToBase64 round-trips a small byte array", () => {
  const bytes = new Uint8Array([0, 1, 2, 3, 255, 128, 64])
  assert.deepEqual(Array.from(fromBase64(bytesToBase64(bytes))), Array.from(bytes))
  // Canonical base64 of "Hi" (0x48 0x69) — guards against chunk/encoding drift.
  assert.equal(bytesToBase64(new Uint8Array([72, 105])), "SGk=")
})

test("bytesToBase64 handles inputs larger than the chunk size", () => {
  const len = 0x8000 + 100 // forces at least two chunks; would overflow apply() if unchunked
  const bytes = new Uint8Array(len)
  for (let i = 0; i < len; i++) bytes[i] = i % 251
  assert.deepEqual(Array.from(fromBase64(bytesToBase64(bytes))), Array.from(bytes))
})

test("decodeDataUrl extracts base64 payload and mime", () => {
  const r = decodeDataUrl("data:image/png;base64,SGVsbG8=")
  assert.equal(r.base64, "SGVsbG8=")
  assert.equal(r.mime, "image/png")
})

test("decodeDataUrl decodes URL-encoded payloads", () => {
  const r = decodeDataUrl("data:text/plain,Hello%20World")
  assert.equal(atob(r.base64), "Hello World")
})

test("fetchImageAsBase64 fetches http(s) image bytes", async () => {
  const orig = (globalThis as any).fetch
  const bytes = new Uint8Array([1, 2, 3, 4, 5])
  ;(globalThis as any).fetch = (async () => ({
    ok: true,
    status: 200,
    blob: async () => new Blob([bytes]),
    headers: new Headers({ "content-type": "image/png" }),
  })) as any
  try {
    const r = await fetchImageAsBase64("https://cdn.example.com/x.png")
    assert.equal(r.base64, bytesToBase64(bytes))
    assert.equal(r.mime, "image/png")
  } finally {
    ;(globalThis as any).fetch = orig
  }
})

test("fetchImageAsBase64 throws on HTTP error status", async () => {
  const orig = (globalThis as any).fetch
  ;(globalThis as any).fetch = (async () => ({
    ok: false,
    status: 404,
    blob: async () => new Blob(),
    headers: new Headers(),
  })) as any
  try {
    let threw = false
    try {
      await fetchImageAsBase64("https://example.com/missing.png")
    } catch (e: any) {
      threw = true
      assert.equal(e.message.indexOf("404") >= 0, true)
    }
    assert.equal(threw, true)
  } finally {
    ;(globalThis as any).fetch = orig
  }
})

test("fetchImageAsBase64 rejects blob: URLs", async () => {
  let threw = false
  try {
    await fetchImageAsBase64("blob:https://example.com/abc-123")
  } catch (e: any) {
    threw = true
    assert.equal(e.message.indexOf("blob") >= 0, true)
  }
  assert.equal(threw, true)
})

test("fetchImageAsBase64 retries with credentials on 401 then succeeds", async () => {
  const orig = (globalThis as any).fetch
  const calls: string[] = []
  const bytes = new Uint8Array([9, 9])
  ;(globalThis as any).fetch = (async (_url: string, init?: any) => {
    calls.push(init && init.credentials ? init.credentials : "default")
    if (calls.length === 1) {
      return { ok: false, status: 401, blob: async () => new Blob(), headers: new Headers() }
    }
    return {
      ok: true,
      status: 200,
      blob: async () => new Blob([bytes]),
      headers: new Headers({ "content-type": "image/jpeg" }),
    }
  }) as any
  try {
    const r = await fetchImageAsBase64("https://example.com/auth.png")
    assert.deepEqual(calls, ["omit", "include"])
    assert.equal(r.base64, bytesToBase64(bytes))
  } finally {
    ;(globalThis as any).fetch = orig
  }
})

test("fetchImageAsBase64 retries with credentials on 403 then succeeds", async () => {
  const orig = (globalThis as any).fetch
  const calls: string[] = []
  const bytes = new Uint8Array([7, 7, 7])
  ;(globalThis as any).fetch = (async (_url: string, init?: any) => {
    calls.push(init && init.credentials ? init.credentials : "default")
    if (calls.length === 1) {
      return { ok: false, status: 403, blob: async () => new Blob(), headers: new Headers() }
    }
    return {
      ok: true,
      status: 200,
      blob: async () => new Blob([bytes]),
      headers: new Headers({ "content-type": "image/webp" }),
    }
  }) as any
  try {
    const r = await fetchImageAsBase64("https://example.com/forbidden.png")
    assert.deepEqual(calls, ["omit", "include"])
    assert.equal(r.base64, bytesToBase64(bytes))
    assert.equal(r.mime, "image/webp")
  } finally {
    ;(globalThis as any).fetch = orig
  }
})

test("fetchImageAsBase64 decodes data: URLs inline without hitting the network", async () => {
  const orig = (globalThis as any).fetch
  let called = false
  ;(globalThis as any).fetch = (async () => {
    called = true
    return { ok: true, status: 200, blob: async () => new Blob(), headers: new Headers() }
  }) as any
  try {
    const r = await fetchImageAsBase64("data:image/png;base64,SGVsbG8=")
    assert.equal(r.base64, "SGVsbG8=")
    assert.equal(r.mime, "image/png")
    assert.equal(called, false)
  } finally {
    ;(globalThis as any).fetch = orig
  }
})

import test from "node:test"
import assert from "node:assert/strict"
import {
  ALLOWED_IMAGE_MIMES_LIST,
  bytesToBase64,
  decodeDataUrl,
  decodeDataUrlImage,
  estimateDataUrlPayloadBytes,
  fetchImageAsBase64,
  IMAGE_DATA_URL_MAX_DECODED_BYTES,
  normalizeImageMime,
  promoteFetchSrc,
  sanitizeImageDim,
} from "../src/background/image-extract-utils"

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

test("normalizeImageMime allowlist: raster ok, jpg→jpeg, svg/text rejected", () => {
  assert.equal(normalizeImageMime("image/png"), "image/png")
  assert.equal(normalizeImageMime("image/jpeg"), "image/jpeg")
  assert.equal(normalizeImageMime("image/jpg"), "image/jpeg")
  assert.equal(normalizeImageMime("image/webp"), "image/webp")
  assert.equal(normalizeImageMime("image/gif"), "image/gif")
  assert.equal(normalizeImageMime("image/svg+xml"), null)
  assert.equal(normalizeImageMime("text/html"), null)
  assert.equal(normalizeImageMime("text/plain"), null)
  assert.equal(normalizeImageMime(""), null)
})

test("decodeDataUrlImage happy path: raster png", () => {
  const r = decodeDataUrlImage("data:image/png;base64,SGVsbG8=")
  assert.equal(r.ok, true)
  if (r.ok) {
    assert.equal(r.base64, "SGVsbG8=")
    assert.equal(r.mime, "image/png")
    assert.equal(r.byte_len, 5) // "Hello"
  }
})

test("decodeDataUrlImage happy path: image/jpg normalized to jpeg", () => {
  const r = decodeDataUrlImage("data:image/jpg;base64,SGk=")
  assert.equal(r.ok, true)
  if (r.ok) assert.equal(r.mime, "image/jpeg")
})

test("decodeDataUrlImage rejects text/html", () => {
  const r = decodeDataUrlImage("data:text/html;base64,PGh0bWw+")
  assert.equal(r.ok, false)
  if (!r.ok) {
    assert.equal(r.error_code, "IMAGE_MIME_REJECTED")
    assert.match(r.error, /MIME|text\/html/i)
  }
})

test("decodeDataUrlImage rejects image/svg+xml", () => {
  const r = decodeDataUrlImage("data:image/svg+xml;base64,PHN2Zz4=")
  assert.equal(r.ok, false)
  if (!r.ok) {
    assert.equal(r.error_code, "IMAGE_MIME_REJECTED")
    assert.match(r.error, /svg/i)
  }
})

test("decodeDataUrlImage rejects oversize payload (IMAGE_TOO_LARGE)", () => {
  // Build a base64 payload whose decoded size exceeds 6 MiB without allocating 6MiB of zeros
  // in the test process: 6 MiB + 1 → base64 length ≈ ceil(n/3)*4.
  const overBytes = IMAGE_DATA_URL_MAX_DECODED_BYTES + 1
  const b64Len = Math.ceil(overBytes / 3) * 4
  const payload = "A".repeat(b64Len)
  const src = `data:image/png;base64,${payload}`
  assert.ok(estimateDataUrlPayloadBytes(src) > IMAGE_DATA_URL_MAX_DECODED_BYTES)
  const r = decodeDataUrlImage(src)
  assert.equal(r.ok, false)
  if (!r.ok) {
    assert.equal(r.error_code, "IMAGE_TOO_LARGE")
    assert.match(r.error, /too large/i)
    // Error must stay short — never embed the multi-KB payload.
    assert.ok(r.error.length < 200, "error must not contain the payload")
  }
})

test("decodeDataUrlImage: data: path does not call fetch/network", async () => {
  const orig = (globalThis as any).fetch
  let called = false
  ;(globalThis as any).fetch = (async () => {
    called = true
    throw new Error("network must not be used for data:")
  }) as any
  try {
    const r = decodeDataUrlImage("data:image/webp;base64,UklGRg==")
    assert.equal(r.ok, true)
    assert.equal(called, false)
  } finally {
    ;(globalThis as any).fetch = orig
  }
})

test("fetchImageAsBase64 rejects data:text/html (mime gate)", async () => {
  let threw = false
  try {
    await fetchImageAsBase64("data:text/html;base64,PGh0bWw+")
  } catch (e: any) {
    threw = true
    assert.match(String(e?.message || e), /MIME|text\/html|Unsupported/i)
  }
  assert.equal(threw, true)
})

// --- dual-review nits: whitespace strip, promoteFetchSrc, dim sanitize, allowlist pin ---

test("decodeDataUrlImage strips whitespace from base64 payload", () => {
  // "Hi" = SGVsbG8= with embedded newlines/spaces
  const r = decodeDataUrlImage("data:image/png;base64,SGVs\nbG8=\n")
  assert.equal(r.ok, true)
  if (r.ok === true) {
    assert.equal(r.base64, "SGVsbG8=")
    assert.ok(!/\s/.test(r.base64), "returned base64 must not contain whitespace")
  }
})

test("promoteFetchSrc: data: → canvas; blob: → error; https → fetch_required", () => {
  const canvas = promoteFetchSrc("data:image/png;base64,SGVsbG8=")
  assert.equal(canvas.kind, "canvas")
  if (canvas.kind === "canvas") {
    assert.equal(canvas.image_base64, "SGVsbG8=")
    assert.equal(canvas.mime, "image/png")
  }

  const bad = promoteFetchSrc("data:text/html;base64,PGh0bWw+")
  assert.equal(bad.kind, "error")
  if (bad.kind === "error") assert.equal(bad.error_code, "IMAGE_MIME_REJECTED")

  const blob = promoteFetchSrc("blob:https://example.com/abc-123")
  assert.equal(blob.kind, "error")
  if (blob.kind === "error") assert.equal(blob.error_code, "BLOB_URL_UNSUPPORTED")

  const http = promoteFetchSrc("https://cdn.example.com/x.png")
  assert.equal(http.kind, "fetch_required")
  if (http.kind === "fetch_required") {
    assert.equal(http.candidate_url, "https://cdn.example.com/x.png")
  }
})

test("sanitizeImageDim only accepts positive finite numbers", () => {
  assert.equal(sanitizeImageDim(146), 146)
  assert.equal(sanitizeImageDim(33.9), 33)
  assert.equal(sanitizeImageDim(0), 0)
  assert.equal(sanitizeImageDim(-1), 0)
  assert.equal(sanitizeImageDim(NaN), 0)
  assert.equal(sanitizeImageDim(undefined), 0)
  assert.equal(sanitizeImageDim("nope"), 0)
})

test("cross-package pin: allowlist + size cap (lock-step with companion image-data-url)", () => {
  // If you change these, update companion/src/image-data-url.ts and its tests too.
  assert.deepEqual([...ALLOWED_IMAGE_MIMES_LIST], [
    "image/gif",
    "image/jpeg",
    "image/png",
    "image/webp",
  ])
  assert.equal(IMAGE_DATA_URL_MAX_DECODED_BYTES, 6 * 1024 * 1024)
})

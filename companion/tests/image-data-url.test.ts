/**
 * Unit tests for companion residual data: decoder + cross-package pin
 * against chrome-extension image-extract-utils (dual-review drift nit).
 */
import test from "node:test"
import assert from "node:assert/strict"
import {
  ALLOWED_IMAGE_MIMES_LIST,
  decodeDataUrlImage,
  IMAGE_DATA_URL_MAX_DECODED_BYTES,
  normalizeImageMime,
  summarizeCandidateUrl,
} from "../src/image-data-url"

test("normalizeImageMime maps jpg → jpeg and rejects svg/html", () => {
  assert.equal(normalizeImageMime("image/jpg"), "image/jpeg")
  assert.equal(normalizeImageMime("image/png"), "image/png")
  assert.equal(normalizeImageMime("image/svg+xml"), null)
  assert.equal(normalizeImageMime("text/html"), null)
})

test("decodeDataUrlImage happy path strips whitespace from base64", () => {
  const r = decodeDataUrlImage("data:image/png;base64,SGVs\nbG8=\n")
  assert.equal(r.ok, true)
  if (r.ok === true) {
    assert.equal(r.base64, "SGVsbG8=")
    assert.ok(!/\s/.test(r.base64))
  }
})

test("decodeDataUrlImage rejects text/html and svg", () => {
  const html = decodeDataUrlImage("data:text/html;base64,PGh0bWw+")
  assert.equal(html.ok, false)
  if (html.ok === false) assert.equal(html.error_code, "IMAGE_MIME_REJECTED")

  const svg = decodeDataUrlImage("data:image/svg+xml;base64,PHN2Zz4=")
  assert.equal(svg.ok, false)
  if (svg.ok === false) assert.equal(svg.error_code, "IMAGE_MIME_REJECTED")
})

test("summarizeCandidateUrl never embeds multi-KB data: payload", () => {
  const huge = "data:image/png;base64," + "A".repeat(5000)
  const s = summarizeCandidateUrl(huge)
  assert.equal(s.scheme, "data:")
  assert.ok(s.summary.length < 200)
  assert.ok(!s.summary.includes("A".repeat(100)))
})

test("cross-package pin: allowlist + size cap (lock-step with extension image-extract-utils)", () => {
  // If you change these, update chrome-extension image-extract-utils.ts and its tests too.
  assert.deepEqual([...ALLOWED_IMAGE_MIMES_LIST], [
    "image/gif",
    "image/jpeg",
    "image/png",
    "image/webp",
  ])
  assert.equal(IMAGE_DATA_URL_MAX_DECODED_BYTES, 6 * 1024 * 1024)
})

import test from "node:test"
import assert from "node:assert/strict"
import { makePreviewB64, parseRasterDims, previewDataUrl, PREVIEW_MAX_BYTES } from "../src/llm/image-preview"

// 1×1 PNG
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
)

test("makePreviewB64: tiny PNG produces a preview under 8KB", async () => {
  const b64 = await makePreviewB64(TINY_PNG, "image/png")
  assert.ok(b64)
  assert.ok(Buffer.from(b64!, "base64").length <= PREVIEW_MAX_BYTES)
})

test("parseRasterDims: PNG IHDR", () => {
  const dims = parseRasterDims(TINY_PNG, "image/png")
  assert.deepEqual(dims, { width: 1, height: 1 })
})

test("parseRasterDims: JPEG SOF0", () => {
  // SOI + SOF0 (8-bit, 20×30) + EOI
  const jpeg = Buffer.from([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x14, 0x00, 0x1e, 0x01, 0x11,
    0xff, 0xd9,
  ])
  assert.deepEqual(parseRasterDims(jpeg, "image/jpeg"), { width: 30, height: 20 })
})

test("previewDataUrl: magic prefixes", () => {
  assert.match(previewDataUrl("iVBORxxxx"), /^data:image\/png;base64,/)
  assert.match(previewDataUrl("R0lGODxxxx"), /^data:image\/gif;base64,/)
  assert.match(previewDataUrl("/9j/xxxx"), /^data:image\/jpeg;base64,/)
})

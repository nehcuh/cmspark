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

test("parseRasterDims: GIF logical screen descriptor", () => {
  // GIF89a + width 320 LE + height 200 LE
  const gif = Buffer.from([
    0x47, 0x49, 0x46, 0x38, 0x39, 0x61,
    0x40, 0x01, 0xc8, 0x00,
    0x00, 0x00, 0x00,
  ])
  assert.deepEqual(parseRasterDims(gif, "image/gif"), { width: 320, height: 200 })
})

test("parseRasterDims: WebP VP8X canvas size", () => {
  const webp = Buffer.alloc(30)
  webp.write("RIFF", 0)
  webp.writeUInt32LE(22, 4)
  webp.write("WEBP", 8)
  webp.write("VP8X", 12)
  webp.writeUInt32LE(10, 16)
  // canvas width-1 = 639 → 640; height-1 = 479 → 480 (24-bit LE)
  webp[24] = 0x7f
  webp[25] = 0x02
  webp[26] = 0x00
  webp[27] = 0xdf
  webp[28] = 0x01
  webp[29] = 0x00
  assert.deepEqual(parseRasterDims(webp, "image/webp"), { width: 640, height: 480 })
})

test("parseRasterDims: WebP VP8 lossy start-code size", () => {
  const webp = Buffer.alloc(30)
  webp.write("RIFF", 0)
  webp.writeUInt32LE(22, 4)
  webp.write("WEBP", 8)
  webp.write("VP8 ", 12)
  webp.writeUInt32LE(10, 16)
  webp[23] = 0x9d
  webp[24] = 0x01
  webp[25] = 0x2a
  webp.writeUInt16LE(320, 26)
  webp.writeUInt16LE(240, 28)
  assert.deepEqual(parseRasterDims(webp, "image/webp"), { width: 320, height: 240 })
})

test("parseRasterDims: WebP VP8L packed size", () => {
  const webp = Buffer.alloc(25)
  webp.write("RIFF", 0)
  webp.writeUInt32LE(17, 4)
  webp.write("WEBP", 8)
  webp.write("VP8L", 12)
  webp.writeUInt32LE(5, 16)
  webp[20] = 0x2f
  // width-1=99, height-1=49 → 100×50. bits 0-13 = 99, bits 14-27 = 49
  const packed = 99 | (49 << 14)
  webp.writeUInt32LE(packed, 21)
  assert.deepEqual(parseRasterDims(webp, "image/webp"), { width: 100, height: 50 })
})

test("parseRasterDims: unknown / truncated returns undefined (never 0x0)", () => {
  assert.equal(parseRasterDims(Buffer.from("not-an-image"), "image/gif"), undefined)
  assert.equal(parseRasterDims(Buffer.from("RIFF....WEBP"), "image/webp"), undefined)
})

test("previewDataUrl: magic prefixes", () => {
  assert.match(previewDataUrl("iVBORxxxx"), /^data:image\/png;base64,/)
  assert.match(previewDataUrl("R0lGODxxxx"), /^data:image\/gif;base64,/)
  assert.match(previewDataUrl("/9j/xxxx"), /^data:image\/jpeg;base64,/)
})

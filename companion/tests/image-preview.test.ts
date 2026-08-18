import test from "node:test"
import assert from "node:assert/strict"
import { makePreviewB64, PREVIEW_MAX_BYTES } from "../src/llm/image-preview"

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

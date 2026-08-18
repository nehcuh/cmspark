import test from "node:test"
import assert from "node:assert/strict"
import { sniffRasterImage, admitComposerImage } from "../src/llm/image-sniff"

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])
const GIF = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0])
const WEBP = Buffer.from(Buffer.concat([
  Buffer.from("RIFF"), Buffer.from([0, 0, 0, 0]), Buffer.from("WEBP"),
]))
const WAVE = Buffer.from(Buffer.concat([
  Buffer.from("RIFF"), Buffer.from([0, 0, 0, 0]), Buffer.from("WAVE"),
]))

test("sniffRasterImage: png/jpeg/gif/webp", () => {
  assert.equal(sniffRasterImage(PNG), "image/png")
  assert.equal(sniffRasterImage(JPEG), "image/jpeg")
  assert.equal(sniffRasterImage(GIF), "image/gif")
  assert.equal(sniffRasterImage(WEBP), "image/webp")
  assert.equal(sniffRasterImage(WAVE), null)
  assert.equal(sniffRasterImage(Buffer.from("not-an-image")), null)
})

test("admitComposerImage: sniffed must equal declared", () => {
  assert.deepEqual(admitComposerImage(PNG, "image/png"), { ok: true, mime: "image/png" })
  assert.equal(admitComposerImage(PNG, "image/jpeg").ok, false)
  assert.equal(admitComposerImage(PNG, "image/heic").ok, false)
  assert.equal(admitComposerImage(PNG, "image/svg+xml").ok, false)
  assert.equal(admitComposerImage(Buffer.from("<html>"), "image/png").ok, false)
})

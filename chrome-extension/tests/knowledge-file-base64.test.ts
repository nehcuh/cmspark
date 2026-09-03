import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { bytesToBase64 } from "../src/background/image-extract-utils"

const SRC = join(process.cwd(), "src/sidepanel/components/KnowledgeSubPanel.tsx")

/** The knowledge-import encoder that concatenates *per-chunk* btoa (CHUNK=0x8000).
 *  0x8000 % 3 === 2, so each full chunk is padded; joining those strings is not
 *  the base64 of the concatenation — pdf-parse then throws "Invalid PDF structure".
 *  Chat attachments use FileReader.readAsDataURL (whole file) and do not hit this. */
function concatPerChunkBtoa(bytes: Uint8Array): string {
  const CHUNK = 0x8000
  let base64 = ""
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, Math.min(i + CHUNK, bytes.length))
    const binary = String.fromCharCode.apply(null, Array.from(slice) as unknown as number[])
    base64 += btoa(binary)
  }
  return base64
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

test("concat-per-chunk btoa corrupts payloads larger than 0x8000 (the knowledge-import bug)", () => {
  const len = 0x8000 + 100
  const bytes = new Uint8Array(len)
  bytes.set([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x34]) // %PDF-1.4
  for (let i = 7; i < len; i++) bytes[i] = i % 251
  const encoded = concatPerChunkBtoa(bytes)
  let threw = false
  let decodedPrefix = ""
  try {
    decodedPrefix = Array.from(fromBase64(encoded).slice(0, 8)).join(",")
  } catch {
    threw = true
  }
  const origPrefix = Array.from(bytes.slice(0, 8)).join(",")
  assert.ok(
    threw || decodedPrefix !== origPrefix,
    "concat-per-chunk btoa must not round-trip a >32KiB PDF-shaped payload",
  )
})

test("bytesToBase64 (join binary, one btoa) round-trips the same payload", () => {
  const len = 0x8000 + 100
  const bytes = new Uint8Array(len)
  bytes.set([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x34])
  for (let i = 7; i < len; i++) bytes[i] = i % 251
  assert.deepEqual(Array.from(fromBase64(bytesToBase64(bytes))), Array.from(bytes))
})

test("KnowledgeSubPanel encodes files like chat: readAsDataURL, not concat-per-chunk btoa", () => {
  const src = readFileSync(SRC, "utf8")
  assert.ok(src.includes("readAsDataURL"), "knowledge import must use FileReader.readAsDataURL like the composer")
  assert.equal(src.includes("base64 += btoa"), false, "must not concatenate per-chunk btoa")
  assert.equal(/const CHUNK\s*=\s*0x8000/.test(src), false, "must not keep the 0x8000 concat-btoa loop")
})

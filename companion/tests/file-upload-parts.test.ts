import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import test from "node:test"
import { parseFile, PARSE_FILE_MAX_BYTES } from "../src/file-parser"
import { FileUploadParts } from "../src/ws/file-upload-parts"

test("composer reconstructs an 11 MiB attachment while the normal parser keeps its default limit", async () => {
  const bytes = Buffer.alloc(11 * 1024 * 1024, 0x61)
  const files = [{ name: "report.txt", type: "text/plain", content: bytes.toString("base64") }]
  const data = JSON.stringify(files), upload_id = randomUUID(), thread_id = "fixture-thread"
  const parts = new FileUploadParts<string>()
  const size = 1024 * 1024
  for (let offset = 0; offset < data.length; offset += size) {
    parts.add("owner", { upload_id, thread_id, index: offset / size, data: data.slice(offset, offset + size) })
  }
  const count = Math.ceil(data.length / size)
  assert.equal(parts.take("other", upload_id, thread_id, count), null)
  assert.equal(parts.take("owner", upload_id, "other-thread", count), null)
  assert.deepEqual(parts.take("owner", upload_id, thread_id, count), files)
  assert.equal(parts.take("owner", upload_id, thread_id, count), null)
  assert.equal((await parseFile(bytes, "report.txt", "text/plain")).success, false)
  assert.equal((await parseFile(bytes, "report.txt", "text/plain", { maxBytes: PARSE_FILE_MAX_BYTES + size })).success, true)
})

test("missing or out-of-order upload parts cannot be committed", () => {
  const parts = new FileUploadParts<string>()
  const upload_id = randomUUID(), thread_id = "fixture-thread"
  parts.add("owner", { upload_id, thread_id, index: 0, data: "[" })
  parts.add("owner", { upload_id, thread_id, index: 2, data: "]" })
  assert.equal(parts.take("owner", upload_id, thread_id, 2), null)
  parts.add("owner", { upload_id, thread_id, index: 0, data: "[" })
  parts.close("owner")
  assert.equal(parts.take("owner", upload_id, thread_id, 1), null)
})

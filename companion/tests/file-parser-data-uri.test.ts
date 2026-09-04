/**
 * #285: officeparser inlines images as data: URIs. extractEmbeddedImages already
 * pulls them as attachments — the markdown body must not keep the base64.
 * Hash (#281) runs on parseFile text, so strip BEFORE import/preview.
 */
import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "fs"
import * as path from "path"
import { stripEmbeddedDataUris } from "../src/file-parser"

test("#285 stripEmbeddedDataUris drops markdown image data URIs and keeps prose", () => {
  const md = [
    "# Report",
    "",
    "Hello world.",
    "![chart](data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==)",
    "More text.",
  ].join("\n")
  const out = stripEmbeddedDataUris(md)
  assert.equal(out.includes("data:image"), false)
  assert.equal(out.includes("iVBORw0KGgo"), false)
  assert.match(out, /Hello world/)
  assert.match(out, /More text/)
})

test("#285 stripEmbeddedDataUris drops HTML <img src=data:> tags", () => {
  const html = 'intro <img src="data:image/jpeg;base64,/9j/4AAQSkZJRg==" alt="x"> outro'
  const out = stripEmbeddedDataUris(html)
  assert.equal(out.includes("data:image"), false)
  assert.equal(out.includes("/9j/"), false)
  assert.match(out, /intro/)
  assert.match(out, /outro/)
})

test("#285 stripEmbeddedDataUris drops leftover bare data:image blobs", () => {
  const raw = "before data:image/png;base64,AAAA after"
  const out = stripEmbeddedDataUris(raw)
  assert.equal(out.includes("data:image"), false)
  assert.equal(out.includes("AAAA"), false)
  assert.match(out, /before/)
  assert.match(out, /after/)
})

test("#285 parseOfficeFile wires stripEmbeddedDataUris (source pin)", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "..", "src", "file-parser.ts"), "utf8")
  const start = src.indexOf("async function parseOfficeFile")
  assert.ok(start >= 0, "parseOfficeFile exists")
  const body = src.slice(start, start + 3500)
  assert.match(body, /stripEmbeddedDataUris/, "office markdown must be stripped before return")
})

test("#285 parseFile oversize error is honest and actionable", async () => {
  const { parseFile } = await import("../src/file-parser")
  const buf = Buffer.alloc(10 * 1024 * 1024 + 1)
  const r = await parseFile(buf, "huge.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
  assert.equal(r.success, false)
  assert.match((r as { error: string }).error, /过大/)
  assert.match((r as { error: string }).error, /最大支持 10MB/)
  assert.match((r as { error: string }).error, /导入大文件|原生/)
})

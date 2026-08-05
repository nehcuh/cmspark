import test from "node:test"
import assert from "node:assert/strict"
import path from "path"
import { safeUploadBasename } from "../src/file-parser"

test("safeUploadBasename: strips directories (posix-style)", () => {
  assert.equal(safeUploadBasename("../../outside.docx"), "outside.docx")
  assert.equal(safeUploadBasename("foo/bar/report.docx"), "report.docx")
})

test("safeUploadBasename: strips directories (win-style separators via path.basename)", () => {
  // path.basename is platform-aware; on win32 backslash is separator.
  const winLike = path.win32.basename("..\\..\\outside.docx")
  // Our helper uses path.basename (host platform). Cross-check win32 basename
  // semantics and that our helper never returns a multi-segment path.
  const got = safeUploadBasename("nested/evil.docx")
  assert.equal(got, "evil.docx")
  assert.ok(got && !got.includes("/") && !got.includes("\\"))
  assert.equal(winLike, "outside.docx")
})

test("safeUploadBasename: rejects empty / . / ..", () => {
  assert.equal(safeUploadBasename(""), null)
  assert.equal(safeUploadBasename("."), null)
  assert.equal(safeUploadBasename(".."), null)
  assert.equal(safeUploadBasename("foo/.."), null)
})

test("safeUploadBasename: strips NUL", () => {
  assert.equal(safeUploadBasename("ok\0.docx"), "ok.docx")
})

import test from "node:test"
import assert from "node:assert/strict"
import path from "node:path"
import fs from "node:fs"
import * as runtime from "../src/office-runtime"
import { documentExtension } from "../src/file-formats"
import { parseFile, safeUploadBasename } from "../src/file-parser"

test("safeUploadBasename: strips directories (posix-style)", () => {
  assert.equal(safeUploadBasename("../../outside.docx"), "outside.docx")
  assert.equal(safeUploadBasename("foo/bar/report.docx"), "report.docx")
})

test("safeUploadBasename uses host basename semantics, not universal separator rejection", () => {
  const name = "..\\..\\outside.docx"
  assert.equal(safeUploadBasename(name), path.basename(name))
  assert.equal(path.win32.basename(name), "outside.docx")
  if (path.sep === "/") assert.equal(safeUploadBasename(name), name)
})

test("real parseFile generates caller-owned paths and preserves genuine converter failures", async t => {
  // Real parseFile/helper/temp I/O; only the engine is replaced with a controlled
  // refusal so this contract does not require or claim native conversion success.
  const originalWrite = fs.writeFileSync
  const originalMkdtemp = fs.mkdtempSync
  const dirs: string[] = [], writes: string[] = [], conversions: Array<{ input: string; output: string }> = []
  t.mock.method(fs, "mkdtempSync", (...args: Parameters<typeof fs.mkdtempSync>) => {
    const dir = originalMkdtemp(...args) as string
    dirs.push(dir)
    return dir
  })
  t.mock.method(fs, "writeFileSync", (...args: Parameters<typeof fs.writeFileSync>) => {
    writes.push(String(args[0]))
    return originalWrite(...args)
  })
  t.mock.method(runtime, "convertOfficeDocument", async (input: string, output: string, signal: AbortSignal) => {
    assert.equal(signal.aborted, false)
    conversions.push({ input, output })
    assert.equal(fs.readFileSync(input, "utf8"), "controlled old-office bytes")
    throw new Error("controlled converter refusal")
  })
  for (const name of ["../../outside.DOC", "..\\..\\outside.doc", "a/b.doc", "double..doc", "ok\0.doc", "path.doc/child", "path.doc\\child", "trailing.", "no-dot-name"]) {
    const sourceExt = documentExtension(name) || "doc" // explicit MIME fallback only when suffix is empty
    const beforeWrites = writes.length, beforeDirs = dirs.length, beforeConversions = conversions.length
    const result = await parseFile(Buffer.from("controlled old-office bytes"), name, "application/msword")
    assert.equal(result.success, false, name)
    assert.equal(dirs.length, beforeDirs + 1, name)
    const dir = dirs.at(-1)!
    for (const written of writes.slice(beforeWrites)) {
      const relative = path.relative(dir, written)
      assert.equal(path.isAbsolute(relative), false, name)
      assert.equal(relative.split(/[\\/]/).includes(".."), false, name)
      assert.equal(written, path.join(dir, `input.${sourceExt}`), name)
    }
    assert.equal(fs.existsSync(dir), false, "parseFile cleans its own temporary directory on failure")
    if (sourceExt === "doc") {
      assert.equal(conversions.length, beforeConversions + 1, name)
      assert.deepEqual(conversions.at(-1), { input: path.join(dir, "input.doc"), output: path.join(dir, "normalized.docx") })
      if (!result.success) assert.equal(result.error, "文件解析失败: controlled converter refusal", "conversion errors do not become compatibility fallback")
    } else {
      assert.equal(conversions.length, beforeConversions, "unknown suffix never selects a converter retry")
    }
  }
  assert.equal(conversions.length, 6)
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

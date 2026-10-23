import test, { type TestContext } from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { snapshotRoot, assertRoot, list, read } from "../src/desktop/workspace-files"
import { workspaceErrorCode, type WorkspaceCode } from "../src/desktop/workspace-error"
const CAP = 512 * 1024
function owned(t: TestContext) {
  const outer = fs.mkdtempSync(path.join(os.tmpdir(), "native-workspace-files-")), root = path.join(outer, "root")
  fs.mkdirSync(root); t.after(() => fs.rmSync(outer, { recursive: true, force: true }))
  return { outer, root, snapshot: snapshotRoot(root), put: (name: string, data: string | Buffer) => { fs.writeFileSync(path.join(root, name), data); return path.join(root, name) } }
}
function refused(fn: () => unknown, code: WorkspaceCode) { assert.throws(fn, error => workspaceErrorCode(error) === code) }

test("native workspace reads explicit UTF8, BOM and empty files with actual byte size", t => {
  const f = owned(t)
  for (const text of ["", "你好 world", "\uFEFFvisible"]) {
    f.put("text", text); assert.deepEqual(read(f.snapshot, "text"), { path: "text", size: Buffer.byteLength(text), text, complete: true, redacted: false })
  }
  assertRoot(f.snapshot)
})
test("native workspace rejects invalid paths before directory IO", t => {
  const f = owned(t), original = fs.lstatSync; let calls = 0
  ;(fs as any).lstatSync = ((...args: any[]) => { calls++; return (original as any)(...args) }) as typeof original
  try { for (const bad of ["", "../other", "/absolute", "C:relative", "C:\\absolute", "\\\\server\\share", "null\0path", "sk-1234567890123456"]) refused(() => read(f.snapshot, bad), "WORKSPACE_INPUT_INVALID") }
  finally { ;(fs as any).lstatSync = original }
  assert.equal(calls, 0)
})
test("native workspace preserves missing and non-file refusals", t => {
  const f = owned(t); refused(() => read(f.snapshot, "missing"), "WORKSPACE_MISSING"); refused(() => read(f.snapshot, "."), "WORKSPACE_UNSUPPORTED")
})
test("native workspace keeps 512KiB and refuses initial oversize without opening", t => {
  const f = owned(t); f.put("exact", "a".repeat(CAP)); assert.equal(read(f.snapshot, "exact").size, CAP)
  f.put("large", "a".repeat(CAP + 1)); const open = fs.openSync; let calls = 0
  fs.openSync = ((...a: any[]) => { calls++; return (open as any)(...a) }) as typeof open
  try { refused(() => read(f.snapshot, "large"), "WORKSPACE_UNSUPPORTED") } finally { fs.openSync = open }
  assert.equal(calls, 0)
})
test("native workspace rejects invalid UTF8 and NUL without replacement decoding", t => {
  const f = owned(t)
  for (const bytes of [Buffer.from([0xff]), Buffer.from([0xc0, 0xaf]), Buffer.from([65, 0])]) { f.put("binary", bytes); refused(() => read(f.snapshot, "binary"), "WORKSPACE_UNSUPPORTED") }
})
test("native workspace labels redacted content and hides sensitive names", t => {
  const f = owned(t), secret = "sk-1234567890123456"; f.put("text", "value " + secret); f.put(secret, "hidden")
  const result = read(f.snapshot, "text"); assert.equal(result.redacted, true); assert.equal(result.complete, false); assert.equal(result.text.includes(secret), false)
  const row = list(f.snapshot).entries.find(e => e.name.includes("REDACTED"))!; assert.ok(row); assert.equal(row.path, null); assert.equal(row.readable, false); assert.equal(JSON.stringify(row).includes(secret), false)
})
test("native workspace snapshots refuse another actual directory identity at the same observation", t => {
  const f = owned(t), replacement = path.join(f.outer, "other"); fs.mkdirSync(replacement)
  const other = fs.lstatSync(replacement, { bigint: true }), original = fs.lstatSync
  ;(fs as any).lstatSync = ((file: any, opts: any) => String(file) === f.snapshot.path ? other : original(file, opts)) as typeof original
  try { refused(() => read(f.snapshot, "anything"), "WORKSPACE_CHANGED") } finally { ;(fs as any).lstatSync = original }
})
test("native workspace sibling writes do not invalidate directory identity", t => {
  const f = owned(t); f.put("first", "first"); f.put("sibling", "sibling"); assert.equal(read(f.snapshot, "first").text, "first")
})
test("native workspace uses one bounded handle and refuses real growth before first read", t => {
  const f = owned(t), file = f.put("text", "a"), original = fs.readSync; let first = true, max = 0
  fs.readSync = ((fd: number, buffer: Buffer, offset: number, length: number, position: number | null) => {
    max = Math.max(max, buffer.length)
    if (first) { first = false; fs.writeFileSync(file, "b".repeat(CAP + 1)) }
    return original(fd, buffer, offset, length, position)
  }) as typeof original
  try { refused(() => read(f.snapshot, "text"), "WORKSPACE_CHANGED") } finally { fs.readSync = original }
  assert.equal(first, false); assert.ok(max <= CAP + 1); assert.equal(fs.statSync(file).size, CAP + 1)
})
test("native workspace refuses growth after an actual read through final handle identity", t => {
  const f = owned(t), file = f.put("text", "a"), original = fs.readSync; let first = true
  fs.readSync = ((fd: number, buffer: Buffer, offset: number, length: number, position: number | null) => {
    const n = original(fd, buffer, offset, length, position)
    if (first) { first = false; fs.appendFileSync(file, "b") }
    return n
  }) as typeof original
  try { refused(() => read(f.snapshot, "text"), "WORKSPACE_CHANGED") } finally { fs.readSync = original }
})
test("native workspace refuses different actual file identity at the final opened-file check", t => {
  const f = owned(t); f.put("text", "a"); const other = f.put("other", "a"), otherStat = fs.statSync(other, { bigint: true }), original = fs.fstatSync; let calls = 0
  fs.fstatSync = ((fd: number, opts: any) => ++calls === 2 ? otherStat : original(fd, opts)) as typeof original
  try { refused(() => read(f.snapshot, "text"), "WORKSPACE_CHANGED") } finally { fs.fstatSync = original }
  assert.equal(calls, 2)
})
test("native workspace list observes at most one extra entry and reports truncation honestly", t => {
  const f = owned(t); for (let i = 0; i < 500; i++) f.put("entry-" + i, "")
  assert.equal(list(f.snapshot).entries.length, 500); assert.equal(list(f.snapshot).truncated, false)
  f.put("extra", ""); const result = list(f.snapshot); assert.equal(result.entries.length, 500); assert.equal(result.truncated, true)
})
test("native workspace rejects an owned junction/symlink escape without reading its content", t => {
  const f = owned(t), outside = path.join(f.outer, "outside"); fs.mkdirSync(outside); fs.writeFileSync(path.join(outside, "text"), "outside")
  fs.symlinkSync(outside, path.join(f.root, "jump"), "junction")
  refused(() => read(f.snapshot, path.join("jump", "text")), "WORKSPACE_INPUT_INVALID")
  assert.equal(list(f.snapshot).entries.find(e => e.name === "jump")!.readable, false)
})

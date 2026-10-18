import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import {
  allocateDocIdentity,
  asciiSlug,
  hashedStem,
  isUnsafePathComponent,
  listStemSet,
  writeRestrictedFile,
} from "../src/skills/doc-identity"

test("asciiSlug: CJK-only collapses to empty (not --)", () => {
  assert.equal(asciiSlug("产品甲"), "")
  assert.equal(asciiSlug("产品乙"), "")
  assert.equal(asciiSlug("---"), "")
  assert.equal(asciiSlug("coding-conventions"), "coding-conventions")
  assert.equal(asciiSlug("Skill_1"), "skill-1")
})

test("allocateDocIdentity: two CJK titles do not share --.md", () => {
  const a = allocateDocIdentity({ title: "产品甲" })
  const b = allocateDocIdentity({ title: "产品乙" })
  assert.notEqual(a.filenameStem, b.filenameStem)
  assert.notEqual(a.filenameStem, "--")
  assert.notEqual(b.filenameStem, "--")
  assert.match(a.filenameStem, /^k-[0-9a-f]{10}$/)
  assert.equal(a.title, "产品甲")
  assert.equal(b.title, "产品乙")
  assert.equal(a.id, a.filenameStem)
  assert.equal(hashedStem("产品甲"), a.filenameStem)
})

test("allocateDocIdentity: same CJK title is stable", () => {
  const a = allocateDocIdentity({ title: "产品甲" })
  const b = allocateDocIdentity({ title: "产品甲" })
  assert.equal(a.id, b.id)
})

test("allocateDocIdentity: collision suffix when stem taken", () => {
  const first = allocateDocIdentity({ title: "产品甲" })
  const second = allocateDocIdentity({ title: "产品甲", takenStems: [first.filenameStem] })
  assert.equal(second.filenameStem, `${first.filenameStem}-2`)
})

test("allocateDocIdentity: legacy ascii preferredId kept", () => {
  const id = allocateDocIdentity({ title: "Team coding conventions", preferredId: "coding-conventions" })
  assert.equal(id.id, "coding-conventions")
  assert.equal(id.filenameStem, "coding-conventions")
  assert.equal(id.title, "Team coding conventions")
})

test("allocateDocIdentity: CON and ../x hash; never slug to x.md", () => {
  const con = allocateDocIdentity({ title: "CON" })
  assert.notEqual(con.filenameStem.toLowerCase(), "con")
  assert.match(con.filenameStem, /^k-[0-9a-f]{10}$/)
  assert.equal(isUnsafePathComponent("CON"), true)
  assert.equal(isUnsafePathComponent("../x"), true)
  assert.equal(isUnsafePathComponent(""), true)
  assert.equal(asciiSlug("../x"), "")
  const traversal = allocateDocIdentity({ title: "../x" })
  assert.notEqual(traversal.filenameStem, "x")
  assert.match(traversal.filenameStem, /^k-[0-9a-f]{10}$/)
  assert.equal(isUnsafePathComponent("COM0"), true)
  assert.equal(isUnsafePathComponent("LPT0"), true)
  const com0 = allocateDocIdentity({ title: "COM0" })
  assert.notEqual(com0.filenameStem.toLowerCase(), "com0")
})

test("writeRestrictedFile: posix mode 0o600", () => {
  if (process.platform === "win32") return
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-id-"))
  const file = path.join(dir, "k.md")
  writeRestrictedFile(file, "hello")
  const mode = fs.statSync(file).mode & 0o777
  assert.equal(mode, 0o600)
  fs.rmSync(dir, { recursive: true, force: true })
})

// --- #274: listStemSet 递归化（目录名不占 stem；_folder.md 不占 stem） ---

test("listStemSet: recursive into subdirs; directory names are NOT stems; _folder.md excluded", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-stems-"))
  fs.writeFileSync(path.join(dir, "root.md"), "x")
  fs.mkdirSync(path.join(dir, "竞品", "2025"), { recursive: true })
  fs.writeFileSync(path.join(dir, "竞品", "inner.md"), "x")
  fs.writeFileSync(path.join(dir, "竞品", "2025", "deep.markdown"), "x")
  fs.writeFileSync(path.join(dir, "竞品", "_folder.md"), "x")
  fs.writeFileSync(path.join(dir, "notes.txt"), "x") // non-md never a stem
  const stems = listStemSet(dir)
  assert.ok(stems.has("root"))
  assert.ok(stems.has("inner"), "nested .md stem collected")
  assert.ok(stems.has("deep"), "nested .markdown stem collected")
  assert.ok(!stems.has("竞品"), "directory name must not pollute the stem set")
  assert.ok(!stems.has("2025"), "nested directory name neither")
  assert.ok(!stems.has("_folder"), "_folder.md is folder metadata, not a doc stem")
  assert.ok(!stems.has("notes"), "non-markdown files are not stems")
  fs.rmSync(dir, { recursive: true, force: true })
})


test("writeRestrictedFile: partial write EIO preserves old bytes and removes owned temp", t => {
  const native = require("node:fs") as typeof fs
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-write-fail-"))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const file = path.join(dir, "document.md")
  const old = Buffer.from("original complete body\n")
  fs.writeFileSync(file, old)
  const write = native.writeFileSync
  const eio = Object.assign(new Error("OWNED_WRITE_EIO"), { code: "EIO" })
  let injected = 0
  const mock = t.mock.method(native, "writeFileSync", ((dest: any, data: any, options: any) => {
    injected++
    const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data)
    write(dest, bytes.subarray(0, Math.floor(bytes.length / 2)), options)
    throw eio
  }) as typeof native.writeFileSync)
  try { assert.throws(() => writeRestrictedFile(file, "replacement complete body\n"), err => err === eio) }
  finally { mock.mock.restore() }
  assert.equal(injected, 1)
  assert.equal(fs.readFileSync(file).equals(old), true)
  assert.deepEqual(fs.readdirSync(dir), ["document.md"])
})

test("writeRestrictedFile: rename refusal preserves old bytes and cleans temp", t => {
  const native = require("node:fs") as typeof fs
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-rename-fail-"))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const file = path.join(dir, "document.md")
  fs.writeFileSync(file, "old")
  const refused = Object.assign(new Error("OWNED_RENAME_REFUSED"), { code: "EACCES" })
  const mock = t.mock.method(native, "renameSync", () => { throw refused })
  try { assert.throws(() => writeRestrictedFile(file, Buffer.from("new")), err => err === refused) }
  finally { mock.mock.restore() }
  assert.equal(fs.readFileSync(file, "utf8"), "old")
  assert.deepEqual(fs.readdirSync(dir), ["document.md"])
})


test("writeRestrictedFile: success replaces string and Buffer without leaving temp", t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-write-ok-"))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const file = path.join(dir, "document.md")
  writeRestrictedFile(file, "first")
  writeRestrictedFile(file, Buffer.from("second"))
  assert.equal(fs.readFileSync(file, "utf8"), "second")
  assert.deepEqual(fs.readdirSync(dir), ["document.md"])
  if (process.platform !== "win32") assert.equal(fs.statSync(file).mode & 0o777, 0o600)
})

test("writeRestrictedFile: symlink discovered at commit refuses without touching target", t => {
  const native = require("node:fs") as typeof fs
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-write-link-"))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const file = path.join(dir, "document.md")
  fs.writeFileSync(file, "old")
  const lstat = native.lstatSync
  let probes = 0
  const mock = t.mock.method(native, "lstatSync", ((p: any, opts: any) => {
    const stat = lstat(p, opts)
    if (String(p) === file && ++probes === 2) return Object.assign(Object.create(stat), { isSymbolicLink: () => true })
    return stat
  }) as typeof native.lstatSync)
  try { assert.throws(() => writeRestrictedFile(file, "new"), /Refusing to write through symlink/) }
  finally { mock.mock.restore() }
  assert.equal(probes, 2)
  assert.equal(fs.readFileSync(file, "utf8"), "old")
  assert.deepEqual(fs.readdirSync(dir), ["document.md"])
})


test("writeRestrictedFile: failed rename cannot remove a replacement at the temp name", t => {
  const native = require("node:fs") as typeof fs
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-write-replaced-"))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const file = path.join(dir, "document.md")
  fs.writeFileSync(file, "old")
  const rename = native.renameSync
  const primary = Object.assign(new Error("OWNED_RENAME_REFUSED"), { code: "EACCES" })
  let temporary = ""
  const mock = t.mock.method(native, "renameSync", (from: any, to: any) => {
    temporary = String(from)
    rename(from, temporary + ".original")
    fs.writeFileSync(from, "foreign replacement", { flag: "wx" })
    throw primary
  })
  try { assert.throws(() => writeRestrictedFile(file, "new"), err => err === primary) }
  finally { mock.mock.restore() }
  assert.equal(fs.readFileSync(file, "utf8"), "old")
  assert.equal(fs.existsSync(temporary), true, "a replaced temporary pathname is not owned")
  assert.equal(fs.readFileSync(temporary, "utf8"), "foreign replacement")
})

test("writeRestrictedFile: close error cannot close a descriptor reused by another file", t => {
  const native = require("node:fs") as typeof fs
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-write-fd-"))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const file = path.join(dir, "document.md"), otherFile = path.join(dir, "other.md")
  fs.writeFileSync(file, "old"); fs.writeFileSync(otherFile, "other")
  const close = native.closeSync
  const primary = Object.assign(new Error("OWNED_POST_CLOSE_ERROR"), { code: "EIO" })
  let other: number | undefined, calls = 0
  const mock = t.mock.method(native, "closeSync", (fd: number) => {
    calls++
    close(fd)
    if (calls === 1) { other = fs.openSync(otherFile, "r"); assert.equal(other, fd); throw primary }
  })
  try { assert.throws(() => writeRestrictedFile(file, "new"), err => err === primary) }
  finally { mock.mock.restore() }
  try {
    assert.equal(calls, 1, "do not retry a close whose descriptor ownership is unknown")
    assert.equal(fs.fstatSync(other!).isFile(), true)
    assert.equal(fs.readFileSync(file, "utf8"), "old")
  } finally { if (other !== undefined) { try { close(other) } catch {} } }
})

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

import test, { after, before } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-agent-test-kcrud-"))

let SkillEngine: typeof import("../src/skills/skill-engine").SkillEngine
let getConfigDir: typeof import("../src/config").getConfigDir
let initDataDir: typeof import("../src/config").initDataDir

before(async () => {
  process.env.HOME = tempHome
  process.env.CMSPARK_DATA_DIR = path.join(tempHome, ".cmspark-agent")
  delete process.env.DEEPSEEK_API_KEY
  const configMod = await import("../src/config")
  const skillEngineMod = await import("../src/skills/skill-engine")
  getConfigDir = configMod.getConfigDir
  initDataDir = configMod.initDataDir
  SkillEngine = skillEngineMod.SkillEngine
  await initDataDir()
})

after(() => {
  fs.rmSync(tempHome, { recursive: true, force: true })
})

function knowledgeDir(): string {
  const dir = path.join(getConfigDir(), "knowledge", "global")
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

test("listKnowledge is slim: no source_file, entries, dir, resources, or body", () => {
  knowledgeDir()
  const engine = new SkillEngine()
  engine.importKnowledge("# Slim note\n\nhello body")
  const doc = engine.listKnowledge()[0] as unknown as Record<string, unknown>
  assert.ok(doc)
  assert.equal("source_file" in doc, false)
  assert.equal("entries" in doc, false)
  assert.equal("dir" in doc, false)
  assert.equal("resources" in doc, false)
  assert.equal("body" in doc, false)
  assert.ok(typeof doc.id === "string" || typeof doc.name === "string")
  assert.equal(doc.title, "Slim note")
})

test("getKnowledge resolves legacy name and id; does not match title", () => {
  knowledgeDir()
  const engine = new SkillEngine()
  const imported = engine.importKnowledge(`---
name: coding-conventions
description: rules
type: domain_knowledge
---
# Body
alpha
`)
  const byName = engine.getKnowledge("coding-conventions")
  const byId = engine.getKnowledge(imported.id)
  assert.ok(byName)
  assert.ok(byId)
  assert.equal(byName.id, imported.id)
  assert.equal(byId.id, imported.id)
  assert.ok(byName.body.includes("alpha"))
  assert.equal("source_file" in byName, false)
  assert.equal(engine.getKnowledge("Body"), undefined)
})

test("updateKnowledge: CJK title change keeps id and filenameStem", () => {
  const dir = knowledgeDir()
  const engine = new SkillEngine()
  const a = engine.importKnowledge("# 产品甲\n\n甲的内容")
  const beforeFiles = fs.readdirSync(dir).filter((f) => f.endsWith(".md"))
  const updated = engine.updateKnowledge(a.id, { title: "产品甲修订" })
  assert.equal(updated.id, a.id)
  const afterFiles = fs.readdirSync(dir).filter((f) => f.endsWith(".md"))
  assert.deepEqual(afterFiles.sort(), beforeFiles.sort())
  const got = engine.getKnowledge(a.id)
  assert.ok(got)
  assert.equal(got.title, "产品甲修订")
  assert.ok(got.body.includes("甲的内容"))
  assert.ok(engine.get(a.id))
})

test("updateKnowledge does not allocate notes-2 when editing self", () => {
  const dir = knowledgeDir()
  const engine = new SkillEngine()
  const first = engine.importKnowledge("# Notes\n\nFIRST")
  engine.updateKnowledge(first.id, { body: "FIRST edited" })
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"))
  assert.ok(files.includes("notes.md"))
  assert.equal(files.includes("notes-2.md"), false)
  assert.ok(engine.getKnowledge(first.id)?.body.includes("FIRST edited"))
})

test("updateKnowledge refuses builtin and non-knowledge", () => {
  knowledgeDir()
  const engine = new SkillEngine()
  const doc = engine.importKnowledge("# user-doc\n\nx")
  const skill = engine.get(doc.id)!
  ;(skill as { builtin: boolean }).builtin = true
  assert.throws(() => engine.updateKnowledge(doc.id, { title: "nope" }), /builtin/i)
  assert.throws(() => engine.updateKnowledge("missing-id", { title: "x" }), /not found/i)
})

test("updateKnowledge keeps legacy name when id differs", () => {
  const dir = knowledgeDir()
  fs.writeFileSync(
    path.join(dir, "legacy-sso.md"),
    "---\nname: legacy-sso\nid: k-stable\ntitle: SSO\ndescription: d\ntype: domain_knowledge\n---\n\nbody\n",
  )
  const engine = new SkillEngine()
  const updated = engine.updateKnowledge("k-stable", { title: "SSO 修订" })
  assert.equal(updated.id, "k-stable")
  const got = engine.getKnowledge("k-stable")
  assert.ok(got)
  assert.equal(got.name, "legacy-sso")
  assert.equal(got.id, "k-stable")
  assert.ok(engine.getKnowledge("legacy-sso"))
})

test("updateKnowledge ignores WS-smuggled site/type", () => {
  knowledgeDir()
  const engine = new SkillEngine()
  const doc = engine.importKnowledge(`---
name: stay-global
description: d
type: domain_knowledge
---
body
`)
  engine.updateKnowledge(doc.id, {
    title: "stay-global",
    site: "*.com",
    type: "site_knowledge",
  } as { title: string; site?: string; type?: string })
  const got = engine.getKnowledge(doc.id)
  assert.ok(got)
  assert.equal(got.site, undefined)
  assert.equal(got.type, "domain_knowledge")
})

test("exportKnowledge round-trips id/title and redacts secrets", () => {
  knowledgeDir()
  const engine = new SkillEngine()
  const doc = engine.importKnowledge(`---
name: secret-note
description: d
type: domain_knowledge
title: Secret Note
---
token ghp_aaaaaaaaaaaaaaaaaaaa
`)
  const exported = engine.exportKnowledge(doc.id)
  assert.equal(exported.format, "markdown")
  assert.ok(exported.filename.endsWith(".md"))
  assert.ok(exported.content.includes("id:"))
  assert.ok(exported.content.includes("Secret Note") || exported.content.includes("title:"))
  assert.ok(exported.content.includes("[REDACTED]"))
  assert.equal(exported.content.includes("ghp_aaaaaaaaaaaaaaaaaaaa"), false)
  assert.ok(exported.redacted_hits >= 1)
})

test("exportSkill rejects knowledge id; exportKnowledge rejects skill id", () => {
  const skillsDir = path.join(getConfigDir(), "skills")
  fs.mkdirSync(skillsDir, { recursive: true })
  fs.writeFileSync(
    path.join(skillsDir, "real-skill.md"),
    "---\nname: real-skill\ndescription: s\ntype: prompt_template\n---\n# S\n",
  )
  knowledgeDir()
  const engine = new SkillEngine()
  const kn = engine.importKnowledge("# kn-doc\n\nbody")
  assert.throws(() => engine.exportSkill(kn.id), /knowledge/i)
  assert.throws(() => engine.exportKnowledge("real-skill"), /skill/i)
})

test("getKnowledge truncates body over 512KiB", () => {
  knowledgeDir()
  const engine = new SkillEngine()
  const big = "x".repeat(512 * 1024 + 50)
  const doc = engine.importKnowledge(`# big\n\n${big}`)
  const got = engine.getKnowledge(doc.id)
  assert.ok(got)
  assert.equal(got.truncated, true)
  assert.equal(got.body.length, 512 * 1024)
  assert.ok(got.char_count > 512 * 1024)
  assert.throws(() => engine.exportKnowledge(doc.id), /512KiB/i)
})

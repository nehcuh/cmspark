import test, { after, before } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import {
  hashKnowledgeBody,
  knowledgeDuplicateExempt,
} from "../src/skills/knowledge-duplicate"

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-k-dup-"))

let SkillEngine: typeof import("../src/skills/skill-engine").SkillEngine
let initDataDir: typeof import("../src/config").initDataDir

before(async () => {
  process.env.HOME = tempHome
  process.env.CMSPARK_DATA_DIR = path.join(tempHome, ".cmspark-agent")
  const skillEngineMod = await import("../src/skills/skill-engine")
  const configMod = await import("../src/config")
  SkillEngine = skillEngineMod.SkillEngine
  initDataDir = configMod.initDataDir
  await initDataDir()
})

after(() => {
  fs.rmSync(tempHome, { recursive: true, force: true })
})

test("empty and scan-placeholder bodies are exempt", () => {
  assert.equal(knowledgeDuplicateExempt(""), true)
  assert.equal(knowledgeDuplicateExempt("   \n"), true)
  assert.equal(
    knowledgeDuplicateExempt("# report.pdf\n\n[此 PDF 为扫描件或图片 PDF，无法提取文本内容。页数: 1]"),
    true,
  )
  assert.equal(
    knowledgeDuplicateExempt("# a.pdf\n\n[PDF 已渲染 3/3 页为图片，等待视觉分析]"),
    true,
  )
  assert.equal(knowledgeDuplicateExempt("# Notes\n\nreal body"), false)
})

test("same body hashes equal; title-only change does not change hash via preview body", () => {
  const a = hashKnowledgeBody("hello world")
  const b = hashKnowledgeBody("\nhello world\n")
  assert.equal(a, b)
  assert.notEqual(hashKnowledgeBody("hello world"), hashKnowledgeBody("hello world!"))
})

test("AC-1/2: second preview of same md body reports duplicate_of; frontmatter retitle still hits", () => {
  const se = new SkillEngine()
  const first = se.importKnowledge(`---
name: notes-dup
title: Notes
---

UNIQUE_DUP_BODY_ALPHA`)
  const hit = se.findKnowledgeDuplicate(`---
name: other-dup
title: Other
---

UNIQUE_DUP_BODY_ALPHA`)
  assert.ok(hit)
  assert.equal(hit!.id, first.id)
  assert.equal(typeof hit!.title, "string")
  const miss = se.findKnowledgeDuplicate(`---
name: notes-dup
title: Notes
---

UNIQUE_DUP_BODY_ALPHA!`)
  assert.equal(miss, null)
})

test("AC-8: empty / placeholder incoming is never a duplicate", () => {
  const se = new SkillEngine()
  se.importKnowledge("---\nname: empty-a\n---\n")
  assert.equal(se.findKnowledgeDuplicate("---\nname: empty-b\n---\n"), null)
  const placeholder = "# report.pdf\n\n[此 PDF 为扫描件或图片 PDF，无法提取文本内容。页数: 1]"
  se.importKnowledge(placeholder, "report")
  assert.equal(se.findKnowledgeDuplicate(placeholder, "report"), null)
})

test("AC-7 F-I-5: different bodies same heading still allocate notes-2", () => {
  const se = new SkillEngine()
  const first = se.importKnowledge("# Notes\n\nFIRST_UNIQUE_DUP")
  const second = se.importKnowledge("# Notes\n\nSECOND_UNIQUE_DUP")
  assert.notEqual(first.id, second.id)
})

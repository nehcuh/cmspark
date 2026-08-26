import test, { after, before } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-k-active-"))
process.env.HOME = tempHome
process.env.CMSPARK_DATA_DIR = path.join(tempHome, ".cmspark-agent")
delete process.env.DEEPSEEK_API_KEY

let initDataDir: typeof import("../src/config").initDataDir
let getConfigDir: typeof import("../src/config").getConfigDir
let clearConfigCache: typeof import("../src/config").clearConfigCache
let ThreadManager: typeof import("../src/threads/thread-manager").ThreadManager
let SkillEngine: typeof import("../src/skills/skill-engine").SkillEngine
let packEngine: typeof import("../src/packs/pack-engine")

before(async () => {
  const configMod = await import("../src/config")
  initDataDir = configMod.initDataDir
  getConfigDir = configMod.getConfigDir
  clearConfigCache = configMod.clearConfigCache
  ThreadManager = (await import("../src/threads/thread-manager")).ThreadManager
  SkillEngine = (await import("../src/skills/skill-engine")).SkillEngine
  packEngine = await import("../src/packs/pack-engine")
  await initDataDir()
  clearConfigCache()
})

after(() => {
  fs.rmSync(tempHome, { recursive: true, force: true })
})

function seedKnowledgeDoc(name: string, body = "facts") {
  const dir = path.join(getConfigDir(), "knowledge", "global")
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  const file = path.join(dir, `${name}.md`)
  fs.writeFileSync(
    file,
    `---\nname: ${name}\ndescription: test knowledge\ntype: domain_knowledge\n---\n\n# ${name}\n\n${body}\n`,
    { mode: 0o600 },
  )
  return file
}

test("resolveKnowledgeIdsForThread manual uses active_knowledge_ids", () => {
  seedKnowledgeDoc("wave-a-doc")
  const se = new SkillEngine()
  se.refresh()
  const tm = new ThreadManager()
  const th = tm.create("k-manual")
  tm.update(th.id, { active_knowledge_ids: ["wave-a-doc"], knowledge_selection_mode: "manual" })
  const ids = se.resolveKnowledgeIdsForThread(th.id, "manual")
  assert.ok(ids.includes("wave-a-doc"), `expected wave-a-doc in ${JSON.stringify(ids)}`)
})

test("resolve empty active_knowledge_ids manual → []", () => {
  const se = new SkillEngine()
  const tm = new ThreadManager()
  const th = tm.create("k-empty")
  tm.update(th.id, { active_knowledge_ids: [], knowledge_selection_mode: "manual" })
  const ids = se.resolveKnowledgeIdsForThread(th.id, "manual")
  assert.deepEqual(ids, [])
})

test("D2 back-compat: knowledge name in active_skill_ids still resolves", () => {
  seedKnowledgeDoc("legacy-in-skills")
  const se = new SkillEngine()
  se.refresh()
  const tm = new ThreadManager()
  const th = tm.create("k-d2")
  tm.update(th.id, {
    active_knowledge_ids: [],
    active_skill_ids: ["browse", "legacy-in-skills"],
    knowledge_selection_mode: "manual",
  })
  const ids = se.resolveKnowledgeIdsForThread(th.id, "manual")
  assert.ok(ids.includes("legacy-in-skills"))
})

test("thread.update allowlist keys include active_knowledge_ids (static contract)", () => {
  // Regression for dual B1: message-router allowlist must include the key.
  // Resolve from repo root (works under both tests/ and .test-dist/tests/).
  const candidates = [
    path.join(__dirname, "../src/message-router.ts"),
    path.join(__dirname, "../../src/message-router.ts"),
    path.join(process.cwd(), "src/message-router.ts"),
  ]
  let routerSrc = ""
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      routerSrc = fs.readFileSync(p, "utf8")
      break
    }
  }
  assert.ok(routerSrc, "message-router.ts not found for allowlist contract")
  const m = routerSrc.match(
    /case "thread\.update":[\s\S]*?for \(const key of \[([\s\S]*?)\]\)/,
  )
  assert.ok(m, "thread.update allowlist not found")
  assert.match(m![1], /"active_knowledge_ids"/)
  assert.match(m![1], /"topic_folder"/)
})

test("topic_folder persists sanitized and is not a Project entity", () => {
  const tm = new ThreadManager()
  const th = tm.create("folder-seed")
  tm.update(th.id, { topic_folder: " 竞品/分析 " })
  assert.equal(tm.get(th.id)?.topic_folder, "竞品分析")
  const reloaded = new ThreadManager()
  assert.equal(reloaded.get(th.id)?.topic_folder, "竞品分析")
  reloaded.update(th.id, { topic_folder: null })
  assert.equal(reloaded.get(th.id)?.topic_folder, null)
})

test("apply pack knowledge file activates active_knowledge_ids; unapply restores", () => {
  const se = new SkillEngine()
  const tm = new ThreadManager()
  const th = tm.create("pack-k")
  tm.update(th.id, { active_knowledge_ids: ["pre-user-doc"] })

  const src = fs.mkdtempSync(path.join(os.tmpdir(), "k-pack-src-"))
  fs.mkdirSync(path.join(src, "skills"), { recursive: true })
  fs.mkdirSync(path.join(src, "knowledge"), { recursive: true })
  fs.writeFileSync(
    path.join(src, "pack.yaml"),
    `
schema_version: 1
id: k-pack
name: KPack
version: 0.1.0
channel: community
min_capability: L0
requires_modules: []
skills:
  - ./skills/s.md
knowledge:
  - ./knowledge/base.md
mcp_servers: []
tools:
  mode: unchanged
  allow: []
  deny: []
system_prompt_append: "Use knowledge."
thread_defaults:
  knowledge_selection_mode: manual
  skill_selection_mode: manual
`,
  )
  fs.writeFileSync(
    path.join(src, "skills", "s.md"),
    `---\nname: k-skill\ndescription: d\ntype: prompt_template\n---\n\n# S\n`,
  )
  fs.writeFileSync(
    path.join(src, "knowledge", "base.md"),
    `---\nname: pack-base\ndescription: kb\ntype: domain_knowledge\n---\n\n# Base\n`,
  )

  const inst = packEngine.installPackFromDirectory(src, se, { force: true })
  assert.equal(inst.ok, true, (inst as any).error)

  const applied = packEngine.applyPack("k-pack", th.id, tm, se)
  assert.equal(applied.ok, true, (applied as any).error)
  const t2 = tm.get(th.id)!
  assert.ok(
    (t2.active_knowledge_ids || []).some((id) => id.includes("pack-base") || id.startsWith("pack--k-pack--")),
    `expected pack knowledge id, got ${JSON.stringify(t2.active_knowledge_ids)}`,
  )
  // D8 replace: pre-user-doc should NOT remain when pack brings knowledge
  assert.ok(!(t2.active_knowledge_ids || []).includes("pre-user-doc"))

  const un = packEngine.unapplyPack(th.id, tm)
  assert.equal(un.ok, true)
  const t3 = tm.get(th.id)!
  assert.deepEqual(t3.active_knowledge_ids || [], ["pre-user-doc"])

  packEngine.uninstallPack("k-pack", tm, se)
})

test("D8: apply pack with empty knowledge preserves user active_knowledge_ids", () => {
  seedKnowledgeDoc("user-kept-kb")
  const se = new SkillEngine()
  se.refresh()
  const tm = new ThreadManager()
  const th = tm.create("d8-preserve")
  tm.update(th.id, { active_knowledge_ids: ["user-kept-kb"] })

  const src = fs.mkdtempSync(path.join(os.tmpdir(), "empty-k-pack-"))
  fs.mkdirSync(path.join(src, "skills"), { recursive: true })
  fs.writeFileSync(
    path.join(src, "pack.yaml"),
    `
schema_version: 1
id: empty-k-pack
name: EmptyK
version: 0.1.0
channel: community
min_capability: L0
requires_modules: []
skills:
  - ./skills/s.md
knowledge: []
mcp_servers: []
tools:
  mode: unchanged
  allow: []
  deny: []
system_prompt_append: "No knowledge in pack."
thread_defaults:
  knowledge_selection_mode: manual
`,
  )
  fs.writeFileSync(
    path.join(src, "skills", "s.md"),
    `---\nname: empty-k-skill\ndescription: d\ntype: prompt_template\n---\n\n# S\n`,
  )
  const inst = packEngine.installPackFromDirectory(src, se, { force: true })
  assert.equal(inst.ok, true, (inst as any).error)
  const applied = packEngine.applyPack("empty-k-pack", th.id, tm, se)
  assert.equal(applied.ok, true, (applied as any).error)
  const t2 = tm.get(th.id)!
  assert.ok(
    (t2.active_knowledge_ids || []).includes("user-kept-kb"),
    `expected preserve user-kept-kb, got ${JSON.stringify(t2.active_knowledge_ids)}`,
  )
  packEngine.uninstallPack("empty-k-pack", tm, se)
})

test("saveUserPack knowledge_ids → knowledge_refs; apply activates", () => {
  seedKnowledgeDoc("scene-kb")
  const se = new SkillEngine()
  se.refresh()
  const saved = packEngine.saveUserPack(
    {
      name: "scene-with-kb",
      system_prompt_append: "Use scene-kb.",
      skill_ids: [],
      knowledge_ids: ["scene-kb"],
      tools: { mode: "unchanged", allow: [], deny: [] },
    },
    se,
  )
  assert.equal(saved.ok, true, (saved as any).error)
  if (!saved.ok) return
  const detail = packEngine.getPackDetail(saved.id)
  assert.equal(detail.ok, true)
  if (!detail.ok) return
  assert.deepEqual(detail.pack.knowledge_refs, ["scene-kb"])

  const tm = new ThreadManager()
  const th = tm.create("scene-kb-th")
  const applied = packEngine.applyPack(saved.id, th.id, tm, se)
  assert.equal(applied.ok, true, (applied as any).error)
  const t2 = tm.get(th.id)!
  assert.ok((t2.active_knowledge_ids || []).includes("scene-kb"))
  packEngine.deleteUserPack(saved.id, tm, se)
})

test("knowledge.set_active drops unknown ids fail-closed and reports dropped", async () => {
  seedKnowledgeDoc("known-kb")
  const se = new SkillEngine()
  se.refresh()
  const tm = new ThreadManager()
  const th = tm.create("k-unknown")
  const { handleMessage } = await import("../src/message-router")
  const resp = await handleMessage(
    { type: "knowledge.set_active", thread_id: th.id, ids: ["known-kb", "ghost-id", ""] },
    { threadManager: tm, skillEngine: se, historyStore: { record: () => 0 } } as any,
  )
  assert.equal(resp.type, "knowledge.active")
  assert.deepEqual(resp.ids, ["known-kb"])
  assert.deepEqual(resp.dropped, ["ghost-id"])
  assert.deepEqual(tm.get(th.id)?.active_knowledge_ids, ["known-kb"])
})

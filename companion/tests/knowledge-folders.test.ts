import test, { after, before } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

// #274 — 知识库多级文件夹（磁盘目录 SoT，≤3 级）+ 用户语义辅助匹配
// Spec: docs/superpowers/specs/2026-09-02-knowledge-folders-design.md
//
// Covers AC-1..10 companion-side: id-stable move integration, scoring bag
// folder fields, import_directory tree preservation + flattenedDepth, nested
// SKILL.md isolation, _folder.md exclusion, summoner/user_gesture gates,
// 200-cap, plus degradation paths (corrupt _folder.md, move rollback, path
// traversal, depth/50/500 caps, folder_delete modes, folder_suggest drafts).

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-k-folders-"))
process.env.HOME = tempHome
process.env.CMSPARK_DATA_DIR = path.join(tempHome, ".cmspark-agent")
delete process.env.DEEPSEEK_API_KEY
delete process.env.CMSPARK_API_KEY

type HandleMessage = typeof import("../src/message-router").handleMessage
type SkillEngineT = import("../src/skills/skill-engine").SkillEngine
type ThreadManagerT = import("../src/threads/thread-manager").ThreadManager
type FolderSuggestImpl = (params: { lines: string[]; signal?: AbortSignal }) => Promise<{ description?: string }>

let handleMessage: HandleMessage
let __testSetPickFolderNative: (impl?: unknown) => void
let __testSetFolderSuggestImpl: (impl?: FolderSuggestImpl) => void
let SkillEngine: new () => SkillEngineT
let ThreadManager: new () => ThreadManagerT
let initDataDir: () => Promise<void>
let getConfigDir: () => string
let validateWsMessage: (m: unknown) => { valid: boolean; error?: string }
let assertSummonerAllowed: (surface: string | undefined, type: string) => { ok: boolean }
let SUMMONER_WEB_DISPATCH_ALLOW: Set<string>

before(async () => {
  const mr = await import("../src/message-router")
  handleMessage = mr.handleMessage
  __testSetPickFolderNative = mr.__testSetPickFolderNative as never
  __testSetFolderSuggestImpl = mr.__testSetFolderSuggestImpl as never
  SkillEngine = (await import("../src/skills/skill-engine")).SkillEngine as never
  ThreadManager = (await import("../src/threads/thread-manager")).ThreadManager as never
  const cfg = await import("../src/config")
  initDataDir = cfg.initDataDir
  getConfigDir = cfg.getConfigDir
  validateWsMessage = (await import("../src/ws/validate")).validateWsMessage
  assertSummonerAllowed = (await import("../src/ws/summoner-acl")).assertSummonerAllowed as never
  SUMMONER_WEB_DISPATCH_ALLOW = (await import("../src/summoner-web")).SUMMONER_WEB_DISPATCH_ALLOW
  await initDataDir()
})

after(() => {
  __testSetPickFolderNative()
  __testSetFolderSuggestImpl()
  fs.rmSync(tempHome, { recursive: true, force: true })
})

function resetKnowledge() {
  fs.rmSync(path.join(getConfigDir(), "knowledge"), { recursive: true, force: true })
}

/** Seed a knowledge doc directly on disk (global bucket unless site given). */
function seedDoc(
  name: string,
  opts: { folder?: string; title?: string; description?: string; tags?: string[]; body?: string; site?: string; rawFrontmatter?: boolean } = {},
) {
  const bucket = opts.site ? "sites" : "global"
  const dir = path.join(getConfigDir(), "knowledge", bucket, ...(opts.folder ? opts.folder.split("/") : []))
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  let text: string
  if (opts.rawFrontmatter) {
    // filename-fallback doc: no frontmatter at all (id/name derive from stem)
    text = opts.body ?? `# ${name}\n\nfacts\n`
  } else {
    const lines = ["---", `name: ${name}`]
    if (opts.title) lines.push(`title: ${opts.title}`)
    lines.push(`description: ${opts.description ?? "test knowledge"}`)
    lines.push(`type: ${opts.site ? "site_knowledge" : "domain_knowledge"}`)
    if (opts.site) lines.push(`site: ${opts.site}`)
    if (opts.tags?.length) lines.push(`tags: [${opts.tags.join(", ")}]`)
    lines.push("---", "", opts.body ?? `# ${name}\n\nfacts\n`)
    text = lines.join("\n")
  }
  fs.writeFileSync(path.join(dir, `${name}.md`), text, { mode: 0o600 })
}

function knowledgeDirOf(bucket: "global" | "sites", folder = "") {
  return path.join(getConfigDir(), "knowledge", bucket, ...(folder ? folder.split("/") : []))
}

const SIX_VERBS = [
  "knowledge.folder_create",
  "knowledge.folder_rename",
  "knowledge.folder_update",
  "knowledge.folder_suggest",
  "knowledge.folder_delete",
  "knowledge.move",
] as const

function verbPayload(type: string): Record<string, unknown> {
  switch (type) {
    case "knowledge.move": return { type, id: "k1", folder: "a", user_gesture: true }
    case "knowledge.folder_rename": return { type, bucket: "global", path: "a", new_path: "b", user_gesture: true }
    case "knowledge.folder_update": return { type, bucket: "global", path: "a", description: "d", user_gesture: true }
    case "knowledge.folder_delete": return { type, bucket: "global", path: "a", user_gesture: true }
    default: return { type, bucket: "global", path: "a", user_gesture: true }
  }
}

// --- ★ AC-1: id 稳定性集成 — 勾选 → move → refresh → 勾选不断、folder 正确 ---

test("AC-1 ★: move keeps id; refresh shows folder; thread pin survives", async () => {
  resetKnowledge()
  const se = new SkillEngine()
  const imported = se.importKnowledge("# 竞品分析\n\nA 与 B 对比正文\n", "竞品分析")
  const docId = imported.id

  // Pin the doc on a thread BEFORE the move.
  const tm = new ThreadManager()
  const th = tm.create("ac1-move")
  tm.update(th.id, { active_knowledge_ids: [docId] })

  // folder_create 竞品/2025 → move the doc in.
  const createResp = await handleMessage(
    { type: "knowledge.folder_create", bucket: "global", path: "竞品/2025", user_gesture: true },
    { skillEngine: se } as never,
  )
  assert.equal(createResp.type, "knowledge.list", JSON.stringify(createResp))
  const moveResp = await handleMessage(
    { type: "knowledge.move", id: docId, folder: "竞品/2025", user_gesture: true },
    { skillEngine: se } as never,
  )
  assert.equal(moveResp.type, "knowledge.list", JSON.stringify(moveResp))
  assert.deepEqual(moveResp.moved, { id: docId, folder: "竞品/2025" })

  // Fresh engine (post-refresh view): folder + id + disk path agree.
  const se2 = new SkillEngine()
  const listed = se2.listKnowledge().find((d) => (d.id || d.name) === docId)
  assert.ok(listed, "doc still listed after move")
  assert.equal(listed!.folder, "竞品/2025")
  assert.equal(listed!.id || listed!.name, docId, "id unchanged")
  const diskDir = knowledgeDirOf("global", "竞品/2025")
  const diskFiles = fs.readdirSync(diskDir).filter((f) => f.endsWith(".md") && f !== "_folder.md")
  assert.equal(diskFiles.length, 1, "exactly one doc file under 竞品/2025")
  assert.ok(!fs.readdirSync(knowledgeDirOf("global")).includes(`${docId}.md`), "doc gone from bucket root")

  // Thread pin resolves through the move (fallbackThreadManager reads the same store).
  const active = se2.getActiveKnowledgeForThread(th.id)
  assert.ok(active.some((s) => (s.id || s.name) === docId), "active_knowledge_ids pin survives the move")
  assert.equal(se2.resolveKnowledgeIdsForThread(th.id, "manual")[0], docId)
})

test("AC-1b: filename-fallback doc (no frontmatter id) gets id pinned on move", async () => {
  resetKnowledge()
  seedDoc("only-note", { folder: "f1", rawFrontmatter: true }) // global/f1/only-note.md, fallback id "only-note"
  const se = new SkillEngine()
  const before = se.listKnowledge().find((d) => d.name === "only-note")
  assert.ok(before && !before.id, "no explicit id before the move (filename fallback)")
  await handleMessage(
    { type: "knowledge.folder_create", bucket: "global", path: "f2", user_gesture: true },
    { skillEngine: se } as never,
  )
  const resp = await handleMessage(
    { type: "knowledge.move", id: "only-note", folder: "f2", user_gesture: true },
    { skillEngine: se } as never,
  )
  assert.equal(resp.type, "knowledge.list", JSON.stringify(resp))
  const raw = fs.readFileSync(path.join(knowledgeDirOf("global", "f2"), "only-note.md"), "utf-8")
  assert.match(raw, /id: "?only-note"?/, "move pinned an explicit id frontmatter")
  const se2 = new SkillEngine()
  const after = se2.listKnowledge().find((d) => d.folder === "f2")
  assert.equal(after!.id, "only-note", "id stable and explicit after the move")
})

test("AC-1c: same-stem collision in the target folder → fresh stem allocated, id unchanged", async () => {
  resetKnowledge()
  seedDoc("shared", { rawFrontmatter: true }) // global/shared.md (fallback id "shared")
  // Target folder holds a doc whose FILE stem collides but whose id is explicit.
  const dir = knowledgeDirOf("global", "f1")
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, "shared.md"), "---\nname: mover\ndescription: d\ntype: domain_knowledge\n---\n\nbody\n")
  const se = new SkillEngine()
  const resp = await handleMessage(
    { type: "knowledge.move", id: "mover", folder: "", user_gesture: true },
    { skillEngine: se } as never,
  )
  assert.equal(resp.type, "knowledge.list", JSON.stringify(resp))
  assert.deepEqual(resp.moved, { id: "mover", folder: "" })
  const stems = fs.readdirSync(knowledgeDirOf("global")).filter((f) => f.endsWith(".md")).sort()
  assert.deepEqual(stems, ["shared-2.md", "shared.md"], "collision allocates a fresh stem, no overwrite")
  const se2 = new SkillEngine()
  const movedDoc = se2.listKnowledge().find((d) => (d.id || d.name) === "mover")
  assert.ok(movedDoc, "moved doc still resolves by its unchanged id")
  assert.equal(movedDoc!.folder, "")
  assert.equal(movedDoc!.name, "mover", "frontmatter name wins over the new stem")
})

// --- AC-2: 匹配 bag — 未保存不进；保存后命中说明文字抬高该夹文档 ---

test("AC-2: saved folder description joins the scoring bag; unsaved draft never does", async () => {
  resetKnowledge()
  seedDoc("doc-in-folder", { folder: "调研", title: "文档甲", description: "普通说明文本" })
  for (let i = 0; i < 5; i++) seedDoc(`fill-${i}`, { title: `烹饪指南${i}`, description: `烹饪说明${i}` })
  const se = new SkillEngine()
  const tm = new ThreadManager()
  const th = tm.create("ac2-bag")

  const before = se.resolveKnowledgeIdsForThread(th.id, "auto", undefined, "北极星指标")
  assert.ok(!before.includes("doc-in-folder"), "no folder description on disk → no bag contribution")

  // Save the description via folder_update (用户保存才落盘).
  const resp = await handleMessage(
    { type: "knowledge.folder_update", bucket: "global", path: "调研", description: "这里放北极星指标相关调研", user_gesture: true },
    { skillEngine: se } as never,
  )
  assert.equal(resp.type, "knowledge.list", JSON.stringify(resp))

  const se2 = new SkillEngine()
  const afterSave = se2.resolveKnowledgeIdsForThread(th.id, "auto", undefined, "北极星指标")
  assert.ok(afterSave.includes("doc-in-folder"), `saved description lifts the folder doc: ${JSON.stringify(afterSave)}`)

  // Unsaved draft: folder_suggest returns a draft but writes nothing.
  __testSetFolderSuggestImpl((async () => ({ description: "草稿独有词试验田" })) as FolderSuggestImpl)
  const sug = await handleMessage(
    { type: "knowledge.folder_suggest", bucket: "global", path: "调研", user_gesture: true },
    { skillEngine: se2 } as never,
  )
  assert.equal(sug.type, "knowledge.folder_suggest")
  assert.equal(sug.suggested.description, "草稿独有词试验田")
  assert.ok(!fs.existsSync(path.join(knowledgeDirOf("global", "调研"), "_folder.md")) || !fs.readFileSync(path.join(knowledgeDirOf("global", "调研"), "_folder.md"), "utf-8").includes("试验田"), "draft never touches _folder.md")
  const se3 = new SkillEngine()
  const afterDraft = se3.resolveKnowledgeIdsForThread(th.id, "auto", undefined, "试验田")
  assert.ok(!afterDraft.includes("doc-in-folder"), "unsaved draft never enters the bag")
  __testSetFolderSuggestImpl()
})

// --- AC-3: import_directory 保树 ---

test("AC-3: import_directory preserves the relative tree (panel folder == disk rel path)", async () => {
  resetKnowledge()
  const vault = fs.mkdtempSync(path.join(tempHome, "vault-tree-"))
  fs.mkdirSync(path.join(vault, "sub1", "sub2"), { recursive: true })
  fs.writeFileSync(path.join(vault, "root.md"), "# root\n\n正文\n")
  fs.writeFileSync(path.join(vault, "sub1", "a.md"), "# a\n\n正文\n")
  fs.writeFileSync(path.join(vault, "sub1", "sub2", "b.md"), "# b\n\n正文\n")
  __testSetPickFolderNative((async () => ({ path: vault })) as never)
  const se = new SkillEngine()
  const resp = await handleMessage(
    { type: "knowledge.import_directory", user_gesture: true },
    { skillEngine: se } as never,
  )
  __testSetPickFolderNative()
  assert.equal(resp.type, "knowledge.import_directory_result", JSON.stringify(resp).slice(0, 300))
  assert.equal(resp.imported, 3)
  const countIn = (folder: string) => resp.docs.filter((d: any) => (d.folder || "") === folder).length
  assert.equal(countIn(""), 1, "root doc stays at the bucket root")
  assert.equal(countIn("sub1"), 1)
  assert.equal(countIn("sub1/sub2"), 1)
  // Disk agrees with the panel data.
  assert.equal(fs.readdirSync(knowledgeDirOf("global", "sub1/sub2")).filter((f) => f.endsWith(".md")).length, 1)
  assert.ok(Array.isArray(resp.folders), "list frame carries folder rows")
  assert.ok(resp.folders.some((f: any) => f.path === "sub1/sub2" && f.bucket === "global"))
})

// --- AC-4: 嵌套 SKILL.md 不进 skill.list ---

test("AC-4: nested knowledge/global/foo/SKILL.md is a knowledge doc, never a skill", () => {
  resetKnowledge()
  const dir = knowledgeDirOf("global", "foo")
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, "SKILL.md"), "---\nname: sneaky-skill\ndescription: 混进来的技能\n---\n\nbody\n")
  const se = new SkillEngine()
  assert.ok(!se.list().some((s) => s.name === "sneaky-skill"), "nested SKILL.md must not enter skill.list")
  const kd = se.listKnowledge().find((d) => d.name === "sneaky-skill")
  assert.ok(kd, "磁盘即真相：它作为普通知识文档可见")
  assert.equal(kd!.folder, "foo")
})

// --- AC-5: _folder.md 不进列表、不进注入 ---

test("AC-5: _folder.md excluded from listKnowledge and from prompt injection", () => {
  resetKnowledge()
  seedDoc("member-doc", { folder: "调研", title: "成员文档", description: "成员说明" })
  const folderDir = knowledgeDirOf("global", "调研")
  fs.writeFileSync(
    path.join(folderDir, "_folder.md"),
    "---\ntype: knowledge_folder\ntitle: 调研\ndescription: FOLDER_DESC_UNIQUE_不出现在注入\n---\n",
  )
  const se = new SkillEngine()
  assert.ok(!se.listKnowledge().some((d) => d.name === "_folder" || d.id === "_folder"), "_folder.md is not a doc")
  const { prompt } = se.buildSystemPromptWithSources("ac5-thread", undefined, [], ["member-doc"])
  assert.ok(!prompt.includes("FOLDER_DESC_UNIQUE_不出现在注入"), "folder description is a bag signal, never injected")
  const folders = se.listKnowledgeFolders()
  const f = folders.find((x) => x.path === "调研")
  assert.ok(f, "folder row exists")
  assert.equal(f!.description, "FOLDER_DESC_UNIQUE_不出现在注入")
})

// --- AC-6/AC-7: 门禁 — summoner 全拒；缺 user_gesture → 400 型 ---

test("AC-6: summoner is denied on all six verbs (router extra-deny + allowlist + web dispatch)", async () => {
  resetKnowledge()
  const se = new SkillEngine()
  for (const type of SIX_VERBS) {
    const payload = { ...verbPayload(type), __cmspark_surface: "summoner" }
    const resp = await handleMessage(payload, { skillEngine: se } as never)
    assert.equal(resp.type, "error", `${type} must error on summoner`)
    assert.equal(resp.error_code, "SUMMONER_ACL", `${type} SUMMONER_ACL`)
    assert.equal(assertSummonerAllowed("summoner", type).ok, false, `${type} not in summoner allowlist`)
    assert.equal(SUMMONER_WEB_DISPATCH_ALLOW.has(type), false, `${type} not in web dispatch allow`)
  }
})

test("AC-7: validate + router both require user_gesture on all six verbs", async () => {
  resetKnowledge()
  const se = new SkillEngine()
  for (const type of SIX_VERBS) {
    const withGesture = verbPayload(type)
    const without = { ...verbPayload(type) }
    delete (without as any).user_gesture
    assert.equal(validateWsMessage(without).valid, false, `${type} validate requires user_gesture`)
    assert.equal(validateWsMessage(withGesture).valid, true, `${type} validate ok with gesture`)
    const resp = await handleMessage(without, { skillEngine: se } as never)
    assert.equal(resp.type, "error", `${type} router requires user_gesture`)
    assert.match(String(resp.error), /requires user_gesture/)
  }
})

// --- AC-8: 201 文件 → 仍 truncated ≤200 ---

test("AC-8: 201-file import stays truncated at exactly 200 docs", async () => {
  resetKnowledge()
  const vault = fs.mkdtempSync(path.join(tempHome, "vault-201-"))
  for (let i = 0; i < 201; i++) {
    fs.writeFileSync(path.join(vault, `doc-${String(i).padStart(3, "0")}.md`), `# doc ${i}\n\n正文\n`)
  }
  __testSetPickFolderNative((async () => ({ path: vault })) as never)
  const se = new SkillEngine()
  const resp = await handleMessage(
    { type: "knowledge.import_directory", user_gesture: true },
    { skillEngine: se } as never,
  )
  __testSetPickFolderNative()
  assert.equal(resp.type, "knowledge.import_directory_result")
  assert.equal(resp.truncated, true)
  assert.equal(resp.imported, 200, "exactly 200 imported (Gate8 grok #5: no one-sided inequality)")
  const se2 = new SkillEngine()
  assert.equal(se2.listKnowledge().length, 200, "exactly 200 in the library")
})

// --- AC-9: 4 级目录拍扁到第 3 级 + flattenedDepth 计数 + 不丢文件 ---

test("AC-9: depth-4 import flattens into level 3 with flattenedDepth count, no file lost; deep _folder.md carries over but is NOT counted (N-3)", async () => {
  resetKnowledge()
  const vault = fs.mkdtempSync(path.join(tempHome, "vault-deep-"))
  fs.mkdirSync(path.join(vault, "a", "b", "c", "d"), { recursive: true })
  fs.writeFileSync(path.join(vault, "a", "b", "c", "d", "x.md"), "# x\n\n第 4 级正文\n")
  fs.writeFileSync(path.join(vault, "a", "b", "c", "y.md"), "# y\n\n第 3 级正文\n")
  // A deep _folder.md: carried over to the flattened folder, but not a doc and
  // not counted in flattenedDepth.
  fs.writeFileSync(
    path.join(vault, "a", "b", "c", "d", "_folder.md"),
    "---\ntype: knowledge_folder\ndescription: 深层说明\n---\n",
  )
  __testSetPickFolderNative((async () => ({ path: vault })) as never)
  const se = new SkillEngine()
  const resp = await handleMessage(
    { type: "knowledge.import_directory", user_gesture: true },
    { skillEngine: se } as never,
  )
  __testSetPickFolderNative()
  assert.equal(resp.type, "knowledge.import_directory_result", JSON.stringify(resp).slice(0, 300))
  assert.equal(resp.imported, 2, "no file lost (_folder.md is metadata, not a doc)")
  assert.equal(resp.flattenedDepth, 1, "exactly one DOC flattened from level 4; _folder.md not counted")
  assert.equal(resp.docs.filter((d: any) => d.folder === "a/b/c").length, 2, "both docs land at level 3")
  assert.equal(fs.readdirSync(knowledgeDirOf("global", "a/b/c")).filter((f) => f.endsWith(".md")).length, 3, "2 docs + carried _folder.md")
  assert.ok(!fs.existsSync(knowledgeDirOf("global", "a/b/c/d")), "no level-4 dir created")
  const folder = resp.folders.find((f: any) => f.path === "a/b/c")
  assert.equal(folder?.description, "深层说明", "deep _folder.md description carried to the flattened folder")
})

// --- 降级与边界 ---

test("degradation: corrupt _folder.md does not block doc loading; folder renders without description", () => {
  resetKnowledge()
  seedDoc("survivor", { folder: "坏夹", title: "幸存文档", description: "说明" })
  fs.writeFileSync(path.join(knowledgeDirOf("global", "坏夹"), "_folder.md"), "---\n[unclosed\n---\nbody\n")
  const se = new SkillEngine()
  const doc = se.listKnowledge().find((d) => d.name === "survivor")
  assert.ok(doc, "docs still load")
  assert.equal(doc!.folder, "坏夹")
  const folder = se.listKnowledgeFolders().find((f) => f.path === "坏夹")
  assert.ok(folder, "folder row still renders")
  assert.equal(folder!.description, "", "corrupt meta → no description")
})

test("degradation: move failure is disk byte-identical for a raw frontmatter-less doc (Gate8 grok-B1)", async () => {
  resetKnowledge()
  // Raw doc: NO frontmatter at all — the pre-fix code pinned an id into the
  // source file BEFORE the failing rename, leaking a write on failure.
  seedDoc("raw-note", { rawFrontmatter: true, body: "# 原始笔记\n\n逐字节内容 12345\n" })
  const srcPath = path.join(knowledgeDirOf("global"), "raw-note.md")
  const beforeBytes = fs.readFileSync(srcPath)
  // "blocker" exists as a FILE, so the blocker/sub target can never exist.
  fs.writeFileSync(path.join(knowledgeDirOf("global"), "blocker"), "not a dir")
  const se = new SkillEngine()
  const resp = await handleMessage(
    { type: "knowledge.move", id: "raw-note", folder: "blocker/sub", user_gesture: true },
    { skillEngine: se } as never,
  )
  assert.equal(resp.type, "error", JSON.stringify(resp))
  assert.deepEqual(fs.readFileSync(srcPath), beforeBytes, "failed move leaves the source byte-identical (no pin leak)")
  const se2 = new SkillEngine()
  const still = se2.listKnowledge().find((d) => d.name === "raw-note")
  assert.ok(still, "doc still resolvable after failed move")
  assert.equal(still!.folder, "", "doc never left the bucket root")
  assert.ok(!still!.id, "no id frontmatter was pinned on the failed path")
})

test("boundary: same-bucket move inside sites works; path traversal / absolute / backslash rejected", async () => {
  resetKnowledge()
  seedDoc("site-doc", { site: "shop.example.com", title: "站点文档" })
  const se = new SkillEngine()
  await handleMessage(
    { type: "knowledge.folder_create", bucket: "sites", path: "店铺/活动", user_gesture: true },
    { skillEngine: se } as never,
  )
  const resp = await handleMessage(
    { type: "knowledge.move", id: "site-doc", folder: "店铺/活动", user_gesture: true },
    { skillEngine: se } as never,
  )
  assert.equal(resp.type, "knowledge.list", JSON.stringify(resp))
  const se2 = new SkillEngine()
  const doc = se2.listKnowledge().find((d) => d.name === "site-doc")
  assert.equal(doc!.folder, "店铺/活动")
  assert.ok(fs.existsSync(knowledgeDirOf("sites", "店铺/活动")), "moved inside the sites bucket")
  assert.ok(!fs.existsSync(knowledgeDirOf("global", "店铺")), "never crosses buckets")

  for (const bad of ["../evil", "/abs", "a\\b", "a/./b", "a/b/../c", "C:/win"]) {
    const r = await handleMessage(
      { type: "knowledge.folder_create", bucket: "global", path: bad, user_gesture: true },
      { skillEngine: se2 } as never,
    )
    assert.equal(r.type, "error", `path ${bad} rejected`)
  }
  assert.ok(!fs.existsSync(path.join(getConfigDir(), "evil")), "no traversal outside the bucket")
  const badMove = await handleMessage(
    { type: "knowledge.move", id: "site-doc", folder: "../global", user_gesture: true },
    { skillEngine: se2 } as never,
  )
  assert.equal(badMove.type, "error", "move rejects .. folder")
})

test("caps: depth 4 folder_create rejected; 51st child rejected; description sliced to 500", async () => {
  resetKnowledge()
  const se = new SkillEngine()
  const deep = await handleMessage(
    { type: "knowledge.folder_create", bucket: "global", path: "a/b/c/d", user_gesture: true },
    { skillEngine: se } as never,
  )
  assert.equal(deep.type, "error")
  assert.match(String(deep.error), /最多 3 级/)

  // 50 children directly on disk, then the 51st create must fail.
  for (let i = 0; i < 50; i++) {
    fs.mkdirSync(path.join(knowledgeDirOf("global"), `f${String(i).padStart(2, "0")}`), { recursive: true })
  }
  const full = await handleMessage(
    { type: "knowledge.folder_create", bucket: "global", path: "one-too-many", user_gesture: true },
    { skillEngine: new SkillEngine() } as never,
  )
  assert.equal(full.type, "error")
  assert.match(String(full.error), /单层最多 50/)

  const longDesc = "长".repeat(600)
  fs.mkdirSync(knowledgeDirOf("global", "cap-desc"), { recursive: true })
  const upd = await handleMessage(
    { type: "knowledge.folder_update", bucket: "global", path: "cap-desc", description: longDesc, user_gesture: true },
    { skillEngine: new SkillEngine() } as never,
  )
  assert.equal(upd.type, "knowledge.list", JSON.stringify(upd))
  assert.equal(upd.updated.description.length, 500, "description truncated to 500, honestly reported")
})

test("folder_rename moves the directory; member docs keep ids and get the new folder", async () => {
  resetKnowledge()
  const se = new SkillEngine()
  const imported = se.importKnowledge("# 文档\n\n正文\n", "rename-member")
  await handleMessage(
    { type: "knowledge.folder_create", bucket: "global", path: "旧名", user_gesture: true },
    { skillEngine: se } as never,
  )
  se.moveKnowledge(imported.id, "旧名")
  const resp = await handleMessage(
    { type: "knowledge.folder_rename", bucket: "global", path: "旧名", new_path: "新名", user_gesture: true },
    { skillEngine: se } as never,
  )
  assert.equal(resp.type, "knowledge.list", JSON.stringify(resp))
  assert.deepEqual(resp.renamed, { path: "旧名", new_path: "新名" })
  const se2 = new SkillEngine()
  const doc = se2.listKnowledge().find((d) => (d.id || d.name) === imported.id)
  assert.equal(doc!.folder, "新名", "docs follow the rename (folder is disk-derived)")
  assert.ok(!fs.existsSync(knowledgeDirOf("global", "旧名")))
  assert.ok(fs.existsSync(knowledgeDirOf("global", "新名")))
})

test("folder_delete: reject_if_docs refuses non-empty; move_to_parent lifts docs one level with ids unchanged", async () => {
  resetKnowledge()
  const se = new SkillEngine()
  const imported = se.importKnowledge("# 待上提\n\n正文\n", "lift-me")
  await handleMessage(
    { type: "knowledge.folder_create", bucket: "global", path: "父/子", user_gesture: true },
    { skillEngine: se } as never,
  )
  se.moveKnowledge(imported.id, "父/子")

  const refused = await handleMessage(
    { type: "knowledge.folder_delete", bucket: "global", path: "父/子", user_gesture: true },
    { skillEngine: new SkillEngine() } as never,
  )
  assert.equal(refused.type, "error")
  assert.match(String(refused.error), /非空/)
  assert.ok(fs.existsSync(knowledgeDirOf("global", "父/子")), "refused delete keeps the folder")

  const moved = await handleMessage(
    { type: "knowledge.folder_delete", bucket: "global", path: "父/子", mode: "move_to_parent", user_gesture: true },
    { skillEngine: new SkillEngine() } as never,
  )
  assert.equal(moved.type, "knowledge.list", JSON.stringify(moved))
  assert.equal(moved.deleted.moved, 1)
  const se2 = new SkillEngine()
  const doc = se2.listKnowledge().find((d) => (d.id || d.name) === imported.id)
  assert.equal(doc!.folder, "父", "member lifted one level")
  assert.equal(doc!.id, imported.id, "id unchanged through move_to_parent")
  assert.ok(!fs.existsSync(knowledgeDirOf("global", "父/子")), "empty folder removed")

  // Empty folder with _folder.md deletes cleanly under the default mode.
  await handleMessage(
    { type: "knowledge.folder_update", bucket: "global", path: "父", description: "说明", user_gesture: true },
    { skillEngine: se2 } as never,
  )
  const del = await handleMessage(
    { type: "knowledge.folder_delete", bucket: "global", path: "父", user_gesture: true },
    { skillEngine: new SkillEngine() } as never,
  )
  assert.equal(del.type, "error", "父 still holds the lifted doc → reject_if_docs refuses")
  se2.moveKnowledge(imported.id, "")
  const del2 = await handleMessage(
    { type: "knowledge.folder_delete", bucket: "global", path: "父", user_gesture: true },
    { skillEngine: new SkillEngine() } as never,
  )
  assert.equal(del2.type, "knowledge.list", JSON.stringify(del2))
  assert.ok(!fs.existsSync(knowledgeDirOf("global", "父")), "folder + _folder.md removed")
})

test("folder_suggest: member lines redacted, ≤30; failure → extract_error; empty folder → honest error", async () => {
  resetKnowledge()
  // Redaction: a single-member folder so the slice order cannot hide it.
  seedDoc("secret-holder", { folder: "密夹", title: "密钥文档", description: "token sk-livekey123456 在内" })
  let gotLines: string[] = []
  __testSetFolderSuggestImpl((async ({ lines }) => {
    gotLines = lines
    return { description: "草稿" }
  }) as FolderSuggestImpl)
  const se = new SkillEngine()
  const red = await handleMessage(
    { type: "knowledge.folder_suggest", bucket: "global", path: "密夹", user_gesture: true },
    { skillEngine: se } as never,
  )
  assert.equal(red.suggested.description, "草稿")
  assert.equal(gotLines.length, 1)
  assert.ok(!gotLines[0].includes("sk-livekey123456"), "member secrets redacted before the LLM")
  assert.ok(gotLines[0].includes("密钥文档"), "member title still present")

  // Cap: 35 members → 30 lines.
  for (let i = 0; i < 35; i++) {
    seedDoc(`m-${String(i).padStart(2, "0")}`, { folder: "大夹", title: `成员${i}`, description: `说明${i}` })
  }
  const resp = await handleMessage(
    { type: "knowledge.folder_suggest", bucket: "global", path: "大夹", user_gesture: true },
    { skillEngine: new SkillEngine() } as never,
  )
  assert.equal(resp.type, "knowledge.folder_suggest")
  assert.equal(gotLines.length, 30, "member lines capped at 30")

  __testSetFolderSuggestImpl((async () => { throw new Error("llm down") }) as FolderSuggestImpl)
  const fail = await handleMessage(
    { type: "knowledge.folder_suggest", bucket: "global", path: "大夹", user_gesture: true },
    { skillEngine: new SkillEngine() } as never,
  )
  assert.equal(fail.extract_error, "llm down")
  assert.ok(!fail.suggested, "failure never masquerades as a draft")
  __testSetFolderSuggestImpl()

  fs.mkdirSync(knowledgeDirOf("global", "空夹"), { recursive: true })
  const empty = await handleMessage(
    { type: "knowledge.folder_suggest", bucket: "global", path: "空夹", user_gesture: true },
    { skillEngine: new SkillEngine() } as never,
  )
  assert.equal(empty.type, "error")
  assert.match(String(empty.error), /文件夹为空/)
})

test("stale: folder content fingerprint flips 可能过期 after a member doc changes; _folder.md bumps the disk fingerprint", async () => {
  resetKnowledge()
  seedDoc("member", { folder: "追踪", title: "成员", description: "说明" })
  const se = new SkillEngine()
  await handleMessage(
    { type: "knowledge.folder_update", bucket: "global", path: "追踪", description: "已保存说明", user_gesture: true },
    { skillEngine: se } as never,
  )
  let folders = new SkillEngine().listKnowledgeFolders()
  assert.equal(folders.find((f) => f.path === "追踪")!.stale, false, "freshly saved → not stale")

  // Member doc content changes → folder fingerprint diverges → stale.
  const doc = new SkillEngine().listKnowledge().find((d) => d.folder === "追踪")!
  new SkillEngine().updateKnowledge(doc.id || doc.name, { description: "改动后的说明" })
  folders = new SkillEngine().listKnowledgeFolders()
  assert.equal(folders.find((f) => f.path === "追踪")!.stale, true, "member change marks 可能过期")

  // _folder.md itself participates in the disk fingerprint (refresh trigger).
  const se2 = new SkillEngine()
  const fp1 = se2.computeDiskFingerprint()
  fs.writeFileSync(path.join(knowledgeDirOf("global", "追踪"), "_folder.md"), "---\ntype: knowledge_folder\ndescription: 改动\n---\n")
  const fp2 = se2.computeDiskFingerprint()
  assert.notEqual(fp1, fp2, "_folder.md write changes the disk fingerprint")
})

test("import carry-over: vault _folder.md description lands on the folder, never as a doc", async () => {
  resetKnowledge()
  const vault = fs.mkdtempSync(path.join(tempHome, "vault-meta-"))
  fs.mkdirSync(path.join(vault, "项目"), { recursive: true })
  fs.writeFileSync(path.join(vault, "项目", "doc.md"), "# 项目文档\n\n正文\n")
  fs.writeFileSync(
    path.join(vault, "项目", "_folder.md"),
    "---\ntype: knowledge_folder\ntitle: 项目\ndescription: 项目资料都放这里\n---\n",
  )
  __testSetPickFolderNative((async () => ({ path: vault })) as never)
  const se = new SkillEngine()
  const resp = await handleMessage(
    { type: "knowledge.import_directory", user_gesture: true },
    { skillEngine: se } as never,
  )
  __testSetPickFolderNative()
  assert.equal(resp.imported, 1, "_folder.md is not imported as a doc")
  const folder = resp.folders.find((f: any) => f.path === "项目")
  assert.ok(folder, "folder row carried over")
  assert.equal(folder.description, "项目资料都放这里")
})

test("frontmatter folder: key is not a second truth — disk path wins on refresh", () => {
  resetKnowledge()
  const dir = knowledgeDirOf("global", "实际")
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    path.join(dir, "drift.md"),
    "---\nname: drift\nfolder: 手写/假路径\ndescription: d\ntype: domain_knowledge\n---\n\nbody\n",
  )
  const se = new SkillEngine()
  const doc = se.listKnowledge().find((d) => d.name === "drift")
  assert.equal(doc!.folder, "实际", "loader derives folder from source_file, ignoring frontmatter")
})

// --- Gate8 修复回归 ---

test("MAJOR-3: nested folder_create cannot bypass a full ancestor layer (root 50 → a/b rejected)", async () => {
  resetKnowledge()
  for (let i = 0; i < 50; i++) {
    fs.mkdirSync(path.join(knowledgeDirOf("global"), `f${String(i).padStart(2, "0")}`), { recursive: true })
  }
  const se = new SkillEngine()
  const resp = await handleMessage(
    { type: "knowledge.folder_create", bucket: "global", path: "a/b", user_gesture: true },
    { skillEngine: se } as never,
  )
  assert.equal(resp.type, "error", "creating a/b would grow the full root to 51 entries")
  assert.match(String(resp.error), /单层最多 50/)
  assert.ok(!fs.existsSync(knowledgeDirOf("global", "a")), "nothing created on the rejected path")

  // Sanity: with 49 entries the same nested create succeeds (both levels created).
  fs.rmSync(knowledgeDirOf("global", "f49"), { recursive: true })
  const ok = await handleMessage(
    { type: "knowledge.folder_create", bucket: "global", path: "a/b", user_gesture: true },
    { skillEngine: new SkillEngine() } as never,
  )
  assert.equal(ok.type, "knowledge.list", JSON.stringify(ok).slice(0, 200))
  assert.ok(fs.existsSync(knowledgeDirOf("global", "a/b")))
})

test("MAJOR-3: move to a nonexistent folder errors honestly and writes nothing", async () => {
  resetKnowledge()
  seedDoc("stay-put", { title: "原地文档", description: "d" })
  const srcPath = path.join(knowledgeDirOf("global"), "stay-put.md")
  const beforeBytes = fs.readFileSync(srcPath)
  const se = new SkillEngine()
  const resp = await handleMessage(
    { type: "knowledge.move", id: "stay-put", folder: "ghost/ nowhere".trim(), user_gesture: true },
    { skillEngine: se } as never,
  )
  assert.equal(resp.type, "error")
  assert.match(String(resp.error), /目标文件夹不存在/)
  assert.deepEqual(fs.readFileSync(srcPath), beforeBytes, "doc untouched")
  assert.ok(!fs.existsSync(knowledgeDirOf("global", "ghost")), "move never creates folders implicitly")
  // Family tag lets the panel route the error honestly (M-6).
  assert.equal((resp as any).family, "knowledge_folder")
})

test("MAJOR-4: move_to_parent with 49 sibling folders at the parent level succeeds (doomed folder not double-counted)", async () => {
  resetKnowledge()
  // Root: 49 sibling folders + "lift" (with 1 doc) = 50 entries.
  for (let i = 0; i < 49; i++) {
    fs.mkdirSync(path.join(knowledgeDirOf("global"), `sib${String(i).padStart(2, "0")}`), { recursive: true })
  }
  seedDoc("lifted-doc", { folder: "lift", title: "被上提", description: "d" })
  const se = new SkillEngine()
  const resp = await handleMessage(
    { type: "knowledge.folder_delete", bucket: "global", path: "lift", mode: "move_to_parent", user_gesture: true },
    { skillEngine: se } as never,
  )
  assert.equal(resp.type, "knowledge.list", JSON.stringify(resp).slice(0, 300))
  assert.equal(resp.deleted.moved, 1)
  const se2 = new SkillEngine()
  const doc = se2.listKnowledge().find((d) => d.name === "lifted-doc")
  assert.equal(doc!.folder, "", "doc lifted to the bucket root (now exactly 50 entries)")
  assert.ok(!fs.existsSync(knowledgeDirOf("global", "lift")))
})

test("MAJOR-5: importing 51 docs into one folder bumps the 51st up a layer (layerOverflow counted, no file lost)", async () => {
  resetKnowledge()
  const vault = fs.mkdtempSync(path.join(tempHome, "vault-51-"))
  fs.mkdirSync(path.join(vault, "满夹"), { recursive: true })
  for (let i = 0; i < 51; i++) {
    fs.writeFileSync(path.join(vault, "满夹", `doc-${String(i).padStart(2, "0")}.md`), `# doc ${i}\n\n正文\n`)
  }
  __testSetPickFolderNative((async () => ({ path: vault })) as never)
  const se = new SkillEngine()
  const resp = await handleMessage(
    { type: "knowledge.import_directory", user_gesture: true },
    { skillEngine: se } as never,
  )
  __testSetPickFolderNative()
  assert.equal(resp.type, "knowledge.import_directory_result", JSON.stringify(resp).slice(0, 300))
  assert.equal(resp.imported, 51, "no file lost to the per-layer cap")
  assert.equal(resp.layerOverflow, 1, "exactly the 51st doc overflowed")
  const inFolder = resp.docs.filter((d: any) => d.folder === "满夹").length
  const atRoot = resp.docs.filter((d: any) => (d.folder || "") === "").length
  assert.equal(inFolder, 50, "folder capped at 50")
  assert.equal(atRoot, 1, "overflowed doc honestly at the parent layer (bucket root)")
  assert.equal(fs.readdirSync(knowledgeDirOf("global", "满夹")).filter((f) => f.endsWith(".md")).length, 50)
})

// --- Gate8 r2 修复回归 ---

test("F-R2-1a: import newfold/doc.md with a full bucket root (50) bumps to root — root stays 50, doc not lost", async () => {
  resetKnowledge()
  for (let i = 0; i < 50; i++) {
    fs.mkdirSync(path.join(knowledgeDirOf("global"), `f${String(i).padStart(2, "0")}`), { recursive: true })
  }
  const vault = fs.mkdtempSync(path.join(tempHome, "vault-newfold-"))
  fs.mkdirSync(path.join(vault, "newfold"), { recursive: true })
  fs.writeFileSync(path.join(vault, "newfold", "doc.md"), "# doc\n\n正文\n")
  __testSetPickFolderNative((async () => ({ path: vault })) as never)
  const se = new SkillEngine()
  const resp = await handleMessage(
    { type: "knowledge.import_directory", user_gesture: true },
    { skillEngine: se } as never,
  )
  __testSetPickFolderNative()
  assert.equal(resp.type, "knowledge.import_directory_result", JSON.stringify(resp).slice(0, 300))
  assert.equal(resp.imported, 1, "doc not lost")
  assert.equal(resp.layerOverflow, 1, "honestly counted")
  assert.ok(!fs.existsSync(knowledgeDirOf("global", "newfold")), "no 51st entry grown at the root")
  assert.equal(fs.readdirSync(knowledgeDirOf("global")).filter((f) => !f.startsWith(".")).length, 51, "50 folders + 1 bumped doc at root")
  const doc = resp.docs.find((d: any) => d.title === "doc" || d.name.includes("doc"))
  assert.equal(doc?.folder || "", "", "doc landed at the bucket root")
})

test("F-R2-1b: import a/b/nested.md with middle layer a full (50) bumps past a — a stays 50", async () => {
  resetKnowledge()
  const midDir = knowledgeDirOf("global", "a")
  fs.mkdirSync(midDir, { recursive: true })
  for (let i = 0; i < 50; i++) {
    fs.writeFileSync(path.join(midDir, `existing-${String(i).padStart(2, "0")}.md`), "---\nname: e\n---\n\nx\n")
  }
  const vault = fs.mkdtempSync(path.join(tempHome, "vault-midfull-"))
  fs.mkdirSync(path.join(vault, "a", "b"), { recursive: true })
  fs.writeFileSync(path.join(vault, "a", "b", "nested.md"), "# nested\n\n正文\n")
  __testSetPickFolderNative((async () => ({ path: vault })) as never)
  const se = new SkillEngine()
  const resp = await handleMessage(
    { type: "knowledge.import_directory", user_gesture: true },
    { skillEngine: se } as never,
  )
  __testSetPickFolderNative()
  assert.equal(resp.type, "knowledge.import_directory_result", JSON.stringify(resp).slice(0, 300))
  assert.equal(resp.imported, 1, "doc not lost")
  assert.equal(resp.layerOverflow, 1, "honestly counted")
  assert.ok(!fs.existsSync(knowledgeDirOf("global", "a/b")), "full middle layer never grows a 51st entry")
  assert.equal(fs.readdirSync(knowledgeDirOf("global", "a")).filter((f) => f.endsWith(".md")).length, 50, "a stays at 50")
  const doc = resp.docs.find((d: any) => d.title === "nested" || d.name.includes("nested"))
  assert.equal(doc?.folder || "", "", "bumped all the way to the bucket root")
})

test("F-A/F-R2-3: move into an existing but READ-ONLY folder fails mid-transaction — source byte-identical, no tmp/dest residue", async (t) => {
  if (process.platform === "win32") {
    // Windows chmod semantics differ (read-only attribute ≠ POSIX mode); skip.
    t.skip("chmod 0o555 semantics are POSIX-only")
    return
  }
  resetKnowledge()
  seedDoc("tx-doc", { rawFrontmatter: true, body: "# 事务中断\n\n原始字节 67890\n" })
  const targetDir = knowledgeDirOf("global", "readonly-folder")
  fs.mkdirSync(targetDir, { recursive: true })
  fs.chmodSync(targetDir, 0o555)
  const srcPath = path.join(knowledgeDirOf("global"), "tx-doc.md")
  const beforeBytes = fs.readFileSync(srcPath)
  try {
    const se = new SkillEngine()
    const resp = await handleMessage(
      { type: "knowledge.move", id: "tx-doc", folder: "readonly-folder", user_gesture: true },
      { skillEngine: se } as never,
    )
    assert.equal(resp.type, "error", JSON.stringify(resp))
    assert.deepEqual(fs.readFileSync(srcPath), beforeBytes, "source byte-identical after mid-transaction failure")
    const residue = fs.readdirSync(targetDir)
    assert.deepEqual(residue, [], "no tmp/dest residue in the read-only folder")
    const still = new SkillEngine().listKnowledge().find((d) => d.name === "tx-doc")
    assert.ok(still && !still.id, "doc resolvable, no id pinned on failure")
  } finally {
    fs.chmodSync(targetDir, 0o755)
  }
})

test("F-B: folder_rename rejects when the moved subtree would exceed 3 levels", async () => {
  resetKnowledge()
  const se = new SkillEngine()
  await handleMessage(
    { type: "knowledge.folder_create", bucket: "global", path: "a/b/c", user_gesture: true },
    { skillEngine: se } as never,
  )
  // x exists so the rename reaches the depth check (not the missing-parent one).
  await handleMessage(
    { type: "knowledge.folder_create", bucket: "global", path: "x", user_gesture: true },
    { skillEngine: se } as never,
  )
  const bad = await handleMessage(
    { type: "knowledge.folder_rename", bucket: "global", path: "a", new_path: "x/d", user_gesture: true },
    { skillEngine: se } as never,
  )
  assert.equal(bad.type, "error")
  assert.match(String(bad.error), /超过 3 级/)
  assert.ok(fs.existsSync(knowledgeDirOf("global", "a/b/c")), "rejected rename leaves the tree in place")
  assert.ok(!fs.existsSync(knowledgeDirOf("global", "x/d")), "no partial rename")

  // Same subtree onto a fresh level-1 name: 1 + 2 = 3 → allowed.
  const ok = await handleMessage(
    { type: "knowledge.folder_rename", bucket: "global", path: "a", new_path: "y", user_gesture: true },
    { skillEngine: new SkillEngine() } as never,
  )
  assert.equal(ok.type, "knowledge.list", JSON.stringify(ok).slice(0, 200))
  assert.ok(fs.existsSync(knowledgeDirOf("global", "y/b/c")), "≤3-level rename allowed")
})

test("F-E: _folder.md does not consume a MAX_FILES scan slot (200 docs + _folder.md → 200 imported)", async () => {
  resetKnowledge()
  const vault = fs.mkdtempSync(path.join(tempHome, "vault-200meta-"))
  fs.mkdirSync(path.join(vault, "meta"), { recursive: true })
  for (let i = 0; i < 200; i++) {
    fs.writeFileSync(path.join(vault, "meta", `doc-${String(i).padStart(3, "0")}.md`), `# doc ${i}\n\n正文\n`)
  }
  fs.writeFileSync(path.join(vault, "meta", "_folder.md"), "---\ntype: knowledge_folder\ndescription: 夹说明\n---\n")
  __testSetPickFolderNative((async () => ({ path: vault })) as never)
  const se = new SkillEngine()
  const resp = await handleMessage(
    { type: "knowledge.import_directory", user_gesture: true },
    { skillEngine: se } as never,
  )
  __testSetPickFolderNative()
  assert.equal(resp.type, "knowledge.import_directory_result", JSON.stringify(resp).slice(0, 300))
  assert.equal(resp.imported, 200, "all 200 docs imported; _folder.md billed nothing")
  assert.equal(resp.totalScanned, 200, "scan slot accounting counts docs only")
  // 200 docs can't fit one folder (50/layer) — most overflow to root; the meta
  // folder exists and (capped) docs carry the overflow honestly.
  assert.ok(resp.layerOverflow > 0, "per-layer overflow counted")
  const folder = resp.folders.find((f: any) => f.path === "meta")
  assert.ok(folder, "folder row exists")
})

test("F-F: carry-over never writes the 51st entry into a full folder", async () => {
  resetKnowledge()
  const fullDir = knowledgeDirOf("global", "满夹")
  fs.mkdirSync(fullDir, { recursive: true })
  // Folder already at 50 on disk (pre-existing library).
  for (let i = 0; i < 50; i++) {
    fs.writeFileSync(path.join(fullDir, `pre-${String(i).padStart(2, "0")}.md`), "---\nname: p\n---\n\nx\n")
  }
  const vault = fs.mkdtempSync(path.join(tempHome, "vault-carrycap-"))
  fs.mkdirSync(path.join(vault, "满夹"), { recursive: true })
  fs.writeFileSync(path.join(vault, "满夹", "doc.md"), "# doc\n\n正文\n")
  fs.writeFileSync(path.join(vault, "满夹", "_folder.md"), "---\ntype: knowledge_folder\ndescription: 不该落盘\n---\n")
  __testSetPickFolderNative((async () => ({ path: vault })) as never)
  const se = new SkillEngine()
  const resp = await handleMessage(
    { type: "knowledge.import_directory", user_gesture: true },
    { skillEngine: se } as never,
  )
  __testSetPickFolderNative()
  assert.equal(resp.type, "knowledge.import_directory_result", JSON.stringify(resp).slice(0, 300))
  assert.equal(resp.imported, 1)
  // The doc itself bumps to root (folder full) — layerOverflow counted.
  assert.equal(resp.layerOverflow, 1)
  assert.ok(!fs.existsSync(path.join(knowledgeDirOf("global", "满夹"), "_folder.md")), "carry-over skipped on the full folder")
  assert.equal(fs.readdirSync(knowledgeDirOf("global", "满夹")).length, 50, "folder stays at exactly 50 entries")
})

// --- Gate8 r3: F-R3-1 carry-over 只按实际落点 ---

test("F-R3-1a: middle layer full — bumped doc does NOT grow a/b via carry-over; description dropped + counted", async () => {
  resetKnowledge()
  const midDir = knowledgeDirOf("global", "a")
  fs.mkdirSync(midDir, { recursive: true })
  for (let i = 0; i < 50; i++) {
    fs.writeFileSync(path.join(midDir, `existing-${String(i).padStart(2, "0")}.md`), "---\nname: e\n---\n\nx\n")
  }
  const vault = fs.mkdtempSync(path.join(tempHome, "vault-r3a-"))
  fs.mkdirSync(path.join(vault, "a", "b"), { recursive: true })
  fs.writeFileSync(path.join(vault, "a", "b", "nested.md"), "# nested\n\n正文\n")
  fs.writeFileSync(path.join(vault, "a", "b", "_folder.md"), "---\ntype: knowledge_folder\ndescription: 不得落盘\n---\n")
  __testSetPickFolderNative((async () => ({ path: vault })) as never)
  const se = new SkillEngine()
  const resp = await handleMessage(
    { type: "knowledge.import_directory", user_gesture: true },
    { skillEngine: se } as never,
  )
  __testSetPickFolderNative()
  assert.equal(resp.type, "knowledge.import_directory_result", JSON.stringify(resp).slice(0, 300))
  assert.equal(resp.imported, 1, "doc not lost")
  assert.equal(resp.layerOverflow, 1, "doc bumped (root: a is full)")
  assert.ok(!fs.existsSync(knowledgeDirOf("global", "a/b")), "carry-over must not create a/b")
  assert.equal(fs.readdirSync(midDir).length, 50, "a stays at exactly 50 entries")
  assert.equal(resp.folderMetaDropped, 1, "dropped carry-over honestly counted")
  assert.ok(!new SkillEngine().listKnowledgeFolders().some((f) => f.path === "a/b"), "no ghost folder row")
})

test("F-R3-1b: root full (50 folders) — bumped doc does NOT grow newfold via carry-over", async () => {
  resetKnowledge()
  for (let i = 0; i < 50; i++) {
    fs.mkdirSync(path.join(knowledgeDirOf("global"), `f${String(i).padStart(2, "0")}`), { recursive: true })
  }
  const vault = fs.mkdtempSync(path.join(tempHome, "vault-r3b-"))
  fs.mkdirSync(path.join(vault, "newfold"), { recursive: true })
  fs.writeFileSync(path.join(vault, "newfold", "doc.md"), "# doc\n\n正文\n")
  fs.writeFileSync(path.join(vault, "newfold", "_folder.md"), "---\ntype: knowledge_folder\ndescription: 不得落盘\n---\n")
  __testSetPickFolderNative((async () => ({ path: vault })) as never)
  const se = new SkillEngine()
  const resp = await handleMessage(
    { type: "knowledge.import_directory", user_gesture: true },
    { skillEngine: se } as never,
  )
  __testSetPickFolderNative()
  assert.equal(resp.type, "knowledge.import_directory_result", JSON.stringify(resp).slice(0, 300))
  assert.equal(resp.imported, 1)
  assert.equal(resp.layerOverflow, 1)
  assert.ok(!fs.existsSync(knowledgeDirOf("global", "newfold")), "no 51st root entry via carry-over")
  assert.equal(fs.readdirSync(knowledgeDirOf("global")).filter((f) => !f.startsWith(".")).length, 51, "50 folders + 1 bumped doc")
  assert.equal(resp.folderMetaDropped, 1)
})

test("F-R3-1 regression: normal carry-over still applies when docs land in the requested folder", async () => {
  resetKnowledge()
  const vault = fs.mkdtempSync(path.join(tempHome, "vault-r3ok-"))
  fs.mkdirSync(path.join(vault, "好夹"), { recursive: true })
  fs.writeFileSync(path.join(vault, "好夹", "doc.md"), "# doc\n\n正文\n")
  fs.writeFileSync(path.join(vault, "好夹", "_folder.md"), "---\ntype: knowledge_folder\ndescription: 正常说明\n---\n")
  __testSetPickFolderNative((async () => ({ path: vault })) as never)
  const se = new SkillEngine()
  const resp = await handleMessage(
    { type: "knowledge.import_directory", user_gesture: true },
    { skillEngine: se } as never,
  )
  __testSetPickFolderNative()
  assert.equal(resp.imported, 1)
  assert.equal(resp.layerOverflow, 0)
  assert.equal(resp.folderMetaDropped, 0, "nothing dropped on the happy path")
  const folder = resp.folders.find((f: any) => f.path === "好夹")
  assert.equal(folder?.description, "正常说明", "carry-over applied when the doc actually landed there")
  assert.ok(fs.existsSync(path.join(knowledgeDirOf("global", "好夹"), "_folder.md")))
})


// --- Gate8 r4: F-R4-1 祖先夹说明 + F-R4-2 dropped 计数闭合 ---

test("F-R4-1: vote-less ANCESTOR folder of a landed doc still gets its _folder.md description", async () => {
  resetKnowledge()
  const vault = fs.mkdtempSync(path.join(tempHome, "vault-r41-"))
  fs.mkdirSync(path.join(vault, "x", "y"), { recursive: true })
  fs.writeFileSync(path.join(vault, "x", "_folder.md"), "---\ntype: knowledge_folder\ndescription: 祖先说明\n---\n")
  fs.writeFileSync(path.join(vault, "x", "y", "nested.md"), "# nested\n\n正文\n")
  fs.writeFileSync(path.join(vault, "x", "y", "_folder.md"), "---\ntype: knowledge_folder\ndescription: 子夹说明\n---\n")
  __testSetPickFolderNative((async () => ({ path: vault })) as never)
  const se = new SkillEngine()
  const resp = await handleMessage(
    { type: "knowledge.import_directory", user_gesture: true },
    { skillEngine: se } as never,
  )
  __testSetPickFolderNative()
  assert.equal(resp.type, "knowledge.import_directory_result", JSON.stringify(resp).slice(0, 300))
  assert.equal(resp.imported, 1)
  assert.equal(resp.folderMetaDropped, 0, "ancestor description carried, nothing dropped")
  const folders = resp.folders
  assert.equal(folders.find((f: any) => f.path === "x")?.description, "祖先说明", "ancestor x gets its description")
  assert.equal(folders.find((f: any) => f.path === "x/y")?.description, "子夹说明", "voted x/y gets its description")
})

test("F-R4-1b: vote-less folder that is NOT an ancestor of any landed doc is dropped + counted", async () => {
  resetKnowledge()
  const vault = fs.mkdtempSync(path.join(tempHome, "vault-r41b-"))
  fs.mkdirSync(path.join(vault, "有文档"), { recursive: true })
  fs.writeFileSync(path.join(vault, "有文档", "doc.md"), "# doc\n\n正文\n")
  fs.mkdirSync(path.join(vault, "纯说明"), { recursive: true })
  fs.writeFileSync(path.join(vault, "纯说明", "_folder.md"), "---\ntype: knowledge_folder\ndescription: 孤儿说明\n---\n")
  __testSetPickFolderNative((async () => ({ path: vault })) as never)
  const se = new SkillEngine()
  const resp = await handleMessage(
    { type: "knowledge.import_directory", user_gesture: true },
    { skillEngine: se } as never,
  )
  __testSetPickFolderNative()
  assert.equal(resp.imported, 1)
  assert.equal(resp.folderMetaDropped, 1, "orphan description dropped + counted")
  assert.ok(!fs.existsSync(knowledgeDirOf("global", "纯说明")), "no folder is created for a doc-less vault folder")
})

test("F-R4-2: voted folder whose carry-over is skipped by the per-layer 50 cap counts as dropped", async () => {
  resetKnowledge()
  // Pre-existing folder at 49; the imported doc lands as the 50th entry, so
  // the _folder.md write would be the 51st → skipped → honestly counted.
  const dir = knowledgeDirOf("global", "差一件")
  fs.mkdirSync(dir, { recursive: true })
  for (let i = 0; i < 49; i++) {
    fs.writeFileSync(path.join(dir, `pre-${String(i).padStart(2, "0")}.md`), "---\nname: p\n---\n\nx\n")
  }
  const vault = fs.mkdtempSync(path.join(tempHome, "vault-r42-"))
  fs.mkdirSync(path.join(vault, "差一件"), { recursive: true })
  fs.writeFileSync(path.join(vault, "差一件", "doc.md"), "# doc\n\n正文\n")
  fs.writeFileSync(path.join(vault, "差一件", "_folder.md"), "---\ntype: knowledge_folder\ndescription: 第五一件\n---\n")
  __testSetPickFolderNative((async () => ({ path: vault })) as never)
  const se = new SkillEngine()
  const resp = await handleMessage(
    { type: "knowledge.import_directory", user_gesture: true },
    { skillEngine: se } as never,
  )
  __testSetPickFolderNative()
  assert.equal(resp.imported, 1)
  assert.equal(resp.layerOverflow, 0, "doc landed in the requested folder (the 50th entry)")
  assert.equal(fs.readdirSync(dir).length, 50, "folder capped at exactly 50")
  assert.ok(!fs.existsSync(path.join(dir, "_folder.md")), "meta write skipped by cap")
  assert.equal(resp.folderMetaDropped, 1, "voted-but-skipped carry counts as dropped (F-R4-2)")
})

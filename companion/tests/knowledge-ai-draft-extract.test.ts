import test, { after, before } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"

// #272 — knowledge AI draft extract (草稿制，单篇路径)
// Spec: docs/superpowers/specs/2026-09-02-knowledge-ai-draft-extract-design.md
//
// Covers AC-1..8 companion-side: two-phase preview (Phase-1 heuristic + source
// tags, Phase-2 pushed knowledge.preview_suggested), degradation paths,
// normalizeTags secret filtering, directory-import / library-scan 0-extract
// spy assertions, knowledge.suggest protocol (user_gesture 400 / SUMMONER_ACL /
// draft-not-persisted), and knowledge.preview_cancel abort.

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-k-extract-"))
process.env.HOME = tempHome
process.env.CMSPARK_DATA_DIR = path.join(tempHome, ".cmspark-agent")
delete process.env.DEEPSEEK_API_KEY
delete process.env.CMSPARK_API_KEY

type HandleMessage = typeof import("../src/message-router").handleMessage
type SkillEngineT = import("../src/skills/skill-engine").SkillEngine
type ExtractImpl = (params: { body: string; signal?: AbortSignal }) => Promise<{ description?: string; tags?: string[] }>

let handleMessage: HandleMessage
let __testSetKnowledgeExtractImpl: (impl?: ExtractImpl) => void
let __testSetPickFolderNative: (impl?: unknown) => void
let SkillEngine: new () => SkillEngineT
let initDataDir: () => Promise<void>
let saveConfig: (c: Record<string, unknown>) => unknown
let getConfigDir: () => string
let validateWsMessage: (m: unknown) => { valid: boolean; error?: string }
let parseKnowledgeSuggestion: (raw: string) => { description?: string; tags?: string[] } | null
let KNOWLEDGE_EXTRACT_INPUT_CAP: number
let KNOWLEDGE_EXTRACT_TIMEOUT_MS: number

before(async () => {
  const mr = await import("../src/message-router")
  handleMessage = mr.handleMessage
  __testSetKnowledgeExtractImpl = mr.__testSetKnowledgeExtractImpl as never
  __testSetPickFolderNative = mr.__testSetPickFolderNative as never
  SkillEngine = (await import("../src/skills/skill-engine")).SkillEngine as never
  const cfg = await import("../src/config")
  initDataDir = cfg.initDataDir
  saveConfig = cfg.saveConfig as never
  getConfigDir = cfg.getConfigDir
  validateWsMessage = (await import("../src/ws/validate")).validateWsMessage
  const ex = await import("../src/llm/knowledge-draft-extract")
  parseKnowledgeSuggestion = ex.parseKnowledgeSuggestion
  KNOWLEDGE_EXTRACT_INPUT_CAP = ex.KNOWLEDGE_EXTRACT_INPUT_CAP
  KNOWLEDGE_EXTRACT_TIMEOUT_MS = ex.KNOWLEDGE_EXTRACT_TIMEOUT_MS
  await initDataDir()
})

after(() => {
  __testSetKnowledgeExtractImpl()
  __testSetPickFolderNative()
  fs.rmSync(tempHome, { recursive: true, force: true })
})

function resetKnowledge() {
  fs.rmSync(path.join(getConfigDir(), "knowledge"), { recursive: true, force: true })
}

let configMtimeSeed = Date.now()
function setLlmConfigured(configured: boolean) {
  if (configured) {
    saveConfig({
      llm: { api_key: "sk-test-extract", base_url: "http://127.0.0.1:9/v1", model_name: "test-model" },
    })
    return
  }
  // saveConfig REFUSES to clear api_key (resolveApiKey keeps the current key
  // on empty input) — write config.json directly and bump mtime so getConfig
  // reloads. This simulates "LLM 未配置" honestly.
  const configPath = path.join(getConfigDir(), "config.json")
  const cur = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, "utf-8")) : {}
  cur.llm = { ...(cur.llm || {}), api_key: "" }
  fs.writeFileSync(configPath, JSON.stringify(cur, null, 2))
  configMtimeSeed += 1000
  fs.utimesSync(configPath, new Date(configMtimeSeed), new Date(configMtimeSeed))
}

function makeSession(pushed: any[]) {
  return { sendToExtension: (d: any) => pushed.push(d) } as never
}

async function waitFor(cond: () => boolean, ms = 2000): Promise<void> {
  const deadline = Date.now() + ms
  while (!cond()) {
    if (Date.now() > deadline) throw new Error("waitFor timeout")
    await new Promise((r) => setTimeout(r, 10))
  }
}

const MD_WITH_TAGS = `---
name: 竞品调研
tags:
  - 竞品
  - News
---

# 竞品调研

正文：A 产品与 B 产品的功能对比。
`

test("AC-1/AC-2: no LLM config → Phase-1 heuristic + source tags, extract never starts, no push", async () => {
  resetKnowledge()
  setLlmConfigured(false)
  let calls = 0
  __testSetKnowledgeExtractImpl((async () => {
    calls++
    return { description: "x" }
  }) as ExtractImpl)
  const pushed: any[] = []
  const se = new SkillEngine()
  const resp = await handleMessage(
    { type: "knowledge.preview", id: "kp-no-llm", content: MD_WITH_TAGS },
    { skillEngine: se } as never,
    makeSession(pushed),
  )
  assert.equal(resp.type, "knowledge.preview")
  // Phase-1: heuristic draft present, source frontmatter tags normalized & prefilled
  assert.deepEqual(resp.tags, ["竞品", "news"])
  assert.ok(typeof resp.description === "string")
  assert.ok(!resp.suggested, "Phase-1 never carries suggested")
  assert.ok(!resp.extract_pending, "no LLM config → no extract_pending (UI must not wait)")
  await new Promise((r) => setTimeout(r, 50))
  assert.equal(calls, 0, "no network without LLM config")
  assert.equal(pushed.length, 0, "no preview_suggested frame without LLM config")
  assert.ok(!resp.body, "full body never goes on the wire")
})

test("AC-1: two-phase — Phase-2 pushes knowledge.preview_suggested (source llm) with the same kp- id", async () => {
  resetKnowledge()
  setLlmConfigured(true)
  __testSetKnowledgeExtractImpl((async () => {
    await new Promise((r) => setTimeout(r, 20))
    return { description: "AI 说明：竞品对比文档", tags: ["竞品"] }
  }) as ExtractImpl)
  const pushed: any[] = []
  const se = new SkillEngine()
  const resp = await handleMessage(
    { type: "knowledge.preview", id: "kp-llm", content: MD_WITH_TAGS },
    { skillEngine: se } as never,
    makeSession(pushed),
  )
  assert.equal(resp.type, "knowledge.preview")
  assert.equal(resp.extract_pending, true, "Phase-1 signals the async extraction")
  assert.deepEqual(resp.tags, ["竞品", "news"], "Phase-1 still carries source tags immediately")
  await waitFor(() => pushed.length > 0)
  const frame = pushed[0]
  assert.equal(frame.type, "knowledge.preview_suggested")
  assert.equal(frame.id, "kp-llm", "same kp- request id")
  assert.equal(frame.suggested.source, "llm")
  assert.equal(frame.suggested.description, "AI 说明：竞品对比文档")
  assert.deepEqual(frame.suggested.tags, ["竞品"])
  // F-S-7 / AC-3: preview path wrote nothing to disk
  const dir = path.join(getConfigDir(), "knowledge")
  const files = fs.existsSync(dir)
    ? (fs.readdirSync(dir, { recursive: true }) as string[]).filter((f) => String(f).endsWith(".md"))
    : []
  assert.deepEqual(files, [], "no knowledge file written before 确认导入")
})

test("AC-2: LLM failure → extract_error frame, no suggested, nothing hangs", async () => {
  resetKnowledge()
  setLlmConfigured(true)
  __testSetKnowledgeExtractImpl((async () => {
    throw new Error("extract timeout")
  }) as ExtractImpl)
  const pushed: any[] = []
  const se = new SkillEngine()
  const resp = await handleMessage(
    { type: "knowledge.preview", id: "kp-fail", content: MD_WITH_TAGS },
    { skillEngine: se } as never,
    makeSession(pushed),
  )
  assert.equal(resp.extract_pending, true)
  await waitFor(() => pushed.length > 0)
  const frame = pushed[0]
  assert.equal(frame.type, "knowledge.preview_suggested")
  assert.equal(frame.id, "kp-fail")
  assert.equal(frame.extract_error, "extract timeout")
  assert.ok(!frame.suggested, "failure never masquerades as an AI suggestion")
})

test("AC-2: empty LLM result is reported as extract_error, not as a suggestion", async () => {
  resetKnowledge()
  setLlmConfigured(true)
  // The real impl throws on unparseable output; simulate that contract here.
  __testSetKnowledgeExtractImpl((async () => {
    throw new Error("knowledge_extract_unparseable")
  }) as ExtractImpl)
  const pushed: any[] = []
  const se = new SkillEngine()
  await handleMessage(
    { type: "knowledge.preview", id: "kp-garbage", content: MD_WITH_TAGS },
    { skillEngine: se } as never,
    makeSession(pushed),
  )
  await waitFor(() => pushed.length > 0)
  assert.equal(pushed[0].extract_error, "knowledge_extract_unparseable")
  assert.ok(!pushed[0].suggested)
})

test("AC-6: parseKnowledgeSuggestion normalizes tags and drops secret-shaped ones", () => {
  const parsed = parseKnowledgeSuggestion('```json\n{"description":"竞品对比","tags":["sk-abc","竞品","API_KEY-x"]}\n```')
  assert.ok(parsed)
  assert.equal(parsed!.description, "竞品对比")
  assert.deepEqual(parsed!.tags, ["竞品"], "SENSITIVE_TAG_RE drops sk-/api_key shapes")
})

test("AC-6: parseKnowledgeSuggestion caps description at 500 and tags at 8", () => {
  const long = "长".repeat(600)
  const many = Array.from({ length: 12 }, (_, i) => `tag${i}`)
  const parsed = parseKnowledgeSuggestion(JSON.stringify({ description: long, tags: many }))
  assert.ok(parsed)
  assert.equal(parsed!.description!.length, 500)
  assert.equal(parsed!.tags!.length, 8)
})

test("AC-2: parseKnowledgeSuggestion returns null on non-JSON / empty payloads", () => {
  assert.equal(parseKnowledgeSuggestion("not json at all"), null)
  assert.equal(parseKnowledgeSuggestion(""), null)
  assert.equal(parseKnowledgeSuggestion("{}"), null)
  assert.equal(parseKnowledgeSuggestion('{"description":"","tags":[]}'), null)
  assert.equal(parseKnowledgeSuggestion('[1,2,3]'), null)
})

test("extract constants match spec §4 (8000 chars / 15s)", () => {
  assert.equal(KNOWLEDGE_EXTRACT_INPUT_CAP, 8000)
  assert.equal(KNOWLEDGE_EXTRACT_TIMEOUT_MS, 15000)
})

test("AC-4: directory import of 3 docs performs 0 extraction calls", async () => {
  resetKnowledge()
  setLlmConfigured(true)
  let calls = 0
  __testSetKnowledgeExtractImpl((async () => {
    calls++
    return { description: "x" }
  }) as ExtractImpl)
  const vault = fs.mkdtempSync(path.join(tempHome, "vault-"))
  for (const n of ["a", "b", "c"]) {
    fs.writeFileSync(path.join(vault, `${n}.md`), `# ${n}\n\n${n} 正文\n`)
  }
  __testSetPickFolderNative((async () => ({ path: vault })) as never)
  const pushed: any[] = []
  const se = new SkillEngine()
  const resp = await handleMessage(
    { type: "knowledge.import_directory", user_gesture: true },
    { skillEngine: se } as never,
    makeSession(pushed),
  )
  assert.equal(resp.type, "knowledge.import_directory_result")
  assert.equal(resp.imported, 3)
  assert.equal(calls, 0, "directory import must never call the extractor")
  assert.equal(pushed.length, 0, "no preview_suggested frames from directory import")
  __testSetPickFolderNative()
})

test("AC-5: extraction call sites are preview/suggest only — list/import paths perform 0 calls", async () => {
  // N3: the honest claim is "no extraction outside knowledge.preview /
  // knowledge.suggest"; this spy pins list + single-import at 0. There is no
  // background batch to count to 50 docs against.
  resetKnowledge()
  setLlmConfigured(true)
  let calls = 0
  __testSetKnowledgeExtractImpl((async () => {
    calls++
    return { description: "x" }
  }) as ExtractImpl)
  const se = new SkillEngine()
  const listResp = await handleMessage({ type: "knowledge.list" }, { skillEngine: se } as never)
  assert.equal(listResp.type, "knowledge.list")
  const importResp = await handleMessage(
    { type: "knowledge.import", user_gesture: true, content: "# 直接导入\n\n正文\n" },
    { skillEngine: se } as never,
  )
  assert.equal(importResp.type, "knowledge.list")
  assert.ok(importResp.imported?.id)
  assert.equal(calls, 0, "no extraction on list/import (extract is preview/suggest-only)")
})

test("AC-8: knowledge.suggest validation — id + user_gesture required", () => {
  assert.equal(validateWsMessage({ type: "knowledge.suggest" }).valid, false)
  assert.equal(validateWsMessage({ type: "knowledge.suggest", id: "k1" }).valid, false)
  assert.equal(validateWsMessage({ type: "knowledge.suggest", id: "k1", user_gesture: true }).valid, true)
  assert.equal(validateWsMessage({ type: "knowledge.preview_cancel" }).valid, false)
  assert.equal(validateWsMessage({ type: "knowledge.preview_cancel", id: "kp-1" }).valid, true)
})

test("AC-8: knowledge.suggest without user_gesture → 400-style error; summoner → SUMMONER_ACL", async () => {
  resetKnowledge()
  const se = new SkillEngine()
  const noGesture = await handleMessage({ type: "knowledge.suggest", id: "k1" }, { skillEngine: se } as never)
  assert.equal(noGesture.type, "error")
  assert.match(String(noGesture.error), /requires user_gesture/)
  const summoner = await handleMessage(
    { type: "knowledge.suggest", id: "k1", user_gesture: true, __cmspark_surface: "summoner" },
    { skillEngine: se } as never,
  )
  assert.equal(summoner.type, "error")
  assert.equal(summoner.error_code, "SUMMONER_ACL")
  // The WS gate + summoner-web dispatch allowlist stay closed for the new verbs.
  const { assertSummonerAllowed } = await import("../src/ws/summoner-acl")
  const { SUMMONER_WEB_DISPATCH_ALLOW } = await import("../src/summoner-web")
  assert.equal(assertSummonerAllowed("summoner", "knowledge.suggest").ok, false)
  assert.equal(assertSummonerAllowed("summoner", "knowledge.preview_cancel").ok, false)
  assert.equal(SUMMONER_WEB_DISPATCH_ALLOW.has("knowledge.suggest"), false)
  assert.equal(SUMMONER_WEB_DISPATCH_ALLOW.has("knowledge.preview_cancel"), false)
})

test("AC-8: summoner preview never starts an extraction (overlay/summoner 无入口)", async () => {
  resetKnowledge()
  setLlmConfigured(true)
  let calls = 0
  __testSetKnowledgeExtractImpl((async () => {
    calls++
    return { description: "x" }
  }) as ExtractImpl)
  const pushed: any[] = []
  const se = new SkillEngine()
  const resp = await handleMessage(
    { type: "knowledge.preview", id: "kp-summoner", content: MD_WITH_TAGS, __cmspark_surface: "summoner" },
    { skillEngine: se } as never,
    makeSession(pushed),
  )
  assert.equal(resp.type, "knowledge.preview")
  assert.ok(!resp.extract_pending)
  await new Promise((r) => setTimeout(r, 50))
  assert.equal(calls, 0)
  assert.equal(pushed.length, 0)
})

test("AC-3: knowledge.suggest returns a draft and never writes disk/frontmatter", async () => {
  resetKnowledge()
  setLlmConfigured(true)
  const se = new SkillEngine()
  const imported = se.importKnowledge("# 已有文档\n\n原始正文内容\n", "existing-doc")
  assert.ok(imported.id)
  const fileBefore = fs.readFileSync(
    path.join(getConfigDir(), "knowledge", "global", `${imported.id}.md`),
    "utf-8",
  )
  __testSetKnowledgeExtractImpl((async () => ({
    description: "AI 起草的说明",
    tags: ["草稿"],
  })) as ExtractImpl)
  const resp = await handleMessage(
    { type: "knowledge.suggest", id: imported.id, user_gesture: true },
    { skillEngine: se } as never,
  )
  assert.equal(resp.type, "knowledge.suggest")
  assert.equal(resp.id, imported.id)
  assert.equal(resp.suggested.source, "llm")
  assert.equal(resp.suggested.description, "AI 起草的说明")
  assert.deepEqual(resp.suggested.tags, ["草稿"])
  const fileAfter = fs.readFileSync(
    path.join(getConfigDir(), "knowledge", "global", `${imported.id}.md`),
    "utf-8",
  )
  assert.equal(fileAfter, fileBefore, "suggest must not touch disk")
  const listed = se.listKnowledge().find((d) => d.id === imported.id || d.name === imported.id)
  assert.ok(listed, "imported doc must be listed (N4: no vacuous assertions)")
  assert.ok(!listed!.tags?.includes("草稿"), "suggested tags never enter listKnowledge")
  assert.notEqual(listed!.description, "AI 起草的说明")
})

test("knowledge.suggest without LLM config → extract_error, no network", async () => {
  resetKnowledge()
  setLlmConfigured(false)
  __testSetKnowledgeExtractImpl() // restore the real impl — must fail before any fetch
  const se = new SkillEngine()
  const imported = se.importKnowledge("# 无配置\n\n正文\n", "no-config-doc")
  const resp = await handleMessage(
    { type: "knowledge.suggest", id: imported.id, user_gesture: true },
    { skillEngine: se } as never,
  )
  assert.equal(resp.type, "knowledge.suggest")
  assert.equal(resp.extract_error, "companion_llm_not_configured")
  assert.ok(!resp.suggested)
})

test("knowledge.preview_cancel aborts the in-flight extraction; no suggested frame afterwards", async () => {
  resetKnowledge()
  setLlmConfigured(true)
  let aborted = false
  __testSetKnowledgeExtractImpl(((({ signal }: { signal?: AbortSignal }) =>
    new Promise((resolve) => {
      signal?.addEventListener("abort", () => {
        aborted = true
        resolve({ description: "太晚了" })
      })
    })) as unknown) as ExtractImpl)
  const pushed: any[] = []
  const se = new SkillEngine()
  const resp = await handleMessage(
    { type: "knowledge.preview", id: "kp-cancel", content: MD_WITH_TAGS },
    { skillEngine: se } as never,
    makeSession(pushed),
  )
  assert.equal(resp.extract_pending, true)
  const cancel = await handleMessage(
    { type: "knowledge.preview_cancel", id: "kp-cancel" },
    { skillEngine: se } as never,
    makeSession(pushed),
  )
  assert.equal(cancel.ok, true)
  await waitFor(() => aborted)
  await new Promise((r) => setTimeout(r, 50))
  assert.equal(pushed.length, 0, "aborted extraction pushes nothing (跳过解读)")
})

test("knowledge.preview_cancel on an unknown id is a harmless no-op", async () => {
  const se = new SkillEngine()
  const resp = await handleMessage(
    { type: "knowledge.preview_cancel", id: "kp-nonexistent" },
    { skillEngine: se } as never,
    makeSession([]),
  )
  assert.equal(resp.type, "knowledge.preview_cancel")
  assert.equal(resp.ok, true)
})

test("M1: same-id re-preview — the stale run's finally must not delete the new controller; cancel then aborts run 2", async () => {
  resetKnowledge()
  setLlmConfigured(true)
  const aborted: number[] = []
  let call = 0
  __testSetKnowledgeExtractImpl(((({ signal }: { signal?: AbortSignal }) => {
    const mine = ++call
    return new Promise((resolve) => {
      signal?.addEventListener("abort", () => {
        aborted.push(mine)
        resolve({ description: `run-${mine}` })
      })
    })
  }) as unknown) as ExtractImpl)
  const pushed: any[] = []
  const se = new SkillEngine()
  await handleMessage(
    { type: "knowledge.preview", id: "kp-overlap", content: MD_WITH_TAGS },
    { skillEngine: se } as never,
    makeSession(pushed),
  )
  // Same id again before run 1 settles: run 1 is superseded and aborted.
  await handleMessage(
    { type: "knowledge.preview", id: "kp-overlap", content: MD_WITH_TAGS },
    { skillEngine: se } as never,
    makeSession(pushed),
  )
  await waitFor(() => aborted.includes(1))
  // Run 1's finally already ran here — with a blind Map.delete it would have
  // removed run 2's controller, making the cancel below a no-op.
  await new Promise((r) => setTimeout(r, 20))
  const cancel = await handleMessage(
    { type: "knowledge.preview_cancel", id: "kp-overlap" },
    { skillEngine: se } as never,
    makeSession(pushed),
  )
  assert.equal(cancel.ok, true)
  await waitFor(() => aborted.includes(2), 1000)
  await new Promise((r) => setTimeout(r, 30))
  assert.equal(pushed.length, 0, "both aborted runs push nothing")
})

test("M2: cancel during the parse window tombstones the id — the later preview never starts an extraction", async () => {
  resetKnowledge()
  setLlmConfigured(true)
  let calls = 0
  __testSetKnowledgeExtractImpl((async () => {
    calls++
    return { description: "x" }
  }) as ExtractImpl)
  const pushed: any[] = []
  const se = new SkillEngine()
  // Cancel arrives while parsing (Map still empty) — no in-flight controller.
  const cancel = await handleMessage(
    { type: "knowledge.preview_cancel", id: "kp-early-cancel" },
    { skillEngine: se } as never,
    makeSession(pushed),
  )
  assert.equal(cancel.ok, true)
  const resp = await handleMessage(
    { type: "knowledge.preview", id: "kp-early-cancel", content: MD_WITH_TAGS },
    { skillEngine: se } as never,
    makeSession(pushed),
  )
  assert.equal(resp.type, "knowledge.preview")
  assert.ok(!resp.extract_pending, "pre-cancelled id never arms extract_pending")
  await new Promise((r) => setTimeout(r, 50))
  assert.equal(calls, 0, "pre-cancelled preview must not send body to the LLM")
  assert.equal(pushed.length, 0)
  // The tombstone is consumed by the first start attempt — but ids are
  // uuid-unique per request, so a genuine retry uses a fresh id anyway.
})

test("M3 e2e: secret-shaped tags are dropped on the frame AND on disk after import", async () => {
  resetKnowledge()
  setLlmConfigured(true)
  __testSetKnowledgeExtractImpl((async () => ({
    description: "竞品对比文档",
    // An injected impl bypassing parseKnowledgeSuggestion must still lose
    // secret-shaped tags at the handler's trust boundary.
    tags: ["sk-abc", "竞品"],
  })) as ExtractImpl)
  const pushed: any[] = []
  const se = new SkillEngine()
  const resp = await handleMessage(
    { type: "knowledge.preview", id: "kp-secret-tags", content: "# 对比\n\nA 与 B 对比正文\n" },
    { skillEngine: se } as never,
    makeSession(pushed),
  )
  assert.equal(resp.extract_pending, true)
  await waitFor(() => pushed.length > 0)
  assert.deepEqual(pushed[0].suggested.tags, ["竞品"], "frame carries only non-secret tags")
  // User confirms with those tags → disk + listKnowledge carry only 竞品.
  const importResp = await handleMessage(
    {
      type: "knowledge.import",
      user_gesture: true,
      content: "# 对比\n\nA 与 B 对比正文\n",
      title: "对比",
      description: pushed[0].suggested.description,
      tags: pushed[0].suggested.tags,
    },
    { skillEngine: se } as never,
  )
  assert.ok(importResp.imported?.id)
  const listed = importResp.docs.find((d: any) => d.id === importResp.imported.id)
  assert.ok(listed, "imported doc must be in the returned list")
  assert.deepEqual(listed.tags, ["竞品"])
  const onDisk = fs.readFileSync(
    path.join(getConfigDir(), "knowledge", "global", `${importResp.imported.id}.md`),
    "utf-8",
  )
  assert.ok(!onDisk.includes("sk-abc"), "secret-shaped tag never reaches disk")
})

test("M3 ingest: knowledge.update tags also pass normalizeTags (SENSITIVE_TAG_RE)", async () => {
  resetKnowledge()
  const se = new SkillEngine()
  const imported = se.importKnowledge("# 标签更新\n\n正文\n", "tag-update-doc")
  const resp = await handleMessage(
    { type: "knowledge.update", id: imported.id, user_gesture: true, tags: ["sk-live", "竞品", "News"] },
    { skillEngine: se } as never,
  )
  assert.equal(resp.type, "knowledge.updated")
  const doc = se.getKnowledge(imported.id)
  assert.ok(doc)
  assert.deepEqual(doc!.tags, ["竞品", "news"], "update drops secret shapes, lowercases, keeps order")
})

test("F2: frontmatter with name but no description → Phase-1 falls back to the 150-char heuristic", async () => {
  resetKnowledge()
  setLlmConfigured(false)
  const se = new SkillEngine()
  const longBody = "这是一篇没有 description 的文档，正文足够长以触发启发式截断。".repeat(6)
  const resp = await handleMessage(
    { type: "knowledge.preview", id: "kp-heur", content: `---\nname: 无说明文档\n---\n\n${longBody}\n` },
    { skillEngine: se } as never,
    makeSession([]),
  )
  assert.equal(resp.type, "knowledge.preview")
  assert.ok(resp.description.length > 0, "modal description is never empty for a non-empty body")
  assert.ok(resp.description.startsWith("这是一篇没有 description 的文档"), "heuristic body-derived text")
  assert.ok(resp.description.endsWith("..."), "150-char truncation marker")
})

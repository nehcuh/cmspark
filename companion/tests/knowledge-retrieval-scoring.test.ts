import test, { after, before } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { performance } from "node:perf_hooks"

// #273 Wave A: 知识检索打分 + top-k + 跨文档预算 + 降级路径
// Spec: docs/superpowers/specs/2026-09-02-knowledge-retrieval-scoring-design.md §2/§8 Wave A

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-k-scoring-"))
process.env.HOME = tempHome
process.env.CMSPARK_DATA_DIR = path.join(tempHome, ".cmspark-agent")
delete process.env.DEEPSEEK_API_KEY

let initDataDir: typeof import("../src/config").initDataDir
let getConfigDir: typeof import("../src/config").getConfigDir
let ThreadManager: typeof import("../src/threads/thread-manager").ThreadManager
let SkillEngine: typeof import("../src/skills/skill-engine").SkillEngine
let KNOWLEDGE_DOC_TOPK_AUTO: number
let KNOWLEDGE_DOC_TOPK_ALL: number
let KNOWLEDGE_INJECT_BUDGET_CHARS: number
let KNOWLEDGE_WRAP_OVERHEAD_CHARS: number
let KNOWLEDGE_EMPTY_QUERY_DESCRIPTION_CHARS: number

before(async () => {
  const configMod = await import("../src/config")
  initDataDir = configMod.initDataDir
  getConfigDir = configMod.getConfigDir
  ThreadManager = (await import("../src/threads/thread-manager")).ThreadManager
  const seMod = await import("../src/skills/skill-engine")
  SkillEngine = seMod.SkillEngine
  KNOWLEDGE_DOC_TOPK_AUTO = seMod.KNOWLEDGE_DOC_TOPK_AUTO
  KNOWLEDGE_DOC_TOPK_ALL = seMod.KNOWLEDGE_DOC_TOPK_ALL
  KNOWLEDGE_INJECT_BUDGET_CHARS = seMod.KNOWLEDGE_INJECT_BUDGET_CHARS
  KNOWLEDGE_WRAP_OVERHEAD_CHARS = seMod.KNOWLEDGE_WRAP_OVERHEAD_CHARS
  KNOWLEDGE_EMPTY_QUERY_DESCRIPTION_CHARS = seMod.KNOWLEDGE_EMPTY_QUERY_DESCRIPTION_CHARS
  await initDataDir()
})

after(() => {
  fs.rmSync(tempHome, { recursive: true, force: true })
})

// Wipe knowledge dirs so each test is isolated.
function resetKnowledgeDirs() {
  const kDir = path.join(getConfigDir(), "knowledge")
  fs.rmSync(kDir, { recursive: true, force: true })
}

function seedDoc(
  name: string,
  opts: { title?: string; description?: string; tags?: string[]; body?: string; site?: string } = {},
) {
  const dir = path.join(getConfigDir(), "knowledge", opts.site ? "sites" : "global")
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  const lines = ["---", `name: ${name}`]
  if (opts.title) lines.push(`title: ${opts.title}`)
  lines.push(`description: ${opts.description ?? "test knowledge"}`)
  lines.push(`type: ${opts.site ? "site_knowledge" : "domain_knowledge"}`)
  if (opts.site) lines.push(`site: ${opts.site}`)
  if (opts.tags?.length) lines.push(`tags: [${opts.tags.join(", ")}]`)
  lines.push("---", "", opts.body ?? `# ${name}\n\nfacts\n`)
  fs.writeFileSync(path.join(dir, `${name}.md`), lines.join("\n"), { mode: 0o600 })
}

function makeThread(tm: InstanceType<typeof ThreadManager>, alias: string, updates: Record<string, any> = {}) {
  const th = tm.create(alias)
  if (Object.keys(updates).length) tm.update(th.id, updates)
  return th
}

/** Sum of actual knowledge blocks in the prompt (## Knowledge: … </untrusted-…>). */
function knowledgeBlockChars(prompt: string): number {
  const blocks = prompt.match(/## Knowledge:[\s\S]*?<\/untrusted-[a-f0-9]{12}>/g) || []
  return blocks.reduce((s, b) => s + b.length, 0)
}

// --- AC-1: auto 按当轮 query 打分选文，站点无关文档不再硬灌 ---

test("AC-1: auto scores this-turn query; relevant docs in top-5, unrelated site doc excluded", () => {
  resetKnowledgeDirs()
  seedDoc("refund-policy-a", {
    title: "退款政策",
    description: "退款政策说明：七天无理由退款",
    body: "退款政策正文\n",
  })
  seedDoc("refund-policy-b", {
    title: "退款政策 FAQ",
    description: "退款政策常见问题解答",
    body: "退款政策问答正文\n",
  })
  // 10 filler docs — no overlap with query tokens (退款/款怎/怎么/么处/处理/理)
  const fillers = ["烹饪指南", "健身计划", "旅游攻略", "编程入门", "摄影技巧", "园艺养护", "宠物喂养", "音乐欣赏", "绘画基础", "茶艺入门"]
  fillers.forEach((t, i) =>
    seedDoc(`filler-${String(i).padStart(2, "0")}`, { title: t, description: `${t}说明`, body: `${t}正文\n` }),
  )
  // Site doc matching hostname but totally unrelated — the old behavior hard-injected it
  seedDoc("site-unrelated", {
    site: "shop.example.com",
    title: "配送说明",
    description: "配送范围与时间",
    body: "配送正文\n",
  })

  const se = new SkillEngine()
  se.refresh()
  const tm = new ThreadManager()
  const th = makeThread(tm, "ac1", { knowledge_selection_mode: "auto" })

  const ids = se.resolveKnowledgeIdsForThread(th.id, "auto", "shop.example.com", "退款怎么处理")
  assert.ok(ids.includes("refund-policy-a"), `refund-policy-a must be selected: ${JSON.stringify(ids)}`)
  assert.ok(ids.includes("refund-policy-b"), `refund-policy-b must be selected: ${JSON.stringify(ids)}`)
  assert.ok(!ids.includes("site-unrelated"), "unrelated site doc must NOT be hard-injected anymore")
  assert.ok(ids.length <= KNOWLEDGE_DOC_TOPK_AUTO, `auto top-k cap: ${ids.length}`)

  // Injection side: same ids produce knowledge blocks for the two relevant docs only
  const { retrieved_sources } = se.buildSystemPromptWithSources(th.id, undefined, [], ids, "退款怎么处理")
  const injected = retrieved_sources.map(s => s.id)
  assert.ok(injected.includes("refund-policy-a") && injected.includes("refund-policy-b"))
  assert.ok(!injected.includes("site-unrelated"))
})

// --- AC-2: all 模式跨文档硬预算 + top-8 + 包装上界 ---

test("AC-2: all + 30 docs × 2000 chars → knowledge payload ≤ 8000, sources ≤ 8, wrap overhead bounded", () => {
  resetKnowledgeDirs()
  // 15 篇含查询关键词（smoothed IDF 对「每篇都含」的词给 0 分，故只让半数命中）+ 15 篇填充
  for (let i = 1; i <= 30; i++) {
    const hit = i <= 15
    seedDoc(`ac2-doc-${String(i).padStart(2, "0")}`, {
      title: hit ? `报销流程 第${i}号` : `烹饪指南 第${i}号`,
      description: hit ? `报销流程说明 第${i}号` : `烹饪指南说明 第${i}号`,
      body: "x".repeat(2000), // exactly 2000 → 不触发 per-doc 截断也不触发 chunking
    })
  }
  const se = new SkillEngine()
  se.refresh()
  const tm = new ThreadManager()
  const th = makeThread(tm, "ac2", { knowledge_selection_mode: "all" })

  const ids = se.resolveKnowledgeIdsForThread(th.id, "all", undefined, "报销流程怎么走")
  assert.ok(ids.length <= KNOWLEDGE_DOC_TOPK_ALL, `all top-k cap: ${ids.length}`)

  const { prompt, retrieved_sources } = se.buildSystemPromptWithSources(th.id, undefined, [], ids)
  const contentChars = retrieved_sources.reduce((s, r) => s + r.chars, 0)
  assert.ok(contentChars <= KNOWLEDGE_INJECT_BUDGET_CHARS, `content budget: ${contentChars}`)
  assert.ok(retrieved_sources.length <= KNOWLEDGE_DOC_TOPK_ALL, `sources: ${retrieved_sources.length}`)
  // 预算确实bite了：8 篇 × 2000 = 16000 > 8000
  assert.ok(retrieved_sources.length < ids.length, "budget must stop before all top-8 are fully injected")

  // 包装开销断言：每篇 = 内容 + 固定标记(KNOWLEDGE_WRAP_OVERHEAD_CHARS) + title/id 变长
  const wrapBound =
    KNOWLEDGE_INJECT_BUDGET_CHARS +
    retrieved_sources.reduce(
      (s, r) => s + KNOWLEDGE_WRAP_OVERHEAD_CHARS + r.title.length + r.id.length,
      0,
    )
  const actual = knowledgeBlockChars(prompt)
  assert.ok(actual > KNOWLEDGE_INJECT_BUDGET_CHARS, "wrap markup is on top of content")
  assert.ok(actual <= wrapBound, `payload ${actual} must be ≤ ${wrapBound}`)
})

// --- AC-3: manual 勾选优先，但仍受预算截断且如实可见 ---

test("AC-3: manual pinned 10 × 2500 chars → order preserved, total ≤ budget, truncation visible", () => {
  resetKnowledgeDirs()
  const names: string[] = []
  for (let i = 1; i <= 10; i++) {
    const name = `ac3-doc-${String(i).padStart(2, "0")}`
    names.push(name)
    seedDoc(name, { description: `文档${i}`, body: "y".repeat(2500) })
  }
  const se = new SkillEngine()
  se.refresh()
  const tm = new ThreadManager()
  const th = makeThread(tm, "ac3", {
    active_knowledge_ids: names,
    knowledge_selection_mode: "manual",
  })

  const ids = se.resolveKnowledgeIdsForThread(th.id, "manual")
  assert.deepEqual(ids, names, "manual = 勾选全进、按勾选顺序、不打分")

  const { prompt, retrieved_sources } = se.buildSystemPromptWithSources(th.id, undefined, [], ids)
  const total = retrieved_sources.reduce((s, r) => s + r.chars, 0)
  assert.ok(total <= KNOWLEDGE_INJECT_BUDGET_CHARS, `manual still budget-capped: ${total}`)
  assert.ok(retrieved_sources.length < names.length, "budget stops mid-list")
  // 优先顺序保持：前 N 篇就是勾选顺序的前 N 篇
  assert.deepEqual(
    retrieved_sources.map(s => s.id),
    names.slice(0, retrieved_sources.length),
  )
  // 截断篇如实可见：最后一篇 chars 小于完整 summary（2000 + 截断标记），且带截断标记
  const last = retrieved_sources[retrieved_sources.length - 1]
  assert.ok(last.chars < 2016, `truncated doc visible via chars: ${last.chars}`)
  assert.ok(prompt.includes("(truncated)"), "truncation marker visible in prompt")
})

// --- AC-4: 知识检索回路零 LLM ---

test("AC-4: knowledge retrieval never touches LLM rerank/extract paths", () => {
  resetKnowledgeDirs()
  seedDoc("llm-guard-doc", { title: "退款政策", description: "退款政策说明", body: "正文\n" })
  // 填充文档保证语料里目标词 df < n（smoothed IDF 对全语料词给 0 分）
  for (let i = 0; i < 5; i++) seedDoc(`llm-fill-${i}`, { title: `烹饪指南${i}`, description: `烹饪说明${i}` })
  const se = new SkillEngine()
  se.refresh()
  const tm = new ThreadManager()
  const th = makeThread(tm, "ac4")

  // llmRerank 是 SkillEngine 实例方法（matchSkills 双轨用），实例 spy 真有效
  let llmCalls = 0
  ;(se as any).llmRerank = () => { llmCalls++; throw new Error("LLM must not be called in knowledge retrieval") }

  const ids = se.resolveKnowledgeIdsForThread(th.id, "auto", undefined, "退款怎么处理")
  se.buildSystemPromptWithSources(th.id, undefined, [], ids, "退款怎么处理")
  assert.equal(llmCalls, 0, "knowledge retrieval loop must be LLM-free")
  assert.deepEqual(ids, ["llm-guard-doc"])
})

// AC-4 静态闸：llmExtract/createProvider 是模块级 import，实例 spy 拦不住；
// 改为对检索回路函数体做源码白名单断言（含 import 面以外的唯二 LLM 触达点名）。
test("AC-4 (static): retrieval-path function bodies never name llmExtract/llmRerank/createProvider", () => {
  const candidates = [
    path.join(__dirname, "../src/skills/skill-engine.ts"),
    path.join(__dirname, "../../src/skills/skill-engine.ts"),
    path.join(process.cwd(), "src/skills/skill-engine.ts"),
  ]
  let src = ""
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      src = fs.readFileSync(p, "utf8")
      break
    }
  }
  assert.ok(src, "skill-engine.ts not found for static retrieval-loop assertion")

  const bodies: Record<string, string> = {}
  // resolveKnowledgeIdsForThread 与 scoreKnowledgePool 相邻：resolve 起 → scoreKnowledgePool 的 return scored 止
  const resolveStart = src.indexOf("  resolveKnowledgeIdsForThread(")
  const scoreEnd = src.indexOf("return scored\n  }")
  assert.ok(resolveStart > 0 && scoreEnd > resolveStart, "resolve/scoreKnowledgePool region located")
  bodies.resolveAndScore = src.slice(resolveStart, scoreEnd)
  // getKnowledgeSummary（块级 top-3 再裁，也在检索回路内）
  const summaryStart = src.indexOf("  private getKnowledgeSummary(")
  const summaryEnd = src.indexOf("return content.trim()\n  }", summaryStart)
  assert.ok(summaryStart > 0 && summaryEnd > summaryStart, "getKnowledgeSummary body located")
  bodies.getKnowledgeSummary = src.slice(summaryStart, summaryEnd)

  for (const [name, body] of Object.entries(bodies)) {
    assert.ok(
      !/llmExtract|llmRerank|createProvider/.test(body),
      `${name} must not reference LLM entry points`,
    )
  }
})

// --- AC-5: 200 篇打分性能 ---

test("AC-5: 200 docs scoring resolves in < 50ms (spec §8 AC-5)", () => {
  resetKnowledgeDirs()
  for (let i = 0; i < 200; i++) {
    seedDoc(`perf-doc-${String(i).padStart(3, "0")}`, {
      title: `性能文档${i}`,
      description: `短元数据 ${i}`,
      tags: ["perf", `t${i % 10}`],
      body: "short\n",
    })
  }
  const se = new SkillEngine()
  se.refresh()
  const tm = new ThreadManager()
  const th = makeThread(tm, "ac5")

  // warm-up（tokenizer RegExp 等一次性成本）
  se.resolveKnowledgeIdsForThread(th.id, "auto", undefined, "性能文档")
  const t0 = performance.now()
  se.resolveKnowledgeIdsForThread(th.id, "auto", undefined, "性能文档")
  const dt = performance.now() - t0
  assert.ok(dt < 50, `single resolve over 200 docs took ${dt.toFixed(1)}ms (spec: < 50ms)`)
})

// --- 降级：打分抛错 → 回退 legacy 选择 ---

test("degradation: scoring exception falls back to legacy selection (same id set as smartMatch=false); injection budget safety net still applies", () => {
  resetKnowledgeDirs()
  seedDoc("deg-pinned", { title: "退款政策", description: "退款政策说明" })
  seedDoc("deg-site", { site: "deg.example.com", title: "站点文档", description: "站点说明" })
  seedDoc("deg-other", { title: "其它文档", description: "其它说明" })

  const tm = new ThreadManager()
  const th = makeThread(tm, "deg", { active_knowledge_ids: ["deg-pinned"] })

  const seBroken = new SkillEngine()
  seBroken.refresh()
  ;(seBroken as any).scoreKnowledgePool = () => { throw new Error("injected scoring failure") }
  const fellBack = seBroken.resolveKnowledgeIdsForThread(th.id, "auto", "deg.example.com", "退款怎么处理")

  const seLegacy = new SkillEngine()
  const legacy = seLegacy.resolveKnowledgeIdsForThread(th.id, "auto", "deg.example.com", "退款怎么处理", false)
  assert.deepEqual(fellBack, legacy, "fallback id list must equal the legacy (smartMatch=false) selection")
  assert.deepEqual(fellBack, ["deg-pinned", "deg-site"], "legacy = pinned ∪ site")

  // spec §2.5 合成语义：选择层回退 legacy，注入层 8000 预算安全网不随回退关闭
  const { retrieved_sources } = seBroken.buildSystemPromptWithSources(th.id, undefined, [], fellBack)
  const total = retrieved_sources.reduce((s, r) => s + r.chars, 0)
  assert.ok(total <= KNOWLEDGE_INJECT_BUDGET_CHARS, `budget still applies after fallback: ${total}`)
})

// --- 降级：空 query + auto → pinned ∪ site，注入侧每篇只灌 description ---

test("degradation: empty query auto → pinned ∪ site selection; descriptionOnly injection", () => {
  resetKnowledgeDirs()
  const longDesc = "描".repeat(600) // 超过 500 → 注入截到 500
  seedDoc("eq-pinned", { title: "钉住文档", description: "钉住的说明", body: "PINNED_BODY_SECRET" })
  seedDoc("eq-site", { site: "eq.example.com", title: "站点文档", description: longDesc, body: "SITE_BODY_SECRET" })
  // 无 description 的文档必须真进候选集（pin 住），跳过断言才不为空
  seedDoc("eq-nodesc", { title: "无说明文档", description: "", body: "NODESC_BODY_SECRET" })

  const se = new SkillEngine()
  se.refresh()
  const tm = new ThreadManager()
  const th = makeThread(tm, "eq", { active_knowledge_ids: ["eq-pinned", "eq-nodesc"] })

  const ids = se.resolveKnowledgeIdsForThread(th.id, "auto", "eq.example.com", "")
  assert.deepEqual(ids, ["eq-pinned", "eq-nodesc", "eq-site"], "empty query → pinned ∪ site（含无 description 的 pinned）")

  const { prompt, retrieved_sources } = se.buildSystemPromptWithSources(
    th.id, undefined, [], ids, undefined, { knowledgeDescriptionOnly: true },
  )
  // 正文不灌
  assert.ok(!prompt.includes("PINNED_BODY_SECRET") && !prompt.includes("SITE_BODY_SECRET"))
  // description 注入且 ≤ 500
  const site = retrieved_sources.find(s => s.id === "eq-site")
  assert.ok(site, "site doc injected via description")
  assert.equal(site!.chars, KNOWLEDGE_EMPTY_QUERY_DESCRIPTION_CHARS)
  // 无 description 的篇（已在候选集里）跳过不注入，正文也不进 prompt
  assert.ok(!retrieved_sources.some(s => s.id === "eq-nodesc"), "pinned doc without description is skipped")
  assert.ok(!prompt.includes("NODESC_BODY_SECRET"), "skipped doc body must not leak into prompt")
})

// --- 钉死：all + 空 query 仍灌正文（spec §2.5 字面） ---

test("pinned semantics: all + empty query → legacy full-library selection, bodies injected under budget", () => {
  // spec §2.5 只钉了 auto 的空 query 退化（descriptionOnly）；all 空 query 按 legacy
  // 全库选择 + 8000 预算，不做 descriptionOnly —— 此用例钉死该行为，防止被当成洞。
  resetKnowledgeDirs()
  for (let i = 1; i <= 6; i++) {
    seedDoc(`all-eq-${i}`, { description: `文档${i}`, body: `ALL_EQ_BODY_${i} ` + "v".repeat(2500) })
  }
  const se = new SkillEngine()
  se.refresh()
  const tm = new ThreadManager()
  const th = makeThread(tm, "all-eq", { knowledge_selection_mode: "all" })

  const ids = se.resolveKnowledgeIdsForThread(th.id, "all", undefined, "")
  assert.equal(ids.length, 6, "all + empty query → 全库 legacy 选择，不打分不截 top-k")

  // 注入侧不走 descriptionOnly（该标记只在 auto 计算），正文在预算内灌入
  const { prompt, retrieved_sources } = se.buildSystemPromptWithSources(th.id, undefined, [], ids, "")
  assert.ok(prompt.includes("ALL_EQ_BODY_1"), "all + empty query still injects bodies (not descriptionOnly)")
  const total = retrieved_sources.reduce((s, r) => s + r.chars, 0)
  assert.ok(total <= KNOWLEDGE_INJECT_BUDGET_CHARS, `budget caps legacy all injection: ${total}`)
  assert.ok(retrieved_sources.length < ids.length, "budget truncation bites")
})

// --- 降级：smartMatch=false → 旧选择行为，但预算仍执行 ---

test("degradation: smartMatch=false keeps legacy selection but budget still applies", () => {
  resetKnowledgeDirs()
  const pinned: string[] = []
  for (let i = 1; i <= 6; i++) {
    const name = `sm-off-p${i}`
    pinned.push(name)
    seedDoc(name, { description: `文档${i}`, body: "z".repeat(2500) })
  }
  // 与 query 完全无关的站点文档：旧行为照进
  seedDoc("sm-off-site", { site: "sm.example.com", title: "配送说明", description: "配送范围", body: "w".repeat(2500) })

  const se = new SkillEngine()
  se.refresh()
  const tm = new ThreadManager()
  const th = makeThread(tm, "sm-off", { active_knowledge_ids: pinned })

  const ids = se.resolveKnowledgeIdsForThread(th.id, "auto", "sm.example.com", "退款怎么处理", false)
  assert.deepEqual(ids, [...pinned, "sm-off-site"], "smartMatch=false → pinned ∪ site，不打分")

  const { retrieved_sources } = se.buildSystemPromptWithSources(th.id, undefined, [], ids)
  const total = retrieved_sources.reduce((s, r) => s + r.chars, 0)
  assert.ok(total <= KNOWLEDGE_INJECT_BUDGET_CHARS, `budget must still apply when smart match is off: ${total}`)
  assert.ok(retrieved_sources.length < ids.length, "budget truncation bites even with smartMatch=false")
})

// --- 并列 tie-break：同分取 id 字典序最小 ---

test("tie-break: equal scores pick lexicographically smallest id first", () => {
  resetKnowledgeDirs()
  // 完全相同的 bag → 完全相同的裸分
  seedDoc("tie-b", { title: "共同标题", description: "共同说明文本", body: "b\n" })
  seedDoc("tie-a", { title: "共同标题", description: "共同说明文本", body: "a\n" })
  // 填充文档保证语料里目标词 df < n
  for (let i = 0; i < 5; i++) seedDoc(`tie-fill-${i}`, { title: `烹饪指南${i}`, description: `烹饪说明${i}` })
  const se = new SkillEngine()
  se.refresh()
  const tm = new ThreadManager()
  const th = makeThread(tm, "tie")

  const ids = se.resolveKnowledgeIdsForThread(th.id, "auto", undefined, "共同标题")
  assert.ok(ids.includes("tie-a") && ids.includes("tie-b"), `both tied docs selected: ${JSON.stringify(ids)}`)
  assert.ok(ids.indexOf("tie-a") < ids.indexOf("tie-b"), "tie → id 字典序最小优先")
})

// --- SITE_BOOST 只改排序不改阈值 ---

test("site boost affects ordering only, never bypasses the raw-score threshold", () => {
  resetKnowledgeDirs()
  // 相同 bag：裸分相同；site 命中者 rank +0.15 排前（tie-break 本来会把 plain 排前）
  seedDoc("boost-plain", { title: "部署手册", description: "部署手册说明", body: "plain\n" })
  seedDoc("boost-site", { site: "ops.example.com", title: "部署手册", description: "部署手册说明", body: "site\n" })
  // 裸分为 0 的站点文档：加权 0.15 也不得入选
  seedDoc("boost-zero-site", { site: "ops.example.com", title: "配送范围", description: "配送范围说明", body: "zero\n" })
  // 填充文档保证语料里目标词 df < n
  for (let i = 0; i < 5; i++) seedDoc(`boost-fill-${i}`, { title: `烹饪指南${i}`, description: `烹饪说明${i}` })

  const se = new SkillEngine()
  se.refresh()
  const tm = new ThreadManager()
  const th = makeThread(tm, "boost")

  const ids = se.resolveKnowledgeIdsForThread(th.id, "auto", "ops.example.com", "部署手册怎么用")
  assert.ok(ids.indexOf("boost-site") !== -1 && ids.indexOf("boost-plain") !== -1)
  assert.ok(ids.indexOf("boost-site") < ids.indexOf("boost-plain"), "site hit ranks first via boost")
  assert.ok(!ids.includes("boost-zero-site"), "raw 0 + boost 0.15 must NOT pass the 0.10 raw threshold")
})

// --- pinned 不被 top-k 截 ---

test("pinned docs are never truncated by top-k", () => {
  resetKnowledgeDirs()
  const pinned: string[] = []
  for (let i = 1; i <= 6; i++) {
    const name = `pin-${i}`
    pinned.push(name)
    seedDoc(name, { description: `钉住${i}` })
  }
  for (let i = 1; i <= 3; i++) {
    seedDoc(`scored-${i}`, { title: "退款政策", description: `退款政策说明${i}` })
  }
  const se = new SkillEngine()
  se.refresh()
  const tm = new ThreadManager()
  const th = makeThread(tm, "pinned-cap", { active_knowledge_ids: pinned })

  const ids = se.resolveKnowledgeIdsForThread(th.id, "auto", undefined, "退款怎么处理")
  assert.deepEqual(ids.slice(0, 6), pinned, "all 6 pinned first, in active order (top-k = 5 < 6)")
  assert.ok(ids.length > KNOWLEDGE_DOC_TOPK_AUTO, "pinned overflow + scored picks both present")
  assert.ok(ids.length <= pinned.length + KNOWLEDGE_DOC_TOPK_AUTO)
})

// --- 打分全低于阈值 → 只返回 pinned ---

test("all scores below threshold → pinned only", () => {
  resetKnowledgeDirs()
  seedDoc("only-pinned", { description: "钉住说明" })
  seedDoc("unrelated-1", { title: "烹饪指南", description: "烹饪指南说明" })
  seedDoc("unrelated-2", { title: "健身计划", description: "健身计划说明" })
  const se = new SkillEngine()
  se.refresh()
  const tm = new ThreadManager()
  const th = makeThread(tm, "zero-score", { active_knowledge_ids: ["only-pinned"] })

  const ids = se.resolveKnowledgeIdsForThread(th.id, "auto", undefined, "zxqwv 完全无关的查询")
  assert.deepEqual(ids, ["only-pinned"])
})

// --- legacy 分支（未传 knowledgeIds）也过同一预算漏斗 ---

test("legacy branch (no knowledgeIds) goes through the same budget funnel", () => {
  resetKnowledgeDirs()
  for (let i = 1; i <= 6; i++) {
    seedDoc(`legacy-g${i}`, { description: `全局${i}`, body: "g".repeat(2500) })
  }
  const se = new SkillEngine()
  se.refresh()
  const { retrieved_sources } = se.buildSystemPromptWithSources("legacy-thread", undefined, [])
  const total = retrieved_sources.reduce((s, r) => s + r.chars, 0)
  assert.ok(retrieved_sources.length >= 4, "global knowledge injected")
  assert.ok(total <= KNOWLEDGE_INJECT_BUDGET_CHARS, `legacy branch budget-capped: ${total}`)
})

// --- thread 级开关校验 ---

test("thread-manager: knowledge_smart_match must be boolean; roundtrips and persists", () => {
  const tm = new ThreadManager()
  const th = makeThread(tm, "smart-match-flag")
  assert.equal(tm.get(th.id)?.knowledge_smart_match, undefined, "unset = default on")
  tm.update(th.id, { knowledge_smart_match: false })
  assert.equal(tm.get(th.id)?.knowledge_smart_match, false)
  assert.throws(() => tm.update(th.id, { knowledge_smart_match: "yes" } as any), /boolean/)
  const reloaded = new ThreadManager()
  assert.equal(reloaded.get(th.id)?.knowledge_smart_match, false, "persists across reload")
})

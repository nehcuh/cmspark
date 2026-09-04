// #296: knowledge.graph 服务端半边（spec §5 wire / §6 常数表 / §8 服务端测试清单）
// 覆盖：状态机（too_few / ok / over_cap / rebuilding）、over_cap 截取确定性 +
// 重跑分组 + truncated、边 top-5 + 对称去重 + 确定性、display round-trip 与
// 缺失容忍、surface 门（panel-only）、LLM 失败回退 + 长度钳制 + 重生成。

import test, { after, before } from "node:test"
import assert from "node:assert/strict"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-k-graph-"))
process.env.HOME = tempHome
process.env.CMSPARK_DATA_DIR = path.join(tempHome, ".cmspark-agent")
delete process.env.DEEPSEEK_API_KEY

let initDataDir: typeof import("../src/config").initDataDir
let DATA_DIR: string
let saveConfig: (c: Record<string, unknown>) => unknown
let SkillEngine: typeof import("../src/skills/skill-engine").SkillEngine
let kg: typeof import("../src/skills/knowledge-graph")
let clusters: typeof import("../src/skills/knowledge-clusters")
let handleMessage: typeof import("../src/message-router").handleMessage
let __testSetKnowledgeGraphLabelImpl: typeof import("../src/message-router").__testSetKnowledgeGraphLabelImpl
let validateWsMessage: typeof import("../src/ws/validate").validateWsMessage

before(async () => {
  const configMod = await import("../src/config")
  initDataDir = configMod.initDataDir
  DATA_DIR = configMod.DATA_DIR
  saveConfig = configMod.saveConfig as never
  SkillEngine = (await import("../src/skills/skill-engine")).SkillEngine
  kg = await import("../src/skills/knowledge-graph")
  clusters = await import("../src/skills/knowledge-clusters")
  const mr = await import("../src/message-router")
  handleMessage = mr.handleMessage
  __testSetKnowledgeGraphLabelImpl = mr.__testSetKnowledgeGraphLabelImpl
  validateWsMessage = (await import("../src/ws/validate")).validateWsMessage
  await initDataDir()
  // 过 knowledgeExtractLlmConfig 闸（impl 已被测试钩子替换，不走网络）
  saveConfig({ llm: { api_key: "sk-test-graph", base_url: "http://127.0.0.1:9/v1", model_name: "test-model" } })
})

after(() => {
  __testSetKnowledgeGraphLabelImpl()
  fs.rmSync(tempHome, { recursive: true, force: true })
})

type IndexDoc = import("../src/skills/knowledge-clusters").KnowledgeIndexDoc

function mkDoc(id: string, vec: Record<string, number>, tags: string[] = [], title = id): IndexDoc {
  return { id, name: id, title, tags, folder: "", bucket: "", vec }
}

function orthoDocs(prefix: string, n: number, titlePrefix = prefix): IndexDoc[] {
  const out: IndexDoc[] = []
  for (let i = 0; i < n; i++) {
    out.push(mkDoc(`${prefix}${String(i).padStart(3, "0")}`, { [`tok${prefix}${i}`]: 1 }, [], `${titlePrefix}${String(i).padStart(3, "0")}`))
  }
  return out
}

const panelSession = { surface: "panel", sendToExtension: () => {} } as never

function mdDoc(name: string, tags: string[], body: string, description = ""): string {
  return `---\nname: ${name}\ndescription: ${description}\ntags: [${tags.join(", ")}]\ntype: domain_knowledge\n---\n${body}\n`
}

/** 25 篇、5 个主题组（每组 5 篇共享 tag + 正文词）→ 聚类成 5 组。 */
function seedThemed(se: InstanceType<typeof SkillEngine>, n = 25, secretBody = false): void {
  const themes = ["alpha", "beta", "gamma", "delta", "epsilon"]
  for (let i = 0; i < n; i++) {
    const theme = themes[i % themes.length]
    const secret = secretBody && i === 0 ? " SECRETBODYTOKEN9999 " : " "
    se.importKnowledge(
      mdDoc(`doc-${String(i).padStart(3, "0")}`, [theme, `t${i}`], `${theme} shared body words ${theme} again and unique${i}${secret}more text`),
    )
  }
}

async function settle(ms = 10): Promise<void> {
  await new Promise((r) => setTimeout(r, ms))
}

/** 测试间共享 tempHome：每测前清知识目录 + 派生索引，引擎各自从零起步。 */
function resetKnowledgeState(): void {
  fs.rmSync(path.join(DATA_DIR, "knowledge"), { recursive: true, force: true })
  fs.rmSync(clusters.knowledgeIndexPath(), { force: true })
}

// --- 纯函数：状态机 + 着色来源 ---

test("#296 pure: n<20 → too_few, no nodes/edges/labels", () => {
  const r = kg.buildKnowledgeGraph(orthoDocs("d", 19))
  assert.equal(r.status, "too_few")
  assert.equal(r.truncated, false)
  assert.equal(r.nodes.length, 0)
  assert.equal(r.edges.length, 0)
  assert.equal(Object.keys(r.labels).length, 0)
})

test("#296 pure: n≤200 group_key = 分布视图同一 key（同源聚类）", () => {
  const groupA = [1, 2, 3, 4].map((i) => mkDoc(`a${i}`, { alpha: 0.8, [`pa${i}`]: 0.2 }, ["sharedalpha"], `Alpha note ${i}`))
  const groupB = [1, 2, 3, 4].map((i) => mkDoc(`b${i}`, { gamma: 0.8, [`pb${i}`]: 0.2 }, ["sharedgamma"], `Gamma note ${i}`))
  const rest = orthoDocs("q", 14)
  const docs = [...groupA, ...groupB, ...rest]
  assert.equal(docs.length, 22)

  const r = kg.buildKnowledgeGraph(docs)
  assert.equal(r.status, "ok")
  assert.equal(r.truncated, false)
  assert.equal(r.nodes.length, 22)

  const dist = clusters.toDistributionChannel(clusters.buildKnowledgeDistribution(docs))
  if (!dist.groups.length) throw new Error("expected distribution groups")
  const distKeys = new Set(dist.groups.map((g) => g.key))
  const distKeyOf = new Map<string, string>()
  for (const g of dist.groups) for (const id of g.ids) distKeyOf.set(id, g.key)

  for (const node of r.nodes) {
    assert.ok(distKeys.has(node.group_key), `node ${node.id} group_key ${node.group_key} must be a distribution key`)
    const dk = distKeyOf.get(node.id)
    if (dk) assert.equal(node.group_key, dk, `node ${node.id} must sit in the same group as the distribution view`)
  }
  // a1 与 a2 同组
  const byId = new Map(r.nodes.map((n) => [n.id, n]))
  if (!byId.get("a1") || !byId.get("a2")) throw new Error("missing a1/a2")
  assert.equal(byId.get("a1")!.group_key, byId.get("a2")!.group_key)
  assert.notEqual(byId.get("a1")!.group_key, byId.get("b1")!.group_key)
  // 离群 → u:ungrouped
  assert.equal(byId.get("q000")!.group_key, "u:ungrouped")
  assert.equal(r.labels["u:ungrouped"].name, "未分组")
})

test("#296 pure: n≤200 ungrouped nodes get u:ungrouped + 未分组 label", () => {
  const groupA = [1, 2, 3].map((i) => mkDoc(`a${i}`, { alpha: 0.9, [`pa${i}`]: 0.1 }, ["sharedalpha"]))
  const rest = orthoDocs("q", 18)
  const r = kg.buildKnowledgeGraph([...groupA, ...rest])
  const ungrouped = r.nodes.filter((n) => n.group_key === "u:ungrouped")
  assert.equal(ungrouped.length, 18)
  assert.equal(r.labels["u:ungrouped"].name, "未分组")
  assert.equal(r.labels["u:ungrouped"].ai, false)
})

// --- 纯函数：边 ---

test("#296 pure: edges top-5 cap, score>0, symmetric dedup a<b, determinism", () => {
  // 星型：hub 与 8 个卫星共享 tag star；卫星彼此只有弱 jaccard
  const hub = mkDoc("hub1", { star: 1, hub: 1 }, ["star"], "Hub doc")
  const sats = Array.from({ length: 8 }, (_, i) =>
    mkDoc(`s${i}`, { star: 1, [`sat${i}`]: 1 }, ["star"], `Sat ${i}`),
  )
  const filler = orthoDocs("f", 11)
  const docs = [hub, ...sats, ...filler]
  assert.equal(docs.length, 20)

  const r1 = kg.buildKnowledgeGraph(docs)
  const r2 = kg.buildKnowledgeGraph([...docs].reverse())

  assert.equal(JSON.stringify(r2), JSON.stringify(r1), "same input (shuffled) → identical output")

  assert.equal(r1.status, "ok")
  assert.ok(r1.edges.length > 0, "star edges must exist")

  // hub 度 ≤ TOPK（8 个 >0 候选被截到 5）
  const hubDegree = r1.edges.filter((e) => e.a === "hub1" || e.b === "hub1").length
  assert.ok(hubDegree <= kg.KNOWLEDGE_GRAPH_EDGE_TOPK, `hub degree ${hubDegree} ≤ ${kg.KNOWLEDGE_GRAPH_EDGE_TOPK}`)

  const seen = new Set<string>()
  for (const e of r1.edges) {
    assert.ok(e.a < e.b, `edge must be normalized a<b: ${e.a} ${e.b}`)
    const k = `${e.a}|${e.b}`
    assert.ok(!seen.has(k), `duplicate undirected edge ${k}`)
    seen.add(k)
    assert.ok(e.score > 0, "edge score must be > 0")
  }
  // 排序确定性
  for (let i = 1; i < r1.edges.length; i++) {
    const p = r1.edges[i - 1]
    const c = r1.edges[i]
    assert.ok(p.a < c.a || (p.a === c.a && p.b < c.b), "edges sorted by (a,b)")
  }
})

// --- 纯函数：over_cap ---

test("#296 pure: n>200 → over_cap, title-lex first 200, recluster on truncated set, truncated:true, determinism", () => {
  const keepers = orthoDocs("k", 200, "k") // titles k000..k199
  // 组成员：k000,k001,k002 在截取集内；z901,z902 在集外（标题字典序更大）
  keepers[0] = mkDoc("k000", { grp: 0.9, u0: 0.1 }, ["grp"], "k000")
  keepers[1] = mkDoc("k001", { grp: 0.9, u1: 0.1 }, ["grp"], "k001")
  keepers[2] = mkDoc("k002", { grp: 0.9, u2: 0.1 }, ["grp"], "k002")
  const outsiders = [
    mkDoc("z901", { grp: 0.9, u3: 0.1 }, ["grp"], "z901"),
    mkDoc("z902", { grp: 0.9, u4: 0.1 }, ["grp"], "z902"),
    ...orthoDocs("z", 3, "z"),
  ]
  const docs = [...keepers, ...outsiders]
  assert.equal(docs.length, 205)

  const r1 = kg.buildKnowledgeGraph(docs)
  const r2 = kg.buildKnowledgeGraph([...docs].reverse())
  assert.equal(JSON.stringify(r2), JSON.stringify(r1), "over_cap truncation must be deterministic")

  assert.equal(r1.status, "over_cap")
  assert.equal(r1.truncated, true)
  assert.equal(r1.nodes.length, 200)
  const ids = new Set(r1.nodes.map((n) => n.id))
  assert.ok(ids.has("k000") && ids.has("k199"), "keepers in")
  assert.ok(!ids.has("z901") && !ids.has("z904"), "title-lex outsiders out")

  // 截取集重跑聚类：k000-k002 成组（成员恰为集内 3 篇，集外 2 篇不掺入）
  const gkey = r1.nodes.find((n) => n.id === "k000")
  if (!gkey) throw new Error("missing k000")
  assert.ok(gkey.group_key.startsWith("c:"), `in-set group expected, got ${gkey.group_key}`)
  const same = r1.nodes.filter((n) => n.group_key === gkey.group_key).map((n) => n.id).sort()
  assert.deepEqual(same, ["k000", "k001", "k002"])
  assert.ok(r1.labels[gkey.group_key], "in-set group has a fallback label")
  assert.equal(r1.labels[gkey.group_key].ai, false)
})

test("#296 pure: constants per spec §6", () => {
  assert.equal(kg.KNOWLEDGE_GRAPH_EDGE_TOPK, 5)
  assert.equal(kg.KNOWLEDGE_GRAPH_DOC_CAP, clusters.KNOWLEDGE_CLUSTER_DOC_CAP)
  assert.equal(kg.KNOWLEDGE_GRAPH_MIN_DOCS, clusters.KNOWLEDGE_CLUSTER_MIN_DOCS)
  assert.equal(kg.KNOWLEDGE_GRAPH_LABEL_NAME_MAX, 20)
  assert.equal(kg.KNOWLEDGE_GRAPH_LABEL_SUMMARY_MAX, 280)
})

// --- 解析 / 钳制 ---

test("#296 parseGraphLabels: strict-ish JSON with surrounding noise; malformed → null", () => {
  const ok = kg.parseGraphLabels('前置说明 {"c:k1": {"name": "退款组", "summary": "s"}, "c:k2": {"name": "n2"}} 后置')
  if (!ok) throw new Error("expected parse")
  assert.equal(ok["c:k1"].name, "退款组")
  assert.equal(ok["c:k2"].summary, undefined)
  assert.equal(kg.parseGraphLabels("not json at all"), null)
  assert.equal(kg.parseGraphLabels('{"c:k1": "not-an-object"}'), null)
})

test("#296 clamp: name ≤20 / summary ≤280 on LLM output", async () => {
  resetKnowledgeState()
  const se = new SkillEngine()
  seedThemed(se, 25)
  let captured: string[][] = []
  __testSetKnowledgeGraphLabelImpl(async ({ lines }) => {
    captured.push(lines)
    const out: Record<string, { name: string; summary?: string }> = {}
    for (const l of lines) {
      const m = /^GROUP (\S+)/.exec(l)
      if (m) out[m[1]] = { name: "名".repeat(50), summary: "摘".repeat(500) }
    }
    return out
  })
  const first = await handleMessage(
    { type: "knowledge.graph", llm_labels: true },
    { skillEngine: se } as never,
    panelSession,
  )
  assert.equal(first.type, "knowledge.graph")
  assert.equal(first.status, "ok")
  // 非阻塞：第一响应全是回退标签
  for (const l of Object.values(first.labels) as Array<{ ai: boolean }>) assert.equal(l.ai, false)
  assert.ok(captured.length > 0, "label impl must have been called")

  await settle()
  const second = await handleMessage(
    { type: "knowledge.graph", llm_labels: true },
    { skillEngine: se } as never,
    panelSession,
  )
  const aiLabels = Object.entries(second.labels as Record<string, { name: string; summary?: string; ai: boolean }>).filter(([, v]) => v.ai)
  assert.ok(aiLabels.length > 0, "second request must see AI labels")
  for (const [, v] of aiLabels) {
    assert.ok(v.name.length <= 20, `name clamped: ${v.name.length}`)
    assert.ok((v.summary || "").length <= 280, `summary clamped: ${(v.summary || "").length}`)
  }
})

// --- handler：surface 门 / 状态机 / 回退 ---

test("#296 surface gate: non-panel sessions rejected, panel served", async () => {
  resetKnowledgeState()
  const se = new SkillEngine()
  seedThemed(se, 25)

  const summoner = await handleMessage({ type: "knowledge.graph" }, { skillEngine: se } as never, { surface: "summoner", sendToExtension: () => {} } as never)
  assert.equal(summoner.type, "error")
  assert.match(String(summoner.error), /panel/)

  const tray = await handleMessage({ type: "knowledge.graph" }, { skillEngine: se } as never, { surface: "tray", sendToExtension: () => {} } as never)
  assert.equal(tray.type, "error")

  const missing = await handleMessage({ type: "knowledge.graph" }, { skillEngine: se } as never, undefined)
  assert.equal(missing.type, "error")

  const panel = await handleMessage({ type: "knowledge.graph" }, { skillEngine: se } as never, panelSession)
  assert.equal(panel.type, "knowledge.graph")
  assert.equal(panel.status, "ok")
  assert.equal(panel.nodes.length, 25)
  assert.equal(panel.truncated, false)
  assert.ok(Array.isArray(panel.edges) && panel.edges.length > 0)
})

test("#296 handler: engine too_few (<20 docs)", async () => {
  resetKnowledgeState()
  const se = new SkillEngine()
  seedThemed(se, 7)
  const resp = await handleMessage({ type: "knowledge.graph" }, { skillEngine: se } as never, panelSession)
  assert.equal(resp.type, "knowledge.graph")
  assert.equal(resp.status, "too_few")
  assert.equal(resp.nodes.length, 0)
})

test("#296 handler: index unavailable → rebuilding (honest, no fake graph)", async () => {
  resetKnowledgeState()
  const se = new SkillEngine()
  seedThemed(se, 25)
  // 破坏 cache 路径：把 cache 变成普通文件 → 重建写盘失败 → 索引不可用
  const cachePath = path.join(DATA_DIR, "cache")
  fs.rmSync(cachePath, { recursive: true, force: true })
  fs.writeFileSync(cachePath, "not a dir")
  se.importKnowledge(mdDoc("extra-doc", ["alpha"], "alpha shared body words")) // 指纹漂移触发重建

  const resp = await handleMessage({ type: "knowledge.graph" }, { skillEngine: se } as never, panelSession)
  assert.equal(resp.type, "knowledge.graph")
  assert.equal(resp.status, "rebuilding")
  assert.equal(resp.nodes.length, 0)

  // 恢复路径后续测试可用
  fs.rmSync(cachePath, { recursive: true, force: true })
  fs.mkdirSync(cachePath, { recursive: true })
})

test("#296 LLM failure → fallback labels, no display write, no error frame", async () => {
  resetKnowledgeState()
  const se = new SkillEngine()
  seedThemed(se, 25)
  __testSetKnowledgeGraphLabelImpl(async () => {
    throw new Error("llm down")
  })
  const resp = await handleMessage({ type: "knowledge.graph", llm_labels: true }, { skillEngine: se } as never, panelSession)
  assert.equal(resp.type, "knowledge.graph")
  assert.equal(resp.status, "ok")
  const labels = resp.labels as Record<string, { name: string; ai: boolean }>
  assert.ok(Object.keys(labels).length > 0)
  for (const v of Object.values(labels)) {
    assert.equal(v.ai, false)
    assert.ok(v.name.length > 0)
  }
  await settle()
  const second = await handleMessage({ type: "knowledge.graph", llm_labels: true }, { skillEngine: se } as never, panelSession)
  for (const v of Object.values(second.labels as Record<string, { ai: boolean }>)) assert.equal(v.ai, false)
})

test("#296 LLM prompt privacy: member titles/tags only, never doc bodies (#274 precedent)", async () => {
  resetKnowledgeState()
  const se = new SkillEngine()
  seedThemed(se, 25, true) // doc-000 body carries SECRETBODYTOKEN9999
  let userLines: string[] = []
  __testSetKnowledgeGraphLabelImpl(async ({ lines }) => {
    userLines = lines
    return {}
  })
  await handleMessage({ type: "knowledge.graph", llm_labels: true }, { skillEngine: se } as never, panelSession)
  await settle()
  assert.ok(userLines.length > 0)
  const joined = userLines.join("\n")
  assert.equal(joined.includes("SECRETBODYTOKEN9999"), false, "doc bodies must not leak into the label prompt")
  assert.ok(joined.includes("doc-"), "titles expected in prompt lines")
})

test("#296 regen_labels: forces regeneration over cache", async () => {
  resetKnowledgeState()
  const se = new SkillEngine()
  seedThemed(se, 25)
  let version = 0
  __testSetKnowledgeGraphLabelImpl(async ({ lines }) => {
    version += 1
    const out: Record<string, { name: string }> = {}
    for (const l of lines) {
      const m = /^GROUP (\S+)/.exec(l)
      if (m) out[m[1]] = { name: `AI 名 v${version}` }
    }
    return out
  })
  await handleMessage({ type: "knowledge.graph", llm_labels: true }, { skillEngine: se } as never, panelSession)
  await settle()
  const second = await handleMessage({ type: "knowledge.graph", llm_labels: true }, { skillEngine: se } as never, panelSession)
  const aiSecond = Object.values(second.labels as Record<string, { name: string; ai: boolean }>).filter((v) => v.ai)
  assert.ok(aiSecond.length > 0)
  for (const v of aiSecond) assert.equal(v.name, "AI 名 v1")

  await handleMessage({ type: "knowledge.graph", regen_labels: true }, { skillEngine: se } as never, panelSession)
  await settle()
  const third = await handleMessage({ type: "knowledge.graph", llm_labels: true }, { skillEngine: se } as never, panelSession)
  const aiThird = Object.values(third.labels as Record<string, { name: string; ai: boolean }>).filter((v) => v.ai)
  assert.ok(aiThird.length > 0)
  for (const v of aiThird) assert.equal(v.name, "AI 名 v2")
})

test("#296 no llm_labels → no LLM call at all (default off)", async () => {
  resetKnowledgeState()
  const se = new SkillEngine()
  seedThemed(se, 25)
  let called = 0
  __testSetKnowledgeGraphLabelImpl(async () => {
    called += 1
    return {}
  })
  const resp = await handleMessage({ type: "knowledge.graph" }, { skillEngine: se } as never, panelSession)
  assert.equal(resp.status, "ok")
  await settle()
  assert.equal(called, 0)
})

// --- display round-trip / 容忍 ---

test("#296 display round-trip via engine + file (0o600)", async () => {
  resetKnowledgeState()
  const se = new SkillEngine()
  seedThemed(se, 25)
  __testSetKnowledgeGraphLabelImpl(async ({ lines }) => {
    const out: Record<string, { name: string; summary?: string }> = {}
    for (const l of lines) {
      const m = /^GROUP (\S+)/.exec(l)
      if (m) out[m[1]] = { name: "AI 名", summary: "AI 摘要" }
    }
    return out
  })
  await handleMessage({ type: "knowledge.graph", llm_labels: true }, { skillEngine: se } as never, panelSession)
  await settle()

  const p = clusters.knowledgeIndexPath()
  const idx = clusters.readKnowledgeIndexFile(p)
  if (!idx) throw new Error("index file missing")
  const display = (idx as { display?: Record<string, { name: string; summary?: string }> }).display
  if (!display) throw new Error("display missing on disk")
  const keys = Object.keys(display)
  assert.ok(keys.length > 0)
  assert.ok(keys.every((k) => k.startsWith("c:")))
  for (const v of Object.values(display)) {
    assert.equal(v.name, "AI 名")
    assert.equal(v.summary, "AI 摘要")
  }
  const st = fs.statSync(p)
  assert.equal(st.mode & 0o777, 0o600)
})

test("#296 readKnowledgeIndexFile tolerates missing / malformed display", () => {
  const p = path.join(DATA_DIR, "cache", "kg-tolerance-test.json")
  const base: import("../src/skills/knowledge-clusters").KnowledgeIndexFile = { version: 1, built_at: new Date().toISOString(), fingerprint: "fp", docs: [{ id: "a", name: "a", title: "a", tags: [], folder: "", bucket: "global", vec: { x: 1 } }] }
  clusters.writeKnowledgeIndexFile(p, base)
  const noDisplay = clusters.readKnowledgeIndexFile(p)
  if (!noDisplay) throw new Error("missing display must be tolerated")
  assert.equal((noDisplay as { display?: unknown }).display, undefined)

  fs.writeFileSync(p, JSON.stringify({ ...base, display: "not-an-object" }))
  const badDisplay = clusters.readKnowledgeIndexFile(p)
  if (!badDisplay) throw new Error("malformed display must not kill the file")
  assert.equal((badDisplay as { display?: unknown }).display, undefined)
})

// --- validator ---

test("#296 validator: knowledge.graph accepts optional booleans, rejects non-boolean", () => {
  assert.equal(validateWsMessage({ type: "knowledge.graph" }).valid, true)
  assert.equal(validateWsMessage({ type: "knowledge.graph", llm_labels: true }).valid, true)
  assert.equal(validateWsMessage({ type: "knowledge.graph", regen_labels: true }).valid, true)
  assert.equal(validateWsMessage({ type: "knowledge.graph", llm_labels: "yes" }).valid, false)
  assert.equal(validateWsMessage({ type: "knowledge.graph", regen_labels: 1 }).valid, false)
})

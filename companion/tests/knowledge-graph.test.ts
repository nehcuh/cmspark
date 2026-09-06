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

test("#427 pure: n=0 → too_few；n=1 → 单节点 ok；2–19 → LLM lane ok 全未分组", () => {
  const zero = kg.buildKnowledgeGraph([])
  assert.equal(zero.status, "too_few")
  assert.equal(zero.truncated, false)
  assert.equal(zero.nodes.length, 0)
  assert.equal(zero.relations.length, 0)
  assert.equal(zero.llmLane, false)

  const single = kg.buildKnowledgeGraph([mkDoc("solo", { x: 1 })])
  assert.equal(single.status, "ok")
  assert.equal(single.nodes.length, 1)
  assert.equal(single.nodes[0].group_key, "u:ungrouped")
  assert.equal(single.labels["u:ungrouped"].name, "未分组")
  assert.equal(single.edges.length, 0)

  // 2–19 无缓存：散点是诚实结构（LLM lane，全部未分组，TF 边照算）
  const docs = orthoDocs("d", 19)
  const r = kg.buildKnowledgeGraph(docs)
  assert.equal(r.status, "ok")
  assert.equal(r.truncated, false)
  assert.equal(r.llmLane, true)
  assert.equal(r.nodes.length, 19)
  assert.ok(r.nodes.every((n) => n.group_key === "u:ungrouped"), "no cache → all ungrouped")
  assert.equal(Object.keys(r.labels).length, 1)
  assert.equal(r.labels["u:ungrouped"].name, "未分组")
  assert.equal(r.labels["u:ungrouped"].ai, false)
  assert.deepEqual(r.relations, [])
  assert.equal(r.labelTargets.length, 0, "LLM lane has no label targets (label 通道只服务 TF lane)")
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

test("#296/#427 pure: constants per spec §6 / #427 §8", () => {
  assert.equal(kg.KNOWLEDGE_GRAPH_EDGE_TOPK, 5)
  assert.equal(kg.KNOWLEDGE_GRAPH_DOC_CAP, clusters.KNOWLEDGE_CLUSTER_DOC_CAP)
  assert.equal(kg.KNOWLEDGE_GRAPH_MIN_DOCS, 1)
  assert.equal(kg.KNOWLEDGE_GRAPH_LLM_LANE_MAX, clusters.KNOWLEDGE_CLUSTER_MIN_DOCS - 1)
  assert.equal(kg.KNOWLEDGE_GRAPH_LLM_LANE_MAX, 19)
  assert.equal(kg.KNOWLEDGE_GRAPH_RELATIONS_CAP, 12)
  assert.equal(kg.KNOWLEDGE_GRAPH_RELATIONS_PER_NODE, 3)
  assert.equal(kg.KNOWLEDGE_GRAPH_RELATION_REASON_MAX, 80)
  assert.equal(kg.KNOWLEDGE_GRAPH_ORGANIZE_TIMEOUT_MS, 30_000)
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

test("#427 handler: 2–19 无缓存 → ok + 全未分组 + llm_ready + relations 空数组", async () => {
  resetKnowledgeState()
  const se = new SkillEngine()
  seedThemed(se, 7)
  const resp = await handleMessage({ type: "knowledge.graph" }, { skillEngine: se } as never, panelSession)
  assert.equal(resp.type, "knowledge.graph")
  assert.equal(resp.status, "ok")
  assert.equal(resp.nodes.length, 7)
  const labels = resp.labels as Record<string, { name: string; ai: boolean }>
  assert.deepEqual(Object.keys(labels), ["u:ungrouped"])
  assert.equal(resp.llm_ready, true)
  assert.deepEqual(resp.relations, [])
  assert.equal(resp.stale, undefined)
  assert.equal(resp.tf_switch_notice, undefined, "LLM lane 帧不带跨 20 notice")
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

test("#296/#427 validator: knowledge.graph optional fields strict shapes", () => {
  assert.equal(validateWsMessage({ type: "knowledge.graph" }).valid, true)
  assert.equal(validateWsMessage({ type: "knowledge.graph", llm_labels: true }).valid, true)
  assert.equal(validateWsMessage({ type: "knowledge.graph", regen_labels: true }).valid, true)
  assert.equal(validateWsMessage({ type: "knowledge.graph", llm_labels: "yes" }).valid, false)
  assert.equal(validateWsMessage({ type: "knowledge.graph", regen_labels: 1 }).valid, false)
  // #427（ext wire 合同）：organize/user_gesture 可选布尔；lock/unlock 字符串；ack 仅 true
  assert.equal(validateWsMessage({ type: "knowledge.graph", organize: true, user_gesture: true }).valid, true)
  assert.equal(validateWsMessage({ type: "knowledge.graph", organize: "yes" }).valid, false)
  assert.equal(validateWsMessage({ type: "knowledge.graph", user_gesture: 1 }).valid, false)
  assert.equal(validateWsMessage({ type: "knowledge.graph", lock_group: "l:abc", user_gesture: true }).valid, true)
  assert.equal(validateWsMessage({ type: "knowledge.graph", lock_group: 7 }).valid, false)
  assert.equal(validateWsMessage({ type: "knowledge.graph", unlock_group: "l:abc", user_gesture: true }).valid, true)
  assert.equal(validateWsMessage({ type: "knowledge.graph", unlock_group: [] }).valid, false)
  assert.equal(validateWsMessage({ type: "knowledge.graph", ack_tf_switch: true, user_gesture: true }).valid, true)
  assert.equal(validateWsMessage({ type: "knowledge.graph", ack_tf_switch: false }).valid, false)
})

// --- round-2 收敛：AC-4 开关门 + 完成推送 ---

test("#296 llm_labels off → cached AI labels never reach the wire (AC-4 gate)", async () => {
  resetKnowledgeState()
  const se = new SkillEngine()
  seedThemed(se, 25)
  __testSetKnowledgeGraphLabelImpl(async ({ lines }) => {
    const out: Record<string, { name: string }> = {}
    for (const l of lines) {
      const m = /^GROUP (\S+)/.exec(l)
      if (m) out[m[1]] = { name: "AI 缓存名" }
    }
    return out
  })
  // 开关开：生成并缓存 AI 标签
  await handleMessage({ type: "knowledge.graph", llm_labels: true }, { skillEngine: se } as never, panelSession)
  await settle()
  const on = await handleMessage({ type: "knowledge.graph", llm_labels: true }, { skillEngine: se } as never, panelSession)
  const aiOn = Object.values(on.labels as Record<string, { ai: boolean }>).filter((v) => v.ai)
  assert.ok(aiOn.length > 0, "sanity: AI labels visible while the toggle is on")

  // 开关关：display 缓存存在，但 wire 必须全部是高频词回退
  const off = await handleMessage({ type: "knowledge.graph" }, { skillEngine: se } as never, panelSession)
  const offLabels = off.labels as Record<string, { name: string; ai: boolean }>
  assert.ok(Object.keys(offLabels).length > 0)
  for (const v of Object.values(offLabels)) {
    assert.equal(v.ai, false, "toggle off must never serve cached AI labels")
    assert.notEqual(v.name, "AI 缓存名")
  }
})

test("#296 labels completion pushes an updated knowledge.graph frame to the panel", async () => {
  resetKnowledgeState()
  const se = new SkillEngine()
  seedThemed(se, 25)
  __testSetKnowledgeGraphLabelImpl(async ({ lines }) => {
    const out: Record<string, { name: string; summary?: string }> = {}
    for (const l of lines) {
      const m = /^GROUP (\S+)/.exec(l)
      if (m) out[m[1]] = { name: "AI 推送名", summary: "推送摘要" }
    }
    return out
  })
  const sent: any[] = []
  const sess = { surface: "panel", sendToExtension: (d: any) => sent.push(d) } as never
  const resp = await handleMessage({ type: "knowledge.graph", llm_labels: true }, { skillEngine: se } as never, sess)
  assert.equal(resp.status, "ok")
  // 首次响应是回退标签（非阻塞）；异步标注完成后必须推一帧 AI 版
  await settle()
  const pushes = sent.filter((m) => m.type === "knowledge.graph")
  assert.ok(pushes.length > 0, "completion push expected — otherwise the toggle-on session never sees AI labels")
  const lastPush = pushes[pushes.length - 1]
  const aiPushed = Object.values(lastPush.labels as Record<string, { name: string; ai: boolean; summary?: string }>).filter((v) => v.ai)
  assert.ok(aiPushed.length > 0, "pushed frame carries AI labels")
  for (const v of aiPushed) {
    assert.equal(v.name, "AI 推送名")
    assert.equal(v.summary, "推送摘要")
  }
})

// --- #427：l: 键 / 指纹 / 锁 overlay / organize 解析与归一化 / 剪枝 ---

test("#427 lGroupKey: 服务端派生、成员集决定键、顺序无关", () => {
  const k1 = kg.lGroupKey(["b", "a", "c"])
  assert.equal(k1, kg.lGroupKey(["c", "b", "a"]))
  assert.match(k1, /^l:[0-9a-f]{12}$/)
  assert.notEqual(k1, kg.lGroupKey(["a", "b"]))
})

test("#427 fingerprint: id/title/description/tags 任一变动都漂移；顺序无关", () => {
  const base = [
    { ...mkDoc("a", { x: 1 }, ["t1"], "A"), description: "描述A" },
    { ...mkDoc("b", { y: 1 }, ["t2"], "B"), description: "描述B" },
  ]
  const fp = kg.computeGraphLlmFingerprint(base)
  assert.equal(fp, kg.computeGraphLlmFingerprint([...base].reverse()))
  assert.notEqual(fp, kg.computeGraphLlmFingerprint([
    { ...base[0], description: "描述A2" }, base[1],
  ]), "description 变动必须漂移（prompt 输入同源）")
  assert.notEqual(fp, kg.computeGraphLlmFingerprint([
    { ...base[0], tags: ["t1", "extra"] }, base[1],
  ]), "tags 变动必须漂移（AC-2）")
  assert.notEqual(fp, kg.computeGraphLlmFingerprint([
    { ...base[0], title: "A!" }, base[1],
  ]), "title 变动必须漂移")
})

test("#427 锁 overlay：改写 group_key + 注入 ai:true/locked:true labels；未分组 label 重算", () => {
  const groupA = [1, 2, 3].map((i) => mkDoc(`a${i}`, { alpha: 0.9 }, ["sharedalpha"], `A${i}`))
  const docs = [...groupA, ...orthoDocs("q", 15)] // 18 篇 → LLM lane
  const lock = { groups: [{ ids: ["a1", "a2", "a3", "q000"], name: "用户锁组", summary: "用户认可" }] }
  const r = kg.buildKnowledgeGraph(docs, undefined, { lock })
  const key = kg.lGroupKey(["a1", "a2", "a3", "q000"])
  for (const id of ["a1", "a2", "a3", "q000"]) {
    assert.equal(r.nodes.find((n) => n.id === id)!.group_key, key)
  }
  assert.equal(r.labels[key].name, "用户锁组")
  assert.equal(r.labels[key].summary, "用户认可")
  assert.equal(r.labels[key].ai, true)
  assert.equal(r.labels[key].locked, true, "ext wire 合同：labels[].locked")
  assert.ok(r.labels["u:ungrouped"], "剩余散点仍带未分组 label")
  assert.deepEqual(r.relations, [], "无 graph_llm 缓存 → relations 恒空")
})

test("#427 锁跨活：≥20 帧锁 overlay 照常生效且 relations 永不上帧", () => {
  const groupA = [1, 2, 3, 4].map((i) => mkDoc(`a${i}`, { alpha: 0.8, [`pa${i}`]: 0.2 }, ["sharedalpha"], `A${i}`))
  const rest = orthoDocs("q", 16)
  const docs = [...groupA, ...rest] // 20 篇 → TF lane
  const lock = { groups: [{ ids: ["a1", "a2", "a3"], name: "锁" }] }
  const r = kg.buildKnowledgeGraph(docs, undefined, { lock })
  assert.equal(r.llmLane, false)
  assert.equal(r.status, "ok")
  assert.deepEqual(r.relations, [])
  assert.equal(r.relations.length, 0)
  const key = kg.lGroupKey(["a1", "a2", "a3"])
  for (const id of ["a1", "a2", "a3"]) {
    assert.equal(r.nodes.find((n) => n.id === id)!.group_key, key, "锁着色以锁为准，不被 TF 聚类收编")
  }
  assert.equal(r.labels[key].locked, true)
})

test("#427 organize prompt：只有 title/tags/description，不进正文；锁禁区行", () => {
  const docs = [{ ...mkDoc("d1", { x: 1 }, ["t1"], "标题一"), description: "描述一" }]
  const prompt = kg.buildGraphOrganizePrompt(docs, { groups: [{ ids: ["d1", "d2"], name: "禁区组" }] })
  assert.ok(prompt.userContent.includes("DOC d1 | 标题一 | tags: t1 | 描述一"))
  assert.ok(prompt.userContent.includes("已锁定分组"))
  assert.ok(prompt.userContent.includes("禁区组"))
  assert.ok(!prompt.userContent.includes("正文"), "正文绝不进 prompt")
  assert.ok(prompt.systemPrompt.includes("严格 JSON"))
})

type Parsed = import("../src/skills/knowledge-graph").GraphOrganizeParsed
function grp(name: string, ids: string[], summary?: string): { name: string; ids: string[]; summary?: string } {
  return summary === undefined ? { name, ids } : { name, ids, summary }
}
function rel(a: string, b: string, reason = "同主题", confidence = 0.8) {
  return { a, b, reason, confidence }
}

test("#427 parseGraphOrganize：容忍前后噪声；形状零容忍", () => {
  const ok = kg.parseGraphOrganize(
    '前置说明 {"groups": [{"name": "g", "ids": ["a", "b"]}], "relations": [{"a": "a", "b": "b", "reason": "r", "confidence": 0.5}]} 后置',
  )
  if (!ok) throw new Error("expected parse")
  assert.equal(ok.groups.length, 1)
  assert.equal(ok.relations[0].confidence, 0.5)
  assert.equal(kg.parseGraphOrganize('{"groups": []}'), null, "relations 缺失 → null")
  assert.equal(kg.parseGraphOrganize('{"relations": []}'), null, "groups 缺失 → null")
  assert.equal(kg.parseGraphOrganize('{"groups": [{}], "relations": []}'), null, "name 缺失 → null")
  assert.equal(kg.parseGraphOrganize('{"groups": [{"name": "g", "ids": []}], "relations": []}'), null)
  assert.equal(kg.parseGraphOrganize('{"groups": [], "relations": [{"a": "a", "b": "b", "reason": "r"}]}'), null, "confidence 缺失 → null")
  assert.equal(kg.parseGraphOrganize("not json"), null)
})

test("#427 normalize：幸福路径 + 锁成员剥离 + 单成员组归一化不计分子", () => {
  const live = new Set(["a", "b", "c", "d", "e"])
  const norm = kg.normalizeGraphOrganize(
    {
      groups: [grp("G1", ["a", "b"], "摘要"), grp("G2", ["c"]), grp("G3", ["d", "e"])],
      relations: [rel("a", "b")],
    },
    live,
    new Set(["e"]),
  )
  assert.equal(norm.groupPoolFallback, false)
  assert.equal(norm.groups.length, 1, "G2 单成员归未分组；G3 剥离锁成员 e 后剩 1 → 未分组")
  assert.deepEqual(norm.groups[0].ids, ["a", "b"])
  assert.equal(norm.groups[0].name, "G1")
  assert.equal(norm.groups[0].summary, "摘要")
  assert.equal(norm.relationPoolFallback, false)
  assert.equal(norm.relations.length, 1)
  assert.deepEqual([norm.relations[0].a, norm.relations[0].b], ["a", "b"])
})

test("#427 normalize：亡 id / 重复归属后现条整条作废；恰好 50% 不触发回退", () => {
  const live = new Set(["a", "b", "c", "d"])
  const norm = kg.normalizeGraphOrganize(
    {
      groups: [grp("G1", ["a", "ghost"]), grp("G2", ["b"]), grp("G3", ["a", "c"]), grp("G4", ["c", "d"])],
      relations: [],
    },
    live,
    new Set(),
  )
  // G1 亡 id 无效；G2 单成员归一化（不计分子）；G3 有效；G4 撞 G3 的 c → 后现整条作废
  assert.equal(norm.groupPoolFallback, false, "2/4 = 50%，不 > 50% → 不回退")
  assert.equal(norm.groups.length, 1)
  assert.deepEqual(norm.groups[0].ids, ["a", "c"])
})

test("#427 normalize：组池 >50% 回退且不连坐关系池（分池独立）", () => {
  const live = new Set(["a", "b", "c"])
  const norm = kg.normalizeGraphOrganize(
    {
      groups: [grp("G1", ["a", "ghost1"]), grp("G2", ["b", "ghost2"]), grp("G3", ["a", "b"])],
      relations: [rel("a", "b")],
    },
    live,
    new Set(),
  )
  assert.equal(norm.groupPoolFallback, true)
  assert.deepEqual(norm.groups, [])
  assert.equal(norm.relationPoolFallback, false)
  assert.equal(norm.relations.length, 1, "关系池不被组池连坐")
})

test("#427 normalize relations：reason 空/非有限 confidence/亡 id/自环计分子；恰好 50% 不回退；钳制；无序对去重留高分", () => {
  const live = new Set(["a", "b", "c", "d", "e", "f"])
  const norm = kg.normalizeGraphOrganize(
    {
      groups: [],
      relations: [
        rel("a", "b"),
        rel("c", "d"),
        rel("e", "f"),
        { a: "e", b: "f", reason: "", confidence: 0.5 },
        { a: "a", b: "b", reason: "r", confidence: Number.NaN },
        { a: "ghost", b: "a", reason: "r", confidence: 0.5 },
        { a: "c", b: "c", reason: "自环", confidence: 0.5 },
        { a: "c", b: "d", reason: "重复对", confidence: 0.1 },
      ],
    },
    live,
    new Set(),
  )
  assert.equal(norm.relationPoolFallback, false, "4/8 = 50%，不 > 50% → 保留池")
  // 有效对 {a,b} {c,d} {e,f}；{c,d} 重复对被去重留 0.8 高分
  assert.equal(norm.relations.length, 3)
  assert.deepEqual(
    norm.relations.map((r) => [r.a, r.b]).sort(),
    [["a", "b"], ["c", "d"], ["e", "f"]],
  )

  const clampHi = kg.normalizeGraphOrganize({ groups: [], relations: [rel("a", "b", "r", 1.7)] }, new Set(["a", "b"]), new Set())
  assert.equal(clampHi.relations[0].confidence, 1)
  const clampLo = kg.normalizeGraphOrganize({ groups: [], relations: [rel("a", "b", "r", -0.2)] }, new Set(["a", "b"]), new Set())
  assert.equal(clampLo.relations[0].confidence, 0)

  const dedup = kg.normalizeGraphOrganize(
    { groups: [], relations: [rel("a", "b", "r1", 0.9), rel("b", "a", "r2", 0.5)] },
    new Set(["a", "b"]),
    new Set(),
  )
  assert.equal(dedup.relations.length, 1)
  assert.equal(dedup.relations[0].reason, "r1", "同无序对留高分")
  assert.equal(dedup.relations[0].a, "a", "a<b 字典序归一")
})

test("#427 normalize：两段式截断——先每端点 ≤3，再全图 ≤ min(12, 3n)", () => {
  const live = new Set(["hub", "s1", "s2", "s3", "s4", "s5", "x", "y"])
  const star = kg.normalizeGraphOrganize(
    {
      groups: [],
      relations: [rel("hub", "s1"), rel("hub", "s2"), rel("hub", "s3"), rel("hub", "s4"), rel("hub", "s5")],
    },
    live,
    new Set(),
  )
  const hubDeg = star.relations.filter((r) => r.a === "hub" || r.b === "hub").length
  assert.equal(hubDeg, 3, "第一刀：单端点度数 ≤3（同分贪心按序保留）")

  // 10 节点全连（45 对同分）：第一刀后 13 条 > 12 → 第二刀全图 cap 生效
  const ids = Array.from({ length: 10 }, (_, i) => `n${i}`)
  const all: Parsed = { groups: [], relations: [] }
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) all.relations.push(rel(ids[i], ids[j], "r", 0.5))
  }
  const capped = kg.normalizeGraphOrganize(all, new Set(ids), new Set())
  assert.equal(capped.relations.length, 12)
  const deg = new Map<string, number>()
  for (const r of capped.relations) {
    deg.set(r.a, (deg.get(r.a) || 0) + 1)
    deg.set(r.b, (deg.get(r.b) || 0) + 1)
  }
  for (const d of deg.values()) assert.ok(d <= 3)
})

test("#427 normalize：reason 按码点切 ≤80，不劈代理对", () => {
  const emoji = "😀".repeat(90) // 90 码点 / 180 UTF-16 单元
  const norm = kg.normalizeGraphOrganize(
    { groups: [], relations: [rel("a", "b", emoji, 0.5)] },
    new Set(["a", "b"]),
    new Set(),
  )
  const r = norm.relations[0].reason
  assert.equal(Array.from(r).length, 80)
  assert.equal(Buffer.from(r, "utf8").toString("utf8"), r, "无 lone surrogate（UTF-8 round-trip）")
})

test("#427 pruneGraphLlmSection：亡 id 剔除、组缩 <2 解散、指纹/stale 保留", () => {
  const section = {
    fingerprint: "fp",
    stale: false,
    groups: [
      { ids: ["a", "b", "gone"], name: "G1" },
      { ids: ["c", "gone2"], name: "G2" },
    ],
    relations: [
      { a: "a", b: "gone", reason: "r", confidence: 0.5 },
      { a: "a", b: "b", reason: "r", confidence: 0.5 },
    ],
  }
  const pruned = kg.pruneGraphLlmSection(section, new Set(["a", "b", "c"]))
  assert.deepEqual(pruned.groups.map((g) => g.ids), [["a", "b"]], "G2 缩到 1 → 解散")
  assert.equal(pruned.relations.length, 1)
  assert.equal(pruned.fingerprint, "fp")
  assert.equal(pruned.stale, false)
})

test("#427 pruneGraphLock：成员只减不增；<2 解散带组名（pi 终验 2：缩容后同一锁仍生效）", () => {
  const lock = {
    groups: [
      { ids: ["a", "b", "gone"], name: "锁组", summary: "s" },
      { ids: ["x", "gone2"], name: "将散" },
    ],
  }
  const { lock: pruned, dissolved } = kg.pruneGraphLock(lock, new Set(["a", "b", "x"]))
  assert.equal(pruned.groups.length, 1)
  assert.deepEqual(pruned.groups[0].ids, ["a", "b"])
  assert.equal(pruned.groups[0].name, "锁组", "锁的身份是条目：同一条目缩容后在")
  assert.deepEqual(dissolved, ["将散"])

  // 缩容后渲染：新 l: 键 ≠ 旧键，但同一锁条目仍把成员锁成一组
  const docs = [mkDoc("a", { x: 1 }), mkDoc("b", { y: 1 }), mkDoc("x", { z: 1 })]
  const rendered = kg.buildKnowledgeGraph(docs, undefined, { lock: pruned })
  const newKey = kg.lGroupKey(["a", "b"])
  assert.notEqual(newKey, kg.lGroupKey(["a", "b", "gone"]), "缩容后键已变")
  assert.equal(rendered.nodes.find((n) => n.id === "a")!.group_key, newKey)
  assert.equal(rendered.nodes.find((n) => n.id === "b")!.group_key, newKey)
  assert.equal(rendered.labels[newKey].locked, true)
  assert.equal(rendered.labels[newKey].name, "锁组")
})

test("#427 readKnowledgeIndexFile：旧索引 docs 无 description 容忍；graph 区形状不符整区丢弃不连累", () => {
  const p = path.join(DATA_DIR, "cache", "kg-427-tolerance.json")
  const base = {
    version: 1,
    built_at: new Date().toISOString(),
    fingerprint: "fp",
    // 旧格式：#273 时代的 docs 没有 description 字段
    docs: [{ id: "a", name: "a", title: "a", tags: [], folder: "", bucket: "global", vec: { x: 1 } }],
  }
  clusters.writeKnowledgeIndexFile(p, base as never)
  const legacy = clusters.readKnowledgeIndexFile(p)
  if (!legacy) throw new Error("legacy docs without description must be tolerated")
  assert.equal(legacy.docs[0].description, undefined)

  fs.writeFileSync(p, JSON.stringify({ ...base, graph_llm: { fingerprint: 1, groups: [], relations: [], stale: false } }))
  const badLlm = clusters.readKnowledgeIndexFile(p)
  if (!badLlm) throw new Error("malformed graph_llm must not kill the file")
  assert.equal((badLlm as { graph_llm?: unknown }).graph_llm, undefined, "fingerprint 非字符串 → 整区丢弃")
  assert.equal(badLlm.docs.length, 1, "docs 存活")

  fs.writeFileSync(p, JSON.stringify({ ...base, graph_lock: { groups: "not-array" } }))
  const badLock = clusters.readKnowledgeIndexFile(p)
  if (!badLock) throw new Error("malformed graph_lock must not kill the file")
  assert.equal((badLock as { graph_lock?: unknown }).graph_lock, undefined)

  fs.writeFileSync(p, JSON.stringify({ ...base, graph_tf_switch_ack: "yes" }))
  const badAck = clusters.readKnowledgeIndexFile(p)
  if (!badAck) throw new Error("malformed ack must not kill the file")
  assert.equal((badAck as { graph_tf_switch_ack?: unknown }).graph_tf_switch_ack, undefined)

  // 合法 graph_lock / ack 原样保留
  fs.writeFileSync(
    p,
    JSON.stringify({ ...base, graph_lock: { groups: [{ ids: ["a", "b"], name: "L" }] }, graph_tf_switch_ack: true }),
  )
  const kept = clusters.readKnowledgeIndexFile(p)
  if (!kept) throw new Error("valid sections must survive")
  assert.equal(kept.graph_lock?.groups.length, 1)
  assert.equal(kept.graph_tf_switch_ack, true)
})

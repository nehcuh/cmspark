import test, { after, before } from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { performance } from "node:perf_hooks"

// #273 Wave B: 派生索引 + 聚类 + 分布视图（spec §6.1/§6.2/§6.3/§6.4）
// 覆盖 AC-8（确定性）、AC-9（冷启动性能）、AC-11（缺失/损坏重建）、
// AC-12（n=20/19、全离群）、AC-15（超 cap）、MIN_SIZE 解散与标签闸。

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-k-clusters-"))
process.env.HOME = tempHome
process.env.CMSPARK_DATA_DIR = path.join(tempHome, ".cmspark-agent")
delete process.env.DEEPSEEK_API_KEY

let initDataDir: typeof import("../src/config").initDataDir
let getConfigDir: typeof import("../src/config").getConfigDir
let SkillEngine: typeof import("../src/skills/skill-engine").SkillEngine
let clusters: typeof import("../src/skills/knowledge-clusters")
let corpus: typeof import("./fixtures/knowledge-eval/corpus")

before(async () => {
  const configMod = await import("../src/config")
  initDataDir = configMod.initDataDir
  getConfigDir = configMod.getConfigDir
  SkillEngine = (await import("../src/skills/skill-engine")).SkillEngine
  clusters = await import("../src/skills/knowledge-clusters")
  corpus = await import("./fixtures/knowledge-eval/corpus")
  await initDataDir()
})

after(() => {
  fs.rmSync(tempHome, { recursive: true, force: true })
})

function resetKnowledgeDirs() {
  fs.rmSync(path.join(getConfigDir(), "knowledge"), { recursive: true, force: true })
}

type IndexDoc = import("../src/skills/knowledge-clusters").KnowledgeIndexDoc

/** 直接构造索引文档（纯函数测试用）：vec 手工给，绕开 tokenizer 不确定性。 */
function mkDoc(id: string, vec: Record<string, number>, tags: string[] = [], title = id): IndexDoc {
  return { id, name: id, title, tags, folder: "", bucket: "", vec }
}

/** 词表完全正交的文档（cosine = 0）。 */
function orthoDocs(prefix: string, n: number): IndexDoc[] {
  const out: IndexDoc[] = []
  for (let i = 0; i < n; i++) {
    out.push(mkDoc(`${prefix}${String(i).padStart(2, "0")}`, { [`tok${prefix}${i}`]: 1 }))
  }
  return out
}

function serializeDist(d: { groups: Array<{ key: string; label: string; ids: string[] }>; ungrouped: string[] }) {
  return JSON.stringify({
    groups: d.groups.map((g) => ({ key: g.key, label: g.label, ids: g.ids })),
    ungrouped: d.ungrouped,
  })
}

// --- AC-8: 确定性（跨一次索引重建 + 打乱输入序） ---

test("AC-8: same doc set → same groups/labels across rebuild + shuffled input", () => {
  // 两组（共享 alpha / gamma）+ 离群；pad 项各自唯一
  const groupA = [1, 2, 3].map((i) => mkDoc(`a${i}`, { alpha: 0.8, [`pa${i}`]: 0.2 }, ["sharedalpha"], `Alpha note ${i}`))
  const groupB = [1, 2, 3].map((i) => mkDoc(`b${i}`, { gamma: 0.8, [`pb${i}`]: 0.2 }, ["sharedgamma"], `Gamma note ${i}`))
  const outliers = orthoDocs("z", 2)
  const docs = [...groupA, ...groupB, ...outliers]

  const first = clusters.clusterKnowledgeDocs(docs)
  // 打乱输入序
  const shuffled = [...docs].reverse()
  const second = clusters.clusterKnowledgeDocs(shuffled)
  assert.equal(serializeDist(second), serializeDist(first), "shuffled input order must not change grouping")

  // 跨一次索引重建（JSON 落盘 → 读回 → 再聚类）
  const indexPath = clusters.knowledgeIndexPath()
  clusters.writeKnowledgeIndexFile(indexPath, {
    version: 1,
    built_at: new Date().toISOString(),
    fingerprint: "fp-ac8",
    docs,
  })
  const loaded = clusters.readKnowledgeIndexFile(indexPath)
  assert.ok(loaded, "index roundtrip")
  const third = clusters.clusterKnowledgeDocs(loaded!.docs)
  assert.equal(serializeDist(third), serializeDist(first), "grouping must survive an index rebuild")

  // 标签确定性：共享 tag → 标签
  assert.equal(first.groups.find((g) => g.key === "a1")?.label, "sharedalpha")
  assert.equal(first.groups.find((g) => g.key === "b1")?.label, "sharedgamma")
  assert.deepEqual([...first.ungrouped].sort(), ["z00", "z01"])
})

test("channel keys are namespaced: doc named __ungrouped__ as a group id-min cannot collide with the reserved key", () => {
  // Gate9 r2 claude N2：用户文档叫 __ungrouped__ 且恰是某分组 id-min ——
  // 分组键带 c: 前缀、未分组键 u:ungrouped，两枚 chip 不串。
  const group = [
    mkDoc("__ungrouped__", { alpha: 0.8, p1: 0.2 }, ["sharedx"], "X1"),
    mkDoc("zz1", { alpha: 0.8, p2: 0.2 }, ["sharedx"], "X2"),
    mkDoc("zz2", { alpha: 0.8, p3: 0.2 }, ["sharedx"], "X3"),
  ]
  const outliers = orthoDocs("w", 2)
  const { groups, ungrouped } = clusters.clusterKnowledgeDocs([...group, ...outliers])
  assert.equal(groups.length, 1)
  assert.equal(groups[0].key, "__ungrouped__", "内部分组键 = 成员 id min（无前缀）")
  const channel = clusters.toDistributionChannel({ status: "ok", groups, ungrouped })
  const keys = channel.groups.map((g) => g.key)
  assert.ok(keys.includes("c:__ungrouped__"), "分组键带 c: 前缀")
  assert.ok(keys.includes("u:ungrouped"), "未分组保留键带 u: 前缀")
  assert.equal(new Set(keys).size, keys.length, "无 key 碰撞")
  const cGroup = channel.groups.find((g) => g.key === "c:__ungrouped__")!
  const uGroup = channel.groups.find((g) => g.key === "u:ungrouped")!
  assert.deepEqual(cGroup.ids, ["__ungrouped__", "zz1", "zz2"])
  assert.deepEqual(uGroup.ids, ["w00", "w01"])
})

test("AC-8: label frequency tie → lexicographically smallest", () => {
  // 两个 tag 在簇内 df 相同（=3），频次并列取字典序最小
  const members = [1, 2, 3].map((i) =>
    mkDoc(`t${i}`, { shared: 0.9, [`pt${i}`]: 0.1 }, ["beta-tag", "alpha-tag"], `T${i}`),
  )
  const { groups } = clusters.clusterKnowledgeDocs(members)
  assert.equal(groups.length, 1)
  assert.equal(groups[0].label, "alpha-tag")
})

test("cluster: MIN_SIZE=3 dissolves undersized clusters into ungrouped", () => {
  const pair = [1, 2].map((i) => mkDoc(`p${i}`, { sharedpair: 1 }))
  const rest = orthoDocs("u", 3)
  const { groups, ungrouped } = clusters.clusterKnowledgeDocs([...pair, ...rest])
  assert.equal(groups.length, 0, "2-doc cluster must dissolve (< MIN_SIZE)")
  assert.deepEqual(ungrouped, ["p1", "p2", "u00", "u01", "u02"])
})

test("labels: sensitive-shaped candidates are gated; redactSecrets takes .text", () => {
  // 共享 tag 命中 SENSITIVE_TAG_RE（sk- 前缀）→ 拒绝，落共享标题词
  const members = [1, 2, 3].map((i) =>
    mkDoc(`s${i}`, { shareds: 0.9, [`ps${i}`]: 0.1 }, ["sk-secretvalue"], `Quarterly report ${i}`),
  )
  const { groups } = clusters.clusterKnowledgeDocs(members)
  assert.equal(groups.length, 1)
  assert.ok(!/sk-|secret/i.test(groups[0].label), `sensitive tag must not become a label: ${groups[0].label}`)
  // 标题词候选带 api_key= 形状 → normalizeTag/SENSITIVE_TAG_RE 拒绝该候选，
  // 最终标签不得含敏感串（redactSecrets 取 .text，不是把对象拼进字符串）
  const risky = [1, 2, 3].map((i) =>
    mkDoc(`r${i}`, { sharedr: 0.9, [`pr${i}`]: 0.1 }, [], `api_key=abcdef note ${i}`),
  )
  const gated = clusters.labelCluster(risky)
  assert.ok(!/api_key=abcdef/.test(gated), `label must not leak secret-shaped text: ${gated}`)
})

// --- 索引文件（§6.1）：0o600、损坏/半截按缺失处理不 throw ---

test("index file: 0o600, atomic write, corrupt/half JSON treated as missing", () => {
  const p = clusters.knowledgeIndexPath()
  clusters.writeKnowledgeIndexFile(p, {
    version: 1,
    built_at: new Date().toISOString(),
    fingerprint: "fp-mode",
    docs: [mkDoc("d1", { a: 1 })],
  })
  const mode = fs.statSync(p).mode & 0o777
  assert.equal(mode, 0o600, `index file mode: ${mode.toString(8)}`)
  assert.ok(clusters.readKnowledgeIndexFile(p), "well-formed index loads")

  fs.writeFileSync(p, "{", { mode: 0o600 }) // 半截
  assert.equal(clusters.readKnowledgeIndexFile(p), null, "half-written JSON = missing")
  fs.writeFileSync(p, "not json at all", { mode: 0o600 })
  assert.equal(clusters.readKnowledgeIndexFile(p), null, "corrupt JSON = missing")
  fs.writeFileSync(p, JSON.stringify({ version: 2, docs: [] }), { mode: 0o600 })
  assert.equal(clusters.readKnowledgeIndexFile(p), null, "wrong version = missing")
  fs.rmSync(p, { force: true })
  assert.equal(clusters.readKnowledgeIndexFile(p), null, "absent file = missing")
})

// --- 引擎侧生命周期（AC-11/AC-12/AC-15 + 写路径触发） ---

test("AC-11: cache deleted / corrupted → auto-rebuild on read, no throw, injection not blocked", () => {
  resetKnowledgeDirs()
  corpus.seedEvalCorpus(path.join(getConfigDir(), "knowledge"))
  const indexPath = clusters.knowledgeIndexPath()

  const se1 = new SkillEngine()
  const dist1 = se1.getKnowledgeDistribution()
  assert.ok(dist1 && dist1.groups.length > 0, "fresh engine builds index + clusters")
  assert.ok(fs.existsSync(indexPath), "index persisted")

  // 删除 cache → 新进程态（空内存）自动重建，降级期间无报错
  fs.rmSync(indexPath)
  const se2 = new SkillEngine()
  const dist2 = se2.getKnowledgeDistribution()
  assert.ok(dist2 && dist2.groups.length > 0, "missing cache auto-rebuilds")
  assert.ok(fs.existsSync(indexPath), "index rewritten")

  // 损坏 JSON → 按缺失处理，同样自动重建、不阻塞注入
  fs.writeFileSync(indexPath, "{", { mode: 0o600 })
  const se3 = new SkillEngine()
  const dist3 = se3.getKnowledgeDistribution()
  assert.ok(dist3 && dist3.groups.length > 0, "corrupt cache treated as missing and rebuilt")
  const ids = se3.resolveKnowledgeIdsForThread("t-ac11", "auto", undefined, "refund policy return process")
  const built = se3.buildSystemPromptWithSources("t-ac11", undefined, [], ids, "refund policy return process")
  assert.ok(built.retrieved_sources.length > 0, "injection not blocked by index churn")
})

test("write path schedules debounced rebuild; read path reflects new doc immediately", () => {
  resetKnowledgeDirs()
  corpus.seedEvalCorpus(path.join(getConfigDir(), "knowledge"))
  const se = new SkillEngine()
  const before = se.getKnowledgeDistribution()
  assert.ok(before && !before.groups.some((g) => g.ids.includes("newdoc")))

  // WS 写路径（导入）→ refresh() → 防抖重建被排上（single-flight 合并）
  se.importKnowledge("---\nname: newdoc\ndescription: refund policy extra note\ntype: domain_knowledge\n---\nrefund policy return process body\n")
  assert.ok(
    (se as any).knowledgeIndexTimer !== null,
    "write path must schedule a debounced index rebuild (KNOWLEDGE_INDEX_DEBOUNCE_MS)",
  )
  // 读路径不傻等防抖窗：指纹漂移 → 立即重建，新文档进入分布
  const afterDist = se.getKnowledgeDistribution()
  assert.ok(afterDist, "distribution after import")
  const allIds = afterDist!.groups.flatMap((g) => g.ids)
  assert.ok(allIds.includes("newdoc"), `new doc must join the distribution: ${JSON.stringify(allIds)}`)
  assert.equal(clusters.KNOWLEDGE_INDEX_DEBOUNCE_MS, 2000, "debounce window constant (spec §6.2)")
})

test("AC-12 view side: n=20 renders, n=19 hidden; all-outlier not rendered", () => {
  resetKnowledgeDirs()
  corpus.seedEvalCorpus(path.join(getConfigDir(), "knowledge"))
  const se = new SkillEngine()
  const dist20 = se.getKnowledgeDistribution()
  assert.ok(dist20 && dist20.groups.length > 0 && !dist20.reason, "n=20 renders chips")

  // n=19（删一篇离群文档）→ 不渲染
  fs.rmSync(path.join(getConfigDir(), "knowledge", "global", "o3.md"))
  const se19 = new SkillEngine()
  const dist19 = se19.getKnowledgeDistribution()
  assert.ok(dist19, "field present for panel")
  assert.equal(dist19!.groups.length, 0)
  assert.equal(dist19!.reason, "too_few", "n=19 → too_few（不渲染）")

  // 全离群：20 篇完全正交 → 只剩「未分组」一枚芯片 → 不渲染
  resetKnowledgeDirs()
  const globalDir = path.join(getConfigDir(), "knowledge", "global")
  fs.mkdirSync(globalDir, { recursive: true, mode: 0o700 })
  for (let i = 0; i < 20; i++) {
    const name = `lone${String(i).padStart(2, "0")}`
    const body = (`lonetok${i} `.repeat(45) + `pad${name} `.repeat(200)).slice(0, 600)
    fs.writeFileSync(
      path.join(globalDir, `${name}.md`),
      `---\nname: ${name}\ntitle: "Lonetopic ${i}"\ndescription: "lonetok${i} unique"\ntype: domain_knowledge\n---\n${body}`,
      { mode: 0o600 },
    )
  }
  const seLone = new SkillEngine()
  const distLone = seLone.getKnowledgeDistribution()
  assert.ok(distLone)
  assert.equal(distLone!.groups.length, 0, "全离群不渲染（不假装结构）")
  assert.equal(distLone!.reason, "all_ungrouped")
})

test("AC-15: 201 docs → over_cap honest state (视图不渲染 chips)", () => {
  resetKnowledgeDirs()
  corpus.seedEvalCorpus(path.join(getConfigDir(), "knowledge"))
  const globalDir = path.join(getConfigDir(), "knowledge", "global")
  for (let i = 0; i < 181; i++) {
    const name = `bulk${String(i).padStart(3, "0")}`
    fs.writeFileSync(
      path.join(globalDir, `${name}.md`),
      `---\nname: ${name}\ntitle: "Bulk ${i}"\ndescription: "bulktok${i} filler"\ntype: domain_knowledge\n---\nbulktok${i} body\n`,
      { mode: 0o600 },
    )
  }
  const se = new SkillEngine()
  const dist = se.getKnowledgeDistribution()
  assert.ok(dist)
  assert.equal(dist!.groups.length, 0, "超 cap 不渲染分组 chips")
  assert.equal(dist!.reason, "over_cap", "over_cap → UI 诚实文案「库超过 200 篇，未自动分组」")
  assert.equal(clusters.KNOWLEDGE_CLUSTER_DOC_CAP, 200)
  assert.equal(clusters.KNOWLEDGE_CLUSTER_MIN_DOCS, 20)
  assert.equal(clusters.KNOWLEDGE_CLUSTER_MIN_SIZE, 3)
  assert.equal(clusters.KNOWLEDGE_CLUSTER_MERGE_MIN, 0.25)
})

test("AC-9: 100+ docs cold distribution build (incl. clustering) < 1s", () => {
  resetKnowledgeDirs()
  const globalDir = path.join(getConfigDir(), "knowledge", "global")
  fs.mkdirSync(globalDir, { recursive: true, mode: 0o700 })
  // 120 篇：6 个话题组 × 18 + 12 离群，正文 ~600 字符
  let n = 0
  for (let g = 0; g < 6; g++) {
    for (let i = 0; i < 18; i++) {
      const name = `bench-${g}-${i}`
      const body = (`topictok${g} sharedword${g} `.repeat(30) + `pad${name} `.repeat(80)).slice(0, 600)
      fs.writeFileSync(
        path.join(globalDir, `${name}.md`),
        `---\nname: ${name}\ntitle: "Bench ${g}-${i}"\ndescription: "topictok${g} bench"\ntype: domain_knowledge\ntags: [bench${g}]\n---\n${body}`,
        { mode: 0o600 },
      )
      n++
    }
  }
  for (let i = 0; i < 12; i++) {
    const name = `bench-lone-${i}`
    fs.writeFileSync(
      path.join(globalDir, `${name}.md`),
      `---\nname: ${name}\ntitle: "Lone ${i}"\ndescription: "lonetok${i}"\ntype: domain_knowledge\n---\nlonetok${i} body\n`,
      { mode: 0o600 },
    )
    n++
  }
  assert.equal(n, 120)
  const se = new SkillEngine()
  const t0 = performance.now()
  const dist = se.getKnowledgeDistribution() // 冷启动：含索引构建 + 一次聚类
  const dt = performance.now() - t0
  assert.ok(dist && dist.groups.length > 0, "benchmark corpus clusters")
  assert.ok(dt < 1000, `cold distribution over 120 docs took ${dt.toFixed(1)}ms (spec: < 1s)`)
})

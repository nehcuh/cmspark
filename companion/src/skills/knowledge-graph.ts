// Knowledge graph view computation (#296, spec §3.1/§5/§6; #427 spec §2–§6).
// Spec: docs/superpowers/specs/2026-09-04-knowledge-graph-view-design.md
//       docs/superpowers/specs/2026-09-06-knowledge-graph-small-corpus-design.md
// ADR: docs/adr/028-knowledge-graph-view-exemption-extension.md
//
// 纯派生、只读、可丢可重建（spec §2）：节点/边每次从派生索引现算，边不落盘。
// 聚类与分组键复用 knowledge-clusters（唯一算法点）；相关度复用
// knowledge-related 的 scoreRelatedKnowledge（唯一计算点，只放宽取边参数）。
// #427：图谱画布闸与聚类闸解绑（MIN_DOCS=1）；2–19 走 LLM lane（organize
// 产物 + 锁 overlay），≥20 TF 路径零改动；MIN_DOCS/scoreRelatedKnowledge 不动。

import { createHash } from "node:crypto"
import {
  KNOWLEDGE_CLUSTER_DOC_CAP,
  KNOWLEDGE_CLUSTER_MIN_DOCS,
  KNOWLEDGE_UNGROUPED_KEY,
  buildKnowledgeDistribution,
  clusterKnowledgeDocs,
  compareCodepoint,
  type KnowledgeCluster,
  type KnowledgeGraphGroupEntry,
  type KnowledgeGraphLabelEntry,
  type KnowledgeGraphLlmSection,
  type KnowledgeGraphLockSection,
  type KnowledgeIndexDoc,
} from "./knowledge-clusters"
import { scoreRelatedKnowledge } from "./knowledge-related"
import { redactSecrets } from "../threads/distill"

// --- 常数表（spec §6 / #427 spec §8；可测可调，不要藏） ---

/** 每节点出边上限（spec §3.1：top-5，无合成分地板）。 */
export const KNOWLEDGE_GRAPH_EDGE_TOPK = 5
/** 节点上限：复用 KNOWLEDGE_CLUSTER_DOC_CAP，不另设。 */
export const KNOWLEDGE_GRAPH_DOC_CAP = KNOWLEDGE_CLUSTER_DOC_CAP
/**
 * 图谱画布下限（#427 spec §2）：与聚类闸解绑，n≥1 即画布（散点是诚实结构）。
 * too_few 只剩 n=0。KNOWLEDGE_CLUSTER_MIN_DOCS（分布 chips / 簇路由闸）不动。
 */
export const KNOWLEDGE_GRAPH_MIN_DOCS = 1
/** LLM lane 上界（#427 spec §2：= 聚类闸 -1，同源不另造数）。 */
export const KNOWLEDGE_GRAPH_LLM_LANE_MAX = KNOWLEDGE_CLUSTER_MIN_DOCS - 1
/** 全图 LLM 关联上限（两段式第二刀）。 */
export const KNOWLEDGE_GRAPH_RELATIONS_CAP = 12
/** 单端点 LLM 关联度数上限（两段式第一刀）。 */
export const KNOWLEDGE_GRAPH_RELATIONS_PER_NODE = 3
/** reason 钳制（码点切片，不劈代理对）。 */
export const KNOWLEDGE_GRAPH_RELATION_REASON_MAX = 80
/** organize 单次 LLM 调用超时（#427 spec §3.1：label 档，慢就诚实失败）。 */
export const KNOWLEDGE_GRAPH_ORGANIZE_TIMEOUT_MS = 30_000
/** 池丢弃率回退阈（#427 spec §3.2：分池判定，超阈该池整体回退）。 */
export const KNOWLEDGE_GRAPH_POOL_DISCARD_FALLBACK = 0.5
/** LLM 分组名称长度上限（字）。 */
export const KNOWLEDGE_GRAPH_LABEL_NAME_MAX = 20
/** LLM 分组摘要长度上限（字）。 */
export const KNOWLEDGE_GRAPH_LABEL_SUMMARY_MAX = 280
/** display 缓存条目上限：超出整体丢弃（可丢缓存的软界）。 */
export const KNOWLEDGE_GRAPH_DISPLAY_MAX_ENTRIES = 1000

// --- wire 形状（spec §5 / #427 spec §4） ---

export type KnowledgeGraphNode = { id: string; title: string; group_key: string; folder: string }
export type KnowledgeGraphEdge = { a: string; b: string; score: number }
export type KnowledgeGraphLabel = {
  name: string
  summary?: string
  ai: boolean
  /** #427：锁 overlay 分组（ext wire 合同：labels[].locked，缺省无此字段）。 */
  locked?: true
}
export type KnowledgeGraphLabelTarget = { key: string; lines: string[]; cached: boolean }
/** #427：LLM 关联（纯覆盖层，不进 edges[].score；只在 2–19 帧上 wire）。 */
export type KnowledgeGraphRelation = { a: string; b: string; reason: string; confidence: number; ai: true }
/** #427：graph_llm 缓存里的关联条目形状（KnowledgeGraphLlmSection 的元素）。 */
export type KnowledgeGraphRelationEntry = KnowledgeGraphLlmSection["relations"][number]

/** 服务端内部形状：labelTargets 供异步 LLM 标注驱动，不上 wire。 */
export type KnowledgeGraphCore = {
  status: "ok" | "too_few" | "over_cap"
  truncated: boolean
  nodes: KnowledgeGraphNode[]
  edges: KnowledgeGraphEdge[]
  labels: Record<string, KnowledgeGraphLabel>
  labelTargets: KnowledgeGraphLabelTarget[]
  /** #427：LLM 关联——仅 LLM lane（2–19）非空；≥20 帧永不携带。 */
  relations: KnowledgeGraphRelation[]
  /**
   * #427（pi MAJOR-1 修复）：graph_llm 缓存区存在即 true——合法空整理
   * （groups:[] + relations:[]）与「无缓存」在 wire 上必须可区分（后者省略
   * organized 与 relations 两个字段，前者两字段都在场）。
   */
  organized?: boolean
  /** #427：本帧来自 LLM lane（handler 据此决定 relations/stale 是否上 wire）。 */
  llmLane: boolean
  /** #427：graph_llm 缓存指纹已漂（UI「语料已变化」badge）。 */
  llmStale?: boolean
  /** #427：锁组缩容到 <2 解散的一次性名单（引擎写回剪枝锁后不再重现）。 */
  lockDissolved?: string[]
  /** #427：≥20 切换一次性 banner（引擎落 graph_tf_switch_ack 后不再置位）。 */
  tfSwitchBanner?: boolean
}

/**
 * `l:<hash>` 分组键（#427 spec §2：服务端派生——sha256(排序后成员 id).slice(0,12)，
 * 同成员集合同键；LLM 永不产出键）。缩容后键随成员集变化，**锁的身份是
 * graph_lock 条目本身而非 hash**（pi 终验注意 2）。
 */
export function lGroupKey(ids: string[]): string {
  const sorted = [...ids].sort(compareCodepoint)
  return "l:" + createHash("sha256").update(JSON.stringify(sorted), "utf8").digest("hex").slice(0, 12)
}

/**
 * graph_llm 缓存指纹（#427 spec §3.3）：全部参与文档 (id, title, description,
 * tags) 的聚合散列——tags 必须在内（tags 是 LLM 输入，只改 tags 也得标 stale）。
 */
export function computeGraphLlmFingerprint(docs: KnowledgeIndexDoc[]): string {
  // \u0001 分字段、\u0002 分文档：防串接碰撞（id/title 边界可造）
  const parts = docs
    .map((d) =>
      [d.id, d.title, d.description || "", [...d.tags].sort(compareCodepoint).join(",")].join("\u0001"),
    )
    .sort(compareCodepoint)
  return createHash("sha256").update(parts.join("\u0002"), "utf8").digest("hex")
}

/**
 * 从派生索引现算图谱（#427 spec §2 状态映射表）。
 * n=0 → too_few（不假装结构）；n=1 → 单节点不分组不调 LLM；2–19 → LLM lane
 * （缓存产物 + 锁 overlay，无缓存 = 全未分组 + TF 边照算）；n≥20 → 既有 TF
 * 路径零改动（n>200 → 标题字典序截取前 200 并对截取集重跑聚类）。
 * 同输入 → 同输出（确定性三钉沿用聚类层）。
 */
export function buildKnowledgeGraph(
  docs: KnowledgeIndexDoc[],
  display?: Record<string, KnowledgeGraphLabelEntry>,
  opts?: {
    llmLabels?: boolean
    /** #427 LLM lane 缓存产物（引擎侧已按现存 docs 剪枝）。 */
    llm?: { groups: KnowledgeGraphGroupEntry[]; relations: KnowledgeGraphRelationEntry[] }
    llmStale?: boolean
    /** #427 锁 overlay（引擎侧已剪枝，组 ≥2 现存成员）。 */
    lock?: KnowledgeGraphLockSection
  },
): KnowledgeGraphCore {
  if (docs.length < KNOWLEDGE_GRAPH_MIN_DOCS) {
    return {
      status: "too_few",
      truncated: false,
      nodes: [],
      edges: [],
      labels: {},
      labelTargets: [],
      relations: [],
      llmLane: false,
    }
  }

  const llmLane = docs.length < KNOWLEDGE_CLUSTER_MIN_DOCS
  let selected: KnowledgeIndexDoc[]
  let status: "ok" | "over_cap"
  let groups: KnowledgeCluster[]
  if (docs.length > KNOWLEDGE_GRAPH_DOC_CAP) {
    selected = [...docs]
      .sort((x, y) => compareCodepoint(x.title, y.title) || compareCodepoint(x.id, y.id))
      .slice(0, KNOWLEDGE_GRAPH_DOC_CAP)
    groups = clusterKnowledgeDocs(selected).groups
    status = "over_cap"
  } else if (llmLane) {
    // #427：2–19 LLM lane——TF 聚类不参与图谱（分布视图/簇路由仍走各自 20 闸）
    selected = docs
    groups = []
    status = "ok"
  } else {
    selected = docs
    const dist = buildKnowledgeDistribution(docs)
    groups = dist.status === "ok" ? dist.groups : []
    status = "ok"
  }

  const byId = new Map(selected.map((d) => [d.id, d]))
  const groupOf = new Map<string, string>()
  for (const g of groups) for (const id of g.ids) groupOf.set(id, `c:${g.key}`)
  for (const g of opts?.llm?.groups ?? []) {
    // 同成员集合两组：先到先得（后组撞已占键自然被盖）
    const key = lGroupKey(g.ids)
    for (const id of g.ids) {
      if (byId.has(id) && !groupOf.has(id)) groupOf.set(id, key)
    }
  }

  const nodes = [...selected]
    .sort((x, y) => compareCodepoint(x.id, y.id))
    .map((d) => ({
      id: d.id,
      title: d.title,
      group_key: groupOf.get(d.id) ?? KNOWLEDGE_UNGROUPED_KEY,
      folder: d.folder,
    }))

  const edges = buildKnowledgeGraphEdges(selected)

  const labels: Record<string, KnowledgeGraphLabel> = {}
  const labelTargets: KnowledgeGraphLabelTarget[] = []
  if (llmLane) {
    // #427 LLM lane：分组/命名/摘要直接来自 organize 产物（全 ai:true）；
    // labelTargets 恒空（label 通道只服务 TF lane 的高频词→AI 命名缝）
    const presentKeys = new Set(nodes.map((n) => n.group_key))
    for (const g of opts?.llm?.groups ?? []) {
      const key = lGroupKey(g.ids)
      if (!presentKeys.has(key)) continue
      labels[key] = { name: g.name, ...(g.summary !== undefined ? { summary: g.summary } : {}), ai: true }
    }
  } else {
    const presentKeys = new Set(nodes.map((n) => n.group_key))
    for (const g of groups) {
      const key = `c:${g.key}`
      if (!presentKeys.has(key)) continue
      // spec AC-4：开关关（llmLabels !== true）时一律高频词回退标签——display
      // 里的 AI 缓存不得上 wire（否则 UI 关开关后仍显示 AI 名，假完成）。
      const clamped =
        opts?.llmLabels === true && display?.[key] ? clampKnowledgeGraphLabelEntry(display[key]) : null
      if (clamped) {
        labels[key] = { name: clamped.name, ...(clamped.summary !== undefined ? { summary: clamped.summary } : {}), ai: true }
        labelTargets.push({ key, lines: groupLabelLines(key, g, byId), cached: true })
      } else {
        labels[key] = { name: g.label, ai: false }
        labelTargets.push({ key, lines: groupLabelLines(key, g, byId), cached: false })
      }
    }
  }

  // #427 §5：锁 overlay 最后套（锁着色以锁为准；锁不进 TF 聚类输入）
  const nodeById = new Map(nodes.map((n) => [n.id, n]))
  for (const lg of opts?.lock?.groups ?? []) {
    const live = lg.ids.filter((id) => nodeById.has(id))
    if (live.length < 2) continue // 引擎侧已解散；防御
    const key = lGroupKey(live)
    for (const id of live) {
      const n = nodeById.get(id)
      if (n) n.group_key = key
    }
    labels[key] = {
      name: lg.name,
      ...(lg.summary !== undefined ? { summary: lg.summary } : {}),
      ai: true,
      locked: true,
    }
  }
  // 「未分组」label 以 overlay 后的实际归属为准（锁收编全部散点时不残留）
  if (nodes.some((n) => n.group_key === KNOWLEDGE_UNGROUPED_KEY)) {
    labels[KNOWLEDGE_UNGROUPED_KEY] = { name: "未分组", ai: false }
  } else {
    delete labels[KNOWLEDGE_UNGROUPED_KEY]
  }

  // #427 §4：relations 纯覆盖层——只在 LLM lane 存在，端点按现存 docs 过滤、
  // (a,b) 字典序归一（确定性）；≥20 / over_cap 帧恒空数组
  const relations: KnowledgeGraphRelation[] = llmLane
    ? (opts?.llm?.relations ?? [])
        .filter((r) => byId.has(r.a) && byId.has(r.b))
        .map((r) => {
          const flip = compareCodepoint(r.a, r.b) < 0
          return {
            a: flip ? r.a : r.b,
            b: flip ? r.b : r.a,
            reason: r.reason,
            confidence: r.confidence,
            ai: true as const,
          }
        })
    : []

  return {
    status,
    truncated: docs.length > KNOWLEDGE_GRAPH_DOC_CAP,
    nodes,
    edges,
    labels,
    labelTargets,
    relations,
    llmLane,
    ...(opts?.llm ? { organized: true } : {}),
    ...(llmLane && opts?.llmStale === true ? { llmStale: true } : {}),
  }
}

/**
 * 边现算（spec §5）：对每节点跑 scoreRelatedKnowledge，score>0 者按分降序、
 * 平局 id 字典序取 top-K；无向对称去重（a<b 字典序只留一条）；输出按 (a,b) 排序。
 * 权重/语料不改（改动会触发 wikilinks 同源评测重证，spec §6）。
 * #427：n≥2 即算（它本无篇数门槛，只是被旧 too_few 闸挡在门外）。
 */
function buildKnowledgeGraphEdges(docs: KnowledgeIndexDoc[]): KnowledgeGraphEdge[] {
  const ordered = [...docs].sort((x, y) => compareCodepoint(x.id, y.id))
  const best = new Map<string, { a: string; b: string; score: number }>()
  for (const seed of ordered) {
    const hits: Array<{ id: string; score: number }> = []
    for (const other of ordered) {
      if (other.id === seed.id) continue
      const hit = scoreRelatedKnowledge(seed, other)
      if (hit.score > 0) hits.push({ id: other.id, score: hit.score })
    }
    hits.sort((x, y) => y.score - x.score || compareCodepoint(x.id, y.id))
    for (const h of hits.slice(0, KNOWLEDGE_GRAPH_EDGE_TOPK)) {
      const flip = compareCodepoint(seed.id, h.id) < 0
      const a = flip ? seed.id : h.id
      const b = flip ? h.id : seed.id
      const k = JSON.stringify([a, b])
      const prev = best.get(k)
      if (prev === undefined || h.score > prev.score) {
        best.set(k, { a, b, score: h.score })
      }
    }
  }
  return [...best.values()].sort(
    (x, y) => compareCodepoint(x.a, y.a) || compareCodepoint(x.b, y.b),
  )
}

// --- LLM 分组标签（spec §3.2：命名 ≤20 字 + 摘要 ≤280 字，#272 llm-extract 通道） ---

/** 标签单行净化：剥控制字符（保留 \t \n）+ redactSecrets（信任边界，LLM 输出与缓存读取都过）。 */
function sanitizeLabelLine(s: string): string {
  return redactSecrets(s.replace(/[\x00-\x08\x0b-\x1f\x7f]+/g, " ")).text
}

/** LLM 输出/缓存条目钳制：name ≤ NAME_MAX、summary ≤ SUMMARY_MAX；name 为空 → null。 */
export function clampKnowledgeGraphLabelEntry(entry: {
  name: unknown
  summary?: unknown
}): { name: string; summary?: string } | null {
  if (typeof entry.name !== "string") return null
  const name = sanitizeLabelLine(entry.name).slice(0, KNOWLEDGE_GRAPH_LABEL_NAME_MAX).trim()
  if (!name) return null
  const out: { name: string; summary?: string } = { name }
  if (typeof entry.summary === "string") {
    const summary = sanitizeLabelLine(entry.summary).slice(0, KNOWLEDGE_GRAPH_LABEL_SUMMARY_MAX).trim()
    if (summary) out.summary = summary
  }
  return out
}

/**
 * 标注输入（#274 folder_suggest 同款隐私边界）：只有成员标题 + 标签单行
 * （每组 ≤30 行），从不进正文。行首 `GROUP <key> <n> 篇` 供批式解析定位键。
 */
function groupLabelLines(key: string, g: KnowledgeCluster, byId: Map<string, KnowledgeIndexDoc>): string[] {
  const lines = [`GROUP ${key} ${g.ids.length} 篇`]
  for (const id of g.ids.slice(0, 30)) {
    const d = byId.get(id)
    if (!d) continue
    const tags = d.tags.slice(0, 3).filter(Boolean).join(",")
    lines.push(`- ${d.title}${tags ? ` [${tags}]` : ""}`)
  }
  return lines
}

/** 标注 prompt（批式一次调用覆盖全部分组；输出严格 JSON）。 */
export function buildGraphLabelPrompt(lines: string[]): { systemPrompt: string; userContent: string } {
  const systemPrompt = [
    "你在为知识库的自动分组写展示名与一句话摘要。",
    "只依据输入中的成员标题与标签，不要编造成员不存在的内容。",
    '输出严格 JSON 对象：{"<分组键>": {"name": "...", "summary": "..."}}，',
    `name 不超过 ${KNOWLEDGE_GRAPH_LABEL_NAME_MAX} 字，summary 不超过 ${KNOWLEDGE_GRAPH_LABEL_SUMMARY_MAX} 字，summary 可省略。`,
    "除 JSON 外不要输出任何文字。",
  ].join("\n")
  const userContent = sanitizeLabelLine(lines.join("\n"))
  return { systemPrompt, userContent }
}

/** 解析 LLM 标注输出：容忍前后噪声文本；任何条目形状不符 → null（整体回退）。 */
export function parseGraphLabels(raw: string): Record<string, { name: string; summary?: string }> | null {
  if (!raw) return null
  const start = raw.indexOf("{")
  const end = raw.lastIndexOf("}")
  if (start < 0 || end <= start) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw.slice(start, end + 1))
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null
  const out: Record<string, { name: string; summary?: string }> = {}
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (!k || !v || typeof v !== "object" || Array.isArray(v)) return null
    const entry = v as { name?: unknown; summary?: unknown }
    if (typeof entry.name !== "string" || !entry.name.trim()) return null
    if (entry.summary !== undefined && typeof entry.summary !== "string") return null
    out[k] = { name: entry.name, ...(entry.summary !== undefined ? { summary: entry.summary } : {}) }
  }
  return Object.keys(out).length > 0 ? out : null
}

// --- #427 LLM 整理 lane：prompt / 解析 / 校验归一化 / 剪枝（spec §3.2/§3.3/§5） ---

/**
 * organize 输入（#427 spec §3.2 隐私边界）：每篇 title + tags(≤3) + description
 * （均已在派生索引，description 是 frontmatter 字段而非正文），从不进 .md 正文。
 * 锁组名单作为禁区进 prompt（§5：锁成员不得出现在分组输出里）。
 */
export function buildGraphOrganizePrompt(
  docs: KnowledgeIndexDoc[],
  lock?: KnowledgeGraphLockSection,
): { systemPrompt: string; userContent: string } {
  const lines: string[] = []
  for (const d of docs) {
    const tags = d.tags.slice(0, 3).filter(Boolean).join(",")
    lines.push(
      `DOC ${d.id} | ${d.title}${tags ? ` | tags: ${tags}` : ""}${d.description ? ` | ${d.description}` : ""}`,
    )
  }
  if (lock && lock.groups.length > 0) {
    lines.push("")
    lines.push("已锁定分组（禁区：其成员不得出现在你的分组输出里）：")
    for (const g of lock.groups) lines.push(`- ${g.name}: ${g.ids.join(", ")}`)
  }
  const systemPrompt = [
    "你在为一个小型知识库做整理：把明显同主题的文档分组，并指出文档两两之间的关联。",
    "只能使用输入中 DOC 行第一列的 id，不得编造 id；一篇文档至多属于一个分组；只有一篇的分组不要输出。",
    "没有把握就不要输出——不分组、不编关联，诚实优于编造。",
    "已锁定分组的成员是禁区，不得出现在你的分组输出里。",
    '输出严格 JSON：{"groups": [{"name": "…", "summary": "…", "ids": ["…"]}], "relations": [{"a": "…", "b": "…", "reason": "…", "confidence": 0.0}]}',
    `name 不超过 ${KNOWLEDGE_GRAPH_LABEL_NAME_MAX} 字；summary 不超过 ${KNOWLEDGE_GRAPH_LABEL_SUMMARY_MAX} 字，可省略；`,
    `reason 不超过 ${KNOWLEDGE_GRAPH_RELATION_REASON_MAX} 字且必填；confidence 取 0 到 1；两个数组都要输出（可为空数组）。`,
    "除 JSON 外不要输出任何文字。",
  ].join("\n")
  return { systemPrompt, userContent: sanitizeLabelLine(lines.join("\n")) }
}

/** organize LLM 输出的解析形状（语义校验在 normalize；此处只管形状零容忍）。 */
export type GraphOrganizeParsed = {
  groups: Array<{ name: string; summary?: string; ids: string[] }>
  relations: Array<{ a: string; b: string; reason: string; confidence: number }>
}

/**
 * 解析 organize 输出（#427 spec §3.2）：容忍前后噪声文本，形状零容忍
 * （parseGraphLabels 同款纪律）——groups/relations 缺一或任何条目形状不符 → null。
 * confidence 此处只要求 typeof number（NaN/Infinity 留给 normalize 按池丢弃）。
 */
export function parseGraphOrganize(raw: string): GraphOrganizeParsed | null {
  if (!raw) return null
  const start = raw.indexOf("{")
  const end = raw.lastIndexOf("}")
  if (start < 0 || end <= start) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw.slice(start, end + 1))
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null
  const obj = parsed as { groups?: unknown; relations?: unknown }
  if (!Array.isArray(obj.groups) || !Array.isArray(obj.relations)) return null
  const groups: GraphOrganizeParsed["groups"] = []
  for (const g of obj.groups) {
    if (!g || typeof g !== "object" || Array.isArray(g)) return null
    const e = g as { name?: unknown; summary?: unknown; ids?: unknown }
    if (typeof e.name !== "string" || !e.name.trim()) return null
    if (!Array.isArray(e.ids) || e.ids.length === 0) return null
    for (const id of e.ids) if (typeof id !== "string" || !id) return null
    if (e.summary !== undefined && typeof e.summary !== "string") return null
    groups.push({ name: e.name, ...(e.summary !== undefined ? { summary: e.summary } : {}), ids: [...e.ids] })
  }
  const relations: GraphOrganizeParsed["relations"] = []
  for (const r of obj.relations) {
    if (!r || typeof r !== "object" || Array.isArray(r)) return null
    const e = r as { a?: unknown; b?: unknown; reason?: unknown; confidence?: unknown }
    if (typeof e.a !== "string" || !e.a || typeof e.b !== "string" || !e.b) return null
    if (typeof e.reason !== "string") return null
    if (typeof e.confidence !== "number") return null
    relations.push({ a: e.a, b: e.b, reason: e.reason, confidence: e.confidence })
  }
  return { groups, relations }
}

/** organize 归一化结果（分池回退标志供测试与诊断；产物直接可入 graph_llm 缓存）。 */
export type GraphOrganizeNormalized = {
  groups: KnowledgeGraphGroupEntry[]
  relations: KnowledgeGraphRelationEntry[]
  groupPoolFallback: boolean
  relationPoolFallback: boolean
}

/**
 * 校验与归一化（#427 spec §3.2 逐字）：
 * - 组：clamp 同款钳制；ids 必须现存（任一亡 id → 整条结构性无效）；每篇至多
 *   属一组（重复归属后出现的整条作废）；锁成员剥离；剥离/原本后 <2 篇 → 进
 *   未分组（预期归一化，**不计入丢弃分子**）。
 * - 关联：a/b 现存且不等；reason 必填（净化后按码点切 ≤80 字，空同罪）；
 *   confidence 钳 [0,1]（非有限数值 = 结构性无效）；无序对去重留高分。
 * - 截断两段式（顺序钉死）：先每端点度数 confidence 降序 ≤3，再全图
 *   confidence 降序 ≤ min(12, 3×n)。
 * - 丢弃率分池判定：分子 = 结构性无效条目 / 分母 = LLM 原始输出条数；
 *   任一池 >50% → 该池整体回退，不连坐另一池。
 */
export function normalizeGraphOrganize(
  parsed: GraphOrganizeParsed,
  liveIds: Set<string>,
  lockedIds: Set<string>,
): GraphOrganizeNormalized {
  const groupDenominator = parsed.groups.length
  let groupInvalid = 0
  const groups: KnowledgeGraphGroupEntry[] = []
  const assigned = new Set<string>()
  for (const g of parsed.groups) {
    const clamped = clampKnowledgeGraphLabelEntry(g)
    if (!clamped) {
      groupInvalid += 1
      continue
    }
    const ids: string[] = []
    let dead = false
    for (const id of g.ids) {
      if (!liveIds.has(id)) {
        dead = true
        break
      }
      if (!ids.includes(id)) ids.push(id)
    }
    if (dead) {
      groupInvalid += 1
      continue
    }
    if (ids.some((id) => assigned.has(id))) {
      groupInvalid += 1
      continue
    }
    const free = ids.filter((id) => !lockedIds.has(id))
    if (free.length < 2) continue // 单成员组进未分组——预期归一化，不计分子
    for (const id of free) assigned.add(id)
    groups.push({
      ids: free,
      name: clamped.name,
      ...(clamped.summary !== undefined ? { summary: clamped.summary } : {}),
    })
  }
  const groupPoolFallback =
    groupDenominator > 0 && groupInvalid / groupDenominator > KNOWLEDGE_GRAPH_POOL_DISCARD_FALLBACK

  const relDenominator = parsed.relations.length
  let relInvalid = 0
  const valid: Array<{ a: string; b: string; reason: string; confidence: number }> = []
  for (const r of parsed.relations) {
    if (!liveIds.has(r.a) || !liveIds.has(r.b) || r.a === r.b || !Number.isFinite(r.confidence)) {
      relInvalid += 1
      continue
    }
    const reason = Array.from(sanitizeLabelLine(r.reason))
      .slice(0, KNOWLEDGE_GRAPH_RELATION_REASON_MAX)
      .join("")
      .trim()
    if (!reason) {
      relInvalid += 1
      continue
    }
    const flip = compareCodepoint(r.a, r.b) < 0
    valid.push({
      a: flip ? r.a : r.b,
      b: flip ? r.b : r.a,
      reason,
      confidence: Math.min(1, Math.max(0, r.confidence)),
    })
  }
  const relationPoolFallback =
    relDenominator > 0 && relInvalid / relDenominator > KNOWLEDGE_GRAPH_POOL_DISCARD_FALLBACK

  let relations: KnowledgeGraphRelationEntry[] = []
  if (!relationPoolFallback) {
    valid.sort(
      (x, y) => y.confidence - x.confidence || compareCodepoint(x.a, y.a) || compareCodepoint(x.b, y.b),
    )
    const seen = new Set<string>()
    const deduped: typeof valid = []
    for (const r of valid) {
      const k = `${r.a}|${r.b}`
      if (seen.has(k)) continue
      seen.add(k)
      deduped.push(r)
    }
    const degree = new Map<string, number>()
    const perNode: typeof valid = []
    for (const r of deduped) {
      const da = degree.get(r.a) || 0
      const db = degree.get(r.b) || 0
      if (da >= KNOWLEDGE_GRAPH_RELATIONS_PER_NODE || db >= KNOWLEDGE_GRAPH_RELATIONS_PER_NODE) continue
      degree.set(r.a, da + 1)
      degree.set(r.b, db + 1)
      perNode.push(r)
    }
    relations = perNode.slice(0, Math.min(KNOWLEDGE_GRAPH_RELATIONS_CAP, 3 * liveIds.size))
  }

  return {
    groups: groupPoolFallback ? [] : groups,
    relations,
    groupPoolFallback,
    relationPoolFallback,
  }
}

/**
 * 渲染前剪枝 graph_llm 缓存（#427 spec §3.3）：亡 id 剔除、组缩到 <2 解散。
 * 只影响当帧渲染，不落盘（缓存由下一次 organize 整体替换）。
 */
export function pruneGraphLlmSection(
  section: KnowledgeGraphLlmSection,
  liveIds: Set<string>,
): KnowledgeGraphLlmSection {
  return {
    fingerprint: section.fingerprint,
    stale: section.stale,
    groups: section.groups
      .map((g) => ({ ...g, ids: g.ids.filter((id) => liveIds.has(id)) }))
      .filter((g) => g.ids.length >= 2),
    relations: section.relations.filter((r) => liveIds.has(r.a) && liveIds.has(r.b)),
  }
}

/**
 * 锁剪枝（#427 spec §5）：成员只减不增；<2 篇 → 解散（dissolved 带组名，
 * 引擎写回剪枝后的锁 → 一次性提示不重现）。
 */
export function pruneGraphLock(
  lock: KnowledgeGraphLockSection,
  liveIds: Set<string>,
): { lock: KnowledgeGraphLockSection; dissolved: string[] } {
  const groups: KnowledgeGraphGroupEntry[] = []
  const dissolved: string[] = []
  for (const g of lock.groups) {
    const ids = g.ids.filter((id) => liveIds.has(id))
    if (ids.length < 2) {
      dissolved.push(g.name)
      continue
    }
    groups.push({ ...g, ids })
  }
  return { lock: { groups }, dissolved }
}

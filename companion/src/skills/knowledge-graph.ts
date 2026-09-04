// Knowledge graph view computation (#296, spec §3.1/§5/§6).
// Spec: docs/superpowers/specs/2026-09-04-knowledge-graph-view-design.md
// ADR: docs/adr/028-knowledge-graph-view-exemption-extension.md
//
// 纯派生、只读、可丢可重建（spec §2）：节点/边每次从派生索引现算，边不落盘。
// 聚类与分组键复用 knowledge-clusters（唯一算法点）；相关度复用
// knowledge-related 的 scoreRelatedKnowledge（唯一计算点，只放宽取边参数）。

import {
  KNOWLEDGE_CLUSTER_DOC_CAP,
  KNOWLEDGE_CLUSTER_MIN_DOCS,
  KNOWLEDGE_UNGROUPED_KEY,
  buildKnowledgeDistribution,
  clusterKnowledgeDocs,
  compareCodepoint,
  type KnowledgeCluster,
  type KnowledgeGraphLabelEntry,
  type KnowledgeIndexDoc,
} from "./knowledge-clusters"
import { scoreRelatedKnowledge } from "./knowledge-related"
import { redactSecrets } from "../threads/distill"

// --- 常数表（spec §6；可测可调，不要藏） ---

/** 每节点出边上限（spec §3.1：top-5，无合成分地板）。 */
export const KNOWLEDGE_GRAPH_EDGE_TOPK = 5
/** 节点上限：复用 KNOWLEDGE_CLUSTER_DOC_CAP，不另设。 */
export const KNOWLEDGE_GRAPH_DOC_CAP = KNOWLEDGE_CLUSTER_DOC_CAP
/** 最少文档数：复用 KNOWLEDGE_CLUSTER_MIN_DOCS，不另设。 */
export const KNOWLEDGE_GRAPH_MIN_DOCS = KNOWLEDGE_CLUSTER_MIN_DOCS
/** LLM 分组名称长度上限（字）。 */
export const KNOWLEDGE_GRAPH_LABEL_NAME_MAX = 20
/** LLM 分组摘要长度上限（字）。 */
export const KNOWLEDGE_GRAPH_LABEL_SUMMARY_MAX = 280
/** display 缓存条目上限：超出整体丢弃（可丢缓存的软界）。 */
export const KNOWLEDGE_GRAPH_DISPLAY_MAX_ENTRIES = 1000

// --- wire 形状（spec §5） ---

export type KnowledgeGraphNode = { id: string; title: string; group_key: string; folder: string }
export type KnowledgeGraphEdge = { a: string; b: string; score: number }
export type KnowledgeGraphLabel = { name: string; summary?: string; ai: boolean }
export type KnowledgeGraphLabelTarget = { key: string; lines: string[]; cached: boolean }

/** 服务端内部形状：labelTargets 供异步 LLM 标注驱动，不上 wire。 */
export type KnowledgeGraphCore = {
  status: "ok" | "too_few" | "over_cap"
  truncated: boolean
  nodes: KnowledgeGraphNode[]
  edges: KnowledgeGraphEdge[]
  labels: Record<string, KnowledgeGraphLabel>
  labelTargets: KnowledgeGraphLabelTarget[]
}

/**
 * 从派生索引现算图谱。n<20 → too_few（不假装结构）；n>200 → 标题字典序截取
 * 前 200 篇并对截取集重跑聚类（分布视图语义不变）；n≤200 分组键 = 分布视图
 * 同一 key（同源聚类，spec §3.1）。同输入 → 同输出（确定性三钉沿用聚类层）。
 */
export function buildKnowledgeGraph(
  docs: KnowledgeIndexDoc[],
  display?: Record<string, KnowledgeGraphLabelEntry>,
  opts?: { llmLabels?: boolean },
): KnowledgeGraphCore {
  if (docs.length < KNOWLEDGE_GRAPH_MIN_DOCS) {
    return { status: "too_few", truncated: false, nodes: [], edges: [], labels: {}, labelTargets: [] }
  }

  let selected: KnowledgeIndexDoc[]
  let status: "ok" | "over_cap"
  let groups: KnowledgeCluster[]
  if (docs.length > KNOWLEDGE_GRAPH_DOC_CAP) {
    selected = [...docs]
      .sort((x, y) => compareCodepoint(x.title, y.title) || compareCodepoint(x.id, y.id))
      .slice(0, KNOWLEDGE_GRAPH_DOC_CAP)
    groups = clusterKnowledgeDocs(selected).groups
    status = "over_cap"
  } else {
    selected = docs
    const dist = buildKnowledgeDistribution(docs)
    groups = dist.status === "ok" ? dist.groups : []
    status = "ok"
  }

  const byId = new Map(selected.map((d) => [d.id, d]))
  const groupOf = new Map<string, string>()
  for (const g of groups) for (const id of g.ids) groupOf.set(id, `c:${g.key}`)

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
  if (presentKeys.has(KNOWLEDGE_UNGROUPED_KEY)) {
    labels[KNOWLEDGE_UNGROUPED_KEY] = { name: "未分组", ai: false }
  }

  return { status, truncated: docs.length > KNOWLEDGE_GRAPH_DOC_CAP, nodes, edges, labels, labelTargets }
}

/**
 * 边现算（spec §5）：对每节点跑 scoreRelatedKnowledge，score>0 者按分降序、
 * 平局 id 字典序取 top-K；无向对称去重（a<b 字典序只留一条）；输出按 (a,b) 排序。
 * 权重/语料不改（改动会触发 wikilinks 同源评测重证，spec §6）。
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

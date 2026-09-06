// #296 knowledge.graph wire contract (spec §5). UI-only: parse + request builder.
// Server lane owns computation; this module is fail-closed on unknown shapes.

import type { KnowledgeGraphStatus } from "./copy"

export type KnowledgeGraphNode = {
  id: string
  title: string
  group_key: string
  folder: string
}

export type KnowledgeGraphEdge = {
  a: string
  b: string
  score: number
}

export type KnowledgeGraphLabel = {
  name: string
  summary?: string
  ai: boolean
  /** #427：锁 overlay 成员（可选；旧帧无此字段）。 */
  locked?: boolean
}

export type KnowledgeGraphRelation = {
  a: string
  b: string
  reason: string
  confidence: number
  ai: true
}

export type KnowledgeGraphPayload = {
  status: KnowledgeGraphStatus
  truncated: boolean
  nodes: KnowledgeGraphNode[]
  edges: KnowledgeGraphEdge[]
  labels: Record<string, KnowledgeGraphLabel>
  /** #356: error 态的服务端错误说明（可选；展示用，不进 parse 硬门）。 */
  error?: string
  /** #427：LLM 洞察边（仅 2–19 lane；旧帧/≥20 无此字段）。 */
  relations?: KnowledgeGraphRelation[]
  /** #427：无 LLM 配置时为 false；缺省视为 true（旧 companion 不砖 CTA）。 */
  llm_ready?: boolean
  /** #427：organize 失败文案；status 仍 ok，画布保留。 */
  organize_error?: string
  /** #427：graph_llm 指纹已漂。 */
  stale?: boolean
  /** #427：跨 20 一次性 banner。 */
  tf_switch_notice?: boolean
  /** #427：锁组缩到 <2 解散。 */
  lock_dissolved?: boolean
}

const STATUSES = new Set<KnowledgeGraphStatus>(["ok", "too_few", "over_cap", "rebuilding", "error"])

function asString(v: unknown): string {
  return typeof v === "string" ? v : ""
}

function parseNode(raw: unknown): KnowledgeGraphNode | null {
  if (!raw || typeof raw !== "object") return null
  const n = raw as Record<string, unknown>
  const id = asString(n.id)
  if (!id) return null
  return {
    id,
    title: asString(n.title),
    group_key: asString(n.group_key),
    folder: asString(n.folder),
  }
}

function parseEdge(raw: unknown): KnowledgeGraphEdge | null {
  if (!raw || typeof raw !== "object") return null
  const e = raw as Record<string, unknown>
  const a = asString(e.a)
  const b = asString(e.b)
  if (!a || !b) return null
  const score = typeof e.score === "number" && Number.isFinite(e.score) ? e.score : 0
  return { a, b, score }
}

function parseLabel(raw: unknown): KnowledgeGraphLabel | null {
  if (!raw || typeof raw !== "object") return null
  const l = raw as Record<string, unknown>
  const name = asString(l.name)
  if (!name) return null
  const out: KnowledgeGraphLabel = { name, ai: l.ai === true }
  if (typeof l.summary === "string" && l.summary) out.summary = l.summary
  if (l.locked === true) out.locked = true
  return out
}

function parseRelation(raw: unknown): KnowledgeGraphRelation | null {
  if (!raw || typeof raw !== "object") return null
  const r = raw as Record<string, unknown>
  const a = asString(r.a)
  const b = asString(r.b)
  const reason = asString(r.reason).trim()
  if (!a || !b || a === b || !reason) return null
  const confidence =
    typeof r.confidence === "number" && Number.isFinite(r.confidence)
      ? Math.min(1, Math.max(0, r.confidence))
      : 0
  return { a, b, reason, confidence, ai: true }
}

/** 无向对键，TF 边与 relation 对齐用。 */
export function knowledgeGraphPairKey(a: string, b: string): string {
  return a < b ? `${a}\0${b}` : `${b}\0${a}`
}

/** 已有 LLM 分组或洞察边 → 视为有整理缓存（不再出 CTA）。 */
export function hasKnowledgeGraphLlmCache(p: KnowledgeGraphPayload): boolean {
  if ((p.relations?.length ?? 0) > 0) return true
  return p.nodes.some((n) => (n.group_key || "").startsWith("l:"))
}

export function parseKnowledgeGraphPayload(raw: unknown): KnowledgeGraphPayload | null {
  if (!raw || typeof raw !== "object") return null
  const o = raw as Record<string, unknown>
  if (typeof o.status !== "string" || !STATUSES.has(o.status as KnowledgeGraphStatus)) return null
  const nodesIn = Array.isArray(o.nodes) ? o.nodes : []
  const edgesIn = Array.isArray(o.edges) ? o.edges : []
  const labelsIn = o.labels && typeof o.labels === "object" ? (o.labels as Record<string, unknown>) : {}
  const nodes: KnowledgeGraphNode[] = []
  for (const n of nodesIn) {
    const p = parseNode(n)
    if (p) nodes.push(p)
  }
  const edges: KnowledgeGraphEdge[] = []
  for (const e of edgesIn) {
    const p = parseEdge(e)
    if (p) edges.push(p)
  }
  const labels: Record<string, KnowledgeGraphLabel> = {}
  for (const [k, v] of Object.entries(labelsIn)) {
    const p = parseLabel(v)
    if (p) labels[k] = p
  }
  const relationsIn = Array.isArray(o.relations) ? o.relations : null
  const relations: KnowledgeGraphRelation[] = []
  if (relationsIn) {
    for (const r of relationsIn) {
      const p = parseRelation(r)
      if (p) relations.push(p)
    }
  }
  return {
    status: o.status as KnowledgeGraphStatus,
    truncated: o.truncated === true,
    nodes,
    edges,
    labels,
    ...(typeof o.error === "string" && o.error ? { error: o.error } : {}),
    ...(relationsIn ? { relations } : {}),
    ...(typeof o.llm_ready === "boolean" ? { llm_ready: o.llm_ready } : {}),
    ...(typeof o.organize_error === "string" && o.organize_error
      ? { organize_error: o.organize_error }
      : {}),
    ...(o.stale === true ? { stale: true } : {}),
    ...(typeof o.tf_switch_notice === "boolean" ? { tf_switch_notice: o.tf_switch_notice } : {}),
    ...(o.lock_dissolved === true ? { lock_dissolved: true } : {}),
  }
}

export function mockKnowledgeGraphPayload(
  partial: Partial<KnowledgeGraphPayload> & Pick<KnowledgeGraphPayload, "status">,
): KnowledgeGraphPayload {
  return {
    status: partial.status,
    truncated: partial.truncated === true,
    nodes: partial.nodes ? [...partial.nodes] : [],
    edges: partial.edges ? [...partial.edges] : [],
    labels: partial.labels ? { ...partial.labels } : {},
    ...(typeof partial.error === "string" && partial.error ? { error: partial.error } : {}),
    ...(partial.relations ? { relations: [...partial.relations] } : {}),
    ...(typeof partial.llm_ready === "boolean" ? { llm_ready: partial.llm_ready } : {}),
    ...(typeof partial.organize_error === "string" && partial.organize_error
      ? { organize_error: partial.organize_error }
      : {}),
    ...(partial.stale === true ? { stale: true } : {}),
    ...(typeof partial.tf_switch_notice === "boolean"
      ? { tf_switch_notice: partial.tf_switch_notice }
      : {}),
    ...(partial.lock_dissolved === true ? { lock_dissolved: true } : {}),
  }
}

export type KnowledgeGraphRequest = {
  type: "knowledge.graph"
  llm_labels?: true
  regen_labels?: true
  id?: string
  organize?: true
  user_gesture?: true
  lock_group?: string
  unlock_group?: string
  ack_tf_switch?: true
}

export function buildKnowledgeGraphRequest(opts: {
  llmLabels: boolean
  regenerate?: boolean
  /** #374: 请求 id（companion 对响应回带 id，error 帧据此精确关联）。可选，缺省不带。 */
  id?: string
  /** #427：手动整理。与 user_gesture 成对。 */
  organize?: boolean
  lockGroup?: string
  unlockGroup?: string
  ackTfSwitch?: boolean
}): KnowledgeGraphRequest {
  // Wire 契约权威在服务端（#296 server lane）：强制重生成字段是 regen_labels。
  const req: KnowledgeGraphRequest = { type: "knowledge.graph" }
  if (opts.id) req.id = opts.id
  if (opts.llmLabels) req.llm_labels = true
  if (opts.regenerate) req.regen_labels = true
  if (opts.organize) {
    req.organize = true
    req.user_gesture = true
  }
  if (opts.lockGroup) {
    req.lock_group = opts.lockGroup
    req.user_gesture = true
  }
  if (opts.unlockGroup) {
    req.unlock_group = opts.unlockGroup
    req.user_gesture = true
  }
  if (opts.ackTfSwitch) {
    req.ack_tf_switch = true
    req.user_gesture = true
  }
  return req
}

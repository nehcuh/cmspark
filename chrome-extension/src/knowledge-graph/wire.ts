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
}

export type KnowledgeGraphPayload = {
  status: KnowledgeGraphStatus
  truncated: boolean
  nodes: KnowledgeGraphNode[]
  edges: KnowledgeGraphEdge[]
  labels: Record<string, KnowledgeGraphLabel>
}

const STATUSES = new Set<KnowledgeGraphStatus>(["ok", "too_few", "over_cap", "rebuilding"])

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
  return out
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
  return {
    status: o.status as KnowledgeGraphStatus,
    truncated: o.truncated === true,
    nodes,
    edges,
    labels,
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
  }
}

export function buildKnowledgeGraphRequest(opts: {
  llmLabels: boolean
  regenerate?: boolean
}): { type: "knowledge.graph"; llm_labels?: true; regenerate?: true } {
  const req: { type: "knowledge.graph"; llm_labels?: true; regenerate?: true } = {
    type: "knowledge.graph",
  }
  if (opts.llmLabels) req.llm_labels = true
  if (opts.regenerate) req.regenerate = true
  return req
}

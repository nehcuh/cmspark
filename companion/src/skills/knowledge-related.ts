// Query-time knowledge relatedness (Wave 2) — copy thread related.ts, no persist / no graph DB.
// Spec: docs/superpowers/specs/2026-08-25-daily-assistant-knowledge-honesty-design.md Wave 2

import { tokenize, tokensToVec, cosineSimilarity } from "./semantic-match"

export const KNOWLEDGE_RELATED_W_CO_TAG = 3.0
export const KNOWLEDGE_RELATED_W_TF = 1.5
export const KNOWLEDGE_RELATED_TF_MIN = 0.08
export const KNOWLEDGE_RELATED_LIMIT = 3

export type RelatedKnowledgeInput = {
  id: string
  name?: string
  title?: string
  description?: string
  tags?: string[]
}

export type RelatedKnowledgeHit = {
  id: string
  title: string
  score: number
  shared_tags: string[]
}

function tagSet(d: RelatedKnowledgeInput): Set<string> {
  const tags = d.tags
  if (!Array.isArray(tags)) return new Set()
  return new Set(tags.map((x) => String(x).toLowerCase()).filter(Boolean))
}

function textBlob(d: RelatedKnowledgeInput): string {
  return [d.title || d.name, d.description, ...(d.tags || [])].filter(Boolean).join(" ")
}

export function scoreRelatedKnowledge(
  seed: RelatedKnowledgeInput,
  other: RelatedKnowledgeInput,
): RelatedKnowledgeHit {
  const a = tagSet(seed)
  const b = tagSet(other)
  const shared: string[] = []
  for (const t of a) if (b.has(t)) shared.push(t)
  const union = new Set([...a, ...b])
  const jaccard = union.size === 0 ? 0 : shared.length / union.size
  const coTag = jaccard * KNOWLEDGE_RELATED_W_CO_TAG

  let tf = 0
  const ta = textBlob(seed)
  const tb = textBlob(other)
  if (ta && tb) {
    const cos = cosineSimilarity(tokensToVec(tokenize(ta)), tokensToVec(tokenize(tb)))
    if (cos >= KNOWLEDGE_RELATED_TF_MIN) tf = cos * KNOWLEDGE_RELATED_W_TF
  }

  const id = other.id || other.name || ""
  return {
    id,
    title: String(other.title || other.name || id),
    score: coTag + tf,
    shared_tags: shared.slice(0, 8),
  }
}

export function attachRelatedTitles<T extends RelatedKnowledgeInput>(
  docs: T[],
): Array<T & { related: Array<{ id: string; title: string }> }> {
  return docs.map((d) => {
    const seed = d.id || d.name || ""
    const hits = seed ? findRelatedKnowledge(seed, docs, KNOWLEDGE_RELATED_LIMIT) : []
    return {
      ...d,
      related: hits.map((h) => ({ id: h.id, title: h.title })),
    }
  })
}

export function findRelatedKnowledge(
  seedId: string,
  docs: RelatedKnowledgeInput[],
  limit = KNOWLEDGE_RELATED_LIMIT,
): RelatedKnowledgeHit[] {
  const seed = docs.find((d) => d.id === seedId || d.name === seedId)
  if (!seed) return []
  const hits: RelatedKnowledgeHit[] = []
  for (const d of docs) {
    const id = d.id || d.name || ""
    if (!id || id === (seed.id || seed.name)) continue
    const hit = scoreRelatedKnowledge(seed, d)
    if (hit.score <= 0) continue
    hits.push(hit)
  }
  hits.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
  return hits.slice(0, Math.max(0, Math.min(KNOWLEDGE_RELATED_LIMIT, limit)))
}

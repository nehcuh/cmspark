// Thread relatedness (Wave C) — pure local, no LLM / no graph DB.
// Spec: docs/superpowers/specs/2026-08-11-thread-history-ia-gap-optimization-adversarial.md §Wave C
// Signal weights are code constants (S9), not user settings.

import { tokenize, tokensToVec, cosineSimilarity } from "../skills/semantic-match"

/** Code constants — dual-review pin S9. */
export const RELATED_W_CO_TAG = 3.0
export const RELATED_W_TF = 1.5
export const RELATED_W_TIME = 0.5
/** Soft edge TF threshold (below → no TF contribution). */
export const RELATED_TF_MIN = 0.08
/** Days for weak time proximity bonus. */
export const RELATED_TIME_WINDOW_DAYS = 7

export interface RelatedThreadInput {
  id: string
  alias?: string
  updated_at?: string
  created_at?: string
  digest?: {
    tldr?: string
    tags?: string[]
    bullets?: string[]
  } | null
  agent_role?: string
  trashed_at?: string | null
}

export interface RelatedHit {
  thread_id: string
  score: number
  signals: { co_tag: number; tf: number; time: number }
  shared_tags: string[]
}

function tagSet(t: RelatedThreadInput): Set<string> {
  const tags = t.digest?.tags
  if (!Array.isArray(tags)) return new Set()
  return new Set(tags.map((x) => String(x).toLowerCase()).filter(Boolean))
}

function textBlob(t: RelatedThreadInput): string {
  const d = t.digest
  if (!d) return ""
  const parts: string[] = []
  if (d.tldr) parts.push(String(d.tldr))
  if (Array.isArray(d.bullets)) parts.push(...d.bullets.map(String))
  if (Array.isArray(d.tags)) parts.push(...d.tags.map(String))
  return parts.join(" ")
}

function updatedMs(t: RelatedThreadInput): number {
  const raw = t.updated_at || t.created_at
  if (!raw) return 0
  const n = new Date(raw).getTime()
  return Number.isFinite(n) ? n : 0
}

/**
 * Score how related `other` is to `seed`. Higher = more related.
 * @ edges deferred (C.1b) — not used.
 */
export function scoreRelatedPair(seed: RelatedThreadInput, other: RelatedThreadInput): RelatedHit {
  const a = tagSet(seed)
  const b = tagSet(other)
  const shared: string[] = []
  for (const t of a) if (b.has(t)) shared.push(t)
  const union = new Set([...a, ...b])
  const jaccard = union.size === 0 ? 0 : shared.length / union.size
  const coTag = jaccard * RELATED_W_CO_TAG

  let tf = 0
  const ta = textBlob(seed)
  const tb = textBlob(other)
  if (ta && tb) {
    const cos = cosineSimilarity(tokensToVec(tokenize(ta)), tokensToVec(tokenize(tb)))
    if (cos >= RELATED_TF_MIN) tf = cos * RELATED_W_TF
  }

  let time = 0
  const ma = updatedMs(seed)
  const mb = updatedMs(other)
  if (ma > 0 && mb > 0) {
    const days = Math.abs(ma - mb) / 86400_000
    if (days <= RELATED_TIME_WINDOW_DAYS) {
      time = (1 - days / RELATED_TIME_WINDOW_DAYS) * RELATED_W_TIME
    }
  }

  const score = coTag + tf + time
  return {
    thread_id: other.id,
    score,
    signals: { co_tag: coTag, tf, time },
    shared_tags: shared.slice(0, 8),
  }
}

/**
 * Top-K related threads for seed (excludes self, trashed, zero-score).
 */
export function findRelatedThreads(
  seedId: string,
  threads: RelatedThreadInput[],
  limit = 5,
): RelatedHit[] {
  const seed = threads.find((t) => t.id === seedId)
  if (!seed || seed.trashed_at) return []
  const hits: RelatedHit[] = []
  for (const t of threads) {
    if (!t?.id || t.id === seedId) continue
    if (t.trashed_at) continue
    const hit = scoreRelatedPair(seed, t)
    if (hit.score <= 0) continue
    hits.push(hit)
  }
  hits.sort((a, b) => b.score - a.score || a.thread_id.localeCompare(b.thread_id))
  return hits.slice(0, Math.max(0, Math.min(20, limit)))
}

/**
 * Build undirected edges for graph popup: co-tag hard edges + soft TF above threshold.
 * Nodes = thread ids with at least one edge or all with digests (caller filters).
 */
export function buildRelatedEdges(
  threads: RelatedThreadInput[],
  opts?: { minScore?: number; maxEdges?: number },
): Array<{ a: string; b: string; score: number; shared_tags: string[] }> {
  const live = threads.filter((t) => t?.id && !t.trashed_at)
  const minScore = opts?.minScore ?? 0.15
  const maxEdges = opts?.maxEdges ?? 200
  const edges: Array<{ a: string; b: string; score: number; shared_tags: string[] }> = []
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const hit = scoreRelatedPair(live[i], live[j])
      if (hit.score < minScore) continue
      edges.push({
        a: live[i].id,
        b: live[j].id,
        score: hit.score,
        shared_tags: hit.shared_tags,
      })
    }
  }
  edges.sort((x, y) => y.score - x.score)
  return edges.slice(0, maxEdges)
}

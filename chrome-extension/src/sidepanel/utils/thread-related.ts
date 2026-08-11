// Client-side thread relatedness (Wave C) — mirrors companion/src/threads/related.ts
// Pure local; no LLM. Weights are code constants (S9).

/** Code constants — dual-review pin S9. */
export const RELATED_W_CO_TAG = 3.0
export const RELATED_W_TF = 1.5
export const RELATED_W_TIME = 0.5
export const RELATED_TF_MIN = 0.08
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
    stale?: boolean
  } | null
  agent_role?: string
  trashed_at?: string | null
  first_user_preview?: string
}

export interface RelatedHit {
  thread_id: string
  score: number
  signals: { co_tag: number; tf: number; time: number }
  shared_tags: string[]
}

// Align with companion/src/skills/semantic-match.ts (reduce client/server ranking skew).
const CJK_RE = /[\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]/
const STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from",
  "has", "he", "in", "is", "it", "its", "of", "on", "that", "the",
  "to", "was", "will", "with", "this", "but", "they", "have",
  "use", "can", "get", "make", "go", "do",
])

function tokenize(text: string): string[] {
  if (!text) return []
  const lower = text
    .toLowerCase()
    .replace(/[^\w\s\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]/g, " ")
  const out: string[] = []
  for (const seg of lower.split(/\s+/)) {
    if (!seg) continue
    if (CJK_RE.test(seg)) {
      let i = 0
      while (i < seg.length) {
        if (i + 1 < seg.length) {
          const two = seg.slice(i, i + 2)
          if (/^[\u4e00-\u9fff]{2}$/.test(two)) {
            out.push(two)
            i += 1
            continue
          }
        }
        out.push(seg[i])
        i += 1
      }
    } else if (!STOP_WORDS.has(seg) && seg.length > 0) {
      out.push(seg)
    }
  }
  return out
}

function tokensToVec(tokens: string[]): Record<string, number> {
  if (tokens.length === 0) return {}
  const counts: Record<string, number> = {}
  for (const t of tokens) counts[t] = (counts[t] || 0) + 1
  const total = tokens.length
  const vec: Record<string, number> = {}
  for (const [k, v] of Object.entries(counts)) vec[k] = v / total
  return vec
}

function cosineSimilarity(a: Record<string, number>, b: Record<string, number>): number {
  let dot = 0
  let na = 0
  let nb = 0
  for (const k of Object.keys(a)) {
    na += a[k] * a[k]
    if (b[k] !== undefined) dot += a[k] * b[k]
  }
  for (const k of Object.keys(b)) nb += b[k] * b[k]
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
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

  return {
    thread_id: other.id,
    score: coTag + tf + time,
    signals: { co_tag: coTag, tf, time },
    shared_tags: shared.slice(0, 8),
  }
}

export function findRelatedThreads(
  seedId: string,
  threads: RelatedThreadInput[],
  limit = 3,
): RelatedHit[] {
  const seed = threads.find((t) => t.id === seedId)
  if (!seed || seed.trashed_at) return []
  const hits: RelatedHit[] = []
  for (const t of threads) {
    if (!t?.id || t.id === seedId || t.trashed_at) continue
    const hit = scoreRelatedPair(seed, t)
    if (hit.score <= 0) continue
    hits.push(hit)
  }
  hits.sort((a, b) => b.score - a.score || a.thread_id.localeCompare(b.thread_id))
  return hits.slice(0, Math.max(0, Math.min(20, limit)))
}

export type RelatedEdgeKind = "hard" | "soft"

export type RelatedEdge = {
  a: string
  b: string
  score: number
  shared_tags: string[]
  /** hard = at least one shared tag; soft = TF/time only (dual-review nit). */
  kind: RelatedEdgeKind
}

/**
 * Build undirected relatedness edges for graph view.
 * Full-page graph uses maxEdges=200 (canvas); side-panel related-3 stays on findRelatedThreads.
 */
export function buildRelatedEdges(
  threads: RelatedThreadInput[],
  opts?: { minScore?: number; maxEdges?: number },
): RelatedEdge[] {
  const live = threads.filter((t) => t?.id && !t.trashed_at)
  const minScore = opts?.minScore ?? 0.15
  // Full-page canvas can show more edges than the old side-panel list (80).
  const maxEdges = opts?.maxEdges ?? 200
  const edges: RelatedEdge[] = []
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const hit = scoreRelatedPair(live[i], live[j])
      if (hit.score < minScore) continue
      edges.push({
        a: live[i].id,
        b: live[j].id,
        score: hit.score,
        shared_tags: hit.shared_tags,
        kind: hit.shared_tags.length > 0 ? "hard" : "soft",
      })
    }
  }
  edges.sort((x, y) => y.score - x.score)
  return edges.slice(0, maxEdges)
}

/** Lint counts for cleanup assistant (C-4). O(n²) edge build once, not per node. */
export function digestLintStats(threads: RelatedThreadInput[]): {
  untagged: number
  stale: number
  isolated: number
} {
  const live = threads.filter((t) => t?.id && !t.trashed_at)
  let untagged = 0
  let stale = 0
  for (const t of live) {
    const tags = t.digest?.tags
    if (!t.digest || !tags || tags.length === 0) untagged++
    if (t.digest?.stale) stale++
  }
  // Degree from one edge pass (minScore low so soft links count as non-isolated).
  const degree = new Map<string, number>()
  for (const t of live) degree.set(t.id, 0)
  const edges = buildRelatedEdges(live, { minScore: 0.05, maxEdges: 5000 })
  for (const e of edges) {
    degree.set(e.a, (degree.get(e.a) || 0) + 1)
    degree.set(e.b, (degree.get(e.b) || 0) + 1)
  }
  let isolated = 0
  for (const t of live) {
    if ((degree.get(t.id) || 0) === 0) isolated++
  }
  return { untagged, stale, isolated }
}

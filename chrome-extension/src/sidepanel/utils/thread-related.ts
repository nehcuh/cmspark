import {
  buildRelatedEdges as rankEdges,
  findRelatedThreads as rankThreads,
  scoreRelatedPair as rankPair,
  type RelatedHit,
  inRelatedPool,
  type RelatedThreadInput as RankedThread,
} from "../../shared/threads/related"

export {
  RELATED_W_CO_TAG, RELATED_W_TF, RELATED_W_TIME, RELATED_TF_MIN, RELATED_TIME_WINDOW_DAYS,
  type RelatedHit,
} from "../../shared/threads/related"

export interface RelatedThreadInput extends RankedThread {
  digest?: (NonNullable<RankedThread["digest"]> & { stale?: boolean }) | null
  first_user_preview?: string | null
}

export const scoreRelatedPair: (seed: RelatedThreadInput, other: RelatedThreadInput) => RelatedHit = rankPair

export function findRelatedThreads(seedId: string, threads: RelatedThreadInput[], limit = 3) {
  return rankThreads(seedId, threads, limit)
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

export function buildRelatedEdges(
  threads: RelatedThreadInput[],
  opts?: { minScore?: number; maxEdges?: number },
): RelatedEdge[] {
  return rankEdges(threads, opts).map(edge => ({
    ...edge,
    kind: edge.shared_tags.length > 0 ? "hard" : "soft",
  }))
}

/** Lint counts for cleanup assistant (C-4). O(n²) edge build once, not per node. */
export function digestLintStats(threads: RelatedThreadInput[]): {
  untagged: number
  stale: number
  isolated: number
} {
  const live = threads.filter(inRelatedPool)
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

/**
 * #260 embedding diarize — pure clustering on speaker embeddings (anonymous 发言人N).
 * SoT: docs/superpowers/specs/2026-09-04-meeting-embedding-diarize.md
 *
 * Deterministic: agglomerative average-linkage on cosine distance with
 * index-ordered tie-breaking; relabel by first appearance (发言人1 = earliest).
 * Auto-K = threshold cut (spec §4 DIARIZE_CLUSTER_THRESHOLD, calibrated on
 * scripts/diarize-eval) — silhouette under-splits thin-margin same-gender
 * speakers (eval 2026-09-04: silhouette K=2 on truth-K3, countAcc 0.500).
 * No model, no IO — the ONNX embedding extractor lives in diarize-embed.ts.
 */

import {
  DIARIZE_K_MAX,
  DIARIZE_K_MIN,
  clampDiarizeK,
  diarizeLabel,
  type DiarizeResult,
} from "./auto-diarize"
import type { TranscriptLine } from "./meeting-store"

/**
 * Auto-K merge threshold on average-linkage cosine distance (spec §4).
 * Calibrated 2026-09-04 on scripts/diarize-eval synthetic set: intra-speaker
 * distance ≈ 0.03, adversarial same-gender cross-speaker ≈ 0.074, distinct
 * cross-speaker ≥ 0.2 → 0.06 splits both. NOT over-split-free: the
 * calibration set still over-splits long alternation runs (long10-K2→4,
 * long10-K5→6) — count accuracy pays; the round-2 held-out gate bounds
 * this (|k−truth| ≤ 1 per fixture before experimental can come off).
 */
export const DIARIZE_CLUSTER_THRESHOLD = 0.06

/** Cosine distance (1 − cosine similarity). Zero-norm → 1 (similarity undefined). */
export function cosineDistance(a: number[], b: number[]): number {
  let dot = 0
  let na = 0
  let nb = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    dot += x * y
    na += x * x
    nb += y * y
  }
  if (!(na > 0) || !(nb > 0)) return 1
  const d = 1 - dot / Math.sqrt(na * nb)
  return Number.isFinite(d) ? Math.min(2, Math.max(0, d)) : 1
}

/** Sanitize an embedding row: finite numbers only, pad/truncate to a common dim later. */
function sanitizeRows(rows: number[][]): number[][] {
  return rows.map((r) =>
    (Array.isArray(r) ? r : []).map((v) => (Number.isFinite(v) ? (v as number) : 0)),
  )
}

/** Merge candidate: cluster list indices + average-linkage distance. */
type MergePair = { a: number; b: number; d: number }

/**
 * Best (smallest) average-linkage merge among clusters. Deterministic:
 * ties resolve by index order (cluster key = min member index).
 */
function bestMergePair(clusters: number[][], rows: number[][]): MergePair {
  let bestD = Infinity
  let bestA = -1
  let bestB = -1
  for (let i = 0; i < clusters.length; i++) {
    for (let j = i + 1; j < clusters.length; j++) {
      const a = clusters[i]!
      const b = clusters[j]!
      let s = 0
      for (const x of a) for (const y of b) s += cosineDistance(rows[x]!, rows[y]!)
      const d = s / (a.length * b.length)
      const keyI = a[0]!
      const keyJ = b[0]!
      if (
        d < bestD - 1e-12 ||
        (Math.abs(d - bestD) <= 1e-12 && (bestA < 0 || keyI < clusters[bestA]![0]!))
      ) {
        bestD = d
        bestA = i
        bestB = j
      }
    }
  }
  return { a: bestA, b: bestB, d: bestD }
}

function applyMerge(clusters: number[][], m: MergePair): number[][] {
  const merged = [...clusters[m.a]!, ...clusters[m.b]!].sort((x, y) => x - y)
  const next = clusters.filter((_, idx) => idx !== m.a && idx !== m.b)
  next.push(merged)
  next.sort((a, b) => a[0]! - b[0]!)
  return next
}

/**
 * Deterministic agglomerative clustering (average linkage, cosine distance):
 * merge until exactly k clusters. Same greedy sequence as autoKByThreshold's
 * cut, so a threshold cut at count k yields the identical partition.
 * Returns cluster id per row, ids 0..k-1 in first-appearance order.
 */
export function agglomerativeCluster(embeddings: number[][], k: number): number[] {
  const rows = sanitizeRows(embeddings)
  const n = rows.length
  if (n === 0) return []
  const kk = Math.min(Math.max(1, Math.floor(k)), n)

  let clusters: number[][] = rows.map((_, i) => [i])
  while (clusters.length > kk) {
    const m = bestMergePair(clusters, rows)
    if (m.a < 0) break
    clusters = applyMerge(clusters, m)
  }

  // Relabel by first appearance: the cluster containing row 0 gets id 0, etc.
  const idOf = new Map<number, number>()
  const assign = new Array<number>(n)
  for (let i = 0; i < n; i++) {
    const home = clusters.find((c) => c.includes(i))
    const key = home ? home[0]! : i
    if (!idOf.has(key)) idOf.set(key, idOf.size)
    assign[i] = idOf.get(key)!
  }
  return assign
}

/**
 * Auto speaker count by threshold cut: keep merging while the smallest
 * average-linkage distance is below the threshold; stop at the natural cut.
 * Clamped to [DIARIZE_K_MIN, DIARIZE_K_MAX] (floor merges are refused, ceiling
 * forces merges past the cut).
 */
export function autoKByThreshold(
  embeddings: number[][],
  threshold: number = DIARIZE_CLUSTER_THRESHOLD,
): number {
  const rows = sanitizeRows(embeddings)
  const n = rows.length
  if (n <= 1) return n
  let clusters: number[][] = rows.map((_, i) => [i])
  while (clusters.length > 1) {
    if (clusters.length <= DIARIZE_K_MIN) break
    const m = bestMergePair(clusters, rows)
    if (m.a < 0) break
    if (clusters.length <= DIARIZE_K_MAX && m.d >= threshold) break
    clusters = applyMerge(clusters, m)
  }
  return clusters.length
}

/**
 * Embedding diarize: one embedding row per transcript line (anonymous labels).
 * kIn=0/"auto" → auto-K by threshold cut; result.auto set.
 */
export function diarizeByEmbeddings(
  lines: TranscriptLine[],
  embeddings: number[][],
  kIn?: number,
): DiarizeResult {
  const n = lines.length
  const rows: number[][] = []
  for (let i = 0; i < n; i++) {
    const r = embeddings[i]
    rows.push(
      Array.isArray(r)
        ? r.map((v) => (Number.isFinite(v) ? (v as number) : 0))
        : new Array<number>(Math.max(1, embeddings.find((x) => Array.isArray(x))?.length ?? 1)).fill(0),
    )
  }
  const kInN = clampDiarizeK(kIn)
  const auto = kInN === 0
  const k = auto ? autoKByThreshold(rows) : kInN
  const clusters = agglomerativeCluster(rows, Math.min(k, Math.max(1, n)))
  const speakers = clusters.map((c) => diarizeLabel(c))
  const distinct = Array.from(new Set(clusters)).sort((a, b) => a - b)
  const labels = distinct.map((c) => diarizeLabel(c))
  return {
    method: "embedding",
    k: labels.length,
    labels,
    speakers,
    // Round-2 held-out gate FAILED 2026-09-05 (scripts/diarize-eval): fresh
    // speaker profiles — countAcc 0.667 < 0.75, over-split held-long12-K3 k=5
    // (truth 3), legacy countAcc 0.833 ≥ ours. Calibration-set PASS did not
    // generalize → experimental goes back ON until held-out gate passes.
    experimental: true,
    ...(auto ? { auto: true as const } : {}),
  }
}

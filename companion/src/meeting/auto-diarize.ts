/**
 * Mtg3.0 local speaker tagging — k-means on segment features (NOT identity).
 * SoT: docs/superpowers/specs/2026-08-08-meeting-mtg3-diarize-design.md
 */

import type { TranscriptLine } from "./meeting-store"

export const DIARIZE_LABEL_PREFIX = "发言人"
export const DIARIZE_K_MIN = 2
export const DIARIZE_K_MAX = 4
export const DIARIZE_K_DEFAULT = 2

/** Feature vector: [logEnergy, zcr, spectralCentroidNorm] */
export type DiarizeFeature = [number, number, number]

export type DiarizeMethod = "audio_cluster" | "text_gap"

export type DiarizeResult = {
  method: DiarizeMethod
  k: number
  labels: string[]
  /** speaker per input line index (same length as lines/features) */
  speakers: Array<string | undefined>
  experimental: true
}

export function clampDiarizeK(k: unknown): number {
  const n = typeof k === "number" && Number.isFinite(k) ? Math.floor(k) : DIARIZE_K_DEFAULT
  return Math.min(DIARIZE_K_MAX, Math.max(DIARIZE_K_MIN, n))
}

export function diarizeLabel(index0: number): string {
  return `${DIARIZE_LABEL_PREFIX}${index0 + 1}`
}

/** Euclidean distance. */
function dist(a: number[], b: number[]): number {
  let s = 0
  for (let i = 0; i < a.length; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0)
    s += d * d
  }
  return Math.sqrt(s)
}

/**
 * k-means on rows of features. Deterministic init: spread along first dim sort.
 * Returns cluster id 0..k-1 per row.
 */
export function kMeansCluster(
  features: number[][],
  k: number,
  maxIter = 40,
): number[] {
  const n = features.length
  if (n === 0) return []
  const kk = Math.min(k, n)
  if (kk <= 1) return new Array(n).fill(0)

  const dim = features[0]!.length
  // init centroids: quantiles along feature 0
  const order = features
    .map((f, i) => ({ i, v: f[0] ?? 0 }))
    .sort((a, b) => a.v - b.v)
  const centroids: number[][] = []
  for (let c = 0; c < kk; c++) {
    const idx = order[Math.min(n - 1, Math.floor(((c + 0.5) * n) / kk))]!.i
    centroids.push(features[idx]!.slice())
  }

  let assign = new Array(n).fill(0)
  for (let iter = 0; iter < maxIter; iter++) {
    let changed = false
    for (let i = 0; i < n; i++) {
      let best = 0
      let bestD = Infinity
      for (let c = 0; c < kk; c++) {
        const d = dist(features[i]!, centroids[c]!)
        if (d < bestD) {
          bestD = d
          best = c
        }
      }
      if (assign[i] !== best) {
        assign[i] = best
        changed = true
      }
    }
    // recompute
    const sums = Array.from({ length: kk }, () => new Array(dim).fill(0))
    const counts = new Array(kk).fill(0)
    for (let i = 0; i < n; i++) {
      const c = assign[i]!
      counts[c]++
      for (let d = 0; d < dim; d++) sums[c]![d] += features[i]![d] ?? 0
    }
    for (let c = 0; c < kk; c++) {
      if (counts[c] === 0) continue
      for (let d = 0; d < dim; d++) {
        centroids[c]![d] = sums[c]![d]! / counts[c]
      }
    }
    if (!changed) break
  }

  // Relabel clusters by centroid energy (feature 0) so 发言人1 ≈ louder/first
  const clusterOrder = centroids
    .map((c, i) => ({ i, v: c[0] ?? 0 }))
    .sort((a, b) => b.v - a.v)
  const remap = new Map<number, number>()
  clusterOrder.forEach((c, newId) => remap.set(c.i, newId))
  return assign.map((a) => remap.get(a) ?? a)
}

/**
 * Audio-cluster diarize: one feature row per transcript line.
 * features.length must equal lines.length (pad/truncate handled).
 */
export function diarizeByAudioFeatures(
  lines: TranscriptLine[],
  features: number[][],
  kIn?: number,
): DiarizeResult {
  const k = clampDiarizeK(kIn)
  const n = lines.length
  const feats: number[][] = []
  for (let i = 0; i < n; i++) {
    const f = features[i]
    if (Array.isArray(f) && f.length >= 3) {
      const a = Number(f[0])
      const b = Number(f[1])
      const c = Number(f[2])
      if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c)) {
        feats.push([0, 0, 0])
      } else {
        feats.push([a, b, c])
      }
    } else {
      // Malformed row → zero vector (caller should keep alignment; observability only)
      feats.push([0, 0, 0])
    }
  }
  const clusters = kMeansCluster(feats, Math.min(k, Math.max(1, n)))
  const speakers = clusters.map((c) => diarizeLabel(c))
  const labels = Array.from({ length: Math.min(k, n) }, (_, i) => diarizeLabel(i))
  return {
    method: "audio_cluster",
    k: labels.length,
    labels,
    speakers,
    experimental: true,
  }
}

/**
 * Weak text-gap mode: after silence-cut lines, alternate speakers on each line.
 * Honest: NOT acoustic diarize — only for explicit user choice.
 */
export function diarizeByTextGap(lines: TranscriptLine[], kIn?: number): DiarizeResult {
  const k = clampDiarizeK(kIn)
  const speakers = lines.map((_, i) => diarizeLabel(i % k))
  const labels = Array.from({ length: k }, (_, i) => diarizeLabel(i))
  return {
    method: "text_gap",
    k,
    labels,
    speakers,
    experimental: true,
  }
}

/**
 * Apply diarize speakers onto lines (preserves text/source/timing).
 * preserveManual: keep existing non-auto labels (not matching 发言人N).
 */
export function applyDiarizeToLines(
  lines: TranscriptLine[],
  result: DiarizeResult,
  opts: { preserveManual?: boolean } = {},
): TranscriptLine[] {
  const autoRe = /^发言人\d+$/
  return lines.map((line, i) => {
    const next = { ...line }
    if (
      opts.preserveManual &&
      line.speaker &&
      !autoRe.test(line.speaker.trim())
    ) {
      return next
    }
    const sp = result.speakers[i]
    if (sp) next.speaker = sp
    return next
  })
}

/**
 * Extract 3-d features from mono float PCM (any sample rate).
 * Pure — usable in Node tests and browser (pass channel data).
 */
export function extractSegmentFeatures(
  samples: Float32Array | number[],
  sampleRate: number,
): DiarizeFeature {
  const n = samples.length
  if (n === 0 || !(sampleRate > 0)) return [0, 0, 0]

  let energy = 0
  let zc = 0
  let prev = samples[0] ?? 0
  // coarse spectral: sum |diff| as high-freq proxy + weighted pos
  let diffSum = 0
  for (let i = 0; i < n; i++) {
    const x = samples[i] ?? 0
    energy += x * x
    if (i > 0) {
      if ((prev >= 0 && x < 0) || (prev < 0 && x >= 0)) zc++
      diffSum += Math.abs(x - prev)
    }
    prev = x
  }
  const logEnergy = Math.log1p(energy / n)
  const zcr = zc / n
  const centroidNorm = Math.min(1, diffSum / (n * 0.5 + 1e-9))
  return [logEnergy, zcr, centroidNorm]
}

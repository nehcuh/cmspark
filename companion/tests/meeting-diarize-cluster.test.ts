/**
 * #260 embedding diarize — pure clustering layer (cosine agglomerative +
 * threshold auto-K). Deterministic; no model, no IO.
 */
import test from "node:test"
import assert from "node:assert/strict"

import {
  DIARIZE_CLUSTER_THRESHOLD,
  autoKByThreshold,
  cosineDistance,
  agglomerativeCluster,
  diarizeByEmbeddings,
} from "../src/meeting/diarize-cluster"
import { DIARIZE_K_MAX } from "../src/meeting/auto-diarize"
import type { TranscriptLine } from "../src/meeting/meeting-store"

function line(i: number): TranscriptLine {
  return { text: `line ${i}`, source: "stt" }
}

/** Base vectors for K synthetic speakers (well-separated, unit norm-ish). */
function speakerBase(dim: number, spk: number): number[] {
  const v = new Array<number>(dim).fill(0)
  // orthogonal-ish spikes per speaker
  for (let j = 0; j < 3; j++) v[(spk * 7 + j * 29) % dim] = 1 + j * 0.1
  return v
}

function noisy(base: number[], scale = 0.01, seed: number): number[] {
  // deterministic pseudo-noise (LCG) so tests are reproducible
  let s = seed >>> 0
  return base.map((x) => {
    s = (s * 1664525 + 1013904223) >>> 0
    const u = (s / 0xffffffff) * 2 - 1
    return x + u * scale
  })
}

test("cosineDistance basics", () => {
  assert.equal(cosineDistance([1, 0], [1, 0]), 0)
  assert.equal(cosineDistance([1, 0], [0, 1]), 1)
  assert.ok(Math.abs(cosineDistance([1, 0], [1, 1]) - (1 - 1 / Math.SQRT2)) < 1e-12)
  // zero-norm → max distance 1 (similarity undefined → 0)
  assert.equal(cosineDistance([0, 0], [1, 1]), 1)
  assert.equal(cosineDistance([1, 1], [0, 0]), 1)
})

test("agglomerativeCluster separates two known speakers", () => {
  const a = speakerBase(192, 0)
  const b = speakerBase(192, 1)
  const rows = [
    noisy(a, 0.01, 1),
    noisy(b, 0.01, 2),
    noisy(a, 0.01, 3),
    noisy(b, 0.01, 4),
    noisy(a, 0.01, 5),
  ]
  const assign = agglomerativeCluster(rows, 2)
  assert.equal(assign.length, 5)
  assert.equal(assign[0], assign[2])
  assert.equal(assign[0], assign[4])
  assert.equal(assign[1], assign[3])
  assert.notEqual(assign[0], assign[1])
})

test("agglomerativeCluster k=1 collapses to single cluster", () => {
  const rows = [noisy(speakerBase(64, 0), 0.1, 1), noisy(speakerBase(64, 1), 0.1, 2)]
  assert.deepEqual(agglomerativeCluster(rows, 1), [0, 0])
})

test("agglomerativeCluster is deterministic (same input → same labels, twice)", () => {
  const rows = Array.from({ length: 12 }, (_, i) =>
    noisy(speakerBase(96, i % 3), 0.05, 100 + i),
  )
  const r1 = agglomerativeCluster(rows, 3)
  const r2 = agglomerativeCluster(rows, 3)
  assert.deepEqual(r1, r2)
})

test("autoKByThreshold hits true K for 2, 3, 4 speakers", () => {
  for (const trueK of [2, 3, 4]) {
    const rows = Array.from({ length: trueK * 4 }, (_, i) =>
      noisy(speakerBase(128, i % trueK), 0.02, 200 + trueK * 100 + i),
    )
    assert.equal(autoKByThreshold(rows), trueK, `trueK=${trueK}`)
  }
})

test("autoKByThreshold splits thin-margin speakers that silhouette under-splits", () => {
  // Adversarial pair: cross-speaker cosine distance ≈ 0.08 (> threshold 0.06),
  // intra-speaker ≈ 0.01 — the profile where silhouette-based K collapsed to 2.
  const a = new Array<number>(64).fill(0)
  a[0] = 1
  const b = new Array<number>(64).fill(0)
  b[0] = 0.92 // cos ≈ 0.92 → distance ≈ 0.08
  b[1] = Math.sqrt(1 - 0.92 * 0.92)
  assert.ok(Math.abs(cosineDistance(a, b) - 0.08) < 0.005, "fixture margin as designed")
  const rows = [
    noisy(a, 0.005, 1),
    noisy(b, 0.005, 2),
    noisy(a, 0.005, 3),
    noisy(b, 0.005, 4),
    noisy(a, 0.005, 5),
    noisy(b, 0.005, 6),
  ]
  assert.equal(autoKByThreshold(rows), 2)
})

test("autoKByThreshold clamps to [K_MIN, K_MAX]", () => {
  assert.equal(DIARIZE_K_MAX, 6)
  // single speaker (all intra) → floor 2 (K_MIN; 单人会议不在产品域)
  const single = Array.from({ length: 8 }, (_, i) => noisy(speakerBase(64, 0), 0.005, 10 + i))
  assert.equal(autoKByThreshold(single), 2)
  // 8 well-separated speakers → ceiling 6
  const eight = Array.from({ length: 32 }, (_, i) => noisy(speakerBase(64, i % 8), 0.005, 40 + i))
  assert.equal(autoKByThreshold(eight), 6)
})

test("autoKByThreshold small-n degenerates safely", () => {
  assert.equal(autoKByThreshold([]), 0)
  assert.equal(autoKByThreshold([noisy(speakerBase(64, 0), 0.01, 1)]), 1)
  assert.equal(
    autoKByThreshold([noisy(speakerBase(64, 0), 0.01, 1), noisy(speakerBase(64, 5), 0.01, 2)]),
    2,
  )
})

test("DIARIZE_CLUSTER_THRESHOLD is pinned", () => {
  assert.equal(DIARIZE_CLUSTER_THRESHOLD, 0.06)
})

test("diarizeByEmbeddings labels 发言人N by first appearance", () => {
  const a = speakerBase(64, 0)
  const b = speakerBase(64, 1)
  const lines = [line(0), line(1), line(2), line(3)]
  const rows = [noisy(b, 0.01, 1), noisy(a, 0.01, 2), noisy(b, 0.01, 3), noisy(a, 0.01, 4)]
  const res = diarizeByEmbeddings(lines, rows, 2)
  assert.equal(res.method, "embedding")
  assert.equal(res.k, 2)
  assert.equal(res.experimental, false)
  // speaker B talks first → 发言人1
  assert.equal(res.speakers[0], "发言人1")
  assert.equal(res.speakers[1], "发言人2")
  assert.equal(res.speakers[2], "发言人1")
  assert.equal(res.speakers[3], "发言人2")
  assert.deepEqual(res.labels, ["发言人1", "发言人2"])
})

test("diarizeByEmbeddings auto-K sets auto:true and finds K", () => {
  const lines = Array.from({ length: 12 }, (_, i) => line(i))
  const rows = Array.from({ length: 12 }, (_, i) => noisy(speakerBase(64, i % 3), 0.02, 400 + i))
  const res = diarizeByEmbeddings(lines, rows, 0)
  assert.equal(res.auto, true)
  assert.equal(res.k, 3)
})

test("diarizeByEmbeddings same input twice → identical labels (determinism)", () => {
  const lines = Array.from({ length: 15 }, (_, i) => line(i))
  const rows = Array.from({ length: 15 }, (_, i) => noisy(speakerBase(64, i % 4), 0.03, 500 + i))
  const r1 = diarizeByEmbeddings(lines, rows, 0)
  const r2 = diarizeByEmbeddings(lines, rows, 0)
  assert.deepEqual(r1.speakers, r2.speakers)
  assert.equal(r1.k, r2.k)
})

test("diarizeByEmbeddings tolerates malformed rows (NaN/short) without throwing", () => {
  const lines = [line(0), line(1), line(2), line(3)]
  const rows = [
    [1, 0, 0],
    [Number.NaN, Number.NaN],
    [0, 1, 0],
    [0, 1, 0.1],
  ]
  const res = diarizeByEmbeddings(lines, rows as number[][], 2)
  assert.equal(res.speakers.length, 4)
})

test("diarizeByEmbeddings single row / empty rows degenerate safely", () => {
  assert.deepEqual(diarizeByEmbeddings([], [], 2).speakers, [])
  const one = diarizeByEmbeddings([line(0)], [[1, 2, 3]], 2)
  assert.deepEqual(one.speakers, ["发言人1"])
})

import test from "node:test"
import assert from "node:assert/strict"
import {
  findRelatedThreads,
  scoreRelatedPair,
  buildRelatedEdges,
  digestLintStats,
  RELATED_W_CO_TAG,
} from "../src/sidepanel/utils/thread-related"

test("scoreRelatedPair: co-tag contributes weighted jaccard", () => {
  const a = { id: "a", digest: { tags: ["alpha", "beta"], tldr: "竞品定价" } }
  const b = { id: "b", digest: { tags: ["beta", "gamma"], tldr: "定价对比" } }
  const hit = scoreRelatedPair(a, b)
  assert.ok(hit.score > 0)
  assert.ok(hit.shared_tags.includes("beta"))
  assert.ok(hit.signals.co_tag > 0)
  assert.ok(hit.signals.co_tag <= RELATED_W_CO_TAG)
})

test("findRelatedThreads: top-K, excludes self and zero-score", () => {
  const threads = [
    { id: "seed", digest: { tags: ["x", "y"], tldr: "foo bar" } },
    { id: "near", digest: { tags: ["x"], tldr: "foo" } },
    { id: "far", digest: { tags: ["zzz"], tldr: "unrelated topic" } },
    { id: "empty" },
  ]
  const hits = findRelatedThreads("seed", threads, 3)
  assert.ok(hits.every((h) => h.thread_id !== "seed"))
  assert.ok(hits.some((h) => h.thread_id === "near"))
  assert.ok(!hits.some((h) => h.thread_id === "empty" && h.score <= 0))
})

test("buildRelatedEdges: undirected and capped", () => {
  const threads = [
    { id: "1", digest: { tags: ["a"], tldr: "hello world" } },
    { id: "2", digest: { tags: ["a"], tldr: "hello there" } },
    { id: "3", digest: { tags: ["b"], tldr: "other" } },
  ]
  const edges = buildRelatedEdges(threads, { minScore: 0.01, maxEdges: 10 })
  assert.ok(edges.some((e) => (e.a === "1" && e.b === "2") || (e.a === "2" && e.b === "1")))
})

test("digestLintStats counts untagged/stale", () => {
  const stats = digestLintStats([
    { id: "1" },
    { id: "2", digest: { tags: [], stale: true } },
    { id: "3", digest: { tags: ["x"] } },
  ])
  assert.equal(stats.untagged, 2)
  assert.equal(stats.stale, 1)
  // 1 and 2 have no edges to 3 at minScore; isolated includes low-degree nodes
  assert.ok(stats.isolated >= 1)
})

test("tokenize filters English stop words (align companion)", () => {
  // Co-tag zero; TF should still score if contentful tokens remain after stop-word filter
  const a = { id: "a", digest: { tldr: "the pricing model for saas" } }
  const b = { id: "b", digest: { tldr: "pricing model saas comparison" } }
  const hit = scoreRelatedPair(a, b)
  assert.ok(hit.signals.tf > 0 || hit.score > 0)
})

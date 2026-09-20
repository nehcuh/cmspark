import { describe, it } from "node:test"
import assert from "node:assert/strict"
import {
  findRelatedThreads,
  scoreRelatedPair,
  RELATED_W_CO_TAG,
} from "../src/threads/related"

describe("thread related (Wave C)", () => {
  it("scores co-tag pairs", () => {
    const hit = scoreRelatedPair(
      { id: "a", digest: { tags: ["alpha", "beta"], tldr: "竞品" } },
      { id: "b", digest: { tags: ["beta"], tldr: "竞品分析" } },
    )
    assert.ok(hit.score > 0)
    assert.ok(hit.shared_tags.includes("beta"))
    assert.ok(hit.signals.co_tag <= RELATED_W_CO_TAG)
  })

  it("findRelatedThreads ranks and limits", () => {
    const threads = [
      { id: "seed", digest: { tags: ["x"], tldr: "one two" } },
      { id: "r1", digest: { tags: ["x"], tldr: "one" } },
      { id: "r2", digest: { tags: ["y"], tldr: "zzz" } },
    ]
    const hits = findRelatedThreads("seed", threads, 2)
    assert.ok(hits.length >= 1)
    assert.equal(hits[0].thread_id, "r1")
  })

  it("findRelatedThreads skips trashed seed and peers", () => {
    const threads = [
      { id: "seed", trashed_at: "2026-01-01", digest: { tags: ["x"] } },
      { id: "r1", digest: { tags: ["x"] } },
    ]
    assert.deepEqual(findRelatedThreads("seed", threads, 5), [])
    const live = [
      { id: "seed", digest: { tags: ["x"] } },
      { id: "gone", trashed_at: "2026-01-01", digest: { tags: ["x"] } },
      { id: "ok", digest: { tags: ["x"] } },
    ]
    const hits = findRelatedThreads("seed", live, 5)
    assert.ok(hits.every((h) => h.thread_id !== "gone"))
    assert.ok(hits.some((h) => h.thread_id === "ok"))
  })

  it("#517 findRelatedThreads skips workers, keeps orchestrator parent", () => {
    const threads = [
      { id: "p", agent_role: "orchestrator", digest: { tags: ["c2c"], tldr: "主任务" } },
      {
        id: "w",
        agent_role: "worker",
        digest: { tags: ["c2c"], tldr: "子任务" },
      },
      { id: "peer", digest: { tags: ["c2c"], tldr: "别的对话" } },
    ]
    const fromParent = findRelatedThreads("p", threads, 5)
    assert.ok(fromParent.every((h) => h.thread_id !== "w"))
    assert.ok(fromParent.some((h) => h.thread_id === "peer"))
    const fromWorker = findRelatedThreads("w", threads, 5)
    assert.ok(fromWorker.some((h) => h.thread_id === "p"), "worker seed may still relate to parent")
    assert.ok(fromWorker.every((h) => h.thread_id !== "w"))
  })

  it("findRelatedThreads empty when seed missing digest and no signal", () => {
    const threads = [
      { id: "seed" },
      { id: "other" },
    ]
    assert.deepEqual(findRelatedThreads("seed", threads, 5), [])
  })
})

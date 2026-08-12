import test from "node:test"
import assert from "node:assert/strict"
import {
  UNTAGGED_COLOR,
  UNTAGGED_LABEL,
  buildTagColorIndex,
  colorForTag,
  hashTag,
  hexWithAlpha,
  lightenHex,
  primaryTag,
} from "../src/thread-graph/tag-colors"

test("hashTag is stable and case-insensitive", () => {
  assert.equal(hashTag("AI安全"), hashTag("ai安全"))
  assert.equal(hashTag("  foo  "), hashTag("foo"))
  assert.notStrictEqual(hashTag("a"), hashTag("b"))
})

test("colorForTag: empty → untagged slate", () => {
  assert.equal(colorForTag(null), UNTAGGED_COLOR)
  assert.equal(colorForTag(""), UNTAGGED_COLOR)
  assert.equal(colorForTag("   "), UNTAGGED_COLOR)
})

test("colorForTag: same tag → same color", () => {
  assert.equal(colorForTag("数据安全"), colorForTag("数据安全"))
})

test("primaryTag uses first non-empty", () => {
  assert.equal(primaryTag(null), null)
  assert.equal(primaryTag([]), null)
  assert.equal(primaryTag(["", "  ", "x"]), "x")
  assert.equal(primaryTag(["工作", "健康"]), "工作")
})

test("buildTagColorIndex groups and filters by nodeIds", () => {
  const threads = [
    { id: "1", digest: { tags: ["工作", "周报"] } },
    { id: "2", digest: { tags: ["工作"] } },
    { id: "3", digest: { tags: [] } },
    { id: "4", digest: { tags: ["健康"] } },
  ]
  const full = buildTagColorIndex(threads)
  assert.equal(full.colorById.get("1"), colorForTag("工作"))
  assert.equal(full.tagById.get("1"), "工作")
  assert.equal(full.colorById.get("3"), UNTAGGED_COLOR)
  const work = full.groups.find((g) => g.tag === "工作")
  assert.ok(work && work.count === 2)
  const un = full.groups.find((g) => g.tag === UNTAGGED_LABEL)
  assert.ok(un && un.count === 1)

  const subset = buildTagColorIndex(threads, ["1", "4"])
  assert.equal(subset.groups.find((g) => g.tag === "工作")?.count, 1)
  assert.equal(subset.colorById.has("2"), false)
})

test("lightenHex / hexWithAlpha", () => {
  assert.match(lightenHex("#6b9fff", 0.3), /^#[0-9a-f]{6}$/i)
  assert.equal(hexWithAlpha("#6b9fff", 0.5), "rgba(107,159,255,0.5)")
})

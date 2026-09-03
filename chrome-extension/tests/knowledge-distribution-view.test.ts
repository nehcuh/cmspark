import test from "node:test"
import assert from "node:assert/strict"

// #273 Wave B — 分布过滤 chips：util 逻辑 + 面板接线（§6.4；Gate9 MAJOR-2 稳定 key）
// Spec: docs/superpowers/specs/2026-09-02-knowledge-retrieval-scoring-design.md

import {
  KNOWLEDGE_DISTRIBUTION_HONESTY_COPY,
  KNOWLEDGE_DISTRIBUTION_OVER_CAP_COPY,
  distributionChips,
  distributionFilterIds,
  distributionOverCap,
} from "../src/sidepanel/utils/knowledge-distribution"
import type { KnowledgeDistribution } from "../src/sidepanel/types"

const SAMPLE: KnowledgeDistribution = {
  groups: [
    { key: "fa1", label: "refund", count: 6, ids: ["fa1", "fa2", "fa3", "fa4", "fa5", "fa6"] },
    { key: "gb1", label: "expense", count: 3, ids: ["gb1", "gb2", "gb3"] },
    { key: "u:ungrouped", label: "未分组", count: 2, ids: ["o1", "o2"] },
  ],
}

test("distributionChips: ok 态返回全部分组（含「未分组」），不渲染态返回 []", () => {
  assert.equal(distributionChips(SAMPLE).length, 3)
  assert.equal(distributionChips(null).length, 0)
  assert.equal(distributionChips(undefined).length, 0)
  assert.equal(distributionChips({ groups: [], reason: "too_few" }).length, 0)
  assert.equal(distributionChips({ groups: [], reason: "all_ungrouped" }).length, 0)
  assert.equal(distributionChips({ groups: [], reason: "over_cap" }).length, 0)
  // 形状防御：空 ids / 缺 key 的分组不进 chips
  assert.equal(
    distributionChips({ groups: [{ key: "", label: "x", count: 1, ids: ["a"] }, { key: "k", label: "y", count: 0, ids: [] }] as never }).length,
    0,
  )
})

test("distributionFilterIds: 点击 = 过滤，按稳定 key 查；未选/未知 key = 不过滤", () => {
  assert.equal(distributionFilterIds(SAMPLE, null), null)
  const ids = distributionFilterIds(SAMPLE, "gb1")
  assert.ok(ids instanceof Set && ids.has("gb1") && ids.size === 3)
  assert.equal(distributionFilterIds(SAMPLE, "不存在"), null, "key 匹配不到不过滤（不假装有结构）")
  // 「未分组」也是普通过滤 chip（保留键）
  const un = distributionFilterIds(SAMPLE, "u:ungrouped")
  assert.ok(un?.has("o1") && un.size === 2)
})

test("MAJOR-2: 标签碰撞 —— key 决定过滤对象，displayLabel 加消歧后缀", () => {
  const collided: KnowledgeDistribution = {
    groups: [
      { key: "a1", label: "笔记", count: 3, ids: ["a1", "a2", "a3"] },
      { key: "b1", label: "笔记", count: 4, ids: ["b1", "b2", "b3", "b4"] },
    ],
  }
  const chips = distributionChips(collided)
  assert.equal(chips.length, 2)
  assert.deepEqual(chips.map((c) => c.displayLabel), ["笔记（1）", "笔记（2）"], "碰撞 label 按序消歧")
  // 按 key 过滤命中各自的 ids（label 相同但不过滤错对象）
  const a = distributionFilterIds(collided, "a1")
  const b = distributionFilterIds(collided, "b1")
  assert.ok(a?.has("a1") && a.size === 3 && !a.has("b1"))
  assert.ok(b?.has("b1") && b.size === 4 && !b.has("a1"))
  // 无碰撞时 displayLabel 就是 label
  assert.equal(distributionChips(SAMPLE)[0].displayLabel, "refund")
})

test("distributionOverCap: 仅 over_cap 态显示诚实文案", () => {
  assert.equal(distributionOverCap({ groups: [], reason: "over_cap" }), true)
  assert.equal(distributionOverCap(SAMPLE), false)
  assert.equal(distributionOverCap(null), false)
})

test("copy pins: 诚实句与超 cap 文案逐字（§6.4 / §6.2 表）", () => {
  assert.equal(KNOWLEDGE_DISTRIBUTION_HONESTY_COPY, "自动分组，不准就移到文件夹。")
  assert.equal(KNOWLEDGE_DISTRIBUTION_OVER_CAP_COPY, "库超过 200 篇，未自动分组")
})

// Gate9 r2 grok N1：store 层——SET_KNOWLEDGE_DOCS 带 distribution 即更新，
// 缺席（非 panel 面/旧 companion）保留现值。
import { agentReducer, initialState } from "../src/sidepanel/store/agentStore"

test("store: SET_KNOWLEDGE_DOCS carries distribution; absent field preserves current value", () => {
  const dist = SAMPLE
  const s1 = agentReducer(initialState, { type: "SET_KNOWLEDGE_DOCS", docs: [], distribution: dist } as never)
  assert.deepEqual(s1.knowledgeDistribution, dist, "distribution 入 store")
  // 缺席 = 保留现值
  const s2 = agentReducer(s1, { type: "SET_KNOWLEDGE_DOCS", docs: [] } as never)
  assert.deepEqual(s2.knowledgeDistribution, dist, "frame 缺席保留现值")
  // 显式 null（不渲染态/面板剥除后的明确空态）覆盖
  const s3 = agentReducer(s2, { type: "SET_KNOWLEDGE_DOCS", docs: [], distribution: null } as never)
  assert.equal(s3.knowledgeDistribution, null)
})

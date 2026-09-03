// #273 Wave B: 分布过滤 chips 的纯逻辑（KnowledgeSubPanel 与测试共用同一份实现）
// Spec: docs/superpowers/specs/2026-09-02-knowledge-retrieval-scoring-design.md §6.4
//
// 形态钉死：列表上方的过滤 chips（分组名 + 计数，点击 = 过滤文档列表），
// 不是与「站点 | 文件夹」抢默认的第三个视图。计算型分组列表，不是用户维护的
// 层级分类——面板必须同时显示诚实句「自动分组，不准就移到文件夹。」
// Gate9 MAJOR-2：身份用稳定 key（分组身份 = 成员 id min），label 仅显示；标签碰撞加消歧后缀。

import type { KnowledgeDistribution } from "../types"

/** 面板诚实句（§6.4 强制；缺这句用户会把 chips 当成层级分类）。 */
export const KNOWLEDGE_DISTRIBUTION_HONESTY_COPY = "自动分组，不准就移到文件夹。"

/** 超 cap 诚实文案（§6.2 表：库超过 200 篇，未自动分组）。 */
export const KNOWLEDGE_DISTRIBUTION_OVER_CAP_COPY = "库超过 200 篇，未自动分组"

export type DistributionGroup = {
  key: string
  label: string
  /** 展示文案：label 碰撞时按 chip 序加「（2）（3）…」消歧后缀。 */
  displayLabel: string
  count: number
  ids: string[]
}

/** 可渲染时的 chips（分组 + 末尾「未分组」）；不渲染态返回 []。 */
export function distributionChips(
  distribution: KnowledgeDistribution | null | undefined,
): DistributionGroup[] {
  if (!distribution || !Array.isArray(distribution.groups)) return []
  const valid = distribution.groups.filter(
    (g) =>
      g &&
      typeof g.key === "string" &&
      g.key.length > 0 &&
      typeof g.label === "string" &&
      Array.isArray(g.ids) &&
      g.ids.length > 0,
  )
  // label 仅显示：同名分组按出现序加消歧后缀（计数已随 chip 显示，后缀消歧点击目标）
  const labelSeen = new Map<string, number>()
  return valid.map((g) => {
    const seen = (labelSeen.get(g.label) || 0) + 1
    labelSeen.set(g.label, seen)
    const collides = valid.some((o) => o !== g && o.label === g.label)
    return { ...g, displayLabel: collides ? `${g.label}（${seen}）` : g.label }
  })
}

/** 超 cap 诚实文案是否应显示（其余不渲染态什么都不显示）。 */
export function distributionOverCap(
  distribution: KnowledgeDistribution | null | undefined,
): boolean {
  return distribution?.reason === "over_cap"
}

/**
 * 选中某个 chip 后的过滤 id 集（null = 未选/不过滤）。
 * 按稳定 key 查（标签碰撞也不会过滤错对象）；key 匹配不到返回 null。
 */
export function distributionFilterIds(
  distribution: KnowledgeDistribution | null | undefined,
  key: string | null,
): Set<string> | null {
  if (!key) return null
  const chip = distributionChips(distribution).find((g) => g.key === key)
  if (!chip) return null
  return new Set(chip.ids)
}

// #260 评测门指标（spec §5：人数估计正确率 + 段级标签纯度；分栏 legacy vs embedding）。
// 纯函数、确定性——harness 在 scripts/diarize-eval.ts，摘 experimental 的门在
// significantlyBetter；未过门 embedding 照常可用但保持 experimental:true。

export interface DiarizeEvalMetrics {
  /** 人数估计正确率（K 精确匹配占比）。 */
  countAccuracy: number
  /** 段级标签纯度（聚类 purity，标签置换不变）。 */
  purity: number
  /** 参与段数（0 段 fixture 记 invalid，不进均值）。 */
  segments: number
}

/** K 精确匹配正确率；空输入 → 0（评测自身跑完才算数，空集不是满分）。 */
export function speakerCountAccuracy(estimated: number[], truth: number[]): number {
  if (estimated.length === 0 || estimated.length !== truth.length) return 0
  let hit = 0
  for (let i = 0; i < truth.length; i++) {
    if (estimated[i] === truth[i]) hit++
  }
  return hit / truth.length
}

/**
 * 聚类 purity：每个预测簇取与其重叠最多的真值说话人段数，求和 / N。
 * 标签置换不变（只分「发言人N」，不要求编号对齐）。
 */
export function segmentPurity(assignments: number[], truth: number[]): number {
  const n = assignments.length
  if (n === 0 || n !== truth.length) return 0
  const overlap = new Map<string, number>()
  for (let i = 0; i < n; i++) {
    const key = `${assignments[i]}|${truth[i]}`
    overlap.set(key, (overlap.get(key) ?? 0) + 1)
  }
  const clusterMax = new Map<number, number>()
  for (const [key, count] of overlap) {
    const cluster = Number(key.split("|")[0])
    clusterMax.set(cluster, Math.max(clusterMax.get(cluster) ?? 0, count))
  }
  let agreed = 0
  for (const count of clusterMax.values()) agreed += count
  return agreed / n
}

/** 纯度显著优势门限（spec：显著优于 3 维 baseline 才可摘 experimental）。 */
export const DIARIZE_EVAL_PURITY_MARGIN = 0.05

/**
 * 评测门：embedding 须在两项指标上都不输 baseline，且至少一项高出 margin。
 * 空段（segments=0）任何一侧都不算过门。
 */
export function significantlyBetter(
  embedding: DiarizeEvalMetrics,
  baseline: DiarizeEvalMetrics,
  margin = DIARIZE_EVAL_PURITY_MARGIN,
): boolean {
  if (embedding.segments === 0 || baseline.segments === 0) return false
  if (embedding.countAccuracy < baseline.countAccuracy) return false
  if (embedding.purity < baseline.purity) return false
  const countGain = embedding.countAccuracy - baseline.countAccuracy
  const purityGain = embedding.purity - baseline.purity
  return countGain >= margin || purityGain >= margin
}

// #296 知识分布图谱 — 用户可见文案常量（spec AC-3/AC-5 / §7 名词）。
// 「图谱」仅限本视图；视图内分组用语只用「分组」。

export const KNOWLEDGE_GRAPH_ENTRY_LABEL = "分布图谱"
export const KNOWLEDGE_GRAPH_TOO_FEW_COPY = "知识不足 20 篇，暂无图谱"
export const KNOWLEDGE_GRAPH_OVER_CAP_COPY =
  "超过 200 篇，只画标题字典序前 200 篇；仅这 200 篇参与分组与着色"
export const KNOWLEDGE_GRAPH_REBUILDING_COPY = "图谱索引重建中…"
export const KNOWLEDGE_GRAPH_REBUILD_TIMEOUT_COPY = "索引重建超时，请手动刷新"
/** #356: knowledge.graph 被门拒/出错映射的可见态（错误详情由调用方折叠展示）。 */
export const KNOWLEDGE_GRAPH_ERROR_COPY = "图谱加载失败，可关闭后从知识面板重开"
/** #356: error 详情折叠开关文案（内部错误原文不直接铺开）。 */
export const KNOWLEDGE_GRAPH_ERROR_DETAIL_LABEL = "技术详情"
export const KNOWLEDGE_GRAPH_AI_BADGE = "AI 生成"
export const KNOWLEDGE_GRAPH_UNGROUPED_LABEL = "未分组"
export const KNOWLEDGE_GRAPH_COLOR_GROUP = "按分组"
export const KNOWLEDGE_GRAPH_COLOR_FOLDER = "按文件夹"
export const KNOWLEDGE_GRAPH_LLM_TOGGLE = "AI 分组命名"
export const KNOWLEDGE_GRAPH_REGENERATE = "重新生成"

/** #427：LLM 整理 lane 上界（= KNOWLEDGE_CLUSTER_MIN_DOCS−1；画布闸已解绑）。 */
export const KNOWLEDGE_GRAPH_LLM_LANE_MAX = 19
export const KNOWLEDGE_GRAPH_REORGANIZE = "重新整理"
export const KNOWLEDGE_GRAPH_ORGANIZING = "整理中…"
export const KNOWLEDGE_GRAPH_STALE_BADGE = "语料已变化 · 可重新整理"
export const KNOWLEDGE_GRAPH_NO_RELATIONS = "AI 未发现明确关联"
export const KNOWLEDGE_GRAPH_TF_SWITCH_BANNER = "知识已满 20 篇，分组改按统计聚类（更稳定）"
export const KNOWLEDGE_GRAPH_LOCK_DISSOLVED = "不足两篇的锁定分组已解散"
export const KNOWLEDGE_GRAPH_ORGANIZE_RETRY = "重试"
export const KNOWLEDGE_GRAPH_AI_RELATION = "AI 关联"
export const KNOWLEDGE_GRAPH_LOCK_GROUP = "保留这版分组"
export const KNOWLEDGE_GRAPH_UNLOCK_GROUP = "解锁"
export const KNOWLEDGE_GRAPH_REASON_DISMISS = "关闭"
/** 与 distill 同源：无 LLM 配置时 CTA 禁用 tooltip。 */
export const KNOWLEDGE_GRAPH_LLM_NOT_CONFIGURED = "未配置 LLM"

export function knowledgeGraphOrganizeCta(n: number): string {
  return `让 AI 整理现有 ${n} 篇`
}

/** 2–19 且 status ok → LLM 整理 lane（CTA / 重新整理）。 */
export function isKnowledgeGraphLlmLane(nodeCount: number): boolean {
  return nodeCount >= 2 && nodeCount <= KNOWLEDGE_GRAPH_LLM_LANE_MAX
}

export type KnowledgeGraphStatus = "ok" | "too_few" | "over_cap" | "rebuilding" | "error"

/** Banner copy for the honest states; ok → no banner. */
export function graphBannerCopy(
  status: KnowledgeGraphStatus,
  _truncated?: boolean,
): string | null {
  if (status === "too_few") return KNOWLEDGE_GRAPH_TOO_FEW_COPY
  if (status === "rebuilding") return KNOWLEDGE_GRAPH_REBUILDING_COPY
  if (status === "over_cap") return KNOWLEDGE_GRAPH_OVER_CAP_COPY
  if (status === "error") return KNOWLEDGE_GRAPH_ERROR_COPY
  return null
}

/** too_few / rebuilding / error must not paint an empty graph pretending structure. */
export function shouldRenderGraphCanvas(status: KnowledgeGraphStatus): boolean {
  return status === "ok" || status === "over_cap"
}

// #296 知识分布图谱 — 用户可见文案常量（spec AC-3/AC-5 / §7 名词）。
// 「图谱」仅限本视图；视图内分组用语只用「分组」。

export const KNOWLEDGE_GRAPH_ENTRY_LABEL = "分布图谱"
export const KNOWLEDGE_GRAPH_TOO_FEW_COPY = "知识不足 20 篇，暂无图谱"
export const KNOWLEDGE_GRAPH_OVER_CAP_COPY =
  "超过 200 篇，只画标题字典序前 200 篇；仅这 200 篇参与分组与着色"
export const KNOWLEDGE_GRAPH_REBUILDING_COPY = "图谱索引重建中…"
export const KNOWLEDGE_GRAPH_AI_BADGE = "AI 生成"
export const KNOWLEDGE_GRAPH_UNGROUPED_LABEL = "未分组"
export const KNOWLEDGE_GRAPH_COLOR_GROUP = "按分组"
export const KNOWLEDGE_GRAPH_COLOR_FOLDER = "按文件夹"
export const KNOWLEDGE_GRAPH_LLM_TOGGLE = "AI 分组命名"
export const KNOWLEDGE_GRAPH_REGENERATE = "重新生成"

export type KnowledgeGraphStatus = "ok" | "too_few" | "over_cap" | "rebuilding"

/** Banner copy for the three honest states; ok → no banner. */
export function graphBannerCopy(
  status: KnowledgeGraphStatus,
  _truncated?: boolean,
): string | null {
  if (status === "too_few") return KNOWLEDGE_GRAPH_TOO_FEW_COPY
  if (status === "rebuilding") return KNOWLEDGE_GRAPH_REBUILDING_COPY
  if (status === "over_cap") return KNOWLEDGE_GRAPH_OVER_CAP_COPY
  return null
}

/** too_few / rebuilding must not paint an empty graph pretending structure. */
export function shouldRenderGraphCanvas(status: KnowledgeGraphStatus): boolean {
  return status === "ok" || status === "over_cap"
}

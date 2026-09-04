// #296 分组卡片展示模型：AI 标识 + 摘要仅在开关开且 ai:true 时出现。

import { KNOWLEDGE_GRAPH_UNGROUPED_LABEL } from "./copy"
import type { KnowledgeGraphLabel } from "./wire"

export type GroupCardModel = {
  name: string
  summary: string | null
  showAiBadge: boolean
}

export function groupCardModel(
  label: KnowledgeGraphLabel | undefined,
  llmEnabled: boolean,
): GroupCardModel {
  const name = (label?.name || "").trim() || KNOWLEDGE_GRAPH_UNGROUPED_LABEL
  if (!llmEnabled) {
    return { name, summary: null, showAiBadge: false }
  }
  const ai = label?.ai === true
  const summary = ai && label?.summary?.trim() ? label.summary.trim() : null
  return { name, summary, showAiBadge: ai }
}

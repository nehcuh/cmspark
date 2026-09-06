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
  opts?: { llmLaneGroup?: boolean },
): GroupCardModel {
  const name = (label?.name || "").trim() || KNOWLEDGE_GRAPH_UNGROUPED_LABEL
  // #427：l: 分组是整理产物，开关关也要带「AI 生成」（AC-1）；#296 命名开关仍管 c: 组。
  const ai = label?.ai === true
  const showAi = opts?.llmLaneGroup === true ? ai : llmEnabled && ai
  if (!showAi) {
    return { name, summary: null, showAiBadge: false }
  }
  const summary = ai && label?.summary?.trim() ? label.summary.trim() : null
  return { name, summary, showAiBadge: ai }
}

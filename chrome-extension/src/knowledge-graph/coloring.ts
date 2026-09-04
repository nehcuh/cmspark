// #296 着色：按分组（默认）/ 按文件夹；未分组灰色。复用 thread-graph 色板。

import { colorForTag, UNTAGGED_COLOR } from "../thread-graph/tag-colors"
import { KNOWLEDGE_GRAPH_UNGROUPED_LABEL } from "./copy"
import type { KnowledgeGraphLabel, KnowledgeGraphNode } from "./wire"

export type ColorMode = "group" | "folder"

const UNGROUPED_KEYS = new Set(["", "u:ungrouped", "ungrouped"])

export function isUngroupedKey(key: string | null | undefined): boolean {
  if (key == null) return true
  return UNGROUPED_KEYS.has(key.trim())
}

export function nodeColorKey(node: KnowledgeGraphNode, mode: ColorMode): string | null {
  if (mode === "folder") {
    const folder = (node.folder || "").trim()
    return folder ? folder : null
  }
  const gk = (node.group_key || "").trim()
  return isUngroupedKey(gk) ? null : gk
}

export function nodeColor(node: KnowledgeGraphNode, mode: ColorMode): string {
  const key = nodeColorKey(node, mode)
  if (!key) return UNTAGGED_COLOR
  return colorForTag(key)
}

export function hoverCaption(
  node: KnowledgeGraphNode,
  mode: ColorMode,
  labels: Record<string, KnowledgeGraphLabel>,
): string {
  const title = (node.title || "").trim() || node.id.slice(0, 8)
  if (mode === "folder") {
    const folder = (node.folder || "").trim()
    return `${title} · ${folder || KNOWLEDGE_GRAPH_UNGROUPED_LABEL}`
  }
  const gk = (node.group_key || "").trim()
  if (isUngroupedKey(gk)) return `${title} · ${KNOWLEDGE_GRAPH_UNGROUPED_LABEL}`
  const name = labels[gk]?.name?.trim()
  return `${title} · ${name || gk}`
}

export { UNTAGGED_COLOR }

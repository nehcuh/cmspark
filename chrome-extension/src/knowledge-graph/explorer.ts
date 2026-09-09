import type { LayoutNode } from "../thread-graph/force-layout"
import type { KnowledgeGraphNode } from "./wire"

/** List filters never remove data from the graph or change its relationships. */
export function filterKnowledgeNodes(nodes: KnowledgeGraphNode[], query: string, group: string): KnowledgeGraphNode[] {
  const term = query.trim().toLocaleLowerCase()
  return nodes.filter((node) =>
    (!group || (node.group_key || "u:ungrouped") === group) &&
    (!term || `${node.title}\n${node.folder}\n${node.id}`.toLocaleLowerCase().includes(term)),
  )
}

/** Fit the actual canvas, including room for labels; tiny viewports may zoom out. */
export function fitKnowledgeCamera(nodes: Pick<LayoutNode, "x" | "y" | "r">[], w: number, h: number) {
  if (!nodes.length || w <= 0 || h <= 0) return { scale: 1, x: 0, y: 0 }
  const minX = Math.min(...nodes.map((n) => n.x - n.r))
  const maxX = Math.max(...nodes.map((n) => n.x + n.r))
  const minY = Math.min(...nodes.map((n) => n.y - n.r))
  const maxY = Math.max(...nodes.map((n) => n.y + n.r))
  const scale = Math.min(1.6, Math.max(1, w - 96) / Math.max(40, maxX - minX), Math.max(1, h - 88) / Math.max(40, maxY - minY))
  return { scale, x: w / 2 - ((minX + maxX) / 2) * scale, y: h / 2 - ((minY + maxY) / 2) * scale }
}

export function shortKnowledgeTitle(title: string, id: string, limit = 18): string {
  const chars = Array.from(title.trim() || id)
  return chars.length > limit ? `${chars.slice(0, limit).join("")}…` : chars.join("")
}

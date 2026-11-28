import type { ThreadGraphSlim } from "../background/thread-graph"
import { threadTags } from "../sidepanel/utils/thread-management"
import { buildRelatedEdges } from "../sidepanel/utils/thread-related"

export function displayTitle(t: ThreadGraphSlim): string {
  const a = (t.alias || "").trim()
  if (a) return a.length > 22 ? a.slice(0, 21) + "…" : a
  return `未命名 · ${(t.id || "").slice(0, 6)}`
}

/** Derive the visible conversation graph from the snapshot prepared by the extension. */
export function buildThreadGraphView(
  threads: ThreadGraphSlim[],
  minScore: number,
  showIsolated: boolean,
  query: string,
  focusId: string | null,
) {
  const allEdges = buildRelatedEdges(threads, { minScore, maxEdges: 200 })
  const degree = new Map<string, number>()
  for (const t of threads) degree.set(t.id, 0)
  for (const e of allEdges) {
    degree.set(e.a, (degree.get(e.a) || 0) + 1)
    degree.set(e.b, (degree.get(e.b) || 0) + 1)
  }
  const isolated = new Set<string>()
  for (const t of threads) {
    if ((degree.get(t.id) || 0) === 0) isolated.add(t.id)
  }
  let nodeIds = threads.map((t) => t.id)
  if (!showIsolated) {
    nodeIds = nodeIds.filter((id) => !isolated.has(id) || id === focusId)
    const keep = new Set<string>()
    for (const e of allEdges) {
      keep.add(e.a)
      keep.add(e.b)
    }
    if (focusId) keep.add(focusId)
    nodeIds = nodeIds.filter((id) => keep.has(id))
  }
  const q = query.trim().toLowerCase()
  if (q) {
    nodeIds = nodeIds.filter((id) => {
      const t = threads.find((x) => x.id === id)
      if (!t) return false
      const title = displayTitle(t).toLowerCase()
      const tags = threadTags(t).join(" ").toLowerCase()
      return title.includes(q) || tags.includes(q) || id.toLowerCase().includes(q)
    })
  }
  const nodeSet = new Set(nodeIds)
  const edgesF = allEdges.filter((e) => nodeSet.has(e.a) && nodeSet.has(e.b))
  return {
    nodesInput: nodeIds.map((id) => ({
      id,
      degree: degree.get(id) || 0,
      title: displayTitle(threads.find((t) => t.id === id) || { id }),
    })),
    edges: edgesF,
    isolatedIds: isolated,
  }
}

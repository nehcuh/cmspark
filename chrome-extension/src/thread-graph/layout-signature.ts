// Topology signature for force-layout reseed (focus/hover must not reseed).

export type SigNode = { id: string; degree: number }
export type SigEdge = { a: string; b: string; kind?: string; score: number }

/**
 * Stable string for id multiset + degrees + undirected edges.
 * Same topology → same signature even if array identity changes.
 */
export function buildLayoutSignature(
  nodes: SigNode[],
  edges: SigEdge[],
): string {
  const ids = nodes
    .map((n) => n.id)
    .slice()
    .sort()
    .join("\0")
  const degs = nodes
    .map((n) => `${n.id}:${n.degree}`)
    .slice()
    .sort()
    .join("|")
  const es = edges
    .map((e) => {
      const a = e.a < e.b ? e.a : e.b
      const b = e.a < e.b ? e.b : e.a
      const kind = e.kind || "soft"
      return `${a}\t${b}\t${kind}\t${e.score.toFixed(3)}`
    })
    .slice()
    .sort()
    .join("|")
  return `${ids}#${degs}#${es}`
}

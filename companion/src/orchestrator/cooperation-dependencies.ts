type DependencyIntent = { id: string; status: string; depends_on_intent_ids?: string[] }

/** Deterministic dependency validation; no dispatch / polling / mutation. */
export function dependencyReadiness(id: string, intents: DependencyIntent[]): { ready: boolean; reason: "ready" | "pending" | "missing" | "cycle" | "abandoned"; blockers: string[] } {
  const index = new Map(intents.map(i => [i.id, i]))
  const seen = new Set<string>(), visiting = new Set<string>()
  let problem: "missing" | "cycle" | null = null
  let problemKey = id
  function visit(key: string): void {
    if (visiting.has(key)) { problem = "cycle"; problemKey = key; return }
    if (seen.has(key) || problem) return
    const node = index.get(key)
    if (!node) { problem = "missing"; problemKey = key; return }
    visiting.add(key)
    for (const dep of node.depends_on_intent_ids ?? []) visit(dep)
    visiting.delete(key); seen.add(key)
  }
  visit(id)
  if (problem) return { ready: false, reason: problem, blockers: [problemKey] }
  const blockers = (index.get(id)?.depends_on_intent_ids ?? []).filter(dep => index.get(dep)?.status !== "done")
  return { ready: !blockers.length, reason: !blockers.length ? "ready" : blockers.some(dep => index.get(dep)?.status === "abandoned") ? "abandoned" : "pending", blockers }
}

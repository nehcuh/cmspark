import { displayThreadTitle, type TimelineThread } from "./thread-timeline"

type TaskRow = TimelineThread & { trashed_at?: string | null }
export type TaskRelationship =
  | { kind: "normal"; title: string }
  | { kind: "child"; title: string; parentTitle?: string; parentId?: string; availability: "available" | "missing" | "trashed" | "invalid" }

/** Full Thread metadata wins; Fleet is only an exact-ID fallback for the active row. */
export function resolveTaskRelationship(activeId: string | null, threads: readonly TaskRow[], fleet: readonly TaskRow[] = []): TaskRelationship {
  const rows = new Map(threads.map(row => [row.id, row]))
  const active = activeId ? rows.get(activeId) || fleet.find(row => row.id === activeId) : undefined
  if (!active) return { kind: "normal", title: "新对话" }
  const parentId = active.parent_thread_id || undefined
  const child = active.agent_role === "worker" || Boolean(parentId)
  if (!child) return { kind: "normal", title: displayThreadTitle(active) }
  const title = active.worker_role_label?.trim() || displayThreadTitle(active)
  const parent = parentId ? rows.get(parentId) : undefined
  const base = { kind: "child" as const, title, ...(parent ? { parentTitle: displayThreadTitle(parent) } : {}) }
  // Walk only known explicit relations. No inference from titles, run IDs or roles.
  const seen = new Set([active.id])
  let cursor = parentId
  while (cursor) {
    if (seen.has(cursor)) return { ...base, availability: "invalid" }
    seen.add(cursor)
    cursor = rows.get(cursor)?.parent_thread_id || undefined
  }
  if (!parent) return { ...base, availability: "missing" }
  if (parent.trashed_at) return { ...base, availability: "trashed" }
  return { ...base, parentId: parent.id, availability: "available" }
}

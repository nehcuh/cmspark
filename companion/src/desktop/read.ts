import { peekThreadDistilled, searchThreadRows, normalizeSearchQuery, SUMMONER_SEARCH_LIMIT_DEFAULT, SUMMONER_PEEK_MAX_CHARS } from "../summoner/read-search"
import { SUMMONER_RAIL_LIST_CAP } from "../summoner/protocol"
import { redactSecrets } from "../threads/distill"
import type { DesktopResourceStore } from "../skills/desktop-resource-store"

export type DesktopReadServices = {
  threads: {
    desktopMetadataSnapshot(): Array<{ id: string; alias: string; updated_at: string; user_tags?: string[]; topic_folder?: string | null }>
    get(id: string): { alias?: string | null; digest?: any; user_tags?: string[]; topic_folder?: string | null; trashed_at?: string | null } | undefined
    updateDesktopMetadata?(id: string, patch: Record<string, unknown>): { alias?: string | null; user_tags?: string[]; topic_folder?: string | null } | undefined
    getMessages(id: string): Array<{ role?: string; content?: unknown }>
  }
  skills: { list(): unknown[]; listKnowledge(): unknown[]; createDesktopResourceStore?(): DesktopResourceStore }
  mcp: { listServers(): unknown[] }
}
function record(value: unknown): Record<string, any> { return value && typeof value === "object" && !Array.isArray(value) ? value : {} }
function text(value: unknown): string { return redactSecrets(typeof value === "string" ? value : "").text.slice(0, SUMMONER_PEEK_MAX_CHARS) }
function listed(type: string, key: string, rows: unknown[], map: (v: any) => unknown) {
  return { type, [key]: rows.slice(0, SUMMONER_RAIL_LIST_CAP).map(v => map(record(v))), truncated: rows.length > SUMMONER_RAIL_LIST_CAP }
}
/** Dedicated projection. Never call general handlers, broadcast or mutating list/purge. */
export function desktopRead(type: string, threadId: string | undefined, s: DesktopReadServices): Record<string, unknown> {
  switch (type) {
    case "system.ping": return { type: "system.pong" }
    case "thread.list": return listed(type, "threads", s.threads.desktopMetadataSnapshot(), v => ({ id: text(v.id), title: text(v.alias || v.id), updated_at: text(v.updated_at), user_tags: Array.isArray(v.user_tags) ? v.user_tags.slice(0, 20).map(text) : [], topic_folder: typeof v.topic_folder === "string" ? text(v.topic_folder) : null }))
    case "thread.peek": {
      const thread = threadId ? s.threads.get(threadId) : undefined
      if (!thread || !threadId) return { type: "desktop.error", error_code: "DESKTOP_THREAD_NOT_FOUND" }
      const p = peekThreadDistilled(threadId, thread, s.threads.getMessages(threadId))
      return { type: "thread.peek_result", ok: true, thread_id: p.thread_id, title: text(p.title), markdown: p.markdown, truncated: p.truncated, redacted_hits: p.redacted_hits }
    }
    case "mcp.list": return listed(type, "servers", s.mcp.listServers(), v => ({ id: text(v.name), name: text(v.name), status: ["disconnected", "connecting", "connected", "error", "dead"].includes(v.connection?.status) ? v.connection.status : "disconnected" }))
    case "skill.list": return listed(type, "skills", s.skills.list(), v => ({ id: text(v.id || v.name), name: text(v.name), title: text(v.title || v.name), description: text(v.description) }))
    case "knowledge.list": return listed(type, "docs", s.skills.listKnowledge(), v => ({ id: text(v.id || v.name), name: text(v.name), title: text(v.title || v.name), description: text(v.description) }))
    default: return { type: "desktop.error", error_code: "DESKTOP_METHOD_DENIED" }
  }
}

/** Native title-only read: fresh canonical metadata; no digest/body/list repair. */
export function desktopTitleSearch(query: string, limit: number = SUMMONER_SEARCH_LIMIT_DEFAULT, s: DesktopReadServices): Record<string, unknown> {
  const normalized = normalizeSearchQuery(query)
  const rows = s.threads.desktopMetadataSnapshot().map(row => ({ id: row.id, alias: text(row.alias || row.id), updated_at: row.updated_at }))
  const hits = normalized ? searchThreadRows(rows, normalized, limit + 1) : []
  return { type: "thread.search_result", threads: hits.slice(0, limit).map(hit => ({ id: text(hit.thread_id), title: text(hit.title), updated_at: text(hit.updated_at) })), truncated: hits.length > limit }
}

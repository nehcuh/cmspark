import { peekThreadDistilled, SUMMONER_PEEK_MAX_CHARS } from "../summoner/read-search"
import { SUMMONER_RAIL_LIST_CAP } from "../summoner/protocol"
import { redactSecrets } from "../threads/distill"

export type DesktopReadServices = {
  threads: {
    desktopMetadataSnapshot(): Array<{ id: string; alias: string; updated_at: string }>
    get(id: string): { alias?: string | null; digest?: any } | undefined
    getMessages(id: string): Array<{ role?: string; content?: unknown }>
  }
  skills: { list(): unknown[]; listKnowledge(): unknown[] }
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
    case "thread.list": return listed(type, "threads", s.threads.desktopMetadataSnapshot(), v => ({ id: text(v.id), title: text(v.alias || v.id), updated_at: text(v.updated_at) }))
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

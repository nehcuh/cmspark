/** Permanent thread organization on the canonical index, never a trash alias. */
import { randomBytes } from "node:crypto"
import { ThreadManager, type ThreadArchiveSnapshot } from "../threads/thread-manager"
import { redactSecrets } from "../threads/distill"
import { normalizeSearchQuery, searchThreadRows, SUMMONER_PEEK_MAX_CHARS } from "../summoner/read-search"
import { SUMMONER_RAIL_LIST_CAP } from "../summoner/protocol"

export const DESKTOP_ARCHIVE_METHODS = ["desktop.archive.list", "desktop.archive.state", "desktop.archive.set"] as const
type Frame = Record<string, unknown>
type Activity = "idle" | "busy" | "unknown"
export type ArchiveStore = Pick<ThreadManager, "desktopArchiveSnapshot" | "setDesktopArchive">
const failureCodes = new Set(["DESKTOP_ARCHIVE_INPUT_INVALID", "DESKTOP_ARCHIVE_METHOD_DENIED", "DESKTOP_ARCHIVE_STALE", "DESKTOP_ARCHIVE_NOT_FOUND", "DESKTOP_ARCHIVE_CONFLICT", "DESKTOP_ARCHIVE_BUSY", "DESKTOP_ARCHIVE_ACTIVITY_UNKNOWN", "DESKTOP_ARCHIVE_UNAVAILABLE", "DESKTOP_ARCHIVE_SAVE_UNCONFIRMED"])
const text = (value: string) => redactSecrets(value).text.slice(0, SUMMONER_PEEK_MAX_CHARS)
const safeId = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 64 && !/[^a-zA-Z0-9_-]/.test(value) && ThreadManager.isSafeThreadId(value)
function exact(value: Frame, keys: string[]) { return Object.keys(value).length === keys.length && keys.every(k => Object.hasOwn(value, k)) }

export function createDesktopArchive(opts: { threads: ArchiveStore; current(method: string): boolean; activity?: (id: string) => Activity }) {
  let snapshot: { revision: string; target: ThreadArchiveSnapshot } | undefined
  function activity(id: string): Activity {
    try { const value = opts.activity?.(id); return value === "busy" || value === "idle" ? value : "unknown" } catch { return "unknown" }
  }
  return {
    cancel() { snapshot = undefined },
    handle(frame: Frame): Frame {
      const method = String(frame.type)
      const fail = (code: string): Frame => ({ type: method + ".result", id: frame.id, ...(Object.hasOwn(frame, "thread_id") ? { thread_id: frame.thread_id } : {}), ok: false, ...(method === DESKTOP_ARCHIVE_METHODS[2] ? { saved: false } : {}), error_code: failureCodes.has(code) ? code : "DESKTOP_ARCHIVE_UNAVAILABLE" })
      const isList = method === DESKTOP_ARCHIVE_METHODS[0], isState = method === DESKTOP_ARCHIVE_METHODS[1], isSet = method === DESKTOP_ARCHIVE_METHODS[2]
      if (!isList && !isState && !isSet) return fail("DESKTOP_ARCHIVE_METHOD_DENIED")
      const keys = isList ? ["type", "id", ...(Object.hasOwn(frame, "query") ? ["query"] : [])] : isState ? ["type", "id", "thread_id"] : ["type", "id", "thread_id", "revision", "archived"]
      if (!exact(frame, keys) || typeof frame.id !== "string" || !frame.id || frame.id.length > 200 || (isList && Object.hasOwn(frame, "query") && (typeof frame.query !== "string" || frame.query.length > 120)) || (!isList && !safeId(frame.thread_id)) || (isSet && (typeof frame.revision !== "string" || frame.revision.length !== 64 || /[^0-9a-f]/.test(frame.revision) || typeof frame.archived !== "boolean"))) return fail("DESKTOP_ARCHIVE_INPUT_INVALID")
      if (!opts.current(method)) return fail("DESKTOP_ARCHIVE_STALE")
      // Valid owned state refresh retires the old revision even on a missing or
      // unreadable new target. Set consumes once before any persistence attempt.
      const previous = snapshot
      if (isState || isSet) snapshot = undefined
      try {
        if (isList) {
          const rows = opts.threads.desktopArchiveSnapshot().filter(t => !!t.archived_at).map(t => ({ id: t.id, alias: text(t.alias || t.id), updated_at: text(t.updated_at) }))
          const query = typeof frame.query === "string" ? normalizeSearchQuery(frame.query) : ""
          const exactId = query && safeId(query) ? rows.find(t => t.id === query) : undefined
          const hits = exactId ? [exactId] : query ? searchThreadRows(rows, query, SUMMONER_RAIL_LIST_CAP + 1).map(h => ({ id: h.thread_id, alias: h.title, updated_at: h.updated_at || "" })) : rows
          if (!opts.current(method)) return fail("DESKTOP_ARCHIVE_STALE")
          return { type: method + ".result", id: frame.id, ok: true, threads: hits.slice(0, SUMMONER_RAIL_LIST_CAP).map(t => ({ id: t.id, title: t.alias, updated_at: t.updated_at, archived: true })), truncated: hits.length > SUMMONER_RAIL_LIST_CAP }
        }
        if (isState) {
          const target = opts.threads.desktopArchiveSnapshot().find(t => t.id === frame.thread_id)
          if (!target) return fail("DESKTOP_ARCHIVE_NOT_FOUND")
          const status = activity(target.id)
          if (!opts.current(method)) return fail("DESKTOP_ARCHIVE_STALE")
          snapshot = { revision: randomBytes(32).toString("hex"), target }
          return { type: method + ".result", id: frame.id, thread_id: target.id, ok: true, state: { archived: !!target.archived_at, title: text(target.alias || target.id), revision: snapshot.revision, activity: status } }
        }
        if (!previous || previous.revision !== frame.revision || previous.target.id !== frame.thread_id) return fail("DESKTOP_ARCHIVE_STALE")
        const status = activity(previous.target.id)
        if (status !== "idle") return fail(status === "busy" ? "DESKTOP_ARCHIVE_BUSY" : "DESKTOP_ARCHIVE_ACTIVITY_UNKNOWN")
        if (!opts.current(method)) return fail("DESKTOP_ARCHIVE_STALE")
        try {
          const saved = opts.threads.setDesktopArchive(previous.target.id, previous.target, frame.archived as boolean)
          if (!opts.current(method)) return fail("DESKTOP_ARCHIVE_SAVE_UNCONFIRMED")
          return { type: method + ".result", id: frame.id, thread_id: saved.id, ok: true, saved: true, archived: !!saved.archived_at }
        } catch (error) {
          const code = error instanceof Error ? error.message : ""
          return fail(code === "DESKTOP_ARCHIVE_CONFLICT" || code === "DESKTOP_ARCHIVE_NOT_FOUND" || code === "DESKTOP_ARCHIVE_UNAVAILABLE" ? code : "DESKTOP_ARCHIVE_SAVE_UNCONFIRMED")
        }
      } catch { return fail("DESKTOP_ARCHIVE_UNAVAILABLE") }
    },
  }
}

/** Only three user metadata fields, on the existing canonical manager. */
import { summonerThreadMetadata } from "../threads/metadata-patch"
import { ThreadManager } from "../threads/thread-manager"
import { redactSecrets } from "../threads/distill"
import type { DesktopReadServices } from "./read"

type Metadata = { alias: string; user_tags: string[]; topic_folder: string | null }
type Frame = Record<string, unknown>
const methods = ["desktop.thread.metadata.edit", "desktop.thread.metadata.save"]
function exact(value: Frame, keys: string[]) { return Object.keys(value).length === keys.length && keys.every(k => Object.prototype.hasOwnProperty.call(value, k)) }
function project(value: { alias?: string | null; user_tags?: string[]; topic_folder?: string | null }): Metadata {
  const alias = value.alias || "", tags = value.user_tags || [], folder = value.topic_folder || null
  if (typeof alias !== "string" || !Array.isArray(tags) || tags.some(t => typeof t !== "string") || (folder !== null && typeof folder !== "string")) throw Error("DESKTOP_METADATA_UNAVAILABLE")
  if ([alias, ...tags, folder || ""].some(t => redactSecrets(t).hits > 0)) throw Error("DESKTOP_METADATA_REDACTED")
  const normalized = summonerThreadMetadata({ user_tags: tags, topic_folder: folder })
  return { alias: alias.slice(0, 200), user_tags: normalized.user_tags as string[], topic_folder: normalized.topic_folder as string | null }
}
/** The schema excludes nested objects; count decoded top-level keys too, because
 * JSON.parse alone collapses duplicate and escaped-duplicate property names. */
export function parseDesktopMetadataPayload(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== "string") return null
  try {
    const value = JSON.parse(raw)
    const normalized = summonerThreadMetadata(value)
    project(value) // Inspect raw submitted labels too, before truncation can hide a secret.
    let depth = 0, arrays = 0; const seen = new Set<string>()
    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i]
      if (ch === '"') {
        const start = i++
        while (i < raw.length) { if (raw[i] === "\\") { i += 2; continue }; if (raw[i] === '"') break; i++ }
        let next = i + 1; while (next < raw.length && /\s/.test(raw[next])) next++
        if (depth === 1 && arrays === 0 && raw[next] === ":") {
          const key = JSON.parse(raw.slice(start, i + 1)); if (seen.has(key)) return null; seen.add(key)
        }
      } else if (ch === "{") depth++
      else if (ch === "}") depth--
      else if (ch === "[") arrays++
      else if (ch === "]") arrays--
    }
    return normalized
  } catch (error) {
    if (error instanceof Error && error.message === "DESKTOP_METADATA_REDACTED") throw error
    return null
  }
}
export function desktopThreadMetadata(frame: Frame, services: DesktopReadServices, current: () => boolean): Frame {
  const fail = (error_code: string): Frame => ({ type: String(frame.type) + ".result", id: frame.id, thread_id: frame.thread_id, ok: false, ...(frame.type === methods[1] ? { saved: false } : {}), error_code })
  if (!methods.includes(String(frame.type)) || !exact(frame, frame.type === methods[0] ? ["type", "id", "thread_id"] : ["type", "id", "thread_id", "payload_json"]) || typeof frame.id !== "string" || !frame.id || frame.id.length > 200 || typeof frame.thread_id !== "string" || !ThreadManager.isSafeThreadId(frame.thread_id)) return fail("DESKTOP_METADATA_INPUT_INVALID")
  if (!current()) return fail("DESKTOP_METADATA_STALE")
  // Unlike get(), this projection never seeds run_progress or repairs rows.
  const target = services.threads.desktopMetadataSnapshot().find(t => t.id === frame.thread_id)
  if (!target) return fail("DESKTOP_METADATA_UNAVAILABLE")
  try {
    const existing = project(target)
    if (frame.type === methods[0]) return { type: methods[0] + ".result", id: frame.id, thread_id: frame.thread_id, ok: true, metadata: existing }
    const patch = parseDesktopMetadataPayload(frame.payload_json)
    if (!patch) return fail("DESKTOP_METADATA_INPUT_INVALID")
    project({ ...existing, ...patch }) // Reject redaction before any store change.
    if (!current() || !services.threads.updateDesktopMetadata) return fail("DESKTOP_METADATA_STALE")
    const updated = services.threads.updateDesktopMetadata(frame.thread_id, patch)
    if (!updated) return fail("DESKTOP_METADATA_UNAVAILABLE")
    if (!current()) return fail("DESKTOP_METADATA_STALE") // committed but unacknowledged; never replay.
    return { type: methods[1] + ".result", id: frame.id, thread_id: frame.thread_id, ok: true, saved: true, metadata: project(updated) }
  } catch (error) {
    return fail(error instanceof Error && error.message === "DESKTOP_METADATA_REDACTED" ? "DESKTOP_METADATA_REDACTED" : "DESKTOP_METADATA_SAVE_UNCONFIRMED")
  }
}

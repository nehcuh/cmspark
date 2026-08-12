/**
 * Meeting live capture / import duration caps (P1 near-rt + P2 long session).
 * Dictation+ keeps VOICE_CONTINUOUS_* (15/30 min); meetings are independent.
 */

/** Live meeting soft hint (wall clock). */
export const MEETING_LIVE_SOFT_CAP_MS = 2 * 60 * 60_000

/** Live meeting hard stop (wall clock). Supports 2–3h product target. */
export const MEETING_LIVE_HARD_CAP_MS = 3 * 60 * 60_000

/** Absolute max for live hard cap (safety clamp). */
export const MEETING_LIVE_HARD_CAP_MAX_MS = 3 * 60 * 60_000

/**
 * Near-real-time meeting STT: progressive hypothesis (streamPartial) + ~8s finals.
 * Not word-level decoder streaming; large-v3-turbo remains final-only on companion.
 */
export const MEETING_NEAR_REALTIME_DEFAULT = true

/** Upload path: max decoded duration (matches live hard cap). */
export const MEETING_AUDIO_IMPORT_MAX_DURATION_SEC = MEETING_LIVE_HARD_CAP_MS / 1000

/**
 * Upload path: max file bytes before decode.
 * 3h mono 16k s16 raw ≈ 345MB; compressed sources are smaller — 200MB soft reject.
 */
export const MEETING_AUDIO_IMPORT_MAX_FILE_BYTES = 200 * 1024 * 1024

/** Format wall clock for meeting status (m:ss or h:mm:ss). */
export function formatMeetingElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${r.toString().padStart(2, "0")}`
  }
  return `${m}:${r.toString().padStart(2, "0")}`
}

/** Clamp meeting hard cap into product range. */
export function clampMeetingHardCapMs(hardCapMs: number): number {
  const n = Number.isFinite(hardCapMs) ? hardCapMs : MEETING_LIVE_HARD_CAP_MS
  return Math.min(Math.max(n, 60_000), MEETING_LIVE_HARD_CAP_MAX_MS)
}

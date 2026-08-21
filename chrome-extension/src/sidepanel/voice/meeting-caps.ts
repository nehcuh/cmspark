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

/**
 * If 「结束并生成纪要」 stays in stopping because the STT adapter hung
 * (Companion restart mid-window), force-finalize after this wall time.
 * Longer than LOCAL_STT_STOP_GRACE_MS (12s) so a live last-window infer can finish.
 */
export const MEETING_STOP_FAILSAFE_MS = 20_000

/**
 * Companion WS blips are ~1s; a SIGTERM restart was ~18s. After this of
 * disconnect while still capturing, force-finalize so the UI cannot stay on
 * 「正在听」 waiting for a dead STT session.
 */
export const MEETING_DISCONNECT_FINALIZE_MS = 5_000

/** If minutes_result never arrives (WS drop after send), unblock 「生成会议纪要」. */
export const MEETING_MINUTES_WATCHDOG_MS = 90_000

/** Companion down: do not leave busy/pendingGenerate stuck on a dropped WS send. */
export function meetingMinutesSendPlan(connected: boolean): "send" | "defer-reconnect" {
  return connected ? "send" : "defer-reconnect"
}

export type MeetingCapturePhase = "idle" | "starting" | "recording" | "processing" | "stopping"

/** Copy under the live transcript while capturing. */
export function meetingLiveInterimHint(opts: {
  phase: MeetingCapturePhase
  interimText: string
  nearRealtime: boolean
  refinePending: number
}): string {
  const extra = opts.refinePending > 0 ? ` · AI 纠错中(${opts.refinePending})` : ""
  if (opts.interimText.trim()) return `识别中… ${opts.interimText.trim()}${extra}`
  if (opts.phase === "stopping") return `正在结束…等待最后一段识别${extra}`
  if (opts.phase === "processing") return `分段识别中…${extra}`
  if (opts.phase === "starting") return `正在启动识别…${extra}`
  return (
    (opts.nearRealtime
      ? "正在听…约 8 秒出第一段字（渐进假设，非字级流式）"
      : "正在听…本段结束后出字") + extra
  )
}

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

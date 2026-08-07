/**
 * Path B local STT — pure capability detection (Spike S0/S1).
 * No DOM side effects beyond reading the provided globals.
 */

export type LocalMediaSupport =
  | { ok: true }
  | { ok: false; reason: "no_media_devices" | "no_get_user_media" | "no_media_recorder" }

/** Feature-detect getUserMedia + MediaRecorder on a window-like global. */
export function detectLocalMediaCapture(g: {
  navigator?: { mediaDevices?: { getUserMedia?: unknown } }
  MediaRecorder?: unknown
}): LocalMediaSupport {
  const md = g.navigator?.mediaDevices
  if (!md || typeof md !== "object") {
    return { ok: false, reason: "no_media_devices" }
  }
  if (typeof (md as { getUserMedia?: unknown }).getUserMedia !== "function") {
    return { ok: false, reason: "no_get_user_media" }
  }
  if (typeof g.MediaRecorder !== "function") {
    return { ok: false, reason: "no_media_recorder" }
  }
  return { ok: true }
}

/** SoT: 16 kHz mono PCM (ADR-023 L4). */
export const LOCAL_STT_SAMPLE_RATE = 16_000
export const LOCAL_STT_CHANNELS = 1

/** Record hard cap (ms) — same as M1 listen cap. */
export const LOCAL_STT_MAX_RECORD_MS = 45_000

/**
 * Session raw PCM budget (bytes) for 45s s16le mono + slack.
 * 16000 * 2 * 45 = 1_440_000; SoT suggests ≤ 2.5MB raw.
 */
export const LOCAL_STT_MAX_PCM_BYTES = 2_500_000

/** Per-chunk base64 payload cap before WS (decoded raw bytes). */
export const LOCAL_STT_MAX_CHUNK_RAW_BYTES = 256 * 1024

/** Estimate PCM s16le mono size for durationMs at sampleRate. */
export function estimatePcmS16leBytes(
  durationMs: number,
  sampleRate = LOCAL_STT_SAMPLE_RATE,
  channels = LOCAL_STT_CHANNELS,
): number {
  const sec = Math.max(0, durationMs) / 1000
  return Math.ceil(sec * sampleRate * channels * 2)
}

/** True if estimated capture fits SoT session budget. */
export function pcmWithinSessionBudget(durationMs: number): boolean {
  return estimatePcmS16leBytes(durationMs) <= LOCAL_STT_MAX_PCM_BYTES
}

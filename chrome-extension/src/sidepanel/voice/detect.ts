/**
 * Voice input — pure capability detection (M0.5 spike / M1).
 * No DOM side effects beyond reading the provided global.
 */

export type SpeechRecognitionCtor = new () => SpeechRecognitionLike

/** Minimal shape we need from the Web Speech API (browser-supplied). */
export interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start: () => void
  stop: () => void
  abort: () => void
  onstart: ((this: SpeechRecognitionLike, ev: Event) => void) | null
  onend: ((this: SpeechRecognitionLike, ev: Event) => void) | null
  onerror: ((this: SpeechRecognitionLike, ev: SpeechRecognitionErrorEventLike) => void) | null
  onresult: ((this: SpeechRecognitionLike, ev: SpeechRecognitionResultEventLike) => void) | null
}

export interface SpeechRecognitionErrorEventLike {
  error: string
  message?: string
}

export interface SpeechRecognitionResultEventLike {
  resultIndex: number
  results: ArrayLike<{
    isFinal: boolean
    0: { transcript: string; confidence: number }
    length: number
  }>
}

export type VoiceSupport =
  | { ok: true; ctorName: "SpeechRecognition" | "webkitSpeechRecognition" }
  | { ok: false; reason: "missing_ctor" }

/** Feature-detect Web Speech recognition on a window-like global. */
export function detectSpeechRecognition(g: {
  SpeechRecognition?: SpeechRecognitionCtor
  webkitSpeechRecognition?: SpeechRecognitionCtor
}): VoiceSupport {
  if (typeof g.SpeechRecognition === "function") {
    return { ok: true, ctorName: "SpeechRecognition" }
  }
  if (typeof g.webkitSpeechRecognition === "function") {
    return { ok: true, ctorName: "webkitSpeechRecognition" }
  }
  return { ok: false, reason: "missing_ctor" }
}

/** Resolve constructor or null. */
export function getSpeechRecognitionCtor(g: {
  SpeechRecognition?: SpeechRecognitionCtor
  webkitSpeechRecognition?: SpeechRecognitionCtor
}): SpeechRecognitionCtor | null {
  const d = detectSpeechRecognition(g)
  if (!d.ok) return null
  return d.ctorName === "SpeechRecognition"
    ? (g.SpeechRecognition as SpeechRecognitionCtor)
    : (g.webkitSpeechRecognition as SpeechRecognitionCtor)
}

/** Tier-1 browser heuristic (SoT: Google Chrome desktop primary). */
export function isLikelyTier1Chrome(userAgent: string): boolean {
  const ua = userAgent || ""
  // Chrome but not Edge/Opera/Chromium-only brand tricks: require Chrome/ and exclude Edg/
  if (!/Chrome\/\d+/i.test(ua)) return false
  if (/Edg\//i.test(ua)) return false
  if (/OPR\//i.test(ua)) return false
  // Electron / embedded
  if (/Electron/i.test(ua)) return false
  return true
}

/** Classic (M1) hard max listen session (ms). */
export const VOICE_MAX_LISTEN_MS = 45_000

/**
 * Dictation+ mode (SoT 2026-08-07).
 * classic = M1 45s no onend restart; continuous = opt-in long listen (browser restart).
 */
export type VoiceDictationMode = "classic" | "continuous"

export const VOICE_DICTATION_MODE_DEFAULT: VoiceDictationMode = "classic"

/** Continuous soft prompt (ms) — still listening, do not stop. */
export const VOICE_CONTINUOUS_SOFT_CAP_MS = 5 * 60_000

/** Continuous hard stop default (ms). */
export const VOICE_CONTINUOUS_HARD_CAP_MS = 15 * 60_000

/** Continuous hard stop absolute max configurable (ms). */
export const VOICE_CONTINUOUS_HARD_CAP_MAX_MS = 30 * 60_000

/** Default recognition language (M1 locked). */
export const VOICE_DEFAULT_LANG = "zh-CN"

export function normalizeDictationMode(v: unknown): VoiceDictationMode {
  return v === "continuous" ? "continuous" : "classic"
}

/** Max listen wall-clock for a session given mode + engine. */
export function maxListenMsForSession(
  mode: VoiceDictationMode,
  engine: "browser" | "local",
  hardCapMs: number = VOICE_CONTINUOUS_HARD_CAP_MS,
): number {
  // D1a/D1c: continuous (browser restart or local serial segments) uses hard cap.
  if (mode === "continuous") {
    const cap = Math.min(
      Math.max(hardCapMs, VOICE_MAX_LISTEN_MS),
      VOICE_CONTINUOUS_HARD_CAP_MAX_MS,
    )
    return cap
  }
  void engine
  return VOICE_MAX_LISTEN_MS
}

/** Per-segment local STT window (must stay ≤ companion STT_MAX_RECORD_MS). */
export const LOCAL_CONTINUOUS_SEGMENT_MS = 45_000

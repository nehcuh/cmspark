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

/** SoT hard max listen session (ms). */
export const VOICE_MAX_LISTEN_MS = 45_000

/** Default recognition language (M1 locked). */
export const VOICE_DEFAULT_LANG = "zh-CN"

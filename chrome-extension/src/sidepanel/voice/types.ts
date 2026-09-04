/** Voice input session types (M1) — ephemeral SM only. */

export type VoicePhase =
  | "unsupported"
  | "idle"
  | "starting"
  | "listening"
  | "processing"
  | "stopping"
  /** Dictation+ D1b: post-stop ASR Refiner in flight. */
  | "refining"
  | "error"

export type VoiceAbortReason =
  | null
  | "user"
  | "chat_abort"
  | "thread_switch"
  | "timeout"
  | "unmount"
  | "engine"

export type VoiceSessionState = {
  phase: VoicePhase
  sessionId: string | null
  baseText: string
  finals: string[]
  interim: string
  abortReason: VoiceAbortReason
  /** True once draft merge applied for this session */
  committed: boolean
  banner: string | null
  errorCode: string | null
  /** D1b: generation for ASR refine request/result. */
  refineGen: number | null
  /** D1b: raw merged draft after STT (before refine); for undo + dirty check. */
  rawSnapshot: string | null
}

export type VoiceEvent =
  | { type: "FEATURE_UNSUPPORTED" }
  | { type: "USER_TOGGLE_START"; sessionId: string; baseText: string }
  | { type: "USER_TOGGLE_STOP" }
  /** Local STT: capture ended → upload/infer (listening → processing). Browser path skips this. */
  | { type: "CAPTURE_STOPPED" }
  | { type: "CHAT_ABORT" }
  | { type: "THREAD_SWITCH" }
  /** Hard cap stop. code: timeout | continuous-timeout for banner copy. */
  | { type: "TIMEOUT"; code?: string }
  /** Dictation+ continuous: soft cap hint (still listening). */
  /** Dictation+ continuous: soft cap hint (still listening). Optional code for CTA (e.g. local_fallback). */
  | { type: "SOFT_CAP_HINT"; message: string; code?: string }
  | { type: "ENGINE_START" }
  | { type: "ENGINE_RESULT"; interim?: string; finalChunk?: string; postprocessed?: boolean }
  | { type: "ENGINE_ERROR"; code: string; message?: string }
  | { type: "ENGINE_END" }
  /** After raw merge: enter refining (refineGen assigned). */
  | { type: "START_REFINE"; refineGen: number; rawSnapshot: string }
  | { type: "REFINE_OK"; refineGen: number; text: string; unchanged?: boolean }
  | { type: "REFINE_FAIL"; refineGen: number; code?: string; message?: string }
  | { type: "CANCEL_REFINE" }
  /** Local continuous D1c: segment done; resume listening chrome. */
  | { type: "SEGMENT_CONTINUE" }
  | { type: "DISMISS_BANNER" }
  | { type: "UNMOUNT" }

export function initialVoiceSession(supported: boolean): VoiceSessionState {
  return {
    phase: supported ? "idle" : "unsupported",
    sessionId: null,
    baseText: "",
    finals: [],
    interim: "",
    abortReason: null,
    committed: false,
    banner: null,
    errorCode: null,
    refineGen: null,
    rawSnapshot: null,
  }
}

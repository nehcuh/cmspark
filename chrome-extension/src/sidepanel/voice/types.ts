/** Voice input session types (M1) — ephemeral SM only. */

export type VoicePhase =
  | "unsupported"
  | "idle"
  | "starting"
  | "listening"
  | "stopping"
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
}

export type VoiceEvent =
  | { type: "FEATURE_UNSUPPORTED" }
  | { type: "USER_TOGGLE_START"; sessionId: string; baseText: string }
  | { type: "USER_TOGGLE_STOP" }
  | { type: "CHAT_ABORT" }
  | { type: "THREAD_SWITCH" }
  | { type: "TIMEOUT" }
  | { type: "ENGINE_START" }
  | { type: "ENGINE_RESULT"; interim?: string; finalChunk?: string }
  | { type: "ENGINE_ERROR"; code: string; message?: string }
  | { type: "ENGINE_END" }
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
  }
}

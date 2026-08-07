/**
 * Pure voice session state machine (M1).
 * Abort reasons chat_abort / thread_switch / unmount discard finals (no draft merge).
 */

import { mapLocalSttError, mapSpeechError } from "./error-map"
import { isEmptyFinals } from "./text-merge"
import {
  initialVoiceSession,
  type VoiceEvent,
  type VoiceSessionState,
} from "./types"

/** Path B local STT codes (SoT §6.5) — route via mapLocalSttError. */
const LOCAL_STT_ERROR_CODES = new Set([
  "empty_result",
  "model_missing",
  "binary_missing",
  "hash_fail",
  "companion_disconnected",
  "session_busy",
  "payload_too_large",
  "infer_timeout",
  "resource_conflict",
  "oom",
  "origin_denied",
  "total_seq_mismatch",
  "invalid_session_id",
])

/** Side Panel / MV3 always has navigator; keep pure-friendly for unit tests. */
function mapVoiceError(code: string) {
  const c = (code || "").toLowerCase()
  if (c === "aborted") {
    return { severity: "silent" as const, message: "" }
  }
  if (LOCAL_STT_ERROR_CODES.has(c)) {
    const local = mapLocalSttError(code)
    return {
      severity: local.severity === "silent" ? ("silent" as const) : ("error" as const),
      message: local.message,
    }
  }
  return mapSpeechError(code, {
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
  })
}

function resetToIdle(
  s: VoiceSessionState,
  patch: Partial<VoiceSessionState> = {},
): VoiceSessionState {
  return {
    ...initialVoiceSession(s.phase !== "unsupported"),
    phase: s.phase === "unsupported" ? "unsupported" : "idle",
    ...patch,
  }
}

/** Whether ENGINE_END should apply draft merge (not abort paths). */
export function shouldApplyDraft(s: VoiceSessionState): boolean {
  if (s.committed) return false
  if (s.abortReason === "chat_abort") return false
  if (s.abortReason === "thread_switch") return false
  if (s.abortReason === "unmount") return false
  return true
}

export function reduceVoiceSession(
  state: VoiceSessionState,
  event: VoiceEvent,
): VoiceSessionState {
  if (state.phase === "unsupported" && event.type !== "FEATURE_UNSUPPORTED") {
    return state
  }

  switch (event.type) {
    case "FEATURE_UNSUPPORTED":
      return initialVoiceSession(false)

    case "USER_TOGGLE_START": {
      if (state.phase !== "idle" && state.phase !== "error") return state
      return {
        ...state,
        phase: "starting",
        sessionId: event.sessionId,
        baseText: event.baseText,
        finals: [],
        interim: "",
        abortReason: null,
        committed: false,
        banner: null,
        errorCode: null,
      }
    }

    case "USER_TOGGLE_STOP": {
      // Stuck in stopping (engine never fired onend) → force idle so mic recovers
      if (state.phase === "stopping") {
        return resetToIdle(state, { banner: state.banner })
      }
      // Local STT: cancel upload/infer mid-processing — abort-ish, no draft merge
      if (state.phase === "processing") {
        return {
          ...state,
          phase: "stopping",
          abortReason: "user",
          interim: "",
          // Suppress merge on ENGINE_END (same effect as hard abort for draft)
          committed: true,
        }
      }
      // Browser Web Speech: listening/starting → stopping (not processing)
      if (state.phase !== "listening" && state.phase !== "starting") return state
      return {
        ...state,
        phase: "stopping",
        abortReason: state.abortReason ?? "user",
      }
    }

    case "CAPTURE_STOPPED": {
      // Local adapter only: capture ended → processing until result/error
      if (state.phase !== "listening") return state
      return {
        ...state,
        phase: "processing",
        interim: "",
      }
    }

    case "CHAT_ABORT": {
      if (
        state.phase === "idle" ||
        state.phase === "unsupported" ||
        state.phase === "error"
      ) {
        return state
      }
      return {
        ...state,
        phase: "stopping",
        abortReason: "chat_abort",
        interim: "",
      }
    }

    case "THREAD_SWITCH":
    case "UNMOUNT": {
      if (
        state.phase === "idle" ||
        state.phase === "unsupported" ||
        state.phase === "error"
      ) {
        return resetToIdle(state)
      }
      return {
        ...state,
        phase: "stopping",
        abortReason: event.type === "UNMOUNT" ? "unmount" : "thread_switch",
        interim: "",
      }
    }

    case "TIMEOUT": {
      // Pure reducer: listening/starting → stopping (browser). Local adapter may
      // stop capture on timeout then emit CAPTURE_STOPPED if still listening.
      if (state.phase !== "listening" && state.phase !== "starting") return state
      return {
        ...state,
        phase: "stopping",
        abortReason: "timeout",
      }
    }

    case "ENGINE_START": {
      if (state.phase !== "starting" && state.phase !== "listening") return state
      return { ...state, phase: "listening" }
    }

    case "ENGINE_RESULT": {
      if (
        state.phase !== "listening" &&
        state.phase !== "stopping" &&
        state.phase !== "starting" &&
        state.phase !== "processing"
      ) {
        return state
      }
      // Drop late results after hard abort (incl. user cancel mid-processing)
      if (
        state.abortReason === "chat_abort" ||
        state.abortReason === "thread_switch" ||
        state.abortReason === "unmount"
      ) {
        return state
      }
      if (state.committed) {
        return state
      }
      let finals = state.finals
      if (event.finalChunk && event.finalChunk.length > 0) {
        finals = [...finals, event.finalChunk]
      }
      return {
        ...state,
        finals,
        interim:
          event.interim !== undefined
            ? event.interim
            : event.finalChunk
              ? ""
              : state.interim,
      }
    }

    case "ENGINE_ERROR": {
      const mapped = mapVoiceError(event.code)
      if (event.code === "aborted" || mapped.severity === "silent") {
        return {
          ...state,
          phase: "stopping",
          abortReason: state.abortReason ?? "engine",
        }
      }
      // no-speech while listening → stop and empty banner via ENGINE_END path
      if (event.code === "no-speech") {
        return {
          ...state,
          phase: "stopping",
          abortReason: state.abortReason ?? "user",
          errorCode: "no-speech",
        }
      }
      // Error banner; preserve baseText (composer prefix). Clear session finals only.
      return {
        ...state,
        phase: "error",
        sessionId: null,
        interim: "",
        finals: [],
        abortReason: null,
        committed: false,
        banner: mapped.message,
        errorCode: event.code,
        // baseText intentionally preserved
      }
    }

    case "ENGINE_END": {
      if (state.phase === "idle" || state.phase === "unsupported") return state

      // Web Speech always pairs onerror → onend. ENGINE_ERROR may have set phase
      // "error" with the correct §6.6 banner; do not clobber with "未识别到内容".
      if (state.phase === "error") {
        return resetToIdle(state, {
          banner: state.banner,
          errorCode: state.errorCode,
        })
      }

      // Stopping after a hard engine error that kept finals cleared mid-stream
      if (
        state.errorCode &&
        state.errorCode !== "no-speech" &&
        state.errorCode !== "empty" &&
        state.errorCode !== "timeout"
      ) {
        const mapped = mapVoiceError(state.errorCode)
        return resetToIdle(state, {
          banner: mapped.message || state.banner,
          errorCode: state.errorCode,
        })
      }

      if (!shouldApplyDraft(state)) {
        return resetToIdle(state)
      }

      if (isEmptyFinals(state.finals) || state.errorCode === "no-speech") {
        const emptyMsg = mapVoiceError(
          state.errorCode === "no-speech" ? "no-speech" : "empty",
        ).message
        const timeoutBanner =
          state.abortReason === "timeout" ? mapVoiceError("timeout").message : null
        return resetToIdle(state, {
          banner: timeoutBanner || emptyMsg,
          baseText: state.baseText,
          finals: state.finals,
          committed: true,
        })
      }

      const timeoutBanner =
        state.abortReason === "timeout" ? mapVoiceError("timeout").message : null

      return resetToIdle(state, {
        baseText: state.baseText,
        finals: state.finals,
        committed: true,
        banner: timeoutBanner,
      })
    }

    case "DISMISS_BANNER":
      return { ...state, banner: null, errorCode: null }

    default:
      return state
  }
}

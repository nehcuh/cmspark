// #258 PTT dual-mode (hold + double-tap lock + accidental discard). Pure.
// Accidental <300ms must be silent: start/sfx/capsule only after the hold arms.

export const VOICE_PTT_ACCIDENTAL_MS = 300
export const VOICE_PTT_DOUBLE_TAP_MS = 300

export type PttPhase = "idle" | "holding" | "await_double" | "locked"

export type PttState = {
  phase: PttPhase
  downAt: number | null
  awaitUntil: number | null
  /** Capture/sfx/capsule allowed. False while still inside the accidental window. */
  armed: boolean
}

export type PttEvent =
  | { type: "down"; now: number }
  | { type: "up"; now: number }
  | { type: "esc"; now: number }
  | { type: "tick"; now: number }
  | { type: "blur"; now: number }

/** start/lock begin capture; commit ends + transcribes; discard aborts with zero UX. */
export type PttEffect = "none" | "start" | "commit" | "discard" | "lock"

export const initialPtt: PttState = { phase: "idle", downAt: null, awaitUntil: null, armed: false }

export function reducePtt(state: PttState, ev: PttEvent): { state: PttState; effect: PttEffect } {
  switch (ev.type) {
    case "down": {
      if (state.phase === "locked") {
        return { state: initialPtt, effect: "commit" }
      }
      if (state.phase === "await_double" && state.awaitUntil != null && ev.now <= state.awaitUntil) {
        return { state: { phase: "locked", downAt: ev.now, awaitUntil: null, armed: true }, effect: "lock" }
      }
      if (state.phase === "holding") {
        return { state, effect: "none" }
      }
      // Do NOT start capture yet — wait until the accidental window elapses (tick).
      return {
        state: {
          phase: "holding",
          downAt: ev.now,
          awaitUntil: ev.now + VOICE_PTT_ACCIDENTAL_MS,
          armed: false,
        },
        effect: "none",
      }
    }
    case "up": {
      if (state.phase === "locked") return { state, effect: "none" }
      if (state.phase !== "holding" || state.downAt == null) {
        return { state, effect: "none" }
      }
      if (!state.armed) {
        return {
          state: {
            phase: "await_double",
            downAt: null,
            awaitUntil: ev.now + VOICE_PTT_DOUBLE_TAP_MS,
            armed: false,
          },
          effect: "discard",
        }
      }
      return { state: initialPtt, effect: "commit" }
    }
    case "esc": {
      if (state.phase === "locked") return { state: initialPtt, effect: "commit" }
      if (state.phase === "holding") return { state: initialPtt, effect: "discard" }
      return { state: initialPtt, effect: "none" }
    }
    case "tick": {
      if (
        state.phase === "holding" &&
        !state.armed &&
        state.awaitUntil != null &&
        ev.now >= state.awaitUntil
      ) {
        return {
          state: { ...state, armed: true, awaitUntil: null },
          effect: "start",
        }
      }
      if (state.phase === "await_double" && state.awaitUntil != null && ev.now > state.awaitUntil) {
        return { state: initialPtt, effect: "none" }
      }
      return { state, effect: "none" }
    }
    case "blur": {
      if (state.phase === "locked") return { state: initialPtt, effect: "commit" }
      if (state.phase === "holding") {
        return state.armed
          ? { state: initialPtt, effect: "commit" }
          : { state: initialPtt, effect: "discard" }
      }
      if (state.phase === "await_double") return { state: initialPtt, effect: "none" }
      return { state, effect: "none" }
    }
    default:
      return { state, effect: "none" }
  }
}

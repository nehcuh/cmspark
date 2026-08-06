/**
 * Wire Web Speech adapter + pure SM for InputArea (M1).
 */

import { useCallback, useEffect, useRef, useState } from "react"
import {
  detectSpeechRecognition,
  VOICE_DEFAULT_LANG,
  VOICE_MAX_LISTEN_MS,
} from "../voice/detect"
import { reduceVoiceSession } from "../voice/session-reducer"
import { mergeFinalTranscript, isEmptyFinals } from "../voice/text-merge"
import { initialVoiceSession, type VoiceSessionState } from "../voice/types"
import { createWebSpeechAdapter, type SpeechAdapter } from "../voice/web-speech-adapter"

function newSessionId(): string {
  return `v-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export type UseVoiceInputOpts = {
  /** Composer text at listen start (snapshot). */
  getBaseText: () => string
  /** Apply merged draft (never auto-send). */
  onDraft: (text: string) => void
  /** Active thread — switch aborts. */
  threadId: string | null
  /** SoT: no start while threadBusy. */
  allowStart: boolean
  enabled: boolean
  privacyAck: boolean
  onNeedPrivacyAck: () => void
  onNeedPermissionBootstrap: () => void
}

export function useVoiceInput(opts: UseVoiceInputOpts) {
  const support = detectSpeechRecognition(
    typeof globalThis !== "undefined" ? (globalThis as any) : {},
  )
  const [session, setSession] = useState<VoiceSessionState>(() =>
    initialVoiceSession(support.ok),
  )
  const sessionRef = useRef(session)
  sessionRef.current = session
  const adapterRef = useRef<SpeechAdapter | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const threadRef = useRef(opts.threadId)
  const optsRef = useRef(opts)
  optsRef.current = opts

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  const dispatchEv = useCallback((event: Parameters<typeof reduceVoiceSession>[1]) => {
    setSession((prev) => {
      const next = reduceVoiceSession(prev, event)
      // Side effects after ENGINE_END commit
      if (
        event.type === "ENGINE_END" &&
        next.committed &&
        next.finals.length > 0 &&
        !isEmptyFinals(next.finals)
      ) {
        // Use prev session fields captured before reset — reduce already put base/finals on next
        const merged = mergeFinalTranscript(next.baseText, next.finals)
        queueMicrotask(() => optsRef.current.onDraft(merged))
      }
      return next
    })
  }, [])

  // Ensure adapter handlers always dispatch into latest reducer
  useEffect(() => {
    if (!support.ok) {
      setSession(initialVoiceSession(false))
      return
    }
    const adapter = createWebSpeechAdapter({
      onStart: () => dispatchEv({ type: "ENGINE_START" }),
      onResult: ({ interim, finalChunk }) =>
        dispatchEv({
          type: "ENGINE_RESULT",
          interim,
          finalChunk: finalChunk || undefined,
        }),
      onError: (code) => dispatchEv({ type: "ENGINE_ERROR", code }),
      onEnd: () => {
        clearTimer()
        dispatchEv({ type: "ENGINE_END" })
      },
    })
    adapterRef.current = adapter
    return () => {
      clearTimer()
      adapter?.destroy()
      adapterRef.current = null
      dispatchEv({ type: "UNMOUNT" })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount once per support
  }, [support.ok, dispatchEv])

  // Thread switch
  useEffect(() => {
    if (threadRef.current !== opts.threadId) {
      threadRef.current = opts.threadId
      const ph = sessionRef.current.phase
      if (ph === "listening" || ph === "starting" || ph === "stopping") {
        adapterRef.current?.abort()
        dispatchEv({ type: "THREAD_SWITCH" })
      }
    }
  }, [opts.threadId, dispatchEv])

  const stopEngine = useCallback((mode: "stop" | "abort") => {
    clearTimer()
    if (mode === "abort") adapterRef.current?.abort()
    else adapterRef.current?.stop()
  }, [])

  const toggle = useCallback((extra?: { privacyAck?: boolean }) => {
    const o = optsRef.current
    const s = sessionRef.current
    if (!o.enabled || !support.ok) return

    if (s.phase === "listening" || s.phase === "starting") {
      dispatchEv({ type: "USER_TOGGLE_STOP" })
      stopEngine("stop")
      return
    }

    if (s.phase !== "idle" && s.phase !== "error") return
    if (!o.allowStart) return
    const privacyOk = extra?.privacyAck === true || o.privacyAck
    if (!privacyOk) {
      o.onNeedPrivacyAck()
      return
    }
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      dispatchEv({ type: "ENGINE_ERROR", code: "offline" })
      return
    }

    // SoT §7.1: if not granted → bootstrap tab (Side Panel often cannot show mic prompt).
    // "prompt" and "denied" both open voice-permission.html; only "granted" starts here.
    const perms = (navigator as any).permissions
    if (perms?.query) {
      perms
        .query({ name: "microphone" as PermissionName })
        .then((st: PermissionStatus) => {
          if (st.state === "granted") {
            begin()
            return
          }
          o.onNeedPermissionBootstrap()
          if (st.state === "denied") {
            dispatchEv({ type: "ENGINE_ERROR", code: "not-allowed" })
          }
          // prompt: user grants on bootstrap tab, then clicks mic again
        })
        .catch(() => begin())
    } else {
      begin()
    }

    function begin() {
      const sid = newSessionId()
      const base = o.getBaseText()
      dispatchEv({ type: "USER_TOGGLE_START", sessionId: sid, baseText: base })
      try {
        adapterRef.current?.start(VOICE_DEFAULT_LANG)
      } catch {
        dispatchEv({ type: "ENGINE_ERROR", code: "not-allowed" })
        return
      }
      clearTimer()
      timerRef.current = setTimeout(() => {
        dispatchEv({ type: "TIMEOUT" })
        stopEngine("stop")
      }, VOICE_MAX_LISTEN_MS)
    }
  }, [dispatchEv, stopEngine, support.ok])

  /** Call before chat.abort / Stop button. */
  const abortForChatStop = useCallback(() => {
    const ph = sessionRef.current.phase
    if (ph === "listening" || ph === "starting" || ph === "stopping") {
      dispatchEv({ type: "CHAT_ABORT" })
      stopEngine("abort")
    }
  }, [dispatchEv, stopEngine])

  const dismissBanner = useCallback(() => {
    dispatchEv({ type: "DISMISS_BANNER" })
  }, [dispatchEv])

  const listening =
    session.phase === "listening" ||
    session.phase === "starting" ||
    session.phase === "stopping"

  /** Display value: base + finals + interim overlay while live */
  const liveOverlay =
    listening && !session.abortReason
      ? mergeFinalTranscript(session.baseText, session.finals) +
        (session.interim || "")
      : null

  return {
    supported: support.ok,
    phase: session.phase,
    listening,
    banner: session.banner,
    liveOverlay,
    toggle,
    abortForChatStop,
    dismissBanner,
  }
}

/**
 * Wire STT adapter (browser Web Speech | local Companion) + pure SM for InputArea.
 * Path B M1: engine factory; never silent-fallback local → browser.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import {
  detectSpeechRecognition,
  VOICE_DEFAULT_LANG,
  VOICE_MAX_LISTEN_MS,
} from "../voice/detect"
import { detectLocalMediaCapture } from "../voice/local-stt-detect"
import { reduceVoiceSession } from "../voice/session-reducer"
import { mergeFinalTranscript, isEmptyFinals } from "../voice/text-merge"
import { initialVoiceSession, type VoiceSessionState } from "../voice/types"
import { mapLocalSttError } from "../voice/error-map"
import { createSttAdapter, type SttEngineKind } from "../voice/stt-engine"
import type { SpeechAdapter } from "../voice/web-speech-adapter"

function newSessionId(): string {
  return `v-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function sendViaRuntime(msg: Record<string, unknown>): void {
  try {
    if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage(msg)
    }
  } catch {
    /* SW missing */
  }
}

function subscribeRuntime(handler: (msg: any) => void): () => void {
  if (typeof chrome === "undefined" || !chrome.runtime?.onMessage) {
    return () => {}
  }
  const listener = (msg: any) => {
    if (msg && typeof msg.type === "string" && msg.type.startsWith("voice.stt.")) {
      handler(msg)
    }
    return false
  }
  chrome.runtime.onMessage.addListener(listener)
  return () => {
    try {
      chrome.runtime.onMessage.removeListener(listener)
    } catch {
      /* */
    }
  }
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
  /** Browser Web Speech privacy ack (v1). */
  privacyAck: boolean
  onNeedPrivacyAck: () => void
  onNeedPermissionBootstrap: () => void
  /**
   * STT engine from store mirror / lastKnown.
   * When "local", never fall back to Web Speech.
   */
  sttEngine?: SttEngineKind
  /** Companion WS connected. */
  companionConnected?: boolean
  /** Local model + binary readiness (from voice.model.state mirror). */
  localReady?: { model: boolean; binary: boolean }
  /** Path B privacy ack v2 (required for local). */
  privacyAckV2?: boolean
  onNeedPrivacyAckV2?: () => void
  /** Active whisper model id for voice.stt.start. */
  modelId?: string
}

export function useVoiceInput(opts: UseVoiceInputOpts) {
  const engine: SttEngineKind = opts.sttEngine === "local" ? "local" : "browser"

  const browserSupport = detectSpeechRecognition(
    typeof globalThis !== "undefined" ? (globalThis as any) : {},
  )
  const localMediaSupport = detectLocalMediaCapture(
    typeof globalThis !== "undefined" ? (globalThis as any) : {},
  )

  const supported =
    engine === "local" ? localMediaSupport.ok : browserSupport.ok

  const [session, setSession] = useState<VoiceSessionState>(() =>
    initialVoiceSession(supported),
  )
  const sessionRef = useRef(session)
  sessionRef.current = session
  const adapterRef = useRef<SpeechAdapter | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const threadRef = useRef(opts.threadId)
  const optsRef = useRef(opts)
  optsRef.current = opts
  const engineRef = useRef(engine)
  engineRef.current = engine

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
        const merged = mergeFinalTranscript(next.baseText, next.finals)
        queueMicrotask(() => optsRef.current.onDraft(merged))
      }
      return next
    })
  }, [])

  // Rebuild adapter when engine / support changes
  useEffect(() => {
    if (!supported) {
      setSession(initialVoiceSession(false))
      adapterRef.current?.destroy()
      adapterRef.current = null
      return
    }

    const handlers = {
      onStart: () => dispatchEv({ type: "ENGINE_START" }),
      onResult: ({ interim, finalChunk }: { interim: string; finalChunk: string }) =>
        dispatchEv({
          type: "ENGINE_RESULT",
          interim,
          finalChunk: finalChunk || undefined,
        }),
      onError: (code: string) => dispatchEv({ type: "ENGINE_ERROR", code }),
      onEnd: () => {
        clearTimer()
        dispatchEv({ type: "ENGINE_END" })
      },
      onCaptureStopped: () => {
        dispatchEv({ type: "CAPTURE_STOPPED" })
      },
    }

    const modelId =
      optsRef.current.modelId ||
      "medium"

    const adapter = createSttAdapter(engine, {
      handlers,
      local:
        engine === "local"
          ? {
              send: sendViaRuntime,
              onMessage: subscribeRuntime,
              modelId,
            }
          : undefined,
    })

    adapterRef.current?.destroy()
    adapterRef.current = adapter

    return () => {
      clearTimer()
      adapter?.destroy()
      adapterRef.current = null
      dispatchEv({ type: "UNMOUNT" })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount per engine/support
  }, [supported, engine, dispatchEv])

  // Thread switch — abort recording + processing
  useEffect(() => {
    if (threadRef.current !== opts.threadId) {
      threadRef.current = opts.threadId
      const ph = sessionRef.current.phase
      if (
        ph === "listening" ||
        ph === "starting" ||
        ph === "stopping" ||
        ph === "processing"
      ) {
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

  /** Gate local start; returns error code or null if OK. */
  const localGateError = useCallback((): string | null => {
    const o = optsRef.current
    if (!o.companionConnected) return "companion_disconnected"
    if (!o.localReady?.model) return "model_missing"
    if (!o.localReady?.binary) return "binary_missing"
    return null
  }, [])

  const toggle = useCallback(
    (extra?: { privacyAck?: boolean; privacyAckV2?: boolean }) => {
      const o = optsRef.current
      const s = sessionRef.current
      const eng = engineRef.current
      if (!o.enabled || !supported) return

      // Stop / cancel
      if (s.phase === "listening" || s.phase === "starting") {
        if (eng === "local") {
          // Keep listening until capture ends → CAPTURE_STOPPED → processing.
          // Do NOT USER_TOGGLE_STOP (would go stopping and block CAPTURE_STOPPED).
          clearTimer()
          stopEngine("stop")
          return
        }
        dispatchEv({ type: "USER_TOGGLE_STOP" })
        stopEngine("stop")
        return
      }

      if (s.phase === "processing") {
        // Cancel mid-infer
        dispatchEv({ type: "USER_TOGGLE_STOP" })
        stopEngine("abort")
        return
      }

      if (s.phase === "stopping") {
        // Double-tap recovery (browser stuck stopping)
        dispatchEv({ type: "USER_TOGGLE_STOP" })
        stopEngine("abort")
        return
      }

      if (s.phase !== "idle" && s.phase !== "error") return
      if (!o.allowStart) return

      if (eng === "local") {
        // Fail-closed gates — never fall back to browser
        const gate = localGateError()
        if (gate) {
          dispatchEv({ type: "ENGINE_ERROR", code: gate })
          return
        }
        const privacyOk =
          extra?.privacyAckV2 === true ||
          extra?.privacyAck === true ||
          o.privacyAckV2 === true
        if (!privacyOk) {
          if (o.onNeedPrivacyAckV2) o.onNeedPrivacyAckV2()
          else o.onNeedPrivacyAck()
          return
        }
      } else {
        const privacyOk = extra?.privacyAck === true || o.privacyAck
        if (!privacyOk) {
          o.onNeedPrivacyAck()
          return
        }
        if (typeof navigator !== "undefined" && navigator.onLine === false) {
          dispatchEv({ type: "ENGINE_ERROR", code: "offline" })
          return
        }
      }

      // SoT §7.1: if not granted → bootstrap tab (Side Panel often cannot show mic prompt).
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
          })
          .catch(() => begin())
      } else {
        begin()
      }

      function begin() {
        // Re-check local gates at start time (connection may have dropped).
        if (eng === "local") {
          const gate = localGateError()
          if (gate) {
            dispatchEv({ type: "ENGINE_ERROR", code: gate })
            return
          }
        }
        if (!adapterRef.current) {
          if (eng === "local") {
            dispatchEv({ type: "ENGINE_ERROR", code: "binary_missing" })
          }
          return
        }

        const sid = newSessionId()
        const base = o.getBaseText()
        dispatchEv({ type: "USER_TOGGLE_START", sessionId: sid, baseText: base })
        try {
          if (eng === "local") {
            adapterRef.current.start({
              lang: VOICE_DEFAULT_LANG,
              sessionId: sid,
              modelId: o.modelId || "medium",
            })
          } else {
            adapterRef.current.start(VOICE_DEFAULT_LANG)
          }
        } catch {
          dispatchEv({ type: "ENGINE_ERROR", code: "not-allowed" })
          return
        }
        clearTimer()
        timerRef.current = setTimeout(() => {
          if (engineRef.current === "local") {
            // Stop capture → CAPTURE_STOPPED → processing (do not TIMEOUT→stopping).
            clearTimer()
            stopEngine("stop")
          } else {
            dispatchEv({ type: "TIMEOUT" })
            stopEngine("stop")
          }
        }, VOICE_MAX_LISTEN_MS)
      }
    },
    [dispatchEv, stopEngine, supported, localGateError],
  )

  /** Call before chat.abort / Stop button. */
  const abortForChatStop = useCallback(() => {
    const ph = sessionRef.current.phase
    if (
      ph === "listening" ||
      ph === "starting" ||
      ph === "stopping" ||
      ph === "processing"
    ) {
      dispatchEv({ type: "CHAT_ABORT" })
      stopEngine("abort")
    }
  }, [dispatchEv, stopEngine])

  const dismissBanner = useCallback(() => {
    dispatchEv({ type: "DISMISS_BANNER" })
  }, [dispatchEv])

  const busy =
    session.phase === "listening" ||
    session.phase === "starting" ||
    session.phase === "stopping" ||
    session.phase === "processing"

  /** Display value: base + finals + interim overlay while live */
  const liveOverlay =
    (session.phase === "listening" ||
      session.phase === "starting" ||
      session.phase === "stopping") &&
    !session.abortReason
      ? mergeFinalTranscript(session.baseText, session.finals) +
        (session.interim || "")
      : null

  return {
    supported,
    phase: session.phase,
    /** True while mic active or local processing (composer disable / stop-mic). */
    listening: busy,
    processing: session.phase === "processing",
    banner: session.banner,
    liveOverlay,
    sttEngine: engine,
    /** Map a local gate code for external CTA (optional). */
    mapLocalError: mapLocalSttError,
    toggle,
    abortForChatStop,
    dismissBanner,
  }
}

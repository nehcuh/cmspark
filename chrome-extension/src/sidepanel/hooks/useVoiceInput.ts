/**
 * Wire STT adapter (browser Web Speech | local Companion) + pure SM for InputArea.
 * Path B M1: engine factory; never silent-fallback local → browser.
 */

import { useCallback, useEffect, useRef, useState } from "react"
import {
  detectSpeechRecognition,
  maxListenMsForSession,
  VOICE_CONTINUOUS_SOFT_CAP_MS,
  VOICE_DEFAULT_LANG,
  VOICE_MAX_LISTEN_MS,
  type VoiceDictationMode,
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
  /**
   * Dictation+ mode (SoT). classic = M1 45s; continuous = browser restart + long hard cap.
   * Local engine always uses classic caps until D1c segments.
   */
  dictationMode?: VoiceDictationMode
  /** Continuous / Refiner privacy ack v3. */
  privacyAckV3?: boolean
  onNeedPrivacyAckV3?: () => void
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
  const softTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const threadRef = useRef(opts.threadId)
  const optsRef = useRef(opts)
  optsRef.current = opts
  const engineRef = useRef(engine)
  engineRef.current = engine
  const modeRef = useRef<VoiceDictationMode>(
    opts.dictationMode === "continuous" ? "continuous" : "classic",
  )
  modeRef.current =
    opts.dictationMode === "continuous" ? "continuous" : "classic"
  /** Wall-clock when current listen session entered starting/listening (UI timer). */
  const listenStartRef = useRef<number | null>(null)
  const maxListenMsRef = useRef(VOICE_MAX_LISTEN_MS)
  const [listenTick, setListenTick] = useState(0)

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    if (softTimerRef.current) {
      clearTimeout(softTimerRef.current)
      softTimerRef.current = null
    }
  }

  // Drive remaining-time badge while capturing (local or browser).
  useEffect(() => {
    const ph = session.phase
    if (ph === "starting" || ph === "listening") {
      if (listenStartRef.current == null) listenStartRef.current = Date.now()
      const id = setInterval(() => setListenTick((n) => n + 1), 250)
      return () => clearInterval(id)
    }
    listenStartRef.current = null
    return undefined
  }, [session.phase])

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
    (extra?: {
      privacyAck?: boolean
      privacyAckV2?: boolean
      privacyAckV3?: boolean
    }) => {
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

      const mode = modeRef.current
      // Continuous browser requires privacy ack v3 (long cloud STT residual).
      const continuousBrowser = mode === "continuous" && eng === "browser"

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
        if (continuousBrowser) {
          const v3 = extra?.privacyAckV3 === true || o.privacyAckV3 === true
          if (!v3) {
            // Do not fall back to v1 sheet — that cannot satisfy the v3 gate (dual-review N1).
            if (o.onNeedPrivacyAckV3) o.onNeedPrivacyAckV3()
            return
          }
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
        const modeNow = modeRef.current
        const maxMs = maxListenMsForSession(modeNow, eng)
        maxListenMsRef.current = maxMs
        dispatchEv({ type: "USER_TOGGLE_START", sessionId: sid, baseText: base })
        try {
          if (eng === "local") {
            adapterRef.current.start({
              lang: VOICE_DEFAULT_LANG,
              sessionId: sid,
              modelId: o.modelId || "medium",
            })
          } else {
            adapterRef.current.start({
              lang: VOICE_DEFAULT_LANG,
              mode: modeNow,
            })
          }
        } catch {
          dispatchEv({ type: "ENGINE_ERROR", code: "not-allowed" })
          return
        }
        clearTimer()
        // Soft cap hint only for continuous browser (still listening).
        if (modeNow === "continuous" && eng === "browser") {
          softTimerRef.current = setTimeout(() => {
            softTimerRef.current = null
            const ph = sessionRef.current.phase
            if (ph === "listening" || ph === "starting") {
              dispatchEv({
                type: "SOFT_CAP_HINT",
                message: "仍在连续听写，可点麦克风结束",
              })
            }
          }, VOICE_CONTINUOUS_SOFT_CAP_MS)
        }
        timerRef.current = setTimeout(() => {
          if (engineRef.current === "local") {
            // Stop capture → CAPTURE_STOPPED → processing (do not TIMEOUT→stopping).
            clearTimer()
            stopEngine("stop")
          } else {
            const cont =
              modeRef.current === "continuous" && engineRef.current === "browser"
            dispatchEv({
              type: "TIMEOUT",
              code: cont ? "continuous-timeout" : "timeout",
            })
            stopEngine("stop")
          }
        }, maxMs)
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

  // Remaining listen budget for mic chrome (Task 7). listenTick forces re-render.
  void listenTick
  const listenRemainingMs =
    listenStartRef.current != null &&
    (session.phase === "listening" || session.phase === "starting")
      ? Math.max(
          0,
          maxListenMsRef.current - (Date.now() - listenStartRef.current),
        )
      : null

  return {
    supported,
    phase: session.phase,
    /** True while mic active or local processing (composer disable / stop-mic). */
    listening: busy,
    processing: session.phase === "processing",
    banner: session.banner,
    /** Last ENGINE_ERROR code (for banner CTA routing). */
    errorCode: session.errorCode,
    liveOverlay,
    /** ms left of session hard cap while capturing; null when idle/processing. */
    listenRemainingMs,
    /** Active dictation mode (classic | continuous). */
    dictationMode: modeRef.current,
    sttEngine: engine,
    /** Map a local gate code for external CTA (optional). */
    mapLocalError: mapLocalSttError,
    toggle,
    abortForChatStop,
    dismissBanner,
  }
}

/**
 * Wire STT adapter (browser Web Speech | local Companion) + pure SM for InputArea.
 * Path B M1: engine factory; never silent-fallback local → browser.
 * Gated exception (voice.autoFallbackToBrowser, default on): engine=local but the
 * active model is not ready → this session runs on the browser engine with a
 * visible banner (LOCAL_FALLBACK_BROWSER_BANNER). Per-session only — never
 * writes sttEngine config. companion_disconnected / binary_missing unchanged.
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
import {
  detectLocalMediaCapture,
  LOCAL_STT_NEAR_REALTIME_SEGMENT_MS,
} from "../voice/local-stt-detect"
import { reduceVoiceSession } from "../voice/session-reducer"
import {
  mergeFinalTranscript,
  isEmptyFinals,
  voiceLiveComposerText,
} from "../voice/text-merge"
import { initialVoiceSession, type VoiceSessionState } from "../voice/types"
import {
  LOCAL_FALLBACK_BROWSER_BANNER,
  SYSTEM_FALLBACK_BANNER,
  SYSTEM_UNAVAILABLE_BROWSER_BANNER,
  mapLocalSttError,
} from "../voice/error-map"
import { createSttAdapter, type SttEngineKind } from "../voice/stt-engine"
import {
  detectChainPlatform,
  resolveSystemEngineSelection,
  shouldEscalateBrowserToSystem,
} from "../voice/stt-engine-chain"
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
    if (
      msg &&
      typeof msg.type === "string" &&
      (msg.type.startsWith("voice.stt.") || msg.type.startsWith("voice.refine."))
    ) {
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

/**
 * Per-session browser fallback decision (voice.autoFallbackToBrowser).
 * Pure + exported for tests. Engages ONLY when the voice.model.state mirror
 * is hydrated AND the active model is confirmed not ready — unknown readiness
 * stays fail-closed (no silent cloud STT in the hydration window).
 */
export function resolveLocalFallbackActive(args: {
  configuredEngine: SttEngineKind
  autoFallbackToBrowser?: boolean
  companionConnected?: boolean
  localStateHydrated?: boolean
  localModelReady?: boolean
}): boolean {
  return (
    args.configuredEngine === "local" &&
    args.autoFallbackToBrowser !== false &&
    args.companionConnected === true &&
    args.localStateHydrated === true &&
    args.localModelReady === false
  )
}

export type UseVoiceInputOpts = {  /** Composer text at listen start (snapshot). */
  getBaseText: () => string
  /** Apply merged draft (never auto-send). meta.postprocessed → 「已后处理」微标. */
  onDraft: (text: string, meta?: { postprocessed?: boolean }) => void
  /** Local capture RMS 0–1. */
  onLevel?: (level: number) => void
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
   * When "local", never fall back to Web Speech — except the gated per-session
   * model-missing fallback below (autoFallbackToBrowser).
   */
  sttEngine?: SttEngineKind
  /** Companion WS connected. */
  companionConnected?: boolean
  /** Local model + binary readiness (from voice.model.state mirror). */
  localReady?: { model: boolean; binary: boolean }
  /**
   * True once the first voice.model.state mirror has arrived. The per-session
   * browser fallback only engages when hydrated — otherwise "unknown readiness"
   * would be misread as model_missing and silently prefer cloud STT.
   */
  localStateHydrated?: boolean
  /**
   * Companion voice.autoFallbackToBrowser (default true). When false, a missing
   * local model keeps the fail-closed model_missing banner + 去设置 CTA.
   */
  autoFallbackToBrowser?: boolean
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
  /** ASR Refiner opt-in (default false). */
  asrRefinerEnabled?: boolean
  /**
   * Current composer text for dirty check while refining.
   * If undefined, refine always applies (no ownership gate).
   */
  getCurrentDraft?: () => string
  /**
   * Prefer near-real-time feedback: local continuous uses shorter segments.
   * Browser path always has word-level interim when interimResults is on.
   */
  realtimeStreaming?: boolean
  /**
   * #259: voice.system.state mirror (win32 + helper pinned + System.Speech ok
   * → system engine selectable / browser→system escalation eligible).
   * Null/absent = probe unknown → fail-closed (no system hop).
   */
  systemState?: {
    platform: "win32" | "other"
    helper: { ok: boolean; reason?: string; message?: string; pinned?: boolean }
    systemSpeech: { available: boolean; reason?: string }
  } | null
}

export function useVoiceInput(opts: UseVoiceInputOpts) {
  const configuredEngine: SttEngineKind =
    opts.sttEngine === "local"
      ? "local"
      : opts.sttEngine === "system"
        ? "system"
        : "browser"
  /**
   * Gated per-session fallback: engine=local, model confirmed missing (mirrors
   * the localGateError model_missing branch — companion connected, state mirror
   * hydrated, model not ready; binary state irrelevant since model_missing is
   * checked first), and the companion autoFallbackToBrowser pref not disabled.
   * Runs the session on the browser adapter with a visible banner; never writes
   * sttEngine config. Un-hydrated state stays fail-closed (no fallback).
   */
  const localFallbackActive = resolveLocalFallbackActive({
    configuredEngine,
    autoFallbackToBrowser: opts.autoFallbackToBrowser,
    companionConnected: opts.companionConnected,
    localStateHydrated: opts.localStateHydrated,
    localModelReady: opts.localReady?.model,
  })
  /**
   * #259 third hop. configured "system" resolves to the system engine only on
   * win32 with the probe green (voice.system.state); otherwise fail-closed to
   * browser. systemFallbackRef is the sticky per-session browser→system
   * escalation (network-class browser error on win32) — visible banner, never
   * a config write.
   */
  const chainPlatformRef = useRef(detectChainPlatform())
  const systemAvailable =
    opts.systemState?.platform === "win32" &&
    opts.systemState?.helper?.ok === true &&
    opts.systemState?.systemSpeech?.available === true
  const systemAvailableRef = useRef(systemAvailable)
  systemAvailableRef.current = systemAvailable
  const systemFallbackRef = useRef(false)
  const systemSelection = resolveSystemEngineSelection({
    platform: chainPlatformRef.current,
    configured: configuredEngine,
    systemAvailable,
  })
  /** Effective engine for adapter/session; configured engine otherwise. */
  const engine: SttEngineKind = systemFallbackRef.current
    ? "system"
    : localFallbackActive
      ? "browser"
      : systemSelection.engine
  /** Configured system but probe/off-win32 degraded → browser (honest banner). */
  const systemConfigDegraded =
    configuredEngine === "system" &&
    !systemFallbackRef.current &&
    engine === "browser"
  const systemDegradedRef = useRef(systemConfigDegraded)
  systemDegradedRef.current = systemConfigDegraded
  const fallbackRef = useRef(localFallbackActive)
  fallbackRef.current = localFallbackActive

  const browserSupport = detectSpeechRecognition(
    typeof globalThis !== "undefined" ? (globalThis as any) : {},
  )
  const localMediaSupport = detectLocalMediaCapture(
    typeof globalThis !== "undefined" ? (globalThis as any) : {},
  )

  const supported =
    engine === "browser" ? browserSupport.ok : localMediaSupport.ok

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
  /**
   * Engine pinned for the adapter lifecycle. While a session is active
   * (not idle/unsupported/error), a fallback flip (e.g. a model download
   * completing mid-dictation) must NOT rebuild the adapter — that would
   * destroy the in-flight session. Follow `engine` only when idle.
   */
  const sessionActive =
    session.phase !== "idle" &&
    session.phase !== "unsupported" &&
    session.phase !== "error"
  const adapterEngineRef = useRef(engine)
  if (!sessionActive) adapterEngineRef.current = engine
  const adapterEngine = adapterEngineRef.current
  const adapterSupported =
    adapterEngine === "browser" ? browserSupport.ok : localMediaSupport.ok
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

  // Drive remaining-time badge while capturing (or continuous local segment processing).
  useEffect(() => {
    const ph = session.phase
    const contProcessing =
      modeRef.current === "continuous" && ph === "processing"
    if (ph === "starting" || ph === "listening" || contProcessing) {
      if (listenStartRef.current == null) listenStartRef.current = Date.now()
      const id = setInterval(() => setListenTick((n) => n + 1), 250)
      return () => clearInterval(id)
    }
    // Keep wall clock through continuous segment gaps (processing) only when continuous.
    if (ph !== "processing") {
      listenStartRef.current = null
    }
    return undefined
  }, [session.phase])

  const refineGenCounter = useRef(0)
  const postprocessedRef = useRef(false)

  const dispatchEv = useCallback((event: Parameters<typeof reduceVoiceSession>[1]) => {
    setSession((prev) => {
      const next = reduceVoiceSession(prev, event)
      const o = optsRef.current

      if (event.type === "ENGINE_RESULT" && event.postprocessed === true) {
        postprocessedRef.current = true
      }
      if (event.type === "ENGINE_START" || event.type === "CHAT_ABORT") {
        postprocessedRef.current = false
      }

      // Continuous local STT: flush each *new* final into draft so processing-gap
      // UI does not fall back to stale `text`. Only when reducer accepted the chunk
      // (hard aborts leave finals unchanged — dual-review nit).
      if (
        event.type === "ENGINE_RESULT" &&
        event.finalChunk &&
        event.finalChunk.length > 0 &&
        !next.committed &&
        next.finals.length > prev.finals.length
      ) {
        const partial = mergeFinalTranscript(next.baseText, next.finals)
        const pp = postprocessedRef.current
        queueMicrotask(() => o.onDraft(partial, { postprocessed: pp }))
      }

      // Side effects after ENGINE_END commit — raw-first, then optional refine
      if (
        event.type === "ENGINE_END" &&
        next.committed &&
        next.finals.length > 0 &&
        !isEmptyFinals(next.finals)
      ) {
        const merged = mergeFinalTranscript(next.baseText, next.finals)
        const pp = postprocessedRef.current
        postprocessedRef.current = false
        queueMicrotask(() => {
          o.onDraft(merged, { postprocessed: pp })
          const wantRefine =
            o.asrRefinerEnabled === true &&
            o.privacyAckV3 === true &&
            o.companionConnected === true
          if (!wantRefine) return
          // Abort reasons that discard — already not committed path
          refineGenCounter.current += 1
          const gen = refineGenCounter.current
          const sid = next.sessionId || `refine-${gen}`
          // Re-enter SM refining (prev may already be idle in React state)
          setSession((cur) =>
            reduceVoiceSession(cur, {
              type: "START_REFINE",
              refineGen: gen,
              rawSnapshot: merged,
            }),
          )
          try {
            const voiceOnly = mergeFinalTranscript("", next.finals)
            sendViaRuntime({
              type: "voice.refine.request",
              v: 1,
              sessionId: sid,
              refineGen: gen,
              text: voiceOnly || merged,
            })
          } catch {
            setSession((cur) =>
              reduceVoiceSession(cur, {
                type: "REFINE_FAIL",
                refineGen: gen,
                code: "send_failed",
                message: "纠错请求发送失败，已填入识别原文",
              }),
            )
          }
        })
      }
      return next
    })
  }, [])

  // Subscribe to refine results (and local STT messages when engine=local also uses this path for refine)
  useEffect(() => {
    return subscribeRuntime((msg: any) => {
      const t = msg?.type
      if (t === "voice.refine.result") {
        const gen = msg.refineGen
        const text = typeof msg.text === "string" ? msg.text : ""
        const cur = sessionRef.current
        if (cur.phase !== "refining" || cur.refineGen !== gen) return
        const rawSnap = cur.rawSnapshot || ""
        const base = cur.baseText || ""
        // Dirty check: user edited beyond raw snapshot
        const draftNow = optsRef.current.getCurrentDraft?.()
        if (draftNow != null && draftNow !== rawSnap) {
          setSession((s) =>
            reduceVoiceSession(s, {
              type: "REFINE_FAIL",
              refineGen: gen,
              code: "draft_dirty",
              message: "已保留你的编辑；识别原文可还原",
            }),
          )
          return
        }
        // Apply: base + refined voice span (request sends finals only)
        const refinedFull =
          !base || text.startsWith(base) ? text : base + text
        optsRef.current.onDraft(refinedFull)
        setSession((s) =>
          reduceVoiceSession(s, {
            type: "REFINE_OK",
            refineGen: gen,
            text: refinedFull,
            unchanged: msg.unchanged === true,
          }),
        )
        return
      }
      if (t === "voice.refine.error" || t === "voice.refine.aborted") {
        const gen = msg.refineGen
        const cur = sessionRef.current
        if (cur.phase !== "refining") return
        if (cur.refineGen != null && gen != null && cur.refineGen !== gen) return
        setSession((s) =>
          reduceVoiceSession(s, {
            type: "REFINE_FAIL",
            refineGen: gen ?? cur.refineGen ?? 0,
            code: msg.code || "refine_fail",
            message:
              t === "voice.refine.aborted" || msg.code === "aborted"
                ? "已取消纠错，保留识别原文"
                : msg.code === "infer_timeout"
                  ? "纠错超时，已填入识别原文"
                  : msg.message || "纠错失败，已填入识别原文",
          }),
        )
      }
    })
  }, [])

  /**
   * #259: browser session died with a network-class error on win32 and the
   * system probe is green → mark the sticky escalation. If privacy v2 is
   * already acked, auto-restart on the system engine (banner shows on begin);
   * otherwise pop the v2 sheet once — never run system without the ack.
   */
  const [pendingSystemRestart, setPendingSystemRestart] = useState(false)
  const toggleRef = useRef<
    ((extra?: { privacyAck?: boolean; privacyAckV2?: boolean; privacyAckV3?: boolean }) => void) | null
  >(null)

  // Rebuild adapter when the pinned engine / support changes (never mid-session)
  useEffect(() => {
    if (!adapterSupported) {
      setSession(initialVoiceSession(false))
      adapterRef.current?.destroy()
      adapterRef.current = null
      return
    }

    const handlers = {
      onStart: () => dispatchEv({ type: "ENGINE_START" }),
      onResult: ({
        interim,
        finalChunk,
        postprocessed,
      }: {
        interim: string
        finalChunk: string
        postprocessed?: boolean
      }) =>
        dispatchEv({
          type: "ENGINE_RESULT",
          interim,
          finalChunk: finalChunk || undefined,
          ...(postprocessed === true ? { postprocessed: true } : {}),
        }),
      onError: (code: string) => {
        if (
          adapterEngine === "browser" &&
          !systemFallbackRef.current &&
          shouldEscalateBrowserToSystem({
            platform: chainPlatformRef.current,
            browserErrorCode: code,
            systemAvailable: systemAvailableRef.current,
          })
        ) {
          systemFallbackRef.current = true
          // Honest terminal error for the browser session, then hop.
          dispatchEv({ type: "ENGINE_ERROR", code })
          const o = optsRef.current
          if (o.privacyAckV2 !== true) {
            o.onNeedPrivacyAckV2?.()
            return
          }
          setPendingSystemRestart(true)
          return
        }
        dispatchEv({ type: "ENGINE_ERROR", code })
      },
      onEnd: () => {
        clearTimer()
        dispatchEv({ type: "ENGINE_END" })
      },
      onCaptureStopped: () => {
        dispatchEv({ type: "CAPTURE_STOPPED" })
      },
      onSegmentContinue: () => {
        dispatchEv({ type: "SEGMENT_CONTINUE" })
      },
      onLevel: (level: number) => {
        optsRef.current.onLevel?.(level)
      },
    }

    const modelId =
      optsRef.current.modelId ||
      "medium"

    const adapter = createSttAdapter(adapterEngine, {
      handlers,
      local:
        adapterEngine === "browser"
          ? undefined
          : {
              send: sendViaRuntime,
              onMessage: subscribeRuntime,
              // system sessions carry no whisper model on the wire (#259)
              ...(adapterEngine === "local" ? { modelId } : {}),
            },
    })

    adapterRef.current?.destroy()
    adapterRef.current = adapter

    return () => {
      clearTimer()
      adapter?.destroy()
      adapterRef.current = null
      dispatchEv({ type: "UNMOUNT" })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount per pinned engine/support
  }, [adapterSupported, adapterEngine, dispatchEv])

  // #259: escalate-restart after the engine flip re-renders (adapter above is
  // rebuilt first — declaration order — so toggle() starts on the system adapter).
  useEffect(() => {
    if (!pendingSystemRestart) return
    setPendingSystemRestart(false)
    if (engineRef.current !== "system") return
    toggleRef.current?.()
  }, [pendingSystemRestart])

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

      // Cancel mid-refine
      if (s.phase === "refining") {
        const gen = s.refineGen
        const sid = s.sessionId || (gen != null ? `refine-${gen}` : "")
        if (gen != null && sid) {
          try {
            sendViaRuntime({
              type: "voice.refine.abort",
              v: 1,
              sessionId: sid,
              refineGen: gen,
            })
          } catch {
            /* */
          }
        }
        dispatchEv({ type: "CANCEL_REFINE" })
        return
      }

      // Stop / cancel listen
      if (s.phase === "listening" || s.phase === "starting") {
        if (eng === "local" || eng === "system") {
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
        // Continuous local/system: stop gracefully so prior segment finals are kept
        // (USER_TOGGLE_STOP from processing marks committed and drops merge).
        if (modeRef.current === "continuous" && (eng === "local" || eng === "system")) {
          clearTimer()
          stopEngine("stop")
          return
        }
        // Classic: cancel mid-infer
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
      // Continuous (browser or local long session) and/or ASR Refiner → privacy v3.
      const continuousMode = mode === "continuous"
      const wantsRefine = o.asrRefinerEnabled === true

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
        if (continuousMode || wantsRefine) {
          const v3 = extra?.privacyAckV3 === true || o.privacyAckV3 === true
          if (!v3) {
            if (o.onNeedPrivacyAckV3) o.onNeedPrivacyAckV3()
            return
          }
        }
      } else if (eng === "system") {
        // #259: system sessions run through the companion (SAPI helper) — WS
        // connection is the gate; no whisper model/binary, no onLine check
        // (offline is exactly when the system engine must work).
        if (!o.companionConnected) {
          dispatchEv({ type: "ENGINE_ERROR", code: "companion_disconnected" })
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
        if (continuousMode || wantsRefine) {
          const v3 = extra?.privacyAckV3 === true || o.privacyAckV3 === true
          if (!v3) {
            if (o.onNeedPrivacyAckV3) o.onNeedPrivacyAckV3()
            return
          }
        }
      } else {
        const privacyOk = extra?.privacyAck === true || o.privacyAck
        if (!privacyOk) {
          o.onNeedPrivacyAck()
          return
        }
        if (continuousMode || wantsRefine) {
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
        // D2: user released before async permission → do not start orphan classic session
        if (
          holdSessionRef.current &&
          holdStartEpochRef.current !== holdEpochRef.current
        ) {
          restoreModeAfterHold()
          return
        }
        // Re-check local gates at start time (connection may have dropped).
        if (eng === "local") {
          const gate = localGateError()
          if (gate) {
            dispatchEv({ type: "ENGINE_ERROR", code: gate })
            return
          }
        }
        if (eng === "system" && !o.companionConnected) {
          dispatchEv({ type: "ENGINE_ERROR", code: "companion_disconnected" })
          return
        }
        if (!adapterRef.current) {
          if (eng === "local") {
            dispatchEv({ type: "ENGINE_ERROR", code: "binary_missing" })
          } else if (eng === "system") {
            dispatchEv({ type: "ENGINE_ERROR", code: "system_unavailable" })
          }
          return
        }

        const sid = newSessionId()
        const base = o.getBaseText()
        const modeNow = modeRef.current
        const maxMs = maxListenMsForSession(modeNow, eng)
        maxListenMsRef.current = maxMs
        dispatchEv({ type: "USER_TOGGLE_START", sessionId: sid, baseText: base })
        if (fallbackRef.current) {
          // Visible per-session notice (SOFT_CAP_HINT = non-terminal info chip;
          // applies in starting/listening). Dismissible; cleared on next start.
          dispatchEv({
            type: "SOFT_CAP_HINT",
            message: LOCAL_FALLBACK_BROWSER_BANNER,
            code: "local_fallback",
          })
        } else if (systemFallbackRef.current) {
          // #259 third hop: visible per-session notice, same pattern as above.
          dispatchEv({
            type: "SOFT_CAP_HINT",
            message: SYSTEM_FALLBACK_BANNER,
            code: "system_fallback",
          })
        } else if (systemDegradedRef.current) {
          // #259: configured system but probe/off-win32 → honest browser notice.
          dispatchEv({
            type: "SOFT_CAP_HINT",
            message: SYSTEM_UNAVAILABLE_BROWSER_BANNER,
            code: "system_unavailable",
          })
        }
        try {
          if (eng === "local") {
            const nearRt =
              o.realtimeStreaming === true && modeNow === "continuous"
            adapterRef.current.start({
              lang: VOICE_DEFAULT_LANG,
              sessionId: sid,
              modelId: o.modelId || "medium",
              mode: modeNow,
              hardCapMs: maxMs,
              // Shorter windows ≈ near-real-time finals when not streaming.
              segmentMs: nearRt ? LOCAL_STT_NEAR_REALTIME_SEGMENT_MS : undefined,
              // M2: progressive hypothesis via PCM stream + partial_request.
              streamPartial: nearRt === true,
            })
          } else if (eng === "system") {
            // #259: same capture mechanics as local; adapter stamps
            // engine:"system" on the wire and forces batch segments.
            adapterRef.current.start({
              lang: VOICE_DEFAULT_LANG,
              sessionId: sid,
              mode: modeNow,
              hardCapMs: maxMs,
              streamPartial: false,
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
        // Soft cap hint for continuous (browser or local).
        if (modeNow === "continuous") {
          softTimerRef.current = setTimeout(() => {
            softTimerRef.current = null
            const ph = sessionRef.current.phase
            if (ph === "listening" || ph === "starting" || ph === "processing") {
              dispatchEv({
                type: "SOFT_CAP_HINT",
                message: "仍在连续听写，可点麦克风结束",
              })
            }
          }, VOICE_CONTINUOUS_SOFT_CAP_MS)
        }
        timerRef.current = setTimeout(() => {
          const cont = modeRef.current === "continuous"
          clearTimer()
          if (engineRef.current === "local" || engineRef.current === "system") {
            // Stop capture → segment finalize (do not TIMEOUT→stopping).
            stopEngine("stop")
          } else {
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
  toggleRef.current = toggle

  /** Call before chat.abort / Stop button. */
  const abortForChatStop = useCallback(() => {
    const s = sessionRef.current
    const ph = s.phase
    if (ph === "refining") {
      const gen = s.refineGen
      const sid = s.sessionId || (gen != null ? `refine-${gen}` : "")
      if (gen != null && sid) {
        try {
          sendViaRuntime({
            type: "voice.refine.abort",
            v: 1,
            sessionId: sid,
            refineGen: gen,
          })
        } catch {
          /* */
        }
      }
      dispatchEv({ type: "CHAT_ABORT" })
      return
    }
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

  /** Restore raw STT draft after refine (if rawSnapshot available). */
  const restoreRaw = useCallback(() => {
    const snap = sessionRef.current.rawSnapshot
    if (snap == null) return false
    optsRef.current.onDraft(snap)
    dispatchEv({ type: "DISMISS_BANNER" })
    return true
  }, [dispatchEv])

  const busy =
    session.phase === "listening" ||
    session.phase === "starting" ||
    session.phase === "stopping" ||
    session.phase === "processing" ||
    session.phase === "refining"

  /** Display value: base + finals + interim while live (incl. local segment processing). */
  const liveOverlay = voiceLiveComposerText({
    phase: session.phase,
    abortReason: session.abortReason,
    baseText: session.baseText,
    finals: session.finals,
    interim: session.interim || "",
  })

  // Remaining listen budget for mic chrome (Task 7). listenTick forces re-render.
  void listenTick
  const listenRemainingMs =
    listenStartRef.current != null &&
    (session.phase === "listening" ||
      session.phase === "starting" ||
      (session.phase === "processing" && modeRef.current === "continuous"))
      ? Math.max(
          0,
          maxListenMsRef.current - (Date.now() - listenStartRef.current),
        )
      : null

  /**
   * Dictation+ D2 hold-to-talk: force continuous for this session, start if idle.
   * holdEpoch invalidates async begin() if user releases before mic starts (fast-tap nit).
   */
  const holdSessionRef = useRef(false)
  const savedModeRef = useRef<VoiceDictationMode | null>(null)
  const holdEpochRef = useRef(0)
  const holdStartEpochRef = useRef(0)

  const restoreModeAfterHold = useCallback(() => {
    holdSessionRef.current = false
    if (savedModeRef.current) {
      modeRef.current = savedModeRef.current
      savedModeRef.current = null
    }
  }, [])

  // If hold session ends (hard cap / error) without holdStop, restore classic/continuous pref.
  useEffect(() => {
    if (!holdSessionRef.current) return
    if (session.phase === "idle" || session.phase === "error") {
      restoreModeAfterHold()
    }
  }, [session.phase, restoreModeAfterHold])

  const holdStart = useCallback(
    (extra?: { privacyAck?: boolean; privacyAckV2?: boolean; privacyAckV3?: boolean }) => {
      const s = sessionRef.current
      if (s.phase !== "idle" && s.phase !== "error") return false
      if (!optsRef.current.allowStart) return false
      if (holdSessionRef.current) return false
      holdEpochRef.current += 1
      holdStartEpochRef.current = holdEpochRef.current
      // Mode must stay continuous until holdStop / natural idle — begin() reads modeRef later.
      savedModeRef.current = modeRef.current
      modeRef.current = "continuous"
      holdSessionRef.current = true
      toggle(extra)
      return true
    },
    [toggle],
  )

  const holdStop = useCallback(() => {
    if (!holdSessionRef.current) return false
    // Invalidate any in-flight async begin() from this hold
    holdEpochRef.current += 1
    const s = sessionRef.current
    if (
      s.phase === "listening" ||
      s.phase === "starting" ||
      s.phase === "processing" ||
      s.phase === "stopping" ||
      s.phase === "refining"
    ) {
      toggle()
    }
    restoreModeAfterHold()
    return true
  }, [toggle, restoreModeAfterHold])

  return {
    supported,
    phase: session.phase,
    /** True while mic active or local processing (composer disable / stop-mic). */
    listening: busy,
    processing: session.phase === "processing",
    refining: session.phase === "refining",
    /** Raw STT snapshot available for undo after refine. */
    rawSnapshot: session.rawSnapshot,
    banner: session.banner,
    /** Last ENGINE_ERROR code (for banner CTA routing). */
    errorCode: session.errorCode,
    liveOverlay,
    /** ms left of session hard cap while capturing; null when idle/processing. */
    listenRemainingMs,
    /** Active dictation mode (classic | continuous). */
    dictationMode: modeRef.current,
    sttEngine: engine,
    /** True while a local→browser per-session fallback is in effect (visible banner). */
    localFallbackActive,
    /** #259: True after a browser→system per-session escalation (visible banner). */
    systemFallbackActive: systemFallbackRef.current,
    /** Map a local gate code for external CTA (optional). */
    mapLocalError: mapLocalSttError,
    toggle,
    /** D2 hold-to-talk — stable callbacks; App must not depend on whole `voice` object. */
    holdStart,
    holdStop,
    abortForChatStop,
    dismissBanner,
    restoreRaw,
  }
}

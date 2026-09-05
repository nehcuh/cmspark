// Composer voice wiring — cut out of App.tsx InputArea in #321 PR-7.
// Pure move: same state, effects, PTT chord, titles, and engine-switch handlers.

import { useCallback, useEffect, useRef, useState } from "react"
import { useAgentStore } from "../store/agentStore"
import { useVoiceInput } from "./useVoiceInput"
import { parseHotkeyChord, eventMatchesChord, isPttReleaseEvent } from "../voice/hotkey-chord"
import { initialPtt, reducePtt, type PttEffect, type PttState } from "../voice/ptt-reducer"
import { PAGE_INSERT_FALLBACK_HINT } from "../voice/insert-target"
import { playVoiceSfx, shouldPlayVoiceSfx, VOICE_SOUND_EFFECTS_KEY, parseVoiceSoundEffectsPref } from "../voice/voice-sfx"
import { type VoicePrivacyKind } from "../voice/privacy-copy"
import {
  SYSTEM_LISTEN_HINT,
  TOAST_SWITCHED_BROWSER,
  formatListenRemaining,
  localListeningStatusLabel,
  localSttBannerCta,
  mapLocalSttError,
} from "../voice/error-map"

export type UseComposerVoiceOpts = {
  textRef: { current: string }
  setText: (value: string | ((prev: string) => string)) => void
  textareaRef: { current: HTMLTextAreaElement | null }
  threadBusy: boolean
  needsThread: boolean
  isWorker: boolean
  closePanel: () => void
  setComposeOpen: (open: boolean) => void
}

export function useComposerVoice({
  textRef,
  setText,
  textareaRef,
  threadBusy,
  needsThread,
  isWorker,
  closePanel,
  setComposeOpen,
}: UseComposerVoiceOpts) {
  const { state, dispatch } = useAgentStore()
  const [voicePrivacyOpen, setVoicePrivacyOpen] = useState(false)
  const [voiceLevel, setVoiceLevel] = useState(0)
  const [pttLocked, setPttLocked] = useState(false)
  const [voiceCapsuleHint, setVoiceCapsuleHint] = useState<string | null>(null)
  const [voiceSoundEffects, setVoiceSoundEffects] = useState(true)
  const [postprocessedBadge, setPostprocessedBadge] = useState(false)
  const insertTargetRef = useRef<"composer" | "page">("composer")
  const pendingPageTextRef = useRef<string | null>(null)
  const pttRef = useRef<PttState>(initialPtt)
  const pttTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Privacy sheet: v1 browser · v2 local · v3 continuous/refiner. */
  const [voicePrivacyKind, setVoicePrivacyKind] = useState<VoicePrivacyKind>("v1")
  /** Fail-closed lastKnown engine when companion state not yet mirrored. */
  const [lastKnownVoiceEngine, setLastKnownVoiceEngine] = useState<
    "browser" | "local" | "system" | null
  >(null)
  /** Post-CTA residual note after「改用浏览器听写」(Task 7). */
  const [engineSwitchNote, setEngineSwitchNote] = useState<string | null>(null)
  // Path B: lastKnownVoiceEngine for disconnect fail-closed (SoT §7 / ADR-023 L13).
  useEffect(() => {
    try {
      chrome.storage.local.get(["lastKnownVoiceEngine"], (result) => {
        if (
          result.lastKnownVoiceEngine === "local" ||
          result.lastKnownVoiceEngine === "browser" ||
          result.lastKnownVoiceEngine === "system"
        ) {
          setLastKnownVoiceEngine(result.lastKnownVoiceEngine)
        }
      })
    } catch {
      /* ignore */
    }
  }, [])

  // Keep lastKnown in sync when live voice.model.state arrives
  useEffect(() => {
    const eng = state.voiceModel?.sttEngine
    if (eng === "local" || eng === "browser" || eng === "system") {
      setLastKnownVoiceEngine(eng)
    }
  }, [state.voiceModel?.sttEngine])

  // Path B mic matrix (plan Task 6): engine from live state or lastKnown.
  // #259: "system" passes through; useVoiceInput fail-closes it to browser
  // off-win32 / when the helper probe is not green.
  const sttEngine: "browser" | "local" | "system" =
    state.voiceModel?.sttEngine === "local" ||
    (state.voiceModel == null && lastKnownVoiceEngine === "local")
      ? "local"
      : state.voiceModel?.sttEngine === "system" ||
          (state.voiceModel == null && lastKnownVoiceEngine === "system")
        ? "system"
        : "browser"
  const activeModelId =
    state.voiceModel?.localModelId || "medium"
  const localModelReady =
    state.voiceModel?.models?.[activeModelId]?.status === "ready"
  const localBinaryReady = state.voiceModel?.binary?.status === "ready"
  const companionConnected = state.connectionState === "connected"

  // Pull voice.model.state when engine is local so mic gates have live ready flags.
  useEffect(() => {
    if (sttEngine !== "local" || !companionConnected) return
    if (state.voiceModel) return
    try {
      chrome.runtime.sendMessage({ type: "voice.model.get_state" })
    } catch {
      /* */
    }
  }, [sttEngine, companionConnected, state.voiceModel])

  // #259: probe the Windows system recognizer once per companion connection —
  // needed both for the configured-system chain and the browser→system escalation.
  useEffect(() => {
    if (!companionConnected) return
    try {
      chrome.runtime.sendMessage({ type: "voice.system.state" })
    } catch {
      /* */
    }
  }, [companionConnected])

  // threadBusy / no thread still block; local readiness is gated inside useVoiceInput
  // so a click can surface mapLocalSttError banners.
  // Mtg1: meeting live capture holds global max-1 STT — block dictation start.
  const voiceAllowStart =
    !threadBusy &&
    !needsThread &&
    state.voiceInputEnabled !== false &&
    !state.meetingCaptureActive

  const voice = useVoiceInput({
    getBaseText: () => textRef.current,
    realtimeStreaming: state.voiceRealtimeStreaming !== false,
    onLevel: (level) => setVoiceLevel(level),
    onDraft: (merged, meta) => {
      setPostprocessedBadge(meta?.postprocessed === true)
      if (insertTargetRef.current === "page") {
        pendingPageTextRef.current = merged
        return
      }
      setText(merged)
      requestAnimationFrame(() => {
        const el = textareaRef.current
        if (!el) return
        el.focus()
        const len = merged.length
        el.setSelectionRange(len, len)
      })
    },
    threadId: state.activeThreadId,
    allowStart: voiceAllowStart,
    enabled: state.voiceInputEnabled !== false,
    privacyAck: state.voicePrivacyAckV1 === true,
    onNeedPrivacyAck: () => {
      setVoicePrivacyKind("v1")
      setVoicePrivacyOpen(true)
    },
    onNeedPermissionBootstrap: () => {
      try {
        const url = chrome.runtime.getURL("tabs/voice-permission.html")
        chrome.tabs.create({ url })
      } catch {
        /* ignore */
      }
    },
    sttEngine,
    companionConnected,
    localReady: { model: localModelReady, binary: localBinaryReady },
    systemState: state.voiceSystemState,
    localStateHydrated: state.voiceModel != null,
    autoFallbackToBrowser: state.voiceModel?.autoFallbackToBrowser !== false,
    privacyAckV2: state.voicePrivacyAckV2 === true,
    onNeedPrivacyAckV2: () => {
      setVoicePrivacyKind("v2")
      setVoicePrivacyOpen(true)
    },
    modelId: activeModelId,
    dictationMode: state.voiceDictationMode === "continuous" ? "continuous" : "classic",
    privacyAckV3: state.voicePrivacyAckV3 === true,
    onNeedPrivacyAckV3: () => {
      setVoicePrivacyKind("v3")
      setVoicePrivacyOpen(true)
    },
    asrRefinerEnabled: state.asrRefinerEnabled === true,
    getCurrentDraft: () => textRef.current,
  })

  // Mirror dictation activity for MeetingPanel mutual-exclusion (SoT Mtg1).
  useEffect(() => {
    const active =
      voice.listening === true ||
      voice.processing === true ||
      voice.refining === true
    dispatch({ type: "SET_DICTATION_CAPTURE_ACTIVE", active })
  }, [voice.listening, voice.processing, voice.refining, dispatch])

  // D2 hold: keep stable refs so effect is NOT torn down every listenTick (REJECT #1).
  const holdStartRef = useRef(voice.holdStart)
  const holdStopRef = useRef(voice.holdStop)
  const holdAbortRef = useRef(voice.abortForChatStop)
  holdStartRef.current = voice.holdStart
  holdStopRef.current = voice.holdStop
  holdAbortRef.current = voice.abortForChatStop
  const meetingCaptureRef = useRef(state.meetingCaptureActive)
  meetingCaptureRef.current = state.meetingCaptureActive
  const voiceAllowStartRef = useRef(voiceAllowStart)
  voiceAllowStartRef.current = voiceAllowStart
  const privacyRef = useRef({
    v1: state.voicePrivacyAckV1 === true,
    v2: state.voicePrivacyAckV2 === true,
    v3: state.voicePrivacyAckV3 === true,
  })
  privacyRef.current = {
    v1: state.voicePrivacyAckV1 === true,
    v2: state.voicePrivacyAckV2 === true,
    v3: state.voicePrivacyAckV3 === true,
  }

  // #258 PTT dual-mode on the existing hold chord (default still off).
  useEffect(() => {
    try {
      chrome.storage.local.get(VOICE_SOUND_EFFECTS_KEY, (res) => {
        setVoiceSoundEffects(parseVoiceSoundEffectsPref(res[VOICE_SOUND_EFFECTS_KEY]))
      })
    } catch {
      /* */
    }
  }, [])

  useEffect(() => {
    if (voice.phase !== "idle") return
    const pending = pendingPageTextRef.current
    if (!pending || insertTargetRef.current !== "page") return
    pendingPageTextRef.current = null
    chrome.runtime.sendMessage({ type: "voice.ptt.insert_text", text: pending }, (res) => {
      if (chrome.runtime.lastError || res?.ok === false) {
        insertTargetRef.current = "composer"
        setText(pending)
        setVoiceCapsuleHint(PAGE_INSERT_FALLBACK_HINT)
        return
      }
      insertTargetRef.current = "composer"
    })
  }, [voice.phase])

  useEffect(() => {
    if (!state.dictationHotkeyEnabled) return
    const chord = parseHotkeyChord(state.dictationHotkeyChord)
    if (!chord) return

    const play = (kind: "start" | "stop" | "cancel" | "done", accidental = false) => {
      if (
        !shouldPlayVoiceSfx({
          enabled: state.voiceSoundEffects !== false,
          privacySheetOpen: voicePrivacyOpen,
          accidental,
        })
      ) {
        return
      }
      playVoiceSfx(kind)
    }

    let holdNotified = false
    const notifyHold = (active: boolean) => {
      try {
        chrome.runtime.sendMessage({
          type: "voice.dictation.hold_state",
          v: 1,
          active,
          chord: chord.label,
        })
      } catch {
        /* */
      }
    }

    const applyEffect = (effect: PttEffect, source: "sidepanel" | "page") => {
      if (effect === "start" || effect === "lock") {
        insertTargetRef.current = source === "page" ? "page" : "composer"
        setPttLocked(effect === "lock")
        const ok = holdStartRef.current({
          privacyAck: privacyRef.current.v1,
          privacyAckV2: privacyRef.current.v2,
          privacyAckV3: privacyRef.current.v3,
        })
        if (ok) {
          play("start")
          holdNotified = true
          notifyHold(true)
        }
        return
      }
      if (effect === "commit") {
        setPttLocked(false)
        holdStopRef.current()
        play("stop")
        play("done")
        if (holdNotified) notifyHold(false)
        holdNotified = false
        return
      }
      if (effect === "discard") {
        setPttLocked(false)
        holdAbortRef.current()
        if (holdNotified) notifyHold(false)
        holdNotified = false
      }
    }

    const armTick = (until: number | null, source: "sidepanel" | "page") => {
      if (pttTimerRef.current) clearTimeout(pttTimerRef.current)
      pttTimerRef.current = null
      if (until == null) return
      const wait = Math.max(0, until - Date.now())
      pttTimerRef.current = setTimeout(() => {
        const next = reducePtt(pttRef.current, { type: "tick", now: Date.now() })
        pttRef.current = next.state
        applyEffect(next.effect, source)
      }, wait)
    }

    const feed = (type: "down" | "up" | "esc" | "blur", source: "sidepanel" | "page") => {
      if (meetingCaptureRef.current) return
      if (type === "down" && !voiceAllowStartRef.current && pttRef.current.phase === "idle") return
      const next = reducePtt(pttRef.current, { type, now: Date.now() })
      pttRef.current = next.state
      setPttLocked(next.state.phase === "locked")
      applyEffect(next.effect, source)
      armTick(next.state.awaitUntil, source)
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && pttRef.current.phase === "locked") {
        e.preventDefault()
        feed("esc", "sidepanel")
        return
      }
      if (!eventMatchesChord(e, chord)) return
      if (e.repeat) return
      e.preventDefault()
      e.stopPropagation()
      feed("down", "sidepanel")
    }

    const onKeyUp = (e: KeyboardEvent) => {
      if (pttRef.current.phase === "idle") return
      if (!isPttReleaseEvent(e, chord)) return
      e.preventDefault()
      feed("up", "sidepanel")
    }

    const onBlur = () => {
      if (pttRef.current.phase === "idle") return
      feed("blur", "sidepanel")
    }

    const onMsg = (msg: { type?: string; kind?: string }) => {
      if (msg?.type !== "voice.ptt.from_page") return
      if (msg.kind === "down") feed("down", "page")
      if (msg.kind === "up") feed("up", "page")
    }
    chrome.runtime.onMessage.addListener(onMsg)

    window.addEventListener("keydown", onKeyDown, true)
    window.addEventListener("keyup", onKeyUp, true)
    window.addEventListener("blur", onBlur)
    return () => {
      chrome.runtime.onMessage.removeListener(onMsg)
      window.removeEventListener("keydown", onKeyDown, true)
      window.removeEventListener("keyup", onKeyUp, true)
      window.removeEventListener("blur", onBlur)
      if (pttTimerRef.current) clearTimeout(pttTimerRef.current)
      if (holdNotified) notifyHold(false)
    }
  }, [state.dictationHotkeyEnabled, state.dictationHotkeyChord, state.voiceSoundEffects, voicePrivacyOpen])

  // Hide: feature off | unsupported for selected engine | worker | no thread.
  // Local + no gUM → voice.supported false → hide.
  // Browser + no SpeechRecognition → hide.
  const showVoiceMic =
    voice.supported &&
    state.voiceInputEnabled !== false &&
    !isWorker &&
    !needsThread

  // Disable only for thread/feature gates; local readiness fails open on click → banner.
  const voiceMicDisabled = !voiceAllowStart && !voice.listening
  const capturing =
    voice.listening &&
    !voice.processing &&
    voice.listenRemainingMs != null
  const localCapturing = (sttEngine === "local" || sttEngine === "system") && capturing
  const continuousMode = state.voiceDictationMode === "continuous"
  const continuousCapturing = continuousMode && capturing
  const continuousProcessing =
    continuousMode && voice.processing && voice.listenRemainingMs != null
  const voiceMicTimerLabel =
    localCapturing || continuousCapturing || continuousProcessing
      ? formatListenRemaining(voice.listenRemainingMs!)
      : null
  const voiceMicLiveStatus = voice.refining
    ? "纠错中…点击取消"
    : continuousProcessing
      ? `本机分段识别中… · 剩余 ${formatListenRemaining(voice.listenRemainingMs!)}`
      : voice.processing
        ? "本机识别中…点击取消"
        : continuousCapturing
          ? `连续听写 · 剩余 ${formatListenRemaining(voice.listenRemainingMs!)}`
          : localCapturing
            ? sttEngine === "system"
              ? `系统识别 · 剩余 ${formatListenRemaining(voice.listenRemainingMs!)} · ${SYSTEM_LISTEN_HINT}`
              : localListeningStatusLabel(voice.listenRemainingMs!)
            : null
  const voiceMicTitle = (() => {
    if (state.meetingCaptureActive) return "会议录音进行中，请先结束会议再听写"
    if (threadBusy) return "处理中无法听写"
    if (voice.refining) return "纠错中…点击取消"
    if (continuousProcessing) {
      return `本机分段识别中… · 剩余 ${formatListenRemaining(voice.listenRemainingMs!)}`
    }
    if (voice.processing) return "本机识别中…点击取消"
    if (continuousCapturing) {
      return `连续听写中 · 剩余 ${formatListenRemaining(voice.listenRemainingMs!)} · 再点结束`
    }
    if (localCapturing) {
      return sttEngine === "system"
        ? `系统识别 · 剩余 ${formatListenRemaining(voice.listenRemainingMs!)} · ${SYSTEM_LISTEN_HINT}`
        : localListeningStatusLabel(voice.listenRemainingMs!)
    }
    if (voice.listening) return "结束语音输入"
    if (sttEngine === "system" && !companionConnected) {
      return mapLocalSttError("companion_disconnected").message
    }
    if (sttEngine === "local") {
      if (!companionConnected) return mapLocalSttError("companion_disconnected").message
      if (!localModelReady) return mapLocalSttError("model_missing").message
      if (!localBinaryReady) return mapLocalSttError("binary_missing").message
    }
    return "语音输入（听写进草稿）"
  })()

  /** Banner recovery CTA (Task 7): switch browser or open settings. */
  const voiceBannerCta =
    (sttEngine === "local" || sttEngine === "system") && voice.banner
      ? localSttBannerCta(voice.errorCode)
      : null

  const handleSwitchBrowserEngine = useCallback(() => {
    // Write path: same dual fence as Settings (SoT §5.3).
    try {
      chrome.runtime.sendMessage({
        type: "voice.model.set_engine",
        engine: "browser",
        source: "settings",
      })
    } catch {
      /* SW missing */
    }
    // Optimistic: so disconnect recovery works before companion ack.
    try {
      chrome.storage.local.set({ lastKnownVoiceEngine: "browser" })
    } catch {
      /* */
    }
    setLastKnownVoiceEngine("browser")
    if (state.voiceModel) {
      dispatch({
        type: "SET_VOICE_MODEL_STATE",
        modelState: { ...state.voiceModel, sttEngine: "browser" },
      })
    }
    voice.dismissBanner()
    setEngineSwitchNote(TOAST_SWITCHED_BROWSER)
  }, [dispatch, state.voiceModel, voice])

  const handleOpenVoiceSettings = useCallback(() => {
    voice.dismissBanner()
    setComposeOpen(false)
    closePanel()
    dispatch({ type: "OPEN_SETTINGS_SECTION", section: "model" })
  }, [closePanel, dispatch, voice])

  return {
    voice,
    voiceLevel,
    pttLocked,
    voiceCapsuleHint,
    postprocessedBadge,
    voicePrivacyOpen,
    setVoicePrivacyOpen,
    voicePrivacyKind,
    engineSwitchNote,
    setEngineSwitchNote,
    sttEngine,
    showVoiceMic,
    voiceMicDisabled,
    voiceMicTitle,
    voiceMicTimerLabel,
    voiceMicLiveStatus,
    voiceBannerCta,
    handleSwitchBrowserEngine,
    handleOpenVoiceSettings,
  }
}

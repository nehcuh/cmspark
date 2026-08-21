/**
 * Meeting workbench — Mtg0–Mtg3.
 * SoT: meeting-minutes-design + Mtg3 diarize design.
 * Mtg3: experimental anonymous 发言人N via local feature k-means (NOT identity).
 * Does NOT auto-start mic on pack apply. System audio mix still parking-lot.
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react"
import { useAgentStore } from "../store/agentStore"
import { tokens } from "../ui/tokens"
import { createLocalSttAdapter } from "../voice/local-stt-adapter"
import {
  detectLocalMediaCapture,
  LOCAL_STT_NEAR_REALTIME_SEGMENT_MS,
} from "../voice/local-stt-detect"
import {
  fileToWavSegments,
  transcribeWavViaStt,
} from "../voice/meeting-audio-import"
import {
  loadMeetingTemplate,
  saveMeetingTemplate,
} from "../voice/meeting-template-storage"
import {
  formatMeetingElapsed,
  meetingLiveInterimHint,
  meetingMinutesSendPlan,
  MEETING_DISCONNECT_FINALIZE_MS,
  MEETING_LIVE_HARD_CAP_MS,
  MEETING_LIVE_SOFT_CAP_MS,
  MEETING_MINUTES_WATCHDOG_MS,
  MEETING_NEAR_REALTIME_DEFAULT,
  MEETING_STOP_FAILSAFE_MS,
} from "../voice/meeting-caps"
import { VOICE_DEFAULT_LANG } from "../voice/detect"
import { mapLocalSttError } from "../voice/error-map"
import {
  createSerialRefineQueue,
  formatMeetingSoftSegmentError,
  isMeetingSoftSegmentBanner,
  requestMeetingSegmentRefine,
} from "../voice/meeting-live-refine"
import { VOICE_PRIVACY_ACK_V2_CLAUSES } from "../voice/privacy-copy"
import type { SpeechAdapter } from "../voice/web-speech-adapter"

/** Format companion transcript lines for textarea (Speaker: text). */
function formatLinesFromMeeting(transcript: any[]): string {
  if (!Array.isArray(transcript)) return ""
  return transcript
    .map((l) => {
      const t = typeof l?.text === "string" ? l.text : ""
      const sp = typeof l?.speaker === "string" ? l.speaker.trim() : ""
      return sp ? `${sp}: ${t}` : t
    })
    .filter(Boolean)
    .join("\n\n")
}

type CapturePhase = "idle" | "starting" | "recording" | "processing" | "stopping"

function useMeetingMessages(onMsg: (m: any) => void) {
  useEffect(() => {
    const listener = (msg: any) => {
      if (msg && typeof msg.type === "string" && msg.type.startsWith("meeting.")) {
        onMsg(msg)
      }
      return false
    }
    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [onMsg])
}

function sendViaRuntime(msg: Record<string, unknown>): void {
  try {
    chrome.runtime.sendMessage(msg)
  } catch {
    /* SW missing */
  }
}

function subscribeVoiceStt(handler: (msg: any) => void): () => void {
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

const formatElapsed = formatMeetingElapsed

export function MeetingPanel(props: {
  onClose: () => void
  onSendToDraft: (text: string) => void
}) {
  const { state, dispatch } = useAgentStore()
  const [title, setTitle] = useState("")
  const [transcript, setTranscript] = useState("")
  const [minutesMd, setMinutesMd] = useState("")
  const [meetingId, setMeetingId] = useState<string | null>(null)
  const [status, setStatus] = useState<string>("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ack, setAck] = useState(false)
  const [capturePhase, setCapturePhase] = useState<CapturePhase>("idle")
  const [elapsedMs, setElapsedMs] = useState(0)
  const [softCapHint, setSoftCapHint] = useState(false)
  /** P1: progressive hypothesis text (not yet committed to transcript). */
  const [interimText, setInterimText] = useState("")
  const [pendingGenerate, setPendingGenerate] = useState(false)
  /** Mtg2: optional default speaker for STT append / bulk label (manual only). */
  const [defaultSpeaker, setDefaultSpeaker] = useState("")
  const [importStatus, setImportStatus] = useState<string | null>(null)
  const textFileRef = useRef<HTMLInputElement | null>(null)
  const audioFileRef = useRef<HTMLInputElement | null>(null)
  const defaultSpeakerRef = useRef("")
  const importAbortRef = useRef(false)
  /** Skip server→textarea sync while user is typing (dual-review dirty-guard). */
  const transcriptDirtyRef = useRef(false)
  /** Mtg3: per-line acoustic features from last audio import (aligned with append order). */
  const lineFeaturesRef = useRef<number[][]>([])
  const [diarizeK, setDiarizeK] = useState(2)
  const [autoDiarizeAfterImport, setAutoDiarizeAfterImport] = useState(false)
  /** Optional markdown template for minutes structure (chrome.storage). */
  const [templateMd, setTemplateMd] = useState("")
  const templateMdRef = useRef("")
  /** After stop: re-run silence-cut / soft paragraph split on full transcript. */
  const [autoSegmentOnStop, setAutoSegmentOnStop] = useState(true)
  const autoSegmentOnStopRef = useRef(true)
  /** Live segment AI refine in flight (opt-in via asrRefinerEnabled). */
  const [refinePending, setRefinePending] = useState(0)

  const adapterRef = useRef<SpeechAdapter | null>(null)
  const captureStartRef = useRef<number | null>(null)
  const meetingIdRef = useRef<string | null>(null)
  const phaseRef = useRef<CapturePhase>("idle")
  const wantGenerateRef = useRef(false)
  const transcriptRef = useRef("")
  /** Prevent double meeting.end / finalize. */
  const finalizedRef = useRef(false)
  const titleRef = useRef(title)
  const refineGenRef = useRef(0)
  const refineQueueRef = useRef(createSerialRefineQueue())
  const asrRefinerEnabledRef = useRef(false)
  const companionConnectedRef = useRef(false)
  /** Companion died after 「结束并生成纪要」: retry when WS is back. */
  const retryGenerateOnReconnectRef = useRef(false)

  meetingIdRef.current = meetingId
  transcriptRef.current = transcript
  titleRef.current = title
  phaseRef.current = capturePhase
  defaultSpeakerRef.current = defaultSpeaker
  templateMdRef.current = templateMd
  autoSegmentOnStopRef.current = autoSegmentOnStop
  asrRefinerEnabledRef.current = state.asrRefinerEnabled === true

  const companionConnected = state.connectionState === "connected"
  companionConnectedRef.current = companionConnected
  const activeModelId = state.voiceModel?.localModelId || "medium"
  const localModelReady = state.voiceModel?.models?.[activeModelId]?.status === "ready"
  const localBinaryReady = state.voiceModel?.binary?.status === "ready"
  /** P1: near-rt defaults on; honor global voiceRealtimeStreaming toggle. */
  const nearRealtime =
    MEETING_NEAR_REALTIME_DEFAULT &&
    state.voiceRealtimeStreaming !== false &&
    activeModelId !== "large-v3-turbo"
  const localMedia = detectLocalMediaCapture(
    typeof globalThis !== "undefined" ? (globalThis as any) : {},
  )
  const capturing =
    capturePhase === "recording" ||
    capturePhase === "processing" ||
    capturePhase === "starting" ||
    capturePhase === "stopping"

  const setPhase = useCallback((p: CapturePhase) => {
    phaseRef.current = p
    setCapturePhase(p)
  }, [])

  useEffect(() => {
    try {
      chrome.storage.local.get("meeting_privacy_ack_v1", (r) => {
        if (r.meeting_privacy_ack_v1 === true) setAck(true)
      })
    } catch {
      /* */
    }
  }, [])

  const templateLoadedRef = useRef(false)
  useEffect(() => {
    let cancelled = false
    void loadMeetingTemplate().then((t) => {
      if (cancelled) return
      setTemplateMd(t)
      templateMdRef.current = t
      templateLoadedRef.current = true
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!templateLoadedRef.current) return
    const t = setTimeout(() => {
      saveMeetingTemplate(templateMd)
    }, 300)
    return () => clearTimeout(t)
  }, [templateMd])

  useEffect(() => {
    if (!companionConnected) return
    try {
      chrome.runtime.sendMessage({ type: "voice.model.get_state" })
    } catch {
      /* */
    }
  }, [companionConnected])

  useEffect(() => {
    if (!capturing) return
    const id = setInterval(() => {
      if (captureStartRef.current != null) {
        const ms = Date.now() - captureStartRef.current
        setElapsedMs(ms)
        if (ms >= MEETING_LIVE_SOFT_CAP_MS) setSoftCapHint(true)
      }
    }, 250)
    return () => clearInterval(id)
  }, [capturing])

  useEffect(() => {
    dispatch({ type: "SET_MEETING_CAPTURE_ACTIVE", active: capturing })
    return () => {
      dispatch({ type: "SET_MEETING_CAPTURE_ACTIVE", active: false })
    }
  }, [capturing, dispatch])

  /** Tear down adapter without onEnd (destroy is silent; abort would re-enter finalize). */
  const destroyAdapter = useCallback(() => {
    const a = adapterRef.current
    adapterRef.current = null
    if (!a) return
    try {
      a.destroy()
    } catch {
      /* */
    }
  }, [])

  const appendLocalAndRemote = useCallback(
    (
      chunk: string,
      id: string | null,
      source: "stt" | "asr_refiner" = "stt",
    ) => {
      const t = chunk.trim()
      if (!t) return
      const sp = defaultSpeakerRef.current.trim().slice(0, 32)
      const display = sp ? `${sp}: ${t}` : t
      setTranscript((prev) => {
        // Live STT: blank-line between segments = smart paragraph boundary
        const next = prev ? `${prev}\n\n${display}` : display
        transcriptRef.current = next
        return next
      })
      if (id) {
        sendViaRuntime({
          type: "meeting.append_transcript",
          v: 1,
          id,
          text: t,
          source,
          speaker: sp || undefined,
        })
      }
    },
    [],
  )

  /**
   * Commit a live STT final: optional ADR-024 refine with prior transcript context,
   * then append (paragraph-separated). Serial queue preserves order.
   * Pin meeting id at enqueue so late refine never appends to a newer meeting (Pi nit).
   */
  const commitLiveSegment = useCallback(
    (finalChunk: string, meetingIdForAppend: string) => {
      const raw = finalChunk.trim()
      if (!raw) return
      const pinnedId = meetingIdForAppend
      const wantRefine = asrRefinerEnabledRef.current
      if (!wantRefine) {
        appendLocalAndRemote(raw, pinnedId, "stt")
        return
      }
      refineGenRef.current += 1
      const gen = refineGenRef.current
      const sid = `mtg-refine-${pinnedId}-${gen}`
      const prior = transcriptRef.current
      setRefinePending((n) => n + 1)
      void refineQueueRef.current
        .enqueue(async () => {
          const { text, refined } = await requestMeetingSegmentRefine({
            sessionId: sid,
            refineGen: gen,
            text: raw,
            priorTranscript: prior,
          })
          // Always pin to the meeting that owned this segment (not meetingIdRef after await)
          appendLocalAndRemote(
            text || raw,
            pinnedId,
            refined ? "asr_refiner" : "stt",
          )
        })
        .finally(() => {
          setRefinePending((n) => Math.max(0, n - 1))
        })
    },
    [appendLocalAndRemote],
  )

  /**
   * Fire minutes job or defer until Companion is back.
   * Product adversary B1: dropped WS send used to leave 「生成中…」 forever.
   */
  const sendMinutesJob = useCallback((id: string | null) => {
    if (meetingMinutesSendPlan(companionConnectedRef.current) === "defer-reconnect") {
      retryGenerateOnReconnectRef.current = true
      setBusy(false)
      setPendingGenerate(false)
      setError(
        (prev) =>
          prev ||
          "Companion 未连接；转写已保留，重连后将自动生成纪要（也可手动点「生成会议纪要」）",
      )
      return
    }
    retryGenerateOnReconnectRef.current = false
    setBusy(true)
    setPendingGenerate(true)
    sendViaRuntime({
      type: "meeting.generate_minutes",
      v: 1,
      id: id || undefined,
      text: transcriptRef.current.trim() || undefined,
      template_md: templateMdRef.current.trim() || undefined,
    })
  }, [])

  /**
   * End server session + tear down adapter. Idempotent via finalizedRef.
   * Drains in-flight AI refine before end / silence-cut / minutes (dual-review nit #2).
   */
  const finalizeCapture = useCallback(
    (opts: { generate: boolean; id: string | null }) => {
      if (finalizedRef.current) return
      finalizedRef.current = true
      captureStartRef.current = null
      setPhase("idle")
      setSoftCapHint(false)
      destroyAdapter()
      dispatch({ type: "SET_MEETING_CAPTURE_ACTIVE", active: false })

      const id = opts.id || meetingIdRef.current
      const wantGenerate = opts.generate
      const wantSegment = autoSegmentOnStopRef.current

      void (async () => {
        // Wait for segment refine queue (cap ~22s) so minutes see refined text
        try {
          const drained = await refineQueueRef.current.drain()
          if (!drained && wantGenerate) {
            setError((prev) =>
              prev ||
              "部分 AI 纠错未在时限内完成；纪要将基于当前转写（可稍后重新生成）",
            )
          }
        } catch {
          /* best-effort */
        }

        if (id) {
          sendViaRuntime({ type: "meeting.end", v: 1, id })
        }
        // Smart segment after refine drain so silence-cut sees full refined blob
        if (wantSegment && id && transcriptRef.current.trim()) {
          sendViaRuntime({
            type: "meeting.apply_silence_cut",
            v: 1,
            id,
            text: transcriptRef.current,
          })
        }
        if (wantGenerate) {
          // Brief beat for silence-cut server apply before minutes job
          await new Promise((r) => setTimeout(r, 150))
          sendMinutesJob(id)
        }
      })()
    },
    [destroyAdapter, dispatch, sendMinutesJob, setPhase],
  )

  // Companion restart mid-window used to leave phase=stopping forever
  // (adapter awaited a voice.stt.end ACK that never arrived). Force-finalize.
  useEffect(() => {
    if (capturePhase !== "stopping") return
    const t = setTimeout(() => {
      if (phaseRef.current !== "stopping" || finalizedRef.current) return
      setError((prev) => prev || "结束超时：已停止录制。可基于已有转写生成纪要")
      const gen = wantGenerateRef.current
      wantGenerateRef.current = false
      finalizeCapture({ generate: gen, id: meetingIdRef.current })
    }, MEETING_STOP_FAILSAFE_MS)
    return () => clearTimeout(t)
  }, [capturePhase, finalizeCapture])

  // Debounced disconnect: WS auth blips (~1s) must not kill capture; a real
  // Companion death (SIGTERM ~18s this incident) must not leave 「正在听」.
  useEffect(() => {
    if (companionConnected) return
    if (phaseRef.current === "idle") return
    const t = setTimeout(() => {
      if (finalizedRef.current) return
      if (phaseRef.current === "idle") return
      setError((prev) => prev || "Companion 断开，已停止录制。可基于已有转写生成纪要")
      const gen = wantGenerateRef.current
      wantGenerateRef.current = false
      finalizeCapture({ generate: gen, id: meetingIdRef.current })
    }, MEETING_DISCONNECT_FINALIZE_MS)
    return () => clearTimeout(t)
  }, [companionConnected, finalizeCapture])

  useEffect(() => {
    if (!companionConnected) return
    if (!retryGenerateOnReconnectRef.current) return
    if (phaseRef.current !== "idle") return
    retryGenerateOnReconnectRef.current = false
    sendMinutesJob(meetingIdRef.current)
  }, [companionConnected, sendMinutesJob])

  useEffect(() => {
    if (!pendingGenerate) return
    const t = setTimeout(() => {
      setPendingGenerate(false)
      setBusy(false)
      retryGenerateOnReconnectRef.current = false
      setError((prev) => prev || "纪要生成超时。转写已保留，可再点「生成会议纪要」")
    }, MEETING_MINUTES_WATCHDOG_MS)
    return () => clearTimeout(t)
  }, [pendingGenerate])

  const startLocalSegments = useCallback(
    (id: string) => {
      destroyAdapter()
      finalizedRef.current = false

      if (!localMedia.ok) {
        setError("当前环境无法访问麦克风（getUserMedia）")
        setPhase("idle")
        sendViaRuntime({ type: "meeting.end", v: 1, id })
        return
      }
      if (!state.voicePrivacyAckV2) {
        setError("请先确认下方「本机语音隐私说明」（或：设置 › 听写 › 启用本机转写）")
        setPhase("idle")
        sendViaRuntime({ type: "meeting.end", v: 1, id })
        return
      }
      if (!localModelReady || !localBinaryReady) {
        setError("本机转写模型或二进制未就绪。请到设置 → 语音 下载模型后再开始会议录音。")
        setPhase("idle")
        sendViaRuntime({ type: "meeting.end", v: 1, id })
        return
      }

      const adapter = createLocalSttAdapter(
        {
          onStart: () => {
            captureStartRef.current = Date.now()
            setPhase("recording")
            setElapsedMs(0)
            setError(null)
            setInterimText("")
          },
          onResult: ({ interim, finalChunk }) => {
            if (finalChunk?.trim()) {
              setInterimText("")
              commitLiveSegment(finalChunk, meetingIdRef.current || id)
              return
            }
            // Progressive hypothesis only (M2); do not append until window final.
            // Empty interim is a soft/empty window — keep last visible text.
            if (typeof interim === "string" && interim.trim()) {
              setInterimText(interim)
            }
          },
          onError: (code) => {
            if (code === "aborted") return
            const mapped = mapLocalSttError(code)
            if (mapped.severity === "silent") return
            // Soft = adapter continues; honest copy (segment+audio irreversibly lost).
            const soft = isMeetingSoftSegmentBanner(code)
            const msg = mapped.message || `转写错误: ${code}`
            setError(soft ? formatMeetingSoftSegmentError(msg) : msg)
          },
          onEnd: () => {
            setInterimText("")
            const gen = wantGenerateRef.current
            wantGenerateRef.current = false
            if (phaseRef.current === "idle" && finalizedRef.current) return
            finalizeCapture({ generate: gen, id: meetingIdRef.current || id })
          },
          onSegmentContinue: () => {
            if (phaseRef.current !== "stopping") setPhase("recording")
          },
          onCaptureStopped: () => {
            if (phaseRef.current !== "stopping") setPhase("processing")
          },
        },
        {
          send: sendViaRuntime,
          onMessage: subscribeVoiceStt,
          modelId: activeModelId,
        },
      )
      adapterRef.current = adapter
      const sid = `mtg-${id}-${Date.now().toString(36)}`
      // STT slot is force-aborted on companion by meeting.start — do not send
      // voice.stt.abort with a fake sessionId (e.g. "mtg-preempt") from the client.
      // P1 near-rt: streamPartial + ~8s windows; P2 hard cap independent of dictation 15/30m.
      adapter.start({
        lang: VOICE_DEFAULT_LANG,
        sessionId: sid,
        modelId: activeModelId,
        mode: "continuous",
        hardCapMs: MEETING_LIVE_HARD_CAP_MS,
        segmentMs: nearRealtime ? LOCAL_STT_NEAR_REALTIME_SEGMENT_MS : undefined,
        streamPartial: nearRealtime,
      })
    },
    [
      activeModelId,
      commitLiveSegment,
      destroyAdapter,
      finalizeCapture,
      localBinaryReady,
      localMedia.ok,
      localModelReady,
      nearRealtime,
      setPhase,
      state.voicePrivacyAckV2,
    ],
  )

  const startLocalSegmentsRef = useRef(startLocalSegments)
  startLocalSegmentsRef.current = startLocalSegments

  // Unmount / ContextPanelHost 收起: always end server session if still capturing
  // (destroy() is silent and would otherwise leave status=recording — dual-review nit).
  useEffect(() => {
    return () => {
      const id = meetingIdRef.current
      const stillLive = phaseRef.current !== "idle" && !finalizedRef.current
      if (stillLive && id) {
        finalizedRef.current = true
        sendViaRuntime({ type: "meeting.end", v: 1, id })
      }
      destroyAdapter()
      dispatch({ type: "SET_MEETING_CAPTURE_ACTIVE", active: false })
    }
  }, [destroyAdapter, dispatch])

  const onMsg = useCallback(
    (msg: any) => {
      if (msg.type === "meeting.created" && msg.meeting) {
        setMeetingId(msg.meeting.id)
        setTitle(msg.meeting.title || "")
        setStatus(msg.meeting.status || "draft")
        setBusy(false)
      }
      if (msg.type === "meeting.started" && msg.meeting) {
        setMeetingId(msg.meeting.id)
        setTitle(msg.meeting.title || titleRef.current)
        setStatus(msg.meeting.status || "recording")
        if (phaseRef.current === "starting") {
          startLocalSegmentsRef.current(msg.meeting.id)
        }
      }
      if (msg.type === "meeting.ended" && msg.meeting) {
        setMeetingId(msg.meeting.id)
        let st = msg.meeting.status || "ready"
        if (msg.audio_deleted === true) st = `${st} · 音频已按默认策略删除`
        setStatus(st)
      }
      if (msg.type === "meeting.updated" && msg.meeting) {
        setMeetingId(msg.meeting.id)
        setStatus(msg.meeting.status)
        // Only push server transcript when explicit cut/import ops or textarea not dirty.
        // During live capture, local appends own the textarea — a stale
        // meeting.updated (append N-1 arriving after local N) used to flicker
        // or drop the newest line.
        const live =
          phaseRef.current === "recording" ||
          phaseRef.current === "processing" ||
          phaseRef.current === "starting" ||
          phaseRef.current === "stopping"
        const forceSync = msg.cut === true
        if (
          Array.isArray(msg.meeting.transcript) &&
          msg.meeting.transcript.length > 0 &&
          (forceSync || (!transcriptDirtyRef.current && !live))
        ) {
          const formatted = formatLinesFromMeeting(msg.meeting.transcript)
          if (formatted) {
            setTranscript(formatted)
            transcriptRef.current = formatted
            if (forceSync) transcriptDirtyRef.current = false
          }
        }
        if (msg.meeting.minutes?.raw_md) setMinutesMd(msg.meeting.minutes.raw_md)
        setBusy(false)
      }
      if (msg.type === "meeting.imported" && msg.meeting) {
        setMeetingId(msg.meeting.id)
        setTitle(msg.meeting.title || titleRef.current)
        setStatus(msg.meeting.status || "ready")
        if (Array.isArray(msg.meeting.transcript)) {
          const formatted = formatLinesFromMeeting(msg.meeting.transcript)
          setTranscript(formatted)
          transcriptRef.current = formatted
          transcriptDirtyRef.current = false
        }
        lineFeaturesRef.current = []
        setBusy(false)
        setImportStatus("已导入转写文件")
      }
      if (msg.type === "meeting.diarized" && msg.meeting) {
        setMeetingId(msg.meeting.id)
        setStatus(msg.meeting.status || "ready")
        if (Array.isArray(msg.meeting.transcript)) {
          const formatted = formatLinesFromMeeting(msg.meeting.transcript)
          setTranscript(formatted)
          transcriptRef.current = formatted
          transcriptDirtyRef.current = false
        }
        setBusy(false)
        const method = msg.diarize?.method || msg.meeting.diarize?.method
        setImportStatus(
          method === "text_gap"
            ? "已弱标说话人（按行交替 · 非声学）"
            : "已自动标匿名发言人（实验 · 非身份识别）",
        )
      }
      if (msg.type === "meeting.minutes_result") {
        if (msg.minutes?.raw_md) setMinutesMd(msg.minutes.raw_md)
        if (msg.meeting?.id) {
          setMeetingId(msg.meeting.id)
          setStatus(msg.meeting.status || "done")
        }
        setBusy(false)
        setPendingGenerate(false)
        setError(null)
      }
      if (msg.type === "meeting.error") {
        setError(msg.message || msg.code || "error")
        setBusy(false)
        setPendingGenerate(false)
        if (
          msg.code === "need_privacy_ack" ||
          msg.code === "already_recording" ||
          phaseRef.current === "starting"
        ) {
          setPhase("idle")
          destroyAdapter()
          dispatch({ type: "SET_MEETING_CAPTURE_ACTIVE", active: false })
        }
      }
    },
    [destroyAdapter, dispatch, setPhase],
  )

  useMeetingMessages(onMsg)

  const ensureAck = () => {
    if (ack) return true
    setError("请先确认会议隐私说明（生成纪要会将转写文本发给已配置的 LLM）")
    return false
  }

  const acceptAck = () => {
    setAck(true)
    try {
      chrome.storage.local.set({ meeting_privacy_ack_v1: true })
    } catch {
      /* */
    }
    setError(null)
  }

  const createMeeting = () => {
    setBusy(true)
    setError(null)
    sendViaRuntime({
      type: "meeting.create",
      v: 1,
      title: title || undefined,
      thread_id: state.activeThreadId || undefined,
    })
  }

  const startLiveCapture = () => {
    if (!ensureAck()) return
    if (!companionConnected) {
      setError("Companion 未连接")
      return
    }
    if (state.dictationCaptureActive) {
      setError("听写进行中，请先结束听写再开始会议录音（全局同时仅一路本机 STT）")
      return
    }
    if (capturing) return
    if (!localMedia.ok) {
      setError("当前环境无法访问麦克风")
      return
    }
    if (!state.voicePrivacyAckV2) {
      setError("请先确认下方「本机语音隐私说明」（或：设置 › 听写 › 启用本机转写）")
      return
    }
    if (!localModelReady || !localBinaryReady) {
      setError("本机转写模型或二进制未就绪。请到设置 → 语音 下载模型。")
      try {
        chrome.runtime.sendMessage({ type: "voice.model.get_state" })
      } catch {
        /* */
      }
      return
    }

    setError(null)
    setMinutesMd("")
    setPhase("starting")
    setSoftCapHint(false)
    wantGenerateRef.current = false
    finalizedRef.current = false

    sendViaRuntime({
      type: "meeting.start",
      v: 1,
      id: meetingId || undefined,
      title: title || undefined,
      thread_id: state.activeThreadId || undefined,
      privacy_ack_v1: true,
      audio_retained: false,
    })
  }

  const stopLiveCapture = (andGenerate: boolean) => {
    if (phaseRef.current === "idle" || phaseRef.current === "stopping") return
    setPhase("stopping")
    wantGenerateRef.current = andGenerate
    const a = adapterRef.current
    if (!a) {
      finalizeCapture({ generate: andGenerate, id: meetingId })
      return
    }
    try {
      a.stop()
    } catch {
      finalizeCapture({ generate: andGenerate, id: meetingId })
    }
  }

  const ensureMeetingIdThen = (then: (id: string) => void) => {
    if (meetingId) {
      then(meetingId)
      return
    }
    // Create then wait for meeting.created — fire create and use one-shot listener
    const listener = (msg: any) => {
      if (msg?.type === "meeting.created" && msg.meeting?.id) {
        chrome.runtime.onMessage.removeListener(listener)
        setMeetingId(msg.meeting.id)
        then(msg.meeting.id)
      }
      return false
    }
    chrome.runtime.onMessage.addListener(listener)
    sendViaRuntime({
      type: "meeting.create",
      v: 1,
      title: title || undefined,
      thread_id: state.activeThreadId || undefined,
    })
    // Fallback timeout remove
    setTimeout(() => {
      try {
        chrome.runtime.onMessage.removeListener(listener)
      } catch {
        /* */
      }
    }, 8000)
  }

  const applySilenceCut = () => {
    if (!ensureAck()) return
    if (!meetingId && !transcript.trim()) {
      setError("没有可分段的转写")
      return
    }
    setBusy(true)
    setError(null)
    ensureMeetingIdThen((id) => {
      // Single WS: server applies text then silence-cut (no client setTimeout race)
      sendViaRuntime({
        type: "meeting.apply_silence_cut",
        v: 1,
        id,
        text: transcriptRef.current.trim() || undefined,
      })
      setImportStatus("已应用智能分段（静音/段落切分；说话人仍可手动标）")
    })
  }

  const bulkLabelSpeaker = () => {
    if (!ensureAck()) return
    const sp = defaultSpeaker.trim().slice(0, 32)
    if (!sp) {
      setError("请先填写默认说话人标签（如「我」）")
      return
    }
    if (!meetingId && !transcript.trim()) {
      setError("没有可标注的转写")
      return
    }
    setBusy(true)
    ensureMeetingIdThen((id) => {
      sendViaRuntime({
        type: "meeting.bulk_speaker",
        v: 1,
        id,
        speaker: sp,
        text: transcriptRef.current.trim() || undefined,
      })
      setImportStatus(`已将全部行标为「${sp}」（手动，非自动分离）`)
    })
  }

  const onImportTextFile = async (file: File | null) => {
    if (!file) return
    if (!ensureAck()) return
    setError(null)
    setBusy(true)
    setImportStatus(`读取 ${file.name}…`)
    try {
      const text = await file.text()
      if (!text.trim()) {
        setError("文件为空")
        setBusy(false)
        setImportStatus(null)
        return
      }
      const truncated = text.length > 80_000
      sendViaRuntime({
        type: "meeting.import_text",
        v: 1,
        id: meetingId || undefined,
        title: title || file.name.replace(/\.[^.]+$/, ""),
        thread_id: state.activeThreadId || undefined,
        privacy_ack_v1: true,
        text: text.slice(0, 80_000),
      })
      if (truncated) {
        setImportStatus("已截断至 80000 字后导入（文件过长）")
      }
    } catch {
      setError("读取文本文件失败")
      setBusy(false)
      setImportStatus(null)
    }
  }

  const onImportAudioFile = async (file: File | null) => {
    if (!file) return
    if (!ensureAck()) return
    if (!companionConnected) {
      setError("Companion 未连接")
      return
    }
    if (state.dictationCaptureActive || capturing) {
      setError("听写或会议录音进行中，请先结束后再导入音频")
      return
    }
    if (!state.voicePrivacyAckV2) {
      setError("导入音频需先确认「本机语音隐私说明」（见下方卡片，或设置 › 听写 › 启用本机转写）")
      return
    }
    if (!localModelReady || !localBinaryReady) {
      setError("本机转写模型或二进制未就绪")
      return
    }

    setError(null)
    setBusy(true)
    importAbortRef.current = false
    dispatch({ type: "SET_MEETING_CAPTURE_ACTIVE", active: true })
    setImportStatus("解码音频…")

    const decoded = await fileToWavSegments(file)
    if (decoded.ok === false) {
      setError(decoded.message)
      setBusy(false)
      setImportStatus(null)
      dispatch({ type: "SET_MEETING_CAPTURE_ACTIVE", active: false })
      return
    }

    // Ensure meeting exists
    let id = meetingId
    if (!id) {
      id = await new Promise<string | null>((resolve) => {
        const listener = (msg: any) => {
          if (msg?.type === "meeting.created" && msg.meeting?.id) {
            chrome.runtime.onMessage.removeListener(listener)
            resolve(msg.meeting.id as string)
          }
          return false
        }
        chrome.runtime.onMessage.addListener(listener)
        sendViaRuntime({
          type: "meeting.create",
          v: 1,
          title: title || file.name.replace(/\.[^.]+$/, ""),
          thread_id: state.activeThreadId || undefined,
        })
        setTimeout(() => {
          try {
            chrome.runtime.onMessage.removeListener(listener)
          } catch {
            /* */
          }
          resolve(null)
        }, 8000)
      })
      if (id) setMeetingId(id)
    }
    if (!id) {
      setError("无法创建会议会话")
      setBusy(false)
      setImportStatus(null)
      dispatch({ type: "SET_MEETING_CAPTURE_ACTIVE", active: false })
      return
    }

    const total = decoded.segments.length
    let failedAt: number | null = null
    let done = 0
    const feats: number[][] = []
    const texts: string[] = []
    setImportStatus(`本机转写 0/${total} 段…`)
    for (let i = 0; i < total; i++) {
      if (importAbortRef.current) break
      const seg = decoded.segments[i]!
      setImportStatus(`本机转写 ${i + 1}/${total} 段…`)
      const sid = `mtg-imp-${id}-${i}-${Date.now().toString(36)}`
      const r = await transcribeWavViaStt({
        wav: seg.wav,
        sessionId: sid,
        modelId: activeModelId,
        send: sendViaRuntime,
        onMessage: subscribeVoiceStt,
      })
      if (r.ok === false) {
        failedAt = i + 1
        setError(`音频第 ${i + 1} 段转写失败: ${r.code}`)
        break
      }
      if (r.text.trim()) {
        // One physical line per segment so features stay aligned (dual-review nit)
        const oneLine = r.text.trim().replace(/\s*\n+\s*/g, " ")
        texts.push(oneLine)
        feats.push(seg.features)
        // local preview (speaker optional)
        appendLocalAndRemote(oneLine, null)
      }
      done = i + 1
    }
    lineFeaturesRef.current = feats

    // Single set_transcript so line count == features (avoid append race before diarize)
    if (texts.length > 0 && id) {
      const sp = defaultSpeakerRef.current.trim().slice(0, 32)
      const body = texts.join("\n")
      sendViaRuntime({
        type: "meeting.set_transcript",
        v: 1,
        id,
        text: body,
        source: "stt",
        silence_cut: false,
      })
      // Restore default-speaker when not auto-diarizing (Mtg2 contract)
      if (sp && !autoDiarizeAfterImport) {
        setTimeout(() => {
          sendViaRuntime({
            type: "meeting.bulk_speaker",
            v: 1,
            id,
            speaker: sp,
          })
        }, 100)
      }
    }

    setBusy(false)
    if (importAbortRef.current) {
      setImportStatus(`导入已中止（已完成 ${done}/${total} 段）`)
    } else if (failedAt != null) {
      setImportStatus(`导入部分失败（成功 ${done}/${total} 段，失败于第 ${failedAt} 段）`)
    } else {
      setImportStatus(`音频导入完成 ${done}/${total} 段`)
      if (autoDiarizeAfterImport && feats.length >= 2 && id && texts.length === feats.length) {
        setBusy(true)
        setTimeout(() => {
          sendViaRuntime({
            type: "meeting.auto_diarize",
            v: 1,
            id,
            privacy_ack_v1: true,
            mode: "audio_cluster",
            k: diarizeK,
            features: feats,
          })
        }, 150)
      }
    }
    dispatch({ type: "SET_MEETING_CAPTURE_ACTIVE", active: false })
  }

  const runAutoDiarize = (mode: "audio_cluster" | "text_gap") => {
    if (!ensureAck()) return
    if (!meetingId && !transcript.trim()) {
      setError("请先创建会议或导入/录制转写")
      return
    }
    if (!transcript.trim()) {
      setError("转写为空，无法标说话人")
      return
    }
    if (mode === "audio_cluster") {
      const feats = lineFeaturesRef.current
      if (!feats.length) {
        setError("暂无声学特征：请先「上传音频转写」以启用实验性自动分离（纯粘贴请用弱标）")
        return
      }
      setBusy(true)
      setError(null)
      ensureMeetingIdThen((id) => {
        sendViaRuntime({
          type: "meeting.auto_diarize",
          v: 1,
          id,
          privacy_ack_v1: true,
          mode: "audio_cluster",
          k: diarizeK,
          features: feats,
        })
      })
      return
    }
    setBusy(true)
    setError(null)
    ensureMeetingIdThen((id) => {
      sendViaRuntime({
        type: "meeting.auto_diarize",
        v: 1,
        id,
        privacy_ack_v1: true,
        mode: "text_gap",
        k: diarizeK,
        text: transcriptRef.current.trim() || undefined,
      })
    })
  }

  const generate = () => {
    if (!ensureAck()) return
    if (capturing) {
      setError("请先结束录音再生成纪要，或使用「结束并生成纪要」")
      return
    }
    if (!transcript.trim() && !meetingId) {
      setError("请先粘贴转写文本或完成录音")
      return
    }
    setBusy(true)
    setError(null)
    if (meetingId && transcript.trim()) {
      sendViaRuntime({
        type: "meeting.set_transcript",
        v: 1,
        id: meetingId,
        text: transcript,
        source: "user_edit",
        silence_cut: true,
      })
    }
    sendMinutesJob(meetingId)
  }

  const copyMinutes = async () => {
    if (!minutesMd) return
    try {
      await navigator.clipboard.writeText(minutesMd)
      setStatus("已复制纪要")
    } catch {
      setError("复制失败")
    }
  }

  const localReadyLabel = !companionConnected
    ? "Companion 未连接"
    : !localModelReady || !localBinaryReady
      ? "本机 STT 未就绪"
      : "本机 STT 就绪"

  return (
    <div
      data-testid="meeting-panel"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        padding: 12,
        height: "100%",
        overflow: "auto",
        background: tokens.bgElevated,
        color: tokens.text,
        fontSize: 13,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <strong style={{ flex: 1 }}>会议记录</strong>
        <span style={{ fontSize: 11, color: tokens.textSecondary }}>
          实验可标发言人N · 非身份识别
        </span>
        <button
          type="button"
          onClick={() => {
            // Sync end before unmount so meeting.end is not raced by destroy()
            if (phaseRef.current !== "idle") {
              wantGenerateRef.current = false
              finalizeCapture({ generate: false, id: meetingIdRef.current })
            }
            props.onClose()
          }}
          style={{
            border: `1px solid ${tokens.border}`,
            background: "transparent",
            borderRadius: 6,
            padding: "2px 8px",
            cursor: "pointer",
            color: tokens.textSecondary,
            fontSize: 12,
          }}
        >
          关闭
        </button>
      </div>

      <div style={{ fontSize: 11, color: tokens.textSecondary, lineHeight: 1.45 }}>
        粘贴 / 上传转写，或显式「开始录制」本机分段转写（最长约{" "}
        {Math.round(MEETING_LIVE_HARD_CAP_MS / 60_000)} 分钟；约 2 小时软提示）。
        {nearRealtime
          ? " 默认近实时出字（渐进假设，约 8 秒定稿；large 模型仅终稿）。"
          : " 当前为分段终稿模式（可在设置开启实时出字）。"}
        应用场景不会自动开麦。录音与听写互斥。说话人：手动标或实验性自动「发言人N」（非真名识别）；系统混音未支持。
        段与段之间自动空行分段；可开「录制 AI 纠错」用上文消歧同音字（需已配置 LLM）。
      </div>

      {/* Path B: meeting live STT / audio import requires voice_privacy_ack_v2.
          Previously only reachable via Settings → 启用本机转写 (easy to miss). */}
      {!state.voicePrivacyAckV2 && (
        <div
          data-testid="meeting-voice-privacy-v2"
          style={{
            border: `1px solid ${tokens.border}`,
            borderRadius: 8,
            padding: 10,
            fontSize: 11,
            lineHeight: 1.45,
            color: tokens.textSecondary,
          }}
        >
          <div style={{ marginBottom: 6, color: tokens.text, fontWeight: 500 }}>
            本机语音隐私说明
          </div>
          <p style={{ margin: "0 0 6px", fontSize: 10 }}>
            会议本机录音 / 上传音频转写前须确认。也可在：侧栏 ⋯ → 设置 → 听写 →
            「启用本机转写」。
          </p>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {VOICE_PRIVACY_ACK_V2_CLAUSES.map((c) => (
              <li key={c.slice(0, 24)}>{c}</li>
            ))}
          </ul>
          <button
            type="button"
            data-testid="meeting-voice-privacy-v2-accept"
            onClick={() => {
              dispatch({ type: "SET_VOICE_PRIVACY_ACK_V2", ack: true })
              setError(null)
              // Companion refuses voice.stt.* unless sttEngine=local — flip if model ready.
              if (localModelReady && localBinaryReady) {
                // Companion validate requires source:"settings" for set_engine (settings dual fence).
                sendViaRuntime({
                  type: "voice.model.set_engine",
                  engine: "local",
                  privacy_ack_v2: true,
                  source: "settings",
                })
              }
            }}
            style={{ ...btnStyle(true), marginTop: 8, padding: "4px 10px", fontSize: 12 }}
          >
            同意本机语音隐私说明
            {localModelReady && localBinaryReady ? "并启用本机转写" : ""}
          </button>
          {!localModelReady || !localBinaryReady ? (
            <div style={{ marginTop: 6, fontSize: 10, color: tokens.warning }}>
              模型或本机组件未就绪时：侧栏 ⋯ → 设置 → 听写 → 下载组件/模型 → 启用本机转写。
            </div>
          ) : null}
        </div>
      )}

      {!ack && (
        <div
          style={{
            border: `1px solid ${tokens.border}`,
            borderRadius: 8,
            padding: 10,
            fontSize: 11,
            lineHeight: 1.45,
            color: tokens.textSecondary,
          }}
        >
          <div style={{ marginBottom: 6, color: tokens.text, fontWeight: 500 }}>
            会议隐私说明
          </div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            <li>会创建本地会话产物（转写 ± 可选音频）。</li>
            <li>默认结束录制后删除会议目录下音频（当前 UI 不提供保留选项）。</li>
            <li>生成纪要将把转写文本发给你已配置的 LLM。</li>
            <li>长会 STT 仅本机；不会自动开始录音。</li>
            <li>多方录音法律合规由你负责。</li>
          </ul>
          <button
            type="button"
            onClick={acceptAck}
            style={{ ...btnStyle(true), marginTop: 8, padding: "4px 10px", fontSize: 12 }}
          >
            我已了解
          </button>
        </div>
      )}

      <label style={{ fontSize: 12 }}>
        标题
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="可选"
          disabled={capturing}
          style={{
            display: "block",
            width: "100%",
            marginTop: 4,
            padding: "6px 8px",
            borderRadius: 6,
            border: `1px solid ${tokens.border}`,
            background: tokens.bg,
            color: tokens.text,
            boxSizing: "border-box",
          }}
        />
      </label>

      <div
        data-testid="meeting-capture-bar"
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          alignItems: "center",
          padding: "8px 10px",
          borderRadius: 8,
          border: `1px solid ${capturing ? tokens.accent : tokens.border}`,
          background: tokens.bg,
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 500 }}>
          {capturing ? (
            <>
              <span style={{ color: "#c44" }}>●</span> 录制中 {formatElapsed(elapsedMs)}
              {capturePhase === "processing" ? " · 分段识别中…" : ""}
              {capturePhase === "starting" ? " · 启动中…" : ""}
              {capturePhase === "stopping" ? " · 结束中…" : ""}
              {refinePending > 0 ? ` · AI 纠错中(${refinePending})` : ""}
            </>
          ) : (
            "未录制"
          )}
        </span>
        <span style={{ fontSize: 11, color: tokens.textSecondary }}>{localReadyLabel}</span>
        {softCapHint && capturing && (
          <span style={{ fontSize: 11, color: "#b8860b" }}>
            已超过 {Math.round(MEETING_LIVE_SOFT_CAP_MS / 60_000)} 分钟软提示（硬上限{" "}
            {Math.round(MEETING_LIVE_HARD_CAP_MS / 60_000)} 分钟）
          </span>
        )}
        {state.dictationCaptureActive && !capturing && (
          <span style={{ fontSize: 11, color: "#c44" }}>听写占用中</span>
        )}
      </div>

      <div
        data-testid="meeting-live-options"
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
          fontSize: 11,
          color: tokens.textSecondary,
          alignItems: "center",
        }}
      >
        <label
          style={{ display: "flex", gap: 4, alignItems: "center", cursor: "pointer" }}
          title="段末将转写发给已配置 LLM 做 correct_only 纠错（同听写 ASR 纠错开关）；会参考上文消歧同音字"
        >
          <input
            type="checkbox"
            data-testid="meeting-asr-refine"
            checked={state.asrRefinerEnabled === true}
            disabled={capturing}
            onChange={(e) =>
              dispatch({ type: "SET_ASR_REFINER_ENABLED", enabled: e.target.checked })
            }
          />
          录制 AI 纠错（参考上文）
        </label>
        <label
          style={{ display: "flex", gap: 4, alignItems: "center", cursor: "pointer" }}
          title="结束录制后自动按静音/段落规则切分转写"
        >
          <input
            type="checkbox"
            data-testid="meeting-auto-segment-stop"
            checked={autoSegmentOnStop}
            onChange={(e) => setAutoSegmentOnStop(e.target.checked)}
          />
          结束时智能分段
        </label>
        {state.asrRefinerEnabled === true && (
          <span style={{ fontSize: 10, color: tokens.warning }}>
            纠错走 Companion LLM；失败时保留原文
          </span>
        )}
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="button" disabled={busy || capturing} onClick={createMeeting} style={btnStyle(false)}>
          新建会议会话
        </button>
        {!capturing ? (
          <button
            type="button"
            data-testid="meeting-start-capture"
            disabled={busy || !ack || !state.voicePrivacyAckV2}
            onClick={startLiveCapture}
            style={btnStyle(true)}
            title={
              !ack || !state.voicePrivacyAckV2
                ? "请先确认本机语音隐私与会议隐私说明"
                : undefined
            }
          >
            开始录制
          </button>
        ) : (
          <>
            <button
              type="button"
              data-testid="meeting-stop-capture"
              onClick={() => stopLiveCapture(false)}
              style={btnStyle(false)}
            >
              结束录制
            </button>
            <button
              type="button"
              data-testid="meeting-stop-and-generate"
              onClick={() => stopLiveCapture(true)}
              style={btnStyle(true)}
            >
              结束并生成纪要
            </button>
          </>
        )}
        {meetingId && (
          <span style={{ fontSize: 11, color: tokens.textSecondary, alignSelf: "center" }}>
            id: {meetingId.slice(0, 12)}… · {status}
          </span>
        )}
      </div>

      {/* Mtg2: speaker + import */}
      <div
        data-testid="meeting-mtg2-tools"
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          padding: 10,
          borderRadius: 8,
          border: `1px solid ${tokens.border}`,
          background: tokens.bg,
        }}
      >
        <div style={{ fontSize: 12, fontWeight: 500 }}>说话人 / 导入（Mtg2+3）</div>
        <label style={{ fontSize: 11, color: tokens.textSecondary }}>
          默认说话人标签（录制/导入 STT 追加时使用；可整表批量）
          <input
            data-testid="meeting-default-speaker"
            value={defaultSpeaker}
            onChange={(e) => setDefaultSpeaker(e.target.value)}
            placeholder='如「我」或「张三」'
            disabled={capturing}
            style={{
              display: "block",
              width: "100%",
              marginTop: 4,
              padding: "6px 8px",
              borderRadius: 6,
              border: `1px solid ${tokens.border}`,
              background: tokens.bgElevated,
              color: tokens.text,
              boxSizing: "border-box",
              fontSize: 12,
            }}
          />
        </label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <label style={{ fontSize: 11, color: tokens.textSecondary }}>
            聚类 K
            <select
              data-testid="meeting-diarize-k"
              value={diarizeK}
              disabled={busy || capturing}
              onChange={(e) => setDiarizeK(Math.min(4, Math.max(2, Number(e.target.value) || 2)))}
              style={{ marginLeft: 4, fontSize: 12 }}
            >
              <option value={2}>2</option>
              <option value={3}>3</option>
              <option value={4}>4</option>
            </select>
          </label>
          <label style={{ fontSize: 11, color: tokens.textSecondary, display: "flex", gap: 4, alignItems: "center" }}>
            <input
              type="checkbox"
              checked={autoDiarizeAfterImport}
              disabled={busy || capturing}
              onChange={(e) => setAutoDiarizeAfterImport(e.target.checked)}
            />
            音频导入后自动标（实验）
          </label>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          <button
            type="button"
            data-testid="meeting-silence-cut"
            disabled={busy || capturing || !ack}
            onClick={applySilenceCut}
            style={btnStyle(false)}
            title="按空行/句号/长度软切分段（非说话人识别）"
          >
            智能分段
          </button>
          <button
            type="button"
            data-testid="meeting-bulk-speaker"
            disabled={busy || capturing || !ack}
            onClick={bulkLabelSpeaker}
            style={btnStyle(false)}
          >
            全部标为默认
          </button>
          <button
            type="button"
            data-testid="meeting-auto-diarize-audio"
            disabled={busy || capturing || !ack}
            onClick={() => runAutoDiarize("audio_cluster")}
            style={btnStyle(true)}
            title="基于上传音频段的声学特征 k-means；匿名发言人N"
          >
            自动标说话人
          </button>
          <button
            type="button"
            data-testid="meeting-auto-diarize-text"
            disabled={busy || capturing || !ack}
            onClick={() => runAutoDiarize("text_gap")}
            style={btnStyle(false)}
            title="弱：按行交替发言人N，非声学"
          >
            弱标（交替）
          </button>
          <button
            type="button"
            data-testid="meeting-import-text"
            disabled={busy || capturing || !ack}
            onClick={() => textFileRef.current?.click()}
            style={btnStyle(false)}
          >
            上传转写文件
          </button>
          <button
            type="button"
            data-testid="meeting-import-audio"
            disabled={busy || capturing || !ack}
            onClick={() => audioFileRef.current?.click()}
            style={btnStyle(false)}
          >
            上传音频转写
          </button>
          {busy && importStatus?.includes("本机转写") && (
            <button
              type="button"
              data-testid="meeting-import-abort"
              onClick={() => {
                importAbortRef.current = true
                setImportStatus("正在中止…")
              }}
              style={btnStyle(false)}
            >
              中止导入
            </button>
          )}
        </div>
        <input
          ref={textFileRef}
          type="file"
          accept=".txt,.md,text/plain,text/markdown"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0] || null
            e.target.value = ""
            void onImportTextFile(f)
          }}
        />
        <input
          ref={audioFileRef}
          type="file"
          accept="audio/*,.wav,.mp3,.m4a,.ogg,.webm"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0] || null
            e.target.value = ""
            void onImportAudioFile(f)
          }}
        />
        {importStatus && (
          <div style={{ fontSize: 11, color: tokens.textSecondary }} data-testid="meeting-import-status">
            {importStatus}
          </div>
        )}
        <div style={{ fontSize: 10, color: tokens.textSecondary, lineHeight: 1.4 }}>
          「自动标说话人」= 本机段特征 k-means → 匿名「发言人N」，
          <strong>不是</strong>身份识别，也非 Otter 级 SLA。默认覆盖已有标签（可再手改）。
          弱标仅按行交替。系统混音见 parking 调研。
        </div>
      </div>

      <label style={{ fontSize: 12, flex: 1, display: "flex", flexDirection: "column" }}>
        转写 / 口述文字（可编辑 · 支持「说话人: 正文」）
        <textarea
          value={transcript}
          onChange={(e) => {
            transcriptDirtyRef.current = true
            setTranscript(e.target.value)
          }}
          placeholder="粘贴会议转写，或开始录制/上传后自动填入…&#10;张三: 第一段&#10;&#10;李四: 第二段"
          rows={8}
          style={{
            marginTop: 4,
            width: "100%",
            flex: 1,
            minHeight: 120,
            padding: 8,
            borderRadius: 6,
            border: `1px solid ${tokens.border}`,
            background: tokens.bg,
            color: tokens.text,
            resize: "vertical",
            boxSizing: "border-box",
            fontFamily: "inherit",
            fontSize: 12,
            lineHeight: 1.45,
          }}
        />
        {capturing ? (
          <div
            data-testid="meeting-interim"
            style={{
              marginTop: 6,
              padding: "8px 10px",
              borderRadius: 8,
              background: tokens.accentSoft,
              border: `1px solid rgba(79, 70, 229, 0.16)`,
              fontSize: 13,
              color: tokens.accentText,
              lineHeight: 1.45,
              maxHeight: 96,
              overflow: "auto",
              whiteSpace: "pre-wrap",
            }}
          >
            {meetingLiveInterimHint({
              phase: capturePhase,
              interimText,
              nearRealtime,
              refinePending,
            })}
          </div>
        ) : null}
      </label>

      <details style={{ fontSize: 12 }}>
        <summary style={{ cursor: "pointer", color: tokens.textSecondary }}>
          纪要模板（可选）
        </summary>
        <p style={{ fontSize: 10, color: tokens.textSecondary, margin: "6px 0" }}>
          模板只约束输出结构；不会改变「不得臆造」规则。生成时把转写文本发给已配置 LLM。
        </p>
        <textarea
          value={templateMd}
          onChange={(e) => {
            const v = e.target.value
            setTemplateMd(v)
            templateMdRef.current = v
          }}
          placeholder={"### TL;DR\n\n### 决议\n\n### 待办\n\n### 风险 / 开放问题"}
          rows={5}
          style={{
            marginTop: 4,
            width: "100%",
            minHeight: 80,
            padding: 8,
            borderRadius: 6,
            border: `1px solid ${tokens.border}`,
            background: tokens.bg,
            color: tokens.text,
            resize: "vertical",
            boxSizing: "border-box",
            fontFamily: "inherit",
            fontSize: 12,
            lineHeight: 1.45,
          }}
        />
        <button
          type="button"
          onClick={() => {
            setTemplateMd("")
            templateMdRef.current = ""
            saveMeetingTemplate("")
          }}
          style={{
            marginTop: 6,
            fontSize: 11,
            padding: "4px 8px",
            borderRadius: 4,
            border: `1px solid ${tokens.border}`,
            background: tokens.bg,
            color: tokens.textSecondary,
            cursor: "pointer",
          }}
        >
          恢复默认
        </button>
      </details>

      <button type="button" disabled={busy || !ack || capturing} onClick={generate} style={btnStyle(true)}>
        {busy || pendingGenerate ? "生成中…" : "生成会议纪要"}
      </button>

      {error && (
        <div style={{ color: "#c44", fontSize: 12 }} role="alert">
          {error}
        </div>
      )}

      {minutesMd && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <strong style={{ flex: 1, fontSize: 12 }}>纪要</strong>
            <button type="button" onClick={copyMinutes} style={linkBtn}>
              复制
            </button>
            <button type="button" onClick={() => props.onSendToDraft(minutesMd)} style={linkBtn}>
              发送到对话草稿
            </button>
          </div>
          <pre
            style={{
              margin: 0,
              padding: 10,
              borderRadius: 8,
              border: `1px solid ${tokens.border}`,
              background: tokens.bg,
              fontSize: 11,
              lineHeight: 1.45,
              whiteSpace: "pre-wrap",
              maxHeight: 280,
              overflow: "auto",
            }}
          >
            {minutesMd}
          </pre>
        </div>
      )}
    </div>
  )
}

function btnStyle(primary: boolean): CSSProperties {
  return {
    border: primary ? "none" : `1px solid ${tokens.border}`,
    background: primary ? tokens.accent : "transparent",
    color: primary ? "#fff" : tokens.text,
    borderRadius: 8,
    padding: "8px 12px",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 500,
  }
}

const linkBtn: CSSProperties = {
  border: "none",
  background: "transparent",
  color: tokens.accent,
  cursor: "pointer",
  fontSize: 11,
  textDecoration: "underline",
  padding: 0,
}

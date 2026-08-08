/**
 * Meeting workbench — Mtg0 paste + Mtg1 live capture (local segmented STT).
 * SoT: docs/superpowers/specs/2026-08-07-meeting-minutes-design.md
 * Does NOT auto-start mic on pack apply. Forces local STT for long capture.
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react"
import { useAgentStore } from "../store/agentStore"
import { tokens } from "../ui/tokens"
import { createLocalSttAdapter } from "../voice/local-stt-adapter"
import { detectLocalMediaCapture } from "../voice/local-stt-detect"
import {
  VOICE_CONTINUOUS_HARD_CAP_MS,
  VOICE_CONTINUOUS_SOFT_CAP_MS,
  VOICE_DEFAULT_LANG,
} from "../voice/detect"
import type { SpeechAdapter } from "../voice/web-speech-adapter"

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

function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${r.toString().padStart(2, "0")}`
}

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
  const [pendingGenerate, setPendingGenerate] = useState(false)

  const adapterRef = useRef<SpeechAdapter | null>(null)
  const captureStartRef = useRef<number | null>(null)
  const meetingIdRef = useRef<string | null>(null)
  const phaseRef = useRef<CapturePhase>("idle")
  const wantGenerateRef = useRef(false)
  const transcriptRef = useRef("")
  /** Prevent double meeting.end / finalize. */
  const finalizedRef = useRef(false)
  const titleRef = useRef(title)

  meetingIdRef.current = meetingId
  transcriptRef.current = transcript
  titleRef.current = title
  phaseRef.current = capturePhase

  const companionConnected = state.connectionState === "connected"
  const activeModelId = state.voiceModel?.localModelId || "medium"
  const localModelReady = state.voiceModel?.models?.[activeModelId]?.status === "ready"
  const localBinaryReady = state.voiceModel?.binary?.status === "ready"
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
        if (ms >= VOICE_CONTINUOUS_SOFT_CAP_MS) setSoftCapHint(true)
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

  const appendLocalAndRemote = useCallback((chunk: string, id: string | null) => {
    const t = chunk.trim()
    if (!t) return
    setTranscript((prev) => {
      const next = prev ? `${prev}\n${t}` : t
      transcriptRef.current = next
      return next
    })
    if (id) {
      sendViaRuntime({
        type: "meeting.append_transcript",
        v: 1,
        id,
        text: t,
        source: "stt",
      })
    }
  }, [])

  /**
   * End server session + tear down adapter. Idempotent via finalizedRef.
   * Always send meeting.end when we have an id so close/unmount cannot leave status=recording.
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
      if (id) {
        sendViaRuntime({ type: "meeting.end", v: 1, id })
      }
      if (opts.generate) {
        setBusy(true)
        setPendingGenerate(true)
        setTimeout(() => {
          if (id) {
            sendViaRuntime({ type: "meeting.generate_minutes", v: 1, id })
          } else {
            const text = transcriptRef.current.trim()
            sendViaRuntime({
              type: "meeting.generate_minutes",
              v: 1,
              text: text || undefined,
            })
          }
        }, 100)
      }
    },
    [destroyAdapter, dispatch, setPhase],
  )

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
        setError("请先在设置中确认本机语音隐私说明（voice_privacy_ack_v2）后再录会议")
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
          },
          onResult: ({ finalChunk }) => {
            if (finalChunk?.trim()) {
              appendLocalAndRemote(finalChunk, meetingIdRef.current || id)
            }
          },
          onError: (code) => {
            if (code === "aborted") return
            setError(`转写错误: ${code}`)
          },
          onEnd: () => {
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
      adapter.start({
        lang: VOICE_DEFAULT_LANG,
        sessionId: sid,
        modelId: activeModelId,
        mode: "continuous",
        hardCapMs: VOICE_CONTINUOUS_HARD_CAP_MS,
      })
    },
    [
      activeModelId,
      appendLocalAndRemote,
      destroyAdapter,
      finalizeCapture,
      localBinaryReady,
      localMedia.ok,
      localModelReady,
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
        if (msg.meeting.minutes?.raw_md) setMinutesMd(msg.meeting.minutes.raw_md)
        setBusy(false)
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
      setError("请先在设置中确认本机语音隐私说明（voice_privacy_ack_v2）")
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
      })
    }
    sendViaRuntime({
      type: "meeting.generate_minutes",
      v: 1,
      id: meetingId || undefined,
      text: transcript.trim() || undefined,
    })
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
        <span style={{ fontSize: 11, color: tokens.textSecondary }}>暂不分说话人</span>
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
        粘贴转写，或显式「开始录制」用本机分段转写（最长约{" "}
        {Math.round(VOICE_CONTINUOUS_HARD_CAP_MS / 60_000)} 分钟）。应用「会议记录」场景不会自动开麦。
        录音与听写互斥。
      </div>

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
            隐私说明（meeting_privacy_ack_v1）
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
            </>
          ) : (
            "未录制"
          )}
        </span>
        <span style={{ fontSize: 11, color: tokens.textSecondary }}>{localReadyLabel}</span>
        {softCapHint && capturing && (
          <span style={{ fontSize: 11, color: "#b8860b" }}>已超过 5 分钟软提示</span>
        )}
        {state.dictationCaptureActive && !capturing && (
          <span style={{ fontSize: 11, color: "#c44" }}>听写占用中</span>
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
            disabled={busy || !ack}
            onClick={startLiveCapture}
            style={btnStyle(true)}
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

      <label style={{ fontSize: 12, flex: 1, display: "flex", flexDirection: "column" }}>
        转写 / 口述文字（可编辑）
        <textarea
          value={transcript}
          onChange={(e) => setTranscript(e.target.value)}
          placeholder="粘贴会议转写，或开始录制后自动填入本机转写…"
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
      </label>

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

/**
 * Meeting workbench (Mtg0 paste + generate; Mtg1 status shell).
 * SoT: docs/superpowers/specs/2026-08-07-meeting-minutes-design.md
 * Does NOT auto-start mic on pack apply.
 */

import { useCallback, useEffect, useState, type CSSProperties } from "react"
import { useAgentStore } from "../store/agentStore"
import { tokens } from "../ui/tokens"

type Minutes = {
  raw_md: string
  tldr?: string
  generated_at?: string
}

type Meeting = {
  id: string
  title: string
  status: string
  transcript?: Array<{ text: string }>
  minutes?: Minutes | null
}

/**
 * Companion replies arrive via WS → SW → chrome.runtime.sendMessage.
 */
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

export function MeetingPanel(props: {
  onClose: () => void
  onSendToDraft: (text: string) => void
}) {
  const { state } = useAgentStore()
  const [title, setTitle] = useState("")
  const [transcript, setTranscript] = useState("")
  const [minutesMd, setMinutesMd] = useState("")
  const [meetingId, setMeetingId] = useState<string | null>(null)
  const [status, setStatus] = useState<string>("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ack, setAck] = useState(false)

  useEffect(() => {
    try {
      chrome.storage.local.get("meeting_privacy_ack_v1", (r) => {
        if (r.meeting_privacy_ack_v1 === true) setAck(true)
      })
    } catch {
      /* */
    }
  }, [])

  const onMsg = useCallback((msg: any) => {
    if (msg.type === "meeting.created" && msg.meeting) {
      setMeetingId(msg.meeting.id)
      setTitle(msg.meeting.title || "")
      setStatus(msg.meeting.status || "draft")
      setBusy(false)
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
      setError(null)
    }
    if (msg.type === "meeting.error") {
      setError(msg.message || msg.code || "error")
      setBusy(false)
    }
  }, [])

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
    chrome.runtime.sendMessage({
      type: "meeting.create",
      v: 1,
      title: title || undefined,
      thread_id: state.activeThreadId || undefined,
    })
  }

  const generate = async () => {
    if (!ensureAck()) return
    if (!transcript.trim() && !meetingId) {
      setError("请先粘贴转写文本")
      return
    }
    setBusy(true)
    setError(null)
    if (meetingId && transcript.trim()) {
      chrome.runtime.sendMessage({
        type: "meeting.set_transcript",
        v: 1,
        id: meetingId,
        text: transcript,
        source: "paste",
      })
    }
    chrome.runtime.sendMessage({
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
          onClick={props.onClose}
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
        粘贴转写后生成结构化纪要（TL;DR / 决议 / 待办 / 风险）。应用「会议记录」场景不会自动开麦。
        长会录音请用本机转写引擎（后续可在此工作台显式开始）。
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
          <div style={{ marginBottom: 6, color: tokens.text, fontWeight: 500 }}>隐私说明（meeting_privacy_ack_v1）</div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            <li>会创建本地会话产物（转写 ± 可选音频）。</li>
            <li>默认转写成功后删除音频（若启用录音）。</li>
            <li>生成纪要将把转写文本发给你已配置的 LLM。</li>
            <li>长会 STT 仅本机；不会自动开始录音。</li>
            <li>多方录音法律合规由你负责。</li>
          </ul>
          <button
            type="button"
            onClick={acceptAck}
            style={{
              marginTop: 8,
              border: "none",
              background: tokens.accent,
              color: "#fff",
              borderRadius: 6,
              padding: "4px 10px",
              cursor: "pointer",
              fontSize: 12,
            }}
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

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          disabled={busy}
          onClick={createMeeting}
          style={btnStyle(false)}
        >
          新建会议会话
        </button>
        {meetingId && (
          <span style={{ fontSize: 11, color: tokens.textSecondary, alignSelf: "center" }}>
            id: {meetingId.slice(0, 12)}… · {status}
          </span>
        )}
      </div>

      <label style={{ fontSize: 12, flex: 1, display: "flex", flexDirection: "column" }}>
        转写 / 口述文字
        <textarea
          value={transcript}
          onChange={(e) => setTranscript(e.target.value)}
          placeholder="粘贴会议转写或要点…"
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

      <button
        type="button"
        disabled={busy || !ack}
        onClick={generate}
        style={btnStyle(true)}
      >
        {busy ? "生成中…" : "生成会议纪要"}
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
            <button
              type="button"
              onClick={() => props.onSendToDraft(minutesMd)}
              style={linkBtn}
            >
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

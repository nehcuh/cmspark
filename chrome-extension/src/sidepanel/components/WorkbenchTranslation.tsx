import { useCallback, useEffect, useRef, useState } from "react"
import { useAgentStore } from "../store/agentStore"
import { tokens } from "../ui/tokens"
import { createMeetingRuntimeChannel } from "../voice/meeting-runtime-channel"

type Segment = { id: string; version: string; text: string; speaker?: string; t0?: number }
type Translation = Pick<Segment, "id" | "version" | "text"> & { language: string; model: string }
type Receiver = { token: string; endpoint: string; model: string; profile?: string }
type Channel = ReturnType<typeof createMeetingRuntimeChannel>
const languages = ["简体中文", "繁體中文", "English", "日本語", "한국어", "Français", "Deutsch", "Español"]
const segmentKey = (line: Segment) => line.id + "/" + line.version

async function request(channel: Channel, action: string, response: string, fields: object) {
  const receipt = await channel.request({ type: "meeting.translation." + action, ...fields }, action === "run" ? 70_000 : 10_000)
  if (receipt.type !== "meeting.translation." + response) {
    throw Object.assign(new Error(receipt.message || "翻译回执无效，请重试"), { code: receipt.code })
  }
  return receipt
}

function cancelPermit(token?: string) {
  if (token) void chrome.runtime.sendMessage({ type: "meeting.translation.cancel", v: 1, id: crypto.randomUUID(), token }).catch(() => {})
}

export function WorkbenchTranslation() {
  return <TranslationPanel />
}

export function MeetingTranslation({ meetingId }: { meetingId: string }) {
  return <TranslationPanel key={meetingId} meetingId={meetingId} />
}

function TranslationPanel({ meetingId }: { meetingId?: string }) {
  const { state, dispatch } = useAgentStore()
  const connected = state.connectionState === "connected"
  const [language, setLanguage] = useState("English")
  const [source, setSource] = useState("")
  const [result, setResult] = useState("")
  const [rows, setRows] = useState<Segment[]>([])
  const [saved, setSaved] = useState<Translation[]>([])
  const [failures, setFailures] = useState<Record<string, string>>({})
  const [receiver, setReceiver] = useState<Receiver | null>(null)
  const [active, setActive] = useState(false)
  const [working, setWorking] = useState("")
  const [notice, setNotice] = useState("")
  const channelRef = useRef<Channel | null>(null)
  const permit = useRef<Receiver | null>(null)
  const generation = useRef(0)
  const inFlight = useRef(false)
  const reloadRef = useRef<() => void>(() => {})

  const stop = useCallback(() => {
    generation.current++
    cancelPermit(permit.current?.token)
    permit.current = null
    inFlight.current = false
    setReceiver(null)
    setActive(false)
    setWorking("")
    setFailures({})
  }, [])

  useEffect(() => {
    stop()
    if (!connected) return
    let disposed = false, refreshing = false, dirty = false
    const channel = createMeetingRuntimeChannel(() => {}, () => {
      stop()
      setNotice("连接已断开，已取得的译文仍可查看。重新连接后请核对接收方。")
    })
    channelRef.current = channel
    async function reload() {
      if (!meetingId || disposed) return
      dirty = true
      if (refreshing) return
      refreshing = true
      try {
        while (dirty && !disposed) {
          dirty = false
          const list = await request(channel, "list", "listed", { meeting_id: meetingId })
          if (!disposed) {
            setRows(list.segments)
            setSaved(list.translations)
          }
        }
      } catch {
        if (!disposed) setNotice("读取分段译文失败，请重新读取。")
      } finally { refreshing = false }
    }
    reloadRef.current = reload
    const listener = (msg: any) => {
      if (meetingId && msg.meeting?.id === meetingId && Array.isArray(msg.meeting.transcript)) void reload()
      return false
    }
    if (meetingId) {
      chrome.runtime.onMessage.addListener(listener)
      void reload()
    }
    window.addEventListener("pagehide", stop)
    return () => {
      disposed = true
      generation.current++
      cancelPermit(permit.current?.token)
      permit.current = null
      channelRef.current = null
      reloadRef.current = () => {}
      window.removeEventListener("pagehide", stop)
      if (meetingId) chrome.runtime.onMessage.removeListener(listener)
      channel.destroy()
    }
  }, [meetingId, connected, state.configRevision, state.activeThreadSelectionRevision, stop])

  const fields = () => meetingId ? { meeting_id: meetingId, language } : { text: source, language }
  async function prepare() {
    const channel = channelRef.current
    if (!channel || inFlight.current) return
    stop()
    const epoch = generation.current
    inFlight.current = true
    setWorking("核对接收方…")
    setNotice("")
    try {
      const next = await request(channel, "prepare", "prepared", fields())
      if (epoch !== generation.current) { cancelPermit(next.token); return }
      if (!next.token || !next.endpoint || !next.model) throw new Error("无法核对翻译接收方")
      permit.current = next
      setReceiver(next)
    } catch (error) {
      if (epoch === generation.current) setNotice(error instanceof Error ? error.message : "准备翻译失败")
    } finally {
      if (epoch === generation.current) { inFlight.current = false; setWorking("") }
    }
  }

  async function translate(row?: Segment) {
    const channel = channelRef.current
    const target = permit.current
    if (!channel || !target || inFlight.current) return
    const epoch = generation.current
    inFlight.current = true
    setWorking(row ? segmentKey(row) : "正在翻译…")
    try {
      const response = await request(channel, "run", "result", {
        ...fields(), token: target.token, ...(row ? { segment_id: row.id, version: row.version } : {}),
      })
      if (epoch !== generation.current) return
      if (row) {
        const entry = response.entry as Translation
        if (entry?.id !== row.id || entry.version !== row.version || entry.language !== language || !entry.text) throw new Error("译文与当前段落不匹配")
        setSaved(prior => [...prior.filter(item => item.id !== row.id || item.language !== language), entry])
      } else {
        setResult(response.text)
      }
    } catch (error: any) {
      if (epoch !== generation.current) return
      const message = error.message || "翻译失败，请重试"
      if (row && error.code !== "consent_changed" && error.code !== "model_missing") {
        setFailures(prior => ({ ...prior, [segmentKey(row)]: message }))
        if (error.code === "stale") reloadRef.current()
      } else {
        stop()
        setNotice(message)
      }
    } finally {
      if (epoch === generation.current) {
        if (!row) stop()
        inFlight.current = false
        setWorking("")
      }
    }
  }

  const current = new Map(saved.filter(entry => entry.language === language).map(entry => [entry.id, entry]))
  useEffect(() => {
    if (!active || !meetingId || inFlight.current) return
    const next = rows.find(row => row.version !== current.get(row.id)?.version && !failures[segmentKey(row)])
    if (next) void translate(next)
  })

  return <section aria-label={meetingId ? "分段翻译" : "文本翻译"} className={meetingId ? undefined : "cm-workbench-page"} style={{ display: "grid", gap: 10, padding: meetingId ? 12 : undefined, minWidth: 0 }}>
    <h3 style={{ margin: 0 }}>{meetingId ? "分段翻译" : "文本翻译"}</h3>
    {!meetingId && <label>原文<textarea rows={6} maxLength={16000} style={{ width: "100%", boxSizing: "border-box" }} value={source}
      onChange={event => { stop(); setSource(event.target.value); setResult(""); setNotice("") }} /></label>}
    <label>译为 <select value={language} onChange={event => { stop(); setLanguage(event.target.value); setResult(""); setNotice("") }}>
      {languages.map(name => <option key={name}>{name}</option>)}
    </select></label>
    {!connected && <span role="status">Companion 未连接</span>}
    {!receiver && <div><button className="cm-p-button" type="button" disabled={!connected || !!working || (!meetingId && !source.trim())}
      onClick={prepare}>{working || "核对翻译接收方"}</button></div>}
    {receiver && <div style={{ display: "grid", gap: 6, overflowWrap: "anywhere" }}>
      <strong>{receiver.profile || "文本接收服务"} · {receiver.endpoint}</strong>
      <span>模型 {receiver.model} · 目标语言 {language}</span>
      <span>{meetingId ? "确认后逐段发送本场已保存和后续保存的转写。翻译服务仅接收文字。" : `本次发送上方原文，共 ${source.length} 字。`}</span>
      <div>{!active && !working && <button className="cm-p-button" type="button" onClick={() => {
        if (meetingId) setActive(true)
        else void translate()
      }}>确认发送并翻译</button>} <button className="cm-p-link" type="button" onClick={() => { stop(); setNotice("已取消，已取得的译文仍可查看。") }}>
        {active || working ? "停止翻译" : "取消"}</button></div>
      {(active || working) && <span role="status">{working ? "正在翻译…" : "已开启分段翻译"}</span>}
    </div>}
    {notice && <div role="status">{notice} <button type="button" className="cm-p-link" onClick={() => dispatch({ type: "OPEN_SETTINGS_SECTION", section: "model-meeting-minutes" })}>模型设置</button>
      {meetingId && connected && <button type="button" className="cm-p-link" onClick={() => reloadRef.current()}>重新读取</button>}</div>}
    {result && <section aria-label="译文" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}><strong>译文</strong><div>{result}</div></section>}
    {meetingId && rows.map((row, index) => {
      const translation = current.get(row.id)
      const key = segmentKey(row)
      return <div key={row.id} style={{ borderTop: `1px solid ${tokens.border}`, paddingTop: 8, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
        <small>{typeof row.t0 === "number" ? `${Math.floor(row.t0 / 60)}:${String(Math.floor(row.t0 % 60)).padStart(2, "0")}` : `第 ${index + 1} 段`} {row.speaker}</small>
        <div>{row.text}</div>
        {translation?.version === row.version && <div aria-label="译文" style={{ color: tokens.accentText }}>{translation.text}</div>}
        {failures[key] && <div role="status">{failures[key]} <button type="button" className="cm-p-link" disabled={!active || !!working} onClick={() => {
          setFailures(prior => { const next = { ...prior }; delete next[key]; return next })
        }}>重试此段</button></div>}
      </div>
    })}
  </section>
}

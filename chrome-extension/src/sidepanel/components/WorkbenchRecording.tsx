import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { tokens } from "../ui/tokens"
import { formatMeetingElapsed } from "../voice/meeting-caps"
import { focusWorkbenchCaptureOwner, claimWorkbenchCapture } from "../voice/workbench-capture-owner"
import { recordingStore, type ScreenRecording } from "../voice/workbench-recording-store"
import { recordWorkbenchScreen, ScreenCaptureBusy, type ScreenPhase } from "../voice/workbench-screen-capture"

const button = {
  background: tokens.bg, border: `1px solid ${tokens.borderStrong}`, borderRadius: tokens.radiusSm,
  color: tokens.text, padding: "7px 12px", font: "inherit", cursor: "pointer",
}
const actions = { display: "flex", alignItems: "center", flexWrap: "wrap" as const, gap: 8 }

function message(error: unknown): string {
  if (error instanceof DOMException && error.name === "NotAllowedError") return "未获屏幕共享权限，录屏未开始"
  return error instanceof Error ? error.message : "本机录屏操作失败"
}

export function WorkbenchRecording({ visible = true, pendingContext, onActiveChange }: {
  visible?: boolean
  pendingContext?: unknown
  onActiveChange?: (active: boolean) => void
} = {}) {
  const [audio, setAudio] = useState(false)
  const [phase, setPhase] = useState<ScreenPhase | "idle">("idle")
  const [status, setStatus] = useState("")
  const [busy, setBusy] = useState(false)
  const [rows, setRows] = useState<ScreenRecording[]>([])
  const [preview, setPreview] = useState<{ id: string, url: string } | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const active = useRef<AbortController | null>(null)
  const capturing = useRef(false)
  const mounted = useRef(false)
  const previewVersion = useRef(0)
  const listVersion = useRef(0)
  useLayoutEffect(() => {
    if (active.current && !capturing.current) {
      active.current.abort("context")
      setStatus("本次来源选择已取消，请关闭浏览器选择器后重新开始")
    }
  }, [visible, pendingContext])
  const refresh = useCallback(async () => {
    const version = ++listVersion.current
    try {
      const result = await recordingStore.list()
      if (mounted.current && version === listVersion.current) setRows(result)
    } catch (error) {
      if (mounted.current) setStatus(message(error))
    }
  }, [])
  useEffect(() => {
    mounted.current = true
    void refresh()
    const onClose = (event: BeforeUnloadEvent) => {
      if (active.current) {
        event.preventDefault()
        event.returnValue = ""
      }
    }
    const onHide = () => active.current?.abort("page")
    window.addEventListener("beforeunload", onClose)
    window.addEventListener("pagehide", onHide)
    window.addEventListener("focus", refresh)
    return () => {
      mounted.current = false
      ++previewVersion.current
      onHide()
      window.removeEventListener("beforeunload", onClose)
      window.removeEventListener("pagehide", onHide)
      window.removeEventListener("focus", refresh)
    }
  }, [refresh])
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url) }, [preview])

  async function start() {
    if (active.current) return
    const controller = new AbortController()
    active.current = controller
    capturing.current = false
    setBusy(false)
    setPhase("choosing")
    setStatus("正在准备选择共享来源")
    try {
      const row = await recordWorkbenchScreen(audio, controller.signal, (next, text) => {
        if (next === "recording") {
          capturing.current = true
          onActiveChange?.(true)
        }
        if (mounted.current) { setPhase(next); setStatus(text) }
      })
      if (mounted.current) setStatus(row.chunks ? `${row.detail}。已保存 ${row.chunks} 个分块。` : row.detail)
    } catch (error) {
      if (mounted.current) { setStatus(message(error)); setBusy(error instanceof ScreenCaptureBusy) }
    } finally {
      active.current = null
      if (capturing.current) onActiveChange?.(false)
      if (mounted.current) { setPhase("idle"); void refresh() }
    }
  }

  async function show(row: ScreenRecording) {
    const version = ++previewVersion.current
    try {
      const blob = await recordingStore.read(row)
      if (mounted.current && previewVersion.current === version) setPreview({ id: row.id, url: URL.createObjectURL(blob) })
    } catch (error) {
      if (mounted.current && previewVersion.current === version) setStatus(message(error))
    }
  }

  async function remove(id: string) {
    try {
      const release = await claimWorkbenchCapture("screen")
      if (!release) throw new ScreenCaptureBusy("请先在采集工作台停止录制，再清除本机记录")
      try {
        await recordingStore.remove(id)
        ++previewVersion.current
        setPreview(current => current?.id === id ? null : current)
        setDeleting(null)
        await refresh()
      } finally { release() }
    } catch (error) { setStatus(message(error)); setBusy(error instanceof ScreenCaptureBusy) }
  }

  return <section aria-label="屏幕录制" className="cm-workbench-page" style={{ color: tokens.text }}>
    <h2>录屏</h2>
    <p>请选择要录制的标签页、窗口或屏幕。视频仅保存在此浏览器配置中。</p>
    <div style={actions}>
      <label><input type="checkbox" checked={audio} disabled={phase !== "idle"}
        onChange={event => setAudio(event.target.checked)} /> 包含共享来源声音</label>
      {phase === "idle"
        ? <button style={button} onClick={start}>选择来源并录屏</button>
        : <button style={button} disabled={phase === "finishing"} onClick={() => {
            active.current?.abort(phase === "choosing" ? "cancel" : "stop")
            if (phase === "choosing") setStatus("已取消本次请求，请关闭浏览器的来源选择器")
          }}>{phase === "choosing" ? "取消录屏" : phase === "finishing" ? "正在整理…" : "停止录屏"}</button>}
      {busy && <button style={button} onClick={focusWorkbenchCaptureOwner}>返回采集中的工作台</button>}
    </div>
    <p role="status">{status}</p>
    {rows.length > 0 && <h3>本机录屏</h3>}
    {rows.map(row => <article key={row.id} style={{ borderTop: `1px solid ${tokens.border}`, padding: "12px 0" }}>
      <strong>{new Date(row.started).toLocaleString()}</strong>
      <p>{row.state === "complete" ? "录制已结束" : row.state === "partial" ? row.detail : "录制尚未封装，可恢复已写入的部分"}
        {" · "}{row.chunks} 个分块 · 约 {formatMeetingElapsed(row.elapsedMs)} · {(row.bytes / (1024 * 1024)).toFixed(1)} MB</p>
      <div style={actions}>
        {row.bytes > 0 && <button style={button} onClick={() => show(row)}>预览与保存</button>}
        {deleting !== row.id ? <button style={button} disabled={phase !== "idle"} onClick={() => setDeleting(row.id)}>清除</button>
          : <><button style={button} onClick={() => remove(row.id)}>确认清除本机录屏</button>
            <button style={button} onClick={() => setDeleting(null)}>取消</button></>}
      </div>
      {preview?.id === row.id && <div>
        <video controls src={preview.url} aria-label="录屏预览" style={{ width: "100%", maxHeight: "48vh", margin: "10px 0" }}
          onError={() => setStatus("浏览器无法播放这些分块，可保存 WebM 文件尝试恢复。")} />
        <a href={preview.url} download={`CMspark-${new Date(row.started).toISOString().replace(/:/g, "-")}.webm`}>保存 WebM 文件</a>
      </div>}
    </article>)}
  </section>
}

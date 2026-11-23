import { useEffect, useRef, useState } from "react"
import { formatMeetingElapsed as time } from "../voice/meeting-caps"
import { listMeetingFrames, readMeetingFrame, recordingStore, RECORDING_REMOVALS, type MeetingFrame, type ScreenRecording } from "../voice/workbench-recording-store"
import {
  encodeMeetingFrame, frameMetadata, representativeFrameIds, sameFrame, visualRequest, VisualRequestError,
  type FrameSource, type PreparedVisual, type VisualEvidence, type VisualList,
} from "../voice/meeting-visual-client"

function FrameImage({ frame, large = false }: { frame: MeetingFrame; large?: boolean }) {
  const [url, setUrl] = useState("")
  useEffect(() => {
    const value = URL.createObjectURL(frame.blob)
    setUrl(value)
    return () => URL.revokeObjectURL(value)
  }, [frame.blob])
  return url ? <img loading="lazy" src={url} alt={`会议画面 ${time(frame.timeMs)}`}
    style={{ display: "block", width: "100%", maxHeight: large ? "55vh" : 96, objectFit: "contain" }} /> : null
}

function FramePlayer({ row, timeMs }: { row: ScreenRecording; timeMs: number }) {
  const [url, setUrl] = useState("")
  const [notice, setNotice] = useState("")
  useEffect(() => {
    let active = true
    let value = ""
    void recordingStore.read(row).then(blob => {
      if (active) { value = URL.createObjectURL(blob); setUrl(value) }
    }).catch(() => { if (active) setNotice("本地录屏无法读取。") })
    return () => { active = false; if (value) URL.revokeObjectURL(value) }
  }, [row])
  return <>{url && <video src={url} controls style={{ width: "100%", maxHeight: "45vh" }} onLoadedMetadata={e => {
    const video = e.currentTarget
    const at = timeMs / 1000
    for (let i = 0; i < video.seekable.length; i++) {
      if (video.seekable.start(i) <= at && at <= video.seekable.end(i)) { video.currentTime = at; return }
    }
    setNotice(`此录屏暂无法跳至 ${time(timeMs)}，可查看对应截图。`)
  }} onError={() => setNotice("浏览器无法播放本地录屏，可查看上方截图。")} />}{notice && <p role="status">{notice}</p>}</>
}

export function MinutesWithFrameLinks({ text, sources, open }: { text: string; sources?: FrameSource[]; open: (source: FrameSource) => void }) {
  if (!sources?.length) return <>{text}</>
  return <>{text.split(/(〔画面:[^〔〕\n]+〕)/g).map((part, i) => {
    const token = /^〔画面:([^@]+)@(\d+)ms｜(.+)〕$/.exec(part)
    const source = token && sources.find(item => item.frameId === token[1] && item.timeMs === Number(token[2]))
    return source ? <button type="button" key={i} onClick={() => open(source)}>{time(source.timeMs)} · {token[3]}</button> : part
  })}</>
}

type Preview = { source: FrameSource; serial: number }

export function MeetingVisualReview({ meetingId, connected, focus, onChange, openSettings }: {
  meetingId: string; connected: boolean; focus: Preview | null; onChange: () => void; openSettings: () => void
}) {
  const [frames, setFrames] = useState<MeetingFrame[]>([])
  const [rows, setRows] = useState<ScreenRecording[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [evidence, setEvidence] = useState<VisualEvidence[]>([])
  const [prepared, setPrepared] = useState<PreparedVisual | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState("")
  const [error, setError] = useState("")
  const [corruptHash, setCorruptHash] = useState<string | null>(null)
  const [confirmRecovery, setConfirmRecovery] = useState(false)
  const [preview, setPreview] = useState<FrameSource | null>(null)
  const [verifiedFrame, setVerifiedFrame] = useState<MeetingFrame | null>(null)
  const [outcomes, setOutcomes] = useState<{ completed: string[]; failed: string[] }>({ completed: [], failed: [] })
  const [playing, setPlaying] = useState(false)
  const [revision, setRevision] = useState(0)
  const lifetime = useRef<AbortController | null>(null)
  const task = useRef<{ controller: AbortController; token?: string } | null>(null)
  const change = useRef(onChange)
  change.current = onChange
  const previewEl = useRef<HTMLDivElement>(null)
  const preparedToken = useRef<string | null>(null)
  function abandonPrepared() {
    const token = preparedToken.current
    preparedToken.current = null
    if (token) void visualRequest(meetingId, "cancel", "cancelled", { consent_token: token }).catch(() => {})
    setPrepared(null)
  }
  function cancel() {
    const current = task.current
    task.current = null
    current?.controller.abort()
    if (current?.token) void visualRequest(meetingId, "cancel", "cancelled", { consent_token: current.token }).catch(() => {})
  }
  useEffect(() => {
    const controller = new AbortController()
    lifetime.current = controller
    setPrepared(null); setBusy(false); setError(""); setProgress(""); setCorruptHash(null); setConfirmRecovery(false)
    void Promise.all([listMeetingFrames(meetingId), recordingStore.list()]).then(([local, recordings]) => {
      if (controller.signal.aborted) return
      setFrames(local); setRows(recordings.filter(row => row.meetingId === meetingId))
      setSelected(representativeFrameIds(local))
    }).catch(() => { if (!controller.signal.aborted) setError("本地画面库无法读取。") })
    if (connected) void visualRequest<VisualList>(meetingId, "list", "listed", {}, controller.signal).then(reply => {
      if (!controller.signal.aborted) setEvidence(reply.evidence)
    }).catch(e => {
      if (controller.signal.aborted) return
      setError(e.message)
      if (e instanceof VisualRequestError && e.code === "visual_evidence_corrupt" && e.corruptHash) setCorruptHash(e.corruptHash)
    })
    const hide = () => { cancel(); setBusy(false); abandonPrepared() }
    window.addEventListener("pagehide", hide)
    return () => {
      window.removeEventListener("pagehide", hide)
      controller.abort(); cancel(); abandonPrepared()
    }
  }, [meetingId, connected, revision])

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return
    const channel = new BroadcastChannel(RECORDING_REMOVALS)
    channel.onmessage = event => {
      if (!rows.some(row => row.id === event.data)) return
      cancel(); abandonPrepared()
      setVerifiedFrame(null); setPlaying(false)
      setFrames(old => old.filter(f => f.recordingId !== event.data))
      setRevision(v => v + 1)
    }
    return () => channel.close()
  }, [meetingId, rows])

  useEffect(() => {
    if (!focus) return
    setPreview(focus.source); setPlaying(false)
    previewEl.current?.scrollIntoView({ block: "center" })
  }, [focus])
  const chosen = frames.filter(frame => selected.includes(frame.frameId))
  useEffect(() => {
    let active = true
    setVerifiedFrame(null)
    if (preview) void readMeetingFrame(meetingId, preview).then(f => {
      if (active) setVerifiedFrame(f ?? null)
    }).catch(() => { if (active) setError("本地原帧无法读取。") })
    return () => { active = false }
  }, [preview, revision, meetingId])
  const frame = preview && verifiedFrame && sameFrame(preview, verifiedFrame) ? verifiedFrame : null
  const row = frame && rows.find(item => item.id === frame.recordingId)
  const stored = preview && evidence.find(item => sameFrame(preview, item))
  function show(source: FrameSource) { setPreview(source); setPlaying(false) }
  function begin() {
    if (task.current) return null
    const work: { controller: AbortController; token?: string } = { controller: new AbortController() }
    task.current = work
    setError(""); setProgress(""); setBusy(true)
    return work
  }
  async function prepare() {
    const work = begin()
    if (!work) return
    try {
      const reply = await visualRequest<PreparedVisual>(meetingId, "prepare", "prepared", { frames: chosen.map(frameMetadata) }, work.controller.signal)
      if (task.current !== work) return
      if (!reply.consent_token || !reply.endpoint || !reply.model || reply.frames?.length !== chosen.length ||
        !chosen.every((f, i) => sameFrame(f, reply.frames[i]) && typeof reply.frames[i].nearbyTranscript === "string")) throw new Error("模型或画面清单未核对成功。")
      preparedToken.current = reply.consent_token
      setPrepared(reply)
    } catch (e) { if (!work.controller.signal.aborted) setError((e as Error).message) }
    finally { if (task.current === work) { task.current = null; setBusy(false) } }
  }
  async function execute() {
    if (!prepared) return
    const work = begin()
    if (!work) return
    work.token = prepared.consent_token
    preparedToken.current = null
    setOutcomes({ completed: [], failed: [] })
    const before = JSON.stringify(evidence)
    setPrepared(null)
    let polling = false
    const poll = setInterval(async () => {
      if (polling) return
      polling = true
      try {
        const result = await visualRequest<VisualList>(meetingId, "list", "listed", {}, work.controller.signal)
        if (work !== task.current || !result.progress || result.progress.consent_token !== work.token) return
        const { completed, failed, total } = result.progress
        setOutcomes({ completed, failed })
        setProgress(`已识别 ${completed.length} 张，失败 ${failed.length} 张，剩余 ${total - completed.length - failed.length} 张。`)
        setEvidence(result.evidence)
      } catch { /* execute and final list deliver the terminal result */ }
      finally { polling = false }
    }, 1000)
    try {
      const payload = await Promise.all(prepared.frames.map(async source => {
        const current = await readMeetingFrame(meetingId, source)
        if (!current) throw new Error("所选画面已删除或改变，请刷新后重新选择。")
        return encodeMeetingFrame(current)
      }))
      if (task.current !== work) return
      const result = await visualRequest<{ completed: string[]; failed: string[]; cancelled: boolean }>(
        meetingId, "execute", "finished", { consent_token: work.token, frames: payload }, work.controller.signal)
      if (task.current !== work) return
      setOutcomes({ completed: result.completed, failed: result.failed })
      setProgress(`${result.cancelled ? "已停止" : "处理结束"}。已识别 ${result.completed.length} 张，失败 ${result.failed.length} 张。`)
    } catch (e) {
      if (!work.controller.signal.aborted) {
        setError((e as Error).message)
        void visualRequest(meetingId, "cancel", "cancelled", { consent_token: work.token }).catch(() => {})
      }
    } finally {
      clearInterval(poll)
      if (task.current === work) {
        task.current = null; setBusy(false)
        const signal = lifetime.current?.signal
        if (!signal?.aborted) try {
          const result = await visualRequest<VisualList>(meetingId, "list", "listed", {}, signal)
          if (!signal?.aborted) { setEvidence(result.evidence); if (before !== JSON.stringify(result.evidence)) change.current() }
        } catch { if (!signal?.aborted) setError("结果未核对，请刷新画面。") }
      }
    }
  }
  async function stop() {
    const work = task.current
    if (!work) return
    if (!work.token) { cancel(); setBusy(false); return }
    // Leave the execute receipt alive to reconcile partial successes.
    try {
      await visualRequest(meetingId, "cancel", "cancelled", { consent_token: work.token }, work.controller.signal)
      if (task.current === work) setProgress("正在停止，已完成的画面将保留。")
    } catch (e) { if (task.current === work) setError((e as Error).message) }
  }
  async function remove(frameId: string) {
    const work = begin()
    if (!work) return
    try {
      await visualRequest(meetingId, "remove", "removed", { frameId }, work.controller.signal)
      if (task.current === work) { setEvidence(previous => previous.filter(item => item.frameId !== frameId)); change.current() }
    } catch (e) { if (!work.controller.signal.aborted) setError((e as Error).message) }
    finally { if (task.current === work) { task.current = null; setBusy(false) } }
  }
  async function recover() {
    if (!confirmRecovery || !corruptHash) return
    const work = begin()
    if (!work) return
    try {
      await visualRequest(meetingId, "recover", "recovered", { acknowledge: true, corrupt_sha256: corruptHash }, work.controller.signal)
      if (task.current === work) { change.current(); setRevision(v => v + 1) }
    } catch (e) { if (!work.controller.signal.aborted) setError((e as Error).message) }
    finally { if (task.current === work) { task.current = null; setBusy(false) } }
  }
  if (!frames.length && !evidence.length && !error && !preview && !rows.some(r => r.frameStatus)) return null
  return <section aria-label="会议画面要点">
    <h3>会议画面要点</h3>
    {rows.filter(r => r.frameStatus).map(r => <p key={r.id}>{new Date(r.started).toLocaleString()} · 留存 {r.frameStatus!.saved} 张
      {r.frameStatus!.lastTimeMs != null && ` · 最后一张 ${time(r.frameStatus!.lastTimeMs!)}`}{r.frameStatus!.state === "limit" && " · 已达留存上限"}
      {r.frameStatus!.state === "unavailable" && " · 采样不可用"}
      {r.frameStatus!.skippedBusy > 0 && ` · 写入期间跳过 ${r.frameStatus!.skippedBusy} 次`}
      {r.frameStatus!.notReady > 0 && ` · 来源未就绪 ${r.frameStatus!.notReady} 次`}
      {r.frameStatus!.empty > 0 && ` · 空帧 ${r.frameStatus!.empty} 次`}
      {r.frameStatus!.encodeErrors > 0 && ` · 编码失败 ${r.frameStatus!.encodeErrors} 次`}
      {r.frameStatus!.writeErrors > 0 && ` · 存储失败 ${r.frameStatus!.writeErrors} 次`}
      {r.frameStatus!.oversized > 0 && ` · 超大图片 ${r.frameStatus!.oversized} 张`}</p>)}
    {frames.length > 0 && <>
      <p>已选 {chosen.length}／{frames.length} 张，每次最多 12 张。识别范围仅限选中的画面。</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(96px,1fr))", gap: 6, maxHeight: 320, overflowY: "auto" }}>
        {frames.map(f => <div key={f.frameId}>
          <button type="button" aria-label={`预览画面 ${time(f.timeMs)}`} onClick={() => show(f)}><FrameImage frame={f} /></button>
          <label><input type="checkbox" checked={selected.includes(f.frameId)} disabled={busy || (!selected.includes(f.frameId) && selected.length >= 12)}
            onChange={e => { abandonPrepared(); setSelected(e.target.checked ? [...selected, f.frameId] : selected.filter(id => id !== f.frameId)) }} />{time(f.timeMs)}</label>
          {outcomes.completed.includes(f.frameId) ? " · 已识别" : outcomes.failed.includes(f.frameId) ? " · 识别失败" : ""}
        </div>)}
      </div>
      <button type="button" disabled={!connected || busy || !chosen.length || !!prepared} onClick={prepare}>理解所选画面</button>
      <button type="button" onClick={openSettings}>会议画面模型设置</button>
    </>}
    {prepared && <section aria-label="确认画面接收方">
      <strong>{prepared.profileName} · {prepared.model}</strong><p style={{ overflowWrap: "anywhere" }}>{prepared.endpoint}</p>
      <p>将发送以下 {prepared.frames.length} 张截图和各自的相邻转写。</p>
      {prepared.frames.map(f => <details key={f.frameId}><summary>{time(f.timeMs)} · 预览发送材料</summary>
        <FrameImage frame={chosen.find(item => sameFrame(item, f))!} large /><p>{f.nearbyTranscript || "无相邻转写"}</p></details>)}
      <button type="button" onClick={execute}>确认发送并识别</button> <button type="button" onClick={abandonPrepared}>取消</button>
    </section>}
    {busy && <button type="button" onClick={stop}>停止本次处理</button>}
    {progress && <p role="status">{progress}</p>}
    {error && <p role="alert">{error} <button type="button" disabled={busy} onClick={() => setRevision(v => v + 1)}>刷新画面</button></p>}
    {corruptHash && (confirmRecovery ? <div>将保留损坏的识别结果文件，并重新建立本场画面证据列表。原始转写和本地截图仍可使用。
      <button type="button" disabled={busy} onClick={recover}>确认保留损坏文件并恢复</button>
      <button type="button" disabled={busy} onClick={() => setConfirmRecovery(false)}>取消</button></div> :
      <button type="button" disabled={busy} onClick={() => setConfirmRecovery(true)}>恢复本场画面证据</button>)}
    {evidence.length > 0 && <><h4>已识别的画面证据</h4>{evidence.map(e => <div key={e.frameId}>
      <button type="button" onClick={() => show(e)}>{time(e.timeMs)} · {e.description || e.recognizedText}</button>
      <button type="button" disabled={busy || !connected} onClick={() => remove(e.frameId)}>移除这条证据</button>
    </div>)}</>}
    <div ref={previewEl}>{preview && <>
      <h4>画面 {time(preview.timeMs)}</h4>
      {frame ? <FrameImage frame={frame} large /> : <p>在本机未找到与引用匹配的原帧。</p>}
      {stored && <><p>识别模型 · {stored.model}</p><p>{stored.recognizedText}</p><p>{stored.description}</p>
        {stored.uncertainties.length > 0 && <p>待核对 · {stored.uncertainties.join("；")}</p>}</>}
      {row && (playing ? <FramePlayer key={row.id + preview.timeMs} row={row} timeMs={preview.timeMs} /> :
        <button type="button" onClick={() => setPlaying(true)}>在本地录屏中定位</button>)}
      <button type="button" onClick={() => setPreview(null)}>关闭预览</button>
    </>}</div>
  </section>
}

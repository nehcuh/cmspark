import { useEffect, useState } from "react"
import { createMeetingRuntimeChannel } from "../voice/meeting-runtime-channel"

type Recent = { id: string; title: string; started_at: string }
export function RecentWorkbenchMeetings({ connected, recording, onSelect }: {
  connected: boolean; recording: boolean; onSelect: (meetingId: string) => void
}) {
  const [rows, setRows] = useState<Recent[]>([])
  const [message, setMessage] = useState("")
  const [revision, refresh] = useState(0)
  useEffect(() => {
    if (!connected) return
    let current = true
    const channel = createMeetingRuntimeChannel(() => {}, () => {})
    setMessage("正在读取…")
    void channel.request({ type: "meeting.list" }).then(reply => {
      if (!current) return
      if (reply.type !== "meeting.list_result" || !Array.isArray(reply.meetings)) throw new Error()
      setRows(reply.meetings.slice(0, 10))
      setMessage(reply.meetings.length ? "" : "暂无会议记录")
    }).catch(() => { if (current) setMessage("读取失败，请重试。") })
    return () => { current = false; channel.destroy() }
  }, [connected, revision])
  return <section className="cm-workbench-recent" aria-label="最近会议">
    <div className="cm-personal-section-title"><h2>最近会议</h2><button className="cm-p-link" disabled={!connected} onClick={() => refresh(v => v + 1)}>刷新</button></div>
    <div role="status">{connected ? message : "连接 Companion 后查看最近会议"}</div>
    {connected && !message && rows.map(row => <button className="cm-p-link" key={row.id} disabled={recording} onClick={() => onSelect(row.id)}>{row.title} · {new Date(row.started_at).toLocaleString()}</button>)}
  </section>
}

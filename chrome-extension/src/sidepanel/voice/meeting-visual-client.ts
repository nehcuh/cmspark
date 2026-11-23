import type { MeetingFrame } from "./workbench-recording-store"

export type FrameSource = Pick<MeetingFrame, "frameId" | "recordingId" | "timeMs" | "sha256">
export type VisualEvidence = FrameSource & {
  meetingId: string; recognizedText: string; description: string; uncertainties: string[]; model: string
}
export type PreparedVisual = {
  consent_token: string; model: string; endpoint: string; profileName: string
  frames: (FrameSource & { nearbyTranscript: string })[]
}
export type VisualList = {
  evidence: VisualEvidence[]
  progress: { consent_token: string; completed: string[]; failed: string[]; total: number } | null
}

export class VisualRequestError extends Error {
  constructor(message: string, readonly code?: string, readonly corruptHash?: string) { super(message) }
}

export function representativeFrameIds(frames: MeetingFrame[]): string[] {
  const count = Math.min(12, frames.length)
  return Array.from({ length: count }, (_, i) => frames[Math.round(i * (frames.length - 1) / Math.max(1, count - 1))].frameId)
}

export function sameFrame(a: FrameSource, b: FrameSource): boolean {
  return a.frameId === b.frameId && a.recordingId === b.recordingId && a.timeMs === b.timeMs && a.sha256 === b.sha256
}

export function frameMetadata(frame: MeetingFrame) {
  const { frameId, recordingId, meetingId, timeMs, sha256, width, height, mime, blob } = frame
  return { frameId, recordingId, meetingId, timeMs, sha256, width, height, mime, byteLength: blob.size }
}

export async function encodeMeetingFrame(frame: MeetingFrame) {
  const bytes = new Uint8Array(await frame.blob.arrayBuffer())
  let text = ""
  for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return { frameId: frame.frameId, base64: btoa(text) }
}

export function visualRequest<T>(meetingId: string, action: string, reply: string, fields: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const id = "meeting-rpc-visual-" + crypto.randomUUID()
  return new Promise((resolve, reject) => {
    let port: chrome.runtime.Port | undefined
    let settled = false
    const finish = (error?: string | Error, value?: T) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      chrome.runtime.onMessage.removeListener(listener)
      if (port) {
        port.onMessage.removeListener(listener)
        port.onDisconnect.removeListener(disconnected)
        port.disconnect()
      }
      signal?.removeEventListener("abort", abort)
      if (error) reject(typeof error === "string" ? new Error(error) : error)
      else resolve(value!)
    }
    const abort = () => finish("已停止等待本次画面处理。")
    const disconnected = () => finish("画面任务的连接已断开。")
    const listener = (msg: any) => {
      if (msg?.id !== id) return
      if (msg.type === "meeting.visual." + reply && msg.meeting_id === meetingId) finish(undefined, msg)
      else if (msg.type === "meeting.error" || msg.type === "error") finish(new VisualRequestError(
        msg.message || "处理失败，请检查会议和模型设置。", msg.code,
        msg.meeting_id === meetingId && typeof msg.corrupt_sha256 === "string" && /^[0-9a-f]{64}$/.test(msg.corrupt_sha256) ? msg.corrupt_sha256 : undefined,
      ))
    }
    const timer = setTimeout(() => finish("未收到画面处理回执，请刷新结果。"), action === "execute" ? 160_000 : 10_000)
    if (signal?.aborted) { abort(); return }
    signal?.addEventListener("abort", abort, { once: true })
    try {
      const message = { ...fields, type: "meeting.visual." + action, id, meeting_id: meetingId, v: 1 }
      if (action === "execute") {
        port = chrome.runtime.connect({ name: "cmspark-meeting-visual" })
        port.onDisconnect.addListener(disconnected)
        port.onMessage.addListener(listener)
        port.postMessage(message)
        return
      }
      chrome.runtime.onMessage.addListener(listener)
      void chrome.runtime.sendMessage(message).then(ack => {
        if (ack?.ok === false || ack?.sent === false) finish("未能发送，请检查 Companion 连接。")
      }, () => finish("Companion 连接已中断。"))
    } catch { finish("Companion 连接不可用。") }
  })
}

import { claimWorkbenchCapture } from "./workbench-capture-owner"
import { recordingStore, type ScreenRecording } from "./workbench-recording-store"

export type ScreenPhase = "choosing" | "recording" | "finishing"

export class ScreenCaptureBusy extends Error {}

function checkPending(signal: AbortSignal): void {
  if (signal.aborted) throw new Error("已取消录屏")
}

function storageError(error: unknown): string {
  return error instanceof DOMException && error.name === "QuotaExceededError"
    ? "本机存储空间不足" : "本机录屏分块写入失败"
}

/** Resolves only after the final dataavailable event and its IndexedDB transaction. */
export async function recordWorkbenchScreen(
  includeAudio: boolean, signal: AbortSignal, report: (phase: ScreenPhase, message: string) => void,
): Promise<ScreenRecording> {
  const release = await claimWorkbenchCapture("screen")
  if (!release) throw new ScreenCaptureBusy("另一个工作台正在采集")
  let stream: MediaStream | undefined
  try {
    checkPending(signal)
    if (!globalThis.MediaRecorder?.isTypeSupported("video/webm") || !navigator.mediaDevices?.getDisplayMedia) {
      throw new Error("当前浏览器无法录制 WebM 屏幕视频")
    }
    report("choosing", "请在浏览器中选择共享来源")
    stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: includeAudio })
    checkPending(signal)
    const video = stream.getVideoTracks()[0]
    if (!video) throw new Error("共享来源没有视频轨道")
    const audioTracks = stream.getAudioTracks()
    if (!includeAudio) audioTracks.forEach(track => track.stop())
    const tracks = [video, ...(includeAudio ? audioTracks : [])]
    const label = includeAudio
      ? audioTracks.length ? "正在录制屏幕和共享来源声音" : "正在录制屏幕，所选来源未提供声音"
      : "正在录制屏幕，无声音"
    return await recordScreenTracks(tracks, signal, report, label)
  } finally {
    stream?.getTracks().forEach(track => track.stop())
    release()
  }
}

/** Capture already selected and owned tracks, flushing the last local write before resolving. */
export async function recordScreenTracks(
  tracks: MediaStreamTrack[], signal: AbortSignal, report: (phase: ScreenPhase, message: string) => void,
  label: string, meetingId?: string,
): Promise<ScreenRecording> {
  checkPending(signal)
  const recorder = new MediaRecorder(new MediaStream(tracks), { mimeType: "video/webm" })
  let row: ScreenRecording = {
    id: crypto.randomUUID(), ...(meetingId && { meetingId }), started: Date.now(), mime: recorder.mimeType, chunks: 0,
    bytes: 0, elapsedMs: 0, state: "open", detail: "",
  }
  try { await recordingStore.save(row) }
  catch (error) { throw new Error(storageError(error)) }
  if (signal.aborted || tracks.some(track => track.readyState === "ended")) {
    await recordingStore.remove(row.id)
    checkPending(signal)
    throw new Error("共享来源已断开")
  }

  let writes = Promise.resolve()
  let pendingBytes = 0
  let detail = ""
  let partial = false
  let discard = false
  let writeFailed = false
  const started = performance.now()
  const stop = (message: string, interrupted: boolean) => {
    if (interrupted || !detail) detail = message
    partial ||= interrupted
    if (recorder.state !== "inactive") recorder.stop()
    tracks.forEach(track => track.stop())
    report("finishing", detail)
  }
  const abort = () => {
    const interruption = meetingId && typeof signal.reason === "string" ? signal.reason : "录屏已中断"
    stop(signal.reason === "stop" ? "已停止录屏" : interruption, signal.reason !== "stop")
  }
  const stopped = new Promise<void>(resolve => {
    recorder.onstop = () => {
      if (meetingId && !detail) stop("桌面录屏意外结束", true)
      resolve()
    }
  })
  recorder.onerror = () => stop("浏览器录制失败", true)
  recorder.ondataavailable = ({ data }) => {
    if (!data.size || discard) return
    const elapsed = Math.round(performance.now() - started)
    pendingBytes += data.size
    if (pendingBytes > 32 * 1024 * 1024) {
      discard = true
      stop("本机写入过慢，已保留开头连续分块", true)
      return
    }
    writes = writes.then(async () => {
      try {
        if (!writeFailed) row = await recordingStore.append(row, data, elapsed)
      } catch (error) {
        discard = writeFailed = true
        stop(storageError(error), true)
      } finally {
        pendingBytes -= data.size
      }
    })
  }
  const sourceEnded = () => { if (!signal.aborted) stop("共享来源已停止", Boolean(meetingId)) }
  tracks.forEach(track => track.addEventListener("ended", sourceEnded))
  signal.addEventListener("abort", abort, { once: true })
  try {
    try { recorder.start(1000) }
    catch (error) { await recordingStore.remove(row.id); throw error }
    report("recording", label)
    await stopped
    await writes
    if (!row.bytes) {
      partial = true
      detail = detail ? `${detail}，没有写入视频分块` : "没有写入视频分块"
    }
    row = { ...row, state: partial ? "partial" : "complete", detail: detail || "浏览器已结束录屏" }
    try {
      await recordingStore.save(row)
    } catch (error) {
      throw new Error(`${storageError(error)}，已保存 ${row.chunks} 个分块`)
    }
    if (meetingId && typeof window !== "undefined") window.dispatchEvent(new Event("cmspark:screen-recording-saved"))
    return row
  } finally {
    signal.removeEventListener("abort", abort)
    tracks.forEach(track => track.removeEventListener("ended", sourceEnded))
  }
}

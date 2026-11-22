import { openDesktopMeetingMedia, type DesktopMeetingMedia } from "./desktop-meeting-media"

/** The picker must be opened by a fresh click after the asynchronous Companion checks. */
export function chooseDesktopMeetingInput(signal: AbortSignal, includeMicrophone: boolean, offer: (choose: () => void) => void) {
  return new Promise<DesktopMeetingMedia>((resolve, reject) => {
    const cancel = () => reject(new Error("capture_cancelled"))
    if (signal.aborted) { cancel(); return }
    signal.addEventListener("abort", cancel, { once: true })
    let chosen = false
    offer(() => {
      if (chosen || signal.aborted) return
      chosen = true
      openDesktopMeetingMedia(signal, includeMicrophone).then(resolve, reject).finally(() => signal.removeEventListener("abort", cancel))
    })
  })
}

export function createDesktopMeetingInput(
  meetingId: string,
  select: (signal: AbortSignal) => Promise<DesktopMeetingMedia>,
  report: (message: string) => void,
  onInterrupted: () => void,
) {
  const chooser = new AbortController()
  let media: DesktopMeetingMedia | undefined
  let writing: Promise<void> | undefined
  let closing = false
  let failed = false
  const interrupted = () => {
    if (closing || failed) return
    failed = true
    onInterrupted()
  }
  function close(reason: "stop" | "interrupted") {
    if (!closing) {
      closing = true
      media?.close(reason)
      chooser.abort()
    }
    return writing
  }
  return {
    async select() {
      media = await select(chooser.signal)
      if (closing || media.signal.aborted) {
        media.close("interrupted")
        throw new Error(closing ? "capture_cancelled" : "desktop_source_lost")
      }
      media.signal.addEventListener("abort", interrupted, { once: true })
    },
    async acquireAudio() {
      const selected = media
      if (!selected || closing || selected.signal.aborted) throw new Error("desktop_source_lost")
      await new Promise<void>((resolve, reject) => {
        writing = selected.startRecording(meetingId, resolve).then(row => {
          if (row.state === "complete" && row.bytes > 0) report("会议视频已保存，可在工作台的「录屏」中预览或导出。")
          else {
            report(`会议视频未完整保存：${row.detail}。已写入的分块可在「录屏」中查看。`)
            interrupted()
            failed = true
          }
          reject(new Error("desktop_recording_ended"))
        }, error => {
          report(error instanceof Error ? error.message : "会议视频写入失败")
          reject(error)
          interrupted()
          failed = true
        })
      })
      if (closing || selected.signal.aborted) throw new Error("desktop_source_lost")
      return selected.audio
    },
    close,
    get failed() { return failed },
  }
}

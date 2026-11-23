import { claimWorkbenchCapture } from "./workbench-capture-owner"
import type { ScreenRecording } from "./workbench-recording-store"
import { recordScreenTracks } from "./workbench-screen-capture"
import type { RecordingFrameOptions } from "./meeting-frame-sampler"

export interface DesktopMeetingMedia {
  /** Same mixed signal as the recorder, with an independently stoppable track for ASR. */
  audio: MediaStream
  /** Ends immediately on source loss or cancellation, before final IndexedDB writes. */
  signal: AbortSignal
  startRecording(meetingId: string, onStarted: () => void, frames?: RecordingFrameOptions, captureId?: string): Promise<ScreenRecording>
  close(reason?: "stop" | "interrupted"): void
}

function untilClosed<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const cancel = () => reject(new Error("桌面会议采集已结束"))
    signal.addEventListener("abort", cancel, { once: true })
    if (signal.aborted) cancel()
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", cancel))
  })
}

/** Call directly from the user's source-selection gesture after meeting admission. */
export async function openDesktopMeetingMedia(owner: AbortSignal, includeMicrophone = true): Promise<DesktopMeetingMedia> {
  if (owner.aborted) throw new Error("桌面会议采集已取消")
  const devices = navigator.mediaDevices
  if (!devices?.getDisplayMedia || (includeMicrophone && !devices.getUserMedia) || !globalThis.AudioContext ||
      !globalThis.MediaRecorder?.isTypeSupported("video/webm")) {
    throw new Error("此环境无法录制带声音的桌面会议")
  }

  const lifetime = new AbortController()
  const signal = lifetime.signal
  const tracks = new Set<MediaStreamTrack>()
  let context: AudioContext | undefined
  let unlock: (() => void) | undefined
  let writing = false
  const cancel = () => end(owner.reason === "stop" ? "stop" : "桌面会议采集已中断")
  const sourceEnded = () => end("共享来源或麦克风已断开")
  const sourceMuted = () => end("共享来源或麦克风已暂停")
  function end(reason: string) {
    if (signal.aborted) return
    lifetime.abort(reason)
    owner.removeEventListener("abort", cancel)
    for (const track of tracks) {
      track.removeEventListener("ended", sourceEnded)
      track.removeEventListener("mute", sourceMuted)
      track.stop()
    }
    if (context) {
      context.onstatechange = null
      void context.close().catch(() => {})
    }
    if (!writing) unlock?.()
  }
  owner.addEventListener("abort", cancel, { once: true })

  function take(stream: MediaStream) {
    for (const track of stream.getTracks()) {
      if (signal.aborted) track.stop()
      else tracks.add(track)
    }
    return stream
  }
  function monitor(track: MediaStreamTrack) {
    if (track.readyState !== "live") throw new Error("所选音视频来源已断开")
    track.addEventListener("ended", sourceEnded)
    track.addEventListener("mute", sourceMuted)
  }
  try {
    // The browser requires transient activation for the picker. Do not put an
    // asynchronous lock, permission request or server roundtrip before it.
    const selection = {
      video: { displaySurface: "window" }, audio: true, selfBrowserSurface: "exclude",
      systemAudio: "include", windowAudio: "window", surfaceSwitching: "exclude",
    }
    const displayRequest = devices.getDisplayMedia(selection).then(take)
    const lease = claimWorkbenchCapture("screen").then(release => {
      if (!release) throw new Error("另一个工作台正在录屏")
      if (signal.aborted) release()
      else unlock = release
    })
    const [display] = await untilClosed(Promise.all([displayRequest, lease]), signal)
    if (signal.aborted) throw new Error("桌面会议采集已结束")
    const [video] = display.getVideoTracks()
    const surface = video?.getSettings().displaySurface
    if (surface !== "window" && surface !== "monitor") throw new Error("请选择桌面会议窗口或整个屏幕")
    const [shared] = display.getAudioTracks()
    if (!shared) throw new Error("没有共享声音。请重新选择窗口并勾选声音，或选择整个屏幕并共享系统音频")
    monitor(video)
    monitor(shared)

    const inputs = [shared]
    if (includeMicrophone) {
      const mic = await untilClosed(devices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      }).then(take), signal)
      if (signal.aborted) throw new Error("桌面会议采集已结束")
      const [microphone] = mic.getAudioTracks()
      if (!microphone) throw new Error("未取得麦克风音轨")
      monitor(microphone)
      inputs.push(microphone)
    }
    context = new AudioContext()
    if (context.state !== "running") await untilClosed(context.resume(), signal)
    if (signal.aborted) throw new Error("桌面会议采集已结束")
    const mixed = context.createMediaStreamDestination()
    const mixGain = context.createGain()
    mixGain.gain.value = 1 / inputs.length
    mixGain.connect(mixed)
    for (const input of inputs) {
      context.createMediaStreamSource(new MediaStream([input])).connect(mixGain)
    }
    // Never connect to context.destination: that would play the meeting back into the call.
    const [movieAudio] = take(mixed.stream).getAudioTracks()
    const audio = take(new MediaStream([movieAudio.clone()]))
    context.onstatechange = () => {
      if (context?.state !== "running") end("桌面会议混音已暂停")
    }

    return {
      audio, signal,
      close(reason = "stop") { end(reason === "stop" ? "stop" : "桌面会议采集已中断") },
      async startRecording(meetingId, onStarted, frames, captureId) {
        if (writing || signal.aborted) throw new Error("本次桌面录屏无法再次开始")
        writing = true
        try {
          return await recordScreenTracks([video, movieAudio], signal, (phase, message) => {
            if (phase === "recording") onStarted()
            if (phase === "finishing" && !signal.aborted) end(message)
          }, "正在录制桌面会议", meetingId, frames, captureId)
        } finally {
          end("桌面录屏已结束")
          writing = false
          unlock?.()
        }
      },
    }
  } catch (error) {
    const interrupted = signal.aborted
    end("桌面会议采集已中断")
    if (interrupted && signal.reason !== "stop") throw new Error(String(signal.reason))
    if (error instanceof DOMException && error.name === "NotAllowedError") {
      throw new Error("未获共享画面、声音或麦克风权限，桌面会议录制未开始")
    }
    throw error
  }
}

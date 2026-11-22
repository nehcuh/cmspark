// Headless browser fixture. The only input devices are a canvas and two oscillators.
import { openDesktopMeetingMedia } from "../../src/sidepanel/voice/desktop-meeting-media"
import { createDesktopMeetingInput } from "../../src/sidepanel/voice/meeting-desktop-input"
import { createMeetingContinuousCapture } from "../../src/sidepanel/voice/meeting-continuous-capture"
import { recordingStore } from "../../src/sidepanel/voice/workbench-recording-store"

const tones = [500, 1300, 2100] as const

function spectrum(samples: Float32Array, rate: number) {
  const count = Math.floor(rate / 4)
  const start = Math.floor((samples.length - count) / 2)
  if (start < 0) throw new Error("Insufficient decoded audio")
  return tones.map(hz => {
    let real = 0, imaginary = 0
    for (let i = 0; i < count; i++) {
      const angle = 2 * Math.PI * i * hz / rate
      real += samples[start + i] * Math.cos(angle)
      imaginary += samples[start + i] * Math.sin(angle)
    }
    return 2 * Math.hypot(real, imaginary) / count
  })
}

function oscillator(context: AudioContext, frequency: number) {
  const oscillator = context.createOscillator()
  oscillator.frequency.value = frequency
  const gain = context.createGain()
  gain.gain.value = 0.4
  const output = context.createMediaStreamDestination()
  oscillator.connect(gain).connect(output)
  oscillator.start()
  return output.stream
}

async function frame(blob: Blob) {
  const video = document.createElement("video")
  video.muted = true
  const url = URL.createObjectURL(blob)
  try {
    video.src = url
    await video.play()
    await new Promise<void>(resolve => video.requestVideoFrameCallback(() => resolve()))
    const canvas = document.createElement("canvas")
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const pixels = canvas.getContext("2d")!
    pixels.drawImage(video, 0, 0)
    const rgb = (x: number) => [...pixels.getImageData(x, 45, 1, 1).data.slice(0, 3)]
    return { width: canvas.width, height: canvas.height, left: rgb(40), right: rgb(120) }
  } finally {
    video.pause()
    video.removeAttribute("src")
    video.load()
    URL.revokeObjectURL(url)
  }
}

async function run(includeMic: boolean) {
  const context = new AudioContext()
  const canvas = document.createElement("canvas")
  canvas.width = 160; canvas.height = 90
  const paint = canvas.getContext("2d")!
  function draw() {
    paint.fillStyle = "#ff0000"
    paint.fillRect(0, 0, 80, 90)
    paint.fillStyle = "#0000ff"
    paint.fillRect(80, 0, 80, 90)
  }
  draw()
  const animation = setInterval(draw, 40)
  const display = canvas.captureStream(25)
  const [video] = display.getVideoTracks()
  const settings = video.getSettings.bind(video)
  Object.defineProperty(video, "getSettings", { value: () => ({ ...settings(), displaySurface: "window" }) })
  display.addTrack(oscillator(context, tones[0]).getAudioTracks()[0])
  const mic = oscillator(context, tones[1])
  let micOpens = 0
  // Override both acquisition APIs *before* opening the production path. No real
  // screen or microphone request is made, even if the test fails partway.
  Object.defineProperties(navigator.mediaDevices, {
    getDisplayMedia: { configurable: true, value: async () => display },
    getUserMedia: { configurable: true, value: async () => { micOpens++; return mic } },
  })
  const meetingId = includeMic ? "fixture-both" : "fixture-shared-only"
  const failures: string[] = []
  const desktop = createDesktopMeetingInput(meetingId, signal => openDesktopMeetingMedia(signal, includeMic),
    () => {}, () => failures.push("interrupted"))
  const asrSamples: number[] = []
  let collected!: () => void
  const enough = new Promise<void>(resolve => { collected = resolve })
  const credit = (id: number) => ({ credit_id: id, max_frames: 640, sample_offset: (id - 1) * 640 })
  const capture = createMeetingContinuousCapture({
    meetingId, captureId: "fixture", epoch: 1, modelId: "fixture", acquireAudio: desktop.acquireAudio,
    onError: code => { failures.push(code); collected() },
    request: async message => {
      const ack = { meeting_id: meetingId, capture_id: "fixture", capture_epoch: 1, queue_contract: 1, input_open: true }
      if (message.type === "voice.stt.start") return { ...ack, type: "voice.stt.partial", status: "receiving",
        credits: Array.from({ length: 8 }, (_, i) => credit(i + 1)) }
      if (message.type === "voice.stt.chunk") {
        const bytes = Uint8Array.from(atob(message.data as string), char => char.charCodeAt(0))
        const pcm = new DataView(bytes.buffer)
        if (message.sample_offset !== asrSamples.length) throw new Error("Noncontiguous ASR input")
        for (let i = 0; i < bytes.length; i += 2) asrSamples.push(pcm.getInt16(i, true) / 32768)
        if (asrSamples.length >= 32000) collected()
        const id = Number(message.credit_id)
        return { ...ack, type: "meeting.capture.status", credit_id: id, accepted_through: asrSamples.length, credits: [credit(id + 8)] }
      }
      return { ...ack, type: "meeting.capture.status", phase: "finished", credits: [] }
    },
  })
  try {
    await context.resume()
    await desktop.select()
    await capture.start()
    await enough
    const saved = desktop.close("stop")
    await capture.stop()
    await saved
    if (failures.length || desktop.failed) throw new Error("Capture failed " + failures.join(","))
    const row = (await recordingStore.list()).find(row => row.meetingId === meetingId)
    if (row?.state !== "complete") throw new Error("Missing complete meeting recording")
    const blob = await recordingStore.read(row)
    const decoded = await context.decodeAudioData(await blob.arrayBuffer())
    return { micOpens, samples: asrSamples.length, bytes: row.bytes, chunks: row.chunks,
      pcm: spectrum(Float32Array.from(asrSamples), 16000), webm: spectrum(decoded.getChannelData(0), decoded.sampleRate),
      frame: await frame(blob) }
  } finally {
    capture.destroy()
    await desktop.close("interrupted")
    for (const stream of [display, mic]) stream.getTracks().forEach(track => track.stop())
    clearInterval(animation)
    await context.close()
  }
}

document.querySelector("button")!.onclick = () => {
  Object.assign(window, { result: run(location.hash === "#both") })
}

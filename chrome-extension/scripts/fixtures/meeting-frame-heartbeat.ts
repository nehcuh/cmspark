import { type FrameCaptureStatus } from "../../src/sidepanel/voice/meeting-frame-sampler"
import { listMeetingFrames } from "../../src/sidepanel/voice/workbench-recording-store"
import { recordScreenTracks } from "../../src/sidepanel/voice/workbench-screen-capture"

const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

// Real time, real canvas track, recorder, image encoder, digest and IndexedDB.
// No display picker or microphone is opened on the test machine.
export async function exerciseFrameHeartbeat() {
  const canvas = document.createElement("canvas")
  canvas.width = 960
  canvas.height = 540
  const context = canvas.getContext("2d")!
  let value = "7"
  function draw() {
    context.fillStyle = "white"
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.fillStyle = "#111"
    context.font = "26px monospace"
    context.fillText("Review    Forecast    Actual", 55, 100)
    context.fillText("Q3          1300       130" + value, 55, 180)
  }
  draw()
  const render = setInterval(draw, 100)
  const [track] = canvas.captureStream(10).getVideoTracks()
  const owner = new AbortController()
  let current: FrameCaptureStatus | undefined
  let mark!: () => void
  const recording = recordScreenTracks([track], owner.signal, () => {}, "fixture", "heartbeat", {
    report(status) { current = status }, bindMark(fn) { mark = fn },
  }, "heartbeat-recording")
  async function waitFor(count: number, duration: number) {
    const limit = performance.now() + duration
    while ((current?.saved ?? 0) < count && performance.now() < limit) await delay(50)
    if (current?.saved !== count) throw new Error("Missing sampled value: " + JSON.stringify(current))
  }
  try {
    await waitFor(1, 5000)
    value = "8"
    await waitFor(2, 65000)
    value = "7"
    await delay(300)
    mark()
    await delay(500)
    const frames = await listMeetingFrames("heartbeat")
    return { count: frames.length, duplicates: current?.duplicates, times: frames.map(f => f.timeMs),
      digests: frames.map(f => f.sha256), bytes: frames.map(f => f.blob.size) }
  } finally {
    owner.abort("stop")
    clearInterval(render)
    await recording
  }
}

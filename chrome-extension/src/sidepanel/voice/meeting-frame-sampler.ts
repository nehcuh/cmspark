import { FRAME_BYTES, saveMeetingFrame, type MeetingFrame } from "./workbench-recording-store"

export interface FrameCaptureStatus {
  state: "sampling" | "limit" | "unavailable" | "stopped"
  saved: number
  bytes: number
  lastTimeMs: number | null
  skippedBusy: number
  notReady: number
  empty: number
  encodeErrors: number
  writeErrors: number
  oversized: number
  duplicates: number
}

export type FrameReporter = (status: FrameCaptureStatus) => void
export interface RecordingFrameOptions {
  report: FrameReporter
  bindMark: (mark: () => void) => void
}

const probeWidth = 128, probeHeight = 72

// Count materially changed screen tiles. A moving pointer or corner thumbnail
// occupies few tiles; tiny spreadsheet edits are covered by explicit marks
// and the periodic full-resolution digest check.
function changed(a: Uint8ClampedArray, b: Uint8ClampedArray) {
  const hits = new Uint16Array(16 * 9)
  let tiles = 0
  let left = 16, right = 0, top = 9, bottom = 0
  for (let p = 0; p < probeWidth * probeHeight; p++) {
    const i = p * 4
    if (Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2])) < 24) continue
    const x = (p % probeWidth) >> 3, y = Math.floor(p / probeWidth) >> 3
    if (++hits[x + 16 * y] !== 4) continue
    tiles++
    left = Math.min(left, x); right = Math.max(right, x)
    top = Math.min(top, y); bottom = Math.max(bottom, y)
    if (tiles >= 12 && (right - left >= 5 || bottom - top >= 4)) return true
  }
  return false
}

export class FrameChangeDetector {
  private candidate?: Uint8ClampedArray
  private since = 0
  private last?: Uint8ClampedArray
  private checkedAt = -Infinity

  consider(pixels: Uint8ClampedArray, time: number) {
    if (!this.candidate || changed(this.candidate, pixels)) {
      this.candidate = pixels
      this.since = time
    }
    if (time - (this.last ? this.checkedAt : 0) >= 60000) return true
    return time - this.since >= 1000 && time - this.checkedAt >= 5000 && (!this.last || changed(this.last, pixels))
  }

  accept(pixels: Uint8ClampedArray, time: number) {
    this.last = pixels
    this.checkedAt = time
  }
}

export function startMeetingFrameSampler(
  track: MediaStreamTrack, meetingId: string, recordingId: string, started: number, report: FrameReporter,
) {
  const status: FrameCaptureStatus = { state: "sampling", saved: 0, bytes: 0, lastTimeMs: null,
    skippedBusy: 0, notReady: 0, empty: 0, encodeErrors: 0, writeErrors: 0, oversized: 0, duplicates: 0 }
  const detector = new FrameChangeDetector()
  let video: HTMLVideoElement | undefined
  let probe: CanvasRenderingContext2D | null = null, full: CanvasRenderingContext2D | null = null
  let timer: ReturnType<typeof setInterval> | undefined
  let pending: Promise<void> | undefined
  let write: ReturnType<typeof saveMeetingFrame> | undefined
  let lastReport: FrameCaptureStatus | undefined
  function notify() {
    if (lastReport && (Object.keys(status) as (keyof FrameCaptureStatus)[]).every(key => lastReport![key] === status[key])) return
    lastReport = { ...status }
    report(lastReport)
  }

  function end(state: FrameCaptureStatus["state"]) {
    if (status.state !== "sampling") return
    status.state = state
    clearInterval(timer)
    if (video) { video.pause(); video.srcObject = null }
    video = undefined
    for (const context of [probe, full]) if (context) context.canvas.width = context.canvas.height = 0
    probe = full = null
    notify()
  }
  async function sample(mark: boolean) {
    if (!video || !probe || !full || video.readyState < 2 || track.readyState !== "live" || !video.videoWidth || !video.videoHeight) {
      status.notReady++
      return
    }
    const timeMs = Math.max(0, Math.round(performance.now() - started))
    probe.drawImage(video, 0, 0, probeWidth, probeHeight)
    const pixels = probe.getImageData(0, 0, probeWidth, probeHeight).data
    if (!detector.consider(pixels, timeMs) && !mark) return
    const scale = Math.min(1, 1600 / Math.max(video.videoWidth, video.videoHeight))
    const width = full.canvas.width = Math.max(1, Math.round(video.videoWidth * scale))
    const height = full.canvas.height = Math.max(1, Math.round(video.videoHeight * scale))
    full.drawImage(video, 0, 0, width, height)
    const blob = await new Promise<Blob | null>(resolve => full!.canvas.toBlob(resolve, "image/jpeg", 0.82))
    if (status.state !== "sampling") return
    if (!blob) { status.encodeErrors++; return }
    if (!blob.size) { status.empty++; return }
    if (blob.size > FRAME_BYTES) { status.oversized++; end("limit"); return }
    const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer())
    if (status.state !== "sampling") return
    const sha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("")
    const frame: MeetingFrame = { frameId: crypto.randomUUID(), recordingId, meetingId, timeMs,
      width, height, mime: blob.type, sha256, blob }
    try {
      write = saveMeetingFrame(frame)
      const result = await write
      if (result === "closed") { end("unavailable"); return }
      if (result === "limit") { end("limit"); return }
      detector.accept(pixels, timeMs)
      if (result === "duplicate") status.duplicates++
      else {
        status.saved++
        status.bytes += blob.size
        status.lastTimeMs = timeMs
      }
      if (result === "saved-last") end("limit")
    } catch {
      status.writeErrors++
      end("unavailable")
    } finally { write = undefined }
  }
  function tick(mark = false) {
    if (status.state !== "sampling") return
    if (pending) { status.skippedBusy++; notify(); return }
    pending = sample(mark).catch(() => { if (status.state === "sampling") status.encodeErrors++ })
      .finally(() => { pending = undefined; if (status.state === "sampling") notify() })
  }

  try {
    video = document.createElement("video")
    video.muted = true
    video.playsInline = true
    video.srcObject = new MediaStream([track])
    probe = document.createElement("canvas").getContext("2d", { willReadFrequently: true })
    full = document.createElement("canvas").getContext("2d")
    if (!probe || !full) throw new Error("canvas")
    probe.canvas.width = probeWidth
    probe.canvas.height = probeHeight
    void video.play().catch(() => end("unavailable"))
    timer = setInterval(tick, 500)
    notify()
  } catch { end("unavailable") }

  return {
    mark: () => tick(true),
    stop: () => end("stopped"),
    async finish() { end("stopped"); if (write) await pending; notify(); return { ...status } },
  }
}

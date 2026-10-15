import { MeetingPcmEncoder } from "./meeting-continuous-pcm"
declare const sampleRate: number
declare const currentFrame: number
declare class AudioWorkletProcessor { readonly port: MessagePort }
declare function registerProcessor(name: string, processor: typeof AudioWorkletProcessor): void

class MeetingPcmProcessor extends AudioWorkletProcessor {
  private initialized = false
  private nextFrame: number | null = null
  private readonly encoder: MeetingPcmEncoder
  constructor() {
    super()
    this.encoder = new MeetingPcmEncoder(
      block => this.port.postMessage({ type: "block", ...block }, [block.pcm.buffer as ArrayBuffer]),
      (end, reason) => this.port.postMessage({ type: "sealed", end, reason }),
    )
    this.port.onmessage = event => {
      const m = event.data
      try {
        if (m?.type === "init" || m?.type === "credits") {
          this.encoder.grant(m.credits)
          if (m.type === "init") { this.initialized = true; this.port.postMessage({ type: "ready" }) }
        } else if (m?.type === "seal") this.encoder.seal(m.reason)
      } catch { this.encoder.seal("input_gap") }
    }
  }
  process(inputs: Float32Array[][]): boolean {
    if (!this.initialized) return true
    if (this.encoder.closed) return false
    const input = inputs[0]?.[0]
    if (input?.length) {
      if (this.nextFrame !== null && currentFrame !== this.nextFrame) this.encoder.seal("input_gap")
      else this.encoder.push(input, sampleRate)
      this.nextFrame = currentFrame + input.length
    }
    return !this.encoder.closed
  }
}
registerProcessor("cmspark-meeting-pcm-q1", MeetingPcmProcessor)

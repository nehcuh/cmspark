/**
 * M2 — continuous 16 kHz mono PCM capture via AudioContext.
 * Prefers AudioWorklet; falls back to ScriptProcessor (N5 residual).
 * Streams s16le chunks for voice.stt.chunk while recording.
 */

import {
  LOCAL_STT_MAX_RECORD_MS,
  LOCAL_STT_SAMPLE_RATE,
} from "./local-stt-detect"
import { float32ToS16lePcm, resampleFloat32Mono } from "./pcm-encode"

export type PcmStreamCaptureOpts = {
  maxMs?: number
  /** Fired with non-empty 16 kHz mono s16le chunks. */
  onPcmChunk: (pcm: Uint8Array) => void
  onLevel?: (level: number) => void
}

export type PcmStreamHandle = {
  stop: () => Promise<void>
  abort: () => void
  /** Which capture path was used (tests / diagnostics). */
  backend: "audioworklet" | "scriptprocessor"
}

function stopTracks(stream: MediaStream | null): void {
  if (!stream) return
  for (const t of stream.getTracks()) {
    try {
      t.stop()
    } catch {
      /* */
    }
  }
}

/** Inline worklet: post float32 mono frames to main thread. */
const PCM_WORKLET_SOURCE = `
class CmsparkPcmCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const ch0 = inputs[0] && inputs[0][0]
    if (ch0 && ch0.length > 0) {
      // Copy so the underlying buffer is not reused before main-thread handle
      const copy = new Float32Array(ch0.length)
      copy.set(ch0)
      this.port.postMessage(copy, [copy.buffer])
    }
    return true
  }
}
registerProcessor('cmspark-pcm-capture', CmsparkPcmCaptureProcessor)
`

function processFloatChunk(
  input: Float32Array,
  sampleRate: number,
  onPcmChunk: (pcm: Uint8Array) => void,
  onLevel?: (level: number) => void,
): void {
  if (!input || input.length === 0) return
  const mono =
    sampleRate === LOCAL_STT_SAMPLE_RATE
      ? input
      : resampleFloat32Mono(input, sampleRate, LOCAL_STT_SAMPLE_RATE)
  if (mono.length === 0) return
  const pcm = float32ToS16lePcm(mono)
  if (pcm.length > 0) onPcmChunk(pcm)
  if (onLevel) {
    let sum = 0
    for (let i = 0; i < input.length; i++) sum += input[i]! * input[i]!
    const rms = Math.sqrt(sum / input.length)
    onLevel(Math.min(1, rms * 4))
  }
}

type GraphTeardown = () => void

async function tryConnectWorklet(
  ctx: AudioContext,
  source: MediaStreamAudioSourceNode,
  onFloat: (samples: Float32Array) => void,
): Promise<{ teardown: GraphTeardown } | null> {
  if (typeof (ctx as any).audioWorklet?.addModule !== "function") return null
  if (typeof (globalThis as any).AudioWorkletNode === "undefined") return null

  let url: string | null = null
  try {
    const blob = new Blob([PCM_WORKLET_SOURCE], { type: "application/javascript" })
    url = URL.createObjectURL(blob)
    await ctx.audioWorklet.addModule(url)
    const node = new AudioWorkletNode(ctx, "cmspark-pcm-capture", {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 1,
    })
    node.port.onmessage = (ev: MessageEvent) => {
      const data = ev.data
      if (data instanceof Float32Array) onFloat(data)
    }
    const mute = ctx.createGain()
    mute.gain.value = 0
    source.connect(node)
    node.connect(mute)
    mute.connect(ctx.destination)
    const workletUrl = url
    url = null // ownership transferred to teardown
    return {
      teardown: () => {
        try {
          node.port.onmessage = null
          node.disconnect()
        } catch {
          /* */
        }
        try {
          mute.disconnect()
        } catch {
          /* */
        }
        if (workletUrl) {
          try {
            URL.revokeObjectURL(workletUrl)
          } catch {
            /* */
          }
        }
      },
    }
  } catch {
    if (url) {
      try {
        URL.revokeObjectURL(url)
      } catch {
        /* */
      }
    }
    return null
  }
}

function connectScriptProcessor(
  ctx: AudioContext,
  source: MediaStreamAudioSourceNode,
  onFloat: (samples: Float32Array) => void,
): { teardown: GraphTeardown } {
  const bufferSize = 4096
  const processor = ctx.createScriptProcessor(bufferSize, 1, 1)
  const mute = ctx.createGain()
  mute.gain.value = 0
  processor.onaudioprocess = (ev: AudioProcessingEvent) => {
    const input = ev.inputBuffer.getChannelData(0)
    if (input && input.length > 0) onFloat(input)
  }
  source.connect(processor)
  processor.connect(mute)
  mute.connect(ctx.destination)
  return {
    teardown: () => {
      try {
        processor.onaudioprocess = null as any
        processor.disconnect()
      } catch {
        /* */
      }
      try {
        mute.disconnect()
      } catch {
        /* */
      }
    },
  }
}

/**
 * Start mic → 16 kHz mono PCM stream. Caller must stop()/abort() to release.
 */
export async function startPcmStreamCapture(
  opts: PcmStreamCaptureOpts,
): Promise<PcmStreamHandle> {
  const maxMs = opts.maxMs ?? LOCAL_STT_MAX_RECORD_MS
  const onPcmChunk = opts.onPcmChunk
  const onLevel = opts.onLevel

  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    throw Object.assign(new Error("getUserMedia unavailable"), { code: "audio-capture" })
  }
  if (
    typeof AudioContext === "undefined" &&
    typeof (globalThis as any).webkitAudioContext === "undefined"
  ) {
    throw Object.assign(new Error("AudioContext unavailable"), { code: "audio-capture" })
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
    },
  })

  const AC = AudioContext || (globalThis as any).webkitAudioContext
  const ctx: AudioContext = new AC()
  // F7: resume suspended contexts so process callbacks fire
  if (ctx.state === "suspended") {
    try {
      await ctx.resume()
    } catch {
      /* continue; idle abort will surface if no chunks */
    }
  }

  const source = ctx.createMediaStreamSource(stream)
  let settled = false
  let maxTimer: ReturnType<typeof setTimeout> | null = null
  let stopResolve: (() => void) | null = null
  let stopPromise: Promise<void> | null = null

  const onFloat = (samples: Float32Array) => {
    if (settled) return
    processFloatChunk(samples, ctx.sampleRate || 48000, onPcmChunk, onLevel)
  }

  let backend: "audioworklet" | "scriptprocessor" = "scriptprocessor"
  let graph: { teardown: GraphTeardown } | null = await tryConnectWorklet(ctx, source, onFloat)
  if (graph) {
    backend = "audioworklet"
  } else {
    graph = connectScriptProcessor(ctx, source, onFloat)
    backend = "scriptprocessor"
  }

  const release = () => {
    if (maxTimer) {
      clearTimeout(maxTimer)
      maxTimer = null
    }
    try {
      graph?.teardown()
    } catch {
      /* */
    }
    graph = null
    try {
      source.disconnect()
    } catch {
      /* */
    }
    stopTracks(stream)
    try {
      void ctx.close()
    } catch {
      /* */
    }
  }

  const handleStop = async () => {
    if (settled) {
      if (stopPromise) return stopPromise
      return
    }
    settled = true
    release()
    if (stopResolve) stopResolve()
  }

  maxTimer = setTimeout(() => {
    void handleStop()
  }, maxMs)

  const handle: PcmStreamHandle = {
    backend,
    stop: () => {
      if (stopPromise) return stopPromise
      stopPromise = new Promise<void>((resolve) => {
        stopResolve = resolve
        void handleStop().then(() => resolve())
      })
      return stopPromise
    },
    abort: () => {
      if (settled) return
      settled = true
      release()
      if (stopResolve) stopResolve()
    },
  }

  return handle
}

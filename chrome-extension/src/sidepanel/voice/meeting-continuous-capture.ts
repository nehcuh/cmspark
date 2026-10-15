import { MeetingPcmEncoder, type MeetingBlock, type MeetingCredit } from "./meeting-continuous-pcm"
import { MEETING_PCM_WORKLET_JS } from "./meeting-pcm-worklet-generated"

export type MeetingCaptureOptions = {
  meetingId: string; captureId: string; epoch: number; modelId: string; engine?: "system"; lang?: string;
  request: (message: Record<string, unknown>) => Promise<any>;
  onStart?: () => void; onStatus?: (status: any) => void; onStopped?: () => void;
  onError?: (code: string) => void; onEnd?: (status: any) => void;
  /** Owned audio environment seam; production uses the current browser APIs. */
  env?: any;
}

function b64(pcm: Uint8Array): string {
  let binary = ""; for (const byte of pcm) binary += String.fromCharCode(byte)
  return btoa(binary)
}
function timeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("network_unknown")), Math.max(0, ms))
    promise.then(value => { clearTimeout(timer); resolve(value) }, error => { clearTimeout(timer); reject(error) })
  })
}

/** Same controller in the plugin and generated Summoner asset. Inference never closes this graph. */
export function createMeetingContinuousCapture(options: MeetingCaptureOptions) {
  const env = options.env ?? globalThis
  let stream: MediaStream | null = null, context: AudioContext | null = null
  let source: MediaStreamAudioSourceNode | null = null, mute: GainNode | null = null
  let processor: ScriptProcessorNode | null = null, worklet: AudioWorkletNode | null = null
  let workletUrl: string | null = null, encoder: MeetingPcmEncoder | null = null
  let backend: "audioworklet" | "scriptprocessor" | null = null
  let workletSealed = false
  let stopping = false, ended = false, silent = false, started = false
  let cursor = 0, rpc = 0, stopReason = "user_stop"
  let sealedResolve: (() => void) | null = null
  let stopPromise: Promise<void> | null = null
  let deadline: ReturnType<typeof setTimeout> | null = null, idle: ReturnType<typeof setTimeout> | null = null
  const inflight = new Map<number, Promise<void>>()
  const stoppedTracks = new Set<MediaStreamTrack>()
  const identity = { queue_contract: 1, sessionId: options.captureId, capture_epoch: options.epoch }
  const request = (type: string, fields: Record<string, unknown> = {}) => {
    try { return Promise.resolve(options.request({ ...identity, ...fields, type, v: 1, id: `pcm-${options.captureId}-${++rpc}` })) }
    catch (error) { return Promise.reject(error) }
  }

  function matches(message: any): boolean {
    return message?.queue_contract === 1 && message.meeting_id === options.meetingId && message.capture_id === options.captureId && message.capture_epoch === options.epoch
  }
  function stopStream(s: MediaStream | null) { for (const track of s?.getTracks() ?? []) if (!stoppedTracks.has(track)) { stoppedTracks.add(track); try { track.stop() } catch { /* */ } } }
  function tracksStop() { stopStream(stream) }
  function closeGraph() {
    tracksStop()
    if (deadline) clearTimeout(deadline); if (idle) clearTimeout(idle)
    deadline = idle = null
    if (processor) { processor.onaudioprocess = null; try { processor.disconnect() } catch { /* */ } }
    if (worklet) { worklet.port.onmessage = null; try { worklet.disconnect() } catch { /* */ } }
    try { source?.disconnect(); mute?.disconnect() } catch { /* */ }
    const old = context; context = null
    if (old) { old.onstatechange = null; void old.close().catch(() => {}) }
    if (workletUrl) { try { env.URL.revokeObjectURL(workletUrl) } catch { /* */ }; workletUrl = null }
    processor = null; worklet = null; source = null; mute = null
  }
  function armIdle() {
    if (idle) clearTimeout(idle)
    if (!stopping) idle = setTimeout(() => { void stop("input_gap") }, 10000)
  }
  function credits(value: MeetingCredit[]) {
    if (stopping) return
    if (worklet) worklet.port.postMessage({ type: "credits", credits: value })
    else encoder?.grant(value)
  }
  function handleStatus(status: any) {
    if (!matches(status) || ended) return
    if (!["meeting.capture.status", "voice.stt.partial"].includes(status.type)) return
    if (!Array.isArray(status.credits) || status.credits.length > 8) { void abort(); return }
    try { credits(status.credits) } catch { void abort(); options.onError?.("queue_protocol_error"); return }
    options.onStatus?.(status)
    if (status.phase === "finished" || status.phase === "failed") {
      ended = true; stopping = true; closeGraph()
      if (!silent) options.onEnd?.(status)
    } else if (!status.input_open && started && !stopping && status.stop_reason) void stop(status.stop_reason)
  }
  function block(value: MeetingBlock) {
    cursor = Math.max(cursor, value.sample_offset + value.frame_count)
    if (inflight.size >= 8) { options.onError?.("queue_protocol_error"); void stop("transport_backpressure"); return }
    const pending = request("voice.stt.chunk", { credit_id: value.credit_id, sample_offset: value.sample_offset,
      frame_count: value.frame_count, data: b64(value.pcm) }).then(ack => {
      if (!matches(ack) || ack.type !== "meeting.capture.status" || ack.credit_id !== value.credit_id || ack.accepted_through !== value.sample_offset + value.frame_count) throw new Error("queue_protocol_error")
      handleStatus(ack)
    }).catch(() => { options.onError?.("network_unknown"); if (!stopping) void stop("transport_backpressure") })
      .finally(() => inflight.delete(value.credit_id))
    inflight.set(value.credit_id, pending)
  }
  function sealed(end: number, reason: string) {
    workletSealed = true
    cursor = end; stopReason = reason
    sealedResolve?.(); sealedResolve = null
    if (!stopping) void stop(reason)
  }
  async function stop(reason = "user_stop"): Promise<void> {
    if (stopPromise) return stopPromise
    stopping = true; stopReason = reason; tracksStop(); options.onStopped?.()
    if (deadline) clearTimeout(deadline); if (idle) clearTimeout(idle)
    stopPromise = (async () => {
      try {
        const startedAt = Date.now()
        if (worklet && !workletSealed) {
          await timeout(new Promise<void>(resolve => { sealedResolve = resolve; worklet!.port.postMessage({ type: "seal", reason }) }), 2000)
        } else encoder?.seal(reason)
        closeGraph()
        await timeout(Promise.all([...inflight.values()]).then(() => {}), 2000 - (Date.now() - startedAt))
        const ack = await request("voice.stt.end", { final_sample_end: cursor, last_credit_id: Math.ceil(cursor / 640), stop_reason: stopReason })
        if (!matches(ack)) throw new Error("stale_capture")
        handleStatus(ack)
      } catch { closeGraph(); if (!silent) options.onError?.("network_unknown") }
    })()
    return stopPromise
  }
  async function abort() {
    if (ended) { closeGraph(); return }
    stopping = true; stopReason = "user_stop"; tracksStop()
    // Cancel discards any local partial; it must not manufacture an end/drain.
    closeGraph()
    try { const ack = await request("voice.stt.abort"); if (!matches(ack)) throw new Error("stale_capture"); handleStatus(ack) }
    catch { if (!silent) options.onError?.("network_unknown") }
  }
  async function start() {
    if (started || stopping || ended) return
    const startupEnd = Date.now() + 30000
    const gum = env.navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } }).then((s: MediaStream) => {
      if (stopping || ended) stopStream(s)
      return s
    })
    try {
      stream = await timeout(gum, startupEnd - Date.now())
      if (stopping || ended) { tracksStop(); return }
      const ack = await timeout(request("voice.stt.start", { format: "pcm_s16le", sampleRate: 16000, channels: 1,
        modelId: options.modelId, ...(options.engine ? { engine: options.engine } : {}), privacy_ack_v2: true, lang: options.lang ?? "zh" }), startupEnd - Date.now())
      if (!matches(ack) || ack.type !== "voice.stt.partial" || ack.status !== "receiving" || !Array.isArray(ack.credits)) throw new Error("stale_capture")
      if (stopping || ended) { tracksStop(); return }
      const Ctx = env.AudioContext ?? env.webkitAudioContext
      context = new Ctx()
      if (context!.state === "suspended") await timeout(context!.resume(), startupEnd - Date.now())
      if (stopping || ended) { closeGraph(); return }
      source = context!.createMediaStreamSource(stream!)
      mute = context!.createGain(); mute.gain.value = 0; mute.connect(context!.destination)
      if (typeof context!.audioWorklet?.addModule === "function" && env.AudioWorkletNode && env.Blob && env.URL?.createObjectURL) {
        try {
          workletUrl = env.URL.createObjectURL(new env.Blob([MEETING_PCM_WORKLET_JS], { type: "application/javascript" }))
          await timeout(context!.audioWorklet.addModule(workletUrl!), startupEnd - Date.now())
          if (stopping || ended) { closeGraph(); return }
          const node: AudioWorkletNode = new env.AudioWorkletNode(context, "cmspark-meeting-pcm-q1", { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: "explicit" })
          worklet = node
          await timeout(new Promise<void>(resolve => {
            node.port.onmessage = event => {
              const m = event.data
              if (m?.type === "ready") resolve()
              else if (m?.type === "block" && m.pcm instanceof Uint8Array) { armIdle(); block(m) }
              else if (m?.type === "sealed") sealed(m.end, m.reason)
            }
            node.port.postMessage({ type: "init", credits: ack.credits })
          }), startupEnd - Date.now())
          backend = "audioworklet"; source!.connect(node); node.connect(mute!)
        } catch {
          if (worklet) { worklet.port.onmessage = null; worklet.disconnect(); worklet = null }
          if (workletUrl) { env.URL.revokeObjectURL(workletUrl); workletUrl = null }
        }
      }
      if (stopping || ended) { closeGraph(); return }
      if (!worklet) {
        encoder = new MeetingPcmEncoder(block, sealed); encoder.grant(ack.credits)
        processor = context!.createScriptProcessor(1024, 1, 1)
        processor.onaudioprocess = event => {
          if (stopping) return
          const input = event.inputBuffer.getChannelData(0), rate = context!.sampleRate
          // playbackTime describes output scheduling, not an input sample cursor.
          // Feed every delivered input buffer; track/context/idle/credit guards
          // report observable interruptions without claiming physical no-loss.
          armIdle(); encoder!.push(input, rate)
        }
        source!.connect(processor); processor.connect(mute!); backend = "scriptprocessor"
      }
      for (const track of stream!.getTracks()) {
        track.onended = () => { if (!stopping) void stop("permission_revoked") }
        track.onmute = () => { if (!stopping) void stop("input_gap") }
      }
      context!.onstatechange = () => { if (!stopping && context?.state === "suspended") void stop("suspended") }
      started = true; armIdle(); deadline = setTimeout(() => { void stop("hard_limit") }, Math.max(0, 10800000))
      if (!silent) { options.onStart?.(); options.onStatus?.(ack) }
    } catch { stopping = true; closeGraph(); options.onError?.("startup_timeout"); await abort() }
  }
  return { start, stop, abort, handleStatus, get backend() { return backend },
    destroy() { silent = true; void abort() }, get admittedEnd() { return cursor } }
}

export { meetingSourceRangeLabel, meetingCaptureErrorMessage, meetingCaptureStopLabel } from "./meeting-continuous-pcm"

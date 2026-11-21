import { claimWorkbenchCapture } from "./workbench-capture-owner"
import { createMeetingContinuousCapture } from "./meeting-continuous-capture"
import { createMeetingRuntimeChannel } from "./meeting-runtime-channel"

/** One explicit plugin Begin. Current-connection capability precedes record/mic admission. */
export function createPanelMeetingCapture(options: {
  liveAsr?: string; canAcquire?: () => boolean;
  meetingId: string; modelId: string; lang?: string; speaker?: string;
  /** Owned audio seam; live callers omit it. */ env?: any;
  onStarted: (meeting: any) => void; onStart: () => void; onStopped: () => void;
  onStatus: (status: any) => void; onEnd: (status: any) => void; onError: (code: string) => void;
}) {
  let controller: ReturnType<typeof createMeetingContinuousCapture> | null = null
  let stopped = false, destroyed = false
  let beginPending = false
  const stale = () => destroyed || stopped || options.canAcquire?.() === false
  let releaseLock: (() => void) | null = null
  const release = () => { releaseLock?.(); releaseLock = null }
  const channel = createMeetingRuntimeChannel(message => controller?.handleStatus(message), () => {
    if (destroyed) return
    destroyed = true; release(); controller?.destroy(); options.onError("network_unknown"); channel.destroy()
  })
  const captureId = crypto.randomUUID()
  // Snapshot synchronously at the explicit Begin, before any transport await.
  const speaker = options.speaker?.trim().slice(0, 32) || undefined
  async function start() {
    try {
      releaseLock = await claimWorkbenchCapture("microphone")
      if (!releaseLock) throw new Error("capture_busy")
      if (stale()) throw new Error("stale_capture")
      const pong = await channel.request({ type: "system.ping" })
      if (pong.type !== "system.pong" || pong.meeting_pcm_contract !== 1 || stale()) throw new Error("contract_unavailable")
      const loaded = await channel.request({ type: "meeting.get", meeting_id: options.meetingId })
      if (stale() || loaded.type !== "meeting.get_result" || loaded.meeting?.id !== options.meetingId) throw new Error("stale_capture")
      if (loaded.meeting.privacy?.audio_retained) throw new Error("audio_retention_unsupported")
      beginPending = true
      const reply = await channel.request({ type: "meeting.start", v: 1, id: options.meetingId, queue_contract: 1,
        capture_id: captureId, expected_capture_epoch: loaded.meeting.capture_epoch ?? 0,
        privacy_ack_v1: true, live_asr: options.liveAsr ?? "local",
        ...(options.liveAsr && options.liveAsr !== "local" ? { privacy_ack_meeting_asr_v1: true } : { privacy_ack_v2: true }),
        audio_retained: false, ...(speaker ? { speaker } : {}) })
      beginPending = false
      if (reply.type === "meeting.error" || reply.type === "error") throw new Error(reply.code || "stale_capture")
      const status = reply.continuous_capture
      if (reply.type !== "meeting.started" || reply.meeting?.id !== options.meetingId || status?.capture_id !== captureId ||
          status.meeting_id !== options.meetingId || status.queue_contract !== 1 || !Number.isSafeInteger(status.capture_epoch)) throw new Error("stale_capture")
      if (stale()) {
        await channel.request({ type: "voice.stt.abort", v: 1, queue_contract: 1, sessionId: captureId, capture_epoch: status.capture_epoch })
        throw new Error("stale_capture")
      }
      controller = createMeetingContinuousCapture({ meetingId: options.meetingId, captureId, epoch: status.capture_epoch,
        engine: options.liveAsr && options.liveAsr !== "local" ? "meeting-external" : undefined, modelId: options.modelId, lang: options.lang, env: options.env, request: channel.request, onStart: options.onStart,
        onStopped: options.onStopped, onStatus: options.onStatus, onError: options.onError,
        onEnd: value => { release(); options.onEnd(value); channel.destroy() } })
      options.onStarted(reply.meeting)
      if (stopped) await controller.abort()
      else await controller.start()
    } catch (error) {
      release(); channel.destroy()
      if (!destroyed) options.onError(error instanceof Error ? error.message : "contract_unavailable")
    }
  }
  return { start, stop() { stopped = true; return controller?.stop() }, abort() { stopped = true; return controller?.abort() },
    destroy() { destroyed = true; stopped = true; release(); controller?.destroy(); if (!beginPending) channel.destroy() } }
}

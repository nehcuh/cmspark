/** #494 q1 constants: reviewed contract, never renderer/config overrides. */
export const MEETING_PCM = Object.freeze({
  contract: 1, rate: 16_000, sampleBytes: 2,
  segmentFrames: 128_000, capacityFrames: 960_000,
  blockFrames: 640, credits: 8, recentAcks: 16,
  highWaterFrames: 768_000, captureMs: 10_800_000,
  captureFrames: 172_800_000, startupMs: 30_000, flushMs: 2_000,
  idleMs: 10_000, jobMs: 330_000, drainMs: 3_600_000, cleanupMs: 5_000,
})
export type CaptureStopReason = "user_stop" | "capacity" | "hard_limit" | "input_gap" |
  "permission_revoked" | "suspended" | "transport_backpressure" | "unload"
export type CapturePhase = "starting" | "capturing" | "draining" | "canceling" | "retiring" | "finished" | "failed"
export type CaptureOutcome = "complete" | "limited" | "cancelled" | "failed" | "interrupted"
export type PcmCredit = { credit_id: number; sample_offset: number; max_frames: number }
export type CaptureIdentity = { meeting_id: string; capture_id: string; capture_epoch: number }
export type CaptureStatus = CaptureIdentity & {
  type: "meeting.capture.status"; v: 1; queue_contract: 1;
  phase: CapturePhase; input_open: boolean; server_received_end: number;
  processed_end: number; committed_end: number; saved_text_segments: number;
  resident_seconds: number; sealed_segments: number; inflight_segment: number | null;
  high_water: boolean; eta_seconds: number | null; stop_reason: CaptureStopReason | null;
  completion: { outcome: CaptureOutcome | null; prefix_complete: boolean };
  code?: string; credit_id?: number; accepted_through?: number; credits: PcmCredit[];
}
export const isCaptureId = (id: unknown): id is string =>
  typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
export const isCaptureEpoch = (n: unknown): n is number => Number.isSafeInteger(n) && (n as number) >= 0
const CAPTURE_ERRORS = new Set(["contract_unavailable", "stale_capture", "queue_protocol_error", "startup_timeout", "capture_flush_timeout", "network_unknown", "save_failed", "drain_timeout", "cleanup_pending",
  "session_busy", "invalid_model", "invalid_format", "seq_gap", "seq_duplicate", "payload_too_large", "session_unknown", "already_ended", "aborted", "total_seq_mismatch", "model_missing", "binary_missing", "hash_fail", "infer_timeout", "empty_result", "peer_mismatch", "resource_conflict", "infer_failed", "binary_broken", "oom", "invalid_session_id", "partial_skipped", "partial_busy", "system_engine_failed", "system_unavailable", "system_lang_unsupported", "segment_id_conflict"])

/** Public owner-only DTO; explicitly drops extra backend fields before SSE/HTTP. */
export function projectCaptureStatus(value: any): CaptureStatus | null {
  if (!value || value.type !== "meeting.capture.status" || value.v !== 1 || value.queue_contract !== 1 ||
      typeof value.meeting_id !== "string" || !isCaptureId(value.capture_id) || !isCaptureEpoch(value.capture_epoch) ||
      !["starting", "capturing", "draining", "canceling", "retiring", "finished", "failed"].includes(value.phase) ||
      typeof value.input_open !== "boolean" || typeof value.high_water !== "boolean" ||
      !["server_received_end", "processed_end", "committed_end", "saved_text_segments", "sealed_segments"].every(k => Number.isSafeInteger(value[k]) && value[k] >= 0) ||
      value.saved_text_segments > Math.ceil(MEETING_PCM.captureFrames / MEETING_PCM.segmentFrames) || value.sealed_segments > 8 ||
      value.server_received_end > MEETING_PCM.captureFrames || value.processed_end > value.server_received_end || value.committed_end > value.processed_end ||
      typeof value.resident_seconds !== "number" || !Number.isFinite(value.resident_seconds) || value.resident_seconds < 0 || value.resident_seconds > 60 ||
      (value.inflight_segment !== null && (!Number.isSafeInteger(value.inflight_segment) || value.inflight_segment < 0 || value.inflight_segment >= Math.ceil(MEETING_PCM.captureFrames / MEETING_PCM.segmentFrames))) ||
      (value.eta_seconds !== null && (typeof value.eta_seconds !== "number" || !Number.isFinite(value.eta_seconds) || value.eta_seconds < 0)) ||
      ![null, "user_stop", "capacity", "hard_limit", "input_gap", "permission_revoked", "suspended", "transport_backpressure", "unload"].includes(value.stop_reason) ||
      !value.completion || typeof value.completion.prefix_complete !== "boolean" ||
      ![null, "complete", "limited", "cancelled", "failed", "interrupted"].includes(value.completion.outcome) ||
      !Array.isArray(value.credits) || value.credits.length > MEETING_PCM.credits ||
      !value.credits.every((c: any) => Number.isSafeInteger(c.credit_id) && c.credit_id > 0 && Number.isSafeInteger(c.sample_offset) && c.sample_offset === (c.credit_id - 1) * MEETING_PCM.blockFrames &&
        Number.isSafeInteger(c.max_frames) && c.max_frames > 0 && c.max_frames <= MEETING_PCM.blockFrames && c.sample_offset + c.max_frames <= MEETING_PCM.captureFrames)) return null
  const result: CaptureStatus = { type: "meeting.capture.status", v: 1, queue_contract: 1,
    meeting_id: value.meeting_id, capture_id: value.capture_id, capture_epoch: value.capture_epoch,
    phase: value.phase, input_open: value.input_open, server_received_end: value.server_received_end,
    processed_end: value.processed_end, committed_end: value.committed_end, saved_text_segments: value.saved_text_segments,
    resident_seconds: value.resident_seconds, sealed_segments: value.sealed_segments, inflight_segment: value.inflight_segment,
    high_water: value.high_water, eta_seconds: value.eta_seconds, stop_reason: value.stop_reason,
    completion: { outcome: value.completion.outcome, prefix_complete: value.completion.prefix_complete },
    credits: value.credits.map((c: PcmCredit) => ({ credit_id: c.credit_id, sample_offset: c.sample_offset, max_frames: c.max_frames })) }
  if (value.code !== undefined) {
    if (!CAPTURE_ERRORS.has(value.code)) return null
    result.code = value.code
  }
  if (Number.isSafeInteger(value.credit_id) && value.credit_id > 0 && Number.isSafeInteger(value.accepted_through) && value.accepted_through >= 0) {
    result.credit_id = value.credit_id; result.accepted_through = value.accepted_through
  }
  return result
}

export function meetingPcmCapsSnapshot() { return { ...MEETING_PCM } }

export function meetingPcmPong() { return { type: "system.pong", meeting_pcm_contract: 1 } }

export function checkedMeetingPcmReply(type: string, params: Record<string, unknown>, reply: any): unknown {
  if (["error", "meeting.error", "voice.stt.error"].includes(reply?.type)) {
    const codes = ["contract_unavailable", "stale_capture", "queue_protocol_error", "need_privacy_ack", "engine_not_local", "system_unavailable", "model_missing", "invalid_model", "resource_conflict", "save_failed", "network_unknown"]
    return { type: reply.type, v: 1, code: codes.includes(reply.code) || CAPTURE_ERRORS.has(reply.code) ? reply.code : "queue_protocol_error", message: "连续录音未完成" }
  }
  const captureId = type === "meeting.start" || type === "meeting.end" ? params.capture_id : params.sessionId
  if (type === "meeting.end") {
    if (reply?.type !== "meeting.ended" || reply.meeting?.id !== (params.meeting_id ?? params.id) ||
        reply.meeting.capture_epoch !== params.capture_epoch || reply.meeting.capture_summary?.last_capture_id !== params.capture_id ||
        !["finished", "failed"].includes(reply.meeting.capture_summary.phase)) throw new Error("queue_protocol_error")
    return { type: "meeting.ended", v: 1, meeting: reply.meeting, ...(reply.audio_deleted !== undefined ? { audio_deleted: reply.audio_deleted === true } : {}) }
  }
  const raw = type === "meeting.start" ? reply?.continuous_capture : reply
  const status = projectCaptureStatus({ ...raw, type: "meeting.capture.status" })
  const epoch = type === "meeting.start" ? Number(params.expected_capture_epoch) + 1 : params.capture_epoch
  if (!status || status.capture_id !== captureId || status.capture_epoch !== epoch ||
      (type === "voice.stt.chunk" && (status.credit_id !== params.credit_id || status.accepted_through !== Number(params.sample_offset) + Number(params.frame_count)))) throw new Error("queue_protocol_error")
  if (type === "meeting.start") {
    if (reply.type !== "meeting.started" || reply.meeting?.id !== (params.meeting_id ?? params.id) || reply.meeting_pcm_contract !== 1 ||
        !reply.meeting_pcm_caps || Object.entries(MEETING_PCM).some(([key, value]) => reply.meeting_pcm_caps[key] !== value)) throw new Error("queue_protocol_error")
    const caps = Object.fromEntries(Object.keys(MEETING_PCM).map(key => [key, reply.meeting_pcm_caps[key]]))
    return { type: "meeting.started", v: 1, meeting: reply.meeting, continuous_capture: status, meeting_pcm_contract: 1, meeting_pcm_caps: caps }
  }
  if (type === "voice.stt.start") {
    if (reply.type !== "voice.stt.partial" || reply.status !== "receiving") throw new Error("queue_protocol_error")
    return { ...status, type: "voice.stt.partial", sessionId: captureId, status: "receiving" }
  }
  if (reply.type !== "meeting.capture.status") throw new Error("queue_protocol_error")
  return status
}

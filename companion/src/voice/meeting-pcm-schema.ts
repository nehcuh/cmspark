import { isCaptureEpoch, isCaptureId, MEETING_PCM as C } from "./meeting-pcm-contract"

const own = ["type", "v", "id", "queue_contract", "sessionId", "capture_epoch"]
const fields: Record<string, string[]> = {
  "meeting.start": ["type", "v", "id", "meeting_id", "queue_contract", "capture_id", "expected_capture_epoch", "privacy_ack_v1", "privacy_ack_v2", "audio_retained", "speaker"],
  "meeting.end": ["type", "v", "id", "meeting_id", "queue_contract", "capture_id", "capture_epoch"],
  "voice.stt.start": [...own, "format", "sampleRate", "channels", "modelId", "engine", "privacy_ack_v2", "lang"],
  "voice.stt.chunk": [...own, "credit_id", "sample_offset", "frame_count", "data"],
  "voice.stt.end": [...own, "final_sample_end", "last_credit_id", "stop_reason"],
  "voice.stt.abort": own, "voice.stt.partial_request": own,
}
export function hasMeetingPcmFields(m: any): boolean {
  return ["queue_contract", "capture_id", "capture_epoch", "expected_capture_epoch", "credit_id", "sample_offset", "frame_count", "final_sample_end"].some(k => k in m)
}
export function validMeetingPcmMessage(m: any): boolean {
  if (!m || m.queue_contract !== 1 || m.v !== 1 || typeof m.type !== "string" || !Object.hasOwn(fields, m.type) || Object.keys(m).some(k => !fields[m.type].includes(k))) return false
  if (m.id !== undefined && (typeof m.id !== "string" || m.id.length > 200)) return false
  if (m.type === "meeting.start") return isCaptureId(m.capture_id) && isCaptureEpoch(m.expected_capture_epoch) && m.expected_capture_epoch < Number.MAX_SAFE_INTEGER &&
    m.privacy_ack_v1 === true && m.privacy_ack_v2 === true && (m.speaker === undefined || (typeof m.speaker === "string" && m.speaker.length <= 32)) && (m.audio_retained === undefined || m.audio_retained === false) && (typeof m.meeting_id === "string" || typeof m.id === "string")
  if (m.type === "meeting.end") return isCaptureId(m.capture_id) && isCaptureEpoch(m.capture_epoch)
  if (!isCaptureId(m.sessionId) || !isCaptureEpoch(m.capture_epoch) || m.capture_epoch === 0) return false
  if (m.type === "voice.stt.start") return m.format === "pcm_s16le" && m.sampleRate === 16000 && m.channels === 1 && m.privacy_ack_v2 === true &&
    (m.engine === undefined || m.engine === "system") && (m.engine === "system" || ["small", "medium", "large-v3-turbo"].includes(m.modelId)) &&
    (m.lang === undefined || (typeof m.lang === "string" && m.lang.length <= 64))
  if (m.type === "voice.stt.chunk") return Number.isSafeInteger(m.credit_id) && m.credit_id > 0 && Number.isSafeInteger(m.sample_offset) && m.sample_offset >= 0 &&
    Number.isSafeInteger(m.frame_count) && m.frame_count > 0 && m.frame_count <= C.blockFrames && typeof m.data === "string" &&
    m.data.length <= Math.ceil(C.blockFrames * 2 / 3) * 4 && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(m.data) &&
    Buffer.from(m.data, "base64").length === m.frame_count * 2
  if (m.type === "voice.stt.end") return Number.isSafeInteger(m.final_sample_end) && m.final_sample_end >= 0 && m.final_sample_end <= C.captureFrames &&
    m.last_credit_id === Math.ceil(m.final_sample_end / C.blockFrames) &&
    ["user_stop", "capacity", "hard_limit", "input_gap", "permission_revoked", "suspended", "transport_backpressure", "unload"].includes(m.stop_reason)
  return true
}

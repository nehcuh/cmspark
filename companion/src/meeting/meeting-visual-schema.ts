import { createHash } from "node:crypto"
import { isSafeMeetingId } from "./meeting-store"
import { parseRasterDims } from "../llm/image-preview"
import { sniffRasterImage } from "../llm/image-sniff"

export const VISUAL_WIRE_LIMIT = 9 * 1024 * 1024
const FRAME_BYTES = 512 * 1024
export interface MeetingVisualFrame {
  frameId: string
  meetingId: string
  recordingId: string
  timeMs: number
  width: number
  height: number
  mime: "image/png" | "image/jpeg" | "image/webp"
  sha256: string
  byteLength: number
}
const safeId = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9_-]{1,100}$/.test(value)
const only = (value: any, keys: string[]) => !!value && typeof value === "object" && !Array.isArray(value) &&
  Object.keys(value).every(k => keys.includes(k))
const integer = (n: unknown, low: number, high: number) => typeof n === "number" && Number.isSafeInteger(n) && n >= low && n <= high
export function validVisualFrameSource(frame: any, meetingId: string): frame is Omit<MeetingVisualFrame, "byteLength"> {
  return !!frame && safeId(frame.frameId) && safeId(frame.recordingId) && frame.meetingId === meetingId &&
    integer(frame.timeMs,0,Number.MAX_SAFE_INTEGER) && integer(frame.width,1,1600) && integer(frame.height,1,1600) &&
    ["image/jpeg","image/webp","image/png"].includes(frame.mime) && typeof frame.sha256 === "string" &&
    /^[0-9a-f]{64}$/.test(frame.sha256)
}
export function validVisualFrame(frame: any, meetingId: string): frame is MeetingVisualFrame {
  return only(frame, ["frameId","meetingId","recordingId","timeMs","width","height","mime","sha256","byteLength"]) &&
    integer(frame.byteLength,1,FRAME_BYTES) && validVisualFrameSource(frame, meetingId)
}
export function validVisualMessage(m: any, rawBytes?: number): boolean {
  if (!m || m.v !== 1 || !safeId(m.id) || !safeId(m.owner_id) || !isSafeMeetingId(m.meeting_id) ||
      rawBytes !== undefined && rawBytes > VISUAL_WIRE_LIMIT) return false
  const fields = (...additional: string[]) => only(m, ["id","v","type","meeting_id","owner_id",...additional])
  if (m.type === "meeting.visual.list") return fields()
  if (m.type === "meeting.visual.remove") return fields("frameId") && safeId(m.frameId)
  if (m.type === "meeting.visual.recover") return fields("acknowledge","corrupt_sha256") &&
    m.acknowledge === true && typeof m.corrupt_sha256 === "string" && /^[0-9a-f]{64}$/.test(m.corrupt_sha256)
  const token = typeof m.consent_token === "string" && /^[a-f\d-]{36}$/.test(m.consent_token)
  if (m.type === "meeting.visual.cancel") return fields("consent_token") && token
  if (!Array.isArray(m.frames) || !integer(m.frames.length,1,12)) return false
  if (new Set(m.frames.map((frame:any) => frame?.frameId)).size !== m.frames.length) return false
  if (m.type === "meeting.visual.prepare") return fields("frames") && m.frames.every((f:any) => validVisualFrame(f,m.meeting_id))
  return m.type === "meeting.visual.execute" && fields("consent_token","frames") && token &&
    m.frames.every((f:any) => only(f,["frameId","base64"]) && safeId(f.frameId) &&
      typeof f.base64 === "string" && f.base64.length > 0 && f.base64.length <= Math.ceil(FRAME_BYTES / 3) * 4)
}

export function matchesVisualImage(expected: MeetingVisualFrame, image: { frameId: string; base64: string }): boolean {
  if (image.frameId !== expected.frameId || image.base64.length !== Math.ceil(expected.byteLength / 3) * 4) return false
  const bytes = Buffer.from(image.base64, "base64")
  if (bytes.length !== expected.byteLength || bytes.toString("base64") !== image.base64 ||
    sniffRasterImage(bytes) !== expected.mime || createHash("sha256").update(bytes).digest("hex") !== expected.sha256) return false
  const size = parseRasterDims(bytes, expected.mime)
  return size?.width === expected.width && size.height === expected.height
}

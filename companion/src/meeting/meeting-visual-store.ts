import * as fs from "node:fs"
import * as path from "node:path"
import { createHash, randomUUID } from "node:crypto"
import { DATA_DIR } from "../config"
import { logger } from "../logger"
import { isSafeMeetingId, refreshVisualMinutesStatus, writeJsonAtomic } from "./meeting-store"
import { validVisualFrameSource, type MeetingVisualFrame } from "./meeting-visual-schema"

export interface VisualFacts {
  recognizedText: string
  description: string
  uncertainties: string[]
}
export function validVisualFacts(value: any): value is VisualFacts {
  return !!value && typeof value.recognizedText === "string" && value.recognizedText.length <= 6000 &&
    typeof value.description === "string" && value.description.length <= 4000 && !!(value.recognizedText.trim() || value.description.trim()) &&
    Array.isArray(value.uncertainties) && value.uncertainties.length <= 1000 &&
    value.uncertainties.every((item: unknown) => typeof item === "string" && item.trim()) && value.uncertainties.join("").length <= 1000
}
export type MeetingVisualEvidence = Omit<MeetingVisualFrame,"byteLength"> & VisualFacts & {
  model: string
  endpoint: string
  profileId: string
  analyzedAt: string
  status: "completed"
}

type FrameIdentity = Omit<MeetingVisualFrame, "byteLength">
export function sameVisualFrame(a: FrameIdentity, b: FrameIdentity): boolean {
  return a.frameId === b.frameId && a.meetingId === b.meetingId && a.recordingId === b.recordingId &&
    a.timeMs === b.timeMs && a.width === b.width && a.height === b.height && a.mime === b.mime && a.sha256 === b.sha256
}

function evidenceFile(id: string, dataDir: string) {
  if (!isSafeMeetingId(id)) throw new Error("invalid meeting id")
  return path.join(dataDir, "meetings", id, "visual-evidence.json")
}
export class MeetingVisualEvidenceUnavailableError extends Error {
  constructor(readonly recoverable: boolean, readonly sha256?: string) {
    super(recoverable ? "画面证据文件损坏。请在会议画面中恢复，或还原该文件后重试。" : "当前无法读取画面证据，请检查文件访问权限后重试。")
  }
  get code() { return this.recoverable ? "visual_evidence_corrupt" : "visual_evidence_unavailable" }
}

const storedKeys = new Set(["frameId", "meetingId", "recordingId", "timeMs", "width", "height", "mime", "sha256",
  "recognizedText", "description", "uncertainties", "status", "model", "profileId", "endpoint", "analyzedAt"])
function validEvidence(row: any, id: string): row is MeetingVisualEvidence {
  return !!row && Object.keys(row).every(key => storedKeys.has(key)) && row.status === "completed" && typeof row.model === "string" && !!row.model.trim() &&
    typeof row.profileId === "string" && !!row.profileId.trim() && typeof row.endpoint === "string" && !!row.endpoint.trim() &&
    typeof row.analyzedAt === "string" && Number.isFinite(Date.parse(row.analyzedAt)) && validVisualFacts(row) && validVisualFrameSource(row, id)
}

export function readMeetingVisualEvidence(id: string, dataDir = DATA_DIR): MeetingVisualEvidence[] {
  const file = evidenceFile(id, dataDir)
  let bytes: Buffer
  try { bytes = fs.readFileSync(file) } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return []
    throw new MeetingVisualEvidenceUnavailableError(false)
  }
  try {
    const rows: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes))
    if (Array.isArray(rows) && rows.length <= 240 && rows.every(row => validEvidence(row, id)) &&
        new Set(rows.map(row => row.frameId)).size === rows.length) return rows
  } catch { /* invalid UTF-8 or JSON; preserve the file */ }
  throw new MeetingVisualEvidenceUnavailableError(true, createHash("sha256").update(bytes).digest("hex"))
}

/** Preserve the exact reviewed corrupt material. A changed or valid file cannot be cleared. */
export function quarantineUnreadableMeetingEvidence(id: string, expectedSha256: string, dataDir = DATA_DIR): void {
  try { readMeetingVisualEvidence(id, dataDir) } catch (cause) {
    if (!(cause instanceof MeetingVisualEvidenceUnavailableError) || !cause.recoverable || cause.sha256 !== expectedSha256) throw cause
    const file = evidenceFile(id, dataDir)
    const archive = path.join(path.dirname(file), `visual-evidence.corrupt-${randomUUID()}.json`)
    fs.closeSync(fs.openSync(archive, "wx", 0o600))
    try { fs.renameSync(file, archive) } catch (error) { fs.unlinkSync(archive); throw error }
    try { refreshVisualMinutesStatus(id, dataDir) } catch { logger.warn("meeting.visual_minutes_status_deferred", { id }) }
    return
  }
  throw new Error("画面证据文件已变化，请刷新后核对。")
}
export function writeMeetingVisualEvidence(id: string, item: MeetingVisualEvidence, dataDir = DATA_DIR): void {
  const file = evidenceFile(id, dataDir)
  if (item.meetingId !== id || !fs.existsSync(path.join(path.dirname(file), "meta.json"))) throw new Error("meeting missing")
  if (!validEvidence(item, id)) throw new Error("invalid meeting visual evidence")
  const rows = readMeetingVisualEvidence(id,dataDir)
  const index = rows.findIndex(row => row.frameId === item.frameId)
  if (index < 0) rows.push(item)
  else if (sameVisualFrame(rows[index], item)) rows[index] = item
  else throw new Error("frame identity changed")
  if (rows.length > 240) throw new Error("visual evidence limit")
  commitVisualRows(id, file, rows, dataDir)
}
export function removeMeetingVisualEvidence(id: string, frameId: string, dataDir = DATA_DIR): boolean {
  const rows = readMeetingVisualEvidence(id,dataDir)
  const kept = rows.filter(row => row.frameId !== frameId)
  if (kept.length === rows.length) return false
  commitVisualRows(id, evidenceFile(id,dataDir), kept, dataDir)
  return true
}

function commitVisualRows(id: string, file: string, rows: MeetingVisualEvidence[], dataDir: string): void {
  writeJsonAtomic(file, rows)
  try {
    refreshVisualMinutesStatus(id, dataDir)
  } catch {
    // Evidence has already committed. The next meeting read derives freshness
    // from its actual fingerprint even if updating the cached status failed.
    logger.warn("meeting.visual_minutes_status_deferred", { id })
  }
}

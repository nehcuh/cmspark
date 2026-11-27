import * as fs from "node:fs"
import * as path from "node:path"
import { randomUUID } from "node:crypto"
import { DATA_DIR } from "../config"
import { logger } from "../logger"
import { refreshVisualMinutesStatus, writeJsonAtomic } from "./meeting-store"
import { evidenceFile, MeetingVisualEvidenceUnavailableError, readMeetingVisualEvidence,
  sameVisualFrame, validEvidence, type MeetingVisualEvidence } from "./meeting-visual-evidence"

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

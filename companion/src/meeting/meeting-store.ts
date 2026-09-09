/**
 * MeetingSession disk store — ~/.cmspark-agent/meetings/<id>/
 * SoT: 2026-08-07-meeting-minutes-design.md
 */

import * as fs from "fs"
import * as path from "path"
import * as crypto from "crypto"
import { DATA_DIR } from "../config"
import { logger } from "../logger"
import { MEETING_MINUTES_MAX_INPUT_CHARS } from "./minutes-prompt"

export type TranscriptSource = "stt" | "user_edit" | "paste" | "asr_refiner"

export type TranscriptLine = {
  /** Stable client segment key for safe retry; scoped to one meeting. */
  segment_id?: string
  t0?: number
  t1?: number
  speaker?: string
  text: string
  source: TranscriptSource
}

export type MeetingMinutes = {
  tldr?: string
  decisions?: string[]
  actions?: string[]
  risks?: string[]
  raw_md: string
  generated_at: string
  source_fingerprint?: string
  source_transcript?: string
  stale?: boolean
  corrected_transcript?: string
  corrections?: Array<{ original: string; replacement: string; reference_excerpt: string; reason: string }>
  reference_supplements?: Array<{ reference_excerpt: string; reason: string }>
  conflicts?: Array<{ transcript_excerpt: string; reference_excerpt: string; reason: string }>
}

export type MeetingStatus =
  | "draft"
  | "recording"
  | "ready"
  | "generating"
  | "done"
  | "error"

export type MeetingDiarizeMeta = {
  method: "audio_cluster" | "text_gap" | "embedding"
  k: number
  at: string
  /** legacy methods stay true; embedding false since diarize-eval gate PASS (#260) */
  experimental: boolean
}

export type MeetingMeta = {
  id: string
  thread_id?: string | null
  title: string
  started_at: string
  ended_at?: string | null
  status: MeetingStatus
  privacy: {
    stt_engine: "local" | "none"
    audio_retained: boolean
    retain_until?: string | null
  }
  /** Mtg3: last auto-diarize run (anonymous labels only). */
  diarize?: MeetingDiarizeMeta | null
  error?: string | null
}

export type MeetingSession = MeetingMeta & {
  transcript: TranscriptLine[]
  /** Original ASR utterances; editing/generation never rewrites this archive. */
  original_transcript?: TranscriptLine[]
  reference_notes?: string
  reference_name?: string
  minutes?: MeetingMinutes | null
}

export class MeetingTranscriptLimitError extends Error {
  constructor() { super("转写或原始识别存档已达 200000 字上限，请新建会议继续") }
}

export class MeetingTranscriptSegmentCollisionError extends Error {
  constructor() { super("同一转写段标识对应不同内容，请保留当前稿并核对") }
}

/** Material identity, independent of recording status and generated artifacts. */
export function meetingSourceFingerprint(transcript: string, referenceNotes = "", referenceName = ""): string {
  return crypto.createHash("sha256").update(JSON.stringify([transcript.trim(), referenceNotes.trim(), referenceName.trim()])).digest("hex")
}

function reconcileMinutesSource(session: MeetingSession): void {
  if (!session.minutes) return
  const fingerprint = meetingSourceFingerprint(transcriptToText(session.transcript), session.reference_notes, session.reference_name)
  session.minutes.stale = session.minutes.source_fingerprint !== fingerprint
  if (session.minutes.stale && session.status === "done") session.status = "ready"
}

function meetingsRoot(dataDir = DATA_DIR): string {
  return path.join(dataDir, "meetings")
}

function meetingDir(id: string, dataDir = DATA_DIR): string {
  return path.join(meetingsRoot(dataDir), id)
}

/** Ensure id is a safe single path segment. */
export function isSafeMeetingId(id: string): boolean {
  return typeof id === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]{7,63}$/.test(id)
}

export function ensureMeetingsRoot(dataDir = DATA_DIR): string {
  const root = meetingsRoot(dataDir)
  fs.mkdirSync(root, { recursive: true, mode: 0o700 })
  try {
    fs.chmodSync(root, 0o700)
  } catch {
    /* windows */
  }
  return root
}

function resolveContained(id: string, dataDir = DATA_DIR): string | null {
  if (!isSafeMeetingId(id)) return null
  const root = path.resolve(ensureMeetingsRoot(dataDir))
  const dir = path.resolve(meetingDir(id, dataDir))
  if (dir !== root && !dir.startsWith(root + path.sep)) return null
  return dir
}

function writeJsonAtomic(filePath: string, data: unknown): void {
  const dir = path.dirname(filePath)
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  const tmp = `${filePath}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { encoding: "utf8", mode: 0o600 })
  fs.renameSync(tmp, filePath)
  try {
    fs.chmodSync(filePath, 0o600)
  } catch {
    /* */
  }
}

function readJson<T>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) return null
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as T
  } catch {
    return null
  }
}

/** Hard cap on retained meeting sessions (P2 disk bound). */
export const MAX_MEETINGS = 100

/**
 * Delete an entire meeting directory (meta + transcript + minutes + audio).
 * Returns false if id invalid or dir missing.
 */
export function deleteMeeting(id: string, dataDir = DATA_DIR): boolean {
  const dir = resolveContained(id, dataDir)
  if (!dir || !fs.existsSync(dir)) return false
  try {
    fs.rmSync(dir, { recursive: true, force: true })
    logger.info("meeting.deleted", { id })
    return true
  } catch (e: any) {
    logger.warn("meeting.delete_failed", { id, error: e?.message || String(e) })
    return false
  }
}

/**
 * If meeting count exceeds MAX_MEETINGS, delete oldest non-recording sessions first.
 * Never deletes status=recording (active capture).
 */
export function enforceMeetingCap(dataDir = DATA_DIR): { deleted: string[] } {
  const all = listMeetings(dataDir)
  if (all.length < MAX_MEETINGS) return { deleted: [] }
  const over = all.length - MAX_MEETINGS + 1 // make room for one more create
  // listMeetings sorts newest first — drop from the end (oldest)
  const candidates = [...all]
    .reverse()
    .filter((m) => m.status !== "recording")
  const deleted: string[] = []
  for (const m of candidates) {
    if (deleted.length >= over) break
    if (deleteMeeting(m.id, dataDir)) deleted.push(m.id)
  }
  if (deleted.length) {
    logger.info("meeting.cap_enforced", { deleted: deleted.length, max: MAX_MEETINGS })
  }
  return { deleted }
}

/**
 * P1 CORR-09: boot reconcile — stuck `recording` from a dead process never
 * ends and blocks meeting cap forever. Demote stale recordings to `ready`
 * when process restarts (no live STT session can survive process death).
 */
export function reconcileStaleRecordings(dataDir = DATA_DIR): { demoted: string[] } {
  const demoted: string[] = []
  for (const m of listMeetings(dataDir)) {
    if (m.status !== "recording") continue
    try {
      const full = loadMeeting(m.id, dataDir)
      if (!full || full.status !== "recording") continue
      full.status = "ready"
      full.ended_at = full.ended_at || new Date().toISOString()
      saveMeeting(full, dataDir)
      demoted.push(m.id)
      logger.info("meeting.recording_reconciled", { id: m.id })
    } catch (e: any) {
      logger.warn("meeting.recording_reconcile_failed", {
        id: m.id,
        error: e?.message || String(e),
      })
    }
  }
  return { demoted }
}

export function createMeeting(opts: {
  title?: string
  thread_id?: string | null
  dataDir?: string
}): MeetingSession {
  const dataDir = opts.dataDir ?? DATA_DIR
  enforceMeetingCap(dataDir)
  const id = `mtg_${crypto.randomBytes(8).toString("hex")}`
  const now = new Date().toISOString()
  const session: MeetingSession = {
    id,
    thread_id: opts.thread_id ?? null,
    title: (opts.title && opts.title.trim()) || `会议 ${now.slice(0, 16).replace("T", " ")}`,
    started_at: now,
    ended_at: null,
    status: "draft",
    privacy: {
      stt_engine: "none",
      audio_retained: false,
      retain_until: null,
    },
    diarize: null,
    transcript: [],
    minutes: null,
    error: null,
  }
  saveMeeting(session, dataDir)
  return session
}

export function saveMeeting(session: MeetingSession, dataDir = DATA_DIR): void {
  if (transcriptToText(session.transcript).length > MEETING_MINUTES_MAX_INPUT_CHARS ||
      transcriptToText(session.original_transcript || []).length > MEETING_MINUTES_MAX_INPUT_CHARS) {
    throw new MeetingTranscriptLimitError()
  }
  const dir = resolveContained(session.id, dataDir)
  if (!dir) throw new Error("invalid meeting id")
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  reconcileMinutesSource(session)
  const meta: MeetingMeta = {
    id: session.id,
    thread_id: session.thread_id,
    title: session.title,
    started_at: session.started_at,
    ended_at: session.ended_at,
    status: session.status,
    privacy: session.privacy,
    diarize: session.diarize ?? null,
    error: session.error ?? null,
  }
  writeJsonAtomic(path.join(dir, "meta.json"), meta)
  writeJsonAtomic(path.join(dir, "transcript.json"), session.transcript)
  writeJsonAtomic(path.join(dir, "reference.json"), { notes: session.reference_notes || "", name: session.reference_name || "" })
  writeJsonAtomic(path.join(dir, "original-transcript.json"), session.original_transcript || [])
  if (session.minutes) {
    writeJsonAtomic(path.join(dir, "minutes.json"), session.minutes)
    const mdPath = path.join(dir, "minutes.md")
    fs.writeFileSync(mdPath, session.minutes.raw_md || "", { encoding: "utf8", mode: 0o600 })
  }
}

export function loadMeeting(id: string, dataDir = DATA_DIR): MeetingSession | null {
  const dir = resolveContained(id, dataDir)
  if (!dir || !fs.existsSync(path.join(dir, "meta.json"))) return null
  const meta = readJson<MeetingMeta>(path.join(dir, "meta.json"))
  if (!meta) return null
  const transcript =
    readJson<TranscriptLine[]>(path.join(dir, "transcript.json")) ||
    readJson<TranscriptLine[]>(path.join(dir, "transcript.jsonl")) ||
    []
  const minutes = readJson<MeetingMinutes>(path.join(dir, "minutes.json"))
  const reference = readJson<{ notes?: unknown; name?: unknown }>(path.join(dir, "reference.json"))
  const original = readJson<TranscriptLine[]>(path.join(dir, "original-transcript.json"))
  const session: MeetingSession = {
    ...meta,
    transcript: Array.isArray(transcript) ? transcript : [],
    // Legacy sessions can only recover lines still explicitly marked as raw STT.
    original_transcript: Array.isArray(original) ? original : Array.isArray(transcript) ? transcript.filter(line => line.source === "stt") : [],
    reference_notes: typeof reference?.notes === "string" ? reference.notes : "",
    reference_name: typeof reference?.name === "string" ? reference.name : "",
    minutes: minutes || null,
  }
  reconcileMinutesSource(session)
  return session
}

export function listMeetings(dataDir = DATA_DIR): MeetingMeta[] {
  const root = ensureMeetingsRoot(dataDir)
  const out: MeetingMeta[] = []
  for (const name of fs.readdirSync(root)) {
    const meta = readJson<MeetingMeta>(path.join(root, name, "meta.json"))
    if (meta?.id) out.push(meta)
  }
  out.sort((a, b) => (a.started_at < b.started_at ? 1 : -1))
  return out
}

export function setTranscript(
  id: string,
  lines: TranscriptLine[],
  dataDir = DATA_DIR,
): MeetingSession | null {
  const s = loadMeeting(id, dataDir)
  if (!s) return null
  s.transcript = lines
  // The first bulk STT import initializes raw evidence. Later merged/editor
  // snapshots cannot replace it; live/import utterances arrive through append.
  if (!s.original_transcript?.length) s.original_transcript = lines.filter(line => line.source === "stt").map(line => ({ ...line }))
  if (s.status === "draft" || s.status === "error") s.status = "ready"
  saveMeeting(s, dataDir)
  return s
}

export function setReference(id: string, notes: string, name = "", dataDir = DATA_DIR): MeetingSession | null {
  const session = loadMeeting(id, dataDir)
  if (!session) return null
  session.reference_notes = notes
  session.reference_name = name
  saveMeeting(session, dataDir)
  return session
}

export function appendTranscript(
  id: string,
  line: TranscriptLine,
  dataDir = DATA_DIR,
): MeetingSession | null {
  const s = loadMeeting(id, dataDir)
  if (!s) return null
  if (line.segment_id) {
    // Original STT archive survives replacement of the editable transcript.
    // Replayed ACKs with a complete archive are read-only, including at its cap.
    const archived = (s.original_transcript || []).find(item => item.segment_id === line.segment_id)
    const existing = archived || s.transcript.find(item => item.segment_id === line.segment_id)
    if (existing) {
      if (existing.text !== line.text || existing.source !== line.source || (existing.speaker || "") !== (line.speaker || "")) {
        throw new MeetingTranscriptSegmentCollisionError()
      }
      if (!archived && existing.source === "stt") {
        // transcript.json may have committed before the raw archive write failed.
        // Repair the missing archive entry while leaving the editable draft intact.
        s.original_transcript = [...(s.original_transcript || []), { ...existing }]
        saveMeeting(s, dataDir)
      }
      return s
    }
  }
  s.transcript = [...s.transcript, line]
  if (line.source === "stt") s.original_transcript = [...(s.original_transcript || []), { ...line }]
  if (s.status === "draft") s.status = "recording"
  saveMeeting(s, dataDir)
  return s
}

/** Replace full transcript line list (Mtg2 speaker edits / silence-cut). */
export function replaceTranscript(
  id: string,
  lines: TranscriptLine[],
  dataDir = DATA_DIR,
): MeetingSession | null {
  const s = loadMeeting(id, dataDir)
  if (!s) return null
  s.transcript = Array.isArray(lines) ? lines : []
  if (s.transcript.length > 0 && (s.status === "draft" || s.status === "error")) {
    s.status = "ready"
  }
  saveMeeting(s, dataDir)
  return s
}

/** Persist diarize meta + optional new transcript lines. */
export function setDiarizeResult(
  id: string,
  lines: TranscriptLine[],
  diarize: MeetingDiarizeMeta,
  dataDir = DATA_DIR,
): MeetingSession | null {
  const s = loadMeeting(id, dataDir)
  if (!s) return null
  s.transcript = lines
  s.diarize = diarize
  if (s.status === "draft" || s.status === "error") s.status = "ready"
  saveMeeting(s, dataDir)
  return s
}

export function setMinutes(
  id: string,
  minutes: MeetingMinutes,
  dataDir = DATA_DIR,
): MeetingSession | null {
  const s = loadMeeting(id, dataDir)
  if (!s) return null
  s.minutes = {
    ...minutes,
    source_fingerprint: minutes.source_fingerprint ?? meetingSourceFingerprint(transcriptToText(s.transcript), s.reference_notes, s.reference_name),
    source_transcript: minutes.source_transcript ?? transcriptToText(s.transcript),
  }
  s.status = "done"
  s.ended_at = s.ended_at || new Date().toISOString()
  s.error = null
  saveMeeting(s, dataDir)
  return s
}

export function setMeetingStatus(
  id: string,
  status: MeetingStatus,
  error?: string | null,
  dataDir = DATA_DIR,
): MeetingSession | null {
  const s = loadMeeting(id, dataDir)
  if (!s) return null
  s.status = status
  if (error !== undefined) s.error = error
  if (status === "done" || status === "ready") {
    s.ended_at = s.ended_at || new Date().toISOString()
  }
  saveMeeting(s, dataDir)
  return s
}

/**
 * Mark meeting as live capture (Mtg1).
 * Sets status=recording, stt_engine=local, optional audio retain.
 */
export function startMeetingRecording(
  id: string,
  opts: { audio_retained?: boolean; retain_days?: number } = {},
  dataDir = DATA_DIR,
): MeetingSession | null {
  const s = loadMeeting(id, dataDir)
  if (!s) return null
  if (s.status === "recording") return s
  s.status = "recording"
  s.error = null
  s.ended_at = null
  s.privacy = {
    ...s.privacy,
    stt_engine: "local",
    audio_retained: opts.audio_retained === true,
    retain_until: null,
  }
  if (s.privacy.audio_retained) {
    const days = Math.min(7, Math.max(1, Math.floor(opts.retain_days ?? 7)))
    const until = new Date(Date.now() + days * 24 * 60 * 60 * 1000)
    s.privacy.retain_until = until.toISOString()
  }
  // Ensure audio/ exists only when retain requested (optional durable bucket).
  if (s.privacy.audio_retained) {
    const dir = resolveContained(id, dataDir)
    if (dir) {
      try {
        fs.mkdirSync(path.join(dir, "audio"), { recursive: true, mode: 0o700 })
      } catch {
        /* */
      }
    }
  }
  saveMeeting(s, dataDir)
  return s
}

/**
 * End live capture: status=ready, default delete audio/ when not retained.
 */
export function endMeetingRecording(
  id: string,
  dataDir = DATA_DIR,
): { session: MeetingSession; audioDeleted: boolean } | null {
  const s = loadMeeting(id, dataDir)
  if (!s) return null
  s.status = "ready"
  s.ended_at = new Date().toISOString()
  s.error = null
  saveMeeting(s, dataDir)
  let audioDeleted = false
  if (!s.privacy.audio_retained) {
    audioDeleted = deleteMeetingAudio(id, dataDir)
  }
  const again = loadMeeting(id, dataDir)
  return { session: again || s, audioDeleted }
}

/**
 * Best-effort delete audio/ after end (default policy).
 * Returns true when policy is satisfied: dir removed **or already absent**.
 * Does not distinguish "bytes deleted" vs "never existed" — callers should not
 * treat true as proof of residual content removal.
 */
export function deleteMeetingAudio(id: string, dataDir = DATA_DIR): boolean {
  const dir = resolveContained(id, dataDir)
  if (!dir) return false
  const audio = path.join(dir, "audio")
  try {
    if (fs.existsSync(audio)) {
      fs.rmSync(audio, { recursive: true, force: true })
      return true
    }
    return true
  } catch (e) {
    logger.warn("meeting.audio_delete_failed", {
      id,
      err: e instanceof Error ? e.message : String(e),
    })
    return false
  }
}

/** Test / diagnostics: path to meeting audio dir (contained). */
export function meetingAudioDir(id: string, dataDir = DATA_DIR): string | null {
  const dir = resolveContained(id, dataDir)
  if (!dir) return null
  return path.join(dir, "audio")
}

/**
 * P1 Meeting: purge audio/ when retain_until is past wall clock.
 * Clears audio_retained + retain_until after successful delete.
 * Returns count of meetings whose audio was GC'd.
 */
export function gcExpiredMeetingAudio(
  dataDir = DATA_DIR,
  now: Date = new Date(),
): { purged: number; scanned: number } {
  const metas = listMeetings(dataDir)
  let purged = 0
  let scanned = 0
  const nowMs = now.getTime()
  for (const m of metas) {
    if (!m.privacy?.audio_retained) continue
    const until = m.privacy.retain_until
    if (!until || typeof until !== "string") continue
    scanned++
    const t = Date.parse(until)
    if (!Number.isFinite(t) || t > nowMs) continue
    const ok = deleteMeetingAudio(m.id, dataDir)
    if (!ok) continue
    const full = loadMeeting(m.id, dataDir)
    if (full) {
      full.privacy = {
        ...full.privacy,
        audio_retained: false,
        retain_until: null,
      }
      saveMeeting(full, dataDir)
    }
    purged++
    logger.info("meeting.audio_gc", { id: m.id, retain_until: until })
  }
  return { purged, scanned }
}

export function transcriptToText(lines: TranscriptLine[]): string {
  return lines
    .map((l) => {
      const sp = l.speaker ? `${l.speaker}: ` : ""
      return `${sp}${l.text}`
    })
    .join("\n")
    .trim()
}

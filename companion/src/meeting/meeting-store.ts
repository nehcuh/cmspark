/**
 * MeetingSession disk store — ~/.cmspark-agent/meetings/<id>/
 * SoT: 2026-08-07-meeting-minutes-design.md
 */

import * as fs from "fs"
import * as path from "path"
import * as crypto from "crypto"
import { DATA_DIR } from "../config"
import { logger } from "../logger"

export type TranscriptSource = "stt" | "user_edit" | "paste" | "asr_refiner"

export type TranscriptLine = {
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
}

export type MeetingStatus =
  | "draft"
  | "recording"
  | "ready"
  | "generating"
  | "done"
  | "error"

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
  error?: string | null
}

export type MeetingSession = MeetingMeta & {
  transcript: TranscriptLine[]
  minutes?: MeetingMinutes | null
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

export function createMeeting(opts: {
  title?: string
  thread_id?: string | null
  dataDir?: string
}): MeetingSession {
  const dataDir = opts.dataDir ?? DATA_DIR
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
    transcript: [],
    minutes: null,
    error: null,
  }
  saveMeeting(session, dataDir)
  return session
}

export function saveMeeting(session: MeetingSession, dataDir = DATA_DIR): void {
  const dir = resolveContained(session.id, dataDir)
  if (!dir) throw new Error("invalid meeting id")
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  const meta: MeetingMeta = {
    id: session.id,
    thread_id: session.thread_id,
    title: session.title,
    started_at: session.started_at,
    ended_at: session.ended_at,
    status: session.status,
    privacy: session.privacy,
    error: session.error ?? null,
  }
  writeJsonAtomic(path.join(dir, "meta.json"), meta)
  writeJsonAtomic(path.join(dir, "transcript.json"), session.transcript)
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
  return {
    ...meta,
    transcript: Array.isArray(transcript) ? transcript : [],
    minutes: minutes || null,
  }
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
  if (s.status === "draft" || s.status === "error") s.status = "ready"
  saveMeeting(s, dataDir)
  return s
}

export function appendTranscript(
  id: string,
  line: TranscriptLine,
  dataDir = DATA_DIR,
): MeetingSession | null {
  const s = loadMeeting(id, dataDir)
  if (!s) return null
  s.transcript = [...s.transcript, line]
  if (s.status === "draft") s.status = "recording"
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
  s.minutes = minutes
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

export function transcriptToText(lines: TranscriptLine[]): string {
  return lines
    .map((l) => {
      const sp = l.speaker ? `${l.speaker}: ` : ""
      return `${sp}${l.text}`
    })
    .join("\n")
    .trim()
}

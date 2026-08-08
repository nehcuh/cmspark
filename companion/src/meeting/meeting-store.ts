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
  writeJsonAtomic(path.join(dir, "transcript.jsonl"), session.transcript)
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
    readJson<TranscriptLine[]>(path.join(dir, "transcript.jsonl")) || []
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

/** Best-effort delete audio/ after successful STT (default policy). */
export function deleteMeetingAudio(id: string, dataDir = DATA_DIR): void {
  const dir = resolveContained(id, dataDir)
  if (!dir) return
  const audio = path.join(dir, "audio")
  try {
    if (fs.existsSync(audio)) {
      fs.rmSync(audio, { recursive: true, force: true })
    }
  } catch (e) {
    logger.warn("meeting.audio_delete_failed", {
      id,
      err: e instanceof Error ? e.message : String(e),
    })
  }
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

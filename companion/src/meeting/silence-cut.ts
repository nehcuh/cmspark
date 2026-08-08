/**
 * Mtg2 silence-cut + speaker parse (heuristic only — NOT auto diarize).
 * SoT: 2026-08-07-meeting-minutes-design.md §6.3 Mtg2
 */

import type { TranscriptLine, TranscriptSource } from "./meeting-store"

/** Gap between timed segments (seconds) treated as a "silence cut". */
export const SILENCE_GAP_SEC = 1.5

/** Soft max chars per line before sentence split (paste / STT blob). */
export const SOFT_LINE_CHARS = 280

const SPEAKER_PREFIX = /^([^\n:]{1,32})\s*[:：]\s*(.+)$/u

export type ParsedSpeakerLine = {
  speaker?: string
  text: string
}

/**
 * Parse "Name: utterance" / "Name：utterance" prefixes.
 * Rejects pure times like "12:30" as speakers.
 */
export function parseSpeakerPrefix(raw: string): ParsedSpeakerLine {
  const t = raw.trim()
  if (!t) return { text: "" }
  const m = t.match(SPEAKER_PREFIX)
  if (!m) return { text: t }
  const name = m[1]!.trim()
  const rest = m[2]!.trim()
  if (!rest) return { text: t }
  // Reject clock-like "12:30 left"
  if (/^\d{1,2}$/.test(name) && /^\d{2}/.test(rest)) return { text: t }
  if (/^\d+$/.test(name)) return { text: t }
  return { speaker: name.slice(0, 32), text: rest }
}

/**
 * Silence-cut / paragraph split for untimed text.
 * 1) blank-line paragraphs
 * 2) within long paragraphs, split on 。！？.!?;； when over SOFT_LINE_CHARS
 * 3) parse optional speaker prefixes
 */
export function silenceCutText(
  text: string,
  source: TranscriptSource = "paste",
): TranscriptLine[] {
  const raw = (text || "").replace(/\r\n/g, "\n").trim()
  if (!raw) return []

  const paragraphs = raw
    .split(/\n\s*\n+/)
    .map((p) => p.trim())
    .filter(Boolean)

  const chunks: string[] = []
  for (const p of paragraphs) {
    if (p.length <= SOFT_LINE_CHARS) {
      // also split single newlines that look like turns
      const lines = p.split(/\n+/).map((l) => l.trim()).filter(Boolean)
      if (lines.length > 1) chunks.push(...lines)
      else chunks.push(p)
      continue
    }
    // sentence-ish split
    const parts = p.split(/(?<=[。！？.!?；;])\s+/u).map((s) => s.trim()).filter(Boolean)
    if (parts.length <= 1) {
      chunks.push(p)
    } else {
      let buf = ""
      for (const s of parts) {
        if (!buf) {
          buf = s
          continue
        }
        if (buf.length + s.length + 1 <= SOFT_LINE_CHARS) {
          buf = `${buf}${s}`
        } else {
          chunks.push(buf)
          buf = s
        }
      }
      if (buf) chunks.push(buf)
    }
  }

  return chunks.map((c) => {
    const parsed = parseSpeakerPrefix(c)
    const line: TranscriptLine = {
      text: parsed.text,
      source,
    }
    if (parsed.speaker) line.speaker = parsed.speaker
    return line
  })
}

/**
 * Re-cut timed lines when inter-line gap ≥ SILENCE_GAP_SEC.
 * Does not invent speakers; preserves existing speaker labels.
 */
export function silenceCutTimedLines(lines: TranscriptLine[]): TranscriptLine[] {
  if (!Array.isArray(lines) || lines.length === 0) return []
  const out: TranscriptLine[] = []
  for (let i = 0; i < lines.length; i++) {
    const cur = lines[i]!
    if (i === 0) {
      out.push({ ...cur })
      continue
    }
    const prev = lines[i - 1]!
    const gap =
      typeof cur.t0 === "number" && typeof prev.t1 === "number"
        ? cur.t0 - prev.t1
        : null
    if (gap != null && gap >= SILENCE_GAP_SEC) {
      out.push({ ...cur })
      continue
    }
    // Merge adjacent untimed / small-gap into previous only if same speaker and short
    const last = out[out.length - 1]!
    const sameSpeaker = (last.speaker || "") === (cur.speaker || "")
    if (
      sameSpeaker &&
      gap != null &&
      gap < SILENCE_GAP_SEC &&
      (last.text.length + cur.text.length) < SOFT_LINE_CHARS
    ) {
      last.text = `${last.text}${last.text.endsWith(" ") || cur.text.startsWith(" ") ? "" : " "}${cur.text}`.trim()
      if (typeof cur.t1 === "number") last.t1 = cur.t1
      continue
    }
    out.push({ ...cur })
  }
  return out
}

/** Apply silence-cut to existing lines (untimed → text cut; timed → gap cut). */
export function applySilenceCut(lines: TranscriptLine[]): TranscriptLine[] {
  if (!lines.length) return []
  const hasTiming = lines.some((l) => typeof l.t0 === "number" || typeof l.t1 === "number")
  if (hasTiming) return silenceCutTimedLines(lines)
  const blob = lines
    .map((l) => (l.speaker ? `${l.speaker}: ${l.text}` : l.text))
    .join("\n\n")
  const source = lines[0]?.source || "user_edit"
  return silenceCutText(blob, source)
}

/** Format lines for editable textarea (speaker: text). */
export function formatTranscriptLines(lines: TranscriptLine[]): string {
  return lines
    .map((l) => {
      const sp = l.speaker?.trim()
      return sp ? `${sp}: ${l.text}` : l.text
    })
    .join("\n\n")
    .trim()
}

/** Apply speaker labels by line index (manual Mtg2 labeling). */
export function applySpeakersByIndex(
  lines: TranscriptLine[],
  assignments: Array<{ index: number; speaker: string | null }>,
): TranscriptLine[] {
  const next = lines.map((l) => ({ ...l }))
  for (const a of assignments) {
    if (!Number.isInteger(a.index) || a.index < 0 || a.index >= next.length) continue
    const sp = a.speaker == null ? "" : String(a.speaker).trim().slice(0, 32)
    if (!sp) {
      delete next[a.index]!.speaker
    } else {
      next[a.index]!.speaker = sp
    }
  }
  return next
}

/** Bulk-set speaker on all lines (e.g. label all as 「我」). */
export function bulkSetSpeaker(lines: TranscriptLine[], speaker: string | null): TranscriptLine[] {
  const sp = speaker == null ? "" : String(speaker).trim().slice(0, 32)
  return lines.map((l) => {
    const copy = { ...l }
    if (!sp) delete copy.speaker
    else copy.speaker = sp
    return copy
  })
}

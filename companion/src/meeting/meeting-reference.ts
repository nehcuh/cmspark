import path from "node:path"
import { parseFile, PARSE_FILE_MAX_BYTES } from "../file-parser"
import type { MeetingMinutes } from "./meeting-store"

export const MEETING_REFERENCE_MAX_CHARS = 100_000
export const MEETING_REFERENCE_MAX_NAME_CHARS = 255
/** Base64 plus JSON must fit the existing 10MiB WebSocket frame limit. */
export const MEETING_REFERENCE_MAX_FILE_BYTES = Math.min(PARSE_FILE_MAX_BYTES, 7 * 1024 * 1024)
const REFERENCE_MIMES: Record<string, string> = {
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}

type ReferenceImportResult =
  | { ok: true; reference: { name: string; text: string } }
  | { ok: false; code: string; message: string }

/** Parse explicitly uploaded material only; no server path or knowledge lookup. */
export async function importMeetingReference(file: unknown): Promise<ReferenceImportResult> {
  const fail = (code: string, message: string): ReferenceImportResult => ({ ok: false, code, message })
  if (!file || typeof file !== "object") return fail("invalid_reference_file", "请选择 Word、Markdown 或文本文件")
  const input = file as Record<string, unknown>
  if (typeof input.name !== "string" || !input.name || input.name.length > MEETING_REFERENCE_MAX_NAME_CHARS || input.name.includes("\0")) {
    return fail("invalid_reference_file", "参考文件名无效或过长")
  }
  const name = path.basename(path.win32.basename(input.name))
  const mime = REFERENCE_MIMES[path.extname(name).toLowerCase()]
  if (!mime) return fail("unsupported_reference_type", "参考笔记仅支持 .docx、.md、.txt")
  if (typeof input.content !== "string" || !input.content) return fail("invalid_reference_file", "参考文件内容为空")
  if (input.content.length > Math.ceil(MEETING_REFERENCE_MAX_FILE_BYTES / 3) * 4) return fail("reference_file_too_large", "参考文件不能超过 7MB")
  if (input.content.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(input.content)) {
    return fail("invalid_reference_file", "参考文件编码无效")
  }
  const bytes = Buffer.from(input.content, "base64")
  if (bytes.length > MEETING_REFERENCE_MAX_FILE_BYTES) return fail("reference_file_too_large", "参考文件不能超过 7MB")
  if (bytes.toString("base64") !== input.content) return fail("invalid_reference_file", "参考文件编码无效")
  if (mime.startsWith("text/")) {
    try { new TextDecoder("utf-8", { fatal: true }).decode(bytes) } catch {
      return fail("reference_parse_failed", "文本文件需使用 UTF-8 编码")
    }
    if (bytes.includes(0)) return fail("reference_parse_failed", "文件不是有效的文本笔记")
  }
  // Canonical MIME comes from the allowlisted extension, never the client hint.
  const parsed = await parseFile(bytes, name, mime)
  if (!parsed.success) return fail("reference_parse_failed", "参考文件解析失败，请检查文件或另存为 .docx/.md/.txt")
  const text = parsed.text.trim()
  if (!text) return fail("empty_reference", "参考文件中没有可读取的文字")
  if (text.length > MEETING_REFERENCE_MAX_CHARS) return fail("reference_too_long", "参考笔记不能超过 100000 字，请精简后重试")
  return { ok: true, reference: { name, text } }
}

type ReferenceMinutes = Pick<MeetingMinutes, "raw_md" | "corrected_transcript" | "corrections" | "reference_supplements" | "conflicts">

/** Check provenance before constructing a corrected copy; never mutate raw input. */
export function parseReferenceMinutes(output: string, raw: string, notes: string): ReferenceMinutes | null {
  let value: unknown
  const text = output.trim().replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i, "$1")
  try { value = JSON.parse(text) } catch { return null }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const result = value as Record<string, unknown>
  if (typeof result.minutes_md !== "string" || !result.minutes_md.trim()) return null
  if (![result.corrections, result.reference_supplements, result.conflicts].every(v => Array.isArray(v) && v.length <= 100)) return null
  const hasText = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0
  const corrections: NonNullable<MeetingMinutes["corrections"]> = []
  const replacements: Array<{ start: number; end: number; replacement: string }> = []
  for (const item of result.corrections as unknown[]) {
    if (!item || typeof item !== "object") return null
    const c = item as Record<string, unknown>
    if (![c.original, c.replacement, c.reference_excerpt, c.reason].every(hasText)) return null
    const { original, replacement, reference_excerpt, reason } = c as NonNullable<MeetingMinutes["corrections"]>[number]
    const start = raw.indexOf(original)
    if (start < 0 || raw.indexOf(original, start + 1) >= 0 || original === replacement) return null
    if (!notes.includes(reference_excerpt) || !reference_excerpt.includes(replacement)) return null
    const end = start + original.length
    if (replacements.some(r => start < r.end && end > r.start)) return null
    replacements.push({ start, end, replacement })
    corrections.push({ original, replacement, reference_excerpt, reason })
  }
  const supplements: NonNullable<MeetingMinutes["reference_supplements"]> = []
  for (const item of result.reference_supplements as unknown[]) {
    if (!item || typeof item !== "object") return null
    const s = item as Record<string, unknown>
    if (!hasText(s.reference_excerpt) || !hasText(s.reason) || !notes.includes(s.reference_excerpt)) return null
    supplements.push({ reference_excerpt: s.reference_excerpt, reason: s.reason })
  }
  const conflicts: NonNullable<MeetingMinutes["conflicts"]> = []
  for (const item of result.conflicts as unknown[]) {
    if (!item || typeof item !== "object") return null
    const c = item as Record<string, unknown>
    if (!hasText(c.transcript_excerpt) || !hasText(c.reference_excerpt) || !hasText(c.reason)) return null
    if (!raw.includes(c.transcript_excerpt) || !notes.includes(c.reference_excerpt)) return null
    conflicts.push({ transcript_excerpt: c.transcript_excerpt, reference_excerpt: c.reference_excerpt, reason: c.reason })
  }
  let corrected = raw
  for (const replacement of replacements.sort((a, b) => b.start - a.start)) {
    corrected = corrected.slice(0, replacement.start) + replacement.replacement + corrected.slice(replacement.end)
  }
  return { raw_md: result.minutes_md.trim(), corrected_transcript: corrected, corrections, reference_supplements: supplements, conflicts }
}

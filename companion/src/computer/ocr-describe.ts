// Format host OCR word boxes into LLM-facing describe text.
//
// Product note (k47c0u 2026-08-01): joining words with a single space destroyed
// reading order on terminal/dense UIs, so the agent fell back to shell_exec +
// ad-hoc Vision scripts. Spatial line grouping keeps the same Vision engine
// (cuOCR / VNRecognizeTextRequest) while restoring line structure.

import type { OcrWord } from "./types"

/** Soft cap so tool results stay bounded; full text is still evidence-backed. */
export const DESCRIBE_TEXT_MAX_CHARS = 12_000

export interface FormatOcrDescribeOptions {
  /** Max characters of body text (before truncation marker). Default 12000. */
  maxChars?: number
  /**
   * Vertical tolerance as a fraction of median word height for same-line
   * grouping. Default 0.55 (words whose mid-Y is within ~0.55×medH of the
   * line's mid-Y stay on one line).
   */
  lineYFactor?: number
}

/**
 * Sort by reading order (top→bottom, left→right), group into lines by
 * mid-Y proximity, join words with spaces and lines with newlines.
 * Truncates with an explicit marker when over maxChars.
 */
export function formatOcrWordsAsDescribeText(
  words: readonly OcrWord[],
  opts: FormatOcrDescribeOptions = {},
): string {
  const maxChars = opts.maxChars ?? DESCRIBE_TEXT_MAX_CHARS
  const lineYFactor = opts.lineYFactor ?? 0.55

  if (!words.length) return ""

  const cleaned = words
    .filter((w) => typeof w.text === "string" && w.text.length > 0)
    .map((w) => ({
      text: w.text,
      x: Number(w.x) || 0,
      y: Number(w.y) || 0,
      w: Math.max(1, Number(w.w) || 1),
      h: Math.max(1, Number(w.h) || 1),
      midY: (Number(w.y) || 0) + Math.max(1, Number(w.h) || 1) / 2,
    }))

  if (!cleaned.length) return ""

  cleaned.sort((a, b) => (a.midY !== b.midY ? a.midY - b.midY : a.x - b.x))

  const heights = cleaned.map((c) => c.h).sort((a, b) => a - b)
  const medH = heights[Math.floor(heights.length / 2)] || 12
  const yTol = Math.max(4, medH * lineYFactor)

  type Line = { midY: number; items: typeof cleaned }
  const lines: Line[] = []
  for (const w of cleaned) {
    const last = lines[lines.length - 1]
    if (last && Math.abs(w.midY - last.midY) <= yTol) {
      last.items.push(w)
      // Keep line mid as running mean so long wraps stay stable.
      last.midY = (last.midY * (last.items.length - 1) + w.midY) / last.items.length
    } else {
      lines.push({ midY: w.midY, items: [w] })
    }
  }

  for (const line of lines) {
    line.items.sort((a, b) => a.x - b.x)
  }

  const body = lines.map((line) => line.items.map((i) => i.text).join(" ")).join("\n")
  if (body.length <= maxChars) return body

  const cut = body.slice(0, maxChars)
  const lastNl = cut.lastIndexOf("\n")
  const kept = lastNl > maxChars * 0.6 ? cut.slice(0, lastNl) : cut
  return `${kept}\n…[describe truncated at ${maxChars} chars; use screenshot for visual layout]`
}

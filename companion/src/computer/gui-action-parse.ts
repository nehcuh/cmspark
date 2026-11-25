// Sanitize the optional model explanation for the suggested-click preview.
import { sanitizeComputerCaption } from "./preview"

/** Max thought chars shown on experimental re-L2 (after sanitize). */
export const MAX_EXPERIMENTAL_THOUGHT_CAPTION = 160

/**
 * Extract a short Thought / Reflection / Action_Summary from VLM raw text.
 * Returns null when absent or empty after sanitize.
 */
export function extractGuiThought(raw: string | undefined | null): string | null {
  if (raw == null) return null
  const text = String(raw)
  if (!text.trim()) return null

  // Prefer explicit labels (UI-TARS COMPUTER_USE style).
  const labeled =
    text.match(/^\s*Thought:\s*(.+?)(?=\n\s*(?:Action|Reflection|Action_Summary):|\n\n|$)/is) ||
    text.match(/^\s*Reflection:\s*(.+?)(?=\n\s*(?:Action|Thought|Action_Summary):|\n\n|$)/is) ||
    text.match(/^\s*Action_Summary:\s*(.+?)(?=\n\s*(?:Action|Thought):|\n\n|$)/is)

  let candidate = labeled?.[1]?.trim() ?? ""

  // If the whole reply is prose without Action:, treat a single short line as thought.
  if (!candidate) {
    if (/\bAction\s*:/i.test(text)) return null
    const oneLine = text.replace(/\s+/g, " ").trim()
    if (oneLine.length > 0 && oneLine.length <= MAX_EXPERIMENTAL_THOUGHT_CAPTION && !looksLikeOnlyCoords(oneLine)) {
      candidate = oneLine
    }
  }

  if (!candidate) return null
  const cleaned = sanitizeComputerCaption(candidate)
  if (!cleaned) return null
  if (cleaned.length <= MAX_EXPERIMENTAL_THOUGHT_CAPTION) return cleaned
  return cleaned.slice(0, MAX_EXPERIMENTAL_THOUGHT_CAPTION - 1).trimEnd() + "…"
}

function looksLikeOnlyCoords(s: string): boolean {
  return (
    /^\{?\s*"?x"?\s*[:=]/i.test(s) ||
    /^[\[(]\s*\d/.test(s) ||
    /^\d+\s*[,，]\s*\d+/.test(s) ||
    /\bclick\s*\(/i.test(s)
  )
}

/**
 * Build experimental re-L2 caption body (without outer framing).
 * Always includes anchor + client coords; optional thought suffix.
 */
export function formatExperimentalSuggestionCaption(args: {
  target: string
  clientX: number
  clientY: number
  thought?: string | null
}): string {
  const target = sanitizeComputerCaption(args.target)
  const base = `主模型建议点击「${target}」于客户端坐标 (${args.clientX}, ${args.clientY})。请核对预览中的标记位置`
  const thought = args.thought ? sanitizeComputerCaption(args.thought) : ""
  if (!thought) {
    return `${base}。批准以执行此次点击，拒绝以放弃该建议。`
  }
  const clipped =
    thought.length <= MAX_EXPERIMENTAL_THOUGHT_CAPTION
      ? thought
      : thought.slice(0, MAX_EXPERIMENTAL_THOUGHT_CAPTION - 1).trimEnd() + "…"
  return `${base}。模型思考：${clipped}。批准以执行此次点击，拒绝以放弃该建议。`
}

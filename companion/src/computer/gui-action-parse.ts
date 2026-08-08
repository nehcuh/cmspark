// UI-TARS–inspired experimental raw parsing (Path C absorption).
//
// Pure helpers for free-text VLM locate output:
//   - extract Thought / Reflection snippets for human re-L2 captions
//   - recover click points from JSON, (x,y), and UI-TARS-like Action DSL
//
// Coordinate policy stays L-QW-3: clamp to image pixels only — never
// auto-rescale 0–1000 relative spaces (see qwen-vl-coords / worker).
// Parse failures return null; callers keep existing fail-closed paths.
//
// Attribution: action string shapes inspired by Apache-2.0 UI-TARS
// (bytedance/UI-TARS codes/ui_tars/*); no large code copy.

import { normalizeQwenVlPoint } from "./qwen-vl-coords"
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
 * Parse a click point from experimental VLM raw text.
 * Supports JSON, (x,y), "x, y", and UI-TARS-like click/start_box forms.
 * Values are clamped to image pixel bounds (no relative rescale).
 */
export function parseGuiClickPoint(
  raw: string | undefined | null,
  width: number,
  height: number,
): { x: number; y: number } | null {
  if (raw == null || !(width > 0) || !(height > 0)) return null
  const text = String(raw).trim()
  if (!text) return null

  // JSON { "x": n, "y": n }
  {
    const m = text.match(
      /\{\s*"?x"?\s*[:=]\s*([0-9]+(?:\.[0-9]+)?)\s*,\s*"?y"?\s*[:=]\s*([0-9]+(?:\.[0-9]+)?)/i,
    )
    if (m) return normalizeQwenVlPoint(Number(m[1]), Number(m[2]), width, height)
  }

  // UI-TARS-like: click(point='x y') / start_box='(x,y)' / start_box='(x1,y1,x2,y2)'
  // Separators may be spaces and/or commas (real UI-TARS uses commas in boxes).
  {
    const m = text.match(
      /(?:start_box|end_box|point|start_point|end_point)\s*=\s*['"]?\(?\s*([0-9]+(?:\.[0-9]+)?)\s*[, ]\s*([0-9]+(?:\.[0-9]+)?)(?:\s*[, ]\s*([0-9]+(?:\.[0-9]+)?)\s*[, ]\s*([0-9]+(?:\.[0-9]+)?))?\)?['"]?/i,
    )
    if (m) {
      const a = Number(m[1])
      const b = Number(m[2])
      if (m[3] != null && m[4] != null) {
        const c = Number(m[3])
        const d = Number(m[4])
        // box center
        return normalizeQwenVlPoint((a + c) / 2, (b + d) / 2, width, height)
      }
      return normalizeQwenVlPoint(a, b, width, height)
    }
  }

  // bracket form [x, y] or (x, y)
  {
    const m = text.match(/[\[(]\s*([0-9]+(?:\.[0-9]+)?)\s*,\s*([0-9]+(?:\.[0-9]+)?)\s*[\])]/)
    if (m) return normalizeQwenVlPoint(Number(m[1]), Number(m[2]), width, height)
  }

  // bare "x, y" near click/point/坐标
  {
    const m = text.match(
      /(?:click|point|坐标|位置)[^\d]{0,12}([0-9]+(?:\.[0-9]+)?)\s*[,，]\s*([0-9]+(?:\.[0-9]+)?)/i,
    )
    if (m) return normalizeQwenVlPoint(Number(m[1]), Number(m[2]), width, height)
  }

  // last-resort: two integers only with click/point context (avoid "meeting 10 30")
  {
    const m = text.match(
      /(?:click|point|坐标|位置|box)[^\d]{0,24}([0-9]{1,5})\s+([0-9]{1,5})(?:\s|$|[)'"])/i,
    )
    if (m) return normalizeQwenVlPoint(Number(m[1]), Number(m[2]), width, height)
  }

  return null
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
  // Keep the Qwen3-VL product contract string (executor G4 tests + user-facing
  // honesty). Generic "本地视觉定位" is reserved for a future multi-model slot.
  const base = `实验层建议（Qwen3-VL 本地模型，未校准，可能完全错误）：建议点击「${target}」于客户端坐标 (${args.clientX}, ${args.clientY})`
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

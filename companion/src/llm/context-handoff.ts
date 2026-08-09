// H1 ThreadHandoff — structured session working memory for runtime context budget.
// Spec: docs/superpowers/plans/2026-08-07-wave-b-h1-thread-handoff.md
// Distinct from Digest / Export / M2 prose bullets.

import { llmExtract, type LlmExtractConfig } from "./llm-extract"
import {
  buildRedactedTranscript,
  shortSha256,
  type CompactResult,
} from "./context-budget"
import type { CanonicalChatMessage } from "./provider"

export const HANDOFF_CAPS = {
  goals: { max: 5, len: 120 },
  decisions: { max: 8, len: 160 },
  constraints: { max: 8, len: 120 },
  open_todos: { max: 8, len: 120 },
  artifacts: { max: 8, len: 80 },
} as const

export type HandoffField = keyof typeof HANDOFF_CAPS

/** Session-end style hot core (runtime request path only). */
export interface ThreadHandoff {
  updated_at: string
  goals: string[]
  decisions: string[]
  constraints: string[]
  open_todos: string[]
  artifacts: string[]
}

/** UI / format labels (zh). */
export const HANDOFF_LABELS_ZH: Record<HandoffField, string> = {
  goals: "目标",
  decisions: "决策",
  constraints: "约束",
  open_todos: "待办",
  artifacts: "产物",
}

/** Format priority when fitting ≤ maxChars (drop later sections first). */
const FORMAT_ORDER: HandoffField[] = [
  "goals",
  "constraints",
  "decisions",
  "open_todos",
  "artifacts",
]

const SECRET_LINE_RE =
  /\b(sk-[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._\-]+|-----BEGIN [A-Z ]+PRIVATE KEY-----)/i

const MAX_NOTICE_CHARS = 2000
const REASONING_SLICE_CHAR_CAP = 4500 // ~1500 tok rough CJK-aware budget

function scrubLine(s: string): string | null {
  let t = String(s || "")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
    .replace(/\s+/g, " ")
    .trim()
  if (!t) return null
  if (SECRET_LINE_RE.test(t)) return "[redacted]"
  return t
}

function capList(raw: unknown, max: number, len: number): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const item of raw) {
    const line = scrubLine(String(item ?? ""))
    if (!line) continue
    out.push(line.slice(0, len))
    if (out.length >= max) break
  }
  return out
}

/** Sanitize / normalize handoff; null if empty of all lists. */
export function sanitizeThreadHandoff(raw: unknown): ThreadHandoff | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  const handoff: ThreadHandoff = {
    updated_at:
      typeof o.updated_at === "string" && o.updated_at.trim()
        ? o.updated_at.trim()
        : new Date().toISOString(),
    goals: capList(o.goals, HANDOFF_CAPS.goals.max, HANDOFF_CAPS.goals.len),
    decisions: capList(o.decisions, HANDOFF_CAPS.decisions.max, HANDOFF_CAPS.decisions.len),
    constraints: capList(
      o.constraints,
      HANDOFF_CAPS.constraints.max,
      HANDOFF_CAPS.constraints.len,
    ),
    open_todos: capList(o.open_todos, HANDOFF_CAPS.open_todos.max, HANDOFF_CAPS.open_todos.len),
    artifacts: capList(o.artifacts, HANDOFF_CAPS.artifacts.max, HANDOFF_CAPS.artifacts.len),
  }
  const total =
    handoff.goals.length +
    handoff.decisions.length +
    handoff.constraints.length +
    handoff.open_todos.length +
    handoff.artifacts.length
  if (total === 0) return null
  return handoff
}

/**
 * Labeled bullets for notice / chip.
 * Overflow policy (plan N1): keep FORMAT_ORDER priority; drop later sections to fit maxChars.
 */
export function formatHandoffForNotice(
  handoff: ThreadHandoff,
  maxChars: number = MAX_NOTICE_CHARS,
): string {
  const sections: string[] = []
  for (const field of FORMAT_ORDER) {
    const items = handoff[field]
    if (!items.length) continue
    const label = HANDOFF_LABELS_ZH[field]
    const block = [`【${label}】`, ...items.map((x) => `- ${x}`)].join("\n")
    const trial = sections.length ? sections.join("\n") + "\n" + block : block
    if (trial.length > maxChars) {
      if (sections.length === 0) {
        // First section alone too long — hard slice
        return block.slice(0, maxChars)
      }
      break
    }
    sections.push(block)
  }
  return sections.join("\n").slice(0, maxChars)
}

export function serializeHandoffForHash(handoff: ThreadHandoff): string {
  return JSON.stringify({
    goals: handoff.goals,
    decisions: handoff.decisions,
    constraints: handoff.constraints,
    open_todos: handoff.open_todos,
    artifacts: handoff.artifacts,
  })
}

export const H1_HANDOFF_SYSTEM = `You maintain a compact structured working memory for an AI browser agent after older turns are dropped.
Output ONE JSON object only (no markdown fence, no preamble):
{"goals":[],"decisions":[],"constraints":[],"open_todos":[],"artifacts":[]}

Rules:
- Merge PRIOR_HANDOFF with NEW_DROPPED facts; drop stale completed todos; keep hard constraints.
- Same language as content (Chinese if Chinese).
- Caps: goals≤5 (≤120 chars each), decisions≤8 (≤160), constraints≤8 (≤120), open_todos≤8 (≤120), artifacts≤8 (≤80).
- decisions may include a short why; artifacts = file/URL/tab names only.
- NEVER reproduce secrets, API keys, cookies, passwords, tokens, shell secrets, or full code dumps.
- Prefer user constraints + tool outcomes over speculative reasoning slices.
- If nothing useful, return empty arrays.`

/** Pure parse path (exported for unit tests / dual nit). */
export function parseHandoffJson(raw: string): ThreadHandoff | null {
  let text = (raw || "").trim()
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) text = fence[1].trim()
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start < 0 || end <= start) return null
  try {
    const obj = JSON.parse(text.slice(start, end + 1))
    return sanitizeThreadHandoff({
      ...obj,
      updated_at: new Date().toISOString(),
    })
  } catch {
    return null
  }
}

/**
 * Collect optional reasoning slices from dropped assistant messages.
 * Scrub secrets; cap total length. Never used as notice body.
 */
export function collectReasoningSlices(
  messages: CanonicalChatMessage[],
  charCap: number = REASONING_SLICE_CHAR_CAP,
): string {
  const parts: string[] = []
  let used = 0
  for (const m of messages) {
    if (m.role !== "assistant") continue
    const r =
      typeof (m as { reasoning_content?: string }).reasoning_content === "string"
        ? (m as { reasoning_content?: string }).reasoning_content!
        : ""
    if (!r.trim()) continue
    let slice = r
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
      .replace(
        /\b(sk-[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._\-]+|-----BEGIN [A-Z ]+PRIVATE KEY-----)/gi,
        "[redacted-secret]",
      )
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 800)
    if (!slice) continue
    if (used + slice.length > charCap) {
      slice = slice.slice(0, Math.max(0, charCap - used))
      if (!slice) break
      parts.push(slice)
      break
    }
    parts.push(slice)
    used += slice.length
  }
  return parts.join("\n---\n")
}

export type H1GenerateResult =
  | {
      ok: true
      handoff: ThreadHandoff
      sha256: string
      bytes: number
      formatted: string
    }
  | {
      ok: false
      error: string
      /** Fast-fail (parse/empty) vs slow (timeout/abort) — adapter may skip M2 on slow. */
      slow?: boolean
    }

/**
 * Generate anchored H1 handoff from dropped messages + prior handoff.
 */
export async function generateThreadHandoff(opts: {
  droppedMessages: CanonicalChatMessage[]
  priorHandoff?: ThreadHandoff | null
  config: LlmExtractConfig
  signal?: AbortSignal
  includeReasoning?: boolean
}): Promise<H1GenerateResult> {
  const { droppedMessages, priorHandoff, config, includeReasoning = true } = opts
  if (!droppedMessages.length) {
    return { ok: false, error: "empty" }
  }
  if (!config.api_key) {
    return { ok: false, error: "no_api_key" }
  }

  const transcript = buildRedactedTranscript(droppedMessages, 2500)
  if (!transcript.trim()) {
    return { ok: false, error: "empty_transcript" }
  }

  const prior = priorHandoff ? sanitizeThreadHandoff(priorHandoff) : null
  const reasoning = includeReasoning
    ? collectReasoningSlices(droppedMessages)
    : ""

  const userContent = [
    "PRIOR_HANDOFF_JSON:",
    prior ? JSON.stringify(prior) : "null",
    "",
    "NEW_DROPPED_TRANSCRIPT:",
    transcript,
    reasoning
      ? `\nOPTIONAL_REASONING_SLICES (hints only; prefer final+tools):\n${reasoning}`
      : "",
  ].join("\n")

  try {
    const raw = await llmExtract({
      systemPrompt: H1_HANDOFF_SYSTEM,
      userContent,
      config,
      temperatureCap: 0.2,
      timeout: 45_000,
      signal: opts.signal,
    })
    const handoff = parseHandoffJson(raw)
    if (!handoff) {
      return { ok: false, error: "parse_empty" }
    }
    const ser = serializeHandoffForHash(handoff)
    const formatted = formatHandoffForNotice(handoff)
    return {
      ok: true,
      handoff,
      sha256: shortSha256(ser),
      bytes: Buffer.byteLength(ser, "utf8"),
      formatted,
    }
  } catch (e: any) {
    const msg = e?.message || String(e)
    const slow = /timeout|aborted|AbortError|ETIMEDOUT/i.test(msg)
    return { ok: false, error: msg, slow }
  }
}

/** Re-export shouldRun gate: H1 uses same threshold as M2. */
export function shouldRunH1(
  compact: CompactResult,
  m2Enabled: boolean,
  phase: "pre_loop" | "mid_loop" = "pre_loop",
): boolean {
  if (m2Enabled !== true || !compact.compacted) return false
  if (phase === "mid_loop") return false
  const droppedTok = Math.max(0, compact.tokensBefore - compact.tokensAfter)
  return compact.droppedMessages.length >= 3 || droppedTok >= 500
}

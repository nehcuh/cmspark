// H1 ThreadHandoff — structured session working memory for runtime context budget.
// Spec: docs/superpowers/plans/2026-08-07-wave-b-h1-thread-handoff.md
// Distinct from Digest / Export / M2 prose bullets.

import { llmExtract, type LlmExtractConfig } from "./llm-extract"
import {
  buildRedactedTranscript,
  shortSha256,
} from "./context-budget"
import type { CanonicalChatMessage } from "./provider"

import {
  formatHandoffForNotice,
  parseHandoffJson,
  sanitizeThreadHandoff,
  serializeHandoffForHash,
  type ThreadHandoff,
} from "./context-handoff"

const REASONING_SLICE_CHAR_CAP = 4500 // ~1500 tok rough CJK-aware budget

export const H1_HANDOFF_SYSTEM = `You maintain a compact structured working memory for an AI browser agent after older turns are dropped.
Output ONE JSON object only (no markdown fence, no preamble):
{"goals":[],"decisions":[],"constraints":[],"open_todos":[],"artifacts":[]}

Rules:
- Merge PRIOR_HANDOFF with NEW_DROPPED facts; drop stale completed todos; keep hard constraints.
- Same language as content (Chinese if Chinese).
- Caps: goals≤5 (≤120 chars each), decisions≤8 (≤160), constraints≤8 (≤120), open_todos≤8 (≤120), artifacts≤8 (≤80).
- open_todos items may be strings or {"text":"...","tool":"navigate"}. tool is optional exact internal name (lowercase [a-z][a-z0-9_]*). Omit if unknown. Never guess from Chinese. Never put secrets in text.
- decisions may include a short why; artifacts = file/URL/tab names only.
- NEVER reproduce secrets, API keys, cookies, passwords, tokens, shell secrets, or full code dumps.
- Prefer user constraints + tool outcomes over speculative reasoning slices.
- If nothing useful, return empty arrays.`

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

export { shouldSummarizeCompaction as shouldRunH1 } from "./context-budget"

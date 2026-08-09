// M2 rolling summary for runtime context budget (optional, default off).
// Uses fixed system prompt + redacted transcript only (F-S5).

import { llmExtract, type LlmExtractConfig } from "./llm-extract"
import {
  M2_ROLLING_SUMMARY_SYSTEM,
  buildRedactedTranscript,
  shortSha256,
  type CompactResult,
} from "./context-budget"
import type { CanonicalChatMessage } from "./provider"

export type M2SummaryResult = {
  summary: string
  summarySha256: string
  summaryBytes: number
  ok: boolean
  error?: string
}

/**
 * Generate a short rolling summary of dropped messages for the omit notice.
 * Failures return ok:false — caller keeps M1 omit notice only.
 */
export async function generateRollingSummary(opts: {
  droppedMessages: CanonicalChatMessage[]
  config: LlmExtractConfig
  signal?: AbortSignal
}): Promise<M2SummaryResult> {
  const { droppedMessages, config } = opts
  if (!droppedMessages.length) {
    return { summary: "", summarySha256: "", summaryBytes: 0, ok: false, error: "empty" }
  }
  if (!config.api_key) {
    return { summary: "", summarySha256: "", summaryBytes: 0, ok: false, error: "no_api_key" }
  }

  const transcript = buildRedactedTranscript(droppedMessages, 2500)
  if (!transcript.trim()) {
    return { summary: "", summarySha256: "", summaryBytes: 0, ok: false, error: "empty_transcript" }
  }

  try {
    const summary = await llmExtract({
      systemPrompt: M2_ROLLING_SUMMARY_SYSTEM,
      userContent: `Summarize these earlier turns:\n\n${transcript}`,
      config,
      temperatureCap: 0.2,
      timeout: 45_000,
      signal: opts.signal,
    })
    const cleaned = summary
      .replace(/\r\n/g, "\n")
      .trim()
      .slice(0, 2000)
    if (!cleaned) {
      return { summary: "", summarySha256: "", summaryBytes: 0, ok: false, error: "empty_summary" }
    }
    return {
      summary: cleaned,
      summarySha256: shortSha256(cleaned),
      summaryBytes: Buffer.byteLength(cleaned, "utf8"),
      ok: true,
    }
  } catch (e: any) {
    return {
      summary: "",
      summarySha256: "",
      summaryBytes: 0,
      ok: false,
      error: e?.message || String(e),
    }
  }
}

/**
 * M2 default strategy (tuned 2026-08-06):
 * - Only when explicitly/implicitly enabled (default true on new installs)
 * - Only after real head-drop
 * - pre_loop only (mid_loop stays M1 — avoid latency on every tool round)
 * - Worth it when dropped ≥3 messages OR ≥500 estimated tokens removed
 */
export function shouldRunM2(
  compact: CompactResult,
  m2Enabled: boolean,
  phase: "pre_loop" | "mid_loop" = "pre_loop",
): boolean {
  if (m2Enabled !== true || !compact.compacted) return false
  if (phase === "mid_loop") return false
  const droppedTok = Math.max(0, compact.tokensBefore - compact.tokensAfter)
  return compact.droppedMessages.length >= 3 || droppedTok >= 500
}

import { attachHandoffNoticeToMessages, attachRollingSummaryToMessages, type CompactResult } from "./context-budget"
import { generateRollingSummary } from "./context-budget-m2"
import type { ThreadHandoff } from "./context-handoff"
import { generateThreadHandoff } from "./context-handoff-generator"
import type { LlmExtractConfig } from "./llm-extract"
import type { CanonicalChatMessage } from "./provider"

export interface CompactionSummary {
  mode: "m1" | "m2" | "h1"
  messages: CanonicalChatMessage[]
  rollingSummary?: string
  summarySha?: string
  summaryBytes?: number
  handoff?: ThreadHandoff
  h1Error?: string
}

/** Generate one structured handoff, falling back to prose only on a fast failure. */
export async function summarizeDroppedContext(
  compact: CompactResult,
  config: LlmExtractConfig,
  priorHandoff: unknown,
  signal?: AbortSignal,
  assertCurrentRun?: () => void,
): Promise<CompactionSummary> {
  const input = { droppedMessages: compact.droppedMessages, config, signal }
  const omitted: CompactionSummary = { mode: "m1", messages: compact.messages }
  try {
    assertCurrentRun?.()
    const h1 = await generateThreadHandoff({
      ...input,
      priorHandoff: priorHandoff && typeof priorHandoff === "object" ? priorHandoff as ThreadHandoff : null,
    })
    if (h1.ok) {
      return {
        mode: "h1", messages: attachHandoffNoticeToMessages(compact.messages, compact.droppedCount, h1.formatted),
        handoff: h1.handoff, rollingSummary: h1.formatted, summarySha: h1.sha256, summaryBytes: h1.bytes,
      }
    }
    omitted.h1Error = h1.error
    if (h1.slow) return omitted
  } catch (error: any) {
    omitted.h1Error = error?.message || String(error)
  }
  if (signal?.aborted) return omitted
  try {
    assertCurrentRun?.()
    const m2 = await generateRollingSummary(input)
    if (m2.ok && m2.summary) {
      return {
        mode: "m2", messages: attachRollingSummaryToMessages(compact.messages, compact.droppedCount, m2.summary),
        rollingSummary: m2.summary, summarySha: m2.summarySha256, summaryBytes: m2.summaryBytes,
        h1Error: omitted.h1Error,
      }
    }
  } catch {
    /* Keep the original omit notice if prose generation fails too. */
  }
  return omitted
}

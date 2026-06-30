// Conversation → structured summary (P3, NotebookLM-style).
//
// summarizeThread feeds a TOKEN-BUDGETED transcript of a thread to the LLM via the one-shot
// llmExtract helper, then parseSummary robustly extracts {title, tldr, body} — mirroring
// vault-profiler's parseVaultProfile (sentinel + fence-anywhere + emptiness guard). The LLM
// call lives HERE (not in markdown-export.ts, which stays pure); markdown-export.ts owns
// assembling the note from the parsed summary via serializeSummaryToMarkdown.
//
// Long threads (up to 1000 messages) can't be sent whole: buildSummaryTranscript keeps a
// head + tail within a token budget (min(context_window*0.4, 50000)) with an omitted-rounds
// marker, so the LLM sees the opening question + recent context. The note's appendix still
// renders the FULL conversation (assemble-time), per the user's choice.

import { llmExtract, type LlmExtractConfig } from "../llm/llm-extract"
import type { ExportMessage, ThreadSummary } from "./markdown-export"

/** LLM emits this lone line when the conversation is too short / has nothing to summarize. */
export const NO_SUMMARY_CONTENT = "NO_SUMMARY_CONTENT"

const MIN_TURNS_TO_SUMMARIZE = 4 // fewer user/assistant turns → not worth summarizing
const PER_MESSAGE_CAP = 2000 // truncate each message before sending to the LLM
const DEFAULT_CONTEXT_WINDOW = 100000

export const SUMMARY_SYSTEM_PROMPT = `你是一个对话摘要助手。用户会给你一段多轮对话(🧑=用户,🤖=助手)。请把它浓缩成一篇结构化中文笔记,严格按以下格式输出(不要用代码块包裹整个输出,也不要任何前言/解释):

TITLE: <一句话标题,不超过 30 字>
TLDR: <一句话总结,不超过 60 字>
## 关键主题
- <反复出现的主题或概念>
## 结论
- <对话得出的结论>
## 决策
- <明确做出的决定>(若没有,省略整个「## 决策」小节)
## 待办
- [ ] <后续要做的事>(若没有,省略整个「## 待办」小节)

规则:只输出有内容的小节(可省略「决策」「待办」);不要照抄原文,要提炼;待办必须用「- [ ] 」格式;除 TITLE/TLDR 两行外其余用 markdown 小节。如果对话太短或没有实质内容可总结,只输出一行:NO_SUMMARY_CONTENT`

// ---------------- transcript building (deterministic, token-budgeted) ----------------

/** Rough token estimate (matches adapter.ts file-upload estimator): CJK≈1.5 tok, latin≈4 chars/tok. */
export function estimateTokens(text: string): number {
  let cjk = 0
  let other = 0
  for (const ch of text) {
    if (/[一-鿿　-〿＀-￯]/.test(ch)) cjk++
    else other++
  }
  return Math.ceil(cjk * 1.5 + other / 4)
}

function formatMessage(m: ExportMessage): string {
  const role = m.role === "user" ? "🧑" : "🤖"
  const content = (m.content || "").replace(/\s+/g, " ").trim()
  const capped = content.length > PER_MESSAGE_CAP ? content.slice(0, PER_MESSAGE_CAP) + "…" : content
  return `${role}: ${capped}`
}

/**
 * Build a token-budgeted transcript for the LLM. Filters to user/assistant text (drops
 * tool/system noise), truncates each message, and if the whole transcript exceeds the budget
 * keeps a head + tail with a "(中间 N 轮已省略)" marker. Returns null if the thread is too
 * short to summarize (< MIN_TURNS_TO_SUMMARIZE user/assistant turns).
 */
export function buildSummaryTranscript(
  messages: ExportMessage[],
  contextWindow: number = DEFAULT_CONTEXT_WINDOW,
): string | null {
  const turns = messages.filter(m => m.role === "user" || m.role === "assistant")
  if (turns.length < MIN_TURNS_TO_SUMMARIZE) return null

  const budget = Math.min(Math.floor(contextWindow * 0.4), 50000)
  const formatted = turns.map(formatMessage)

  const whole = formatted.join("\n")
  if (estimateTokens(whole) <= budget) return whole

  // Over budget: keep a head + tail. The opening question (formatted[0]) is ALWAYS included
  // unconditionally — it's the essential context for any summary and is bounded by
  // PER_MESSAGE_CAP — so we never emit a marker-only transcript (zero conversation content),
  // even when the budget is too tight to fit a single full message.
  const reserveMarker = estimateTokens("\n…(中间 999 轮已省略)…\n")
  const head: string[] = [formatted[0]]
  const tail: string[] = []
  let used = reserveMarker + estimateTokens(formatted[0])
  let i = 1
  let j = formatted.length - 1
  let preferHead = true
  // Greedy two-pointer fill: alternate sides, but if the next candidate on the preferred side
  // won't fit, try the OTHER side before giving up — so a single oversized message can't leave
  // the budget underutilized while smaller messages that would fit get dropped.
  const tryAdd = (idx: number, toHead: boolean): boolean => {
    const t = estimateTokens(formatted[idx])
    if (used + t > budget) return false
    if (toHead) head.push(formatted[idx])
    else tail.unshift(formatted[idx])
    used += t
    return true
  }
  while (i <= j) {
    let success: boolean
    if (preferHead) {
      success = tryAdd(i, true) ? (i++, true) : tryAdd(j, false) ? (j--, true) : false
    } else {
      success = tryAdd(j, false) ? (j--, true) : tryAdd(i, true) ? (i++, true) : false
    }
    if (!success) break
    preferHead = !preferHead // balanced alternation (a fallback add still toggles)
  }
  const omitted = j - i + 1
  if (omitted <= 0) return whole // everything fit after all
  const marker = `\n…(中间 ${omitted} 轮已省略)…\n`
  return [...head, marker, ...tail].join("\n")
}

// ---------------- parsing (robust, mirrors parseVaultProfile) ----------------

/**
 * Parse the LLM's summary response into {title, tldr?, body}. Robust: sentinel
 * short-circuit, fence-anywhere unwrap, leading TITLE/TLDR line extraction, emptiness guard.
 * Returns null on degraded/empty output (caller reports an error rather than emit garbage).
 * An empty title is allowed — the assembler falls back to the thread alias.
 */
export function parseSummary(raw: string): ThreadSummary | null {
  const trimmed = (raw || "").trim()
  if (!trimmed || trimmed === NO_SUMMARY_CONTENT) return null

  // Only strip a code fence that wraps the ENTIRE response (anchored opener + final closer).
  // A non-greedy first-fence match would latch onto an INTERIOR code block in the body and
  // truncate the summary — so we never touch interior fences. The opener info-string allows
  // digits/hyphens and trailing space (e.g. ```markdown2, ``` with trailing space).
  let text = trimmed
  const opener = /^```[^\n]*\n/
  const closer = /\n```[\t ]*$/
  if (opener.test(trimmed) && closer.test(trimmed)) {
    text = trimmed.replace(opener, "").replace(closer, "").trim()
  }

  // Split on any line ending (LF / CRLF / bare CR).
  const lines = text.split(/\r\n|\r|\n/)

  // Find TITLE / TLDR ANYWHERE — the LLM may prepend a one-line preamble before them. Take
  // the first occurrence of each (order-independent).
  let title: string | undefined
  let tldr: string | undefined
  let titleIdx = -1
  let tldrIdx = -1
  for (let k = 0; k < lines.length; k++) {
    if (titleIdx < 0) {
      const tm = lines[k].match(/^\s*TITLE\s*[:：]\s*(.+?)\s*$/i)
      if (tm) {
        title = tm[1]
        titleIdx = k
        continue
      }
    }
    if (tldrIdx < 0) {
      const dm = lines[k].match(/^\s*TLDR\s*[:：]\s*(.+?)\s*$/i)
      if (dm) {
        tldr = dm[1]
        tldrIdx = k
        continue
      }
    }
  }

  // Body = everything EXCEPT the extracted TITLE/TLDR lines, anchored to the first `##`
  // heading if present (drops any preamble the LLM added); else the first non-empty line.
  const excluded = new Set([titleIdx, tldrIdx])
  const rest = lines.filter((_, k) => !excluded.has(k))
  let bodyStart = rest.findIndex(l => /^##\s/.test(l))
  if (bodyStart < 0) bodyStart = rest.findIndex(l => l.trim() !== "")
  const body = bodyStart >= 0 ? rest.slice(bodyStart).join("\n").trim() : ""
  if (!body) return null

  return {
    title: (title || "").trim(),
    ...(tldr ? { tldr: tldr.trim() } : {}),
    body,
  }
}

// ---------------- LLM call (G2) ----------------

/** Summarize a thread: build a transcript → one-shot LLM call → parse. null if too short or
 *  the model returned nothing usable. Throws on LLM/timeout error (caller reports it). */
export async function summarizeThread(params: {
  messages: ExportMessage[]
  config: LlmExtractConfig
  contextWindow?: number
}): Promise<ThreadSummary | null> {
  const transcript = buildSummaryTranscript(params.messages, params.contextWindow)
  if (!transcript) return null // too short to summarize
  const raw = await llmExtract({
    systemPrompt: SUMMARY_SYSTEM_PROMPT,
    userContent: `以下是待总结的多轮对话:\n\n${transcript}`,
    config: params.config,
    temperatureCap: 0.3,
    timeout: 90000,
  })
  return parseSummary(raw)
}

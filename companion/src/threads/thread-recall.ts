// Wave C: same-thread cold archive search for post-compaction recall.
// Spec: docs/superpowers/plans/2026-08-07-wave-c-thread-recall.md
// Redact: F-S5 via redactMessagesForCompaction with synthetic assistant pairing for orphans.

import {
  redactMessagesForCompaction,
  COMPACT_SENSITIVE_COOKIE_TOOLS,
  COMPACT_SENSITIVE_CODE_TOOLS,
} from "../llm/context-budget"
import type { CanonicalChatMessage } from "../llm/provider"

export const RECALL_MAX_HITS_DEFAULT = 5
export const RECALL_MAX_HITS_CAP = 12
export const RECALL_TOTAL_CHARS = 4000
export const RECALL_PER_HIT_CHARS = 600
export const RECALL_QUERY_MAX_LEN = 200

export type RecallHit = {
  message_id?: string
  role: string
  score: number
  excerpt: string
}

/** Persisted Message-like (thread-manager / createToolResultMessage shape). */
export type RecallSourceMessage = {
  id?: string
  role: string
  content?: string
  reasoning_content?: string
  tool_calls?: Array<{
    id?: string
    tool_name?: string
    name?: string
    function?: { name?: string; arguments?: string }
    params?: unknown
    result?: unknown
    arguments?: string
  }>
}

/** tool_name → name → function?.name */
export function resolveToolName(tc: {
  tool_name?: string
  name?: string
  function?: { name?: string }
} | null | undefined): string | null {
  if (!tc) return null
  const n = tc.tool_name || tc.name || tc.function?.name
  return typeof n === "string" && n.trim() ? n.trim() : null
}

/**
 * Whitespace tokens + overlapping CJK bigrams for continuous Han runs.
 */
export function tokenizeQuery(q: string): string[] {
  const raw = String(q || "").trim()
  if (!raw) return []
  const terms: string[] = []
  const seen = new Set<string>()
  const add = (t: string) => {
    const x = t.toLowerCase()
    if (!x || seen.has(x)) return
    seen.add(x)
    terms.push(x)
  }
  for (const part of raw.split(/\s+/)) {
    if (!part) continue
    add(part)
    // Han runs → bigrams
    const hans = part.match(/[\u3400-\u9fff\uf900-\ufaff]+/g)
    if (hans) {
      for (const run of hans) {
        if (run.length === 1) add(run)
        else {
          for (let i = 0; i < run.length - 1; i++) add(run.slice(i, i + 2))
        }
      }
    }
  }
  return terms
}

export function scoreMessage(text: string, terms: string[]): number {
  if (!terms.length || !text) return 0
  const hay = text.toLowerCase()
  let score = 0
  for (const t of terms) {
    if (!t) continue
    let idx = 0
    while (true) {
      const at = hay.indexOf(t, idx)
      if (at < 0) break
      score += 1
      idx = at + t.length
    }
  }
  return score
}

function searchTextForMessage(m: RecallSourceMessage): string {
  const parts: string[] = [m.role || ""]
  if (typeof m.content === "string") parts.push(m.content.slice(0, 4000))
  if (m.tool_calls?.length) {
    for (const tc of m.tool_calls) {
      const name = resolveToolName(tc)
      if (name) parts.push(name)
      if (tc.function?.arguments) parts.push(String(tc.function.arguments).slice(0, 500))
      if (tc.params != null) parts.push(JSON.stringify(tc.params).slice(0, 500))
      // do not dump full result for scoring — slice only
      if (tc.result != null) parts.push(JSON.stringify(tc.result).slice(0, 800))
    }
  }
  return parts.join("\n")
}

function toolContent(m: RecallSourceMessage): string {
  if (typeof m.content === "string" && m.content) return m.content
  const tc = m.tool_calls?.[0]
  if (tc?.result != null) {
    try {
      return typeof tc.result === "string" ? tc.result : JSON.stringify(tc.result)
    } catch {
      return String(tc.result)
    }
  }
  return ""
}

/**
 * Build CanonicalChatMessage list so F-S5 can resolve tool names.
 * Orphan tool rows → synthetic assistant with function.name (Pi R2 fix).
 */
export function toCanonicalForRedact(
  msg: RecallSourceMessage,
  prevAssistant?: RecallSourceMessage | null,
): CanonicalChatMessage[] {
  const role = msg.role
  if (role === "user" || role === "system") {
    return [{ role: role as "user" | "system", content: String(msg.content || "").slice(0, 8000) }]
  }
  if (role === "assistant") {
    const tool_calls = (msg.tool_calls || [])
      .filter((tc) => tc.id)
      .map((tc) => ({
        id: tc.id!,
        type: "function" as const,
        function: {
          name: resolveToolName(tc) || "tool",
          arguments:
            tc.function?.arguments ||
            (tc.arguments != null
              ? String(tc.arguments)
              : tc.params != null
                ? JSON.stringify(tc.params)
                : "{}"),
        },
      }))
    return [
      {
        role: "assistant",
        content: typeof msg.content === "string" ? msg.content : null,
        ...(tool_calls.length ? { tool_calls } : {}),
      },
    ]
  }
  if (role === "tool") {
    const tc0 = msg.tool_calls?.[0]
    const toolCallId = tc0?.id
    const name = resolveToolName(tc0)
    if (!toolCallId || !name) {
      // unresolvable for F-S5 → empty (drop)
      return []
    }
    const content = toolContent(msg)
    // Prefer real previous assistant if it declares this tool_call id
    let paired: RecallSourceMessage | null = prevAssistant || null
    if (paired?.role === "assistant" && paired.tool_calls?.length) {
      const has = paired.tool_calls.some((t) => t.id === toolCallId)
      if (!has) paired = null
    } else {
      paired = null
    }
    const assistantMsg: CanonicalChatMessage = paired
      ? (toCanonicalForRedact(paired)[0] as CanonicalChatMessage)
      : {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: toolCallId,
              type: "function",
              function: { name, arguments: "{}" },
            },
          ],
        }
    // Ensure assistant still has this tool call name
    if (assistantMsg.role === "assistant" && assistantMsg.tool_calls) {
      const found = assistantMsg.tool_calls.find((t) => t.id === toolCallId)
      if (!found) {
        assistantMsg.tool_calls.push({
          id: toolCallId,
          type: "function",
          function: { name, arguments: "{}" },
        })
      }
    }
    return [
      assistantMsg,
      { role: "tool", tool_call_id: toolCallId, content },
    ]
  }
  return []
}

export function redactHitExcerpt(
  msg: RecallSourceMessage,
  allMessages: RecallSourceMessage[],
  index: number,
): string | null {
  let prev: RecallSourceMessage | null = null
  if (msg.role === "tool") {
    for (let j = index - 1; j >= 0; j--) {
      if (allMessages[j].role === "assistant") {
        prev = allMessages[j]
        break
      }
    }
  }
  const mini = toCanonicalForRedact(msg, prev)
  if (!mini.length) return null
  const redacted = redactMessagesForCompaction(mini)
  // Prefer tool message content; else assistant/user body (F-S5 strips tool_calls on assistant)
  const toolR = redacted.find((m) => m.role === "tool")
  const asstR = redacted.find((m) => m.role === "assistant")
  let excerpt = ""
  if (toolR && typeof toolR.content === "string") {
    excerpt = toolR.content
  } else if (asstR && typeof asstR.content === "string") {
    excerpt = asstR.content
  } else if (redacted[0] && typeof (redacted[0] as any).content === "string") {
    excerpt = (redacted[0] as any).content
  }
  excerpt = String(excerpt || "").trim()
  if (!excerpt) return null
  return excerpt.slice(0, RECALL_PER_HIT_CHARS)
}

export function clampMaxHits(raw: unknown): number {
  const n = Math.floor(Number(raw))
  if (!Number.isFinite(n) || n < 1) return RECALL_MAX_HITS_DEFAULT
  return Math.min(RECALL_MAX_HITS_CAP, n)
}

/**
 * Rank + redact. Returns up to maxHits under total char budget.
 */
export function searchAndRedact(
  messages: RecallSourceMessage[],
  query: string,
  maxHits: number = RECALL_MAX_HITS_DEFAULT,
): RecallHit[] {
  const terms = tokenizeQuery(query)
  if (!terms.length) return []
  const cap = clampMaxHits(maxHits)

  const scored: Array<{ index: number; score: number }> = []
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    const s = scoreMessage(searchTextForMessage(m), terms)
    if (s > 0) scored.push({ index: i, score: s })
  }
  scored.sort((a, b) => b.score - a.score || b.index - a.index)

  const hits: RecallHit[] = []
  let used = 0
  for (const { index, score } of scored) {
    if (hits.length >= cap) break
    const m = messages[index]
    const excerpt = redactHitExcerpt(m, messages, index)
    if (!excerpt) continue
    if (used + excerpt.length > RECALL_TOTAL_CHARS) {
      const room = RECALL_TOTAL_CHARS - used
      if (room < 40) break
      hits.push({
        message_id: m.id,
        role: m.role,
        score,
        excerpt: excerpt.slice(0, room),
      })
      break
    }
    hits.push({
      message_id: m.id,
      role: m.role,
      score,
      excerpt,
    })
    used += excerpt.length
  }
  return hits
}

/** Re-export sensitive sets for tests. */
export { COMPACT_SENSITIVE_COOKIE_TOOLS, COMPACT_SENSITIVE_CODE_TOOLS }

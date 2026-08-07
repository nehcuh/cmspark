// Runtime context budget (M1/M2) — pure turn-safe head-drop + omit notice + redact.
// Spec: docs/superpowers/specs/2026-08-06-settings-thread-compact-ux.md §5
// Distinct from ThreadDigest / Obsidian export summary.

import { createHash } from "crypto"
import { estimateTokens } from "../threads/summary-export"
import type { CanonicalChatMessage } from "./provider"

export { estimateTokens }

const OMIT_PREFIX = "[context_omitted]"
const SUMMARY_PREFIX = "[context_summary]"

/** Cookie / secret tools — drop payload entirely for compaction input (F-S5). */
export const COMPACT_SENSITIVE_COOKIE_TOOLS = new Set([
  "get_cookies",
  "list_all_cookies",
  "set_cookie",
  "delete_cookie",
])

/** High-risk tools — keep name + outcome only, not bodies. */
export const COMPACT_SENSITIVE_CODE_TOOLS = new Set([
  "evaluate",
  "osascript_eval",
  "host_read",
  "host_write",
  "host_app",
  "host_computer",
  "shell_exec",
  "netsec_port_scan",
])

const SECRET_BODY_RE =
  /\b(sk-[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._\-]+|-----BEGIN [A-Z ]+PRIVATE KEY-----)/gi

export function serializeMessage(m: CanonicalChatMessage): string {
  if (m.role === "tool") {
    return typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? "")
  }
  if (m.role === "assistant") {
    let s = typeof m.content === "string" ? m.content : m.content == null ? "" : String(m.content)
    if (m.tool_calls?.length) {
      for (const tc of m.tool_calls) {
        const name = tc.function?.name || ""
        const args = tc.function?.arguments || ""
        s += `\n${name}:${args}`
      }
    }
    return s
  }
  return typeof m.content === "string" ? m.content : m.content == null ? "" : String(m.content)
}

export function estimateMessagesTokens(msgs: CanonicalChatMessage[]): number {
  let n = 0
  for (const m of msgs) n += estimateTokens(serializeMessage(m))
  return n
}

export function computeReserve(opts: {
  contextWindow: number
  systemPromptTokens: number
  toolsJsonTokens: number
}): number {
  const { contextWindow, systemPromptTokens, toolsJsonTokens } = opts
  const floor = Math.floor(contextWindow * 0.15)
  const replyReserve = Math.min(8192, Math.floor(contextWindow / 8))
  return Math.max(floor, systemPromptTokens + toolsJsonTokens + replyReserve)
}

export function isOmitNotice(m: CanonicalChatMessage): boolean {
  return (
    m.role === "user" &&
    typeof m.content === "string" &&
    (m.content.startsWith(OMIT_PREFIX) || m.content.startsWith(SUMMARY_PREFIX))
  )
}

export function buildOmitNotice(droppedCount: number, rollingSummary?: string): CanonicalChatMessage {
  if (rollingSummary && rollingSummary.trim()) {
    const capped = rollingSummary.trim().slice(0, 2000)
    return {
      role: "user",
      content: `${SUMMARY_PREFIX} Earlier ${droppedCount} messages omitted (turn-safe). Rolling summary (redacted, request-only):\n${capped}\nFull history retained on disk. Visible chat may still show full history.`,
    }
  }
  return {
    role: "user",
    content: `${OMIT_PREFIX} Earlier ${droppedCount} messages omitted (turn-safe). Full history retained on disk. Visible chat may still show full history.`,
  }
}

export function shortSha256(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16)
}

function scrubSecretPatterns(text: string): string {
  return text.replace(SECRET_BODY_RE, "[redacted-secret]")
}

/**
 * Redact messages before M2 summary LLM (F-S5).
 * - Cookie tools → name only
 * - Sensitive code/host/shell tools → name + length only
 * - MCP secret-shaped tools → redact body
 * - Body-level sk-/Bearer/PEM scrub
 * Never includes raw cookie values or tool result dumps.
 */
export function redactMessagesForCompaction(messages: CanonicalChatMessage[]): CanonicalChatMessage[] {
  const idToName = new Map<string, string>()
  for (const m of messages) {
    if (m.role === "assistant" && m.tool_calls) {
      for (const tc of m.tool_calls) {
        if (tc.id) idToName.set(tc.id, tc.function?.name || "tool")
      }
    }
  }

  return messages.map((m) => {
    if (m.role === "system") {
      return { role: "system", content: scrubSecretPatterns(m.content || "").slice(0, 400) }
    }
    if (m.role === "user") {
      return { role: "user", content: scrubSecretPatterns(m.content || "").slice(0, 800) }
    }
    if (m.role === "assistant") {
      const names = (m.tool_calls || []).map((tc) => tc.function?.name || "?").join(",")
      let content = typeof m.content === "string" ? m.content : ""
      content = scrubSecretPatterns(content).slice(0, 600)
      if (names) content = content ? `${content}\n[tools: ${names}]` : `[tools: ${names}]`
      return { role: "assistant", content }
    }
    // tool
    const name = idToName.get(m.tool_call_id) || "tool"
    if (COMPACT_SENSITIVE_COOKIE_TOOLS.has(name)) {
      return { role: "tool", tool_call_id: m.tool_call_id, content: `[${name}: redacted]` }
    }
    if (COMPACT_SENSITIVE_CODE_TOOLS.has(name)) {
      return {
        role: "tool",
        tool_call_id: m.tool_call_id,
        content: `[${name}: outcome redacted len=${(m.content || "").length}]`,
      }
    }
    if (name.startsWith("mcp__") && /(read|file|secret|token|key|env|credential)/i.test(name)) {
      return {
        role: "tool",
        tool_call_id: m.tool_call_id,
        content: `[${name}: redacted]`,
      }
    }
    return {
      role: "tool",
      tool_call_id: m.tool_call_id,
      content: scrubSecretPatterns((m.content || "").slice(0, 400)),
    }
  })
}

/** Build redacted transcript lines for M2, under token budget. */
export function buildRedactedTranscript(
  messages: CanonicalChatMessage[],
  tokenBudget = 2500,
): string {
  const redacted = redactMessagesForCompaction(messages)
  const lines: string[] = []
  let used = 0
  for (const m of redacted) {
    const line = `${m.role}: ${serializeMessage(m).replace(/\s+/g, " ").trim()}`
    const t = estimateTokens(line)
    if (used + t > tokenBudget) {
      lines.push("…(transcript truncated for summary budget)…")
      break
    }
    lines.push(line)
    used += t
  }
  return lines.join("\n")
}

export const M2_ROLLING_SUMMARY_SYSTEM = `You summarize earlier chat turns for an AI agent so it can continue.
Rules:
- Output 5–12 short bullet points in the same language as the content (Chinese if Chinese).
- Facts, decisions, open todos, constraints, and tab/file names only.
- NEVER reproduce secrets, API keys, cookies, passwords, tokens, shell secrets, or full code dumps.
- If content looks sensitive, write "[redacted]" instead.
- No preamble. Bullets only.`

export type CompactResult = {
  messages: CanonicalChatMessage[]
  droppedCount: number
  droppedMessages: CanonicalChatMessage[]
  tokensBefore: number
  tokensAfter: number
  compacted: boolean
}

function dropBlockAt(
  msgs: CanonicalChatMessage[],
  dropAt: number,
  droppedAcc: CanonicalChatMessage[],
): number {
  const oldest = msgs[dropAt]
  if (oldest.role === "assistant" && oldest.tool_calls && oldest.tool_calls.length > 0) {
    let countToDelete = 1
    while (dropAt + countToDelete < msgs.length && msgs[dropAt + countToDelete].role === "tool") {
      countToDelete++
    }
    droppedAcc.push(...msgs.slice(dropAt, dropAt + countToDelete))
    msgs.splice(dropAt, countToDelete)
    return countToDelete
  }
  droppedAcc.push(msgs[dropAt])
  msgs.splice(dropAt, 1)
  return 1
}

/**
 * Turn-safe head-drop until under budget.
 * - Keeps leading system messages
 * - Drops oldest non-system blocks; assistant+tool pairs removed together
 * - Never drops the last user message (excluding omit notices)
 * - Inserts exactly one omit notice after leading systems when dropped > 0
 * - Returns droppedMessages for optional M2 rolling summary
 */
export function compactMessagesTurnSafe(
  messages: CanonicalChatMessage[],
  budget: number,
  opts?: { rollingSummary?: string },
): CompactResult {
  const tokensBefore = estimateMessagesTokens(messages)
  if (tokensBefore <= budget || messages.length <= 2) {
    return {
      messages: [...messages],
      droppedCount: 0,
      droppedMessages: [],
      tokensBefore,
      tokensAfter: tokensBefore,
      compacted: false,
    }
  }

  const msgs = messages.map((m) => ({ ...m })) as CanonicalChatMessage[]
  const droppedMessages: CanonicalChatMessage[] = []
  let dropped = 0

  const canDrop = (): boolean => {
    const nonSystem = msgs.filter((m) => m.role !== "system" && !isOmitNotice(m))
    const users = nonSystem.filter((m) => m.role === "user")
    return users.length > 1 || (users.length === 1 && nonSystem.length > 1)
  }

  while (estimateMessagesTokens(msgs) > budget && canDrop()) {
    const idx = msgs.findIndex((m) => m.role !== "system" && !isOmitNotice(m))
    if (idx < 0) break

    let lastUserIdx = -1
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === "user" && !isOmitNotice(msgs[i])) {
        lastUserIdx = i
        break
      }
    }
    if (idx === lastUserIdx) {
      let found = -1
      for (let i = 0; i < msgs.length; i++) {
        if (msgs[i].role === "system" || isOmitNotice(msgs[i])) continue
        if (i === lastUserIdx) continue
        found = i
        break
      }
      if (found < 0) break
      dropped += dropBlockAt(msgs, found, droppedMessages)
      continue
    }

    dropped += dropBlockAt(msgs, idx, droppedMessages)
  }

  for (let i = msgs.length - 1; i >= 0; i--) {
    if (isOmitNotice(msgs[i])) msgs.splice(i, 1)
  }

  if (dropped > 0) {
    let insertAt = 0
    while (insertAt < msgs.length && msgs[insertAt].role === "system") insertAt++
    msgs.splice(insertAt, 0, buildOmitNotice(dropped, opts?.rollingSummary))
  }

  const tokensAfter = estimateMessagesTokens(msgs)
  return {
    messages: msgs,
    droppedCount: dropped,
    droppedMessages,
    tokensBefore,
    tokensAfter,
    compacted: dropped > 0,
  }
}

/** Apply budget given full context_window and pre-built tools JSON. */
export function applyContextBudget(
  messages: CanonicalChatMessage[],
  contextWindow: number,
  tools: unknown,
  opts?: { rollingSummary?: string },
): CompactResult {
  const systemPromptTokens = messages
    .filter((m) => m.role === "system")
    .reduce((n, m) => n + estimateTokens(serializeMessage(m)), 0)
  let toolsJsonTokens = 0
  try {
    toolsJsonTokens = estimateTokens(JSON.stringify(tools ?? []))
  } catch {
    toolsJsonTokens = 0
  }
  const reserve = computeReserve({
    contextWindow,
    systemPromptTokens,
    toolsJsonTokens,
  })
  const budget = Math.max(256, contextWindow - reserve)
  return compactMessagesTurnSafe(messages, budget, opts)
}

/** Replace existing omit/summary notice content in-place (request array only). */
export function attachRollingSummaryToMessages(
  messages: CanonicalChatMessage[],
  droppedCount: number,
  rollingSummary: string,
): CanonicalChatMessage[] {
  const notice = buildOmitNotice(droppedCount, rollingSummary)
  const out = messages.map((m) => ({ ...m })) as CanonicalChatMessage[]
  const idx = out.findIndex(isOmitNotice)
  if (idx >= 0) {
    out[idx] = notice
    return out
  }
  let insertAt = 0
  while (insertAt < out.length && out[insertAt].role === "system") insertAt++
  out.splice(insertAt, 0, notice)
  return out
}

/**
 * S51 P0 / S52 N2–N3: pure mid_loop retain of a prior pre_loop M2 summary.
 *
 * When mid_loop only runs M1 omit (`shouldRunM2` is false for mid_loop), keep the
 * previous rolling summary on the **LLM request path** (not only UI meta).
 *
 * **Mode honesty (N7):** resulting `mode === "m2"` means “request carries a
 * rolling summary notice”, not “a fresh summary was generated this mid_loop pass”.
 * Content is the prior pre_loop text; newly dropped mid_loop tool mass is not re-summarized.
 */
export type MidLoopRetainInput = {
  phase: "pre_loop" | "mid_loop"
  /** Compact outcome mode before retain (`m1` after plain omit, `m2` if M2 just ran). */
  mode: "m1" | "m2"
  messages: CanonicalChatMessage[]
  droppedCount: number
  /** Summary produced this pass (usually empty on mid_loop). */
  rollingSummary?: string
  summarySha?: string
  summaryBytes?: number
  /** Prior thread meta from pre_loop M2 (UI + request dual-truth source). */
  prevMeta?: {
    rolling_summary?: string
    summary_sha256?: string
    summary_bytes?: number
  } | null
}

export type MidLoopRetainResult = {
  messages: CanonicalChatMessage[]
  mode: "m1" | "m2"
  rollingSummary?: string
  summarySha: string
  summaryBytes: number
  /** Preferred summary for meta write / UI modal. */
  keepSummary?: string
  keepSha?: string
  keepBytes?: number
  /** True when this call re-attached a prior summary into the request. */
  reattached: boolean
}

export function retainMidLoopRollingSummary(input: MidLoopRetainInput): MidLoopRetainResult {
  const {
    phase,
    mode: modeIn,
    messages: messagesIn,
    droppedCount,
    rollingSummary: rollingIn,
    summarySha: shaIn = "",
    summaryBytes: bytesIn = 0,
    prevMeta,
  } = input

  const keepSummary =
    rollingIn ||
    (phase === "mid_loop" && !rollingIn ? prevMeta?.rolling_summary : undefined)
  const keepSha =
    shaIn || (phase === "mid_loop" && !shaIn ? prevMeta?.summary_sha256 : undefined)
  const keepBytes =
    bytesIn || (phase === "mid_loop" && !bytesIn ? prevMeta?.summary_bytes : undefined)

  let messages = messagesIn
  let mode: "m1" | "m2" = modeIn
  let rollingSummary = rollingIn
  let summarySha = shaIn
  let summaryBytes = bytesIn
  let reattached = false

  // Re-attach prior M2 summary into request when mid_loop only ran M1 omit.
  // Must run independent of meta persistence (S52 N2 — do not nest under meta try).
  if (phase === "mid_loop" && keepSummary && mode === "m1") {
    messages = attachRollingSummaryToMessages(messages, droppedCount, keepSummary)
    mode = "m2"
    rollingSummary = keepSummary
    if (keepSha) summarySha = keepSha
    if (typeof keepBytes === "number" && keepBytes > 0) summaryBytes = keepBytes
    reattached = true
  } else if (keepSummary && !rollingSummary) {
    rollingSummary = keepSummary
  }

  return {
    messages,
    mode,
    rollingSummary,
    summarySha,
    summaryBytes,
    keepSummary,
    keepSha,
    keepBytes: typeof keepBytes === "number" ? keepBytes : undefined,
    reattached,
  }
}

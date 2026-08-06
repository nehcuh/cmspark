// ThreadDigest — short in-library index (tldr + tags + bullets).
// Spec: docs/superpowers/specs/2026-08-06-thread-history-ia-product-design.md §P1
// Distinct from Obsidian export summary (ADR-008): digest is short, searchable, stored on index.

import { llmExtract, type LlmExtractConfig } from "../llm/llm-extract"
import { estimateTokens } from "./summary-export"

export type DigestSource = "manual" | "scheduled" | "on_export" | "on_at_ref"

export interface ThreadDigest {
  extracted_at: string
  /** `${messages.length}:${lastMessageId||"empty"}` */
  content_fingerprint: string
  /** ≤120 chars */
  tldr: string
  /** normalized lowercase tags, max 8 */
  tags: string[]
  /** 1–5 bullets, each ≤80 chars */
  bullets?: string[]
  source: DigestSource
  model?: string
}

export interface DigestMessage {
  id?: string
  role: string
  content?: string
}

const MAX_TAGS = 8
const MAX_TAG_LEN = 24
const MAX_TLDR = 120
const MAX_BULLET = 80
const MAX_BULLETS = 5
const PER_MSG_CAP = 600
const OUT_TOKEN_HINT = 800

/** Pin P12: fingerprint for stale detection. */
export function contentFingerprint(messages: DigestMessage[]): string {
  const last = messages.length > 0 ? messages[messages.length - 1] : null
  const lastId = last && typeof last.id === "string" && last.id ? last.id : "empty"
  return `${messages.length}:${lastId}`
}

/** Sensitive shape rejected as tags (dual-review P14). */
export const SENSITIVE_TAG_RE = /(sk-|api[_-]?key|password|bearer\s|secret|token)/i

/**
 * Normalize a raw tag: strip #, control chars, lowercase, length cap.
 * Returns null if empty or secret-shaped.
 */
export function normalizeTag(raw: string): string | null {
  if (typeof raw !== "string") return null
  let t = raw
    .replace(/^#+/, "")
    .replace(/[\x00-\x1F\x7F]/g, "")
    .trim()
    .toLowerCase()
  if (!t) return null
  t = t.slice(0, MAX_TAG_LEN)
  if (!t) return null
  if (SENSITIVE_TAG_RE.test(t)) return null
  return t
}

export function normalizeTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    const t = normalizeTag(String(item ?? ""))
    if (!t || seen.has(t)) continue
    seen.add(t)
    out.push(t)
    if (out.length >= MAX_TAGS) break
  }
  return out
}

export function isDigestStale(
  digest: ThreadDigest | null | undefined,
  messages: DigestMessage[],
): boolean {
  if (!digest?.content_fingerprint) return true
  return digest.content_fingerprint !== contentFingerprint(messages)
}

/** Rule-based alias from first user message (P0.5, no LLM). */
export function aliasFromFirstUserText(text: string, maxLen = 40): string {
  let s = String(text || "")
    .replace(/\s+/g, " ")
    .trim()
  s = s.replace(/^(请|帮我|麻烦|请问)[，,\s]*/u, "")
  if (!s) return ""
  if (s.length > maxLen) {
    const cut = s.slice(0, maxLen)
    const m = cut.match(/^(.+?)[\s，。、；;,.!?…]+[^\s，。、；;,.!?…]*$/)
    s = (m?.[1] || cut).trim()
    if (s.length < 8) s = cut.trim()
    if (!s.endsWith("…") && String(text).trim().length > s.length) s += "…"
  }
  return s.slice(0, maxLen + 1)
}

export const DIGEST_SYSTEM_PROMPT = `你是会话索引助手。根据对话摘录输出**仅一行 JSON**（不要 markdown 围栏、不要解释）:
{"tldr":"一句话摘要≤60字","tags":["标签1","标签2"],"bullets":["要点1","要点2"]}

规则:
- tags 2–6 个短标签（中文或英文词，无 # 号，无密钥/token）
- bullets 1–5 条，每条≤40字
- 对话太短或无实质内容时: {"tldr":"","tags":[],"bullets":[]}
- 只输出 JSON 对象本身`

function buildDigestTranscript(messages: DigestMessage[]): string | null {
  const turns = messages.filter((m) => m.role === "user" || m.role === "assistant")
  if (turns.length === 0) return null
  const lines: string[] = []
  let used = 0
  const budget = 2500 // rough token budget for short digest
  for (const m of turns) {
    const role = m.role === "user" ? "🧑" : "🤖"
    let content = String(m.content || "").replace(/\s+/g, " ").trim()
    if (!content) continue
    if (content.length > PER_MSG_CAP) content = content.slice(0, PER_MSG_CAP) + "…"
    const line = `${role}: ${content}`
    const t = estimateTokens(line)
    if (used + t > budget && lines.length > 0) {
      lines.push("…(后续已省略)…")
      break
    }
    lines.push(line)
    used += t
  }
  return lines.length ? lines.join("\n") : null
}

function parseDigestJson(raw: string): { tldr: string; tags: string[]; bullets: string[] } {
  let text = (raw || "").trim()
  // unwrap fence if model ignored instructions
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) text = fence[1].trim()
  // find first { … }
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start >= 0 && end > start) text = text.slice(start, end + 1)
  try {
    const obj = JSON.parse(text)
    const tldr = String(obj.tldr || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_TLDR)
    const tags = normalizeTags(obj.tags)
    let bullets: string[] = []
    if (Array.isArray(obj.bullets)) {
      bullets = obj.bullets
        .map((b: unknown) =>
          String(b || "")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, MAX_BULLET),
        )
        .filter(Boolean)
        .slice(0, MAX_BULLETS)
    }
    return { tldr, tags, bullets }
  } catch {
    return { tldr: "", tags: [], bullets: [] }
  }
}

export async function extractThreadDigest(params: {
  messages: DigestMessage[]
  config: LlmExtractConfig
  source?: DigestSource
}): Promise<ThreadDigest | null> {
  const { messages, config, source = "manual" } = params
  const transcript = buildDigestTranscript(messages)
  if (!transcript) return null

  const raw = await llmExtract({
    systemPrompt: DIGEST_SYSTEM_PROMPT,
    userContent: transcript,
    config,
    temperatureCap: 0.2,
    timeout: 45000,
  })
  const parsed = parseDigestJson(raw)
  // empty parse after non-empty transcript → still store fingerprint so we don't thrash
  return {
    extracted_at: new Date().toISOString(),
    content_fingerprint: contentFingerprint(messages),
    tldr: parsed.tldr,
    tags: parsed.tags,
    bullets: parsed.bullets.length ? parsed.bullets : undefined,
    source,
    model: config.model_name,
  }
}

/** Max concurrent background digest LLM calls (on_at_ref / scheduled). */
const DIGEST_EXTRACT_CONCURRENCY = 2

const digestInFlight = new Map<string, Promise<ThreadDigest | null>>()
let digestActive = 0
const digestWaitQueue: Array<() => void> = []

function acquireDigestSlot(): Promise<void> {
  if (digestActive < DIGEST_EXTRACT_CONCURRENCY) {
    digestActive++
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    digestWaitQueue.push(() => {
      digestActive++
      resolve()
    })
  })
}

function releaseDigestSlot(): void {
  digestActive = Math.max(0, digestActive - 1)
  const next = digestWaitQueue.shift()
  if (next) next()
}

/**
 * Queued + de-duplicated extract for background fills (e.g. @ ref without digest).
 * - Same threadId concurrent callers share one in-flight promise
 * - Global concurrency capped at DIGEST_EXTRACT_CONCURRENCY
 */
export async function extractThreadDigestQueued(params: {
  threadId: string
  messages: DigestMessage[]
  config: LlmExtractConfig
  source?: DigestSource
}): Promise<ThreadDigest | null> {
  const { threadId, messages, config, source } = params
  const existing = digestInFlight.get(threadId)
  if (existing) return existing

  const work = (async () => {
    await acquireDigestSlot()
    try {
      return await extractThreadDigest({ messages, config, source })
    } finally {
      releaseDigestSlot()
      digestInFlight.delete(threadId)
    }
  })()

  digestInFlight.set(threadId, work)
  return work
}

/** Test helper: reset queue state between tests. */
export function __testResetDigestQueue(): void {
  digestInFlight.clear()
  digestActive = 0
  digestWaitQueue.length = 0
}

/** Validate / clamp a digest object from untrusted input. */
export function sanitizeDigest(input: unknown): ThreadDigest | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null
  const o = input as Record<string, unknown>
  const tags = normalizeTags(o.tags)
  const tldr = String(o.tldr || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TLDR)
  const fp = String(o.content_fingerprint || "0:empty").slice(0, 128)
  const source = (["manual", "scheduled", "on_export", "on_at_ref"] as const).includes(
    o.source as DigestSource,
  )
    ? (o.source as DigestSource)
    : "manual"
  let bullets: string[] | undefined
  if (Array.isArray(o.bullets)) {
    bullets = o.bullets
      .map((b) =>
        String(b || "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, MAX_BULLET),
      )
      .filter(Boolean)
      .slice(0, MAX_BULLETS)
    if (bullets.length === 0) bullets = undefined
  }
  return {
    extracted_at:
      typeof o.extracted_at === "string" && o.extracted_at
        ? o.extracted_at
        : new Date().toISOString(),
    content_fingerprint: fp,
    tldr,
    tags,
    bullets,
    source,
    model: typeof o.model === "string" ? o.model.slice(0, 128) : undefined,
  }
}

// silence unused OUT_TOKEN_HINT (documentation of target)
void OUT_TOKEN_HINT

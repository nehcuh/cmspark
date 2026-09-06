/**
 * #433 P1 读路径 — summoner 脱敏检索（thread.search / thread.peek / knowledge.search）。
 *
 * 纪律（spec §3a）：
 *   - thread.search：只搜 alias/title + 蒸馏 digest（tldr/tags/bullets）——不读消息正文，
 *     返回不含 messages 的结果；snippet 来自 digest.tldr（已 redact）。
 *   - thread.peek：distillThreadMarkdown + redactSecrets（既有#296预览同一通道），≤2000 字符。
 *   - knowledge.search：搜派生索引 title/description/tags；scoreRelatedKnowledge 一字不改。
 *   - 本模块零副作用：只读 + 纯函数；不写 SoT；调 LLM 零次。
 *
 * 匹配/打分：词首 prefix 1.0 / 包含 0.5（对 alias/title/description/tags），tldr/bullets 低权重
 * 子串 0.3；CJK 拼音首字母（pinyin-pro，仅 alias/title）命中给 0.6 加成。结果按分降序、
 * 平局按最近活跃倒序，取 limit。
 */
import { pinyin } from "pinyin-pro"
import type { ThreadDigest } from "../threads/digest"
import { distillThreadMarkdown, redactSecrets as redactSecretsLocal } from "../threads/distill"

export const SUMMONER_SEARCH_LIMIT_MAX = 20
export const SUMMONER_SEARCH_LIMIT_DEFAULT = 10
export const SUMMONER_PEEK_MAX_CHARS = 2000

/** 被检索的线程字段加权（digest 全为派生、已按 digest 纪律脱敏/限长）。 */
type ThreadSearchFields = {
  alias: string
  title: string
  digest?: { tldr?: string; tags?: string[]; bullets?: string[] } | null
}

export function clampSearchLimit(raw: unknown): number {
  const n = Number(raw)
  if (!Number.isFinite(n)) return SUMMONER_SEARCH_LIMIT_DEFAULT
  return Math.max(1, Math.min(SUMMONER_SEARCH_LIMIT_MAX, Math.trunc(n)))
}

export function normalizeSearchQuery(raw: unknown): string {
  const s = String(raw ?? "").trim().slice(0, 120)
  return s.replace(/\s+/g, " ").trim()
}

function lowerTokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff]+/)
    .filter(Boolean)
}

/** CJK 拼音首字母串（'微博'→'wb'）；非 CJK 原样字母走 token 前缀逻辑。 */
export function pinyinInitialsOf(text: string): string {
  if (!/[\u4e00-\u9fff]/.test(text)) return ""
  try {
    const s = pinyin(text, { pattern: "first", toneType: "none", type: "string" })
    return s.replace(/[^a-z]/gi, "").toLowerCase()
  } catch {
    return ""
  }
}

/** 单文本字段对一个查询词的贡献分（0-1）。 */
function fieldScore(text: string, qToken: string, isCjk: boolean): number {
  const t = String(text || "")
  const lower = t.toLowerCase()
  if (isCjk) {
    // CJK 查询：包含即中（prefix 对中文无意义）。
    return lower.includes(qToken) ? 1 : 0
  }
  for (const tok of lowerTokens(t)) {
    if (tok.startsWith(qToken)) return 1
    if (tok.includes(qToken)) return 0.5
  }
  // 拉丁查询但字段含 CJK：试拼音首字母（在 alias/title 层做，见 caller）。
  return 0
}

/**
 * 对 candidate 打分：sum(查询词 × 字段权重 × fieldScore)；拼音首字母命中（alias/title）
 * 每词 +0.6；空查询返回 0。
 */
export function scoreSearchCandidate(
  fields: Array<{ text: string; weight: number; pinyin?: boolean }>,
  query: string,
): number {
  const q = query.trim().toLowerCase()
  if (!q) return 0
  const qCjk = /[\u4e00-\u9fff]/.test(q)
  const qTokens = qCjk ? [q] : lowerTokens(q).slice(0, 6)
  let score = 0
  for (const qTok of qTokens) {
    for (const f of fields) {
      if (!f.text) continue
      score += fieldScore(f.text, qTok, qCjk) * f.weight
      if (!qCjk && f.pinyin === true) {
        const initials = pinyinInitialsOf(f.text)
        if (initials && (initials.startsWith(qTok) || initials.includes(qTok))) {
          score += 0.6
        }
      }
    }
  }
  return score
}

export type ThreadSearchHit = {
  thread_id: string
  title: string
  alias: string
  updated_at: string | null
  snippet: string
  score: number
}

/** 构建线程检索语料字段（digest 派生；绝不读消息正文）。 */
export function threadSearchFields(
  alias: string,
  digest?: ThreadSearchFields["digest"],
): Array<{ text: string; weight: number; pinyin?: boolean }> {
  const out: Array<{ text: string; weight: number; pinyin?: boolean }> = []
  const aliasTxt = String(alias || "").trim()
  if (aliasTxt) out.push({ text: aliasTxt, weight: 1.0, pinyin: true })
  const tags = Array.isArray(digest?.tags) ? digest!.tags!.map((t) => String(t).trim()).filter(Boolean) : []
  if (tags.length) out.push({ text: tags.join(" "), weight: 0.8 })
  if (digest?.tldr) out.push({ text: String(digest.tldr), weight: 0.5 })
  const bullets = Array.isArray(digest?.bullets) ? digest!.bullets!.map((b) => String(b).trim()).filter(Boolean) : []
  if (bullets.length) out.push({ text: bullets.join(" "), weight: 0.3 })
  return out
}

function threadSnippet(digest?: ThreadSearchFields["digest"]): string {
  if (!digest?.tldr) return ""
  const { text } = redactSecretsLocal(String(digest.tldr))
  return text.trim().slice(0, 200)
}

/**
 * 线程检索。rows 由调用方从 threadManager.list() 提供并已排除 worker/orchestrator/会议等
 * 系统线程（调用方负责 skip 过滤）；本函数不触碰 threadManager.getMessages —— 语义保证
 * 「检索流不读消息全文」。
 */
export function searchThreadRows(
  rows: Array<{
    id: string
    alias?: string | null
    digest?: ThreadSearchFields["digest"]
    last_message_at?: string | null
    updated_at?: string | null
    created_at?: string | null
  }>,
  query: string,
  limit: number,
): ThreadSearchHit[] {
  const out: ThreadSearchHit[] = []
  for (const r of rows) {
    const id = String(r.id || "")
    if (!id) continue
    const alias = String(r.alias || "").trim()
    const score = scoreSearchCandidate(
      threadSearchFields(alias, r.digest),
      query,
    )
    if (score <= 0) continue
    out.push({
      thread_id: id,
      title: alias || id,
      alias,
      updated_at: r.last_message_at || r.updated_at || r.created_at || null,
      snippet: threadSnippet(r.digest),
      score,
    })
  }
  out.sort(
    (a, b) => b.score - a.score || String(b.updated_at || "").localeCompare(String(a.updated_at || "")),
  )
  return out.slice(0, limit)
}

export type ThreadPeekResult = {
  ok: true
  thread_id: string
  title: string
  markdown: string
  truncated: boolean
  redacted_hits: number
}

/**
 * thread.peek：脱敏蒸馏预览 ≤2000 字符（复用 distillThreadMarkdown 同一脱敏面）。
 * 调用方需已鉴权 thread 存在。
 */
export function peekThreadDistilled(
  threadId: string,
  thread: { alias?: string | null; digest?: ThreadSearchFields["digest"] | null },
  messages: Array<{ role?: string; content?: unknown }>,
  maxChars = SUMMONER_PEEK_MAX_CHARS,
): ThreadPeekResult {
  const distilled = distillThreadMarkdown({
    alias: thread?.alias ? String(thread.alias) : undefined,
    digest: (thread?.digest ?? null) as ThreadDigest | null,
    messages: messages.map((m) => ({
      role: String(m?.role || ""),
      content: typeof m?.content === "string" ? m.content : "",
    })),
  })
  const truncated = distilled.markdown.length > maxChars
  const markdown = distilled.markdown.slice(0, maxChars)
  return {
    ok: true,
    thread_id: threadId,
    title: distilled.title,
    markdown,
    truncated,
    redacted_hits: distilled.hits,
  }
}

export type KnowledgeSearchHit = {
  id: string
  title: string
  folder: string
  snippet: string
  score: number
}

type KnowledgeDocLike = {
  id?: string
  name?: string
  title?: string
  description?: string
  tags?: string[]
  folder?: string
}

export function knowledgeSearchRows(
  docs: KnowledgeDocLike[],
  query: string,
  limit: number,
): KnowledgeSearchHit[] {
  const out: KnowledgeSearchHit[] = []
  for (const d of docs) {
    const id = String(d.id || d.name || "")
    const title = String(d.title || d.name || id)
    if (!title) continue
    const fields: Array<{ text: string; weight: number; pinyin?: boolean }> = [
      { text: title, weight: 1.0, pinyin: true },
    ]
    const desc = String(d.description || "").trim()
    if (desc) fields.push({ text: desc, weight: 0.8 })
    const tags = Array.isArray(d.tags) ? d.tags.map((t) => String(t).trim()).filter(Boolean) : []
    if (tags.length) fields.push({ text: tags.join(" "), weight: 0.8 })
    const score = scoreSearchCandidate(fields, query)
    if (score <= 0) continue
    const snippet = (desc || title).slice(0, 200)
    out.push({ id, title, folder: String(d.folder || ""), snippet, score })
  }
  out.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
  return out.slice(0, limit)
}

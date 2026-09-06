/**
 * #411 — 从全部历史对话归纳专家（方案 A：两级聚类，一次性手点扫描）。
 *
 * expert-distill.ts:11 的「无全库扫描、无跨 thread 批量」红线是 #370 时代的
 * 设计闸门；本票（issue-first）显式打破它，但以**新闸门**替代：
 *   - 只经 `pack.distill_all_scan`（user_gesture 强校验）进入；一次性、同步，
 *     无定时器、无后台扫描、无 watermark（方案 C 另票）。
 *   - 浅层画像优先（fresh digest → first/last user preview），不读全量正文；
 *     深读（≤20 条）走既有 buildDistillCorpus（8k cap + redact 不变）。
 *   - LLM 调用 = 批次数 + 归并 1 次（与 thread 数解耦）；总量 cap ≤200。
 *   - 产出 K≤5 份草稿：只进回包与内存 pendingDrafts（键 `__all__:N`），
 *     不落盘、不进 pack.list、不自动保存 —— 草稿制与 #370 完全一致。
 *   - 本模块与 expert-distill 一样**不 import pack-engine**：已装专家清单
 *     由调用方（message-router）作参数传入（结构性零写入面）。
 */
import { logger } from "../logger"
import { llmExtract, type LlmExtractConfig } from "../llm/llm-extract"
import { redactPlainText } from "../security/redact-text"
import { isDigestStale } from "../threads/digest"
import {
  DISTILL_LLM_NOTICE,
  DISTILL_RESTART_LOSS_NOTE,
  buildDistillCorpus,
  clampDistillTools,
  cleanString as cleanDistillString,
  cleanStringMultiline as cleanDistillStringMultiline,
  clampEvidence as clampDistillEvidence,
  clampStringList as clampDistillStringList,
  distillSkipReason,
  meetingLinkedThreadIds,
  recordPendingDistillDraft,
  type DistillDraft,
  type DistillEvidence,
  type DistillSkipCode,
  type DistillThreadManagerLike,
} from "./expert-distill"

/** 单次扫描总上限（设计稿：默认 ≤200 thread / 次）。 */
export const DISTILL_ALL_MAX_THREADS = 200
/** 每批浅层画像条数（设计稿：20–30）。 */
export const DISTILL_ALL_BATCH_SIZE = 25
/** 深读配额（设计稿：≤20 条走 buildDistillCorpus 全正文）。 */
export const DISTILL_ALL_DEEP_READ_MAX = 20
/** 归并产出草稿上限（issue：K ≤ 5，宁缺毋滥）。 */
export const DISTILL_ALL_MAX_DRAFTS = 5

const PROFILE_CAP = 600
const BATCH_CONTENT_CAP = 6000
const DEEP_CORPUS_PER_CAP = 1500
const DEEP_CORPUS_TOTAL_CAP = 8000
const PREVIEW_CAP = 120
const NAME_CAP = 40
const DESC_CAP = 200
const PROMPT_CAP = 8192

/** 调用方预排除（确认弹窗里可调）。 */
export interface DistillAllExclude {
  /** 跳过这些话题夹里的线程。 */
  topic_folders?: string[]
  /** 只纳入 last_message_at ≥ since 的线程（ISO）。 */
  since?: string
  /** 别名 / 首尾用户消息命中该词的线程排除（大小写不敏感）。 */
  exclude_keyword?: string
}

export interface DistillAllEvidence extends DistillEvidence {
  thread_ids?: string[]
}

export interface DistillAllDraft extends DistillDraft {
  /** 归并后的多 thread 出处（已对候选池校验，无伪造 id）。 */
  thread_ids: string[]
  /** 与已装专家（builtin/user）名字或工具面重叠 —— 用户在编辑器里裁决覆盖/另存。 */
  conflicts_with?: string
  /** 证据带多 thread 出处（协变收窄 DistillEvidence）。 */
  evidence: DistillAllEvidence[]
}

interface DistillAllThreadLike {
  id?: string
  alias?: string
  agent_role?: "normal" | "orchestrator" | "worker" | null
  trashed_at?: string | null
  digest?: any
  topic_folder?: string | null
  created_at?: string
  updated_at?: string
  last_message_at?: string | null
}

export interface DistillAllThreadManagerLike extends DistillThreadManagerLike {
  list(opts?: { include_trashed?: boolean; only_trashed?: boolean }): DistillAllThreadLike[]
  get(threadId: string): DistillAllThreadLike | null | undefined
}

/** 已装专家面（调用方传 listInstalledPacks/getPackDetail 结果；本模块不读 pack 存储）。 */
export interface InstalledExpertFace {
  name: string
  tools_allow: string[]
}

export interface DistillAllCount {
  ok: true
  eligible: number
  with_digest: number
  without_digest: number
  skipped: Partial<Record<DistillSkipCode, number>>
  capped: boolean
  notice: string
}

export interface DistillAllResult {
  ok: true
  scanned: number
  with_digest: number
  batches: number
  deep_read: number
  llm_calls: number
  drafts: DistillAllDraft[]
  notice: string
  restart_note: string
  fallback_reason?: string
}

export type DistillAllError = { ok: false; code: "llm_not_configured" | "no_candidates"; reason: string }

interface CandidateThread {
  id: string
  alias: string
  topic_folder: string | null
  sort_ts: string
  digest: any
  messages: Array<{ id?: string; role: string; content?: string }>
}

interface ShallowProfile {
  id: string
  alias: string
  used_digest: boolean
  text: string
}

// ---------------------------------------------------------------------------
// 候选池（skip 规则 + 预排除 + cap，按最近活跃倒序）。
// ---------------------------------------------------------------------------

function threadRecencyTs(t: DistillAllThreadLike): string {
  return t.last_message_at || t.updated_at || t.created_at || ""
}

function previewOf(messages: CandidateThread["messages"], first: boolean): string {
  let out = ""
  for (const m of messages) {
    if (m.role !== "user") continue
    const c = String(m.content || "").replace(/\s+/g, " ").trim()
    if (!c) continue
    out = c
    if (first) break
  }
  return out
}

/** 浅层画像：fresh digest 优先；否则 first/last user preview（不读全量正文语义）。 */
function shallowProfileText(t: CandidateThread): { text: string; used_digest: boolean } | null {
  if (t.digest && !isDigestStale(t.digest, t.messages)) {
    const d = t.digest
    const lines = [`TL;DR: ${d.tldr ?? ""}`]
    if (Array.isArray(d.tags) && d.tags.length) lines.push(`标签: ${d.tags.join(", ")}`)
    // pi 复审（PR #416）：digest 来自 index.json，垃圾形状（bullets=42）时
    // `(bullets ?? []).slice` 抛 TypeError —— 与 tags 同款 Array.isArray 守卫。
    if (Array.isArray(d.bullets)) {
      for (const b of d.bullets.slice(0, 5)) lines.push(`- ${b}`)
    }
    const text = redactPlainText(lines.join("\n").replace(/\s+/g, " ")).slice(0, PROFILE_CAP)
    if (text.trim()) return { text, used_digest: true }
  }
  const first = previewOf(t.messages, true).slice(0, PREVIEW_CAP)
  const last = previewOf(t.messages, false).slice(0, PREVIEW_CAP)
  const parts: string[] = []
  if (first) parts.push(`首问: ${first}`)
  if (last && last !== first) parts.push(`末问: ${last}`)
  const text = redactPlainText(parts.join(" · ")).slice(0, PROFILE_CAP)
  if (!text.trim()) return null
  return { text, used_digest: false }
}

function keywordHits(alias: string, messages: CandidateThread["messages"], kw: string): boolean {
  if (alias.toLowerCase().includes(kw)) return true
  return previewOf(messages, true).toLowerCase().includes(kw) ||
    previewOf(messages, false).toLowerCase().includes(kw)
}

export function buildDistillAllCandidatePool(
  threadManager: DistillAllThreadManagerLike,
  exclude?: DistillAllExclude,
): { candidates: CandidateThread[]; skipped: Partial<Record<DistillSkipCode, number>> } {
  const meetingIds = meetingLinkedThreadIds()
  const skipped: Partial<Record<DistillSkipCode, number>> = {}
  const bump = (code: DistillSkipCode) => {
    skipped[code] = (skipped[code] ?? 0) + 1
  }
  const folders = new Set((exclude?.topic_folders ?? []).map((f) => String(f || "").trim()).filter(Boolean))
  const kw = (exclude?.exclude_keyword ?? "").trim().toLowerCase()
  const sinceMs = exclude?.since ? Date.parse(exclude.since) : NaN

  const out: CandidateThread[] = []
  for (const thread of threadManager.list()) {
    const skip = distillSkipReason(thread, meetingIds)
    if (skip) {
      bump(skip.code)
      continue
    }
    const id = thread.id || ""
    if (!id) continue
    const messages = threadManager.getMessages(id)
    if (messages.length === 0) {
      bump("empty_thread")
      continue
    }
    const candidate: CandidateThread = {
      id,
      alias: String(thread.alias || ""),
      topic_folder: thread.topic_folder ?? null,
      sort_ts: threadRecencyTs(thread),
      digest: thread.digest ?? null,
      messages,
    }
    if (folders.size > 0 && candidate.topic_folder && folders.has(candidate.topic_folder)) continue
    if (!Number.isNaN(sinceMs)) {
      const ts = Date.parse(candidate.sort_ts)
      if (!Number.isNaN(ts) && ts < sinceMs) continue
    }
    if (kw && keywordHits(candidate.alias, messages, kw)) continue
    out.push(candidate)
  }
  out.sort((a, b) => (a.sort_ts < b.sort_ts ? 1 : a.sort_ts > b.sort_ts ? -1 : a.id.localeCompare(b.id)))
  return { candidates: out, skipped }
}

function profilesOf(candidates: CandidateThread[]): {
  profiles: ShallowProfile[]
  with_digest: number
  empty_dropped: number
} {
  const profiles: ShallowProfile[] = []
  let with_digest = 0
  let empty_dropped = 0
  for (const t of candidates) {
    const p = shallowProfileText(t)
    if (!p) {
      empty_dropped++
      continue
    }
    if (p.used_digest) with_digest++
    profiles.push({ id: t.id, alias: t.alias, used_digest: p.used_digest, text: p.text })
  }
  return { profiles, with_digest, empty_dropped }
}

/** count_only：只算池子与 digest 覆盖，零 LLM 调用（确认弹窗的 N）。 */
export function distillAllScanCount(
  threadManager: DistillAllThreadManagerLike,
  exclude?: DistillAllExclude,
): DistillAllCount {
  const { candidates, skipped } = buildDistillAllCandidatePool(threadManager, exclude)
  const capped = candidates.length > DISTILL_ALL_MAX_THREADS
  const top = candidates.slice(0, DISTILL_ALL_MAX_THREADS)
  const { profiles, with_digest } = profilesOf(top)
  return {
    ok: true,
    eligible: profiles.length,
    with_digest,
    without_digest: profiles.length - with_digest,
    skipped,
    capped,
    notice: DISTILL_LLM_NOTICE,
  }
}

// ---------------------------------------------------------------------------
// LLM：批内候选角色 → 跨批归并（全部 user_gesture 可追溯，见路由层）。
// ---------------------------------------------------------------------------

function parseJsonLine<T = Record<string, unknown>>(raw: string): T | null {
  let text = String(raw || "").trim()
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) text = fence[1].trim()
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(text.slice(start, end + 1)) as T
  } catch {
    return null
  }
}

interface BatchCandidate {
  name: string
  description: string
  thread_ids: string[]
  signal: string
}

const BATCH_SYSTEM_PROMPT = `你是专家角色聚类助手。输入是历史对话的浅层画像（每行一条：线程id、标题、摘要或首末问句；已脱敏）。输出**仅一行 JSON**（不要 markdown 围栏、不要解释）:
{"candidates":[{"name":"专家名≤20字","description":"一句话职责≤60字","thread_ids":["id1","id2"],"signal":"为什么判断存在这个角色"},{"name":"","description":"","thread_ids":[],"signal":""}],"deep_read":["id"]}

规则:
- candidates 只保留**跨 ≥2 条线程反复出现**的角色；单线程孤例不输出
- 相似角色合并不裂变（如「macOS 发布工程」与「macOS 打包出包」是同一角色）
- thread_ids 只能使用输入中出现的 id，不得编造
- deep_read 列出浅层信号不足以判断、需要读全文的线程 id（每批 ≤3 个，没有就空数组）
- 最多 6 个候选；没有就空数组
- 只输出 JSON 对象本身`

interface MergedDraftRaw {
  name?: unknown
  description?: unknown
  system_prompt_append?: unknown
  tools?: unknown
  suitable_for?: unknown
  unsuitable_for?: unknown
  evidence?: unknown
  thread_ids?: unknown
  conflicts_with?: unknown
}

const MERGE_SYSTEM_PROMPT = `你是专家角色归并助手。输入是各批次汇总的候选角色（含 thread_ids 与信号）、部分线程的全文摘要（深读）、以及已安装专家清单。输出**仅一行 JSON**（不要 markdown 围栏、不要解释）:
{"drafts":[{"name":"专家名≤20字","description":"一句话职责≤80字","system_prompt_append":"专家系统提示词，200-600字，含能力边界","tools":["只读/低危工具"],"suitable_for":["适合"],"unsuitable_for":["不适合"],"evidence":[{"quote":"画像或原文的短引用≤60字","hint":"为什么","thread_ids":["id1","id2"]}],"conflicts_with":""}]}

规则:
- 输出最多 5 份草稿，宁缺毋滥；优先合并相似角色而非裂变
- 每份草稿的 evidence 必须来自 ≥2 条不同线程，thread_ids 只用输入中出现过的 id
- tools 只能从这些里选: get_page_text, get_page_html, get_element_info, list_tabs, screenshot, navigate, click, scroll
- 不得编造画像里没有的能力
- 与已安装专家高度重叠（名字相同或职责+工具面都接近）的仍要输出，但在 conflicts_with 填该专家名，由用户裁决覆盖/另存
- 只输出 JSON 对象本身`

export interface DistillAllDeps {
  /** 测试注入；生产用 llm-extract 真实现。 */
  llmExtractImpl?: typeof llmExtract
  now?: () => Date
}

function validIds(raw: unknown, known: Set<string>, cap: number): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (typeof item !== "string") continue
    if (!known.has(item) || seen.has(item)) continue
    seen.add(item)
    out.push(item)
    if (out.length >= cap) break
  }
  return out
}

/** 名字精确（大小写不敏感）或工具面 Jaccard ≥0.8 视为与已装专家冲突。 */
export function detectExpertConflict(
  draft: { name: string; tools: string[] },
  installed: InstalledExpertFace[],
): string | null {
  const dn = draft.name.trim().toLowerCase()
  for (const e of installed) {
    if (e.name.trim().toLowerCase() === dn && dn) return e.name
  }
  for (const e of installed) {
    const a = new Set(e.tools_allow)
    if (a.size === 0) continue
    const b = new Set(draft.tools)
    if (b.size === 0) continue
    let inter = 0
    for (const t of b) if (a.has(t)) inter++
    const union = a.size + b.size - inter
    if (union > 0 && inter / union >= 0.8) return e.name
  }
  return null
}

function clampAllEvidence(raw: unknown, known: Set<string>): DistillAllEvidence[] {
  const base = clampDistillEvidence(raw)
  // clampDistillEvidence 只保 quote/hint；thread_ids 在这里补（对已知 id 校验）。
  const arr = Array.isArray(raw) ? raw : []
  return base.map((e, i) => {
    const src = (arr[i] ?? {}) as Record<string, unknown>
    const ids = validIds(src.thread_ids, known, 6)
    return ids.length ? { ...e, thread_ids: ids } : e
  })
}

export async function distillAllExperts(args: {
  threadManager: DistillAllThreadManagerLike
  llm: LlmExtractConfig | null
  installedExperts?: InstalledExpertFace[]
  exclude?: DistillAllExclude
  deps?: DistillAllDeps
}): Promise<DistillAllResult | DistillAllError> {
  if (!args.llm?.base_url || !args.llm?.model_name) {
    return { ok: false, code: "llm_not_configured", reason: "未配置 LLM —— 全历史归纳依赖 LLM 聚类" }
  }
  const { candidates, skipped } = buildDistillAllCandidatePool(args.threadManager, args.exclude)
  const top = candidates.slice(0, DISTILL_ALL_MAX_THREADS)
  const { profiles, with_digest } = profilesOf(top)
  if (profiles.length === 0) {
    return { ok: false, code: "no_candidates", reason: `没有可归纳的线程（skip: ${JSON.stringify(skipped)}）` }
  }

  const run = args.deps?.llmExtractImpl ?? llmExtract
  const knownIds = new Set(profiles.map((p) => p.id))
  const idToAlias = new Map(profiles.map((p) => [p.id, p.alias]))
  let llmCalls = 0
  let batchFailures = 0

  // ---- 批内候选角色 ----
  const batches: ShallowProfile[][] = []
  for (let i = 0; i < profiles.length; i += DISTILL_ALL_BATCH_SIZE) {
    batches.push(profiles.slice(i, i + DISTILL_ALL_BATCH_SIZE))
  }
  const candidatesOut: BatchCandidate[] = []
  const deepReadWanted: string[] = []
  for (const batch of batches) {
    const lines = batch.map((p) => `[${p.id}] ${p.alias || "(无标题)"} · ${p.used_digest ? "摘要" : "首末问"}: ${p.text}`)
    const content = lines.join("\n").slice(0, BATCH_CONTENT_CAP)
    const batchKnown = new Set(batch.map((p) => p.id))
    try {
      llmCalls++
      const raw = await run({
        systemPrompt: BATCH_SYSTEM_PROMPT,
        userContent: content,
        config: args.llm,
        temperatureCap: 0.3,
      })
      const parsed = parseJsonLine(raw)
      const list = parsed && Array.isArray((parsed as any).candidates) ? (parsed as any).candidates : []
      for (const c of list) {
        if (!c || typeof c !== "object") continue
        const ids = validIds((c as any).thread_ids, batchKnown, 50)
        // 跨 ≥2 线程才成角色（companion 侧硬校验，不靠 prompt 自觉）
        if (ids.length < 2) continue
        const name = cleanDistillString((c as any).name, NAME_CAP)
        if (!name) continue
        candidatesOut.push({
          name,
          description: cleanDistillString((c as any).description, DESC_CAP),
          thread_ids: ids,
          signal: cleanDistillString((c as any).signal, 160),
        })
      }
      const deep = validIds((parsed as any)?.deep_read, batchKnown, 3)
      for (const id of deep) {
        if (!deepReadWanted.includes(id)) deepReadWanted.push(id)
      }
    } catch (e) {
      batchFailures++
      logger.warn("packs.distill_all.batch_failed", {
        batch_size: batch.length,
        error: e instanceof Error ? e.message : String(e),
      })
    }
  }

  // ---- 深读（≤20，走既有 buildDistillCorpus：8k cap + redact 不变）----
  const deepRead = deepReadWanted.slice(0, DISTILL_ALL_DEEP_READ_MAX)
  const deepCorpora: string[] = []
  let deepUsed = 0
  for (const id of deepRead) {
    const built = buildDistillCorpus(id, args.threadManager)
    if (!built.ok) continue
    deepUsed++
    const alias = idToAlias.get(id) || id
    deepCorpora.push(`[${id}] ${alias} 全文摘要:\n${built.corpus.text.slice(0, DEEP_CORPUS_PER_CAP)}`)
    if (deepCorpora.join("\n\n").length >= DEEP_CORPUS_TOTAL_CAP) break
  }

  // ---- 跨批归并 ----
  const installed = args.installedExperts ?? []
  let drafts: DistillAllDraft[] = []
  let fallbackReason: string | undefined
  if (candidatesOut.length > 0) {
    const candLines = candidatesOut.map(
      (c) => `- ${c.name}｜${c.description}｜threads: ${c.thread_ids.join(",")}｜信号: ${c.signal}`,
    )
    const installedLine = installed.length
      ? installed.map((e) => `${e.name}(${e.tools_allow.join("/") || "无工具"})`).join("、")
      : "（无）"
    const content =
      `候选角色（跨批汇总）:\n${candLines.join("\n").slice(0, BATCH_CONTENT_CAP)}\n\n` +
      `深读全文摘要:\n${deepCorpora.join("\n\n") || "（无）"}\n\n` +
      `已安装专家（归并去重参照）: ${installedLine}`
    try {
      llmCalls++
      const raw = await run({
        systemPrompt: MERGE_SYSTEM_PROMPT,
        userContent: content,
        config: args.llm,
        temperatureCap: 0.3,
      })
      const parsed = parseJsonLine(raw)
      const list = parsed && Array.isArray((parsed as any).drafts) ? (parsed as any).drafts : []
      for (const d of list) {
        if (!d || typeof d !== "object") continue
        const dr = d as MergedDraftRaw
        const name = cleanDistillString(dr.name, NAME_CAP)
        const prompt = cleanDistillStringMultiline(dr.system_prompt_append, PROMPT_CAP)
        if (!name || !prompt) continue
        const threadIds = validIds(dr.thread_ids, knownIds, 50)
        if (threadIds.length < 2) continue
        const tools = clampDistillTools(dr.tools)
        const conflict = detectExpertConflict({ name, tools }, installed)
        const draft: DistillAllDraft = {
          name,
          description: cleanDistillString(dr.description, DESC_CAP),
          system_prompt_append: prompt,
          tools: { mode: "allowlist", allow: tools },
          ...(Array.isArray(dr.suitable_for)
            ? { suitable_for: clampDistillStringList(dr.suitable_for, 4, 60) }
            : {}),
          ...(Array.isArray(dr.unsuitable_for)
            ? { unsuitable_for: clampDistillStringList(dr.unsuitable_for, 4, 60) }
            : {}),
          evidence: clampAllEvidence(dr.evidence, knownIds),
          thread_ids: threadIds,
          ...(conflict ? { conflicts_with: conflict } : {}),
        }
        drafts.push(draft)
      }
    } catch (e) {
      fallbackReason = "LLM 归并调用失败"
      logger.warn("packs.distill_all.merge_failed", { error: e instanceof Error ? e.message : String(e) })
    }
  } else {
    fallbackReason = batchFailures > 0 ? "全部批次的 LLM 调用失败" : "浅层画像中没有跨线程反复出现的角色"
  }

  drafts = drafts.slice(0, DISTILL_ALL_MAX_DRAFTS)

  // 草稿入内存 pending（键 __all__:N；与 #370 同一重启即丢语义，不落盘）。
  const at = (args.deps?.now ?? (() => new Date()))().toISOString()
  drafts.forEach((d, i) => {
    recordPendingDistillDraft(`__all__:${i + 1}`, d, "llm", false, at)
  })

  logger.info("packs.distill_all.done", {
    scanned: profiles.length,
    with_digest,
    batches: batches.length,
    deep_read: deepUsed,
    drafts: drafts.length,
    llm_calls: llmCalls,
    batch_failures: batchFailures,
  })

  return {
    ok: true,
    scanned: profiles.length,
    with_digest,
    batches: batches.length,
    deep_read: deepUsed,
    llm_calls: llmCalls,
    drafts,
    notice: DISTILL_LLM_NOTICE,
    restart_note: DISTILL_RESTART_LOSS_NOTE,
    ...(fallbackReason ? { fallback_reason: fallbackReason } : {}),
  }
}

/**
 * #370 I4 — 从本对话归纳专家草稿（手点 + armed 队列，F-S-7 零破例）。
 *
 * 草稿制红线（结构性保证，不是注释约定）：
 *   - 本模块 **不 import pack-engine / saveUserPack / installPack**——preview
 *     路径对 pack 存储零写入面；保存只经既有 `pack.save_user`（用户在编辑器确认）。
 *   - 草稿只存在于 WS 回包与会话内存（pendingDrafts）——永不落盘、不进 pack.list。
 *   - armed 队列文件只存任务指针（thread_id）+ 语料 id（message ids）+ 计数，
 *     任何 LLM 产出一律不落盘；重启仅恢复指针（未审草稿重启即丢，调用方须写明）。
 *   - 每次 llmExtract 都可追溯到 user_gesture（手点 preview / arm 后的 drain 手点）；
 *     无定时器、无全库扫描、无跨 thread 批量（drain 一次一条）。
 */
import * as fs from "node:fs"
import * as path from "node:path"
import { logger } from "../logger"
import { getConfigDir } from "../config"
import { llmExtract, type LlmExtractConfig } from "../llm/llm-extract"
import { redactPlainText } from "../security/redact-text"
import { isDigestStale, type ThreadDigest } from "../threads/digest"

/** 保守工具面：浏览器只读 + I2 允许 QA/开发专家的低危导航项；硬禁项不在此列。 */
export const SAFE_DISTILL_TOOLS: readonly string[] = [
  "get_page_text",
  "get_page_html",
  "get_element_info",
  "list_tabs",
  "screenshot",
  "navigate",
  "click",
  "scroll",
]

const CORPUS_CAP = 8000
const PER_MSG_CAP = 600
const NAME_CAP = 40
const DESC_CAP = 200
const PROMPT_CAP = 8192
const EVIDENCE_MAX = 6
const EVIDENCE_QUOTE_CAP = 120
const CORPUS_IDS_CAP = 200
const MAX_QUEUE = 20

export interface DistillEvidence {
  quote: string
  hint?: string
}

export interface DistillDraft {
  name: string
  description: string
  system_prompt_append: string
  tools: { mode: "allowlist"; allow: string[] }
  suitable_for?: string[]
  unsuitable_for?: string[]
  evidence: DistillEvidence[]
}

export type DistillSkipCode =
  | "thread_not_found"
  | "trashed_thread"
  | "worker_or_orchestrator_thread"
  | "meeting_thread"
  | "empty_thread"

export interface DistillOk {
  ok: true
  draft: DistillDraft
  source: "llm" | "heuristic"
  used_digest: boolean
  corpus_chars: number
  corpus_ids: string[]
  notice: string
  fallback_reason?: string
}

export interface DistillSkip {
  ok: false
  code: DistillSkipCode
  reason: string
}

export const DISTILL_LLM_NOTICE = "摘要将发给你配置的 LLM（与聊天同一服务商）"
export const DISTILL_RESTART_LOSS_NOTE =
  "重启仅恢复队列任务指针；已归纳、未审阅的草稿不会保留"

// ---------------------------------------------------------------------------
// 保守 clamp：LLM 产出的每一段都当不可信输入处理。
// ---------------------------------------------------------------------------

// #411 起由 expert-distill-all 复用（同一 clamp 纪律，单一定义点）。
export function cleanString(raw: unknown, cap: number): string {
  if (typeof raw !== "string") return ""
  return redactPlainText(
    raw.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "").replace(/\s+/g, " ").trim(),
  ).slice(0, cap)
}

export function cleanStringMultiline(raw: unknown, cap: number): string {
  if (typeof raw !== "string") return ""
  return redactPlainText(
    raw.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "").trim(),
  ).slice(0, cap)
}

export function clampDistillTools(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const safe = new Set(SAFE_DISTILL_TOOLS)
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    if (typeof item !== "string") continue
    const t = item.trim()
    if (!t || !safe.has(t) || seen.has(t)) continue
    seen.add(t)
    out.push(t)
    if (out.length >= SAFE_DISTILL_TOOLS.length) break
  }
  return out
}

export function clampEvidence(raw: unknown): DistillEvidence[] {
  if (!Array.isArray(raw)) return []
  const out: DistillEvidence[] = []
  for (const item of raw) {
    if (!item || typeof item !== "object") continue
    const o = item as Record<string, unknown>
    const quote = cleanString(o.quote, EVIDENCE_QUOTE_CAP)
    if (!quote) continue
    const hint = cleanString(o.hint, 60)
    out.push(hint ? { quote, hint } : { quote })
    if (out.length >= EVIDENCE_MAX) break
  }
  return out
}

export function clampStringList(raw: unknown, cap: number, itemCap: number): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    const s = cleanString(item, itemCap)
    if (!s || seen.has(s)) continue
    seen.add(s)
    out.push(s)
    if (out.length >= cap) break
  }
  return out
}

// ---------------------------------------------------------------------------
// 语料构建（优先 digest；否则正文 cap 8k；逐条脱敏）。
// ---------------------------------------------------------------------------

export interface DistillCorpus {
  text: string
  used_digest: boolean
  corpus_ids: string[]
}

interface DistillThreadLike {
  id?: string
  alias?: string
  agent_role?: "normal" | "orchestrator" | "worker" | null
  trashed_at?: string | null
  digest?: ThreadDigest | null
}

interface DistillMessageLike {
  id?: string
  role: string
  content?: string
}

export interface DistillThreadManagerLike {
  get(threadId: string): DistillThreadLike | null | undefined
  getMessages(threadId: string): DistillMessageLike[]
}

export function meetingLinkedThreadIds(): Set<string> {
  try {
    // 动态 import 不可用（同步路径）；meeting-store 是纯 fs 模块，直接 require 形态。
    // 显式传 getConfigDir()（与队列文件同根）——listMeetings 缺省用 import-time
    // DATA_DIR，测试用 CMSPARK_DATA_DIR 重定向时会与本模块其它路径分叉。
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { listMeetings } = require("../meeting/meeting-store") as typeof import("../meeting/meeting-store")
    const ids = new Set<string>()
    for (const m of listMeetings(getConfigDir())) {
      if (m.thread_id) ids.add(m.thread_id)
    }
    return ids
  } catch {
    return new Set<string>()
  }
}

/** 跳过规则：worker/orchestrator/会议/回收站/不存在——返回 null 表示不跳。 */
export function distillSkipReason(
  thread: DistillThreadLike | null | undefined,
  meetingIds?: Set<string>,
): DistillSkip | null {
  if (!thread) {
    return { ok: false, code: "thread_not_found", reason: "线程不存在" }
  }
  if (thread.trashed_at) {
    return { ok: false, code: "trashed_thread", reason: "线程已在回收站" }
  }
  if (thread.agent_role === "worker" || thread.agent_role === "orchestrator") {
    return {
      ok: false,
      code: "worker_or_orchestrator_thread",
      reason: "worker / orchestrator 线程不作为归纳语料",
    }
  }
  if (meetingIds?.has((thread as { id?: string }).id || "")) {
    return { ok: false, code: "meeting_thread", reason: "会议线程不作为归纳语料" }
  }
  return null
}

export function buildDistillCorpus(
  threadId: string,
  threadManager: DistillThreadManagerLike,
): { ok: true; corpus: DistillCorpus } | DistillSkip {
  const thread = threadManager.get(threadId)
  const skip = distillSkipReason(thread, meetingLinkedThreadIds())
  if (skip) return skip
  const th = thread as DistillThreadLike & { id: string }
  const messages = threadManager.getMessages(threadId)
  const corpusIds = messages
    .map((m) => (typeof m.id === "string" && m.id ? m.id : ""))
    .filter(Boolean)
    .slice(0, CORPUS_IDS_CAP)

  // 优先已有 digest（未过期）——小、已收敛、隐私面更小。
  if (th.digest && !isDigestStale(th.digest, messages)) {
    const d = th.digest
    const lines = [`TL;DR: ${d.tldr}`]
    // digest 来自 index.json，垃圾形状（tags/bullets 非数组）时 join/for-of 抛
    // TypeError —— 与 #416 复审同款 Array.isArray 守卫（tags 为字符串时 .join 同样抛）。
    if (Array.isArray(d.tags) && d.tags.length) lines.push(`标签: ${d.tags.join(", ")}`)
    if (Array.isArray(d.bullets)) {
      for (const b of d.bullets) lines.push(`- ${b}`)
    }
    const text = redactPlainText(lines.join("\n")).slice(0, CORPUS_CAP)
    if (text.trim()) return { ok: true, corpus: { text, used_digest: true, corpus_ids: corpusIds } }
  }

  const lines: string[] = []
  let used = 0
  for (const m of messages) {
    if (m.role !== "user" && m.role !== "assistant") continue
    const redacted = redactPlainText(String(m.content || "").replace(/\s+/g, " ").trim())
    if (!redacted) continue
    const capped =
      redacted.length > PER_MSG_CAP ? redacted.slice(0, PER_MSG_CAP) + "…" : redacted
    const line = `${m.role === "user" ? "用户" : "Agent"}: ${capped}`
    if (used + line.length > CORPUS_CAP && lines.length > 0) {
      lines.push("…(已截断)")
      break
    }
    lines.push(line)
    used += line.length
    if (used >= CORPUS_CAP) break
  }
  const text = lines.join("\n").slice(0, CORPUS_CAP + 64)
  if (!text.trim()) return { ok: false, code: "empty_thread", reason: "线程没有可归纳的正文" }
  return { ok: true, corpus: { text, used_digest: false, corpus_ids: corpusIds } }
}

// ---------------------------------------------------------------------------
// llmExtract 一次出草稿 + 失败启发式空草稿。
// ---------------------------------------------------------------------------

const DISTILL_SYSTEM_PROMPT = `你是专家角色草稿助手。根据对话摘录（已脱敏）输出**仅一行 JSON**（不要 markdown 围栏、不要解释）:
{"name":"专家名≤20字","description":"一句话职责≤80字","system_prompt_append":"专家系统提示词，200-600字，含能力边界","tools":["只读/低危工具"],"suitable_for":["适合"],"unsuitable_for":["不适合"],"evidence":[{"quote":"对话原文短引用≤60字","hint":"为什么"}]}

规则:
- tools 只能从这些里选: ${SAFE_DISTILL_TOOLS.join(", ")}
- 不得编造对话里没有的能力；证据 quote 必须摘自对话
- unsuitable_for 至少写明不适合做的事（如需主机操作、需密钥的场景）
- 只输出 JSON 对象本身`

function heuristicDraft(threadAlias: string | undefined): DistillDraft {
  return {
    name: cleanString(threadAlias, NAME_CAP) || "专家草稿",
    description: "（LLM 不可用——启发式空草稿，请手动补全）",
    system_prompt_append: "",
    tools: { mode: "allowlist", allow: [] },
    evidence: [],
  }
}

function parseDraftJson(raw: string): Partial<DistillDraft> | null {
  let text = (raw || "").trim()
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) text = fence[1].trim()
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(text.slice(start, end + 1)) as Partial<DistillDraft>
  } catch {
    return null
  }
}

export interface DistillDeps {
  /** 测试注入；生产用 llm-extract 真实现。 */
  llmExtractImpl?: typeof llmExtract
  now?: () => Date
}

export async function distillExpertDraft(args: {
  thread_id: string
  threadManager: DistillThreadManagerLike
  llm: LlmExtractConfig | null
  deps?: DistillDeps
}): Promise<DistillOk | DistillSkip> {
  const built = buildDistillCorpus(args.thread_id, args.threadManager)
  if (!built.ok) return built
  const { text, used_digest, corpus_ids } = built.corpus
  const thread = args.threadManager.get(args.thread_id)
  const alias = thread?.alias

  const run = args.deps?.llmExtractImpl ?? llmExtract
  if (args.llm?.base_url && args.llm?.model_name) {
    try {
      const raw = await run({
        systemPrompt: DISTILL_SYSTEM_PROMPT,
        userContent: text,
        config: args.llm,
        temperatureCap: 0.3,
      })
      const parsed = parseDraftJson(raw)
      if (parsed) {
        const prompt = cleanStringMultiline(parsed.system_prompt_append, PROMPT_CAP)
        const name = cleanString(parsed.name, NAME_CAP)
        if (name && prompt) {
          return {
            ok: true,
            source: "llm",
            used_digest,
            corpus_chars: text.length,
            corpus_ids,
            notice: DISTILL_LLM_NOTICE,
            draft: {
              name,
              description: cleanString(parsed.description, DESC_CAP),
              system_prompt_append: prompt,
              tools: { mode: "allowlist", allow: clampDistillTools(parsed.tools) },
              ...(Array.isArray(parsed.suitable_for)
                ? { suitable_for: clampStringList(parsed.suitable_for, 4, 60) }
                : {}),
              ...(Array.isArray(parsed.unsuitable_for)
                ? { unsuitable_for: clampStringList(parsed.unsuitable_for, 4, 60) }
                : {}),
              evidence: clampEvidence(parsed.evidence),
            },
          }
        }
      }
      logger.warn("packs.distill.llm_unparsed", { thread_id: args.thread_id })
      return {
        ok: true,
        source: "heuristic",
        used_digest,
        corpus_chars: text.length,
        corpus_ids,
        notice: DISTILL_LLM_NOTICE,
        fallback_reason: "LLM 输出无法解析为草稿",
        draft: heuristicDraft(alias),
      }
    } catch (e) {
      logger.warn("packs.distill.llm_failed", {
        thread_id: args.thread_id,
        error: e instanceof Error ? e.message : String(e),
      })
      return {
        ok: true,
        source: "heuristic",
        used_digest,
        corpus_chars: text.length,
        corpus_ids,
        notice: DISTILL_LLM_NOTICE,
        fallback_reason: "LLM 调用失败",
        draft: heuristicDraft(alias),
      }
    }
  }
  // 无 LLM 配置：启发式空草稿，面板照常可用。
  return {
    ok: true,
    source: "heuristic",
    used_digest,
    corpus_chars: text.length,
    corpus_ids,
    notice: DISTILL_LLM_NOTICE,
    fallback_reason: "未配置 LLM",
    draft: heuristicDraft(alias),
  }
}

// ---------------------------------------------------------------------------
// armed 队列（默认 off；仅任务指针 + 语料 id 落盘；LLM 产出永不落盘）。
// ---------------------------------------------------------------------------

export interface DistillQueueItem {
  thread_id: string
  enqueued_at: string
  /** 语料 id（message ids）——落盘仅指针，无正文、无草稿。 */
  corpus_ids: string[]
}

export interface DistillQueueState {
  armed: boolean
  items: DistillQueueItem[]
  updated_at?: string
}

function queueFilePath(): string {
  return path.join(getConfigDir(), "cache", "expert-distill-queue.json")
}

export function loadDistillQueue(): DistillQueueState {
  try {
    const raw = fs.readFileSync(queueFilePath(), "utf-8")
    const parsed = JSON.parse(raw) as Partial<DistillQueueState>
    const items = Array.isArray(parsed.items)
      ? parsed.items
          .filter(
            (it): it is DistillQueueItem =>
              !!it &&
              typeof it === "object" &&
              typeof (it as DistillQueueItem).thread_id === "string" &&
              (it as DistillQueueItem).thread_id !== "",
          )
          .slice(0, MAX_QUEUE)
      : []
    return { armed: parsed.armed === true, items }
  } catch {
    // 缺文件/坏文件 = 默认 off + 空队列（fail-safe，不armed）。
    return { armed: false, items: [] }
  }
}

export function saveDistillQueue(state: DistillQueueState): void {
  const file = queueFilePath()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const payload: DistillQueueState = {
    armed: state.armed === true,
    items: state.items.slice(0, MAX_QUEUE),
  }
  // 原子写 + 0600（与 obsidian 缓存同纪律）。
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), { mode: 0o600 })
  fs.chmodSync(tmp, 0o600)
  fs.renameSync(tmp, file)
}

export function armDistillQueue(
  thread_id: string,
  corpus_ids: string[],
): { ok: true; armed: true; queue_len: number } {
  const state = loadDistillQueue()
  if (!state.items.some((it) => it.thread_id === thread_id)) {
    state.items.push({
      thread_id,
      enqueued_at: new Date().toISOString(),
      corpus_ids: corpus_ids.slice(0, CORPUS_IDS_CAP),
    })
    state.items = state.items.slice(-MAX_QUEUE)
  }
  state.armed = true
  saveDistillQueue(state)
  logger.info("packs.distill.armed", { thread_id, queue_len: state.items.length })
  return { ok: true, armed: true, queue_len: state.items.length }
}

export function disarmDistillQueue(): { ok: true; armed: false; queue_len: 0 } {
  saveDistillQueue({ armed: false, items: [] })
  logger.info("packs.distill.disarmed", {})
  return { ok: true, armed: false, queue_len: 0 }
}

// 会话内存 pending 草稿（重启即丢——DISTILL_RESTART_LOSS_NOTE 写明）。
const pendingDrafts = new Map<
  string,
  { draft: DistillDraft; source: "llm" | "heuristic"; used_digest: boolean; at: string }
>()

export function getPendingDistillDraft(thread_id: string) {
  return pendingDrafts.get(thread_id) ?? null
}

export function listPendingDistillDrafts(): Array<{ thread_id: string; source: string; at: string }> {
  return Array.from(pendingDrafts.entries()).map(([thread_id, v]) => ({
    thread_id,
    source: v.source,
    at: v.at,
  }))
}

export function clearPendingDistillDraft(thread_id: string): void {
  pendingDrafts.delete(thread_id)
}

/**
 * #411 — 全历史归纳草稿入内存 pending（键如 `__all__:N`）。与 queue drain
 * 写入同构：仅会话内存，永不落盘；保存仍只经 pack.save_user（用户审阅）。
 */
export function recordPendingDistillDraft(
  key: string,
  draft: DistillDraft,
  source: "llm" | "heuristic",
  used_digest: boolean,
  at?: string,
): void {
  pendingDrafts.set(key, {
    draft,
    source,
    used_digest,
    at: at ?? new Date().toISOString(),
  })
}

/**
 * 空闲续跑：一次手点 drain 一条（不批量）。armed 默认 off；目标 thread 仍走
 * 同一套跳过规则 + 脱敏 + clamp。草稿存 pending（内存）并随回包返回。
 */
export async function drainDistillQueue(args: {
  threadManager: DistillThreadManagerLike
  llm: LlmExtractConfig | null
  deps?: DistillDeps
}): Promise<
  | {
      ok: true
      drained: true
      thread_id: string
      draft: DistillDraft
      source: "llm" | "heuristic"
      used_digest: boolean
      remaining: number
      skip?: DistillSkipCode
    }
  | { ok: false; code: "not_armed" | "queue_empty" | "busy"; reason: string }
> {
  const state = loadDistillQueue()
  if (!state.armed) return { ok: false, code: "not_armed", reason: "队列未 armed（默认关闭）" }
  const item = state.items[0]
  if (!item) return { ok: false, code: "queue_empty", reason: "队列为空" }

  const result = await distillExpertDraft({
    thread_id: item.thread_id,
    threadManager: args.threadManager,
    llm: args.llm,
    deps: args.deps,
  })

  if (result.ok) {
    state.items = state.items.slice(1)
    saveDistillQueue(state)
    pendingDrafts.set(item.thread_id, {
      draft: result.draft,
      source: result.source,
      used_digest: result.used_digest,
      at: new Date().toISOString(),
    })
    logger.info("packs.distill.drained", {
      thread_id: item.thread_id,
      source: result.source,
      remaining: state.items.length,
    })
    return {
      ok: true,
      drained: true,
      thread_id: item.thread_id,
      draft: result.draft,
      source: result.source,
      used_digest: result.used_digest,
      remaining: state.items.length,
    }
  }

  // 跳过类（worker/会议/空线程…）：弹出并报告，不消耗 LLM。
  state.items = state.items.slice(1)
  saveDistillQueue(state)
  logger.info("packs.distill.drain_skipped", {
    thread_id: item.thread_id,
    code: result.code,
    remaining: state.items.length,
  })
  return {
    ok: true,
    drained: true,
    thread_id: item.thread_id,
    draft: heuristicDraft(args.threadManager.get(item.thread_id)?.alias),
    source: "heuristic",
    used_digest: false,
    remaining: state.items.length,
    skip: result.code,
  }
}

export function distillQueueStatus(): {
  armed: boolean
  queue: Array<{ thread_id: string; enqueued_at: string }>
  pending: Array<{ thread_id: string; source: string; at: string }>
  restart_note: string
} {
  const state = loadDistillQueue()
  return {
    armed: state.armed,
    queue: state.items.map((it) => ({
      thread_id: it.thread_id,
      enqueued_at: it.enqueued_at,
    })),
    pending: listPendingDistillDrafts(),
    restart_note: DISTILL_RESTART_LOSS_NOTE,
  }
}

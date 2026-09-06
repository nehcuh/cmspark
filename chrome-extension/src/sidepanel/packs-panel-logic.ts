// #369: 「场景与专家」面板纯逻辑 — 分段 / 专家卡动作 / 空态与 CTA 文案。
// 抽成纯函数以便 node:test 断言（UI 不挂 React）。

/** 面板分段：场景 = kind≠expert；专家 = kind=expert 的 pack。 */
export type PackSegment = "scene" | "expert"

export type SegmentPackLike = {
  id: string
  kind?: "mission" | "expert"
  origin?: "builtin" | "installed" | "user"
  editable?: boolean
  disabled?: boolean
}

export function isExpertPack(p: Pick<SegmentPackLike, "kind">): boolean {
  return p.kind === "expert"
}

export function segmentPacks<T extends Pick<SegmentPackLike, "kind">>(
  packs: T[],
): { scenes: T[]; experts: T[] } {
  const scenes: T[] = []
  const experts: T[] = []
  for (const p of packs) {
    if (isExpertPack(p)) experts.push(p)
    else scenes.push(p)
  }
  return { scenes, experts }
}

export function isUserPack(p: Pick<SegmentPackLike, "origin" | "editable">): boolean {
  return p.editable === true || p.origin === "user"
}

/**
 * 专家卡动作集。纪律：
 * - builtin/installed 只读 — 永远不出 编辑/删除（可 查看 只读、另存为我的）。
 * - 停用后不出 派出/套用（propose/spawn 已被 companion 拒绝，UI 不误导）；
 *   只读编辑器仍可打开（view）。
 */
export type ExpertCardAction =
  | "team" // 主 CTA：派到当前任务（组队）— #371 未落地，UI 渲染为 disabled+即将推出
  | "apply" // 次 CTA：套到本对话
  | "view" // 只读查看（明文 prompt）
  | "edit"
  | "clone" // 另存为我的
  | "disable"
  | "enable"
  | "delete"

export function expertCardActions(p: SegmentPackLike): ExpertCardAction[] {
  const user = isUserPack(p)
  if (p.disabled === true) {
    // 停用：编辑器只读可打开；用户专家可 启用/删除；builtin 仅可查看
    return user ? ["view", "enable", "delete"] : ["view"]
  }
  if (!user) {
    return ["team", "apply", "view", "clone"]
  }
  return ["team", "apply", "view", "edit", "disable", "delete"]
}

// --- 文案 SoT（测试断言锚点） ---

export const PANEL_TITLE = "场景与专家"

/** 空态（#356 教训：空态必须给下一步，不留死屏）。 */
export const EXPERT_EMPTY_COPY =
  "还没有可调度的专家。专家是带角色 prompt 与收窄工具面的角色模板：" +
  "点「+ 新建专家」从零创建，或在任一模板上「另存为我的」定制。"

export const EXPERT_SEGMENT_HINT =
  "专家可被派到任务（组队，即将推出）或套用到本对话；工具面展示的是 HARD_DENY 后计算出的有效面，不是愿望清单。"

/** 主 CTA = 组队/派到当前任务；#371 未落地 — 诚实做法：渲染但禁用，明示即将推出。 */
export const EXPERT_PRIMARY_CTA_LABEL = "派到当前任务（组队）"
export const EXPERT_PRIMARY_CTA_DISABLED_HINT =
  "组队派出即将推出（#371 落地后开放）；现在可用「套到本对话」让专家接管当前对话"
/** 次 CTA = 套到本对话（与主 CTA 文案明确区分，防心智分叉误点）。 */
export const EXPERT_SECONDARY_CTA_LABEL = "套到本对话"

/** 有效工具面行前缀：明示是计算结果。 */
export const EXPERT_EFFECTIVE_TOOLS_PREFIX = "有效工具面（本对话 ∩ 允许，剔除高危禁项）"

export function formatEffectiveToolsLine(tools: string[], max = 8): string {
  if (tools.length === 0) return `${EXPERT_EFFECTIVE_TOOLS_PREFIX}：（空 — 收窄后无可用工具，请检查允许列表）`
  const shown = tools.slice(0, max).join("、")
  const more = tools.length > max ? ` 等 ${tools.length} 个` : ""
  return `${EXPERT_EFFECTIVE_TOOLS_PREFIX}：${shown}${more}`
}

export function formatUsageLine(count: number, lastAt: string | null): string | null {
  if (count <= 0) return null
  const day = lastAt ? lastAt.slice(0, 10) : null
  return `已被派出 ${count} 次${day ? `（最近 ${day}）` : ""}`
}

// --- #370 I4: 从本对话归纳专家草稿（F-S-7 零破例 — 草稿不自动保存/生效） ---

/**
 * Lock-step with companion/src/packs/expert-distill.ts DISTILL_LLM_NOTICE /
 * DISTILL_RESTART_LOSS_NOTE（发送前确认弹窗必须原文展示；改文案两侧同步）。
 */
export const DISTILL_LLM_NOTICE = "摘要将发给你配置的 LLM（与聊天同一服务商）"
export const DISTILL_RESTART_LOSS_NOTE =
  "重启仅恢复队列任务指针；已归纳、未审阅的草稿不会保留"

export const DISTILL_ENTRY_LABEL = "从本对话归纳专家"
export const DISTILL_DRAIN_LABEL = "空闲续跑一条"
export const DISTILL_DISARM_LABEL = "关闭队列"
export const DISTILL_SUGGESTED_TOOLS_LABEL = "草稿建议的工具（保守面，未预勾 — 自行勾选后保存）"

export type DistillEvidenceView = { quote: string; hint?: string }

export type DistillDraftView = {
  name: string
  description: string
  system_prompt_append: string
  tools_allow: string[]
  suitable_for: string[]
  unsuitable_for: string[]
  evidence: DistillEvidenceView[]
}

export type DistillMeta = {
  source: "llm" | "heuristic"
  fallback_reason?: string
  notice: string
  used_digest: boolean
  suggested_tools: string[]
  evidence: DistillEvidenceView[]
  suitable_for: string[]
  unsuitable_for: string[]
  /** #411: 全历史归纳草稿（横幅与证据文案区分「本对话 / 全部历史」）。 */
  from_all_history?: boolean
  /** #411: 与已装专家名/工具面重叠 — 用户在编辑器裁决覆盖/另存。 */
  conflicts_with?: string
  /** #411: 本草稿的多 thread 出处（已对候选池校验）。 */
  thread_ids?: string[]
}

function str(v: unknown): string {
  return typeof v === "string" ? v : ""
}

/**
 * 归一 companion `pack.distill_preview` 回包（companion 已 clamp 过；这里
 * 仍按不可信输入防御——坏形状给空串/空数组，不让 UI 崩）。
 */
export function normalizeDistillPreview(msg: unknown): {
  draft: DistillDraftView
  meta: DistillMeta
} | null {
  const m = msg as Record<string, any> | null
  if (!m || typeof m !== "object") return null
  const d = m.draft
  if (!d || typeof d !== "object") return null
  // companion 形态 tools={mode,allow:[…]}；宽松兼容数组形态（历史/启发式）。旧写法
  // `Array.isArray(d.tools) ? d.tools : {}` 会把对象形态丢成 {}，建议工具恒空（测试抓出）。
  const rawTools: unknown = d.tools
  const allow: string[] = (
    Array.isArray(rawTools)
      ? rawTools
      : rawTools && typeof rawTools === "object" && Array.isArray((rawTools as any).allow)
        ? (rawTools as any).allow
        : []
  ).filter((t: unknown): t is string => typeof t === "string" && !!t)
  const evidence: DistillEvidenceView[] = (Array.isArray(d.evidence) ? d.evidence : [])
    .filter((e: unknown) => !!e && typeof e === "object")
    .map((e: any) => ({
      quote: str(e.quote).slice(0, 160),
      ...(str(e.hint) ? { hint: str(e.hint).slice(0, 80) } : {}),
    }))
    .filter((e: DistillEvidenceView) => !!e.quote)
    .slice(0, 8)
  const list = (v: unknown): string[] =>
    (Array.isArray(v) ? v : []).filter(
      (s: unknown): s is string => typeof s === "string" && !!s,
    )
  return {
    draft: {
      name: str(d.name),
      description: str(d.description),
      system_prompt_append: str(d.system_prompt_append),
      // 不预勾：建议工具只进 meta.suggested_tools，编辑器 tools_allow 由用户勾选
      tools_allow: [],
      suitable_for: list(d.suitable_for),
      unsuitable_for: list(d.unsuitable_for),
      evidence,
    },
    meta: {
      source: m.source === "heuristic" ? "heuristic" : "llm",
      ...(str(m.fallback_reason) ? { fallback_reason: str(m.fallback_reason) } : {}),
      notice: str(m.notice) || DISTILL_LLM_NOTICE,
      used_digest: m.used_digest === true,
      suggested_tools: [...new Set(allow)],
      evidence,
      suitable_for: list(d.suitable_for),
      unsuitable_for: list(d.unsuitable_for),
    },
  }
}

/** 草稿来源横幅文案：AI 归纳 vs 启发式空稿（LLM 不可用时面板仍可用）。 */
export function distillSourceLabel(
  meta: Pick<DistillMeta, "source" | "fallback_reason"> &
    Partial<Pick<DistillMeta, "from_all_history">>,
): string {
  if (meta.source === "llm") {
    return meta.from_all_history
      ? "AI 从全部历史归纳的草稿（未保存、不会自动生效，请逐份检查后手动保存）"
      : "AI 从本对话归纳的草稿（未保存、不会自动生效，请检查后手动保存）"
  }
  const why = meta.fallback_reason || "LLM 不可用"
  return `启发式空草稿（${why}）——可手动补全后保存`
}

export type DistillStatusView = {
  armed: boolean
  queue_len: number
  pending_len: number
}

/** 队列状态行：默认关闭必须可见；未审草稿重启即丢必须可见。 */
export function distillStatusLine(s: DistillStatusView): string {
  const arm = s.armed ? "已开启" : "未开启（默认）"
  return `空闲续跑队列：${arm} · 待归纳 ${s.queue_len} · 未审草稿 ${s.pending_len}（重启即丢）`
}

// --- #411: 从全部历史归纳专家（方案 A 两级聚类；一次性手点扫描） ---

export const DISTILL_ALL_ENTRY_LABEL = "从全部历史归纳专家"

/** 确认弹窗正文（N 条摘要发 LLM 必须写明；时间窗/关键词为排除项）。 */
export function distillAllConfirmBody(n: DistillAllCountView): string {
  const capped = n.capped ? `（超过上限，只取最近 ${DISTILL_ALL_MAX_THREADS_LABEL} 条）` : ""
  return (
    `将把 ${n.eligible} 条历史对话的摘要${capped}（脱敏后）发送给你配置的 LLM，` +
    `归纳出最多 5 份专家草稿。其中 ${n.with_digest} 条有现成摘要，其余取首末提问。` +
    `草稿只在面板内存里逐份审阅，不会自动保存；${DISTILL_RESTART_LOSS_NOTE}。`
  )
}

export const DISTILL_ALL_MAX_THREADS_LABEL = "200"

export type DistillAllCountView = {
  eligible: number
  with_digest: number
  capped: boolean
}

export type DistillAllEvidenceView = DistillEvidenceView & { thread_ids: string[] }

export type DistillAllDraftView = {
  name: string
  description: string
  system_prompt_append: string
  tools_allow: string[]
  suitable_for: string[]
  unsuitable_for: string[]
  evidence: DistillAllEvidenceView[]
  thread_ids: string[]
  conflicts_with: string
}

export type DistillAllScanView = {
  drafts: DistillAllDraftView[]
  scanned: number
  llm_calls: number
  fallback_reason: string
  restart_note: string
}

function idList(v: unknown, cap: number): string[] {
  if (!Array.isArray(v)) return []
  const out: string[] = []
  for (const s of v) {
    if (typeof s !== "string" || !s || out.includes(s)) continue
    out.push(s)
    if (out.length >= cap) break
  }
  return out
}

/**
 * 归一 companion `pack.distill_all_result` 回包（companion 已 clamp + 校验
 * thread_id 出处；这里仍按不可信输入防御，坏形状丢弃该份草稿）。
 */
export function normalizeDistillAllDrafts(msg: unknown): DistillAllScanView | null {
  const m = msg as Record<string, any> | null
  if (!m || typeof m !== "object" || m.ok !== true) return null
  const list = Array.isArray(m.drafts) ? m.drafts : []
  const drafts: DistillAllDraftView[] = []
  for (const d of list) {
    if (!d || typeof d !== "object") continue
    const name = str(d.name)
    const prompt = str(d.system_prompt_append)
    if (!name || !prompt) continue
    const allow: string[] = (
      Array.isArray(d.tools)
        ? d.tools
        : d.tools && typeof d.tools === "object" && Array.isArray(d.tools.allow)
          ? d.tools.allow
          : []
    ).filter((t: unknown): t is string => typeof t === "string" && !!t)
    const evidence: DistillAllEvidenceView[] = (Array.isArray(d.evidence) ? d.evidence : [])
      .filter((e: unknown) => !!e && typeof e === "object")
      .map((e: any) => ({
        quote: str(e.quote).slice(0, 160),
        ...(str(e.hint) ? { hint: str(e.hint).slice(0, 80) } : {}),
        thread_ids: idList(e.thread_ids, 8),
      }))
      .filter((e: DistillAllEvidenceView) => !!e.quote)
      .slice(0, 8)
    drafts.push({
      name,
      description: str(d.description),
      system_prompt_append: prompt,
      tools_allow: [],
      suitable_for: idList(d.suitable_for, 4).filter(Boolean),
      unsuitable_for: idList(d.unsuitable_for, 4).filter(Boolean),
      evidence,
      thread_ids: idList(d.thread_ids, 50),
      conflicts_with: str(d.conflicts_with),
    })
    if (drafts.length >= 5) break
  }
  const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0)
  return {
    drafts,
    scanned: num(m.scanned),
    llm_calls: num(m.llm_calls),
    fallback_reason: str(m.fallback_reason),
    restart_note: str(m.restart_note) || DISTILL_RESTART_LOSS_NOTE,
  }
}

/** 草稿队列导航：clamp 在 [0, total-1]（total ≤1 时恒 0）。 */
export function distillAllQueueStep(index: number, total: number, dir: -1 | 1): number {
  if (total <= 1) return 0
  return Math.min(total - 1, Math.max(0, index + dir))
}

/** 队列行文案：第 i/N 份 + 冲突提示（覆盖/另存由用户裁决）。 */
export function distillAllQueueLine(q: {
  index: number
  total: number
  conflicts_with?: string
}): string {
  const base = `草稿 ${q.index + 1}/${q.total}（全部历史归纳，逐份审阅）`
  return q.conflicts_with
    ? `${base} · 与已装专家「${q.conflicts_with}」名字或工具面重叠——保存时可改名另存，或确认覆盖心智`
    : base
}


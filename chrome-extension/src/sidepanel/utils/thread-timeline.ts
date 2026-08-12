// Thread History IA — calendar grouping + filter helpers (pure).
// Spec: docs/superpowers/specs/2026-08-06-thread-history-ia-product-design.md

export type TimelineThread = {
  id: string
  alias?: string
  created_at?: string
  updated_at?: string
  /** First user message preview (optional, from companion list enrichment). */
  first_user_preview?: string | null
  agent_role?: "normal" | "orchestrator" | "worker" | string
  digest?: {
    tldr?: string
    tags?: string[]
    bullets?: string[]
    extracted_at?: string
    content_fingerprint?: string
    stale?: boolean
  } | null
}

export type DayGroup = {
  /** Local calendar day key YYYY-MM-DD */
  dayKey: string
  /** Display label e.g. 07-28 */
  label: string
  threads: TimelineThread[]
}

export type MonthGroup = {
  /** Local calendar month key YYYY-MM */
  monthKey: string
  /** Display label e.g. 2026-07 */
  label: string
  days: DayGroup[]
  /** Flat count of threads in this month */
  count: number
}

export type TimelineModel = {
  today: TimelineThread[]
  /** Local calendar yesterday (default collapsed — 2026-08-06 adversary lock) */
  yesterday: TimelineThread[]
  months: MonthGroup[]
}

/** Unified fold memory (History IA + settings-thread-compact). */
export const LS_THREAD_LIST_EXPAND = "cmspark.threadList.expand"
/** Legacy key — migrated once into LS_THREAD_LIST_EXPAND. */
export const LS_THREAD_LIST_EXPAND_MONTHS_LEGACY = "cmspark.threadList.expandMonths"

export type ThreadListExpandState = {
  months: string[]
  /** Default true when missing */
  today: boolean
  /** Default false when missing (yesterday collapsed) */
  yesterday: boolean
}

export const DEFAULT_THREAD_LIST_EXPAND: ThreadListExpandState = {
  months: [],
  today: true,
  yesterday: false,
}

export function parseThreadListExpand(raw: string | null): ThreadListExpandState {
  if (!raw) return { ...DEFAULT_THREAD_LIST_EXPAND, months: [] }
  try {
    const parsed = JSON.parse(raw)
    // Legacy: bare string[] of month keys
    if (Array.isArray(parsed)) {
      return {
        months: parsed.filter((x): x is string => typeof x === "string"),
        today: DEFAULT_THREAD_LIST_EXPAND.today,
        yesterday: DEFAULT_THREAD_LIST_EXPAND.yesterday,
      }
    }
    if (parsed && typeof parsed === "object") {
      const months = Array.isArray(parsed.months)
        ? parsed.months.filter((x: unknown): x is string => typeof x === "string")
        : []
      return {
        months,
        today: typeof parsed.today === "boolean" ? parsed.today : DEFAULT_THREAD_LIST_EXPAND.today,
        yesterday:
          typeof parsed.yesterday === "boolean"
            ? parsed.yesterday
            : DEFAULT_THREAD_LIST_EXPAND.yesterday,
      }
    }
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_THREAD_LIST_EXPAND, months: [] }
}

/** Effective open state: search force-open wins when group has matches. */
export function isPinnedGroupOpen(
  key: "today" | "yesterday",
  state: ThreadListExpandState,
  opts: { searchActive: boolean; hasMatches: boolean },
): boolean {
  if (opts.searchActive && opts.hasMatches) return true
  return key === "today" ? state.today : state.yesterday
}

export function isMonthGroupOpen(
  monthKey: string,
  state: ThreadListExpandState,
  opts: { searchActive: boolean; hasMatches: boolean },
): boolean {
  if (opts.searchActive && opts.hasMatches) return true
  return state.months.includes(monthKey)
}

/** Local YYYY-MM-DD for a Date (uses local timezone, not UTC). */
export function localDayKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

/** Local YYYY-MM for a Date. */
export function localMonthKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  return `${y}-${m}`
}

/** Yesterday's local calendar day key. */
export function localYesterdayKey(now: Date = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
  return localDayKey(d)
}

function parseTs(iso: string | undefined, fallbackMs: number): Date {
  if (!iso) return new Date(fallbackMs)
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return new Date(fallbackMs)
  return new Date(t)
}

/**
 * Group threads for the default Timeline view.
 * - "今天": local calendar day of `now`, by updated_at desc
 * - "昨天": previous local calendar day (P0.5)
 * - History: month → day (updated_at), months newest-first, days newest-first
 */
export function groupThreadsByCalendar(
  threads: TimelineThread[],
  now: Date = new Date(),
): TimelineModel {
  const todayKey = localDayKey(now)
  const yesterdayKey = localYesterdayKey(now)
  const nowMs = now.getTime()

  const sorted = [...threads].sort((a, b) => {
    const ta = parseTs(a.updated_at || a.created_at, 0).getTime()
    const tb = parseTs(b.updated_at || b.created_at, 0).getTime()
    return tb - ta
  })

  const today: TimelineThread[] = []
  const yesterday: TimelineThread[] = []
  const monthMap = new Map<string, Map<string, TimelineThread[]>>()

  for (const t of sorted) {
    const d = parseTs(t.updated_at || t.created_at, nowMs)
    const dayKey = localDayKey(d)
    if (dayKey === todayKey) {
      today.push(t)
      continue
    }
    if (dayKey === yesterdayKey) {
      yesterday.push(t)
      continue
    }
    const monthKey = localMonthKey(d)
    let days = monthMap.get(monthKey)
    if (!days) {
      days = new Map()
      monthMap.set(monthKey, days)
    }
    const list = days.get(dayKey) || []
    list.push(t)
    days.set(dayKey, list)
  }

  const months: MonthGroup[] = [...monthMap.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
    .map(([monthKey, daysMap]) => {
      const days: DayGroup[] = [...daysMap.entries()]
        .sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
        .map(([dayKey, dayThreads]) => ({
          dayKey,
          label: dayKey.slice(5), // MM-DD
          threads: dayThreads,
        }))
      const count = days.reduce((n, d) => n + d.threads.length, 0)
      return { monthKey, label: monthKey, days, count }
    })

  return { today, yesterday, months }
}

/** Collect all thread ids under a month (for group-header multi-select). */
export function threadIdsInMonth(month: MonthGroup): string[] {
  return month.days.flatMap((d) => d.threads.map((t) => t.id))
}

export function threadIdsInDay(day: DayGroup): string[] {
  return day.threads.map((t) => t.id)
}

/**
 * P0 local search: alias + id + first_user_preview + tags + digest tldr/bullets.
 * Empty query returns all. Leading `#` on id queries is stripped for convenience.
 */
export function filterThreadsByQuery(
  threads: TimelineThread[],
  query: string,
): TimelineThread[] {
  const raw = query.trim().toLowerCase()
  if (!raw) return threads
  const q = raw.startsWith("#") ? raw.slice(1) : raw
  if (!q) return threads
  return threads.filter((t) => {
    const alias = (t.alias || "").toLowerCase()
    const id = (t.id || "").toLowerCase()
    const preview = (t.first_user_preview || "").toLowerCase()
    const tags = (t.digest?.tags || []).join(" ").toLowerCase()
    const tldr = (t.digest?.tldr || "").toLowerCase()
    const bullets = (t.digest?.bullets || []).join(" ").toLowerCase()
    return (
      alias.includes(q) ||
      id.includes(q) ||
      preview.includes(q) ||
      tags.includes(q) ||
      tldr.includes(q) ||
      bullets.includes(q)
    )
  })
}

/** List / copy badge: always `#id` (empty id → empty string). */
export function formatThreadIdBadge(id: string | null | undefined): string {
  const s = String(id ?? "").trim()
  if (!s) return ""
  return s.startsWith("#") ? s : `#${s}`
}

/** Relative Chinese time for list rows. */
export function formatRelativeTime(iso: string | undefined, now: Date = new Date()): string {
  if (!iso) return ""
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ""
  const diff = Math.max(0, now.getTime() - t)
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return "刚刚"
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}分钟前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}小时前`
  const day = Math.floor(hr / 24)
  if (day < 30) return `${day}天前`
  const month = Math.floor(day / 30)
  if (month < 12) return `${month}个月前`
  return `${Math.floor(month / 12)}年前`
}

export function displayThreadTitle(t: TimelineThread): string {
  const alias = (t.alias || "").trim()
  if (alias) return alias
  // Id is always shown via formatThreadIdBadge on the list row — avoid "未命名 · id" + #id.
  return "未命名"
}

/**
 * Rule-based title from first user message (P0.5 — no LLM).
 * Collapse whitespace, strip leading markdown noise, cap length.
 */
export function aliasFromFirstUserText(text: string, maxLen = 40): string {
  let s = String(text || "")
    .replace(/\s+/g, " ")
    .trim()
  // strip common chat prefixes
  s = s.replace(/^(请|帮我|麻烦|请问)[，,\s]*/u, "")
  if (!s) return ""
  if (s.length > maxLen) {
    // prefer break at punctuation/space near end
    const cut = s.slice(0, maxLen)
    const m = cut.match(/^(.+?)[\s，。、；;,.!?…]+[^\s，。、；;,.!?…]*$/)
    s = (m?.[1] || cut).trim()
    if (s.length < 8) s = cut.trim()
    if (!s.endsWith("…") && text.trim().length > s.length) s += "…"
  }
  return s.slice(0, maxLen + 1)
}

export function roleBadge(role: string | undefined): string | null {
  if (role === "worker") return "worker"
  if (role === "orchestrator") return "orch"
  return null
}

/** Checkbox tri-state for group headers. */
export type CheckState = "none" | "some" | "all"

export function selectionState(ids: string[], selected: Set<string>): CheckState {
  if (ids.length === 0) return "none"
  let n = 0
  for (const id of ids) if (selected.has(id)) n++
  if (n === 0) return "none"
  if (n === ids.length) return "all"
  return "some"
}

export function toggleGroupSelection(
  ids: string[],
  selected: Set<string>,
  /** When true, only these ids may be selected (e.g. non-busy). */
  selectable?: Set<string> | null,
): Set<string> {
  const eligible = selectable
    ? ids.filter((id) => selectable.has(id))
    : ids
  const next = new Set(selected)
  const state = selectionState(eligible, selected)
  if (state === "all") {
    for (const id of eligible) next.delete(id)
  } else {
    for (const id of eligible) next.add(id)
  }
  return next
}

/** Build tag → threadIds index for Tags view (P1). */
export function buildTagIndex(
  threads: TimelineThread[],
): Map<string, TimelineThread[]> {
  const map = new Map<string, TimelineThread[]>()
  for (const t of threads) {
    const tags = t.digest?.tags
    if (!tags || tags.length === 0) {
      const list = map.get("__untagged__") || []
      list.push(t)
      map.set("__untagged__", list)
      continue
    }
    for (const tag of tags) {
      const k = tag.toLowerCase()
      const list = map.get(k) || []
      list.push(t)
      map.set(k, list)
    }
  }
  return map
}

// ─── Wave A: untagged batch extract helpers (GAP-11..15 / S1–S5) ───────────

/** Max threads per extract_digest request (companion hard cap). */
export const EXTRACT_DIGEST_MAX = 20

/** Tag cloud: show this many pills before 「更多」 fold (A-5). Count-fold only — no height clip. */
export const TAG_CLOUD_MAX_VISIBLE = 16

/**
 * Untagged for batch extract (S1/GAP-11):
 * `!digest || tags.length === 0`. Non-empty non-stale tags are out of batch.
 * (Stale-with-tags is not "untagged" — leave for per-row / multi-select.)
 */
export function isUntaggedForExtract(t: TimelineThread): boolean {
  if (!t.digest) return true
  const tags = t.digest.tags
  return !tags || tags.length === 0
}

/**
 * Empty-tags digests must re-extract with force:true (S1).
 * No-digest threads extract without force (handler has nothing to skip).
 */
export function shouldForceDigestExtract(t: TimelineThread): boolean {
  if (!t.digest) return false
  const tags = t.digest.tags
  return !tags || tags.length === 0
}

export type SelectUntaggedForExtractOpts = {
  /** Cap (default EXTRACT_DIGEST_MAX = 20). */
  max?: number
  /** Busy thread ids — skipped (S3/GAP-13). */
  busyIds?: Set<string> | Record<string, boolean | undefined>
  /**
   * Default true: exclude agent_role === "worker" (S2/GAP-12).
   * Orchestrator and normal are included.
   */
  excludeWorkers?: boolean
}

export type UntaggedExtractSelection = {
  ids: string[]
  /**
   * True when batch needs force:true.
   * Untagged batches always force when non-empty so empty-tags digests re-run (S1);
   * no-digest-only batches also send force:true (harmless on companion).
   */
  force: boolean
}

function isBusyId(
  id: string,
  busyIds?: Set<string> | Record<string, boolean | undefined>,
): boolean {
  if (!busyIds) return false
  if (busyIds instanceof Set) return busyIds.has(id)
  return !!busyIds[id]
}

/**
 * Select up to `max` untagged threads for 「为未标注提取要点」.
 * Skips busy + worker (default); force:true for any non-empty selection (S1).
 * Empty result → UI disables CTA/menu (S3); caller must not send empty batch.
 */
export function selectUntaggedForExtract(
  threads: TimelineThread[],
  opts: SelectUntaggedForExtractOpts = {},
): UntaggedExtractSelection {
  const max = opts.max ?? EXTRACT_DIGEST_MAX
  const excludeWorkers = opts.excludeWorkers !== false
  const ids: string[] = []

  for (const t of threads) {
    if (ids.length >= max) break
    if (!t?.id) continue
    if (excludeWorkers && t.agent_role === "worker") continue
    if (isBusyId(t.id, opts.busyIds)) continue
    if (!isUntaggedForExtract(t)) continue
    ids.push(t.id)
  }

  return { ids, force: ids.length > 0 }
}

/**
 * Whether a multi-select / per-row extract batch should send force:true.
 * True if any target has an empty-tags digest (S1 empty-tags path).
 */
export function batchNeedsForceExtract(
  threads: TimelineThread[],
  ids: string[],
): boolean {
  if (ids.length === 0) return false
  const byId = new Map(threads.map((t) => [t.id, t]))
  for (const id of ids) {
    const t = byId.get(id)
    if (t && shouldForceDigestExtract(t)) return true
  }
  return false
}

/** Collapse tag keys for cloud UI (A-5). */
export function collapseTagKeys(
  keys: string[],
  expanded: boolean,
  maxVisible: number = TAG_CLOUD_MAX_VISIBLE,
): { visible: string[]; hiddenCount: number } {
  if (expanded || keys.length <= maxVisible) {
    return { visible: keys, hiddenCount: 0 }
  }
  return {
    visible: keys.slice(0, maxVisible),
    hiddenCount: keys.length - maxVisible,
  }
}

/** One-line tldr for list rows (A-3); empty → null. */
export function displayDigestTldr(
  t: TimelineThread,
  maxLen = 120,
): string | null {
  const raw = (t.digest?.tldr || "").replace(/\s+/g, " ").trim()
  if (!raw) return null
  if (raw.length <= maxLen) return raw
  return raw.slice(0, maxLen).trimEnd() + "…"
}

// ─── Wave B: lazy digest quota + idle candidates ───────────────────────────

export const LS_DIGEST_QUOTA = "cmspark.threadDigest.quota"

export type DigestQuotaState = { day: string; count: number }

/** Local calendar day key for quota (YYYY-MM-DD). */
export function digestQuotaDayKey(now: Date = new Date()): string {
  return localDayKey(now)
}

export function parseDigestQuota(raw: string | null, now: Date = new Date()): DigestQuotaState {
  const day = digestQuotaDayKey(now)
  if (!raw) return { day, count: 0 }
  try {
    const o = JSON.parse(raw)
    if (o && typeof o === "object" && o.day === day && typeof o.count === "number") {
      return { day, count: Math.max(0, Math.floor(o.count)) }
    }
  } catch {
    /* ignore */
  }
  return { day, count: 0 }
}

export function remainingDigestQuota(
  state: DigestQuotaState,
  maxPerDay: number,
): number {
  const cap = Math.max(0, Math.floor(maxPerDay))
  return Math.max(0, cap - state.count)
}

/**
 * Candidates for lazy extract (Wave B-2): untagged (or empty tags) OR digest.stale,
 * idle for on_idle_hours, skip busy/worker. Cap by max.
 */
export function selectLazyDigestCandidates(
  threads: TimelineThread[],
  opts: {
    now?: Date
    onIdleHours?: number
    max?: number
    busyIds?: Set<string> | Record<string, boolean | undefined>
    excludeWorkers?: boolean
  } = {},
): UntaggedExtractSelection {
  const now = opts.now || new Date()
  const idleMs = Math.max(0, (opts.onIdleHours ?? 24) * 3600_000)
  const max = opts.max ?? EXTRACT_DIGEST_MAX
  const excludeWorkers = opts.excludeWorkers !== false
  const ids: string[] = []

  for (const t of threads) {
    if (ids.length >= max) break
    if (!t?.id) continue
    if (excludeWorkers && t.agent_role === "worker") continue
    if (isBusyId(t.id, opts.busyIds)) continue
    const updated = t.updated_at || t.created_at
    if (updated) {
      const ts = new Date(updated).getTime()
      if (Number.isFinite(ts) && now.getTime() - ts < idleMs) continue
    }
    const untagged = isUntaggedForExtract(t)
    const stale = !!t.digest?.stale
    if (!untagged && !stale) continue
    ids.push(t.id)
  }
  // Non-empty lazy batch always force:true (empty-tags / stale re-extract).
  return { ids, force: ids.length > 0 }
}

/** Show digest stale badge: tags view always; time view only non-today (B-3). */
export function showDigestStaleBadge(
  t: TimelineThread,
  view: "time" | "tags",
  now: Date = new Date(),
): boolean {
  if (!t.digest?.stale) return false
  if (view === "tags") return true
  const updated = t.updated_at || t.created_at
  if (!updated) return true
  try {
    return localDayKey(new Date(updated)) !== localDayKey(now)
  } catch {
    return true
  }
}

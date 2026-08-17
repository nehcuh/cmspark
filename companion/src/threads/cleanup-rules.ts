// Rule-based cleanup suggestions (P1.5 + 2026-08-17 hygiene).
// Spec: docs/superpowers/specs/2026-08-17-thread-hygiene-adversarial-design.md

export type CleanupReason =
  | "empty"
  | "no_user"
  | "acp_husk"
  | "short_orphan"
  | "stale_thin"
  | "duplicate_alias"
  | "worker_orphan"

export interface CleanupCandidate {
  thread_id: string
  reason: CleanupReason
  detail: string
  /** 0–1 heuristic confidence */
  confidence: number
  cluster_id?: string
  /** UI initial checkbox (D pre-check table). */
  precheck: boolean
}

export interface CleanupThreadInput {
  id: string
  alias?: string
  updated_at?: string
  created_at?: string
  agent_role?: string
  parent_thread_id?: string | null
  message_count: number
  first_user_preview?: string
  /** Character length of first user message (0 if none) */
  first_user_len?: number
  has_assistant?: boolean
  /** Count of role===user messages */
  user_message_count?: number
  /** Whitespace-stripped assistant char count */
  assistant_chars?: number
  /** Companion-side: template head or handback frame present */
  looks_like_acp?: boolean
  /** Assistant text used only to detect fail templates (not shown in UI). */
  assistant_excerpt?: string
}

export interface SuggestCleanupOptions {
  /** ISO lower bound on updated_at (inclusive). Default: none */
  from?: string | null
  /** ISO upper bound on updated_at (inclusive). Default: none */
  to?: string | null
  /** Include worker threads (default false) */
  include_workers?: boolean
  /** Days without update + thin thread (default 30) */
  stale_days?: number
  /** Max messages to still count as thin when stale (default 3) */
  stale_max_messages?: number
  /** Max first-user length for short_orphan (default 12) */
  short_user_max_len?: number
  now?: Date
  /** Active draft — never suggest / never precheck (A8). */
  except_thread_id?: string | null
}

export const ACP_HANDBACK_HEAD = "【编程接力"
export const ACP_UNTRUSTED_FRAME = "UNTRUSTED_ACP_HANDBACK"
export const ACP_FAIL_MARKERS = [
  "No API key",
  "denied",
  "cancelled",
  "timeout",
  "spawn failed",
  "user_denied",
] as const

const NO_USER_THIN_CHARS = 400
const ACP_HUSK_CHARS = 200
const SHORT_ORPHAN_PRECHECK_DAYS = 14
const DUP_SKIP_MESSAGE_COUNT = 20

function inRange(iso: string | undefined, from?: string | null, to?: string | null): boolean {
  if (!iso) return true
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return true
  if (from) {
    const f = Date.parse(from)
    if (!Number.isNaN(f) && t < f) return false
  }
  if (to) {
    const u = Date.parse(to)
    if (!Number.isNaN(u) && t > u) return false
  }
  return true
}

function normalizeAlias(a: string | undefined): string {
  return (a || "").trim().toLowerCase()
}

export function looksLikeAcpText(text: string | undefined): boolean {
  const s = String(text || "")
  return s.includes(ACP_HANDBACK_HEAD) || s.includes(ACP_UNTRUSTED_FRAME)
}

/** First-party head only — never scan untrusted handback body. */
export function firstPartyHeadLine(text: string | undefined): string {
  const s = String(text || "")
  const nl = s.indexOf("\n")
  return (nl === -1 ? s : s.slice(0, nl)).trim()
}

export function isAcpFailTemplate(text: string | undefined): boolean {
  const head = firstPartyHeadLine(text)
  return ACP_FAIL_MARKERS.some((m) => head.includes(m))
}

/** Cryptic / workspace-code alias (P-D7). */
export function isCrypticAlias(alias: string | undefined): boolean {
  const a = (alias || "").trim()
  if (!a || /\s/.test(a)) return false
  if (a.length > 16) return false
  if (/^[a-z0-9._-]+$/i.test(a)) return true
  const cjk = a.match(/\p{Script=Han}/gu)
  return !!cjk && cjk.length <= 4 && cjk.length === [...a].length
}

/** null = unknown (legacy callers). no_user / husk require an explicit 0. */
function userCount(t: CleanupThreadInput): number | null {
  if (typeof t.user_message_count === "number") return t.user_message_count
  if ((t.first_user_len ?? 0) > 0 || (t.first_user_preview || "").trim()) return 1
  return null
}

function assistantChars(t: CleanupThreadInput): number {
  if (typeof t.assistant_chars === "number") return t.assistant_chars
  return 0
}

function isAcpShaped(t: CleanupThreadInput): boolean {
  return t.looks_like_acp === true
}

function isAcpHusk(t: CleanupThreadInput): boolean {
  if (userCount(t) !== 0) return false
  if (!isAcpShaped(t)) return false
  const chars = assistantChars(t)
  const fail = isAcpFailTemplate(t.assistant_excerpt)
  return chars < ACP_HUSK_CHARS || fail
}

function isAcpSubstantial(t: CleanupThreadInput): boolean {
  if (userCount(t) !== 0) return false
  if (!isAcpShaped(t)) return false
  return assistantChars(t) >= ACP_HUSK_CHARS && !isAcpFailTemplate(t.assistant_excerpt)
}

function ageMs(t: CleanupThreadInput, now: Date): number | null {
  const updated = Date.parse(t.updated_at || t.created_at || "")
  if (Number.isNaN(updated)) return null
  return now.getTime() - updated
}

export function shouldPrecheckCleanup(
  reason: CleanupReason,
  t: CleanupThreadInput,
  now: Date,
): boolean {
  if (reason === "empty") return true
  if (reason === "no_user") return true
  if (reason === "acp_husk") return true
  if (reason === "short_orphan") {
    const age = ageMs(t, now)
    if (age == null) return false
    return age >= SHORT_ORPHAN_PRECHECK_DAYS * 86400_000
  }
  return false
}

function pushOne(
  byId: Map<string, CleanupCandidate>,
  cand: Omit<CleanupCandidate, "precheck">,
  t: CleanupThreadInput,
  now: Date,
): void {
  const next: CleanupCandidate = {
    ...cand,
    precheck: shouldPrecheckCleanup(cand.reason, t, now),
  }
  const prev = byId.get(cand.thread_id)
  if (!prev || next.confidence > prev.confidence) {
    byId.set(cand.thread_id, next)
  }
}

/**
 * Pure rules engine. Caller supplies message_count / previews (no I/O here).
 */
export function suggestCleanupRules(
  threads: CleanupThreadInput[],
  opts: SuggestCleanupOptions = {},
): CleanupCandidate[] {
  const now = opts.now ?? new Date()
  const staleDays = opts.stale_days ?? 30
  const staleMax = opts.stale_max_messages ?? 3
  const shortMax = opts.short_user_max_len ?? 12
  const includeWorkers = opts.include_workers === true
  const staleMs = staleDays * 86400_000

  const byId = new Map<string, CleanupCandidate>()
  const byAlias = new Map<string, CleanupThreadInput[]>()
  const considered: CleanupThreadInput[] = []

  for (const t of threads) {
    if (!includeWorkers && t.agent_role === "worker") continue
    if (opts.except_thread_id && t.id === opts.except_thread_id) continue
    if (!inRange(t.updated_at || t.created_at, opts.from, opts.to)) continue
    considered.push(t)

    const aliasKey = normalizeAlias(t.alias)
    if (aliasKey) {
      const list = byAlias.get(aliasKey) || []
      list.push(t)
      byAlias.set(aliasKey, list)
    }

    if (t.message_count === 0) {
      pushOne(
        byId,
        { thread_id: t.id, reason: "empty", detail: "无消息", confidence: 0.95 },
        t,
        now,
      )
      continue
    }

    if (isAcpSubstantial(t)) {
      continue
    }

    if (isAcpHusk(t)) {
      pushOne(
        byId,
        {
          thread_id: t.id,
          reason: "acp_husk",
          detail: "编程接力空壳（无用户消息）",
          confidence: 0.5,
        },
        t,
        now,
      )
      continue
    }

    if (userCount(t) === 0 && t.message_count > 0 && !isAcpShaped(t)) {
      const chars = assistantChars(t)
      if (chars < NO_USER_THIN_CHARS) {
        pushOne(
          byId,
          {
            thread_id: t.id,
            reason: "no_user",
            detail: `无用户消息（${chars} 字助手文本）`,
            confidence: 0.8,
          },
          t,
          now,
        )
      }
      continue
    }

    if (
      t.message_count === 1 &&
      !t.has_assistant &&
      (t.first_user_len ?? 0) > 0 &&
      (t.first_user_len ?? 0) <= shortMax
    ) {
      pushOne(
        byId,
        {
          thread_id: t.id,
          reason: "short_orphan",
          detail: `仅一条极短用户消息（${t.first_user_len} 字）`,
          confidence: 0.75,
        },
        t,
        now,
      )
      continue
    }

    const updated = Date.parse(t.updated_at || t.created_at || "")
    if (
      !Number.isNaN(updated) &&
      now.getTime() - updated >= staleMs &&
      t.message_count <= staleMax
    ) {
      pushOne(
        byId,
        {
          thread_id: t.id,
          reason: "stale_thin",
          detail: `${staleDays} 天未活跃且消息 ≤${staleMax}`,
          confidence: 0.55,
        },
        t,
        now,
      )
    }

    if (t.agent_role === "worker" && t.parent_thread_id) {
      const parentAlive = threads.some((p) => p.id === t.parent_thread_id)
      if (!parentAlive) {
        pushOne(
          byId,
          {
            thread_id: t.id,
            reason: "worker_orphan",
            detail: "worker 父线程不存在",
            confidence: 0.7,
            cluster_id: `orphan:${t.parent_thread_id}`,
          },
          t,
          now,
        )
      }
    }
  }

  let cluster = 0
  for (const [alias, members] of byAlias) {
    if (members.length < 2) continue
    if (!isCrypticAlias(alias)) continue
    cluster++
    const cid = `dup:${cluster}`
    const owner = [...members].sort((a, b) => {
      if (b.message_count !== a.message_count) return b.message_count - a.message_count
      return String(b.updated_at || "").localeCompare(String(a.updated_at || ""))
    })[0]
    for (const t of members) {
      if (t.id === owner.id) continue
      if (isAcpSubstantial(t)) continue
      if (t.message_count >= DUP_SKIP_MESSAGE_COUNT) continue
      if ((userCount(t) ?? 0) > 0) continue
      const existing = byId.get(t.id)
      if (
        existing &&
        (existing.reason === "empty" ||
          existing.reason === "no_user" ||
          existing.reason === "acp_husk")
      ) {
        continue
      }
      pushOne(
        byId,
        {
          thread_id: t.id,
          reason: "duplicate_alias",
          detail: `与其他会话同名「${alias}」`,
          confidence: 0.45,
          cluster_id: cid,
        },
        t,
        now,
      )
    }
  }

  return [...byId.values()].sort((a, b) => b.confidence - a.confidence)
}

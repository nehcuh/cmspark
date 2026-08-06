// Rule-based cleanup suggestions (P1.5) — zero LLM.
// Spec: docs/superpowers/specs/2026-08-06-thread-history-ia-product-design.md

export type CleanupReason =
  | "empty"
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
}

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

  const out: CleanupCandidate[] = []
  const byAlias = new Map<string, string[]>()

  for (const t of threads) {
    if (!includeWorkers && t.agent_role === "worker") continue
    if (!inRange(t.updated_at || t.created_at, opts.from, opts.to)) continue

    const aliasKey = normalizeAlias(t.alias)
    if (aliasKey) {
      const list = byAlias.get(aliasKey) || []
      list.push(t.id)
      byAlias.set(aliasKey, list)
    }

    if (t.message_count === 0) {
      out.push({
        thread_id: t.id,
        reason: "empty",
        detail: "无消息",
        confidence: 0.95,
      })
      continue
    }

    if (
      t.message_count === 1 &&
      !t.has_assistant &&
      (t.first_user_len ?? 0) > 0 &&
      (t.first_user_len ?? 0) <= shortMax
    ) {
      out.push({
        thread_id: t.id,
        reason: "short_orphan",
        detail: `仅一条极短用户消息（${t.first_user_len} 字）`,
        confidence: 0.75,
      })
      continue
    }

    const updated = Date.parse(t.updated_at || t.created_at || "")
    if (
      !Number.isNaN(updated) &&
      now.getTime() - updated >= staleMs &&
      t.message_count <= staleMax
    ) {
      out.push({
        thread_id: t.id,
        reason: "stale_thin",
        detail: `${staleDays} 天未活跃且消息 ≤${staleMax}`,
        confidence: 0.55,
      })
    }

    // orphan worker without parent in set
    if (t.agent_role === "worker" && t.parent_thread_id) {
      const parentAlive = threads.some((p) => p.id === t.parent_thread_id)
      if (!parentAlive) {
        out.push({
          thread_id: t.id,
          reason: "worker_orphan",
          detail: "worker 父线程不存在",
          confidence: 0.7,
          cluster_id: `orphan:${t.parent_thread_id}`,
        })
      }
    }
  }

  // duplicate aliases (same non-empty alias, 2+)
  let cluster = 0
  for (const [alias, ids] of byAlias) {
    if (ids.length < 2) continue
    cluster++
    const cid = `dup:${cluster}`
    for (const id of ids) {
      // avoid double-push if already empty etc. — still useful to flag
      if (out.some((c) => c.thread_id === id && c.reason === "duplicate_alias")) continue
      out.push({
        thread_id: id,
        reason: "duplicate_alias",
        detail: `与其他会话同名「${alias}」`,
        confidence: 0.5,
        cluster_id: cid,
      })
    }
  }

  // sort: higher confidence first
  out.sort((a, b) => b.confidence - a.confidence)
  return out
}

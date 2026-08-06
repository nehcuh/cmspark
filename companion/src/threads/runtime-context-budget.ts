// Runtime context budget metadata on Thread index (not Digest / not Export).
// Spec: settings-thread-compact-ux F-C4 · request path + optional UI "查看摘要".

export type RuntimeContextBudgetMode = "m1" | "m2"

export interface RuntimeContextBudgetMeta {
  last_at: string
  mode: RuntimeContextBudgetMode
  dropped_count: number
  tokens_before: number
  tokens_after: number
  /** Redacted rolling summary for UI modal; request path may also use omit notice. */
  rolling_summary?: string
  summary_sha256?: string
  summary_bytes?: number
  phase?: "pre_loop" | "mid_loop"
}

const MAX_SUMMARY_CHARS = 2000

/** Sanitize before persist — cap size, strip control chars, no prototype junk. */
export function sanitizeRuntimeContextBudget(raw: unknown): RuntimeContextBudgetMeta | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  const mode = o.mode === "m2" ? "m2" : o.mode === "m1" ? "m1" : null
  if (!mode) return null
  const last_at = typeof o.last_at === "string" && o.last_at ? o.last_at : new Date().toISOString()
  const dropped_count = Math.max(0, Math.floor(Number(o.dropped_count) || 0))
  const tokens_before = Math.max(0, Math.floor(Number(o.tokens_before) || 0))
  const tokens_after = Math.max(0, Math.floor(Number(o.tokens_after) || 0))
  const out: RuntimeContextBudgetMeta = {
    last_at,
    mode,
    dropped_count,
    tokens_before,
    tokens_after,
  }
  if (typeof o.rolling_summary === "string" && o.rolling_summary.trim()) {
    out.rolling_summary = o.rolling_summary
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
      .trim()
      .slice(0, MAX_SUMMARY_CHARS)
  }
  if (typeof o.summary_sha256 === "string" && /^[a-f0-9]{8,64}$/i.test(o.summary_sha256)) {
    out.summary_sha256 = o.summary_sha256.toLowerCase().slice(0, 64)
  }
  if (typeof o.summary_bytes === "number" && o.summary_bytes >= 0) {
    out.summary_bytes = Math.floor(o.summary_bytes)
  }
  if (o.phase === "pre_loop" || o.phase === "mid_loop") {
    out.phase = o.phase
  }
  return out
}

// Redacted persistence-stub detector — pure helper for Side Panel tool cards.
//
// companion/src/security/tool-persistence-redact.ts (SEC-C) collapses sensitive
// tool results before writing threads/*.json. Live turns carry the full result
// (renders normally); a thread reload reads back one of two stub shapes at the
// ToolExecutionResult level:
//   A: { success: true, data: { redacted: true, len, sha256 } }  — EXEC_FOLD_TOOLS
//   B: { success: true, redacted: true, len, sha256 }            — collapseResult
// Strict field checks only (redacted===true, len number, sha256 string) so
// ordinary payloads are never mistaken for a stub.
//
// #255 adds a third persistence state for read-tier tools (get_page_text /
// get_page_html / evaluate): when the gate-checked data exceeds 8000 chars the
// persisted data is a truncated-prefix envelope
//   C: { success: true, data: { truncated: true, kept, total, prefix } }
// rendered with the 三态 copy "已保留前 N/共 M 字符" — never implying the full
// content was persisted.

export interface RedactedStub {
  /** Original payload length in characters (pre-redaction). */
  len: number
  /** Short sha256 fingerprint of the original payload. */
  sha256: string
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null
}

function asStub(v: unknown): RedactedStub | null {
  const r = asRecord(v)
  if (!r) return null
  if (r.redacted !== true) return null
  if (typeof r.len !== "number" || !Number.isFinite(r.len)) return null
  if (typeof r.sha256 !== "string") return null
  return { len: r.len, sha256: r.sha256 }
}

/**
 * Detect a SEC-C redaction stub on a persisted ToolExecutionResult.
 * Returns { len, sha256 } for stub shapes A/B, null for anything else.
 */
export function extractRedactedStub(result: unknown): RedactedStub | null {
  const r = asRecord(result)
  if (!r) return null
  // Shape B: stub fields at the result level (host_computer / thread_recall /
  // sensitive MCP via collapseResult).
  const direct = asStub(r)
  if (direct) return direct
  // Shape A: only `data` was collapsed (evaluate/shell_exec/host_*/workspace_*).
  return asStub(r.data)
}

/**
 * True when a persisted tool-message `content` string is a redacted-stub JSON.
 * companion createToolResultMessage (llm/tool-batch-heal.ts) persists
 * content = JSON.stringify(safeResult), so a reloaded stub row's bubble text
 * IS the stub JSON — the ToolCallCard hint already carries the info, and the
 * caller should skip body rendering. Non-stub tool rows (non-sensitive tools)
 * return false so their full result JSON keeps rendering (existing behavior).
 */
export function isRedactedStubContent(content: unknown): boolean {
  if (typeof content !== "string") return false
  const trimmed = content.trim()
  if (!trimmed.startsWith("{")) return false
  try {
    return extractRedactedStub(JSON.parse(trimmed)) !== null
  } catch {
    return false
  }
}

export interface TruncatedPrefix {
  /** Persisted prefix length in characters (the N in 已保留前 N/共 M 字符). */
  kept: number
  /** Original serialized payload length (the M). */
  total: number
  /** The persisted prefix itself (surrogate-safe cut by the companion). */
  prefix: string
}

function asTruncated(v: unknown): TruncatedPrefix | null {
  const r = asRecord(v)
  if (!r) return null
  if (r.truncated !== true) return null
  if (typeof r.kept !== "number" || !Number.isFinite(r.kept)) return null
  if (typeof r.total !== "number" || !Number.isFinite(r.total)) return null
  if (typeof r.prefix !== "string") return null
  return { kept: r.kept, total: r.total, prefix: r.prefix }
}

/**
 * #255 三态 — detect the read-tier truncated-prefix envelope (shape C) on a
 * persisted ToolExecutionResult. Returns { kept, total, prefix }, null for
 * full results / redacted stubs / anything else.
 */
export function extractTruncatedPrefix(result: unknown): TruncatedPrefix | null {
  const r = asRecord(result)
  if (!r) return null
  return asTruncated(r.data)
}

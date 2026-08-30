// Redacted persistence-stub detector — pure helper for Side Panel tool cards.
//
// companion/src/security/tool-persistence-redact.ts (SEC-C) collapses sensitive
// tool results before writing threads/*.json. Live turns carry the full result
// (renders normally); a thread reload reads back one of two stub shapes at the
// ToolExecutionResult level:
//   A: { success: true, data: { redacted: true, len, sha256 } }  — SENSITIVE_CODE_TOOLS
//   B: { success: true, redacted: true, len, sha256 }            — collapseResult
// Strict field checks only (redacted===true, len number, sha256 string) so
// ordinary payloads are never mistaken for a stub.

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

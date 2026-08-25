/**
 * Redact sensitive tool params/results before durable thread JSON persistence.
 *
 * Thread JSON redaction (audit SEC-C / item 3): cookies, evaluate/shell/host_*,
 * MCP secrets, and sensitive keys (incl. passwd / Authorization) must not land
 * in ~/.cmspark-agent/threads/*.json. history.db has a parallel redactor in
 * history/store.ts (same SENSITIVE_KEY_RE + leaf; cookie/generic call sites
 * lock-step as of post-#220 nits). In-flight LLM tool rows stay unredacted;
 * only createToolResultMessage → addMessage goes through here.
 */
import * as crypto from "crypto"

const SENSITIVE_COOKIE_TOOLS = new Set([
  "get_cookies",
  "list_all_cookies",
  "set_cookie",
  "delete_cookie",
])

const SENSITIVE_CODE_TOOLS = new Set([
  "evaluate",
  "osascript_eval",
  "host_read",
  "host_write",
  "host_app",
  "host_computer",
  "shell_exec",
  "netsec_port_scan",
  "workspace_read_file",
  "workspace_write_file",
  "workspace_list_dir",
  "workspace_glob",
])

const MCP_TOOL_PREFIX = "mcp__"
const MCP_SENSITIVE_RESULT_RE = /(read|file|secret|token|key|env|credential|ssh|aws)/i
const SENSITIVE_KEY_RE = /(secret|token|password|passwd|api[_-]?key|credential|private[_-]?key|authorization|bearer|apikey)/i

function shortHash(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex").slice(0, 12)
}

function redactSensitiveLeaf(v: unknown): unknown {
  if (typeof v === "string") {
    return `<redacted:len=${v.length}:sha256=${shortHash(v)}>`
  }
  if (typeof v === "number" || typeof v === "boolean") {
    const s = String(v)
    return `<redacted:len=${s.length}:sha256=${shortHash(s)}>`
  }
  if (Array.isArray(v)) {
    return v.map((item) => redactSensitiveLeaf(item))
  }
  if (v && typeof v === "object") {
    const s = JSON.stringify(v)
    return { redacted: true, len: s.length, sha256: shortHash(s) }
  }
  return v
}

function redactSensitiveKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactSensitiveKeysDeep)
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(obj)) {
      const v = obj[k]
      if (SENSITIVE_KEY_RE.test(k)) {
        out[k] = redactSensitiveLeaf(v)
      } else {
        out[k] = redactSensitiveKeysDeep(v)
      }
    }
    return out
  }
  return value
}

function redactCookieData(data: unknown): unknown {
  if (Array.isArray(data)) {
    return data.map((cookie) => redactOneCookie(cookie))
  }
  if (data && typeof data === "object") {
    return redactOneCookie(data)
  }
  // Mirror history/store redactCookieSummary: blank non-object/array rather than
  // passthrough (future tool shapes must not leak raw cookie strings).
  return null
}

function redactOneCookie(cookie: unknown): unknown {
  if (!cookie || typeof cookie !== "object") return cookie
  const c = cookie as Record<string, unknown>
  const { name, domain, path: cookiePath, hostOnly, secure, httpOnly, value, ...rest } = c
  const valueStr = typeof value === "string" ? value : ""
  const restRedacted = redactSensitiveKeysDeep(
    Object.fromEntries(Object.entries(rest).filter(([k]) => k !== "value")),
  ) as Record<string, unknown>
  return {
    name,
    domain,
    path: cookiePath,
    hostOnly,
    secure,
    httpOnly,
    ...restRedacted,
    ...(valueStr
      ? { value_hash: shortHash(valueStr), value_length: valueStr.length }
      : {}),
  }
}

function redactCodeishParams(params: Record<string, unknown>): Record<string, unknown> {
  const redacted: Record<string, unknown> = { ...params }
  for (const key of ["code", "expression", "security_token", "command", "body"]) {
    if (key in redacted && typeof redacted[key] === "string") {
      const val = redacted[key] as string
      redacted[key] = `<redacted:hash=${shortHash(val)},len=${val.length}>`
    }
  }
  return redacted
}

function redactComputerParams(params: Record<string, unknown>): Record<string, unknown> {
  const redacted: Record<string, unknown> = { ...params }
  if (typeof redacted.task === "string") {
    redacted.task = `<redacted:hash=${shortHash(redacted.task)},len=${redacted.task.length}>`
  }
  if (typeof redacted.security_token === "string") {
    redacted.security_token = `<redacted:hash=${shortHash(redacted.security_token)},len=${redacted.security_token.length}>`
  }
  if (Array.isArray(redacted.actions)) {
    redacted.actions = redacted.actions.map((a: any) => {
      if (!a || typeof a !== "object") return a
      const copy = { ...a }
      if (typeof copy.text === "string") {
        copy.text = `<redacted:hash=${shortHash(copy.text)},len=${copy.text.length}>`
      }
      return copy
    })
  }
  return redacted
}

function collapseResult(result: unknown): { success?: boolean; redacted: true; len: number; sha256: string } {
  const raw = typeof result === "string" ? result : JSON.stringify(result ?? null)
  return {
    success: typeof result === "object" && result && "success" in (result as any)
      ? Boolean((result as any).success)
      : undefined,
    redacted: true,
    len: raw.length,
    sha256: shortHash(raw),
  }
}

/**
 * Data-less error rows ({success:false, error, error_code?} — the shape of the
 * INTERRUPTED heal fillers from tool-batch-heal) carry no sensitive payload.
 * Sensitive branches below would rebuild the row without error_code (codeish) or
 * collapse away error entirely (collapseResult), destroying the INTERRUPTED
 * marker the heal/rebuild flow keys on. Reconstructs a fresh object (no extra
 * keys), else null.
 */
function plainErrorResult(
  result: unknown,
): { success: false; error: string; error_code?: string } | null {
  if (!result || typeof result !== "object") return null
  const r = result as Record<string, unknown>
  if (r.success !== false || typeof r.error !== "string") return null
  if (r.data !== undefined) return null
  // Reconstruct — never return the original object (extra keys like
  // stdout / env / stack would otherwise persist next to INTERRUPTED).
  const out: { success: false; error: string; error_code?: string } = {
    success: false,
    error: r.error,
  }
  if (typeof r.error_code === "string") out.error_code = r.error_code
  return out
}

/**
 * Returns params + result safe for durable thread JSON (and content string).
 * Non-sensitive tools pass through (params deep-key scan only for MCP).
 */
export function redactToolPayloadForPersistence(
  toolName: string,
  params: unknown,
  result: unknown,
): { params: unknown; result: unknown } {
  const name = typeof toolName === "string" ? toolName : ""
  let safeParams = params
  let safeResult = result

  if (name === "thread_recall") {
    const p = params && typeof params === "object" ? (params as Record<string, unknown>) : {}
    const q = typeof p.query === "string" ? p.query : ""
    safeParams = {
      query_len: q.length,
      ...(typeof p.max_hits === "number" ? { max_hits: p.max_hits } : {}),
      query: `<redacted:len=${q.length}:sha256=${shortHash(q)}>`,
    }
    safeResult = plainErrorResult(result) ?? collapseResult(result)
    return { params: safeParams, result: safeResult }
  }

  if (SENSITIVE_COOKIE_TOOLS.has(name)) {
    if (params && typeof params === "object") {
      const original = params as Record<string, unknown>
      const p = redactSensitiveKeysDeep({ ...original }) as Record<string, unknown>
      if (typeof original.value === "string") {
        p.value = `<redacted:hash=${shortHash(original.value)}>`
      }
      safeParams = p
    }
    // ToolExecutionResult shape: { success, data?, error? }
    if (result && typeof result === "object") {
      const r = result as Record<string, unknown>
      safeResult = {
        ...r,
        data: r.data !== undefined ? redactCookieData(r.data) : undefined,
      }
    } else {
      safeResult = collapseResult(result)
    }
    return { params: safeParams, result: safeResult }
  }

  if (name === "host_computer") {
    if (params && typeof params === "object") {
      safeParams = redactComputerParams(params as Record<string, unknown>)
    }
    safeResult = plainErrorResult(result) ?? collapseResult(result)
    return { params: safeParams, result: safeResult }
  }

  if (SENSITIVE_CODE_TOOLS.has(name)) {
    if (params && typeof params === "object") {
      safeParams = redactCodeishParams(params as Record<string, unknown>)
    }
    // Keep success/error structure; collapse large data
    if (result && typeof result === "object") {
      const plainError = plainErrorResult(result)
      if (plainError) {
        // INTERRUPTED-style row: no data payload — keep error_code + error verbatim.
        safeResult = plainError
      } else {
        const r = result as Record<string, unknown>
        const dataStr = r.data !== undefined ? JSON.stringify(r.data) : ""
        safeResult = {
          success: r.success,
          error: typeof r.error === "string" && r.error.length > 200
            ? r.error.slice(0, 200) + "…"
            : r.error,
          // Always collapse payload for evaluate/shell/host_* — a 200-char
          // cookie/source snippet is still a secret on disk.
          data:
            r.data !== undefined
              ? { redacted: true, len: dataStr.length, sha256: shortHash(dataStr) }
              : undefined,
        }
      }
    }
    return { params: safeParams, result: safeResult }
  }

  if (name.startsWith(MCP_TOOL_PREFIX)) {
    if (params !== undefined) {
      safeParams = redactSensitiveKeysDeep(params)
    }
    if (MCP_SENSITIVE_RESULT_RE.test(name)) {
      safeResult = plainErrorResult(result) ?? collapseResult(result)
    } else {
      safeResult = redactSensitiveKeysDeep(result)
    }
    return { params: safeParams, result: safeResult }
  }

  // Generic: deep-key scan only
  if (params !== undefined) {
    safeParams = redactSensitiveKeysDeep(params)
  }
  if (result !== undefined) {
    safeResult = redactSensitiveKeysDeep(result)
  }
  return { params: safeParams, result: safeResult }
}

/**
 * Shared persistence-redaction rules (issue #255 — 落盘脱敏范围修订).
 *
 * SINGLE source of truth consumed by BOTH redactors:
 *   - security/tool-persistence-redact.ts (thread JSON, threads/*.json)
 *   - history/store.ts redactForStorage (history.db operation rows)
 * Consistency is pinned by golden fixtures + lock-step behavior tests
 * (tests/redact-scope-lockstep.test.ts) — not by comments.
 *
 * Three tiers (per FINAL-DECISION 2026-09-05):
 *   READ_RELEASE_TOOLS — get_page_text / get_page_html / evaluate results keep
 *     a readable prefix (truncated at MAX_TOOL_RESULT_CHARS) AFTER passing the
 *     three gates below; any gate hit fails closed to a full collapse stub.
 *   EXEC_FOLD_TOOLS — shell_exec / host_* / osascript_eval / workspace_* stay
 *     fully collapsed (secret density is high and usually at the head, so
 *     truncation buys nothing).
 *   Unchanged — cookie trust-domain tools / thread_recall / MCP / params
 *     (params are ALWAYS folded for codeish tools).
 *
 * Three gates (all fail-closed, applied before releasing read-tier results):
 *   1. hasSecretShape — value-track secret scan of the RESULT text
 *      (JWT / Bearer / PEM / known API-key prefixes). SENSITIVE_KEY_RE only
 *      scans key NAMES; free text had zero coverage before this ticket.
 *   2. hasExfilShape — code-exfil heuristic on the evaluate CODE
 *      (document.cookie — dot AND bracket notation — / localStorage /
 *      password-input .value / csrf meta and similar DOM direct-read theft
 *      paths), plus a cookie-shaped RESULT-value check (jar serialization /
 *      well-known cookie name=). Hardening layer, NOT a security boundary —
 *      it can be evaded by encoding.
 *   3. get_page_text / get_page_html results go through gate 1 too (they
 *      previously passed through unredacted — an existing inconsistency).
 * Plus (post-review MAJOR-2): a key-NAME scan of the released payload —
 * {password}/{token}/{Authorization}/{api_key}-style fields fail closed even
 * when their values carry no secret shape.
 *
 * NEVER (unchanged): cookie values / tokens / Authorization headers / key
 * fields must never land on disk.
 */
import * as crypto from "crypto"
import { MAX_TOOL_RESULT_CHARS, safeSlice } from "../llm/text-sanitize"

/** SHA-256 truncated to 12 hex chars — correlates repeats without recovery. */
export function shortHash(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex").slice(0, 12)
}

/** Replace a sensitive leaf value with a non-recoverable marker. */
export function redactSensitiveLeaf(v: unknown): unknown {
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

/**
 * Walk a parsed JSON value and replace values of keys matching
 * SENSITIVE_KEY_RE with a redacted marker. Returns a new structure.
 */
export function redactSensitiveKeysDeep(value: unknown): unknown {
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

export const SENSITIVE_COOKIE_TOOLS: ReadonlySet<string> = new Set([
  "get_cookies",
  "list_all_cookies",
  "set_cookie",
  "delete_cookie",
])

/** Read tier: results may persist as a gate-checked, truncated prefix. */
export const READ_RELEASE_TOOLS: ReadonlySet<string> = new Set([
  "get_page_text",
  "get_page_html",
  "evaluate",
])

/** Exec tier: results always collapse to a { redacted, len, sha256 } stub. */
export const EXEC_FOLD_TOOLS: ReadonlySet<string> = new Set([
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

export const MCP_TOOL_PREFIX = "mcp__"
export const MCP_SENSITIVE_RESULT_RE =
  /(read|file|secret|token|key|env|credential|ssh|aws)/i
export const SENSITIVE_KEY_RE =
  /(secret|token|password|passwd|api[_-]?key|credential|private[_-]?key|authorization|bearer|apikey)/i

/** Read-tier prefix cap — aligned with the live/rebuild tool-result cap. */
export const READ_RELEASE_MAX_CHARS = MAX_TOOL_RESULT_CHARS

// ---------------------------------------------------------------------------
// Gate 1 — value-track secret shapes in free text.
// ---------------------------------------------------------------------------
const SECRET_VALUE_PATTERNS: readonly RegExp[] = [
  // JWT: three base64url segments; the header segment always starts "eyJ".
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\b/,
  // Bearer token carried in free text (Authorization-style). Separator after
  // "Bearer" is optional (`Authorization:Bearer<tok>` / `Bearer:<tok>`) —
  // review NIT-3: whitespace-only separation missed real headers.
  /\bBearer[:\s]?[A-Za-z0-9._~+\/-]{8,}={0,2}/i,
  // PEM / OpenSSH armored block header (-----BEGIN ... -----), any case.
  /-----BEGIN [A-Z0-9 ]{2,48}-----/i,
  // Well-known API key prefixes.
  /\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9]{8,}\b/, // Stripe
  /\bsk-(?:ant-)?[A-Za-z0-9_-]{16,}\b/, // OpenAI / Anthropic
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{16,}\b/, // GitHub tokens
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/, // GitHub fine-grained PAT
  /\bxox[baprs]-[A-Za-z0-9-]{8,}\b/, // Slack
  /\bAKIA[0-9A-Z]{16}\b/, // AWS access key id
  /\bAIza[0-9A-Za-z_-]{20,}\b/, // Google API key
  /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/, // SendGrid
  /\bya29\.[A-Za-z0-9_-]{10,}\b/, // Google OAuth access token
  /\bnpm_[A-Za-z0-9]{20,}\b/, // npm
  /\bhf_[A-Za-z0-9]{20,}\b/, // HuggingFace
]

/**
 * #370: export the value-track family so free-text redactors (threads 正文
 * distill) reuse the SAME patterns instead of drifting copies. Lock-step
 * tested via tests/redact-text.test.ts.
 */
export { SECRET_VALUE_PATTERNS }

/**
 * Gate 1: true when free text carries a value-track secret shape. Any hit →
 * the whole row fails closed to a full collapse stub.
 */
export function hasSecretShape(text: string): boolean {
  if (!text) return false
  return SECRET_VALUE_PATTERNS.some((re) => re.test(text))
}

// ---------------------------------------------------------------------------
// Gate 2 — code-exfil heuristic for evaluate code bodies.
// DOM direct-read theft paths whose RETURN VALUE carries no key-shaped
// features (the blind spot a pure value scan misses).
// ---------------------------------------------------------------------------
const EXFIL_CODE_PATTERNS: readonly RegExp[] = [
  /\bdocument\.cookie\b/,
  /\b(?:localStorage|sessionStorage)\b/,
  /\bindexedDB\b/,
  // Bracket-notation reads (review MAJOR-1): document["cookie"] /
  // window['localStorage'] are everyday JS, not encoding evasion — the dot
  // patterns above miss them and cookie values would land on disk verbatim.
  /\[\s*['"`](?:cookie|localStorage|sessionStorage|indexedDB)['"`]\s*\]/,
  // password inputs: input[type=password] / type="password" (+ .value reads)
  /\btype\s*=\s*["'`]?password["'`]?/i,
  // csrf / authenticity-token meta tags and hidden fields
  /<\s*meta[^>]*(?:csrf|token)/i,
  /\bname\s*=\s*["'`](?:_?csrf|csrfmiddlewaretoken|authenticity_token|_token)["'`]/i,
  /\bquerySelector(?:All)?\s*\([^)]*(?:password|csrf|authenticity_token)/i,
]

// evaluate RESULT-side cookie heuristic (review MAJOR-1, second half): when the
// code shape scan misses a cookie read, the returned value itself is often a
// cookie-jar serialization ("sid=abc; theme=light") or a well-known cookie
// name=. Applied to evaluate results only — page prose triggers these shapes
// too often, and fail-closed there would re-amnesia the read tier.
const COOKIE_JAR_RE = /[A-Za-z0-9_.-]{1,64}=[^;"\s]{1,4096};\s*[A-Za-z0-9_.-]{1,64}=/
const COOKIE_NAME_EQ_RE =
  /\b(?:connect\.sid|sid|session|sess|auth|access_token|refresh_token|jwt|csrf)=/i

// MAJOR-2: key-NAME scan for the read-tier release path. The value-track scan
// (gate 1) only recognizes secret SHAPES; an object payload like
// {password: "hunter2"} / {Authorization: "no-bearer-prefix"} slips through
// unless the serialized keys are checked against SENSITIVE_KEY_RE. Matches the
// quoted `"key":` form of JSON serialization (works on fragments too).
const SENSITIVE_KEY_NAME_TEXT_RE =
  /"[^"]*(?:secret|token|password|passwd|api[_-]?key|credential|private[_-]?key|authorization|bearer|apikey)[^"]*"\s*:/i

/** #370: exported for the free-text redactor (same family, same drift risk). */
export { SENSITIVE_KEY_NAME_TEXT_RE }

/**
 * Gate 2: true when evaluate code reads a DOM/storage secret directly.
 * Hardening layer, NOT a boundary — encoding can evade it; fail-closed on hit.
 */
export function hasExfilShape(code: string): boolean {
  if (!code) return false
  return EXFIL_CODE_PATTERNS.some((re) => re.test(code))
}

/**
 * Truncated-prefix envelope persisted for read-tier results whose serialized
 * data exceeds READ_RELEASE_MAX_CHARS. UI renders the 三态 copy from
 * kept/total ("已保留前 N/共 M 字符") — never implying the full content was
 * persisted.
 */
export interface TruncatedPrefixEnvelope {
  truncated: true
  kept: number
  total: number
  prefix: string
}

/**
 * Release read-tier data: pass through when small enough (完整), else persist
 * a surrogate-safe prefix envelope (截断). Gate scanning happens BEFORE this
 * on the FULL serialization, so the prefix can never smuggle a gated secret.
 */
export function releaseReadData(data: unknown): unknown {
  const s = JSON.stringify(data ?? null)
  if (s.length <= READ_RELEASE_MAX_CHARS) return data
  const prefix = safeSlice(s, READ_RELEASE_MAX_CHARS)
  const env: TruncatedPrefixEnvelope = {
    truncated: true,
    // NIT-1: kept must equal prefix.length — safeSlice may drop a dangling
    // high surrogate at the cut, making the honest kept 7999, not 8000.
    kept: prefix.length,
    total: s.length,
    prefix,
  }
  return env
}

/**
 * Fold codeish params (evaluate code/expression, shell command, host_write
 * body, security_token) to hash+length. Params are ALWAYS folded — the #255
 * release applies to read-tier RESULTS only.
 */
export function redactCodeishParams(
  params: Record<string, unknown>,
): Record<string, unknown> {
  const redacted: Record<string, unknown> = { ...params }
  for (const key of ["code", "expression", "security_token", "command", "body"]) {
    if (key in redacted && typeof redacted[key] === "string") {
      const val = redacted[key] as string
      redacted[key] = `<redacted:hash=${shortHash(val)},len=${val.length}>`
    }
  }
  return redacted
}

/**
 * #255 三道闸 (fail-closed) for read-tier result release. `params` here are the
 * RAW in-flight params (gate 2 inspects the evaluate code before it is folded).
 * Any gate hit → caller collapses the whole row.
 *
 * Gate input semantics (review NIT-2): callers scan the payload THEY actually
 * store. The thread-JSON redactor scans the full serialized data; history.db
 * scans the adapter's pre-capped ≤500-char summary (the only bytes it will
 * ever persist). A tail secret beyond 500 chars therefore folds the thread row
 * while history keeps a benign prefix — a classification divergence, never a
 * leak: the stored prefix by construction cannot contain the tail secret.
 */
export function readReleaseBlocked(toolName: string, params: unknown, dataStr: string): boolean {
  if (toolName === "evaluate") {
    // Gate 2: code-exfil heuristic on the evaluate code body (dot AND
    // bracket-notation DOM/storage reads — review MAJOR-1).
    if (params && typeof params === "object") {
      const p = params as Record<string, unknown>
      for (const key of ["code", "expression"]) {
        if (typeof p[key] === "string" && hasExfilShape(p[key] as string)) return true
      }
    }
    // Gate 2b: cookie-shaped RESULT value (jar serialization / well-known
    // cookie name=) — catches cookie reads the code heuristic missed.
    if (dataStr && (COOKIE_JAR_RE.test(dataStr) || COOKIE_NAME_EQ_RE.test(dataStr))) {
      return true
    }
  }
  // MAJOR-2: key-NAME scan of the payload — {password}/{token}/{Authorization}/
  // {api_key} fields must never persist, even when the value has no secret shape.
  if (dataStr && SENSITIVE_KEY_NAME_TEXT_RE.test(dataStr)) return true
  // Gates 1+3: value-track secret scan of the result payload (get_page_text /
  // get_page_html included — they previously passed through unscanned).
  if (dataStr && hasSecretShape(dataStr)) return true
  return false
}

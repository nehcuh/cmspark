// Operation history store — SQLite (pure JS via sql.js, no native dependencies)

import initSqlJs, { type Database as SqlJsDatabase } from "sql.js"
import * as fs from "fs"
import * as path from "path"
import * as crypto from "crypto"
import { getConfigDir } from "../config"
import { logger } from "../logger.js"

/**
 * Sensitive tool redaction (audit item 3).
 *
 * Tools whose params or results contain secrets / dangerous code have those
 * fields reduced to a non-recoverable summary (name + domain + value hash, or
 * code hash + length) BEFORE the record is written to history.db. This prevents
 * the 30-day-retained SQLite file from becoming a session-hijack / code-leak
 * trove.
 *
 * The hash is SHA-256 truncated to 12 hex chars — enough to correlate repeated
 * identical values without recovering them.
 */
const SENSITIVE_COOKIE_TOOLS = new Set(["get_cookies", "list_all_cookies", "set_cookie", "delete_cookie"])
const SENSITIVE_CODE_TOOLS = new Set(["evaluate", "osascript_eval"])

// MCP namespaced tools (mcp__<server>__<tool>) — audit item C-MCP-2. These flow
// through the same record path with raw params/result. We treat any tool whose
// name suggests file/secret/key/env access as "result is likely sensitive" and
// redact the entire result_summary; other MCP tools get key-based redaction on
// both params and result_summary.
const MCP_TOOL_PREFIX = "mcp__"
const MCP_SENSITIVE_RESULT_RE = /(read|file|secret|token|key|env|credential|ssh|aws)/i
const SENSITIVE_KEY_RE = /(secret|token|password|api[_-]?key|credential|private[_-]?key)/i

function shortHash(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex").slice(0, 12)
}

// Walks a parsed JSON value (object or array) and replaces values of keys
// matching SENSITIVE_KEY_RE with a redacted marker. Returns a new structure.
function redactSensitiveKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactSensitiveKeysDeep)
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(obj)) {
      const v = obj[k]
      if (SENSITIVE_KEY_RE.test(k) && typeof v === "string") {
        out[k] = `<redacted:len=${v.length}:sha256=${shortHash(v)}>`
      } else {
        out[k] = redactSensitiveKeysDeep(v)
      }
    }
    return out
  }
  return value
}

// Safely JSON-parse, transform, re-stringify. On any error returns null so
// callers can decide fallback behavior.
function rewriteJson(raw: string, fn: (parsed: unknown) => unknown): string | null {
  try {
    const parsed = JSON.parse(raw) as unknown
    return JSON.stringify(fn(parsed))
  } catch {
    return null
  }
}

function redactForStorage(
  toolName: string,
  rawParams: string | undefined,
  rawSummary: string | undefined,
): { params: string; result_summary: string } {
  // Default: pass through unchanged. Only tools in the sensitive sets get redacted.
  let params = rawParams || "{}"
  let result_summary = rawSummary || ""

  if (SENSITIVE_COOKIE_TOOLS.has(toolName)) {
    params = redactCookieParams(params)
    result_summary = redactCookieSummary(result_summary)
  } else if (SENSITIVE_CODE_TOOLS.has(toolName)) {
    params = redactCodeParams(params)
    // result_summary for evaluate/osascript typically contains the tool result
    // (e.g. return value of the eval) which is less sensitive than the code
    // itself; keep it but cap length to limit blast radius.
    if (result_summary.length > 200) result_summary = result_summary.slice(0, 200) + "…"
  } else if (toolName.startsWith(MCP_TOOL_PREFIX)) {
    // Audit item C-MCP-2: MCP tool params always get key-based redaction so
    // secrets/tokens/keys passed in as args never land in history.db.
    const redactedParams = rewriteJson(params, redactSensitiveKeysDeep)
    if (redactedParams !== null) params = redactedParams

    if (MCP_SENSITIVE_RESULT_RE.test(toolName)) {
      // File/secret/key/env/aws/ssh-class tools: the result is very likely to
      // contain raw secret material (file contents, key bytes, env vars).
      // Redact the entire summary by hash+length.
      result_summary = `<redacted:len=${result_summary.length}:sha256=${shortHash(result_summary)}>`
    } else {
      // Other MCP tools (search, query, etc.): keep result but apply the same
      // key-based scan to its parsed JSON form.
      const redactedSummary = rewriteJson(result_summary, redactSensitiveKeysDeep)
      if (redactedSummary !== null) result_summary = redactedSummary
    }
  }

  return { params, result_summary }
}

function redactCookieParams(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const redacted: Record<string, unknown> = { ...parsed }
    // Cookie params typically have `domain`, `url`, sometimes `name`. None of
    // these are secret — the cookie VALUE comes back in the result, not the params.
    // If a value somehow leaks into params (e.g. set_cookie), redact it.
    if ("value" in redacted && typeof redacted.value === "string") {
      redacted.value = `<redacted:hash=${shortHash(redacted.value)}>`
    }
    return JSON.stringify(redacted)
  } catch {
    // Malformed params JSON — can't safely introspect, blank it.
    return "{}"
  }
}

function redactCookieSummary(raw: string): string {
  try {
    // result_summary is JSON.stringify(toolResult.data || {}).slice(0, 500) per
    // adapter.ts. For cookie tools, data is typically an array of cookie objects
    // (get_cookies/list_all_cookies). For set_cookie it is a SINGLE cookie
    // object whose `value` field is the plaintext cookie value — audit item
    // C-SEC-1: that case previously slipped past the !Array.isArray early-return.
    const parsed = JSON.parse(raw) as unknown
    const asArray: unknown[] = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object"
        ? [parsed]
        : []
    if (!Array.isArray(parsed) && !(parsed && typeof parsed === "object")) {
      // Not a cookie object/array — can't safely redact, blank it.
      return ""
    }
    const safe = asArray.map((cookie: any) => {
      if (!cookie || typeof cookie !== "object") return cookie
      const { name, domain, path, hostOnly, secure, httpOnly, ...rest } = cookie
      // Keep the non-sensitive metadata; replace value with a hash so repeated
      // identical values can still be correlated without recovery.
      const valueStr = typeof rest.value === "string" ? rest.value : ""
      return {
        name, domain, path, hostOnly, secure, httpOnly,
        ...(valueStr ? { value_hash: shortHash(valueStr), value_length: valueStr.length } : {}),
      }
    })
    // Preserve the single-object shape for set_cookie callers; array shape for
    // get_cookies/list_all_cookies.
    const result = Array.isArray(parsed) ? safe : safe[0]
    return JSON.stringify(result)
  } catch {
    // Malformed summary — blank it rather than risk leaking.
    return ""
  }
}

function redactCodeParams(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const redacted: Record<string, unknown> = { ...parsed }
    // evaluate/osascript_eval params include `code` or `expression` with the
    // actual JS/AppleScript body. Replace with hash + length so the historical
    // record shows "this code ran" without persisting the code itself.
    for (const key of ["code", "expression"]) {
      if (key in redacted && typeof redacted[key] === "string") {
        const code = redacted[key] as string
        redacted[key] = `<redacted:hash=${shortHash(code)},len=${code.length}>`
      }
    }
    return JSON.stringify(redacted)
  } catch {
    return "{}"
  }
}

interface OperationRecord {
  id?: number
  thread_id: string
  tool_name: string
  params: string
  result_summary: string
  error: string | null
  success: number
  duration_ms: number
  created_at: string
}

interface QueryParams {
  thread_id?: string
  tool_name?: string
  keyword?: string
  from?: string
  to?: string
  limit?: number
  offset?: number
}

function findSqlWasmPath(): string | undefined {
  // Delegate to paths.ts for dev/packaged mode resolution
  const { getSqlWasmPath: resolveWasm } = require("../paths")
  return resolveWasm()
}

export class HistoryStore {
  private db: SqlJsDatabase | null = null
  private dbPath: string
  private ready: Promise<void>

  constructor() {
    this.dbPath = path.join(getConfigDir(), "history.db")
    this.ready = this.init()
  }

  private async init(): Promise<void> {
    const sqlJsConfig = (() => {
      const wasmPath = findSqlWasmPath()
      return wasmPath ? { locateFile: () => wasmPath } : undefined
    })()

    try {
      const SQL = await initSqlJs(sqlJsConfig)
      if (fs.existsSync(this.dbPath)) {
        const buffer = fs.readFileSync(this.dbPath)
        this.db = new SQL.Database(buffer)
      } else {
        this.db = new SQL.Database()
      }
      this.initSchema()
      this.purgeOldRecords()
      this.save()
    } catch (outerErr: any) {
      // Fallback: init in-memory only (file load or first init failed)
      logger.warn("history.init_fallback", { error: outerErr?.message || String(outerErr) })
      try {
        const SQL = await initSqlJs(sqlJsConfig)
        this.db = new SQL.Database()
        this.initSchema()
      } catch (innerErr: any) {
        // Total init failure: history is non-critical (observability only), but
        // surface the error so it isn't silently swallowed. All record/query
        // calls will no-op via the `if (!this.db)` guards.
        logger.error("history.init_failed", {
          error: innerErr?.message || String(innerErr),
          hint: "history record/query will silently no-op until process restart",
        })
      }
    }
  }

  async waitReady(): Promise<void> {
    return this.ready
  }

  private save(): void {
    if (!this.db) return
    try {
      const data = this.db.export()
      const buffer = Buffer.from(data)
      const dir = path.dirname(this.dbPath)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      // Audit item C-PERS-1: history.db contains redacted-but-still-sensitive
      // operation metadata (and pre-redaction raw values if a future redactor
      // regresses). Lock it to owner-only, matching config.ts / daemon.ts /
      // menu-bar-agent.ts. The mkdir above may pre-create with looser perms;
      // fchmod-mode 0o600 + explicit chmod covers pre-existing files.
      fs.writeFileSync(this.dbPath, buffer, { mode: 0o600 })
      try { fs.chmodSync(this.dbPath, 0o600) } catch { /* best-effort */ }
    } catch {
      // best-effort save
    }
  }

  private initSchema(): void {
    if (!this.db) return
    this.db.run(`CREATE TABLE IF NOT EXISTS operations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      thread_id TEXT NOT NULL,
      tool_name TEXT NOT NULL,
      params TEXT,
      result_summary TEXT,
      error TEXT,
      success INTEGER NOT NULL DEFAULT 1,
      duration_ms INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`)
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_ops_thread ON operations(thread_id)`)
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_ops_created ON operations(created_at)`)
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_ops_tool ON operations(tool_name)`)
  }

  record(op: OperationRecord): number {
    if (!this.db) return 0
    // Audit item 3: redact sensitive tool params/results BEFORE persistence.
    // Without this, get_cookies writes every cookie value (including httpOnly
    // session tokens) verbatim into ~/.cmspark-agent/history.db, retained for
    // 30 days. Anyone with read access to that file gets full session-hijack
    // material for every trusted site. evaluate/osascript_eval similarly leak
    // the exact code body that was confirmed.
    const { params: safeParams, result_summary: safeSummary } = redactForStorage(op.tool_name, op.params, op.result_summary)
    this.db.run(
      `INSERT INTO operations (thread_id, tool_name, params, result_summary, error, success, duration_ms, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        op.thread_id, op.tool_name, safeParams,
        safeSummary, op.error || null,
        op.success ? 1 : 0, op.duration_ms || 0,
        op.created_at || new Date().toISOString(),
      ],
    )
    const row = this.db.exec("SELECT last_insert_rowid() as id")
    return row.length > 0 ? (row[0].values[0][0] as number) : 0
  }

  query(params: QueryParams): OperationRecord[] {
    if (!this.db) return []
    const conditions: string[] = []
    const values: any[] = []
    if (params.thread_id) { conditions.push("thread_id = ?"); values.push(params.thread_id) }
    if (params.tool_name) { conditions.push("tool_name = ?"); values.push(params.tool_name) }
    if (params.keyword) {
      conditions.push("(tool_name LIKE ? OR result_summary LIKE ? OR params LIKE ?)")
      const kw = `%${params.keyword}%`; values.push(kw, kw, kw)
    }
    if (params.from) { conditions.push("created_at >= ?"); values.push(params.from) }
    if (params.to) { conditions.push("created_at <= ?"); values.push(params.to) }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""
    const limit = params.limit || 100
    const offset = params.offset || 0

    const stmt = this.db.prepare(`SELECT * FROM operations ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    stmt.bind([...values, limit, offset])
    const results: OperationRecord[] = []
    while (stmt.step()) { results.push(stmt.getAsObject() as unknown as OperationRecord) }
    stmt.free()
    return results
  }

  exportJSON(params: { thread_id?: string; from?: string; to?: string }): OperationRecord[] {
    if (!this.db) return []
    const conditions: string[] = []
    const values: any[] = []
    if (params.thread_id) { conditions.push("thread_id = ?"); values.push(params.thread_id) }
    if (params.from) { conditions.push("created_at >= ?"); values.push(params.from) }
    if (params.to) { conditions.push("created_at <= ?"); values.push(params.to) }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""
    const stmt = this.db.prepare(`SELECT * FROM operations ${where} ORDER BY created_at DESC`)
    if (values.length > 0) stmt.bind(values)
    const results: OperationRecord[] = []
    while (stmt.step()) { results.push(stmt.getAsObject() as unknown as OperationRecord) }
    stmt.free()
    return results
  }

  private purgeOldRecords(): void {
    if (!this.db) return
    try {
      const { getConfig } = require("../config")
      const config = getConfig()
      const days = config.history_retention_days || 30
      const cutoff = new Date()
      cutoff.setDate(cutoff.getDate() - days)
      this.db.run("DELETE FROM operations WHERE created_at < ?", [cutoff.toISOString()])
    } catch { /* skip if config unavailable */ }
  }

  close(): void {
    if (this.db) { this.save(); this.db.close(); this.db = null }
  }
}

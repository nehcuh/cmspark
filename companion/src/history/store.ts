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

function shortHash(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex").slice(0, 12)
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
    // adapter.ts. For cookie tools, data is an array of cookie objects.
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return raw // unexpected shape — leave alone
    const safe = parsed.map((cookie: any) => {
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
    return JSON.stringify(safe)
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
      fs.writeFileSync(this.dbPath, buffer)
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

// Operation history store — SQLite

import Database from "better-sqlite3"
import * as path from "path"
import { getConfigDir } from "../config"

interface OperationRecord {
  id?: number
  thread_id: string
  tool_name: string
  params: string  // JSON
  result_summary: string
  error: string | null
  success: number  // 0 or 1
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

export class HistoryStore {
  private db: Database.Database

  constructor() {
    const dbPath = path.join(getConfigDir(), "history.db")
    this.db = new Database(dbPath)
    this.db.pragma("journal_mode = WAL")
    this.initSchema()
    this.purgeOldRecords()
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS operations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        params TEXT,
        result_summary TEXT,
        error TEXT,
        success INTEGER NOT NULL DEFAULT 1,
        duration_ms INTEGER DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_ops_thread ON operations(thread_id);
      CREATE INDEX IF NOT EXISTS idx_ops_created ON operations(created_at);
      CREATE INDEX IF NOT EXISTS idx_ops_tool ON operations(tool_name);
    `)
  }

  record(op: OperationRecord): number {
    const stmt = this.db.prepare(`
      INSERT INTO operations (thread_id, tool_name, params, result_summary, error, success, duration_ms, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const result = stmt.run(
      op.thread_id,
      op.tool_name,
      op.params || "{}",
      op.result_summary || "",
      op.error || null,
      op.success ? 1 : 0,
      op.duration_ms || 0,
      op.created_at || new Date().toISOString(),
    )
    return result.lastInsertRowid as number
  }

  query(params: QueryParams): OperationRecord[] {
    const conditions: string[] = []
    const values: any[] = []

    if (params.thread_id) {
      conditions.push("thread_id = ?")
      values.push(params.thread_id)
    }
    if (params.tool_name) {
      conditions.push("tool_name = ?")
      values.push(params.tool_name)
    }
    if (params.keyword) {
      conditions.push("(tool_name LIKE ? OR result_summary LIKE ? OR params LIKE ?)")
      const kw = `%${params.keyword}%`
      values.push(kw, kw, kw)
    }
    if (params.from) {
      conditions.push("created_at >= ?")
      values.push(params.from)
    }
    if (params.to) {
      conditions.push("created_at <= ?")
      values.push(params.to)
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""
    const limit = params.limit || 100
    const offset = params.offset || 0

    const stmt = this.db.prepare(`
      SELECT * FROM operations ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?
    `)
    return stmt.all(...values, limit, offset) as OperationRecord[]
  }

  exportJSON(params: { thread_id?: string; from?: string; to?: string }): OperationRecord[] {
    const conditions: string[] = []
    const values: any[] = []

    if (params.thread_id) {
      conditions.push("thread_id = ?")
      values.push(params.thread_id)
    }
    if (params.from) {
      conditions.push("created_at >= ?")
      values.push(params.from)
    }
    if (params.to) {
      conditions.push("created_at <= ?")
      values.push(params.to)
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""
    const stmt = this.db.prepare(`SELECT * FROM operations ${where} ORDER BY created_at DESC`)
    return stmt.all(...values) as OperationRecord[]
  }

  private purgeOldRecords(): void {
    const { getConfig } = require("../config")
    const config = getConfig()
    const days = config.history_retention_days || 30
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - days)

    this.db.prepare("DELETE FROM operations WHERE created_at < ?").run(cutoff.toISOString())
  }

  close(): void {
    this.db.close()
  }
}

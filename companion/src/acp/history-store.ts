// #732: minimum observational metadata only; never reconstitutes an ACP session.
import * as fs from "fs"
import * as path from "path"
import { randomUUID } from "crypto"
import { verifyHistoryPrivacy } from "./history-privacy"

export type AcpHistoryState = "offered" | "confirmed" | "running" | "handback" | "closed"
export type AcpHistoryStatus = "ok" | "disabled" | "unavailable" | "invalid" | "private_refused" | "commit_unknown" | "capacity"
export interface AcpHistoryRecord {
  session_id: string; thread_id: string; agent_id: string
  mode: "review_readonly" | "propose_diff"
  created_at: string; updated_at: string; observed_state: AcpHistoryState
  terminal_kind?: "closed" | "cancelled" | "failed"
}
export interface AcpHistoryRow extends AcpHistoryRecord {
  source: "live" | "history"
  history_status: AcpHistoryState | "interrupted"
}
export type AcpHistoryReply = { status: AcpHistoryStatus; rows: AcpHistoryRow[] }
export const ACP_HISTORY_MAX_ROWS = 256
export const ACP_HISTORY_THREAD_ROWS = 32
export const ACP_HISTORY_MAX_BYTES = 1024 * 1024
export const ACP_HISTORY_REPLY_BYTES = 64 * 1024
const STATES = new Set(["offered", "confirmed", "running", "handback", "closed"])
const TERMINAL = new Set(["closed", "cancelled", "failed"])
const KEYS = new Set(["session_id", "thread_id", "agent_id", "mode", "created_at", "updated_at", "observed_state", "terminal_kind"])
const ID = (v: unknown): v is string => typeof v === "string" && !!v && Buffer.byteLength(v) <= 256 && !/[\x00-\x1f\x7f]/.test(v)
const ISO = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v
function validRecord(value: unknown): value is AcpHistoryRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const r = value as Record<string, unknown>
  return Object.keys(r).every(k => KEYS.has(k)) && ID(r.session_id) && ID(r.thread_id) && ID(r.agent_id) &&
    (r.mode === "review_readonly" || r.mode === "propose_diff") && ISO(r.created_at) && ISO(r.updated_at) &&
    typeof r.observed_state === "string" && STATES.has(r.observed_state) && (r.terminal_kind === undefined ||
      typeof r.terminal_kind === "string" && TERMINAL.has(r.terminal_kind) && ["closed", "handback"].includes(r.observed_state))
}
export function projectAcpHistory(session: { [key: string]: any }, now = new Date().toISOString()): AcpHistoryRecord | null {
  const row: AcpHistoryRecord = { session_id: session.session_id, thread_id: session.thread_id,
    agent_id: session.agent_id, mode: session.mode, created_at: session.created_at, updated_at: now,
    observed_state: session.state,
    ...(TERMINAL.has(session.terminal_kind) ? { terminal_kind: session.terminal_kind } : {}) }
  return validRecord(row) ? row : null
}
export function parseAcpHistory(text: string): AcpHistoryRecord[] | null {
  if (Buffer.byteLength(text) > ACP_HISTORY_MAX_BYTES) return null
  try {
    const value = JSON.parse(text)
    if (!value || typeof value !== "object" || Array.isArray(value) ||
        Object.keys(value).sort().join() !== "records,version" || value.version !== 1 ||
        !Array.isArray(value.records) || value.records.length > ACP_HISTORY_MAX_ROWS) return null
    const seen = new Set<string>(), perThread = new Map<string, number>()
    for (const row of value.records) {
      if (!validRecord(row) || seen.has(row.session_id)) return null
      seen.add(row.session_id)
      const count = (perThread.get(row.thread_id) || 0) + 1
      if (count > ACP_HISTORY_THREAD_ROWS) return null
      perThread.set(row.thread_id, count)
    }
    return value.records
  } catch { return null }
}
const sameObject = (a: fs.Stats, b: fs.Stats) => a.dev === b.dev && a.ino === b.ino
const identity = (a: fs.Stats, b: fs.Stats) => sameObject(a, b) && a.nlink === b.nlink
const unchanged = (a: fs.Stats, b: fs.Stats) => identity(a, b) && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs
const terminal = (r: AcpHistoryRecord) => r.observed_state === "closed" || r.observed_state === "handback" || !!r.terminal_kind
const order = (a: AcpHistoryRecord, b: AcpHistoryRecord) => a.updated_at < b.updated_at ? -1 : a.updated_at > b.updated_at ? 1 : a.session_id === b.session_id ? 0 : a.session_id < b.session_id ? -1 : 1

export class AcpHistoryStore {
  private rows = new Map<string, AcpHistoryRecord>()
  private protectedIds = new Set<string>()
  private status: AcpHistoryStatus = "ok"
  private loaded = false
  private blocked = false
  private dirty = false
  private work: Promise<void> | null = null
  private rootPath = ""
  private rootIdentity: fs.Stats | null = null
  private fileIdentity: fs.Stats | null = null
  private retiredTemp: { name: string; identity: fs.Stats } | null = null
  constructor(private options: { root: () => string; enabled: () => boolean;
    privacy?: (paths: string[]) => Promise<"PRIVATE" | "REFUSED" | "UNKNOWN"> }) {}

  note(session: { [key: string]: any }, active?: boolean): void {
    if (!this.options.enabled()) return
    const row = projectAcpHistory(session)
    if (!row) { this.status = "invalid"; return }
    const old = this.rows.get(row.session_id)
    if (old && old.thread_id !== row.thread_id) { this.status = "invalid"; return }
    const protect = active ?? !terminal(row)
    if (old && old.observed_state === row.observed_state && old.terminal_kind === row.terminal_kind) {
      if (protect) this.protectedIds.add(row.session_id); else this.protectedIds.delete(row.session_id)
      return
    }
    const proposed = new Map(this.rows); proposed.set(row.session_id, row)
    const protectedIds = new Set(this.protectedIds)
    if (protect) protectedIds.add(row.session_id); else protectedIds.delete(row.session_id)
    if (!this.fit(proposed, protectedIds)) { this.status = "capacity"; return }
    this.rows = proposed; this.protectedIds = protectedIds
    this.dirty = true
    this.startWork()
  }
  private fit(rows: Map<string, AcpHistoryRecord>, protectedIds: Set<string>): boolean {
    while (true) {
      const counts = new Map<string, number>()
      for (const row of rows.values()) counts.set(row.thread_id, (counts.get(row.thread_id) || 0) + 1)
      const fullThread = [...counts].find(([, count]) => count > ACP_HISTORY_THREAD_ROWS)?.[0]
      const bytes = Buffer.byteLength(JSON.stringify({ version: 1, records: [...rows.values()] }))
      if (!fullThread && rows.size <= ACP_HISTORY_MAX_ROWS && bytes <= ACP_HISTORY_MAX_BYTES) return true
      const candidates = [...rows.values()].filter(r => !protectedIds.has(r.session_id) && (!fullThread || r.thread_id === fullThread))
      const evict = candidates.filter(terminal).sort(order)[0] || candidates.sort(order)[0]
      if (!evict) return false
      rows.delete(evict.session_id)
    }
  }
  private startWork(): void {
    if (this.work || this.blocked || !this.options.enabled()) return
    this.work = this.run().catch(() => { this.status = "unavailable"; this.blocked = true })
      .finally(() => { this.work = null; if (this.dirty && !this.blocked && this.options.enabled()) this.startWork() })
  }
  async settle(): Promise<void> { while (this.work) await this.work }
  private enabled(): void { if (!this.options.enabled()) throw new Error("disabled") }
  private safeStat(name: string, directory = false): fs.Stats {
    this.enabled()
    const stat = fs.lstatSync(name)
    if (!Number.isFinite(stat.ino) || stat.ino <= 0) throw new Error("private")
    if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1)) throw new Error("private")
    if (process.platform !== "win32" && (stat.uid !== process.getuid?.() || (stat.mode & 0o077) !== 0)) throw new Error("private")
    return stat
  }
  private assertRoot(): void {
    // APFS changes directory nlink when our own temp is created; file nlink stays strict.
    if (!this.rootIdentity || !sameObject(this.rootIdentity, this.safeStat(this.rootPath, true))) throw new Error("private")
    if (fs.realpathSync(this.rootPath) !== this.rootPath) throw new Error("private")
  }
  private async privacy(paths: string[]): Promise<void> {
    this.enabled()
    if (process.platform === "win32") {
      const result = await (this.options.privacy || verifyHistoryPrivacy)(paths)
      this.enabled(); this.assertRoot()
      if (result !== "PRIVATE") throw new Error("private")
    }
  }
  private name(): string { return path.join(this.rootPath, "acp-history.json") }
  private async load(): Promise<void> {
    this.enabled()
    const raw = path.resolve(this.options.root())
    this.rootPath = raw; this.rootIdentity = this.safeStat(raw, true)
    if (fs.realpathSync(raw) !== raw) throw new Error("private")
    await this.privacy([raw]); this.assertRoot()
    let before: fs.Stats
    try { before = this.safeStat(this.name()) }
    catch (e: any) { if (e?.code === "ENOENT") { this.loaded = true; return }; throw e }
    if (before.size > ACP_HISTORY_MAX_BYTES) throw new Error("invalid")
    await this.privacy([raw, this.name()]); this.assertRoot()
    if (!unchanged(before, this.safeStat(this.name()))) throw new Error("private")
    let fd: number | undefined
    try {
      this.enabled()
      fd = fs.openSync(this.name(), fs.constants.O_RDONLY | (process.platform === "win32" ? 0 : fs.constants.O_NOFOLLOW))
      if (!unchanged(before, fs.fstatSync(fd))) throw new Error("private")
      const buffer = Buffer.alloc(ACP_HISTORY_MAX_BYTES + 1)
      let length = 0
      while (length < buffer.length) { const n = fs.readSync(fd, buffer, length, buffer.length - length, null); if (!n) break; length += n }
      if (length > ACP_HISTORY_MAX_BYTES || !unchanged(before, fs.fstatSync(fd)) || !unchanged(before, this.safeStat(this.name()))) throw new Error("invalid")
      const body = buffer.subarray(0, length)
      const text = body.toString("utf8")
      if (!Buffer.from(text).equals(body)) throw new Error("invalid")
      const parsed = parseAcpHistory(text)
      if (!parsed) throw new Error("invalid")
      const merged = new Map(parsed.map(r => [r.session_id, r]))
      for (const row of this.rows.values()) {
        if (merged.has(row.session_id) && merged.get(row.session_id)!.thread_id !== row.thread_id) throw new Error("invalid")
        merged.set(row.session_id, row)
      }
      if (!this.fit(merged, this.protectedIds)) throw new Error("capacity")
      this.rows = merged; this.fileIdentity = before; this.loaded = true
    } finally { if (fd !== undefined) { const close = fd; fd = undefined; fs.closeSync(close) } }
  }
  private async commit(): Promise<void> {
    this.enabled(); this.assertRoot()
    if (this.retiredTemp) {
      try {
        if (!identity(this.retiredTemp.identity, this.safeStat(this.retiredTemp.name))) throw new Error("private")
        fs.unlinkSync(this.retiredTemp.name); this.retiredTemp = null
      } catch (e: any) { if (e?.code === "ENOENT") this.retiredTemp = null; else throw e }
    }
    const contents = Buffer.from(JSON.stringify({ version: 1, records: [...this.rows.values()].sort(order) }))
    if (contents.length > ACP_HISTORY_MAX_BYTES) throw new Error("capacity")
    if (this.fileIdentity) {
      if (!unchanged(this.fileIdentity, this.safeStat(this.name()))) throw new Error("private")
      await this.privacy([this.rootPath, this.name()])
      if (!unchanged(this.fileIdentity, this.safeStat(this.name()))) throw new Error("private")
    } else {
      try { this.safeStat(this.name()); throw new Error("private") }
      catch (e: any) { if (e?.code !== "ENOENT") throw e }
    }
    const temp = path.join(this.rootPath, `acp-history.${randomUUID()}.tmp`)
    let fd: number | undefined, owned: fs.Stats | undefined, renamed = false
    try {
      this.enabled(); this.assertRoot()
      fd = fs.openSync(temp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL |
        (process.platform === "win32" ? 0 : fs.constants.O_NOFOLLOW), 0o600)
      owned = fs.fstatSync(fd)
      if (!identity(owned, this.safeStat(temp))) throw new Error("private")
      // An exclusive EMPTY file must pass its real ACL before metadata enters it.
      await this.privacy([this.rootPath, temp]); this.assertRoot()
      if (!identity(owned, this.safeStat(temp)) || !identity(owned, fs.fstatSync(fd))) throw new Error("private")
      this.enabled()
      let offset = 0
      while (offset < contents.length) { const n = fs.writeSync(fd, contents, offset, contents.length - offset); if (!n) throw new Error("write"); offset += n }
      fs.fsyncSync(fd)
      if (!identity(owned, this.safeStat(temp))) throw new Error("private")
      await this.privacy([this.rootPath, temp]); this.assertRoot()
      if (!identity(owned, this.safeStat(temp)) || !identity(owned, fs.fstatSync(fd))) throw new Error("private")
      this.enabled()
      const close = fd; fd = undefined; fs.closeSync(close)
      if (this.fileIdentity ? !unchanged(this.fileIdentity, this.safeStat(this.name())) : fs.existsSync(this.name())) throw new Error("private")
      this.assertRoot(); fs.renameSync(temp, this.name()); renamed = true
      this.fileIdentity = this.safeStat(this.name())
      if (!identity(owned, this.fileIdentity)) throw new Error("private")
      await this.privacy([this.rootPath, this.name()]); this.assertRoot()
      if (!unchanged(this.fileIdentity, this.safeStat(this.name()))) throw new Error("private")
      this.status = "ok"
    } catch (e) {
      if (renamed) { this.status = "commit_unknown"; this.blocked = true }
      throw e
    } finally {
      if (fd !== undefined) { const close = fd; fd = undefined; try { fs.closeSync(close) } catch {} }
      // Never delete a replaced path or mutate history after the master switch goes off.
      if (!renamed && owned && this.options.enabled()) {
        try { this.assertRoot(); if (identity(owned, this.safeStat(temp))) fs.unlinkSync(temp) } catch {}
      } else if (!renamed && owned) {
        // A disable during the async privacy query never mutates history afterwards.
        // Keep at most this one operation-owned cleanup claim for a future enable.
        this.retiredTemp = { name: temp, identity: owned }
      }
    }
  }
  private async run(): Promise<void> {
    try {
      if (!this.loaded) await this.load()
      while (this.dirty && this.options.enabled() && !this.blocked) {
        this.dirty = false; await this.commit()
      }
    } catch (e: any) {
      if (this.status !== "commit_unknown") this.status = !this.options.enabled() ? "disabled" :
        e?.message === "private" ? "private_refused" : e?.message === "invalid" ? "invalid" : e?.message === "capacity" ? "capacity" : "unavailable"
      if (!this.options.enabled() && this.rows.size) this.dirty = true
      this.blocked = this.options.enabled()
    }
  }
  async list(threadId: string, live: Array<{ [key: string]: any }>): Promise<AcpHistoryReply> {
    if (!this.options.enabled()) return { status: "disabled", rows: [] }
    this.startWork(); await this.settle()
    if (!this.options.enabled()) return { status: "disabled", rows: [] }
    if (this.blocked) return { status: this.status, rows: [] }
    const rows = new Map<string, AcpHistoryRow>()
    for (const row of this.rows.values()) if (row.thread_id === threadId) rows.set(row.session_id, {
      // Only the manager's current live snapshot can assert a nonterminal state.
      ...row, source: "history", history_status: !terminal(row) ? "interrupted" : row.observed_state,
    })
    for (const session of live) {
      const row = projectAcpHistory(session)
      if (row && row.thread_id === threadId) rows.set(row.session_id, { ...row, source: "live", history_status: row.observed_state })
    }
    const result = [...rows.values()].sort(order).slice(-ACP_HISTORY_THREAD_ROWS)
    while (Buffer.byteLength(JSON.stringify(result)) > ACP_HISTORY_REPLY_BYTES) result.shift()
    return { status: this.status, rows: result }
  }
}

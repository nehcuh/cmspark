/** #726: ephemeral declarations, never workspace receipts or authority. No I/O. */
export type WorkspaceHint = Readonly<{ key: string; path: string; source: "acp-offer" | "shell-cwd" | "literal-cd"; recent: number; count: number }>
export type WorkspaceHintView = Readonly<{ threadId: string; revision: number; connection: object; rows: readonly WorkspaceHint[] }>
function own(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object") return undefined
  try { const d = Object.getOwnPropertyDescriptor(value, key); return d && "value" in d ? d.value : undefined } catch { return undefined }
}
function complete(value: unknown): boolean {
  return !!value && typeof value === "object" && !["folded", "redacted", "truncated", "omitted", "omission", "_redacted"].some(k => own(value, k) !== undefined && own(value, k) !== false)
}
export function workspaceHintPath(value: unknown): { key: string; path: string } | null {
  if (typeof value !== "string" || !value || value !== value.trim() || /[\p{Cc}\p{Cf}\p{Cs}\u2028\u2029]/u.test(value)) return null
  if (value.startsWith("/")) {
    if (value.startsWith("//") || value.split("/").some(p => p === "." || p === "..")) return null
    const p = value.replace(/\/+$/, "") || "/"; return { key: p, path: p }
  }
  let p = value.replace(/\//g, "\\")
  if (/^\\\\[?.]\\/.test(p) || p.split("\\").some(p => p === "." || p === "..")) return null
  if (/^[A-Za-z]:\\/.test(p)) { p = p[0].toUpperCase() + p.slice(1); p = p.replace(/\\+$/, "") || p; if (p.length === 2) p += "\\"; return { key: p, path: p } }
  const unc = /^\\\\([^\\]+)\\([^\\]+)(.*)$/.exec(p)
  if (!unc) return null
  p = `\\\\${unc[1].toLowerCase()}\\${unc[2].toLowerCase()}${unc[3]}`.replace(/\\+$/, "")
  return { key: p, path: p }
}
export class WorkspaceHints {
  private threadId = ""
  private revision = -1
  private connection: object | null = null
  private ordinal = 0
  private rows: WorkspaceHint[] = []
  private starts = new Map<string, string>()
  private ambiguous = false
  select(threadId: string | null, revision: number): void {
    if (this.threadId !== (threadId || "") || this.revision !== revision) { this.threadId = threadId || ""; this.revision = revision; this.clear() }
  }
  private clear(): void { this.rows = []; this.starts.clear(); this.ordinal = 0; this.ambiguous = false }
  view(): WorkspaceHintView | null { return this.connection && this.threadId ? { threadId: this.threadId, revision: this.revision, connection: this.connection, rows: this.rows } : null }
  private add(value: unknown, source: WorkspaceHint["source"]): void {
    const p = workspaceHintPath(value); if (!p) return
    const old = this.rows.find(r => r.key === p.key)
    const row = Object.freeze({ ...p, source, recent: ++this.ordinal, count: (old?.count || 0) + 1 })
    this.rows = [row, ...this.rows.filter(r => r.key !== p.key)].slice(0, 3)
  }
  observe(msg: unknown): boolean {
    const type = own(msg, "type")
    if (type === "connected" || type === "thread.mutation.connection") {
      this.connection = type === "connected" || own(msg, "state") === "connected" ? {} : null; this.clear(); return true
    }
    if (!this.connection || !this.threadId || own(msg, "thread_id") !== this.threadId) return false
    const id = own(msg, "tool_call_id"), name = own(msg, "tool_name")
    if (typeof id !== "string" || !id) return false
    if (this.ambiguous) return false
    if (type === "tool.start") {
      // Once an outstanding ID is reused, no later result proves its holder.
      // Retain verified hints but stop this selection/connection's collection.
      if (this.starts.has(id)) { this.ambiguous = true; this.starts.clear(); return false }
      if ((name === "shell_exec" || name === "acp_propose_session") && complete(own(msg, "params"))) {
        // At most the same three live source holders; evicted sources cannot complete.
        this.starts.set(id, name)
        if (this.starts.size > 3) this.starts.delete(this.starts.keys().next().value!)
      }
      return false
    }
    if (type !== "tool.result") return false
    const start = this.starts.get(id); this.starts.delete(id)
    const result = own(msg, "result"), data = own(result, "data")
    if (!start || name !== start || !complete(result) || !complete(data) || own(result, "success") !== true) return false
    if (name === "acp_propose_session" && typeof own(data, "session_id") === "string" && !!own(data, "session_id") && own(data, "state") === "offered") this.add(own(data, "workspace_root"), "acp-offer")
    if (name === "shell_exec" && own(data, "exit_code") === 0 && own(data, "timed_out") === false && own(data, "aborted") === false) {
      this.add(own(data, "cwd"), "shell-cwd"); this.add(own(data, "declared_cwd"), "literal-cd")
    }
    return true
  }
}

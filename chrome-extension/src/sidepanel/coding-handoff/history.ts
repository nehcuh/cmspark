/** #732 display-only metadata; never hydrate rich ACP records or action IDs. */
export type CodingHistoryRow = {
  session_id: string; thread_id: string; agent_id: string; mode: "review_readonly" | "propose_diff"
  created_at: string; updated_at: string; observed_state: string; terminal_kind?: "closed" | "cancelled" | "failed"
  source: "live" | "history"; history_status: string
}
export type CodingHistory = { threadId: string; requestId: string; selectionRevision: number;
  pending: boolean; status: string; rows: CodingHistoryRow[];
  /** UI-only reference fence; never sent or persisted as historical metadata. */
  runtimeAtRequest?: { sessionId: string; threadId: string } | null }
const STATUS = new Set(["ok", "disabled", "unavailable", "invalid", "private_refused", "commit_unknown", "capacity"])
const STATES = new Set(["offered", "confirmed", "running", "handback", "closed"])
const KEYS = new Set(["session_id", "thread_id", "agent_id", "mode", "created_at", "updated_at", "observed_state", "terminal_kind", "source", "history_status"])
const bytes = (v: string) => new TextEncoder().encode(v).length
const id = (v: unknown): v is string => typeof v === "string" && !!v && bytes(v) <= 256 && !/[\x00-\x1f\x7f]/.test(v)
const iso = (v: unknown) => typeof v === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v
export function parseCodingHistory(message: any): { threadId: string; requestId: string; status: string; rows: CodingHistoryRow[] } | null {
  if (!message || message.type !== "acp.sessions.list_result" || !id(message.thread_id) ||
      typeof message.request_id !== "string" || !/^[A-Za-z0-9:_-]{1,100}$/.test(message.request_id) ||
      !STATUS.has(message.status) || !Array.isArray(message.rows) || message.rows.length > 32 ||
      bytes(JSON.stringify(message.rows)) > 64 * 1024) return null
  const seen = new Set<string>()
  for (const r of message.rows) {
    if (!r || typeof r !== "object" || Array.isArray(r) || Object.keys(r).some(k => !KEYS.has(k)) ||
        !id(r.session_id) || !id(r.agent_id) || r.thread_id !== message.thread_id || seen.has(r.session_id) ||
        !["review_readonly", "propose_diff"].includes(r.mode) || !iso(r.created_at) || !iso(r.updated_at) ||
        !STATES.has(r.observed_state) || !["live", "history"].includes(r.source) ||
        !(r.history_status === r.observed_state || r.source === "history" && r.history_status === "interrupted" && !["closed", "handback"].includes(r.observed_state)) ||
        r.terminal_kind !== undefined && !["closed", "cancelled", "failed"].includes(r.terminal_kind)) return null
    if (r.source === "history" && !["closed", "handback"].includes(r.observed_state) && !r.terminal_kind && r.history_status !== "interrupted") return null
    seen.add(r.session_id)
  }
  if (message.status === "disabled" && message.rows.length) return null
  return { threadId: message.thread_id, requestId: message.request_id, status: message.status, rows: message.rows }
}
export function codingHistoryLabel(row: CodingHistoryRow): string {
  if (row.history_status === "interrupted") return "已中断；无法恢复原进程关联"
  if (row.terminal_kind === "cancelled") return "已取消（会话记录）"
  if (row.terminal_kind === "failed") return "失败（会话记录）"
  const labels: Record<string, string> = { offered: "待启动", confirmed: "已确认", running: "运行记录（非健康证明）", handback: "已回传", closed: "会话已关闭" }
  return labels[row.history_status] || "状态未知"
}

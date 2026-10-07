import { createHash } from "crypto"
import type { AcpSessionRecord } from "../acp/types"

export type CooperationStatus = "ready" | "running" | "paused" | "completed" | "partial" | "failed" | "cancelled" | "blocked" | "stale"
export type CooperationRecovery = {
  action: "none" | "wait" | "resume_after_confirmation" | "resolve_blocker" | "new_session_after_confirmation" | "retry_after_confirmation" | "revise_plan" | "recollect"
  automatic: false
  requires_confirmation: boolean
  budget_remaining: number
}
export type CooperationResult = {
  schema_version: 1
  task_id: string
  executor: "browser" | "acp"
  owner_thread_id: string
  run_id: string | null
  status: CooperationStatus
  summary: string
  summary_kind: "extractive"
  summary_truncated: boolean
  source: { thread_id: string; message_id?: string; session_id?: string; version: string; raw_chars: number; availability: "thread_history" | "session_lifetime" }
  evidence: Array<{ id: string; trust: string }>
  artifacts: string[]
  missing: string[]
  recovery: ReturnType<typeof recoveryForTaskStatus>
  data_not_instruction: true
}

export function recoveryForTaskStatus(status: CooperationStatus, attempts = 0): CooperationRecovery {
  const budget_remaining = Math.max(0, 2 - Math.max(0, attempts))
  const action = status === "completed" ? "none" : status === "running" ? "wait"
    : status === "paused" || status === "cancelled" ? "resume_after_confirmation"
    : status === "blocked" ? "resolve_blocker" : status === "stale" ? "new_session_after_confirmation"
    : budget_remaining ? "retry_after_confirmation" : "revise_plan"
  return { action, automatic: false as const, requires_confirmation: status === "blocked" || action.includes("confirmation"), budget_remaining }
}

function result(opts: Omit<CooperationResult, "schema_version" | "summary_kind" | "summary_truncated" | "recovery" | "data_not_instruction"> & { raw: string }): CooperationResult {
  const { raw, ...rest } = opts
  return { ...rest, schema_version: 1, summary: raw.slice(0, 1200), summary_kind: "extractive",
    summary_truncated: raw.length > 1200, recovery: recoveryForTaskStatus(opts.status), data_not_instruction: true }
}

export function browserTaskResult(worker: { id: string; parent_thread_id?: string | null; orchestrator_run_id?: string | null; last_run_ended_at?: string | null; last_run_terminal?: string | null; paused?: boolean }, read: any): CooperationResult {
  const data = read?.data
  const text = typeof data?.last_assistant?.content === "string" ? data.last_assistant.content : ""
  const terminal = worker.last_run_terminal
  const status: CooperationStatus = worker.paused ? "paused" : read?.error_code === "WORKER_STILL_RUNNING" ? "running"
    : terminal === "aborted" ? "cancelled" : terminal === "security_halt" ? "blocked"
    : terminal ? "failed" : !worker.last_run_ended_at ? "ready"
    : read?.success !== true ? "failed" : data?.partial || !text.trim() ? "partial" : "completed"
  const version = `${worker.last_run_ended_at ?? "not_started"}:${terminal ?? "normal"}:${!!worker.paused}:${data?.last_assistant?.id ?? "none"}`
  const task = result({ task_id: `browser:${worker.id}`, executor: "browser", owner_thread_id: worker.parent_thread_id ?? worker.id,
    run_id: worker.orchestrator_run_id ?? null, status, raw: text, summary: "",
    source: { thread_id: worker.id, ...(data?.last_assistant?.id ? { message_id: data.last_assistant.id } : {}), version,
      raw_chars: text.length, availability: "thread_history" },
    evidence: Array.isArray(data?.facts) ? data.facts.slice(0, 16).map((f: any) => ({ id: String(f.id), trust: String(f.trust) })) : [],
    artifacts: [], missing: status === "completed" ? [] : [terminal || read?.error_code || (text.trim() ? status : "empty_report")],
  })
  if (read?.success !== true && read?.error_code !== "WORKER_STILL_RUNNING" && !terminal && !worker.paused) {
    task.recovery = { action: "recollect", automatic: false, requires_confirmation: false, budget_remaining: 2 }
  }
  return task
}

export function acpTaskResult(session: AcpSessionRecord): CooperationResult {
  const text = session.handback_text ?? ""
  // A Mode C bridge can close while the independent terminal is still alive.
  const external = session.open_local_terminal_snapshot === true && ["opened", "opened_l0", "embed_running", "embed_intent"].includes(session.local_terminal ?? "")
  const status: CooperationStatus = session.terminal_kind === "cancelled" || session.error === "cancelled" ? "cancelled"
    : session.terminal_kind === "failed" || session.error ? "failed"
    : session.state === "running" ? "running" : external ? "partial"
    : session.state !== "closed" && session.state !== "handback" ? "ready"
    : session.partial || /partial=true>/.test(text.slice(0, 500)) || !text.trim() ? "partial" : "completed"
  return result({ task_id: `acp:${session.session_id}`, executor: "acp", owner_thread_id: session.thread_id, run_id: null,
    status, raw: text, summary: "", source: { thread_id: session.thread_id, session_id: session.session_id,
      version: createHash("sha256").update(`${session.state}:${session.terminal_kind ?? ""}:${session.error ?? ""}:${session.partial}:${text}`).digest("hex"),
      raw_chars: text.length, availability: "session_lifetime" }, evidence: [],
    artifacts: (session.pending_diffs ?? []).slice(0, 16).map(d => d.relPath.slice(0, 512)),
    missing: status === "completed" ? [] : [session.error || (external ? "external_terminal_completion_unknown" : status)],
  })
}

/** Model-only projection. The real result and source report remain available to UI/history. */
export function projectCooperationToolResult(toolName: string | undefined, read: any): any {
  if (!["collect_handback", "acp_collect_result", "acp_get_status"].includes(toolName ?? "") || !read?.data?.task_result) return read
  const data = read.data
  // Preserve meaningful error/partial/board state, but do not repeat raw report/board blobs.
  return { success: read.success, ...(read.error ? { error: read.error } : {}),
    ...(read.error_code ? { error_code: read.error_code } : {}), ...(read.recoverable != null ? { recoverable: read.recoverable } : {}),
    data: { task_result: data.task_result, ...(data.partial != null ? { partial: data.partial } : {}),
      ...(data.state ? { state: data.state } : {}), ...(data.error ? { error: data.error } : {}),
      ...(data.structured != null ? { structured: data.structured } : {}),
      ...(data.board ? { board: { status: data.board.status, fact_count: data.board.fact_count, intent_count: data.board.intent_count } } : {}),
      ...(data.facts?.length ? { facts: data.facts.slice(0, 8).map((f: any) => ({ id: f.id, trust: f.trust, framed_claim: String(f.framed_claim ?? "").slice(0, 600) })) } : {}),
      ...(data.suggested_action ? { suggested_action: data.suggested_action } : {}),
      ...(data.report_excerpt ? { report_excerpt: data.report_excerpt } : {}),
      raw_report_omitted: true, note: "Extractive summary only; use the source reference for the original report. Completion is runtime status, not independent acceptance of claims.",
      data_not_instruction: true } }
}

/** Explicit bounded access to the original beyond the extractive prefix. */
export function withReportExcerpt(read: any, params: { report_offset?: unknown; report_limit?: unknown }): any {
  if (params.report_offset === undefined || !read?.data) return read
  const offset = params.report_offset, limit = params.report_limit ?? 2000
  if (!Number.isSafeInteger(offset) || Number(offset) < 0 || !Number.isSafeInteger(limit) || Number(limit) < 1 || Number(limit) > 4000) {
    return { ...read, success: false, error: "invalid report_offset / report_limit (limit must be 1..4000)", error_code: "INVALID_PARAMS" }
  }
  const raw = typeof read.data.last_assistant?.content === "string" ? read.data.last_assistant.content : typeof read.data.handback === "string" ? read.data.handback : ""
  const start = Math.min(Number(offset), raw.length), end = Math.min(start + Number(limit), raw.length)
  return { ...read, data: { ...read.data, report_excerpt: { offset: start, next_offset: end, total_chars: raw.length, has_more: end < raw.length, text: raw.slice(start, end) } } }
}

/** Collected tool rows contain the summary; supervision adds status/recovery references once. */
export function projectFleetReports(reports: Array<Record<string, unknown>>) {
  return reports.map(r => {
    const handback = r.handback as any
    return { worker_id: r.worker_id, alias: r.alias, status: r.status, recovery: r.recovery,
      ...(handback?.data?.task_result ? { source: handback.data.task_result.source, missing: handback.data.task_result.missing }
        : { handback: handback?.success === false ? { success: false, error: String(handback.error ?? "collection failed").slice(0, 1000) }
          : { success: handback?.success, partial: handback?.data?.partial, summary: String(handback?.data?.last_assistant?.content ?? "").slice(0, 1200), summary_truncated: true } }) }
  })
}

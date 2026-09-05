// #327 plan_readonly — thread-scoped execution cap (Codex-style plan mode).
//
// While a thread's execution_policy === "plan_readonly", the tool pregate HARD
// rejects every tool that is not explicitly listed in PLAN_READONLY_ALLOWED_TOOLS
// below. Deny is the default: a new tool that lands without being classified is
// denied in plan mode (fail-closed). The side-effect set is therefore derived,
// never hand-copied — the companion differential test pins that
// L2_GATE_TOOLS ∪ ACP family ∪ host surface ∪ mcp__* are all denied, and the
// extension-side test pins SURFACE_BY_TOOL's L2 column against this allowlist.
//
// Discipline (issue #327 / FINAL-SYNTHESIS 票 6 + §1):
// - plan only tightens: it never widens a surface, never skips L2 / confirm
//   algebra, and is not a permission exemption of any kind
// - orthogonal to run_progress_propose: proposing a plan card does not exempt
//   tools; plan mode does not require a propose to start
// - 巡航三 bool config SoT 不动 — this is a per-thread field, not a new config key

/** Thread execution cap. "default" = no cap (existing behavior). */
export type ExecutionPolicy = "default" | "plan_readonly"

export const EXECUTION_POLICIES: readonly ExecutionPolicy[] = [
  "default",
  "plan_readonly",
]

/**
 * The ONLY tools allowed while a thread is in plan_readonly.
 * Every entry must be pure observation (no DOM events, no navigation, no
 * writes, no host surface, no outbound fetch, no server round-trip).
 * Any tool NOT here is denied — including every mcp__<server>__<tool> name.
 */
export const PLAN_READONLY_ALLOWED_TOOLS: ReadonlySet<string> = new Set([
  // --- browser/tab observation (no page interaction, no navigation) ---
  "list_tabs",
  "screenshot",
  "get_page_text",
  "get_page_html",
  "get_element_info",
  "wait_for",
  // --- local browser-state reads (no page JS involved) ---
  "get_cookies",
  "list_all_cookies",
  "downloads_find",
  // --- memory / workspace reads ---
  "thread_recall",
  "workspace_list_dir",
  "workspace_read_file",
  // --- orchestration run-state reads ---
  "board_read",
  "list_workers",
  "get_worker_status",
  "list_tab_locks",
  "wait_workers",
  // --- display-only plan card; orthogonal to the cap (propose ≠ exemption) ---
  "run_progress_propose",
  // --- MCP local cache listing (no server round-trip) ---
  "mcp_list_resources",
])

/** Plan-safe ⇔ explicitly allowlisted. mcp__* never matches → default-deny. */
export function isPlanReadonlyAllowed(toolName: string): boolean {
  return PLAN_READONLY_ALLOWED_TOOLS.has(toolName)
}

/**
 * Explicit rulings for tools whose read-only status is not obvious (#327 票面
 * requires the ruling, not just the classification):
 *
 * analyze_image → DENIED. Its IMAGE_FETCH phase performs an outbound URL fetch
 *   (tool/image-fetch-admission.ts two-phase dispatch); plan mode's「只看不碰」
 *   does not include companion/extension-side fetching. Reading page pixels
 *   stays available via screenshot. analyze_image_fetch is already internal-only.
 *
 * MCP tools → ALL denied (mcp__<server>__<tool> and the server round-trip meta
 *   tools mcp_read_resource / mcp_get_prompt). The MCP client does not capture
 *   annotations.readOnlyHint today, so no trustworthy read-only marker exists —
 *   默认全拒 stands until a marker is plumbled through. mcp_list_resources
 *   reads only the local cache, which is why it alone is allowlisted.
 *
 * ask_user → DENIED. L2_GATE_TOOLS must stay a closed deny set in plan mode
 *   (differential test asserts deny ⊇ L2 表). Under plan the assistant asks
 *   questions as plain chat text; the structured HITL channel is unnecessary.
 *
 * scroll / scroll_to / hover / press_key → DENIED. They fire DOM events
 *   (scroll handlers, infinite-load fetches, hover JS) — that is page
 *   interaction, not observation, even though nothing is "written".
 *
 * use_skill → DENIED: a skill may wrap any tool flow, so it is not read-only
 *   by construction. ensure_project_dir / record_experience / board_claim /
 *   board_heartbeat / worker_cancel / collect_handback mutate durable state.
 */

export function isExecutionPolicy(v: unknown): v is ExecutionPolicy {
  return v === "default" || v === "plan_readonly"
}

/**
 * Effective cap for a thread. Workers are never wider than their master:
 * - a worker stamped at spawn inherits the parent's policy (spawn.ts)
 * - a worker WITHOUT its own stamp falls back to its parent orchestrator's
 *   CURRENT policy, so arming plan mid-run also caps already-spawned workers
 * - a worker stamped plan stays plan even if the master exits (只收紧方向)
 */
export function resolveEffectiveExecutionPolicy(
  threadId: string | undefined,
  get: (id: string) =>
    | {
        execution_policy?: ExecutionPolicy | null
        parent_thread_id?: string | null
        agent_role?: string | null
      }
    | undefined
    | null,
): ExecutionPolicy {
  const th = threadId ? get(threadId) : null
  if (!th) return "default"
  if (th.execution_policy) return th.execution_policy
  if (th.parent_thread_id && th.agent_role === "worker") {
    const parent = get(th.parent_thread_id)
    if (parent?.execution_policy === "plan_readonly") return "plan_readonly"
  }
  return "default"
}

/** Hard-denial tool result for the pregate (fail-closed path returns the same shape). */
export function planReadonlyBlockedResult(
  toolName: string,
  threadId: string,
): {
  success: false
  error: string
  data: {
    error_code: "PLAN_READONLY_BLOCKED"
    error_level: "recoverable"
    tool_name: string
    thread_id: string
    suggested_action: "exit_plan_mode"
    user_hint_zh: string
  }
} {
  return {
    success: false,
    error: `PLAN_READONLY: 本线程处于计划模式（plan_readonly），只读观察工具可用，其余工具一律硬拒绝：${toolName}。需要执行时由用户关闭计划模式（user_gesture）。`,
    data: {
      error_code: "PLAN_READONLY_BLOCKED",
      error_level: "recoverable",
      tool_name: toolName,
      thread_id: threadId,
      suggested_action: "exit_plan_mode",
      user_hint_zh: "本线程在计划模式中，只读可用；执行类操作需用户关闭计划模式。",
    },
  }
}

// Multi-agent P0 caps and hard denylists — ADR-015 §3.5 / §2

export const ORCHESTRATOR_CAPS = {
  max_workers_per_orchestrator_run: 5,
  max_concurrent_multi_agent_llm_loops: 5,
  max_tabs_leased_per_worker: 2,
  max_tabs_leased_process: 10,
  idle_ttl_ms: 120_000,
  hard_max_lease_ms: 600_000,
  max_active_l2_per_run: 1,
  max_active_l2_process: 2,
  /** Worker/orchestrator create_tab hold. Single-agent auto-hold does not use this. */
  create_tab_auto_hold_ms: 60_000,
} as const

/** Tools workers must not get by default (evaluate is intentionally allowed under L2). */
export const WORKER_HARD_DENY = new Set([
  "shell_exec",
  "netsec_port_scan",
  "osascript_eval",
  "host_computer",
  "host_write",
  "host_read",
  "host_app",
  "host_cli",
  "acp_list_agents",
  "acp_propose_session",
  "acp_start_session",
  "acp_collect_result",
  "acp_cancel_session",
  "acp_get_status",
  "acp_apply_diff",
  // Control-plane / orchestrator surface — never inherit onto workers (incl. 2nd spawn)
  "spawn_worker",
  "propose_expert_team",
  "spawn_expert_team",
  "wait_workers",
  "list_workers",
  "get_worker_status",
  "worker_cancel",
  "collect_handback",
  "board_read",
  "board_complete",
  "board_claim_intent",
  "board_heartbeat_intent",
  "ask_user",
  "list_tab_locks",
  "run_progress_propose",
  // #513: advisory propose is orchestrator-surface too — a pack roleAllow must
  // never offer it to workers (executor would just WORKER_DENIED anyway).
  "fleet_suggest_propose",
])

/** Default narrow surface for orchestrator threads. */
export const ORCHESTRATOR_TOOL_ALLOWLIST = [
  "spawn_worker",
  "propose_expert_team",
  "spawn_expert_team",
  "wait_workers",
  "collect_handback",
  "board_read",
  "board_complete",
  "board_claim_intent",
  "board_heartbeat_intent",
  "ask_user",
  "list_workers",
  "get_worker_status",
  "list_tab_locks",
  "list_tabs", // read-only fleet awareness
] as const

/**
 * Tab-targeted tools. Membership is the identity gate (explicit tabId, pinned
 * exemption, run-progress, outbound dual-entry). Acquire is NOT this set —
 * only TAB_MUTATION_LEASE_TOOLS take a per-call exclusive lease.
 */
export const TAB_LEASE_TOOLS = new Set([
  "navigate",
  "set_tab_url",
  "close_tab",
  "screenshot",
  "analyze_image",
  "get_page_text",
  "get_page_html",
  "get_element_info",
  "click",
  "dblclick",
  "type",
  "fill_form",
  "scroll",
  "press_key",
  "hover",
  "select_option",
  "drag_and_drop",
  "wait_for",
  "evaluate",
  "browser_download",
])

/**
 * Calls that acquire a per-call exclusive lease. Reads stay in TAB_LEASE_TOOLS
 * for the identity gate but do not acquire and are not rejected for HARD_HELD.
 * get_element_info stays here (locator side effects). evaluate always mutates.
 */
export const TAB_MUTATION_LEASE_TOOLS = new Set([
  "navigate",
  "set_tab_url",
  "close_tab",
  "screenshot",
  "analyze_image",
  "get_element_info",
  "click",
  "dblclick",
  "type",
  "fill_form",
  "scroll",
  "press_key",
  "hover",
  "select_option",
  "drag_and_drop",
  "evaluate",
  "browser_download",
])

/** Tools that need L2 and interact with a tab (SOFT_RESERVED path). */
export const TAB_L2_TOOLS = new Set(["evaluate"])

export type AgentRole = "normal" | "orchestrator" | "worker"

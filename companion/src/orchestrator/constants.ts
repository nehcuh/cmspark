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
  create_tab_auto_hold_ms: 120_000,
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
])

/** Default narrow surface for orchestrator threads. */
export const ORCHESTRATOR_TOOL_ALLOWLIST = [
  "spawn_worker",
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

/** Tab-targeted tools that require exclusive lease (read + write). */
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

/** Tools that need L2 and interact with a tab (SOFT_RESERVED path). */
export const TAB_L2_TOOLS = new Set(["evaluate"])

export type AgentRole = "normal" | "orchestrator" | "worker"

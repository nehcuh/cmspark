/**
 * P2: single SoT for tools executed on Companion (not forwarded to extension CDP).
 * server.ts createToolExecutor branches on this set; tests lockstep vs catalog.
 */
export const COMPANION_TOOLS = [
  "osascript_eval",
  "host_read",
  "host_write",
  "host_app",
  "host_cli",
  "host_computer",
  "use_skill",
  "thread_recall",
  "skill_install",
  "record_experience",
  "workspace_list_dir",
  "workspace_read_file",
  "ensure_project_dir",
  "shell_exec",
  "netsec_port_scan",
  // ADR-015 orchestrator
  "spawn_worker",
  "list_workers",
  "get_worker_status",
  "list_tab_locks",
  "collect_handback",
  "board_read",
  "board_complete",
  "board_claim_intent",
  "board_heartbeat_intent",
  "wait_workers",
  "worker_cancel",
  "ask_user",
  // ADR-025 ACP coding handoff (Composition client)
  "acp_list_agents",
  "acp_propose_session",
  "acp_start_session",
  "acp_collect_result",
  "acp_cancel_session",
  "acp_get_status",
] as const

export type CompanionToolName = (typeof COMPANION_TOOLS)[number]

export function isCompanionTool(name: string): boolean {
  return (COMPANION_TOOLS as readonly string[]).includes(name)
}

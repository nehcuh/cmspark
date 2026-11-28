import { ORCHESTRATOR_TOOL_ALLOWLIST } from "../orchestrator/constants"
import type { ThreadManager } from "./thread-manager"

/**
 * Known MCP server-id aliases for tool_whitelist patterns.
 * Real default server id is `filesystem` → tools `mcp__filesystem__*`.
 * Legacy UI/tests often wrote `mcp__fs__*`; match both directions.
 */
export const MCP_SERVER_ID_ALIASES: Readonly<Record<string, readonly string[]>> = {
  filesystem: ["fs"],
  fs: ["filesystem"],
}

/** Server ids that should match a whitelist server segment (self + aliases). */
export function mcpServerIdsForWhitelistMatch(serverId: string): string[] {
  const alts = MCP_SERVER_ID_ALIASES[serverId]
  return alts ? [serverId, ...alts] : [serverId]
}

/**
 * Whether an MCP tool name is allowed by a non-null thread tool_whitelist.
 * Pure helper for unit tests (same rules as ThreadManager.isToolAllowed MCP branch).
 */
export function isMcpToolAllowedByWhitelist(wl: string[], toolName: string): boolean {
  if (wl.includes(toolName)) return true
  if (wl.includes("mcp__*")) return true
  if (
    toolName === "mcp_list_resources" ||
    toolName === "mcp_read_resource" ||
    toolName === "mcp_get_prompt"
  ) {
    // Meta tools: exact name only (unless mcp__* already matched)
    return false
  }
  if (!toolName.startsWith("mcp__")) return false

  const parts = toolName.split("__")
  // mcp__server__tool…  (tool segment may itself contain __)
  if (parts.length < 3) return false
  const serverId = parts[1]!
  const rest = parts.slice(2).join("__")

  for (const sid of mcpServerIdsForWhitelistMatch(serverId)) {
    if (wl.includes(`mcp__${sid}__*`)) return true
    if (wl.includes(`mcp__${sid}__${rest}`)) return true
  }
  return false
}

/** Orchestrator control tools are not the capability surface inherited by workers. */
export function workerParentCapabilityWhitelist(parent: {
  agent_role?: string | null
  tool_whitelist?: string[] | null
} | null | undefined): string[] | null {
  const whitelist = parent?.tool_whitelist
  if (!Array.isArray(whitelist)) return null
  if (parent?.agent_role === "orchestrator") {
    // Older promotions store the control catalog directly on the parent.
    // worker_release was added to that catalog after the original promotion.
    const catalog: readonly string[] = ORCHESTRATOR_TOOL_ALLOWLIST
    const controls = catalog.filter(tool => tool !== "worker_release")
    const tools = whitelist.filter(tool => tool !== "worker_release")
    if (tools.length === controls.length && controls.every(tool => tools.includes(tool))) return null
  }
  return [...whitelist]
}

/** Match the same MCP exact/server/global patterns accepted at dispatch. */
export function workerWhitelistAllows(whitelist: string[], tool: string): boolean {
  return tool.startsWith("mcp__") ? isMcpToolAllowedByWhitelist(whitelist, tool) : whitelist.includes(tool)
}

type Thread = NonNullable<ReturnType<ThreadManager["get"]>>

export function liveWorkerParent(tm: ThreadManager, worker: Thread): Thread | undefined {
  const parent = worker.parent_thread_id ? tm.get(worker.parent_thread_id) : undefined
  return parent && parent.agent_role !== "worker" && !parent.trashed_at && !parent.archived_at &&
    worker.orchestrator_run_id && parent.orchestrator_run_id === worker.orchestrator_run_id ? parent : undefined
}

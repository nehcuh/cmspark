/**
 * MCP family WS handlers — residual god-file extract from message-router.
 * Zero behavior change. Helpers (stdio L2 gate, redaction) live here so
 * lifecycle can import redactMcpServersForBroadcast without the router god-file.
 */
import { URL } from "url"
import { getConfig, replaceMcpServers, setMcpEnabled } from "../../config"
import { getMcpManager } from "../../mcp"
import type { McpServerConfig, McpServerMeta } from "../../mcp/types"
import { hasPrototypePollutionKey } from "./config"
import type {
  SecurityConfirmationDecision,
  SecurityConfirmationDetails,
} from "../../security-confirmation"

export type McpSession = {
  requestConfirmation?: (
    details: SecurityConfirmationDetails,
  ) => Promise<SecurityConfirmationDecision>
  broadcast?: (data: any) => void
}

const MCP_VALID_TRUST_LEVELS = new Set(["manual", "first-use", "trusted"])
const MCP_VALID_TRANSPORTS = new Set(["stdio", "http"])
const MCP_NAME_PATTERN = /^[a-zA-Z0-9_-]+$/

/**
 * SEC-B: authenticated mcp.add/update stdio must not spawn without L2.
 * Fail closed when no origin-bound confirmation channel (tests without session
 * cannot silently register spawners).
 */
async function requireMcpStdioSpawnConfirm(
  session: McpSession | undefined,
  name: string,
  cfg: McpServerConfig,
  action: "add" | "update",
): Promise<{ type: "error"; error: string } | null> {
  if (cfg.transport !== "stdio") return null
  if (!session?.requestConfirmation) {
    return {
      type: "error",
      error:
        "MCP stdio server requires interactive L2 confirmation (requestConfirmation channel missing)",
    }
  }
  const cmd = typeof cfg.command === "string" ? cfg.command : ""
  const args = Array.isArray(cfg.args) ? cfg.args.map(String).join(" ") : ""
  const cwd = typeof cfg.cwd === "string" ? cfg.cwd : "(default)"
  const decision = await session.requestConfirmation({
    toolName: `mcp.${action}_stdio`,
    dangerousApis: ["child_process.spawn", "mcp.stdio"],
    code: [
      `MCP ${action} stdio server "${name}"`,
      `command: ${cmd}`,
      `args: ${args}`,
      `cwd: ${cwd}`,
      `enabled: ${cfg.enabled !== false}`,
    ].join("\n"),
    riskLevel: "high",
    autoConfirmEligible: false,
    criticalApis: ["mcp.stdio.spawn"],
  })
  if (!decision.approved) {
    return {
      type: "error",
      error: `MCP stdio server ${action} denied (${decision.reason})`,
    }
  }
  return null
}

/** True when update changes the spawn surface (not mere trust_level / display). */
function mcpStdioSpawnSurfaceChanged(
  existing: McpServerConfig,
  merged: McpServerConfig,
): boolean {
  if (merged.transport === "stdio" && existing.transport !== "stdio") return true
  if (merged.transport !== "stdio") return false
  // Pi REJECT #1: enabling a disabled stdio server spawns the process
  const wasEnabled = existing.enabled !== false
  const willEnable = merged.enabled !== false
  if (!wasEnabled && willEnable) return true
  // Narrow after transport check — union members differ by transport.
  const ex = existing as Extract<McpServerConfig, { transport: "stdio" }> | McpServerConfig
  const mg = merged as Extract<McpServerConfig, { transport: "stdio" }>
  const exCmd = "command" in ex ? ex.command : undefined
  const mgCmd = mg.command
  if (exCmd !== mgCmd) return true
  const exArgs = "args" in ex ? ex.args : undefined
  const mgArgs = mg.args
  if (JSON.stringify(exArgs || []) !== JSON.stringify(mgArgs || [])) return true
  const exCwd = "cwd" in ex ? ex.cwd : undefined
  const mgCwd = mg.cwd
  if ((exCwd || "") !== (mgCwd || "")) return true
  const exEnv = "env" in ex ? ex.env : undefined
  const mgEnv = mg.env
  if (JSON.stringify(exEnv || {}) !== JSON.stringify(mgEnv || {})) return true
  return false
}

/** Restore env/headers when client echoes redacted `***` placeholders (list→edit→save). */
function restoreMaskedRecord(
  existing: Record<string, string> | undefined,
  incoming: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (incoming === undefined) return existing
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(incoming)) {
    if (v === "***" && existing && typeof existing[k] === "string") {
      out[k] = existing[k]
    } else if (v !== "***") {
      out[k] = v
    }
    // v === "***" with no existing key → drop (never persist mask literal)
  }
  return out
}

function mergeMcpServerPreservingSecrets(
  existing: McpServerConfig,
  patch: Partial<McpServerConfig>,
): McpServerConfig {
  const merged = { ...existing, ...patch } as any
  const exAny = existing as any
  if (patch && typeof (patch as any).env === "object") {
    merged.env = restoreMaskedRecord(exAny.env, (patch as any).env)
  }
  if (patch && typeof (patch as any).headers === "object") {
    merged.headers = restoreMaskedRecord(exAny.headers, (patch as any).headers)
  }
  return merged as McpServerConfig
}

/** Mask env/headers on MCP metas for WS list/update broadcasts. */
export function redactMcpServersForBroadcast(
  servers: McpServerMeta[] | Array<Record<string, any>>,
): any[] {
  return (servers || []).map((s) => {
    const copy: any = { ...s }
    if (copy.config && typeof copy.config === "object") {
      const cfg = { ...copy.config }
      if (cfg.env && typeof cfg.env === "object") {
        const env: Record<string, string> = {}
        for (const k of Object.keys(cfg.env)) env[k] = "***"
        cfg.env = env
      }
      if (cfg.headers && typeof cfg.headers === "object") {
        const headers: Record<string, string> = {}
        for (const k of Object.keys(cfg.headers)) headers[k] = "***"
        cfg.headers = headers
      }
      copy.config = cfg
    }
    return copy
  })
}

/** Returns an error string if invalid, or null if OK. */
function validateMcpServerConfig(name: string, cfg: McpServerConfig | undefined): string | null {
  if (!name) return "MCP server name is required"
  if (!MCP_NAME_PATTERN.test(name)) {
    return `Invalid MCP server name "${name}": only letters, digits, underscore, and hyphen allowed`
  }
  if (!cfg) return "MCP server config is required"
  if (hasPrototypePollutionKey(cfg)) return "Invalid MCP server config keys"
  if (!MCP_VALID_TRANSPORTS.has(cfg.transport)) {
    return `Invalid MCP transport "${cfg.transport}" (must be stdio or http)`
  }
  if (cfg.transport === "stdio") {
    if (!cfg.command || typeof cfg.command !== "string") {
      return `MCP stdio server "${name}" requires a command`
    }
    if (cfg.args !== undefined && !Array.isArray(cfg.args)) return `args must be an array`
    if (cfg.env !== undefined && (typeof cfg.env !== "object" || Array.isArray(cfg.env))) {
      return `env must be an object`
    }
    if (cfg.cwd !== undefined && typeof cfg.cwd !== "string") return `cwd must be a string`
  } else {
    if (!cfg.url || typeof cfg.url !== "string") {
      return `MCP http server "${name}" requires a url`
    }
    try {
      new URL(cfg.url)
    } catch {
      return `MCP http server "${name}" has invalid url: ${cfg.url}`
    }
    if (cfg.headers !== undefined && (typeof cfg.headers !== "object" || Array.isArray(cfg.headers))) {
      return `headers must be an object`
    }
  }
  if (!MCP_VALID_TRUST_LEVELS.has(cfg.trust_level)) {
    return `Invalid trust_level "${cfg.trust_level}" (must be manual, first-use, or trusted)`
  }
  if (cfg.roots !== undefined) {
    if (!Array.isArray(cfg.roots)) return `roots must be an array`
    for (const root of cfg.roots) {
      if (!root || typeof root !== "object" || Array.isArray(root)) {
        return `each root must be an object with a uri string`
      }
      if (typeof root.uri !== "string" || !root.uri) {
        return `each root must have a non-empty uri string`
      }
      if (root.name !== undefined && typeof root.name !== "string") {
        return `root name must be a string`
      }
    }
  }
  return null
}



/**
 * Handle mcp.* messages. Returns null if type is not in this family.
 * threadManager is required for mcp.set_selection only.
 */
export async function handleMcpFamily(
  type: string,
  rest: any,
  session: McpSession | undefined,
  threadManager: { get: (id: string) => any; update: (id: string, patch: any) => any },
): Promise<any | null> {
  switch (type) {
    case "mcp.list": {

      // SEC: never ship env/headers secrets on the wire (config.updated already redacts)

      return { type: "mcp.list", servers: redactMcpServersForBroadcast(getMcpManager().listServers()) }

    }

    case "mcp.toggle_enabled": {

      const enabled = !!rest.enabled

      setMcpEnabled(enabled)

      // applyConfig is fired via configEvents listener in server.ts

      return { type: "mcp.list", servers: redactMcpServersForBroadcast(getMcpManager().listServers()) }

    }

    case "mcp.add": {

      const name = String(rest.name || "").trim()

      const serverCfg = rest.server as McpServerConfig

      const validation = validateMcpServerConfig(name, serverCfg)

      if (validation) return { type: "error", error: validation }

      const config = getConfig()

      if (config.mcp?.servers?.[name]) {

        return { type: "error", error: `MCP server "${name}" already exists. Use mcp.update to modify.` }

      }

      // SEC-B: stdio = arbitrary local spawn; require origin-bound L2 (force high)

      // before replaceMcpServers → applyConfig → StdioClientTransport.

      const stdioGate = await requireMcpStdioSpawnConfirm(session, name, serverCfg, "add")

      if (stdioGate) return stdioGate

      const wasEmpty = Object.keys(config.mcp?.servers || {}).length === 0

      const newServers = { ...(config.mcp?.servers || {}), [name]: serverCfg }

      replaceMcpServers(newServers)

      // Auto-enable the global kill-switch when the user adds their first server

      // after clearing all servers (or on older configs that still had mcp.enabled=false).

      // Without this, a user-disabled kill-switch leaves the new server disconnected

      // with no UI surface to recover (see mcp.toggle_enabled UI gap).

      if (wasEmpty && !config.mcp?.enabled) {

        setMcpEnabled(true)

      }

      return {

        type: "mcp.servers.updated",

        servers: redactMcpServersForBroadcast(getMcpManager().listServers()),

      }

    }

    case "mcp.update": {

      const name = String(rest.name || "").trim()

      const patch = rest.patch as Partial<McpServerConfig>

      const config = getConfig()

      const existing = config.mcp?.servers?.[name]

      if (!existing) return { type: "error", error: `MCP server "${name}" not found` }

      if (hasPrototypePollutionKey(patch)) {

        return { type: "error", error: "Invalid config keys detected" }

      }

      // Pi REJECT #2: UI re-sends "***" for redacted env/headers — restore disk secrets

      const merged = mergeMcpServerPreservingSecrets(existing, patch)

      // Re-validate after merge

      const validation = validateMcpServerConfig(name, merged)

      if (validation) return { type: "error", error: validation }

      // SEC-B: re-confirm when stdio spawn surface changes (incl. enable false→true)

      if (mcpStdioSpawnSurfaceChanged(existing, merged)) {

        const stdioGate = await requireMcpStdioSpawnConfirm(session, name, merged, "update")

        if (stdioGate) return stdioGate

      }

      const newServers = { ...(config.mcp?.servers || {}), [name]: merged }

      replaceMcpServers(newServers)

      return {

        type: "mcp.servers.updated",

        servers: redactMcpServersForBroadcast(getMcpManager().listServers()),

      }

    }

    case "mcp.delete": {

      const name = String(rest.name || "").trim()

      const config = getConfig()

      if (!config.mcp?.servers?.[name]) {

        return { type: "error", error: `MCP server "${name}" not found` }

      }

      const newServers = { ...config.mcp.servers }

      delete newServers[name]

      replaceMcpServers(newServers)

      return {

        type: "mcp.servers.updated",

        servers: redactMcpServersForBroadcast(getMcpManager().listServers()),

      }

    }

    case "mcp.toggle_server": {

      const name = String(rest.name || "").trim()

      const enabled = !!rest.enabled

      const config = getConfig()

      const existing = config.mcp?.servers?.[name]

      if (!existing) return { type: "error", error: `MCP server "${name}" not found` }

      const newServers = { ...(config.mcp?.servers || {}), [name]: { ...existing, enabled } }

      // Enabling a previously disabled stdio server spawns the process — same trust as add.

      if (enabled && existing.enabled === false && existing.transport === "stdio") {

        const stdioGate = await requireMcpStdioSpawnConfirm(

          session,

          name,

          { ...existing, enabled: true },

          "update",

        )

        if (stdioGate) return stdioGate

      }

      replaceMcpServers(newServers)

      return {

        type: "mcp.servers.updated",

        servers: redactMcpServersForBroadcast(getMcpManager().listServers()),

      }

    }

    case "mcp.set_selection": {

      // Per-thread MCP tool selection mode + active server ids (mirrors skill activation).

      // Persisted via thread.update — handled here as a convenience pass-through.

      const thread = threadManager.get(rest.thread_id)

      if (thread) {

        const patch: any = {}

        if (rest.mcp_selection_mode) patch.mcp_selection_mode = rest.mcp_selection_mode

        if (Array.isArray(rest.active_mcp_server_ids)) patch.active_mcp_server_ids = rest.active_mcp_server_ids

        threadManager.update(rest.thread_id, patch)

      }

      return { type: "mcp.selection_updated", thread_id: rest.thread_id }

    }



        default:
      return null
  }
}

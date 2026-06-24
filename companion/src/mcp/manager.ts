// McpManager — orchestrates all MCP server clients. Singleton.
//
// Responsibilities:
// - Start/stop clients based on McpConfig (with diff-aware hot reload)
// - Exponential backoff restart on client disconnect (5-min sliding window cap)
// - Aggregate tools across clients into ToolDefinition[] for the LLM adapter
// - Route namespaced tool calls (mcp__<server>__<tool>) to the right client
// - Broadcast server metadata changes to UI subscribers (WS layer registers via onUpdated)
// - Graceful shutdown (SIGTERM → SIGKILL per client)

import { EventEmitter } from "events"
import { logger } from "../logger.js"
import type { ToolDefinition } from "../bridge/tool-definitions.js"
import { McpClient } from "./client.js"
import { aggregateMcpTools, type AggregatedTools } from "./aggregator.js"
import {
  DEFAULT_RESTART_POLICY,
  resolveRestartPolicy,
  requiresRestart,
  type McpConfig,
  type McpServerConfig,
  type McpServerMeta,
  type McpToolRoute,
} from "./types.js"

const SLIDING_WINDOW_MS = 5 * 60 * 1000
const RESTART_BACKOFF_EXTRA_JITTER_MS = 200

export type McpManagerEvent =
  | "servers_updated"   // (metas: McpServerMeta[])
  | "status_changed"    // (meta: McpServerMeta)
  | "tools_changed"     // (aggregated: AggregatedTools)

export class McpManager extends EventEmitter {
  private clients = new Map<string, McpClient>()
  private aggregated: AggregatedTools = { definitions: [], aliases: new Map(), metas: new Map() }
  private currentConfig: McpConfig | null = null
  private restartAttempts = new Map<string, number[]>() // name → timestamps of recent restart attempts
  private deadServers = new Set<string>()
  private restartTimers = new Map<string, NodeJS.Timeout>()
  private startingPromises = new Map<string, Promise<void>>()
  private shuttingDown = false

  constructor() {
    super()
    this.setMaxListeners(50)
  }

  // --- lifecycle ---

  async start(config: McpConfig | undefined): Promise<void> {
    this.currentConfig = sanitizeMcpConfig(config)
    if (!this.currentConfig.enabled) {
      logger.info("mcp.manager.disabled", {})
      return
    }
    logger.info("mcp.manager.start", { servers: Object.keys(this.currentConfig.servers) })
    // Start all enabled servers in parallel; do not fail the whole startup on one bad server
    await Promise.allSettled(
      Object.entries(this.currentConfig.servers).map(([name, cfg]) => {
        if (cfg.enabled) return this.startClient(name, cfg).catch(() => {})
      }),
    )
    this.reaggregate()
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true
    for (const [name, timer] of this.restartTimers) {
      clearTimeout(timer)
      this.restartTimers.delete(name)
    }
    await Promise.allSettled(
      Array.from(this.clients.keys()).map((name) => this.stopClient(name)),
    )
    this.clients.clear()
    this.reaggregate()
    this.emit("servers_updated", this.listServers())
  }

  // --- config hot reload (diff-aware) ---

  async applyConfig(next: McpConfig | undefined): Promise<void> {
    const prev = this.currentConfig
    this.currentConfig = sanitizeMcpConfig(next)

    if (!this.currentConfig.enabled) {
      // Kill everything
      for (const name of Array.from(this.clients.keys())) {
        await this.stopClient(name)
      }
      this.reaggregate()
      this.emit("servers_updated", this.listServers())
      return
    }

    const prevServers = prev?.servers ?? {}
    const nextServers = this.currentConfig.servers

    // Removed
    for (const name of Object.keys(prevServers)) {
      if (!(name in nextServers)) {
        await this.stopClient(name)
      }
    }

    // Added or changed
    for (const [name, cfg] of Object.entries(nextServers)) {
      const prevCfg = prevServers[name]
      if (!prevCfg) {
        if (cfg.enabled) this.startClient(name, cfg).catch(() => {})
        continue
      }
      if (requiresRestart(prevCfg, cfg)) {
        await this.stopClient(name)
        this.deadServers.delete(name)
        if (cfg.enabled) this.startClient(name, cfg).catch(() => {})
      } else {
        // Soft update: only trust_level / timeouts / restart_policy changed
        const client = this.clients.get(name)
        if (client) {
          client.updateConfig(cfg)
          this.emit("status_changed", client.getMeta())
        }
        // enabled toggle without other changes
        if (prevCfg.enabled !== cfg.enabled) {
          if (cfg.enabled) {
            this.deadServers.delete(name)
            this.startClient(name, cfg).catch(() => {})
          } else {
            await this.stopClient(name)
          }
        }
      }
    }

    this.reaggregate()
    this.emit("servers_updated", this.listServers())
  }

  // --- per-client management ---

  async startClient(name: string, cfg: McpServerConfig): Promise<void> {
    if (this.shuttingDown) return
    // Serialize concurrent start attempts
    const existing = this.startingPromises.get(name)
    if (existing) return existing

    const promise = (async () => {
      // If a client already exists (e.g. restart), close it first
      const prior = this.clients.get(name)
      if (prior) {
        await prior.close().catch(() => {})
        this.clients.delete(name)
      }

      const client = new McpClient(name, cfg)
      this.attachClientListeners(client)
      this.clients.set(name, client)
      this.emit("status_changed", client.getMeta())

      try {
        await client.connect()
        // First successful connect resets the restart window
        this.restartAttempts.delete(name)
        this.deadServers.delete(name)
        this.reaggregate()
        this.emit("servers_updated", this.listServers())
      } catch (err: any) {
        const stderrTail = client.stderrTail?.trim()
        logger.error("mcp.client.start_failed", {
          server: name,
          error: err?.message,
          stderr: stderrTail || undefined,
        })
        // Surface error state but keep client in map so getMeta() shows error
        this.emit("status_changed", client.getMeta())
        this.scheduleRestart(name, cfg, err?.message || "start failed")
      }
    })()

    this.startingPromises.set(name, promise)
    try {
      await promise
    } finally {
      this.startingPromises.delete(name)
    }
  }

  async stopClient(name: string): Promise<void> {
    // Clear all per-name state so a re-added server starts fresh (audit item 16).
    // Without this, a name reused after a prior crash-detection would stay in deadServers
    // and scheduleRestart would bail on the first new failure — silent breakage.
    const timer = this.restartTimers.get(name)
    if (timer) {
      clearTimeout(timer)
      this.restartTimers.delete(name)
    }
    this.deadServers.delete(name)
    this.restartAttempts.delete(name)

    const client = this.clients.get(name)
    if (!client) return
    await client.close().catch(() => {})
    this.clients.delete(name)
    this.reaggregate()
    this.emit("status_changed", client.getMeta())
    this.emit("servers_updated", this.listServers())
  }

  private attachClientListeners(client: McpClient): void {
    client.on("status_changed", () => {
      this.emit("status_changed", client.getMeta())
    })
    client.on("tools_changed", () => {
      this.reaggregate()
      this.emit("tools_changed", this.aggregated)
      this.emit("servers_updated", this.listServers())
    })
    client.on("disconnected", (reason) => {
      const name = client.name
      logger.warn("mcp.client.disconnected", { server: name, reason })
      if (this.shuttingDown) return
      if (!client.config.enabled) return
      const cfg = client.config
      this.scheduleRestart(name, cfg, reason)
    })
  }

  private scheduleRestart(name: string, cfg: McpServerConfig, reason: string): void {
    if (this.shuttingDown || !cfg.enabled) return
    if (this.deadServers.has(name)) return

    const policy = resolveRestartPolicy(cfg)
    const now = Date.now()
    const attempts = (this.restartAttempts.get(name) ?? []).filter((t) => now - t < SLIDING_WINDOW_MS)
    attempts.push(now)
    this.restartAttempts.set(name, attempts)

    if (attempts.length > policy.max_restarts) {
      logger.error("mcp.client.dead", { server: name, attempts: attempts.length, window_ms: SLIDING_WINDOW_MS })
      this.deadServers.add(name)
      const client = this.clients.get(name)
      if (client) {
        client.markDead(`Crashed ${attempts.length} times in 5min; giving up. Last reason: ${reason}`)
      }
      return
    }

    const attemptIdx = attempts.length - 1
    const backoff = Math.min(
      policy.backoff_max_ms,
      policy.backoff_base_ms * Math.pow(2, attemptIdx),
    ) + Math.floor(Math.random() * RESTART_BACKOFF_EXTRA_JITTER_MS)

    logger.info("mcp.client.scheduling_restart", {
      server: name,
      attempt: attempts.length,
      backoff_ms: backoff,
      reason,
    })

    const existing = this.restartTimers.get(name)
    if (existing) clearTimeout(existing)
    const timer = setTimeout(() => {
      this.restartTimers.delete(name)
      this.startClient(name, cfg).catch((err) => {
        logger.error("mcp.client.restart_failed", { server: name, error: err?.message })
      })
    }, backoff)
    timer.unref?.()
    this.restartTimers.set(name, timer)
  }

  // --- aggregation ---

  private reaggregate(): void {
    this.aggregated = aggregateMcpTools(this.clients.values())
  }

  getAggregatedTools() {
    return this.aggregated.definitions
  }

  /**
   * Filter the aggregated tool list to only expose tools from the named servers.
   * Used by the per-thread MCP selection mode (audit item 7) — when a thread's
   * mcp_selection_mode is "manual", only tools from active_mcp_server_ids reach
   * the LLM. Tools whose server isn't in the allow-list are dropped, including
   * their aliases (so the LLM can't discover them and the router can't dispatch
   * to them).
   *
   * Returns a fresh array; does not mutate this.aggregated.
   */
  getAggregatedToolsForServers(serverIds: Set<string>): ToolDefinition[] {
    if (serverIds.size === 0) return []
    const out: ToolDefinition[] = []
    for (const def of this.aggregated.definitions) {
      const route = this.aggregated.aliases.get(def.function.name)
      if (route && serverIds.has(route.serverName)) {
        out.push(def)
      }
    }
    return out
  }

  /** Look up (server, originalTool) from a namespaced name. */
  resolveToolName(namespacedName: string): McpToolRoute | undefined {
    return this.aggregated.aliases.get(namespacedName)
  }

  /**
   * Look up the cached MCP inputSchema for a namespaced tool name. Used by
   * tool-schemas.ts to convert JSON Schema → zod and validate args before
   * dispatch (audit item C-MCP-1). Returns undefined when the tool isn't
   * aggregated (server not connected, tool list not yet received, or unknown).
   */
  getToolInputSchema(namespacedName: string): Record<string, any> | undefined {
    return this.aggregated.metas.get(namespacedName)?.inputSchema
  }

  // --- RPC routing ---

  async callTool(
    route: McpToolRoute,
    args: Record<string, any>,
    signal?: AbortSignal,
  ): Promise<any> {
    const client = this.clients.get(route.serverName)
    if (!client) throw new Error(`MCP server ${route.serverName} not found`)
    if (client.connection.status !== "connected") {
      throw new Error(`MCP server ${route.serverName} not connected (status: ${client.connection.status})`)
    }
    return client.callTool(route.toolName, args, signal)
  }

  async listResources(serverName: string): Promise<any> {
    const client = this.clients.get(serverName)
    if (!client) throw new Error(`MCP server ${serverName} not found`)
    return client.listResources()
  }

  async readResource(serverName: string, uri: string): Promise<any> {
    const client = this.clients.get(serverName)
    if (!client) throw new Error(`MCP server ${serverName} not found`)
    return client.readResource(uri)
  }

  async listPrompts(serverName: string): Promise<any> {
    const client = this.clients.get(serverName)
    if (!client) throw new Error(`MCP server ${serverName} not found`)
    return client.listPrompts()
  }

  async getPrompt(serverName: string, name: string, args?: Record<string, any>): Promise<any> {
    const client = this.clients.get(serverName)
    if (!client) throw new Error(`MCP server ${serverName} not found`)
    return client.getPrompt(name, args)
  }

  getTrustLevel(serverName: string): McpServerConfig["trust_level"] | undefined {
    return this.clients.get(serverName)?.trustLevel
  }

  // --- metadata for UI ---

  listServers(): McpServerMeta[] {
    const metas: McpServerMeta[] = []
    const seen = new Set<string>()

    for (const [name, client] of this.clients) {
      metas.push(client.getMeta())
      seen.add(name)
    }

    // Include configured-but-not-yet-started servers (e.g. disabled ones) for UI completeness
    if (this.currentConfig) {
      for (const [name, cfg] of Object.entries(this.currentConfig.servers)) {
        if (seen.has(name)) continue
        metas.push({
          name,
          transport: cfg.transport,
          enabled: cfg.enabled,
          trust_level: cfg.trust_level,
          connection: { status: "disconnected", restart_count: 0 },
          capabilities: { tools: false, resources: false, prompts: false },
          tools: [],
          resources: [],
          prompts: [],
          config: { ...cfg },
        })
      }
    }
    return metas
  }

  getServerConfig(name: string): McpServerConfig | undefined {
    return this.currentConfig?.servers[name]
  }
}

// --- singleton ---

let _manager: McpManager | null = null
export function getMcpManager(): McpManager {
  if (!_manager) _manager = new McpManager()
  return _manager
}

/**
 * Validate and normalize a raw McpConfig from disk or UI. Catches the common mistake
 * of writing a server config directly under `servers` without a name key:
 *
 *   WRONG:  { servers: { transport: "stdio", command: "npx", ... } }
 *   RIGHT:  { servers: { "filesystem": { transport: "stdio", command: "npx", ... } } }
 *
 * Also drops entries whose value isn't a valid McpServerConfig object, logging a warning
 * with the specific reason (missing trust_level, wrong transport, etc.) so the user can
 * see what went wrong instead of having servers silently ignored.
 */
function sanitizeMcpConfig(raw: McpConfig | undefined | null): McpConfig {
  const fallback: McpConfig = { enabled: false, servers: {} }
  if (!raw || typeof raw !== "object") return fallback
  const enabled = !!raw.enabled
  const serversRaw = (raw as any).servers
  if (!serversRaw || typeof serversRaw !== "object" || Array.isArray(serversRaw)) {
    if (enabled) {
      logger.warn("mcp.config.servers_missing", { hint: "mcp.servers must be an object keyed by server name" })
    }
    return { enabled, servers: {} }
  }

  // Detect the "flat server config" mistake: servers has top-level transport/command fields
  // but no real per-server sub-objects. Heuristic: if `servers.transport` or `servers.command`
  // is a string, the user almost certainly flattened the schema.
  if (typeof serversRaw.transport === "string" || typeof serversRaw.command === "string") {
    logger.error("mcp.config.servers_flat_shape", {
      hint: 'mcp.servers must be { "<server-name>": { transport, command, ... } }, not the server config itself. Wrap your config under a name key like "filesystem".',
    })
    return { enabled, servers: {} }
  }

  const servers: Record<string, McpServerConfig> = {}
  for (const [name, value] of Object.entries(serversRaw)) {
    const reason = validateServerConfig(value)
    if (reason) {
      logger.warn("mcp.config.server_invalid", { name, reason })
      continue
    }
    servers[name] = value as McpServerConfig
  }
  return { enabled, servers }
}

function validateServerConfig(value: any): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "expected a server config object"
  }
  if (value.transport !== "stdio" && value.transport !== "http") {
    return `transport must be "stdio" or "http", got "${value.transport}"`
  }
  if (value.enabled !== undefined && typeof value.enabled !== "boolean") {
    return "enabled must be a boolean if provided"
  }
  if (typeof value.trust_level !== "string") {
    return `trust_level is required (manual, first-use, or trusted), got "${value.trust_level}"`
  }
  if (!["manual", "first-use", "trusted"].includes(value.trust_level)) {
    return `trust_level must be manual, first-use, or trusted, got "${value.trust_level}"`
  }
  if (value.transport === "stdio" && typeof value.command !== "string") {
    return "stdio server requires a string command"
  }
  if (value.transport === "http" && typeof value.url !== "string") {
    return "http server requires a string url"
  }
  return null
}

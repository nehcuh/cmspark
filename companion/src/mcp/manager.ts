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
import { isValidDeclaredCapability } from "../security.js"
import type { ToolDefinition } from "../bridge/tool-definitions.js"
import { McpClient } from "./client.js"
import { McpStdioTeardownError } from "./stdio-transport.js"
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
import { ensureFilesystemAllowlist } from "./filesystem-home.js"
import { getMcpConfirmCache } from "./confirm-cache.js"
import { mcpAuthorizationDigest } from "./authorization.js"
import { setTimeout as delay } from "node:timers/promises"
import { resolveStartupTimeout, resolveCallTimeout } from "./types.js"

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
  /** Pending/failed owned close receipts also fence name reuse. */
  private retiringClients = new Map<string, { client: McpClient; promise: Promise<void>; failed: boolean }>()
  private shuttingDown = false
  private generations = new Map<string, number>()
  private configUpdates: Promise<void> = Promise.resolve()
  private appliedConfig: McpConfig | null = null
  private authorizationEpochs = new Map<string, number>()
  private authorizationClients = new WeakMap<McpClient, number>()
  private authorizationCatalogs = new WeakMap<McpClient, string>()
  private nextAuthorizationClient = 0

  constructor() {
    super()
    this.setMaxListeners(50)
  }

  // --- lifecycle ---

  async start(config: McpConfig | undefined): Promise<void> {
    this.currentConfig = sanitizeMcpConfig(config)
    this.appliedConfig = this.currentConfig
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
      [...new Set([...this.clients.keys(), ...this.retiringClients.keys()])].map((name) => this.stopClient(name)),
    )
    // Successful closes remove themselves. Failed receipts must remain owned
    // and visible even after shutdown; clearing the map would orphan them.
    this.reaggregate()
    this.emit("servers_updated", this.listServers())
  }

  // --- config hot reload (diff-aware) ---

  async applyConfig(next: McpConfig | undefined): Promise<void> {
    const previous = this.currentConfig
    const config = sanitizeMcpConfig(next)
    for (const name of new Set([...Object.keys(previous?.servers ?? {}), ...Object.keys(config.servers)])) {
      if (previous?.enabled !== config.enabled ||
          mcpAuthorizationDigest(previous?.servers[name]) !== mcpAuthorizationDigest(config.servers[name])) {
        this.revokeAuthorization(name)
      }
    }
    // Publish revocations immediately; serialize process teardown/replacement.
    this.currentConfig = config
    this.reaggregate()
    const update = this.configUpdates.then(() => this.reconcileConfig(config, previous))
    this.configUpdates = update.catch(() => {})
    return update
  }

  private async reconcileConfig(config: McpConfig, previous: McpConfig | null): Promise<void> {
    if (this.shuttingDown || this.currentConfig !== config) return
    const prev = this.appliedConfig ?? previous
    this.appliedConfig = config
    const teardownErrors: unknown[] = []
    const stop = (name: string) => this.stopClient(name).catch(error => { teardownErrors.push(error) })

    if (!config.enabled) {
      // Kill everything
      const names = new Set([...this.clients.keys(), ...this.retiringClients.keys(), ...this.restartTimers.keys(), ...this.startingPromises.keys()])
      for (const name of names) {
        await stop(name)
      }
      this.reaggregate()
      this.emit("servers_updated", this.listServers())
      if (teardownErrors.length) throw teardownErrors[0]
      return
    }

    const prevServers = prev?.servers ?? {}
    const nextServers = config.servers

    // Removed
    const knownNames = new Set([...Object.keys(prevServers), ...this.clients.keys(), ...this.retiringClients.keys(),
      ...this.restartTimers.keys(), ...this.startingPromises.keys()])
    for (const name of knownNames) {
      if (!(name in nextServers)) {
        await stop(name)
        if (this.currentConfig !== config) return
      }
    }

    // Added or changed
    for (const [name, cfg] of Object.entries(nextServers)) {
      const prevCfg = this.clients.get(name)?.config ?? prevServers[name]
      if (!prevServers[name] || !prevCfg || !prev?.enabled || (!this.clients.has(name) && !this.startingPromises.has(name) &&
          !this.restartTimers.has(name) && !this.deadServers.has(name))) {
        this.deadServers.delete(name)
        if (cfg.enabled) this.startClient(name, cfg).catch(() => {})
        continue
      }
      if (requiresRestart(prevCfg, cfg)) {
        await stop(name)
        if (this.currentConfig !== config) return
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
            await stop(name)
          }
        }
      }
    }

    this.reaggregate()
    this.emit("servers_updated", this.listServers())
    if (teardownErrors.length) throw teardownErrors[0]
  }

  // --- per-client management ---

  async startClient(name: string, cfg: McpServerConfig): Promise<void> {
    const generation = this.generations.get(name) ?? 0
    const permitted = () => !this.shuttingDown && this.currentConfig?.enabled === true &&
      this.currentConfig.servers[name]?.enabled === true &&
      (this.generations.get(name) ?? 0) === generation &&
      !requiresRestart(cfg, this.currentConfig.servers[name])
    if (!permitted()) return
    const retiring = this.retiringClients.get(name)
    if (retiring) {
      await retiring.promise
      if (!permitted()) return
    }
    // Serialize concurrent start attempts
    const existing = this.startingPromises.get(name)
    if (existing) {
      await existing
      if (!permitted()) return
      const current = this.clients.get(name)
      if (this.restartTimers.has(name) || this.deadServers.has(name)) return
      if (current && this.isCurrentClient(current) && current.connection.status !== "disconnected") return
      return this.startClient(name, this.currentConfig!.servers[name])
    }

    const promise = (async () => {
      // If a client already exists (e.g. restart), close it first
      const prior = this.clients.get(name)
      if (prior) {
        await this.retireClient(name, prior)
      }
      if (!permitted()) return

      const client = new McpClient(name, cfg)
      this.attachClientListeners(client)
      this.clients.set(name, client)
      this.emit("status_changed", client.getMeta())

      try {
        await client.connect()
        // #289: if the server was disabled / removed / replaced while the
        // handshake was in flight, this client is a ghost — close it instead
        // of reviving it or leaking a live-but-untracked connection.
        if (this.clients.get(name) !== client || !permitted()) {
          logger.warn("mcp.client.ghost_after_connect", { server: name })
          await this.retireClient(name, client)
          this.reaggregate()
          return
        }
        // A handshake is not evidence of stability. Keep recent crashes until
        // they age out of the sliding window, even after a successful restart.
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
        if (err instanceof McpStdioTeardownError) {
          await this.retireClient(name, client).catch(() => {})
        } else if (this.clients.get(name) === client && permitted()) {
          this.scheduleRestart(name, cfg, err?.message || "start failed")
        }
      }
    })()

    this.startingPromises.set(name, promise)
    try {
      await promise
    } finally {
      if (this.startingPromises.get(name) === promise) this.startingPromises.delete(name)
    }
  }

  async stopClient(name: string): Promise<void> {
    this.generations.set(name, (this.generations.get(name) ?? 0) + 1)
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
    const starting = this.startingPromises.get(name)
    this.revokeAuthorization(name)
    try {
      if (client) await this.retireClient(name, client)
      else await this.retiringClients.get(name)?.promise
    } finally {
      // Drain the old start even on rejected close; preserve its owned receipt.
      await starting?.catch(() => {})
      this.reaggregate()
      if (client) this.emit("status_changed", client.getMeta())
      this.emit("servers_updated", this.listServers())
    }
  }

  private retireClient(name: string, client: McpClient): Promise<void> {
    const existing = this.retiringClients.get(name)
    if (existing) return existing.promise
    const entry = { client, promise: Promise.resolve(), failed: false }
    this.retiringClients.set(name, entry)
    const timer = this.restartTimers.get(name)
    if (timer) { clearTimeout(timer); this.restartTimers.delete(name) }
    this.revokeAuthorization(name)
    this.reaggregate() // Capability revocation precedes asynchronous close.
    entry.promise = Promise.resolve().then(() => client.close()).then(() => {
      if (this.retiringClients.get(name) === entry) this.retiringClients.delete(name)
      if (this.clients.get(name) === client) this.clients.delete(name)
      this.reaggregate()
    }).catch(error => {
      entry.failed = true
      this.reaggregate()
      this.emit("status_changed", client.getMeta())
      this.emit("servers_updated", this.listServers())
      throw error
    })
    return entry.promise
  }

  private attachClientListeners(client: McpClient): void {
    client.on("status_changed", () => {
      if (this.clients.get(client.name) !== client) return
      this.reaggregate()
      this.emit("status_changed", client.getMeta())
      this.emit("tools_changed", this.aggregated)
      this.emit("servers_updated", this.listServers())
    })
    client.on("tools_changed", () => {
      if (this.clients.get(client.name) !== client) return
      this.getAuthorizationIdentity(client.name)
      this.reaggregate()
      this.emit("tools_changed", this.aggregated)
      this.emit("servers_updated", this.listServers())
    })
    client.on("prompts_changed", () => {
      if (this.clients.get(client.name) !== client) return
      this.getAuthorizationIdentity(client.name)
      this.emit("servers_updated", this.listServers())
    })
    client.on("disconnected", (reason) => {
      const name = client.name
      logger.warn("mcp.client.disconnected", { server: name, reason })
      if (this.shuttingDown || this.clients.get(name) !== client) return
      // #289: consult the LIVE config, not client.config (the snapshot captured
      // when this start began) — a server disabled or removed mid-connect must
      // not be revived by the stale closure.
      const live = this.currentConfig?.servers[name]
      if (!live || !live.enabled) return
      this.scheduleRestart(name, live, reason)
    })
  }

  private scheduleRestart(name: string, cfg: McpServerConfig, reason: string): void {
    if (this.shuttingDown || !this.currentConfig?.enabled || this.retiringClients.has(name)) return
    // #289: re-read the live config — `cfg` is the stale snapshot captured when
    // the (failed) start began. A disable/remove during connect must win over
    // the closure, and the restart itself must use the current command/policy.
    const live = this.currentConfig?.servers[name]
    if (!live || !live.enabled) return
    if (this.deadServers.has(name)) return

    const policy = resolveRestartPolicy(live)
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
      // #289: restart with the live config, not the stale startup closure.
      const latest = this.currentConfig?.servers[name]
      if (this.shuttingDown || !this.currentConfig?.enabled || !latest?.enabled) return
      this.startClient(name, latest).catch((err) => {
        logger.error("mcp.client.restart_failed", { server: name, error: err?.message })
      })
    }, backoff)
    timer.unref?.()
    this.restartTimers.set(name, timer)
  }

  // --- aggregation ---

  private reaggregate(): void {
    this.aggregated = aggregateMcpTools([...this.clients.values()].filter(client => this.isCurrentClient(client)))
  }

  private isCurrentClient(client: McpClient): boolean {
    const config = this.currentConfig?.servers[client.name]
    return !this.shuttingDown && !this.retiringClients.has(client.name) && this.currentConfig?.enabled === true && config?.enabled === true &&
      this.clients.get(client.name) === client && !requiresRestart(client.config, config)
  }

  private requireAvailableClient(name: string): McpClient {
    const client = this.clients.get(name)
    if (!client || !this.isCurrentClient(client)) throw new Error(`MCP server ${name} is disabled or unavailable`)
    if (client.connection.status !== "connected") throw new Error(`MCP server ${name} not connected (status: ${client.connection.status})`)
    return client
  }

  private revokeAuthorization(name: string): void {
    this.authorizationEpochs.set(name, (this.authorizationEpochs.get(name) ?? 0) + 1)
    getMcpConfirmCache().clearServer(name)
  }

  /** Bind cached and in-flight approvals to live config, client and contracts.
   * Revocations advance synchronously, including off/on updates whose teardown
   * is superseded. A reconnect also creates a fresh approval identity. */
  getAuthorizationIdentity(name: string): string | undefined {
    const client = this.clients.get(name)
    if (!client || !this.isCurrentClient(client) || client.connection.status !== "connected") return undefined
    let instance = this.authorizationClients.get(client)
    if (instance === undefined) {
      instance = ++this.nextAuthorizationClient
      this.authorizationClients.set(client, instance)
    }
    const catalog = this.getAuthorizationContract(name)!
    const previous = this.authorizationCatalogs.get(client)
    if (previous !== undefined && previous !== catalog) this.revokeAuthorization(name)
    this.authorizationCatalogs.set(client, catalog)
    return mcpAuthorizationDigest({ instance, epoch: this.authorizationEpochs.get(name) ?? 0,
      config: this.currentConfig!.servers[name], catalog })
  }

  getAuthorizationContract(name: string): string | undefined {
    const client = this.clients.get(name)
    if (!client || !this.isCurrentClient(client) || client.connection.status !== "connected") return undefined
    const meta = client.getMeta()
    return mcpAuthorizationDigest({ capabilities: meta.capabilities,
      tools: meta.tools.map(t => ({ name: t.name, inputSchema: t.inputSchema })).sort((a, b) => a.name.localeCompare(b.name)),
      prompts: meta.prompts.map(p => ({ name: p.name, arguments: p.arguments })).sort((a, b) => a.name.localeCompare(b.name)),
    })
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
    beforeDispatch?: (preparedArgs: Record<string, any>) => void,
  ): Promise<any> {
    const client = this.requireAvailableClient(route.serverName)
    const identity = this.getAuthorizationIdentity(route.serverName)
    return client.callTool(route.toolName, args, signal, preparedArgs => {
      if (identity === undefined || this.getAuthorizationIdentity(route.serverName) !== identity ||
          this.requireAvailableClient(route.serverName) !== client) {
        throw new Error("MCP authorization changed or revoked before dispatch")
      }
      beforeDispatch?.(preparedArgs)
    })
  }

  async listResources(serverName: string, signal?: AbortSignal): Promise<any> {
    const client = this.requireAvailableClient(serverName)
    return client.listResources(signal)
  }

  async readResource(serverName: string, uri: string, signal?: AbortSignal): Promise<any> {
    const client = this.requireAvailableClient(serverName)
    return client.readResource(uri, signal)
  }

  async listPrompts(serverName: string, signal?: AbortSignal): Promise<any> {
    const client = this.requireAvailableClient(serverName)
    return client.listPrompts(signal)
  }

  async getPrompt(serverName: string, name: string, args?: Record<string, any>, signal?: AbortSignal): Promise<any> {
    const client = this.requireAvailableClient(serverName)
    return client.getPrompt(name, args, signal)
  }

  getTrustLevel(serverName: string): McpServerConfig["trust_level"] | undefined {
    return this.currentConfig?.servers[serverName]?.trust_level
  }

  // --- metadata for UI ---

  listServers(): McpServerMeta[] {
    const metas: McpServerMeta[] = []
    const seen = new Set<string>()

    for (const [name, client] of this.clients) {
      const meta = client.getMeta()
      metas.push(this.retiringClients.has(name) ? { ...meta,
        enabled: this.currentConfig?.enabled === true && this.currentConfig.servers[name]?.enabled === true,
        tools: [], resources: [], prompts: [],
      } : meta)
      seen.add(name)
    }
    for (const [name, entry] of this.retiringClients) {
      if (seen.has(name)) continue
      metas.push({ ...entry.client.getMeta(), enabled: false, tools: [], resources: [], prompts: [] })
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

  /** Wait for reconciliation AND initial catalog discovery, not just initialize.
   * The caller's admission captures revocations across the persistence boundary. */
  async waitForServerReady(name: string, signal?: AbortSignal, admitted: () => boolean = () => true): Promise<string> {
    const cfg = this.currentConfig?.servers[name]
    if (!cfg) throw new Error(`MCP server not found: ${name}`)
    const deadline = Date.now() + Math.min(120_000, resolveStartupTimeout(cfg) + resolveCallTimeout(cfg))
    while (true) {
      signal?.throwIfAborted()
      if (!admitted() || this.shuttingDown || !this.currentConfig?.enabled || !this.currentConfig.servers[name]?.enabled) {
        throw new Error("MCP allow-dir authorization changed or revoked while reconnecting")
      }
      const client = this.clients.get(name)
      if (this.retiringClients.get(name)?.failed) throw new Error(`MCP server ${name} owned teardown is unconfirmed; reconnect blocked`)
      if (!this.startingPromises.has(name) && !this.restartTimers.has(name)) {
        const identity = this.getAuthorizationIdentity(name)
        if (identity) {
          if (!client?.catalogReady) throw new Error(`MCP server ${name} catalog discovery failed; reconnect not ready`)
          return identity
        }
        if (client?.connection.status === "dead") throw new Error(`MCP server ${name} failed to reconnect`)
      }
      if (Date.now() >= deadline) throw new Error(`MCP server ${name} not ready before reconnect deadline`)
      await delay(20, undefined, { signal })
    }
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
    // Normalize declared capabilities, then inject platform home for incomplete
    // filesystem servers (args without allow-dirs → empty tool list on Windows/macOS).
    servers[name] = ensureFilesystemAllowlist(
      name,
      normalizeServerConfig(value as McpServerConfig),
    )
  }
  return { enabled, servers }
}

/**
 * Lenient normalization of an already-validated McpServerConfig. Today this
 * only affects §6.3 Phase 2-B `security_capabilities`: strip entries that
 * aren't valid declared-capability strings (typos / stale values) WITH a
 * warning, but NEVER drop the whole server — a single bad capability value
 * shouldn't orphan a configured server. If the field isn't an array at all
 * (structural mistake), drop it entirely + warn (treated as absent → pure
 * inference, Phase 1 behavior).
 */
function normalizeServerConfig(cfg: McpServerConfig): McpServerConfig {
  const raw = (cfg as any).security_capabilities
  if (raw === undefined) return cfg
  if (!Array.isArray(raw)) {
    logger.warn("mcp.config.security_capabilities_not_array", {
      hint: "security_capabilities must be an array of capability strings; ignoring the field",
      got: typeof raw,
    })
    const { security_capabilities: _omit, ...rest } = cfg as any
    return rest as McpServerConfig
  }
  const valid: string[] = []
  const dropped: string[] = []
  for (const entry of raw) {
    if (isValidDeclaredCapability(entry)) {
      valid.push(entry)
    } else {
      dropped.push(String(entry))
    }
  }
  if (dropped.length > 0) {
    logger.warn("mcp.config.security_capabilities_invalid_dropped", {
      hint: `security_capabilities entries must be one of file-read|file-write|exec|network-egress|db-read|db-mutate|read-only; dropped invalid entries`,
      dropped,
    })
  }
  return valid.length > 0
    ? { ...cfg, security_capabilities: valid as McpServerConfig["security_capabilities"] }
    : (() => { const { security_capabilities: _o, ...rest } = cfg as any; return rest as McpServerConfig })()
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

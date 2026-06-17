// Single MCP server client. Wraps the SDK's Client class with:
// - config-driven transport selection (stdio or http)
// - per-call AbortController timeouts (call_timeout_ms)
// - cached capability metadata (tools / resources / prompts lists)
// - lifecycle events for the manager to handle restarts and UI updates

import { EventEmitter } from "events"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { ListRootsRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js"
import { createTransport, extractPid } from "./transport.js"
import { logger } from "../logger.js"
import {
  resolveCallTimeout,
  resolveStartupTimeout,
  type McpConnectionState,
  type McpConnectionStatus,
  type McpPromptMeta,
  type McpResourceMeta,
  type McpServerConfig,
  type McpServerMeta,
  type McpToolMeta,
} from "./types.js"

export interface McpClientEvents {
  disconnected: (reason: string) => void
  status_changed: (status: McpConnectionStatus, error?: string) => void
  tools_changed: () => void
  stderr: (chunk: string) => void
}

export class McpClient extends EventEmitter {
  private client: Client | null = null
  private transport: Transport | null = null
  private _config: McpServerConfig
  private _connection: McpConnectionState = {
    status: "disconnected",
    restart_count: 0,
  }
  private _serverInfo: { name?: string; version?: string } = {}
  private _capabilities = { tools: false, resources: false, prompts: false }
  private _toolsCache: McpToolMeta[] = []
  private _resourcesCache: McpResourceMeta[] = []
  private _promptsCache: McpPromptMeta[] = []
  private _stderrBuffer = ""
  private _closing = false

  constructor(
    public readonly name: string,
    config: McpServerConfig,
  ) {
    super()
    this._config = config
  }

  get config(): McpServerConfig {
    return this._config
  }

  get trustLevel() {
    return this._config.trust_level
  }

  get connection(): McpConnectionState {
    return { ...this._connection }
  }

  /** Live meta snapshot for frontend and aggregator. */
  getMeta(): McpServerMeta {
    return {
      name: this.name,
      transport: this._config.transport,
      enabled: this._config.enabled,
      trust_level: this._config.trust_level,
      connection: this.connection,
      capabilities: { ...this._capabilities },
      server_info: { ...this._serverInfo },
      tools: [...this._toolsCache],
      resources: [...this._resourcesCache],
      prompts: [...this._promptsCache],
      config: { ...this._config },
    }
  }

  /** Start transport and run initialize handshake. Throws on timeout/failure. */
  async connect(): Promise<void> {
    if (this._connection.status === "connected" || this._connection.status === "connecting") {
      return
    }
    this._closing = false
    this.setStatus("connecting")
    this._stderrBuffer = ""

    const transport = createTransport(this._config, {
      onStderr: (chunk) => {
        this._stderrBuffer += chunk
        if (this._stderrBuffer.length > 8192) {
          this._stderrBuffer = this._stderrBuffer.slice(-8192)
        }
        this.emit("stderr", chunk)
      },
    })
    this.transport = transport

    transport.onclose = () => {
      if (this._closing) return
      logger.warn("mcp.client.closed", { server: this.name })
      this.setStatus("disconnected")
      this.emit("disconnected", "transport closed")
    }
    transport.onerror = (err: Error) => {
      logger.error("mcp.client.transport_error", { server: this.name, error: err.message })
      this._connection.last_error = err.message
    }

    const roots = this._config.roots
    const client = new Client(
      { name: "cmspark-agent", version: "1.0.0" },
      {
        capabilities: roots !== undefined && roots.length > 0
          ? { roots: { listChanged: true } }
          : {},
      },
    )
    this.client = client

    // The official filesystem server requests initial roots during startup.
    // Only advertise roots support when the user has configured roots, so we do not
    // change behavior for servers that do not need them.
    if (roots !== undefined && roots.length > 0) {
      client.setRequestHandler(ListRootsRequestSchema, async () => {
        return { roots }
      })
    }

    const startupTimeout = resolveStartupTimeout(this._config)
    try {
      await withTimeout(client.connect(transport), startupTimeout, `startup > ${startupTimeout}ms`)
    } catch (err: any) {
      this.setStatus("error", err?.message || String(err))
      await this.cleanupTransport()
      throw err
    }

    const caps = client.getServerCapabilities()
    this._capabilities = {
      tools: !!caps?.tools,
      resources: !!caps?.resources,
      prompts: !!caps?.prompts,
    }
    const serverVer = client.getServerVersion()
    this._serverInfo = { name: serverVer?.name, version: serverVer?.version }

    const pid = extractPid(transport)
    if (pid) this._connection.pid = pid
    this._connection.last_connected_at = new Date().toISOString()
    this.setStatus("connected")

    // Refresh metadata caches after connect (best-effort — non-fatal if a server lacks a capability)
    await this.refreshAllCaches().catch((err) => {
      logger.warn("mcp.client.cache_refresh_failed", { server: this.name, error: err?.message })
    })

    logger.info("mcp.client.connected", {
      server: this.name,
      transport: this._config.transport,
      capabilities: this._capabilities,
      tools: this._toolsCache.length,
      pid,
    })
  }

  /** Update config without reconnect. Caller must ensure no transport-affecting fields changed. */
  updateConfig(next: McpServerConfig): void {
    this._config = next
  }

  /** Mark the server as permanently dead (manager gave up on restarts). */
  markDead(reason: string): void {
    this._connection.status = "dead"
    this._connection.last_error = reason
    this.emit("status_changed", "dead", reason)
  }

  async close(): Promise<void> {
    this._closing = true
    try {
      if (this.client) {
        await this.client.close().catch(() => {})
      }
    } finally {
      await this.cleanupTransport()
      this.client = null
      this.setStatus("disconnected")
    }
  }

  private async cleanupTransport(): Promise<void> {
    if (!this.transport) return
    try {
      await (this.transport as any).close?.()
    } catch {
      // ignore
    }
    this.transport = null
  }

  private setStatus(status: McpConnectionStatus, error?: string): void {
    this._connection.status = status
    if (error !== undefined) this._connection.last_error = error
    this.emit("status_changed", status, error)
  }

  // --- capability methods ---

  async refreshAllCaches(): Promise<void> {
    if (!this.client) return
    await Promise.all([
      this.refreshTools().catch((e) => logger.warn("mcp.list_tools_failed", { server: this.name, error: e?.message })),
      this.refreshResources().catch((e) => logger.warn("mcp.list_resources_failed", { server: this.name, error: e?.message })),
      this.refreshPrompts().catch((e) => logger.warn("mcp.list_prompts_failed", { server: this.name, error: e?.message })),
    ])
  }

  async refreshTools(): Promise<McpToolMeta[]> {
    if (!this.client || !this._capabilities.tools) {
      this._toolsCache = []
      return []
    }
    const res = await this.client.listTools()
    this._toolsCache = (res.tools || []).map((t) => ({
      name: t.name,
      namespacedName: "", // filled by aggregator
      description: t.description ?? "",
      inputSchema: (t.inputSchema ?? { type: "object", properties: {} }) as Record<string, any>,
    }))
    this.emit("tools_changed")
    return this._toolsCache
  }

  async refreshResources(): Promise<McpResourceMeta[]> {
    if (!this.client || !this._capabilities.resources) {
      this._resourcesCache = []
      return []
    }
    const res = await this.client.listResources()
    this._resourcesCache = (res.resources || []).map((r) => ({
      uri: r.uri,
      name: r.name ?? r.uri,
      description: r.description,
      mimeType: r.mimeType,
    }))
    return this._resourcesCache
  }

  async refreshPrompts(): Promise<McpPromptMeta[]> {
    if (!this.client || !this._capabilities.prompts) {
      this._promptsCache = []
      return []
    }
    const res = await this.client.listPrompts()
    this._promptsCache = (res.prompts || []).map((p) => ({
      name: p.name,
      description: p.description,
      arguments: p.arguments,
    }))
    return this._promptsCache
  }

  async callTool(
    toolName: string,
    args: Record<string, any>,
    externalSignal?: AbortSignal,
  ): Promise<any> {
    if (!this.client) throw new Error(`MCP server ${this.name} not connected`)
    if (!this._capabilities.tools) {
      throw new Error(`MCP server ${this.name} does not support tools`)
    }
    const timeout = resolveCallTimeout(this._config)

    // Audit item 15: use an AbortController so that BOTH the per-call timeout
    // AND an externally-supplied signal (e.g. chat.abort from the adapter)
    // trigger the same cancellation path. Passing controller.signal to the
    // SDK's RequestOptions causes the SDK to:
    //   1. Remove the in-flight response handler (no leak — previously timed-
    //      out calls left handlers dangling in _responseHandlers forever)
    //   2. Send JSON-RPC `notifications/cancelled` to the server so the
    //      subprocess can stop working on the request
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeout)

    // If the caller already aborted before we started, bail fast without
    // dispatching to the SDK at all.
    if (externalSignal?.aborted) {
      clearTimeout(timer)
      throw new Error(`MCP call aborted before dispatch: ${this.name}/${toolName}`)
    }
    // Wire external aborts through to the controller so the SDK gets the
    // cancellation signal even if our timer hasn't fired yet.
    const onExternalAbort = () => controller.abort()
    if (externalSignal) {
      externalSignal.addEventListener("abort", onExternalAbort, { once: true })
    }

    try {
      const result = await this.client.callTool(
        { name: toolName, arguments: args },
        undefined,
        { signal: controller.signal },
      )
      // Result shape: { content: [{type, text|...}], isError }
      return {
        content: (result as any).content,
        isError: (result as any).isError === true,
      }
    } catch (err: any) {
      // Distinguish our timer-driven abort (timeout) from an external abort
      // or a genuine SDK error so the LLM gets a useful message.
      if (controller.signal.aborted) {
        const wasExternal = externalSignal?.aborted
        if (wasExternal) {
          throw new Error(`MCP call aborted: ${this.name}/${toolName}`)
        }
        throw new Error(`MCP timeout: call ${this.name}/${toolName} > ${timeout}ms`)
      }
      throw err
    } finally {
      clearTimeout(timer)
      if (externalSignal) externalSignal.removeEventListener("abort", onExternalAbort)
    }
  }

  async listResources(): Promise<McpResourceMeta[]> {
    if (!this._capabilities.resources) {
      const fileTools = this._toolsCache
        .filter((t) => /read|list|directory|file|search/i.test(t.name))
        .map((t) => `mcp__${this.name}__${t.name}`)
      const toolsHint = fileTools.length > 0
        ? ` Use namespaced tools instead: ${fileTools.join(", ")}.`
        : ""
      throw new Error(
        `MCP server ${this.name} does not advertise the resources capability, so mcp_list_resources cannot be used here.${toolsHint}`
      )
    }
    // Return cache to avoid hammering the server; caller can call refreshResources() to force update
    if (this._resourcesCache.length > 0) return this._resourcesCache
    return this.refreshResources()
  }

  async readResource(uri: string): Promise<any> {
    if (!this.client) throw new Error(`MCP server ${this.name} not connected`)
    if (!this._capabilities.resources) {
      // Provide concrete guidance when the server exposes filesystem-style tools.
      const fileTools = this._toolsCache
        .filter((t) => /read|list|directory|file|search/i.test(t.name))
        .map((t) => `mcp__${this.name}__${t.name}`)
      const fileToolsHint = fileTools.length > 0
        ? ` Use one of these namespaced tools instead: ${fileTools.join(", ")}.`
        : ""
      const genericToolsHint = this._toolsCache.length > 0 && fileTools.length === 0
        ? ` Available tools on this server: ${this._toolsCache.map((t) => t.name).join(", ")}.`
        : ""
      throw new Error(
        `MCP server ${this.name} does not advertise the resources capability, so mcp_read_resource cannot be used here.` +
        fileToolsHint +
        genericToolsHint +
        ` For the official @modelcontextprotocol/server-filesystem, read files with mcp__${this.name}__read_text_file and pass {"path": "<file-path>"}.`
      )
    }
    const timeout = resolveCallTimeout(this._config)
    return withTimeout(
      this.client.readResource({ uri }),
      timeout,
      `read_resource ${this.name} ${uri} > ${timeout}ms`,
    )
  }

  async listPrompts(): Promise<McpPromptMeta[]> {
    if (!this._capabilities.prompts) return []
    if (this._promptsCache.length > 0) return this._promptsCache
    return this.refreshPrompts()
  }

  async getPrompt(name: string, args?: Record<string, any>): Promise<any> {
    if (!this.client) throw new Error(`MCP server ${this.name} not connected`)
    if (!this._capabilities.prompts) {
      throw new Error(`MCP server ${this.name} does not support prompts`)
    }
    const timeout = resolveCallTimeout(this._config)
    return withTimeout(
      this.client.getPrompt({ name, arguments: args }),
      timeout,
      `get_prompt ${this.name}/${name} > ${timeout}ms`,
    )
  }

  get stderrTail(): string {
    return this._stderrBuffer
  }
}

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`MCP timeout: ${label}`)), ms)
  })
  try {
    return await Promise.race([p, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

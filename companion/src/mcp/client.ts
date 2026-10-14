import { normalizeFilesystemRootAliases } from "./filesystem-root-alias"
import { filesystemStartupConfig } from "./filesystem-home"
// Single MCP server client. Wraps the SDK's Client class with:
// - config-driven transport selection (stdio or http)
// - per-call AbortController timeouts (call_timeout_ms)
// - cached capability metadata (tools / resources / prompts lists)
// - lifecycle events for the manager to handle restarts and UI updates

import { EventEmitter } from "events"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import {
  ListRootsRequestSchema,
  ToolListChangedNotificationSchema,
  ResourceListChangedNotificationSchema,
  PromptListChangedNotificationSchema,
} from "@modelcontextprotocol/sdk/types.js"
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js"
import { createTransport, extractPid } from "./transport.js"
import { McpStdioTeardownError } from "./stdio-transport.js"
import { isLocalOfficialFilesystem, normalizeFilesystemToolArgs, waitForFilesystemNormalization } from "./filesystem-short-path.js"
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
  prompts_changed: () => void
  stderr: (chunk: string) => void
}

type CacheKind = "tools" | "resources" | "prompts"
const MAX_CATALOG_PAGES = 100
const MAX_CATALOG_ITEMS = 10000

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
  private refreshes = new Map<CacheKind, { client: Client; promise: Promise<unknown>; dirty: boolean }>()
  private publishedCatalogs = new Set<CacheKind>()

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

  get catalogReady(): boolean {
    // Match the catalogs included in the manager's authorization contract.
    // Resource listing is independent of tool/prompt approval readiness.
    return (["tools", "prompts"] as const).every(kind =>
      !this._capabilities[kind] || this.publishedCatalogs.has(kind))
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

  /** Start transport and run initialize handshake. Throws on timeout/failure.
   *  Production spawns the configured transport; tests may inject an in-memory
   *  transport pair (e.g. InMemoryTransport) to exercise the handshake without
   *  an external server process. */
  async connect(injectedTransport?: Transport): Promise<void> {
    if (this._connection.status === "connected" || this._connection.status === "connecting") {
      return
    }
    this._closing = false
    this.publishedCatalogs.clear()
    this.setStatus("connecting")
    // #289: do NOT clear _stderrBuffer here — the previous attempt's stderr
    // must stay visible to the UI while the retry is connecting. last_error is
    // likewise kept (setStatus without an error arg leaves it) and cleared
    // only on a successful connect below.

    // #289: transport creation (incl. `new URL` for http configs) lives INSIDE
    // the try — a synchronous throw must land in `error`, not leak past the
    // catch and leave this instance stuck in `connecting` forever.
    try {
      const startupConfig = filesystemStartupConfig(this._config)
      const transport = injectedTransport ?? createTransport(startupConfig, {
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
        if (this._connection.status === "connecting") {
          // #289: startup-failure path. connect()'s catch owns the error
          // status and the (single) restart accounting — emitting
          // `disconnected` here would double-count restarts and flash the
          // UI from error to disconnected.
          logger.warn("mcp.client.closed_during_startup", { server: this.name })
          return
        }
        logger.warn("mcp.client.closed", { server: this.name })
        this.setStatus("disconnected")
        this.emit("disconnected", "transport closed")
      }
      transport.onerror = (err: Error) => {
        logger.error("mcp.client.transport_error", { server: this.name, error: err.message })
        this._connection.last_error = err.message
        if (err instanceof McpStdioTeardownError) {
          // Protocol closure must settle SDK requests, but an unconfirmed
          // owned-process teardown must not trigger a replacement/restart.
          this._closing = true
          this.setStatus("error", err.message)
          return
        }
        // A lost HTTP session cannot recover by resending its old session id.
        // Revoke the live identity and let the manager's bounded restart policy
        // create a fresh transport. Never replay the failed tool invocation.
        if (this._config.transport === "http" && err instanceof StreamableHTTPError && err.code === 404 &&
            !this._closing && this._connection.status === "connected") {
          this._closing = true
          this.setStatus("disconnected", err.message)
          this.emit("disconnected", "HTTP session expired")
          void this.close()
        }
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
      // The SDK's automatic listChanged refresh reads only one page. Keep the
      // notification handler here so every refresh follows the same pagination,
      // timeout and atomic-publication rules as initial discovery.
      client.setNotificationHandler(ToolListChangedNotificationSchema, () => this.onListChanged("tools", client))
      client.setNotificationHandler(ResourceListChangedNotificationSchema, () => this.onListChanged("resources", client))
      client.setNotificationHandler(PromptListChangedNotificationSchema, () => this.onListChanged("prompts", client))

      // The official filesystem server requests initial roots during startup.
      // Only advertise roots support when the user has configured roots, so we do not
      // change behavior for servers that do not need them.
      if (roots !== undefined && roots.length > 0) {
        client.setRequestHandler(ListRootsRequestSchema, async () => {
          return { roots }
        })
      }

      const startupTimeout = resolveStartupTimeout(this._config)
      await withTimeout(client.connect(transport), startupTimeout, `startup > ${startupTimeout}ms`)
    } catch (err: any) {
      const baseMsg = err?.message || String(err)
      const tail = this._stderrBuffer.trim()
      const fullMsg = tail ? `${baseMsg}\nstderr: ${tail.slice(-500)}` : baseMsg
      // #289: _closing BEFORE cleanup — transport.close() fires onclose, and
      // without this guard it would overwrite `error` with `disconnected` and
      // trigger a second scheduleRestart via the manager's disconnected
      // listener (double-counting restartAttempts for a single failure).
      this._closing = true
      this.setStatus("error", fullMsg)
      try {
        await this.cleanupTransport()
      } catch (teardownError) {
        // Keep teardown primary so the manager fences replacement, while
        // retaining the original startup failure for diagnosis.
        if (teardownError instanceof McpStdioTeardownError && teardownError !== err) {
          teardownError.cause ??= err
        }
        throw teardownError
      } finally {
        // onclose settles SDK RPCs even when the owned process receipt failed.
        // Keep the transport itself tracked; only the closed SDK ref is cleared.
        if (!this.client?.transport) this.client = null
      }
      this.client = null
      throw err
    }

    const client = this.client!
    const transport = this.transport!
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
    // #289: the previous attempt's error is obsolete once a connect succeeds.
    this._connection.last_error = undefined
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
      try {
        await this.cleanupTransport()
        this.client = null
        this.setStatus("disconnected")
      } catch (error: any) {
        const message = error?.message || String(error)
        if (this._connection.status !== "error" || this._connection.last_error !== message) this.setStatus("error", message)
        throw error
      }
    }
  }

  private async cleanupTransport(): Promise<void> {
    if (!this.transport) return
    try {
      await (this.transport as any).close?.()
    } catch (error) {
      // A stdio teardown deadline is not evidence that the owned process has
      // released its resources. Keep its receipt and let callers observe it.
      if (this._config.transport === "stdio") throw error
    }
    this.transport = null
  }

  private setStatus(status: McpConnectionStatus, error?: string): void {
    this._connection.status = status
    if (error !== undefined) this._connection.last_error = error
    this.emit("status_changed", status, error)
  }

  // --- capability methods ---

  private isCurrentClient(client: Client): boolean {
    return this.client === client && !this._closing && this._connection.status === "connected"
  }

  private onListChanged(kind: CacheKind, client: Client): void {
    if (!this.isCurrentClient(client) || !this._capabilities[kind]) return
    const inFlight = this.refreshes.get(kind)
    if (inFlight?.client === client) {
      inFlight.dirty = true
      return
    }
    void this.refreshKind(kind).catch((err) => {
      logger.warn("mcp.catalog_refresh_failed", { server: this.name, kind, error: err?.message })
    })
  }

  private refreshKind(kind: CacheKind): Promise<unknown> {
    if (kind === "tools") return this.refreshTools()
    if (kind === "resources") return this.refreshResources()
    return this.refreshPrompts()
  }

  private refreshCache<T>(kind: CacheKind, client: Client, load: () => Promise<T[]>): Promise<T[]> {
    const existing = this.refreshes.get(kind)
    if (existing?.client === client) return existing.promise as Promise<T[]>
    const entry = { client, promise: Promise.resolve([]) as Promise<T[]>, dirty: false }
    // Start on the next microtask so the entry is visible even when a transport
    // dispatches notifications synchronously while requesting the first page.
    entry.promise = Promise.resolve().then(load).finally(() => {
      if (this.refreshes.get(kind) !== entry) return
      this.refreshes.delete(kind)
      if (entry.dirty) this.onListChanged(kind, client)
    })
    this.refreshes.set(kind, entry)
    return entry.promise
  }

  private collectPages<T>(
    kind: CacheKind,
    fetch: (cursor: string | undefined, signal: AbortSignal) => Promise<{ items: T[]; nextCursor?: string }>,
  ): Promise<T[]> {
    // One deadline covers the entire catalog, not a fresh timeout per page.
    return this.withCallTimeout(`list_${kind} ${this.name}`, async (signal) => {
      const items: T[] = []
      const cursors = new Set<string>()
      let cursor: string | undefined
      for (let page = 0; page < MAX_CATALOG_PAGES; page++) {
        const result = await fetch(cursor, signal)
        if (signal.aborted) throw new Error("catalog refresh aborted")
        if (items.length + result.items.length > MAX_CATALOG_ITEMS) {
          throw new Error(`MCP ${kind} catalog exceeds ${MAX_CATALOG_ITEMS} items`)
        }
        items.push(...result.items)
        if (result.nextCursor === undefined) return items
        if (cursors.has(result.nextCursor)) throw new Error(`MCP ${kind} catalog repeated pagination cursor`)
        cursors.add(result.nextCursor)
        cursor = result.nextCursor
      }
      throw new Error(`MCP ${kind} catalog exceeds ${MAX_CATALOG_PAGES} pages`)
    })
  }

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
    const client = this.client
    return this.refreshCache("tools", client, async () => {
      const tools = await this.collectPages("tools", async (cursor, signal) => {
        const res = await client.listTools(cursor === undefined ? undefined : { cursor }, { signal })
        return { items: res.tools, nextCursor: res.nextCursor }
      })
      if (!this.isCurrentClient(client)) return this._toolsCache
      this._toolsCache = tools.map((t) => ({
        name: t.name,
        namespacedName: "", // filled by aggregator
        description: t.description ?? "",
        inputSchema: (t.inputSchema ?? { type: "object", properties: {} }) as Record<string, any>,
      }))
      this.publishedCatalogs.add("tools")
      this.emit("tools_changed")
      return this._toolsCache
    })
  }

  async refreshResources(): Promise<McpResourceMeta[]> {
    if (!this.client || !this._capabilities.resources) {
      this._resourcesCache = []
      return []
    }
    const client = this.client
    return this.refreshCache("resources", client, async () => {
      const resources = await this.collectPages("resources", async (cursor, signal) => {
        const res = await client.listResources(cursor === undefined ? undefined : { cursor }, { signal })
        return { items: res.resources, nextCursor: res.nextCursor }
      })
      if (!this.isCurrentClient(client)) return this._resourcesCache
      this._resourcesCache = resources.map((r) => ({
        uri: r.uri,
        name: r.name ?? r.uri,
        description: r.description,
        mimeType: r.mimeType,
      }))
      this.publishedCatalogs.add("resources")
      return this._resourcesCache
    })
  }

  async refreshPrompts(): Promise<McpPromptMeta[]> {
    if (!this.client || !this._capabilities.prompts) {
      this._promptsCache = []
      return []
    }
    const client = this.client
    return this.refreshCache("prompts", client, async () => {
      const prompts = await this.collectPages("prompts", async (cursor, signal) => {
        const res = await client.listPrompts(cursor === undefined ? undefined : { cursor }, { signal })
        return { items: res.prompts, nextCursor: res.nextCursor }
      })
      if (!this.isCurrentClient(client)) return this._promptsCache
      this._promptsCache = prompts.map((p) => ({
        name: p.name,
        description: p.description,
        arguments: p.arguments,
      }))
      this.publishedCatalogs.add("prompts")
      this.emit("prompts_changed")
      return this._promptsCache
    })
  }

  async callTool(
    toolName: string,
    args: Record<string, any>,
    externalSignal?: AbortSignal,
    beforeDispatch?: (preparedArgs: Record<string, any>) => void,
  ): Promise<any> {
    if (!this.client) throw new Error(`MCP server ${this.name} not connected`)
    if (!this._capabilities.tools) {
      throw new Error(`MCP server ${this.name} does not support tools`)
    }
    const timeout = resolveCallTimeout(this._config)
    const client = this.client

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

    let succeeded = false
    try {
      let toolArgs = args
      if (process.platform === "win32" && isLocalOfficialFilesystem(this._config)) {
        toolArgs = await waitForFilesystemNormalization(normalizeFilesystemToolArgs(toolName, args, controller.signal), controller.signal)
        if (!this.isCurrentClient(client)) throw new Error(`MCP server ${this.name} connection changed before dispatch`)
        controller.signal.throwIfAborted()
      }
      if (isLocalOfficialFilesystem(this._config)) {
        toolArgs = await waitForFilesystemNormalization(normalizeFilesystemRootAliases(this._config, toolName, toolArgs, controller.signal), controller.signal)
      }
      controller.signal.throwIfAborted()
      if (!this.isCurrentClient(client)) throw new Error(`MCP server ${this.name} connection changed before dispatch`)
      beforeDispatch?.(toolArgs)
      const result = await client.callTool(
        { name: toolName, arguments: toolArgs },
        undefined,
        { signal: controller.signal },
      )
      succeeded = true
      // Result shape: { content: [{type, text|...}], isError }
      return {
        content: (result as any).content,
        ...((result as any).structuredContent !== undefined ? { structuredContent: (result as any).structuredContent } : {}),
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
      // SDK send failures can reject without removing their response handler.
      // Abort only the failed lifecycle, after preserving the original error.
      if (!succeeded) controller.abort()
      clearTimeout(timer)
      if (externalSignal) externalSignal.removeEventListener("abort", onExternalAbort)
    }
  }

  /**
   * #289: shared AbortController timeout for SDK calls that only take a
   * per-call timeout and caller cancellation — readResource / getPrompt.
   * Mirrors callTool's cancellation path: on timeout the SDK removes the
   * in-flight response handler and notifies the server, instead of leaving
   * a dangling handler behind a naked Promise.race.
   */
  private async withCallTimeout<T>(
    label: string,
    fn: (signal: AbortSignal) => Promise<T>,
    externalSignal?: AbortSignal,
  ): Promise<T> {
    if (externalSignal?.aborted) throw new Error(`MCP call aborted: ${label}`)
    const timeout = resolveCallTimeout(this._config)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeout)
    const onAbort = () => controller.abort()
    externalSignal?.addEventListener("abort", onAbort, { once: true })
    let succeeded = false
    try {
      const result = await fn(controller.signal)
      if (externalSignal?.aborted) throw new Error(`MCP call aborted: ${label}`)
      succeeded = true
      return result
    } catch (err: any) {
      if (externalSignal?.aborted) throw new Error(`MCP call aborted: ${label}`)
      if (controller.signal.aborted) {
        throw new Error(`MCP timeout: ${label} > ${timeout}ms`)
      }
      throw err
    } finally {
      if (!succeeded) controller.abort()
      clearTimeout(timer)
      externalSignal?.removeEventListener("abort", onAbort)
    }
  }

  async listResources(signal?: AbortSignal): Promise<McpResourceMeta[]> {
    if (signal?.aborted) throw new Error(`MCP call aborted: list_resources ${this.name}`)
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
    return waitForCatalogCaller(this.refreshResources(), signal)
  }

  async readResource(uri: string, externalSignal?: AbortSignal): Promise<any> {
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
    // #289: AbortController timeout (same pattern as callTool) so a timed-out
    // read does NOT leave the SDK response handler dangling, and the server
    // gets a JSON-RPC `notifications/cancelled`.
    return this.withCallTimeout(`read_resource ${this.name} ${uri}`, (signal) =>
      this.client!.readResource({ uri }, { signal }),
      externalSignal,
    )
  }

  async listPrompts(signal?: AbortSignal): Promise<McpPromptMeta[]> {
    if (signal?.aborted) throw new Error(`MCP call aborted: list_prompts ${this.name}`)
    if (!this._capabilities.prompts) return []
    if (this._promptsCache.length > 0) return this._promptsCache
    return waitForCatalogCaller(this.refreshPrompts(), signal)
  }

  async getPrompt(name: string, args?: Record<string, any>, externalSignal?: AbortSignal): Promise<any> {
    if (!this.client) throw new Error(`MCP server ${this.name} not connected`)
    if (!this._capabilities.prompts) {
      throw new Error(`MCP server ${this.name} does not support prompts`)
    }
    // #289: same AbortController alignment as readResource (see callTool).
    return this.withCallTimeout(`get_prompt ${this.name}/${name}`, (signal) =>
      this.client!.getPrompt({ name, arguments: args }, { signal }),
      externalSignal,
    )
  }

  get stderrTail(): string {
    return this._stderrBuffer
  }
}

/** Discovery is shared by notifications and callers. Cancel this wait, not the
 * shared SDK request; other callers still receive its atomic cache publication. */
async function waitForCatalogCaller<T>(pending: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return pending
  let onAbort!: () => void
  const cancelled = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(new Error("MCP call aborted: catalog wait"))
    signal.addEventListener("abort", onAbort, { once: true })
    if (signal.aborted) onAbort()
  })
  try { return await Promise.race([pending, cancelled]) }
  finally { signal.removeEventListener("abort", onAbort) }
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

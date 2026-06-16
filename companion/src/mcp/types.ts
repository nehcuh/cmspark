// MCP (Model Context Protocol) client types — shared between config, manager, and frontend.

export type McpTransportKind = "stdio" | "http"

export type McpTrustLevel = "manual" | "first-use" | "trusted"

export interface McpRestartPolicy {
  max_restarts: number
  backoff_base_ms: number
  backoff_max_ms: number
}

interface McpBaseServerConfig {
  enabled: boolean
  trust_level: McpTrustLevel
  startup_timeout_ms?: number
  call_timeout_ms?: number
  restart_policy?: Partial<McpRestartPolicy>
  /** Optional MCP roots to advertise to the server. Filesystem servers use these as allowed directories. */
  roots?: Array<{ uri: string; name?: string }>
}

export interface McpStdioServerConfig extends McpBaseServerConfig {
  transport: "stdio"
  command: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
}

export interface McpHttpServerConfig extends McpBaseServerConfig {
  transport: "http"
  url: string
  headers?: Record<string, string>
}

export type McpServerConfig = McpStdioServerConfig | McpHttpServerConfig

export interface McpConfig {
  enabled: boolean
  servers: Record<string, McpServerConfig>
}

export type McpConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error"
  | "dead"

export interface McpConnectionState {
  status: McpConnectionStatus
  last_error?: string
  restart_count: number
  last_connected_at?: string
  pid?: number
}

export interface McpCapabilities {
  tools: boolean
  resources: boolean
  prompts: boolean
}

export interface McpToolMeta {
  name: string
  namespacedName: string
  description: string
  inputSchema: Record<string, any>
}

export interface McpResourceMeta {
  uri: string
  name: string
  description?: string
  mimeType?: string
}

export interface McpPromptMeta {
  name: string
  description?: string
  arguments?: Array<{ name: string; description?: string; required?: boolean }>
}

export interface McpServerMeta {
  name: string
  transport: McpTransportKind
  enabled: boolean
  trust_level: McpTrustLevel
  connection: McpConnectionState
  capabilities: McpCapabilities
  server_info?: { name?: string; version?: string }
  tools: McpToolMeta[]
  resources: McpResourceMeta[]
  prompts: McpPromptMeta[]
  /** Raw config snapshot for the edit form. Sensitive values (env, headers) included
   *  since the user already configured them locally; api tokens are NOT a concern
   *  here (those are in trusted_domains, separate path). */
  config: McpServerConfig
}

export interface McpToolRoute {
  serverName: string
  toolName: string
}

export const DEFAULT_STARTUP_TIMEOUT_MS = 15000
export const DEFAULT_CALL_TIMEOUT_MS = 30000
export const DEFAULT_RESTART_POLICY: McpRestartPolicy = {
  max_restarts: 5,
  backoff_base_ms: 1000,
  backoff_max_ms: 30000,
}

export function resolveStartupTimeout(cfg: McpServerConfig): number {
  return cfg.startup_timeout_ms ?? DEFAULT_STARTUP_TIMEOUT_MS
}

export function resolveCallTimeout(cfg: McpServerConfig): number {
  return cfg.call_timeout_ms ?? DEFAULT_CALL_TIMEOUT_MS
}

export function resolveRestartPolicy(cfg: McpServerConfig): McpRestartPolicy {
  return { ...DEFAULT_RESTART_POLICY, ...(cfg.restart_policy || {}) }
}

// Fields whose change requires a transport restart (vs soft update via client.updateConfig).
const RESTART_FIELD_KEYS = [
  "transport",
  "command",
  "args",
  "env",
  "cwd",
  "url",
  "headers",
] as const

export function requiresRestart(prev: McpServerConfig, next: McpServerConfig): boolean {
  for (const key of RESTART_FIELD_KEYS) {
    const a = (prev as any)[key]
    const b = (next as any)[key]
    if (JSON.stringify(a) !== JSON.stringify(b)) return true
  }
  return false
}

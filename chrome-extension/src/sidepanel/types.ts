// Shared types for Side Panel

export type ConnectionState = "connected" | "connecting" | "disconnected"

export type SkillSelectionMode = "auto" | "all" | "manual"

export type McpSelectionMode = "auto" | "all" | "manual"

export type McpTrustLevel = "manual" | "first-use" | "trusted"

export type McpTransportKind = "stdio" | "http"

export type McpConnectionStatus = "disconnected" | "connecting" | "connected" | "error" | "dead"

export type PrivilegeMode = "readonly" | "standard" | "advanced"

export interface Thread {
  id: string
  alias: string
  created_at: string
  updated_at: string
  config_override: LLMConfig
  tool_whitelist: string[] | null
  pinned_tabs: number[]
  active_skill_ids: string[]
  skill_selection_mode?: SkillSelectionMode
  knowledge_selection_mode?: "auto" | "all" | "manual"
  mcp_selection_mode?: McpSelectionMode
  active_mcp_server_ids?: string[]
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

export interface McpConnectionState {
  status: McpConnectionStatus
  last_error?: string
  restart_count: number
  last_connected_at?: string
  pid?: number
}

export interface McpServerMeta {
  name: string
  transport: McpTransportKind
  enabled: boolean
  trust_level: McpTrustLevel
  connection: McpConnectionState
  capabilities: { tools: boolean; resources: boolean; prompts: boolean }
  server_info?: { name?: string; version?: string }
  tools: McpToolMeta[]
  resources: McpResourceMeta[]
  prompts: McpPromptMeta[]
  config: McpServerConfig
}

export interface McpStdioServerConfig {
  transport: "stdio"
  command: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
  enabled: boolean
  trust_level: McpTrustLevel
  startup_timeout_ms?: number
  call_timeout_ms?: number
}

export interface McpHttpServerConfig {
  transport: "http"
  url: string
  headers?: Record<string, string>
  enabled: boolean
  trust_level: McpTrustLevel
  startup_timeout_ms?: number
  call_timeout_ms?: number
}

export type McpServerConfig = McpStdioServerConfig | McpHttpServerConfig

export interface LogEntry {
  ts: string
  level: "info" | "warn" | "error" | "debug"
  source: string
  event: string
  data: Record<string, any>
}

export type SendShortcut = "Enter" | "Cmd+Enter" | "Ctrl+Enter"

export interface LLMConfig {
  base_url: string
  api_key: string
  model_name: string
  temperature: number
  context_window: number
  trusted_domains: string[]
  privilege_mode: PrivilegeMode
  safety_skills_enabled: string[]
  // Domains whose tool-call confirmations (evaluate, navigate, etc.) are auto-approved.
  // Flattened from companion config top-level `auto_approved_domains`.
  auto_approved_domains?: string[]
  // Global bypass for ALL dangerous tool confirmations. Flattened from companion
  // config `security.auto_approve_dangerous`. Default false.
  auto_approve_dangerous?: boolean
  // Vision model fields (flattened for UI convenience)
  vision_enabled?: boolean
  vision_api_key?: string
  vision_base_url?: string
  vision_model_name?: string
  vision_timeout_ms?: number
  vision_fallback?: "metadata" | "passthrough" | "error"
  // File upload fields (flattened from config.file_upload)
  file_upload_max_size?: number
  file_upload_max_tokens?: number
  file_upload_vision?: boolean
  // Obsidian export vault path (flattened from companion config.obsidian.vault_path)
  obsidian_vault_path?: string
}

export interface Message {
  id: string
  thread_id: string
  role: "user" | "assistant" | "tool"
  content: string
  tool_calls?: ToolCall[]
  created_at: string
  streaming?: boolean
}

export interface SecurityConfirmationRequest {
  confirmation_id: string
  tool_name: string
  dangerous_apis: string[]
  code_preview: string
  timeout_ms?: number
  requested_at?: string
  risk_score?: number
  risk_category?: string
  risk_level?: "low" | "medium" | "high"
  auto_confirm_eligible?: boolean
  defense_layer?: number
  /**
   * Domains the user may add to auto_approved_domains when approving. Empty or
   * missing when companion couldn't determine the acting domain — UI hides the
   * "add to whitelist" option in that case.
   */
  relevant_domains?: string[]
}

export interface ToolCall {
  id: string
  tool_name: string
  params: Record<string, any>
  result?: ToolResult | null
  status: "pending" | "running" | "success" | "error"
  vision_status?: "analyzing" | "done" | "cached" | "error"
  vision_latency_ms?: number
}

export interface ToolResult {
  success: boolean
  data?: any
  error?: string
}

export interface FileAttachment {
  name: string
  type: string       // MIME type
  size: number
  content: string    // base64 encoded
}

export interface SkillMeta {
  name: string
  description: string
  type: "prompt_template" | "tool_chain" | "sub_agent" | "site_knowledge" | "domain_knowledge"
  builtin: boolean
  site?: string
  tags?: string[]
  entries?: Array<{
    id: string
    category: "problem" | "success" | "tip" | "rule"
    content: string
    recorded_at: string
    stale: boolean
    stale_reason: string
  }>
}

export interface KnowledgeMeta {
  name: string
  description: string
  type: "site_knowledge" | "domain_knowledge"
  site?: string
  builtin: boolean
  source_file?: string
}

export interface OperationRecord {
  id: number
  thread_id: string
  tool_name: string
  params: string
  result_summary: string
  error: string | null
  success: number
  duration_ms: number
  created_at: string
}

export interface SecurityAuditEntry {
  id: string
  ts: string
  level: "info" | "warn" | "error" | "block"
  tool_name: string
  action: "allowed" | "denied" | "blocked"
  risk_level: "low" | "medium" | "high"
  risk_score: number
  defense_layer?: number
  message: string
}

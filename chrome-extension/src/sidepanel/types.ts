// Shared types for Side Panel

export type ConnectionState = "connected" | "connecting" | "disconnected"

export type SkillSelectionMode = "auto" | "all" | "manual"

export type McpSelectionMode = "auto" | "all" | "manual"

export type McpTrustLevel = "manual" | "first-use" | "trusted"

export type McpTransportKind = "stdio" | "http"

/**
 * User-declarable security capability for an MCP server (mirrors
 * companion/src/security.ts McpDeclaredCapability = Exclude<McpCapability,"unknown">).
 * The 7 values a user may declare; "unknown" is not declarable. Used by the
 * §6.3 capability gate (Phase 2-B): declared caps merge with inferred caps via
 * a fail-safe union — a declaration can only escalate or resolve "unknown",
 * never suppress a positively-inferred critical capability.
 */
export type McpDeclaredCapability =
  | "file-read" | "file-write" | "exec" | "network-egress"
  | "db-read" | "db-mutate" | "read-only"

export type McpConnectionStatus = "disconnected" | "connecting" | "connected" | "error" | "dead"

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
  /** §6.3 Phase 2-B: user-declared security capabilities. Optional — omit for
   *  pure inference (Phase 1 behavior). */
  security_capabilities?: McpDeclaredCapability[]
}

export interface McpHttpServerConfig {
  transport: "http"
  url: string
  headers?: Record<string, string>
  enabled: boolean
  trust_level: McpTrustLevel
  startup_timeout_ms?: number
  call_timeout_ms?: number
  /** §6.3 Phase 2-B: user-declared security capabilities. Optional — omit for
   *  pure inference (Phase 1 behavior). */
  security_capabilities?: McpDeclaredCapability[]
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
  // True when companion reports a non-empty api_key (masked as "***"). Lets the
  // settings UI show "已配置 ✓" without ever exposing the real key.
  api_key_set?: boolean
  model_name: string
  temperature: number
  context_window: number
  trusted_domains: string[]
  safety_skills_enabled: string[]
  // Domains whose tool-call confirmations (evaluate, navigate, etc.) are auto-approved.
  // Flattened from companion config top-level `auto_approved_domains`.
  auto_approved_domains?: string[]
  // Global bypass for ALL dangerous tool confirmations. Flattened from companion
  // config `security.auto_approve_dangerous`. Default false.
  auto_approve_dangerous?: boolean
  // GOD-MODE: bypasses BOTH the URL-scheme hard-block (Layer 1) AND the dangerous-tool
  // confirmation gate (Layer 2). Strictly stronger than auto_approve_dangerous (L2 only).
  // Flattened from companion config `security.allow_all_schemes`. Default false.
  // UI enable requires a typed confirmation phrase (PR-B); gated behind PR-0 WS auth.
  allow_all_schemes?: boolean
  // Vision model fields (flattened for UI convenience)
  vision_enabled?: boolean
  vision_api_key?: string
  // True when companion reports a non-empty vision api_key (masked as "***").
  vision_api_key_set?: boolean
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
  // Global MCP kill-switch (flattened from companion config.mcp.enabled).
  // When false, the McpManager refuses to start any client and listServers()
  // synthesizes disconnected metas — UI uses this to render the master toggle.
  mcp_enabled?: boolean
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
  /**
   * Phase 1 W7 — bundle ids the user may add to thread-scoped trust when
   * approving. Empty/missing for non-host_use tools. UI shows inline checkbox
   * "信任此 app，本线程内不再询问" only for host_read (writes always biometric).
   */
  relevant_apps?: string[]
  /**
   * Phase 1 W9 — Linux manual nonce for biometric tier. 6-char code shown
   * prominently in dialog; user must TYPE it back in a paste-blocked input.
   * Round 2 §2.3 Kimi加严: 不可复制粘贴. Undefined on darwin (uses Touch ID).
   */
  nonce_challenge?: string
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
  // "allowed"/"denied"/"blocked" = a tool-gate decision (confirmation dialog).
  // "changed" = a security-setting change (e.g. god-mode armed/disarmed via UI phrase).
  // tool_name discriminates which setting (e.g. "allow_all_schemes" = the
  // design's godmode_enabled_changed event); `source` records the provenance.
  action: "allowed" | "denied" | "blocked" | "changed"
  risk_level: "low" | "medium" | "high"
  risk_score: number
  defense_layer?: number
  message: string
  // Provenance of a security-setting change (design §B godmode_enabled_changed).
  // "ui_phrase_confirmed" = armed/disarmed from this UI's typed-confirmation panel.
  // The other two originate companion-side (future live-bypass broadcast follow-up).
  source?: "ui_phrase_confirmed" | "config.json_manual" | "ws_authenticated"
}

// --- App tab (WP4) — mirrors companion/src/apps/types.ts ---
// The extension is a pure view: entries arrive via apps.list / apps.updated.

export type AppPolicy = "auto" | "ai" | "manual"

export interface AppExeBlock {
  path: string
  sha256?: string
  /** Authenticode signer captured at add-time; absent/empty = unsigned. */
  signer?: string
  user_writable_dir: boolean
}

export interface AppEntry {
  token: string
  kind: "gui" | "cli"
  display_name: string
  source: "preset" | "user"
  policy: AppPolicy
  enabled: boolean
  added_at: string
  exe?: AppExeBlock
  aumid?: string
  /** Policy ceiling attached by the backend (unsigned/user-writable/AUMID → "ai"). */
  max_policy?: "auto" | "ai"
}

/** Preset detection status from apps.list (companion/src/apps/presets.ts). */
export interface AppPresetStatus {
  token: string
  display_name: string
  detected: boolean
  persisted: boolean
}

/** Candidate from apps.enumerate.result, annotated by the backend guards. */
export interface AppEnumerateCandidate {
  name: string
  source: "running" | "startapps"
  path?: string
  aumid?: string
  /** Hard-denied by the lolbin blocklist — UI shows the row disabled. */
  blocked: boolean
  block_reason?: "lolbin"
  /** Basename maps to a vault-blacklist app — allowed, but UI warns. */
  vault_token?: string
}

/** Warning returned with an apps.add response (D8 — rendered prominently). */
export interface AppAddWarning {
  code: string
  message: string
}

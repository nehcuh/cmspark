// Shared types for Side Panel

export type ConnectionState = "connected" | "connecting" | "disconnected"

export type SkillSelectionMode = "auto" | "all" | "manual"

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
}

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
}

export interface ToolCall {
  id: string
  tool_name: string
  params: Record<string, any>
  result?: ToolResult | null
  status: "pending" | "running" | "success" | "error"
}

export interface ToolResult {
  success: boolean
  data?: any
  error?: string
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

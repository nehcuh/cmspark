// Pure config normalization for Side Panel (residual god-file extract from useWebSocket).
// Companion is secret SoT — masked keys never enter editable UI fields.

import type { LLMConfig } from "../types"

function isMaskedApiKey(key: string | undefined | null): boolean {
  if (!key || typeof key !== "string") return false
  if (key === "***") return true
  // Any occurrence of 4+ consecutive asterisks indicates masking.
  if (key.includes("****")) return true
  // Some UIs use dots instead of asterisks
  if (key.includes("....") && key.length >= 10) return true
  return false
}

export function normalizeConfig(config: any): Partial<LLMConfig> {
  if (!config) return {}
  const llm = config.llm || config
  const llmKeyMasked = isMaskedApiKey(llm.api_key)
  const normalized: Partial<LLMConfig> = {
    base_url: llm.base_url,
    // Drop the masked placeholder from the editable field — the user re-types
    // their key on save. But preserve the "is the key already set?" signal so
    // the UI can show "已配置 ✓" without exposing the actual secret.
    api_key: llmKeyMasked ? "" : llm.api_key,
    api_key_set: llmKeyMasked ? true : (llm.api_key ? true : false),
    model_name: llm.model_name,
    temperature: llm.temperature,
    context_window: llm.context_window,
    context_compaction:
      llm.context_compaction === "prompt" || llm.context_compaction === "off"
        ? llm.context_compaction
        : llm.context_compaction === "auto"
          ? "auto"
          : undefined,
    context_compaction_m2:
      typeof llm.context_compaction_m2 === "boolean" ? llm.context_compaction_m2 : undefined,
    // Anthropic P1: wire protocol + Coding Plan gateway-compat profile
    protocol: llm.protocol === "anthropic" ? "anthropic" : "openai",
    client_header_profile:
      llm.client_header_profile === "claude_code_compat" ? "claude_code_compat" : "none",
    native_vision:
      llm.native_vision === "on" || llm.native_vision === "off" || llm.native_vision === "auto"
        ? llm.native_vision
        : undefined,
  }
  if (Array.isArray(config.trusted_domains)) {
    normalized.trusted_domains = config.trusted_domains
  }
  if (Array.isArray(config.auto_approved_domains)) {
    normalized.auto_approved_domains = config.auto_approved_domains
  }
  // Security: flatten nested config.security.auto_approve_dangerous → LLMConfig.auto_approve_dangerous
  if (config.security && typeof config.security.auto_approve_dangerous === "boolean") {
    normalized.auto_approve_dangerous = config.security.auto_approve_dangerous
  }
  if (config.security && typeof config.security.auto_approve_enterprise_tools === "boolean") {
    normalized.auto_approve_enterprise_tools = config.security.auto_approve_enterprise_tools
  }
  if (typeof config.auto_approve_enterprise_tools === "boolean") {
    normalized.auto_approve_enterprise_tools = config.auto_approve_enterprise_tools
  }
  // Security: flatten nested config.security.allow_all_schemes (GOD-MODE) → LLMConfig.allow_all_schemes
  if (config.security && typeof config.security.allow_all_schemes === "boolean") {
    normalized.allow_all_schemes = config.security.allow_all_schemes
  }
  // Vision config fields (flattened from config.vision)
  const vision = config.vision
  if (vision) {
    normalized.vision_enabled = !!vision.enabled
    // Same masked-key pattern as the main LLM key — keep the editable field empty
    // but expose `vision_api_key_set` so the UI can show "已配置" indicators.
    const visionKeyMasked = isMaskedApiKey(vision.api_key)
    normalized.vision_api_key = visionKeyMasked ? "" : vision.api_key
    normalized.vision_api_key_set = visionKeyMasked ? true : (vision.api_key ? true : false)
    normalized.vision_base_url = vision.base_url
    normalized.vision_model_name = vision.model_name
    normalized.vision_timeout_ms = vision.timeout_ms
    normalized.vision_fallback = vision.fallback
  } else {
    // Explicitly disable vision when companion sends no vision block
    normalized.vision_enabled = false
  }
  // File upload config fields (flattened from config.file_upload)
  const fileUpload = config.file_upload
  if (fileUpload) {
    normalized.file_upload_max_size = fileUpload.max_file_size
    normalized.file_upload_max_tokens = fileUpload.max_file_tokens
    normalized.file_upload_vision = !!fileUpload.enable_vision_analysis
  }
  // Obsidian export: flatten config.obsidian.vault_path
  if (config.obsidian && typeof config.obsidian.vault_path === "string") {
    normalized.obsidian_vault_path = config.obsidian.vault_path
  }
  // Global MCP kill-switch: flatten config.mcp.enabled so the UI can render
  // the master toggle without a separate dispatch path.
  if (config.mcp && typeof config.mcp.enabled === "boolean") {
    normalized.mcp_enabled = config.mcp.enabled
  }
  // Wave B: thread_digest coverage (default off)
  const td = config.thread_digest
  if (td && typeof td === "object") {
    if (typeof td.enabled === "boolean") normalized.thread_digest_enabled = td.enabled
    if (typeof td.on_idle_hours === "number") normalized.thread_digest_on_idle_hours = td.on_idle_hours
    if (typeof td.max_per_day === "number") normalized.thread_digest_max_per_day = td.max_per_day
  }
  // Mode C prefs (nested; stored on config for Settings UI round-trip)
  const ch = config.coding_handoff
  if (ch && typeof ch === "object" && !Array.isArray(ch)) {
    const handoff: {
      auto_suggest?: boolean
      open_local_terminal?: boolean
      local_terminal_app?: string
    } = {}
    if (typeof ch.auto_suggest === "boolean") handoff.auto_suggest = ch.auto_suggest
    if (typeof ch.open_local_terminal === "boolean") {
      handoff.open_local_terminal = ch.open_local_terminal
    }
    if (typeof ch.local_terminal_app === "string" && ch.local_terminal_app.trim()) {
      handoff.local_terminal_app = ch.local_terminal_app.trim().slice(0, 512)
    }
    if (Object.keys(handoff).length > 0) {
      ;(normalized as any).coding_handoff = handoff
    }
  }
  return Object.fromEntries(
    Object.entries(normalized).filter(([, value]) => value !== undefined)
  ) as Partial<LLMConfig>
}

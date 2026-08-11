// Config / settings family WS handlers (C10-C mechanical extract from message-router).
// Zero behavior change — cases config.* + settings.* only.

import OpenAI from "openai"
import { getConfig, saveConfig, isMaskedApiKey } from "../../config"
import { probeLlmConnection } from "../../llm/connection-test"
import {
  findArmingSecurityFlags,
  isValidSecurityArmPhrase,
  securityArmRejectedError,
  type SecurityArmFlag,
} from "../../security-arm"
import { logger } from "../../logger"
import { redactConfigForWire } from "../../config-redact"


const PROTOTYPE_POLLUTION_KEYS = new Set(["__proto__", "constructor", "prototype"])

export function hasPrototypePollutionKey(obj: any): boolean {
  if (!obj || typeof obj !== "object") return false
  for (const key of Object.keys(obj)) {
    if (PROTOTYPE_POLLUTION_KEYS.has(key)) return true
    const val = obj[key]
    if (typeof val === "object" && hasPrototypePollutionKey(val)) return true
  }
  return false
}

function sanitizeConfig(obj: Record<string, any>): Record<string, any> {
  const result = Object.create(null)
  for (const key of Object.keys(obj)) {
    if (PROTOTYPE_POLLUTION_KEYS.has(key)) continue
    const val = obj[key]
    if (val !== null && typeof val === "object" && !Array.isArray(val)) {
      result[key] = sanitizeConfig(val)
    } else {
      result[key] = val
    }
  }
  return result
}

/**
 * Handle config.get / config.set / config.test / settings.test / config.testVision /
 * settings.get / settings.set. Returns null if type is not in this family.
 */
export async function handleConfigFamily(type: string, rest: any): Promise<any | null> {
  switch (type) {
    case "config.get": {
      // SoT: same redaction as config.updated broadcast (MCP env/headers + llm keys).
      return {
        type: "config.updated",
        config: redactConfigForWire(getConfig()),
      }
    }
    case "config.set": {
      const cfg = rest.config
      // Reject prototype pollution keys (P0)
      if (hasPrototypePollutionKey(cfg)) {
        return { type: "error", error: "Invalid config keys detected" }
      }
      // Normalize: if caller sends flat LLM fields, nest them under llm
      const normalized: any = {}
      if (cfg.llm) {
        normalized.llm = sanitizeConfig({ ...cfg.llm })
        if (isMaskedApiKey(normalized.llm.api_key)) delete normalized.llm.api_key
      } else if (
        cfg.base_url ||
        cfg.model_name ||
        cfg.temperature !== undefined ||
        cfg.context_window !== undefined ||
        cfg.context_compaction !== undefined ||
        cfg.protocol !== undefined ||
        cfg.client_header_profile !== undefined ||
        cfg.auth_style !== undefined
      ) {
        normalized.llm = {}
        if (cfg.base_url) normalized.llm.base_url = cfg.base_url
        if (cfg.api_key && !isMaskedApiKey(cfg.api_key)) normalized.llm.api_key = cfg.api_key
        if (cfg.model_name) normalized.llm.model_name = cfg.model_name
        if (cfg.temperature !== undefined) normalized.llm.temperature = cfg.temperature
        if (cfg.context_window !== undefined) normalized.llm.context_window = cfg.context_window
        if (
          cfg.context_compaction === "auto" ||
          cfg.context_compaction === "prompt" ||
          cfg.context_compaction === "off"
        ) {
          normalized.llm.context_compaction = cfg.context_compaction
        }
        if (typeof cfg.context_compaction_m2 === "boolean") {
          normalized.llm.context_compaction_m2 = cfg.context_compaction_m2
        }
        // Anthropic P1: protocol + Coding Plan gateway-compat profile (flat UI fields)
        if (cfg.protocol === "openai" || cfg.protocol === "anthropic") {
          normalized.llm.protocol = cfg.protocol
        }
        if (cfg.client_header_profile === "none" || cfg.client_header_profile === "claude_code_compat") {
          normalized.llm.client_header_profile = cfg.client_header_profile
        }
        if (cfg.auth_style === "auto" || cfg.auth_style === "bearer" || cfg.auth_style === "x-api-key") {
          normalized.llm.auth_style = cfg.auth_style
        }
        if (typeof cfg.claude_code_compat_version === "string" && cfg.claude_code_compat_version.trim()) {
          normalized.llm.claude_code_compat_version = cfg.claude_code_compat_version.trim()
        }
        if (typeof cfg.anthropic_version === "string" && cfg.anthropic_version.trim()) {
          normalized.llm.anthropic_version = cfg.anthropic_version.trim()
        }
      }
      if (cfg.port) normalized.port = cfg.port
      if (Array.isArray(cfg.trusted_domains)) normalized.trusted_domains = cfg.trusted_domains
      if (Array.isArray(cfg.auto_approved_domains)) normalized.auto_approved_domains = cfg.auto_approved_domains
      if (cfg.history_retention_days) normalized.history_retention_days = cfg.history_retention_days
      // `!== undefined` (not truthy) so the UI can disable retention/rotation by sending 0,
      // which the backend treats as "off" (pruneOldLogs / rotateLogFileIfNeeded early-return on <=0).
      if (cfg.log_retention_days !== undefined) normalized.log_retention_days = cfg.log_retention_days
      if (cfg.log_max_file_mb !== undefined) normalized.log_max_file_mb = cfg.log_max_file_mb
      // Security config: normalize flat security_* fields into nested security object.
      // The extension UI sends flattened fields (auto_approve_dangerous, allow_all_schemes)
      // at the top level; re-nest them under `security`, preserving the rest of the
      // current security block (deepMerge fills the partner field from current config).
      if (cfg.security && typeof cfg.security === "object") {
        normalized.security = { ...cfg.security }
      } else if (
        cfg.auto_approve_dangerous !== undefined ||
        cfg.allow_all_schemes !== undefined ||
        cfg.auto_approve_enterprise_tools !== undefined
      ) {
        const current = getConfig()
        normalized.security = { ...(current.security || {}) }
        if (cfg.auto_approve_dangerous !== undefined) {
          normalized.security.auto_approve_dangerous = !!cfg.auto_approve_dangerous
        }
        if (cfg.allow_all_schemes !== undefined) {
          normalized.security.allow_all_schemes = !!cfg.allow_all_schemes
        }
        if (cfg.auto_approve_enterprise_tools !== undefined) {
          normalized.security.auto_approve_enterprise_tools = !!cfg.auto_approve_enterprise_tools
        }
      }
      // P1-1 Trust step-up: false→true for dangerous security flags requires
      // top-level confirmation_phrase (Design A). Gate both flat and nested paths.
      // Disarm and already-true resend (handleSave snapshot) need no phrase.
      // Does not touch CU L2 / shell forceConfirm invariants (server.ts).
      let armingFlags: SecurityArmFlag[] = []
      if (normalized.security) {
        const currentSec = getConfig().security || {}
        armingFlags = findArmingSecurityFlags(
          normalized.security as Record<string, unknown>,
          currentSec as unknown as Record<string, unknown>,
        )
        if (armingFlags.length > 0) {
          if (!isValidSecurityArmPhrase(rest.confirmation_phrase)) {
            const reason =
              rest.confirmation_phrase == null || rest.confirmation_phrase === ""
                ? "missing_phrase"
                : "wrong_phrase"
            logger.warn("security.arm_rejected", {
              flags: armingFlags,
              reason,
              source: "ws_config_set",
            })
            return { type: "error", error: securityArmRejectedError(armingFlags) }
          }
        }
      }
      // Vision config: normalize flat vision_* fields into nested vision object
      if (cfg.vision) {
        normalized.vision = { ...cfg.vision }
        if (isMaskedApiKey(normalized.vision.api_key)) delete normalized.vision.api_key
      } else if (cfg.vision_enabled !== undefined || cfg.vision_base_url || cfg.vision_model_name) {
        const current = getConfig()
        normalized.vision = { ...(current.vision || {}) }
        if (cfg.vision_enabled !== undefined) normalized.vision.enabled = !!cfg.vision_enabled
        if (cfg.vision_api_key && !isMaskedApiKey(cfg.vision_api_key)) normalized.vision.api_key = cfg.vision_api_key
        if (cfg.vision_base_url) normalized.vision.base_url = cfg.vision_base_url
        if (cfg.vision_model_name) normalized.vision.model_name = cfg.vision_model_name
        if (cfg.vision_timeout_ms !== undefined) normalized.vision.timeout_ms = cfg.vision_timeout_ms
        if (cfg.vision_fallback) normalized.vision.fallback = cfg.vision_fallback
      }
      // File upload config: normalize flat file_upload_* fields into nested file_upload object
      if (cfg.file_upload) {
        normalized.file_upload = { ...cfg.file_upload }
      } else if (cfg.file_upload_max_size !== undefined || cfg.file_upload_max_tokens !== undefined || cfg.file_upload_vision !== undefined) {
        const current = getConfig()
        normalized.file_upload = { ...(current.file_upload || {}) }
        if (cfg.file_upload_max_size !== undefined) normalized.file_upload.max_file_size = cfg.file_upload_max_size
        if (cfg.file_upload_max_tokens !== undefined) normalized.file_upload.max_file_tokens = cfg.file_upload_max_tokens
        if (cfg.file_upload_vision !== undefined) normalized.file_upload.enable_vision_analysis = !!cfg.file_upload_vision
      }
      // Thread History IA Wave B: thread_digest coverage engine (default off)
      if (cfg.thread_digest && typeof cfg.thread_digest === "object") {
        const current = getConfig()
        const cur = current.thread_digest || { enabled: false, on_idle_hours: 24, max_per_day: 20 }
        const src = cfg.thread_digest as Record<string, unknown>
        normalized.thread_digest = {
          enabled: typeof src.enabled === "boolean" ? src.enabled : !!cur.enabled,
          on_idle_hours:
            typeof src.on_idle_hours === "number" && src.on_idle_hours >= 0
              ? Math.min(720, Math.floor(src.on_idle_hours))
              : (cur.on_idle_hours ?? 24),
          max_per_day:
            typeof src.max_per_day === "number" && src.max_per_day >= 0
              ? Math.min(100, Math.floor(src.max_per_day))
              : (cur.max_per_day ?? 20),
        }
      } else if (
        cfg.thread_digest_enabled !== undefined ||
        cfg.thread_digest_on_idle_hours !== undefined ||
        cfg.thread_digest_max_per_day !== undefined
      ) {
        const current = getConfig()
        const cur = current.thread_digest || { enabled: false, on_idle_hours: 24, max_per_day: 20 }
        normalized.thread_digest = {
          enabled:
            cfg.thread_digest_enabled !== undefined
              ? !!cfg.thread_digest_enabled
              : !!cur.enabled,
          on_idle_hours:
            typeof cfg.thread_digest_on_idle_hours === "number" && cfg.thread_digest_on_idle_hours >= 0
              ? Math.min(720, Math.floor(cfg.thread_digest_on_idle_hours))
              : (cur.on_idle_hours ?? 24),
          max_per_day:
            typeof cfg.thread_digest_max_per_day === "number" && cfg.thread_digest_max_per_day >= 0
              ? Math.min(100, Math.floor(cfg.thread_digest_max_per_day))
              : (cur.max_per_day ?? 20),
        }
      }
      const updated = saveConfig(normalized)
      if (armingFlags.length > 0) {
        logger.warn("security.flag_armed", {
          flags: armingFlags,
          source: "ws_phrase_confirmed",
        })
      }
      return {
        type: "config.updated",
        config: redactConfigForWire(updated),
      }
    }

    case "config.test":
    case "settings.test": {
      const config = getConfig()
      // Extension may send llm_override for unsaved UI fields (protocol/profile/url/key).
      // Merge field-by-field: key only from override when non-masked; protocol always may override.
      const override = rest.llm_override as Record<string, unknown> | undefined
      const hasOverrideKey = !!(override?.api_key && !isMaskedApiKey(override.api_key as string))
      // S41 multi-adv P0: empty-string override must not clobber stored URL/model
      // (Coding Plan 中继 preset sets base_url:"" intentionally).
      const nonBlank = (v: unknown, fallback: string): string => {
        const s = v == null ? "" : String(v).trim()
        return s || fallback
      }
      const testConfig = {
        api_key: hasOverrideKey
          ? String(override!.api_key)
          : config.llm.api_key,
        base_url: nonBlank(override?.base_url, config.llm.base_url),
        model_name: nonBlank(override?.model_name, config.llm.model_name),
        protocol: (override?.protocol as string | undefined) ?? config.llm.protocol ?? "openai",
        client_header_profile:
          (override?.client_header_profile as string | undefined) ??
          config.llm.client_header_profile ??
          "none",
        auth_style:
          (override?.auth_style as string | undefined) ?? config.llm.auth_style ?? "auto",
        claude_code_compat_version:
          (override?.claude_code_compat_version as string | undefined) ??
          config.llm.claude_code_compat_version,
        anthropic_version:
          (override?.anthropic_version as string | undefined) ?? config.llm.anthropic_version,
        extra_headers: config.llm.extra_headers,
      }

      if (!testConfig.api_key || testConfig.api_key === "sk-placeholder" || isMaskedApiKey(testConfig.api_key)) {
        return { type: "config.testResult", ok: false, error: "API Key 未配置" }
      }
      // SSRF: refuse config.test against private/loopback base_url (shared gate)
      if (testConfig.base_url) {
        const { assertOutboundFetchUrlAllowed } = await import("../../security")
        const ssrf = assertOutboundFetchUrlAllowed(String(testConfig.base_url))
        if (ssrf) {
          return { type: "config.testResult", ok: false, error: ssrf }
        }
      }
      const probe = await probeLlmConnection(testConfig)
      if (probe.ok) {
        return { type: "config.testResult", ok: true, message: probe.message }
      }
      return { type: "config.testResult", ok: false, error: probe.error || "连接失败" }
    }

    case "config.testVision": {
      const config = getConfig()
      if (!config.vision?.enabled) {
        return { type: "config.testVisionResult", ok: false, error: "Vision not enabled" }
      }
      try {
        const client = new OpenAI({
          baseURL: config.vision.base_url,
          apiKey: config.vision.api_key || "ollama",
          timeout: 5000,
          maxRetries: 0,
        })
        await client.models.list()
        return { type: "config.testVisionResult", ok: true, model: config.vision.model_name }
      } catch (e: any) {
        return { type: "config.testVisionResult", ok: false, error: e.message || String(e) }
      }
    }

    case "settings.get": {
      const config = getConfig()
      return {
        type: "settings.result",
        settings: {
          api_key: config.llm.api_key ? "***" : "",
          base_url: config.llm.base_url,
          model_name: config.llm.model_name,
          temperature: config.llm.temperature,
          context_window: config.llm.context_window,
          context_compaction: config.llm.context_compaction ?? "auto",
          context_compaction_m2: config.llm.context_compaction_m2 !== false,
          protocol: config.llm.protocol ?? "openai",
          client_header_profile: config.llm.client_header_profile ?? "none",
          auth_style: config.llm.auth_style ?? "auto",
        },
      }
    }
    case "settings.set": {
      const cfg = rest.settings || {}
      // Reject prototype pollution keys (P0)
      if (hasPrototypePollutionKey(cfg)) {
        return { type: "error", error: "Invalid config keys detected" }
      }
      const normalized: any = { llm: {} }
      if (cfg.api_key && !isMaskedApiKey(cfg.api_key)) normalized.llm.api_key = cfg.api_key
      if (cfg.base_url) normalized.llm.base_url = cfg.base_url
      if (cfg.model_name) normalized.llm.model_name = cfg.model_name
      if (cfg.temperature !== undefined) normalized.llm.temperature = cfg.temperature
      if (cfg.context_window !== undefined) normalized.llm.context_window = cfg.context_window
      if (
        cfg.context_compaction === "auto" ||
        cfg.context_compaction === "prompt" ||
        cfg.context_compaction === "off"
      ) {
        normalized.llm.context_compaction = cfg.context_compaction
      }
      if (typeof cfg.context_compaction_m2 === "boolean") {
        normalized.llm.context_compaction_m2 = cfg.context_compaction_m2
      }
      if (cfg.protocol === "openai" || cfg.protocol === "anthropic") {
        normalized.llm.protocol = cfg.protocol
      }
      if (cfg.client_header_profile === "none" || cfg.client_header_profile === "claude_code_compat") {
        normalized.llm.client_header_profile = cfg.client_header_profile
      }
      if (cfg.auth_style === "auto" || cfg.auth_style === "bearer" || cfg.auth_style === "x-api-key") {
        normalized.llm.auth_style = cfg.auth_style
      }

      // Validate temperature
      if (normalized.llm.temperature !== undefined) {
        const t = parseFloat(normalized.llm.temperature)
        if (isNaN(t) || t < 0 || t > 2) {
          return { type: "error", error: "temperature 应为 0.0 - 2.0 之间的数字" }
        }
      }
      // Validate context_window
      if (normalized.llm.context_window !== undefined) {
        const cw = parseInt(normalized.llm.context_window, 10)
        if (isNaN(cw) || cw < 1000 || cw > 10000000) {
          return { type: "error", error: "context_window 应为 1000 - 10000000 之间的整数" }
        }
      }
      // Validate base_url
      if (normalized.llm.base_url) {
        try { new URL(normalized.llm.base_url) } catch {
          return { type: "error", error: "无效的 base_url" }
        }
      }

      const updated = saveConfig(normalized)
      return {
        type: "settings.saved",
        settings: {
          api_key: updated.llm.api_key ? "***" : "",
          base_url: updated.llm.base_url,
          model_name: updated.llm.model_name,
          temperature: updated.llm.temperature,
          context_window: updated.llm.context_window,
          context_compaction: updated.llm.context_compaction ?? "auto",
          context_compaction_m2: updated.llm.context_compaction_m2 !== false,
        },
      }
    }

    default:
      return null
  }
}

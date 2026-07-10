// Companion configuration management

import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import { EventEmitter } from "events"
import { getLockPath } from "./platform"
import { getBuiltinSkillsSrc } from "./paths"
import { atomicWriteJSON } from "./io"
import type { McpConfig } from "./mcp/types"
import type { ObsidianExportConfig } from "./threads/markdown-export"

export const configEvents = new EventEmitter()
export const CONFIG_CHANGE_EVENT = "config.change"

export const DATA_DIR = process.env.CMSPARK_DATA_DIR || path.join(os.homedir(), ".cmspark-agent")

export interface SecurityConfig {
  safety_skills_enabled: string[]
  auto_confirm_same_thread: boolean
  confirmation_timeout_seconds: number
  /**
   * When true, ALL dangerous tool calls (evaluate, osascript_eval, navigate to
   * untrusted domain, etc.) are auto-approved without showing the confirmation
   * dialog. Intended for long-running unattended agents only — bypasses the
   * primary human-in-the-loop safety gate. Defaults to false.
   */
  auto_approve_dangerous: boolean
}

export interface VisionConfig {
  enabled: boolean
  base_url: string
  api_key: string
  model_name: string
  timeout_ms: number
  max_tokens: number
  fallback: "metadata" | "passthrough" | "error"
  prompt?: string
  cache_ttl_seconds: number
}

export interface FileUploadConfig {
  max_file_size: number
  allowed_types: string[]
  max_embedded_images: number
  enable_vision_analysis: boolean
  max_file_tokens: number
}

export interface CompanionConfig {
  port: number
  llm: {
    base_url: string
    api_key: string
    model_name: string
    temperature: number
    context_window: number
  }
  vision?: VisionConfig
  trusted_domains: string[]
  /**
   * Domains (with wildcard support, same matcher as trusted_domains) for which
   * high-risk tool confirmations are skipped. Distinct from trusted_domains,
   * which gates cookie/data access only — auto_approved_domains governs tool
   * execution confirmations (evaluate, navigate, etc.).
   */
  auto_approved_domains: string[]
  history_retention_days: number
  security: SecurityConfig
  file_upload?: FileUploadConfig
  mcp?: McpConfig
  obsidian?: ObsidianExportConfig
}

function getEnvApiKey(): string {
  return process.env.DEEPSEEK_API_KEY || ""
}

const defaultConfig: CompanionConfig = {
  port: 23401,
  llm: {
    base_url: "https://api.deepseek.com/v1",
    api_key: getEnvApiKey(),
    model_name: "deepseek-v4-flash",
    temperature: 0.7,
    context_window: 1000000,
  },
  vision: {
    enabled: false,
    base_url: "http://localhost:11434/v1",
    api_key: "ollama",
    model_name: "llava:7b",
    timeout_ms: 30000,
    max_tokens: 1024,
    fallback: "metadata",
    cache_ttl_seconds: 300,
  },
  trusted_domains: [],
  auto_approved_domains: [],
  history_retention_days: 30,
  security: {
    safety_skills_enabled: ["prompt-injection-defense", "jailbreak-detection", "instruction-hierarchy"],
    auto_confirm_same_thread: false,
    confirmation_timeout_seconds: 45,
    auto_approve_dangerous: false,
  },
  file_upload: {
    max_file_size: 10 * 1024 * 1024,
    allowed_types: [
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "text/plain",
      "text/markdown",
      "text/csv",
      "text/html",
      "application/rtf",
      "application/vnd.oasis.opendocument.text",
    ],
    max_embedded_images: 20,
    enable_vision_analysis: true,
    max_file_tokens: 50000,
  },
  mcp: {
    enabled: false,
    servers: {},
  },
  obsidian: {
    name_template: "{{date}} {{first_user_line}}",
    default_frontmatter: { tags: ["cmspark"] },
    vault_path: null,
  },
}

let cachedConfig: CompanionConfig | null = null

/** Clear the in-memory config cache. Intended for tests only. */
export function clearConfigCache(): void {
  cachedConfig = null
}

export async function initDataDir(): Promise<void> {
  const dirs = [
    DATA_DIR,
    path.join(DATA_DIR, "skills"),
    path.join(DATA_DIR, "builtin-skills"),
    path.join(DATA_DIR, "threads"),
    path.join(DATA_DIR, "logs"),
    path.join(DATA_DIR, "cache"),
    path.join(DATA_DIR, "knowledge", "global"),
    path.join(DATA_DIR, "knowledge", "sites"),
    path.join(DATA_DIR, "builtin-skills", "security"),
    path.join(DATA_DIR, "mcp"),
    path.join(DATA_DIR, "mcp", "logs"),
    path.join(DATA_DIR, "obsidian"),
  ]
  for (const dir of dirs) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  }

  // Ensure data directory itself has restricted permissions
  try {
    fs.chmodSync(DATA_DIR, 0o700)
  } catch {
    // Ignore if we don't have permission to chmod
  }

  const configPath = path.join(DATA_DIR, "config.json")
  if (!fs.existsSync(configPath)) {
    fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2))
  }

  // Copy builtin skills if they don't exist
  const builtinSkillsSrc = getBuiltinSkillsSrc()
  const builtinSkillsDest = path.join(DATA_DIR, "builtin-skills")
  if (fs.existsSync(builtinSkillsSrc)) {
    for (const file of fs.readdirSync(builtinSkillsSrc)) {
      const dest = path.join(builtinSkillsDest, file)
      if (file.endsWith(".md")) {
        fs.copyFileSync(path.join(builtinSkillsSrc, file), dest)
      }
    }
  }
}

// H4 (audit): a truncated/garbage config.json must NOT silently reset to defaults (that would
// wipe llm.api_key / trusted_domains / mcp servers with zero signal). Validate the root is a
// JSON object; on any parse/validation failure the caller preserves the corrupt file for
// inspection and logs loudly, then falls back to defaults so the companion still starts.
function loadConfigFile(configPath: string): CompanionConfig {
  let raw: string
  try {
    raw = fs.readFileSync(configPath, "utf-8")
  } catch {
    // Deep-clone (not shallow spread): getConfig() mutates `cachedConfig.llm.api_key` with the
    // env var, and a shallow `{...defaultConfig}` would alias the nested `llm`/`security` objects
    // and let that mutation leak into `defaultConfig` itself.
    return structuredClone(defaultConfig) // file doesn't exist yet — normal first-run path
  }
  const parsed = JSON.parse(raw) // throws on truncated/garbage JSON
  // Reject non-object roots (e.g. a bare `[1,2,3]`, `"string"`, `42`, `null`) that would
  // otherwise be silently deep-merged into garbage. (Full field-level zod schema is future work.)
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("config root is not a JSON object")
  }
  return deepMerge(defaultConfig, parsed) as CompanionConfig
}

export function getConfig(): CompanionConfig {
  if (cachedConfig) {
    // Refresh env var ONLY if no user-provided key exists
    if (getEnvApiKey() && !isUserProvidedApiKey(cachedConfig.llm.api_key)) {
      cachedConfig.llm.api_key = getEnvApiKey()
    }
    return cachedConfig
  }
  const configPath = path.join(DATA_DIR, "config.json")
  try {
    cachedConfig = loadConfigFile(configPath)
  } catch (err: any) {
    // Corrupt config: preserve it for inspection + log loudly, then use defaults so the
    // companion still starts. Previously this was a silent reset that wiped keys/domains.
    const backup = `${configPath}.corrupt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    console.error(
      `[cmspark-agent] config.json corrupt/unreadable — backing up to ${path.basename(backup)} and starting with defaults. Cause: ${err?.message || err}`,
    )
    try { fs.renameSync(configPath, backup) } catch { /* best-effort preservation */ }
    cachedConfig = structuredClone(defaultConfig)
  }
  // Environment variable takes priority ONLY when no user-provided key exists.
  // If the file has a user-provided API key (non-empty, not masked), respect it.
  if (getEnvApiKey() && !isUserProvidedApiKey(cachedConfig.llm.api_key)) {
    cachedConfig.llm.api_key = getEnvApiKey()
  }
  // Ensure mcp config exists with sane defaults (older config.json may not have it)
  if (!cachedConfig.mcp) {
    cachedConfig.mcp = { enabled: false, servers: {} }
  }
  return cachedConfig
}

/**
 * Replace the entire `mcp.servers` map. Unlike saveConfig's deepMerge (which would
 * preserve stale server entries), this performs a wholesale swap so removed servers
 * actually disappear from the persisted config. Triggers CONFIG_CHANGE_EVENT.
 */
export function replaceMcpServers(servers: McpConfig["servers"]): CompanionConfig {
  const current = getConfig()
  const mcp: McpConfig = {
    enabled: current.mcp?.enabled ?? false,
    servers: { ...servers },
  }
  return saveConfig({ mcp })
}

/**
 * Set the MCP-enabled flag without touching the servers map.
 */
export function setMcpEnabled(enabled: boolean): CompanionConfig {
  const current = getConfig()
  const mcp: McpConfig = {
    enabled,
    servers: current.mcp?.servers ?? {},
  }
  return saveConfig({ mcp })
}

/**
 * Check if an API key is masked (i.e., a placeholder like "***" or "sk-****xyz").
 * This prevents accidentally overwriting a real key with a masked placeholder.
 *
 * A masked key matches the output of `maskApiKey()` in settings-web.ts:
 * - short keys (<= 8 chars) become "***"
 * - longer keys become prefix(4) + "****" + suffix(4), total length >= 12
 *
 * Also accepts "...." dot-masking used by some UIs.
 */
export function isMaskedApiKey(key: string | undefined | null): boolean {
  if (!key || typeof key !== "string") return false
  if (key === "***") return true
  // Any occurrence of 4+ consecutive asterisks indicates masking.
  // Covers maskApiKey() output (prefix(4) + "****" + suffix(4)) as well as
  // shorter UI forms like "sk-****xyz".
  if (key.includes("****")) return true
  // Some UIs use dots instead of asterisks
  if (key.includes("....") && key.length >= 10) return true
  return false
}

/**
 * Check if an API key is explicitly provided by the user (not from env var).
 * A user-provided key should be persisted to disk, while env var keys should not.
 */
function isUserProvidedApiKey(key: string | undefined): boolean {
  if (!key || typeof key !== "string") return false
  // If it's a masked placeholder, it's not a real user-provided key
  if (isMaskedApiKey(key)) return false
  const envKey = getEnvApiKey()
  return !envKey || key !== envKey
}

/**
 * Resolve which API key should be kept when saving config.
 *
 * Priority:
 * 1. New, non-masked key provided by the caller
 * 2. Current user-provided key (not masked, not from env)
 * 3. Environment variable key (if provided)
 *
 * Returns undefined when no preference exists, letting the caller keep the
 * deepMerge result unchanged.
 */
function resolveApiKey(
  callerKey: string | undefined,
  currentKey: string | undefined,
  envKey: string | undefined,
): string | undefined {
  if (callerKey && !isMaskedApiKey(callerKey)) {
    return callerKey
  }
  if (currentKey && !isMaskedApiKey(currentKey)) {
    if (!envKey || currentKey !== envKey) {
      return currentKey
    }
  }
  if (envKey) {
    return envKey
  }
  return undefined
}

export function saveConfig(config: Partial<CompanionConfig>): CompanionConfig {
  // Warn when '*' is used as a trusted domain (global wildcard)
  if (config.trusted_domains?.includes("*")) {
    console.warn("[cmspark-agent] WARNING: '*' wildcard trusted domain — all cookie access is allowed. Use only for development.")
  }
  // Warn when '*' is used as an auto-approved domain — this disables the
  // dangerous-tool confirmation gate for EVERY domain. Distinct from
  // trusted_domains (cookie/data access): this gate covers evaluate, navigate,
  // and friends, so '*' here is strictly more dangerous.
  if (config.auto_approved_domains?.includes("*")) {
    console.warn("[cmspark-agent] WARNING: '*' wildcard in auto_approved_domains — all dangerous tool calls (evaluate, navigate, etc.) will be auto-approved on EVERY domain. Prefer listing specific hostnames or use '*.example.com' for subdomain scope.")
  }
  // Heuristic TLD-wildcard detection: patterns like '*.com' or '*.cn' auto-
  // approve every domain under a public suffix. We can't ship the full PSL
  // list, so we approximate by flagging '*.X' where X has no further dots.
  // '*.co.uk' / '*.com.cn' won't be caught by this heuristic — power users
  // editing config.json should mind that.
  const tldWildcardPattern = /^\s*\*\.[^.]+\s*$/
  if (config.auto_approved_domains?.some(p => typeof p === "string" && tldWildcardPattern.test(p))) {
    console.warn("[cmspark-agent] WARNING: TLD-level wildcard in auto_approved_domains (e.g. '*.com', '*.cn') — auto-approves an entire TLD. Prefer '*.example.com' (with a registered domain label) for subdomain scope.")
  }
  // Warn when dangerous auto-approve is enabled — it bypasses the human-in-the-loop gate.
  if (config.security?.auto_approve_dangerous === true) {
    console.warn("[cmspark-agent] WARNING: security.auto_approve_dangerous is enabled — all dangerous tool calls will be auto-approved without user confirmation. Use only for trusted unattended workflows.")
  }
  const current = getConfig()
  const updated = deepMerge(current, config) as CompanionConfig

  // Resolve LLM and vision API keys using the same priority rules.
  // Note: vision has no env-var equivalent, so envKey is undefined for it.
  const envKey = getEnvApiKey()
  const resolvedLlmKey = resolveApiKey(config.llm?.api_key, current.llm.api_key, envKey)
  if (resolvedLlmKey !== undefined) {
    updated.llm.api_key = resolvedLlmKey
  }
  if (updated.vision) {
    const resolvedVisionKey = resolveApiKey(config.vision?.api_key, current.vision?.api_key, undefined)
    if (resolvedVisionKey !== undefined) {
      updated.vision.api_key = resolvedVisionKey
    }
  }

  const configPath = path.join(DATA_DIR, "config.json")
  // Save to file with api_key masked (don't persist the env var to disk)
  const toSave = JSON.parse(JSON.stringify(updated))
  // Only mask the LLM API key if it matches the env var (don't leak env to disk)
  // If the user provided a different key, persist it
  if (envKey && toSave.llm?.api_key === envKey) {
    toSave.llm.api_key = ""  // Don't write env var to disk
  }
  // H3 (audit): atomic write (tmp + rename) so a crash mid-save can't leave a truncated
  // config.json (which the H4 load path would then treat as corrupt). mode 0o600 — holds api_key.
  atomicWriteJSON(configPath, toSave)
  cachedConfig = updated
  configEvents.emit(CONFIG_CHANGE_EVENT, updated)
  return updated
}

function deepMerge(target: any, source: any): any {
  const result = { ...target }
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === "object" && !Array.isArray(source[key])) {
      result[key] = deepMerge(target[key] || {}, source[key])
    } else {
      result[key] = source[key]
    }
  }
  return result
}

export function getConfigDir(): string {
  return DATA_DIR
}

export function getLogDir(): string {
  return path.join(DATA_DIR, "logs")
}

export function getLockFilePath(): string {
  return getLockPath()
}

export function getPidFilePath(): string {
  return path.join(DATA_DIR, "daemon.pid")
}

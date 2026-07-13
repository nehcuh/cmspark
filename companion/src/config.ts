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
  /**
   * GOD-MODE. When true, bypasses Layer 1 FULLY and Layer 2 PARTIALLY:
   *   - Layer 1 (scheme hard-block): non-http(s) schemes (javascript:, data:,
   *     about:, file:, chrome:) are permitted for navigate / create_tab /
   *     set_tab_url. (Fully bypassed.)
   *   - Layer 2 (confirmation gate): evaluate / osascript_eval / untrusted-
   *     domain navigation skip the human-in-the-loop dialog — EXCEPT the
   *     never-auto CRITICAL_API_GATE subset (exfil + sandbox-escape APIs:
   *     fetch / eval / Function / ...) and the analyze_image IMAGE_FETCH_GATE,
   *     which STILL require confirmation even under god-mode (§6.1.5 / §6.2).
   * Strictly stronger than auto_approve_dangerous (which bypasses Layer 2 only
   * and likewise does NOT bypass the critical / image gates). The field NAME
   * describes the Layer 1 effect; each gate's code comment must make the Layer 2
   * effect explicit. Defaults to false. Enabling is intended for fully-trusted,
   * user-supervised power workflows — a prompt-injected agent can otherwise
   * drive the browser to any scheme and run non-critical dangerous code with
   * no human check.
   */
  allow_all_schemes: boolean
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
  log_retention_days: number
  log_max_file_mb: number
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
  log_retention_days: 14,
  log_max_file_mb: 10,
  security: {
    safety_skills_enabled: ["prompt-injection-defense", "jailbreak-detection", "instruction-hierarchy"],
    auto_confirm_same_thread: false,
    confirmation_timeout_seconds: 45,
    auto_approve_dangerous: false,
    allow_all_schemes: false,
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
    fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2), { mode: 0o600 })
  }
  // P0-3 (audit H1): tighten config.json to owner-only — it holds llm.api_key / vision.api_key.
  // Covers newly-created files (mode above) AND pre-existing ones (previously 0o644 because
  // writeFileSync had no mode arg). Mirrors history.db 0o600 in history/store.ts.
  try { fs.chmodSync(configPath, 0o600) } catch { /* best-effort */ }

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

  // M8: prune stale log files after directories exist so retention never blocks startup.
  try {
    const { pruneOldLogs } = await import("./log-rotation")
    pruneOldLogs()
  } catch { /* best-effort */ }
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
  // Warn when GOD-MODE is enabled — it bypasses Layer 1 (URL-scheme hard-block:
  // any non-http(s) scheme, e.g. javascript:/data:/about:/file:/chrome:) fully,
  // and Layer 2 (confirmation gate) for NON-critical dangerous tool calls +
  // untrusted-domain navigation. The CRITICAL_API_GATE (exfil/escape APIs) and
  // the analyze_image IMAGE_FETCH_GATE STILL require confirmation under god-mode
  // (§6.1.5 / §6.2). Strictly stronger than auto_approve_dangerous.
  if (config.security?.allow_all_schemes === true) {
    console.warn("[cmspark-agent] WARNING: security.allow_all_schemes (GOD-MODE) is enabled — bypasses the URL-scheme hard-block (any non-http(s) scheme, e.g. javascript:/data:/about:/file:/chrome:) AND the confirmation gate for NON-critical dangerous tool calls / untrusted-domain navigation. CRITICAL exfil/escape APIs (fetch/eval/Function/...) and analyze_image fetch STILL require confirmation (§6.1.5/§6.2). A prompt-injected agent can drive the browser to any scheme and run non-critical dangerous code with no human check. Use only for fully-trusted, supervised workflows.")
  }
  // ── H5 invariant: saveConfig is SYNCHRONOUS by design ──────────────────
  // The read-modify-write below (getConfig → deepMerge → atomicWriteJSON) has
  // no `await` anywhere, and atomicWriteJSON is writeFileSync+renameSync+chmodSync
  // (all synchronous). Under Node's single-threaded event loop this means the
  // whole body runs to completion before any other code — two saveConfig calls
  // CANNOT interleave, and a caller like server.ts's whitelist append (which
  // reads auto_approved_domains then writes the full array) is race-free as
  // long as it does not await between its read and its saveConfig call.
  //
  // The 2026-07-09 audit (H5) proposed a promise-queue mutex here; that would
  // be a no-op, because there is no yield point to serialize. Instead this
  // invariant is locked in by tests/config.test.ts ("H5: saveConfig is
  // synchronous + atomic read-modify-write"). DO NOT introduce an `await`
  // (e.g. switching to fs.promises, or a better-sqlite3 async path) in this
  // function without first adding serialization — otherwise the whitelist
  // append and concurrent settings writes will silently lose data.
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
  // (Supersedes the P0-3 writeFileSync+chmod: atomicWriteJSON already does atomic + 0o600 + chmod
  // internally — merged from PR #13.)
  atomicWriteJSON(configPath, toSave)
  cachedConfig = updated
  configEvents.emit(CONFIG_CHANGE_EVENT, updated)
  return updated
}

/**
 * Deprecated DeepSeek chat model ids and their V4 successors.
 *
 * Per the official DeepSeek API changelog (2026-04-24), `deepseek-chat` and
 * `deepseek-reasoner` are retired on 2026-07-24 15:59 UTC. During the transition
 * BOTH legacy names resolve to `deepseek-v4-flash` (chat = non-thinking mode,
 * reasoner = thinking mode) — so `deepseek-v4-flash` is the behavior-preserving
 * target and also CMspark's default. Users who want the higher-tier model can set
 * `deepseek-v4-pro` manually.
 */
const DEPRECATED_MODEL_MAP: Readonly<Record<string, string>> = {
  "deepseek-chat": "deepseek-v4-flash",
  "deepseek-reasoner": "deepseek-v4-flash",
}

export interface ModelMigration {
  migrated: boolean
  from?: string
  to?: string
}

/**
 * Migrate a deprecated DeepSeek chat model id to its V4 successor.
 *
 * If the configured `llm.model_name` is a legacy id, rewrite it in place via the
 * atomic saveConfig path (H3: tmp+rename, 0o600) so a legacy config keeps working
 * past the 2026-07-24 retirement without a hard break, and return what changed so
 * the caller can log it. Idempotent — a no-op once the model is already a V4 id.
 * Only EXACT-match legacy ids are rewritten; custom/other models (and the higher-
 * tier `deepseek-v4-pro`) are left untouched. Only `llm.model_name` is touched —
 * api_key / trusted_domains / everything else is preserved (deepMerge + the spread
 * below). Runs at startup before the model-validity probe (server.ts startServer)
 * so the probe validates the migrated name.
 */
export function migrateLegacyModelName(): ModelMigration {
  const cfg = getConfig()
  const target = DEPRECATED_MODEL_MAP[cfg.llm.model_name]
  if (!target) return { migrated: false }
  // Spread the full llm block (type-safe, no cast) and override only model_name;
  // saveConfig deep-merges against the latest cached state and re-resolves the api
  // key (env keys are still masked on disk), so nothing but model_name changes.
  saveConfig({ llm: { ...cfg.llm, model_name: target } })
  return { migrated: true, from: cfg.llm.model_name, to: target }
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

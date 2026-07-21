// Companion configuration management

import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import { EventEmitter } from "events"
import { getLockPath } from "./platform"
import { getBuiltinSkillsSrc } from "./paths"
import { atomicWriteJSON } from "./io"
import type { McpConfig } from "./mcp/types"
import { sanitizeAppEntries, type AppsConfig } from "./apps/types"
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

export interface ComputerConfig {
  /** A10 global switch — default false. Coordinate tools fail-closed when off. */
  coordinateEnabled: boolean
  /** Per-task action budget ceiling override (default 15, max 30). */
  budget?: number
  /**
   * WP5 模型下载镜像主机（https only，仅 origin 生效——镜像可配主机、哈希不可配，
   * W3 §5.2）。缺省 = manifest 占位主机（owner 定 host 前默认禁网）。
   */
  modelMirror?: string
  /** WP5 模型目录磁盘预算（MB，默认 2048；下载前检查，防塞盘 DoS）。 */
  modelDiskBudgetMB?: number
  /**
   * WP5-I4 实验层用户开关（默认 false）。true = 允许 admission 组装 locator
   * （还需 license 已接受 + 未熔断 + 磁盘复验通过）。开启走生物识别门
   * （D2，apps coordinateAllowed 先例）；手改 config.json = 显式 owner
   * opt-in（ADR-010，同 coordinateEnabled 先例），启动期打醒目 loud log（P9）。
   */
  modelEnabled?: boolean
  /** WP5-I4 许可证接受时间戳（ISO 字符串；license_response accepted:true 写入）。 */
  modelLicenseAcceptedAt?: string
  /**
   * WP5-I4 许可证接受时 LICENSE_DOOR_TEXT 的 sha256 前 12 位（P1：接受记录
   * 绑定文本版本——条款文本漂移（哈希不符）→ enable/admission 重新弹门）。
   */
  modelLicenseAcceptedTextHash?: string
  /**
   * WP5-I4 许可证已拒绝（默认 false）。true → set_enabled(true) 恒返
   * LICENSE_DECLINED（永久跳过；复位 = 手改 config.json，不提供 UI 复位）。
   */
  modelLicenseDeclined?: boolean
  /**
   * WP5-I4 交付变体（默认 "hybrid"）。无 WS setter/无 UI 选择器——切换路径
   * = 手改 config.json + 重启 companion（裁决 4/P3，ADR-010 方式 B 同型）。
   */
  modelVariant?: "hybrid" | "int8"
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
  apps?: AppsConfig
  /**
   * Coordinate computer-use (A10 default-deny). coordinateEnabled is the
   * GLOBAL kill-switch for host_computer: default false; enabling goes through
   * the biometric gate (computer/handlers.ts) — a hand-edited config.json is
   * treated as explicit owner opt-in (ADR-010), same as god-mode.
   */
  computer?: ComputerConfig
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
  apps: {
    enabled: true,
    entries: {},
  },
  computer: {
    coordinateEnabled: false,
    // WP5-I4 实验层默认形：开关默认关、许可证未拒绝、变体默认 hybrid。
    modelEnabled: false,
    modelLicenseDeclined: false,
    modelVariant: "hybrid",
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
  // Ensure apps config exists with sane defaults (older config.json may not have
  // it), then validate + normalize entries on load: direct config.json edits follow
  // ADR-010 tampering semantics (design §6) — unknown policy → "manual", schema
  // failure → entry disabled, policy clamped to the signer/user-writable cap —
  // and must never crash startup (H4 philosophy). Runs once per cache miss, so
  // tamper logs are not re-emitted on every getConfig() call.
  if (!cachedConfig.apps) {
    cachedConfig.apps = { enabled: true, entries: {} }
  }
  cachedConfig.apps.entries = sanitizeAppEntries(cachedConfig.apps.entries)
  // Ensure computer block exists (A10 default-deny: absent/false = off). A
  // non-boolean hand-edit coerces to false with a loud log — the flag may only
  // be TRUE by explicit owner action (gated UI write or deliberate file edit).
  if (!cachedConfig.computer || typeof cachedConfig.computer !== "object") {
    cachedConfig.computer = { coordinateEnabled: false }
  }
  if (typeof cachedConfig.computer.coordinateEnabled !== "boolean") {
    console.error(
      `[cmspark-agent] computer.coordinateEnabled is not a boolean — coercing to false (config tampering?)`,
    )
    cachedConfig.computer.coordinateEnabled = false
  }
  // WP5 模型下载字段（ADR-010 normalize 惯例）：非法值 coerce 为未配置/默认并 loud
  // log——手改 config 不得绕过镜像 https 约束或关闭磁盘预算。scheme 白名单本身在
  // resolveDownloadUrl 下载时强制执行（这里只保证类型），双层防线。
  if (cachedConfig.computer.modelMirror !== undefined) {
    const v = cachedConfig.computer.modelMirror
    if (typeof v !== "string" || v.trim() === "") {
      console.error(
        `[cmspark-agent] computer.modelMirror 非法（须为非空 https 主机字符串）——按未配置处理 (config tampering?)`,
      )
      delete cachedConfig.computer.modelMirror
    }
  }
  if (cachedConfig.computer.modelDiskBudgetMB !== undefined) {
    const v = cachedConfig.computer.modelDiskBudgetMB
    if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) {
      console.error(
        `[cmspark-agent] computer.modelDiskBudgetMB 非法（须为正数 MB）——回退默认 2048 (config tampering?)`,
      )
      delete cachedConfig.computer.modelDiskBudgetMB
    }
  }
  // WP5-I4 WI-4.1 实验层五字段 normalize（ADR-010 惯例；只防篡改形状，不撤销
  // 合法布尔——手改 config.json = 显式 owner opt-in，裁决 3）。
  if (cachedConfig.computer.modelEnabled !== undefined && typeof cachedConfig.computer.modelEnabled !== "boolean") {
    console.error(
      `[cmspark-agent] computer.modelEnabled 非布尔——coerce false (config tampering?)`,
    )
    cachedConfig.computer.modelEnabled = false
  }
  cachedConfig.computer.modelEnabled = cachedConfig.computer.modelEnabled === true
  if (cachedConfig.computer.modelLicenseDeclined !== undefined && typeof cachedConfig.computer.modelLicenseDeclined !== "boolean") {
    console.error(
      `[cmspark-agent] computer.modelLicenseDeclined 非布尔——coerce false (config tampering?)`,
    )
    cachedConfig.computer.modelLicenseDeclined = false
  }
  cachedConfig.computer.modelLicenseDeclined = cachedConfig.computer.modelLicenseDeclined === true
  if (cachedConfig.computer.modelLicenseAcceptedAt !== undefined) {
    const v = cachedConfig.computer.modelLicenseAcceptedAt
    if (typeof v !== "string" || v.trim() === "" || Number.isNaN(Date.parse(v))) {
      console.error(
        `[cmspark-agent] computer.modelLicenseAcceptedAt 非法（须为 ISO 时间戳字符串）——按未接受处理 (config tampering?)`,
      )
      delete cachedConfig.computer.modelLicenseAcceptedAt
    }
  }
  // P1：文本版本绑定哈希——形状非法即 delete（比对漂移重门在 enable/admission 侧）。
  if (cachedConfig.computer.modelLicenseAcceptedTextHash !== undefined) {
    const v = cachedConfig.computer.modelLicenseAcceptedTextHash
    if (typeof v !== "string" || !/^[0-9a-f]{12}$/.test(v)) {
      console.error(
        `[cmspark-agent] computer.modelLicenseAcceptedTextHash 非法（须为 sha256 前 12 位小写 hex）——按未接受处理 (config tampering?)`,
      )
      delete cachedConfig.computer.modelLicenseAcceptedTextHash
    }
  }
  if (cachedConfig.computer.modelVariant !== undefined && cachedConfig.computer.modelVariant !== "hybrid" && cachedConfig.computer.modelVariant !== "int8") {
    console.error(
      `[cmspark-agent] computer.modelVariant 非法（须为 "hybrid"|"int8"）——回退 hybrid (config tampering?)`,
    )
    cachedConfig.computer.modelVariant = "hybrid"
  }
  cachedConfig.computer.modelVariant = cachedConfig.computer.modelVariant ?? "hybrid"
  // P9：实验层开启态的启动期醒目 loud log——本路径每 cache-miss（≈进程启动）
  // 只跑一次，不刷屏；合法布尔不撤销、不阻断，仅明示（god-mode 方式 B WARNING
  // 先例，ADR-010:73）。I4 对抗 P5：持久化 config 无法区分「设置页经门开启」
  // 与「手改 opt-in」两源——文案不过归因，如实并陈。
  if (cachedConfig.computer.modelEnabled === true) {
    console.error(
      `[cmspark-agent] WARNING: computer.modelEnabled=true —— TinyClick 实验层处于开启状态（设置页经门开启 或 手改 config.json opt-in 皆可达此态，持久化配置不区分来源；ADR-010 显式 owner opt-in，同 god-mode 方式 B）。本层未校准，命中仍必经人工确认；关闭请置 false 或经设置页。`,
    )
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
  // Bypass deepMerge for the servers map: deepMerge(target.servers, source.servers)
  // preserves keys when source.servers is {} (empty object has no keys to overwrite).
  // We build the full config object explicitly so the atomic write is exact.
  const updated: CompanionConfig = {
    ...current,
    mcp: {
      enabled: current.mcp?.enabled ?? false,
      servers: { ...servers },
    },
  }
  const configPath = path.join(DATA_DIR, "config.json")
  const toSave = JSON.parse(JSON.stringify(updated))
  const envKey = getEnvApiKey()
  if (envKey && toSave.llm?.api_key === envKey) {
    toSave.llm.api_key = ""
  }
  atomicWriteJSON(configPath, toSave)
  cachedConfig = updated
  configEvents.emit(CONFIG_CHANGE_EVENT, updated)
  return updated
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
 * Replace the entire `apps.entries` map. Mirrors replaceMcpServers: unlike
 * saveConfig's deepMerge (which would preserve stale entries), this performs a
 * wholesale swap so removed apps actually disappear from the persisted config.
 * Triggers CONFIG_CHANGE_EVENT. Validation/normalization of entries is the
 * caller's job (mirrors mcp.add → validateMcpServerConfig → replaceMcpServers);
 * the getConfig() load path re-sanitizes whatever lands on disk.
 */
export function replaceAppsEntries(entries: AppsConfig["entries"]): CompanionConfig {
  const current = getConfig()
  const updated: CompanionConfig = {
    ...current,
    apps: {
      enabled: current.apps?.enabled ?? true,
      entries: { ...entries },
    },
  }
  const configPath = path.join(DATA_DIR, "config.json")
  const toSave = JSON.parse(JSON.stringify(updated))
  const envKey = getEnvApiKey()
  if (envKey && toSave.llm?.api_key === envKey) {
    toSave.llm.api_key = ""
  }
  atomicWriteJSON(configPath, toSave)
  cachedConfig = updated
  configEvents.emit(CONFIG_CHANGE_EVENT, updated)
  return updated
}

/**
 * A10 — flip the global coordinate computer-use switch without touching any
 * other config. Callers must run the biometric gate BEFORE enabling
 * (computer/handlers.ts); disabling is always free (fail-closed direction).
 */
export function setComputerCoordinateEnabled(enabled: boolean): CompanionConfig {
  const current = getConfig()
  const updated: CompanionConfig = {
    ...current,
    computer: {
      ...(current.computer ?? {}),
      coordinateEnabled: enabled === true,
    },
  }
  const configPath = path.join(DATA_DIR, "config.json")
  const toSave = JSON.parse(JSON.stringify(updated))
  const envKey = getEnvApiKey()
  if (envKey && toSave.llm?.api_key === envKey) {
    toSave.llm.api_key = ""
  }
  atomicWriteJSON(configPath, toSave)
  cachedConfig = updated
  configEvents.emit(CONFIG_CHANGE_EVENT, updated)
  return updated
}

/**
 * WP5-I4 WI-4.2：实验层四字段原子写入（model-handlers 四 case 唯一持久化通道，
 * setComputerCoordinateEnabled 先例）。只允许白名单键；调用方负责语义
 * （license_response 写时间戳+文本哈希；set_enabled 写 modelEnabled）。
 */
export function setComputerModelFields(
  patch: Partial<
    Pick<
      ComputerConfig,
      "modelEnabled" | "modelLicenseAcceptedAt" | "modelLicenseAcceptedTextHash" | "modelLicenseDeclined"
    >
  >,
): CompanionConfig {
  const current = getConfig()
  const updated: CompanionConfig = {
    ...current,
    computer: {
      ...(current.computer ?? { coordinateEnabled: false }),
      ...patch,
      coordinateEnabled: current.computer?.coordinateEnabled === true,
    },
  }
  const configPath = path.join(DATA_DIR, "config.json")
  const toSave = JSON.parse(JSON.stringify(updated))
  const envKey = getEnvApiKey()
  if (envKey && toSave.llm?.api_key === envKey) {
    toSave.llm.api_key = ""
  }
  atomicWriteJSON(configPath, toSave)
  cachedConfig = updated
  configEvents.emit(CONFIG_CHANGE_EVENT, updated)
  return updated
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

const PROTOTYPE_POLLUTION_KEYS = new Set(["__proto__", "constructor", "prototype"])

function deepMerge(target: any, source: any): any {
  const result = { ...target }
  for (const key of Object.keys(source)) {
    if (PROTOTYPE_POLLUTION_KEYS.has(key)) continue
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

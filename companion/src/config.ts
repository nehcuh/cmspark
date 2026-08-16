// Companion configuration management

import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import { EventEmitter } from "events"
import { getLockPath } from "./platform"
import { getBuiltinSkillsSrc } from "./paths"
import { atomicWriteJSON } from "./io"
import type { McpConfig, McpServerConfig } from "./mcp/types"
import { defaultFilesystemServerConfig } from "./mcp/filesystem-home"
import { sanitizeAppEntries, type AppsConfig } from "./apps/types"
import type { ObsidianExportConfig } from "./threads/markdown-export"
import { resolveInheritedVisionApiKey } from "./llm/vision-reuse-inherit"

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
   *     fetch / eval / Function / ...). Alone (this flag only), analyze_image
   *     IMAGE_FETCH still requires confirmation. **Three-flag full-autonomy
   *     cruise** (dangerous + enterprise + allow_all_schemes) = risk accepted:
   *     waives image-fetch confirm and allows file:// image pull; still hard-
   *     blocks suspected SSRF (cloud metadata / javascript:).
   * Strictly stronger than auto_approve_dangerous for navigation schemes.
   * Defaults to false. Enabling is intended for fully-trusted, user-supervised
   * power workflows.
   */
  allow_all_schemes: boolean
  /**
   * Plan B: skip interactive L2 for shell_exec / netsec_port_scan only after
   * module + allowlist/task-auth (or shell policy) scope passes. Does NOT skip
   * spawn_worker, host_computer critical, MCP critical, or evaluate critical APIs.
   * Default false.
   */
  /** Plan B — optional for deepMerge; default false in DEFAULT_CONFIG. */
  auto_approve_enterprise_tools?: boolean
  /**
   * Basenames (no extension, lowercased) of the companion's OWN UI host
   * processes — the browser that renders the sidepanel, plus the packaged
   * companion binary. When the computer-use FOREGROUND-YIELD detector finds
   * the foreground was taken over by one of these (the user just clicked
   * "Allow" in the sidepanel, so the browser briefly became frontmost), the
   * executor silently re-raises the target window and continues instead of
   * pausing for a redundant re-L2. Matching is by basename only (multiple
   * Chrome windows share one exe), so this is a UX heuristic, NOT a security
   * boundary — the initial task L2 still gates every task. Defaults cover the
   * browsers CMspark supports plus the packaged agent exe.
   */
  companion_ui_exe_basenames: string[]
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
   * LICENSE_DECLINED（跳过；设置页可 reset_decline 复位）。
   */
  modelLicenseDeclined?: boolean
  /**
   * 实验层模型变体（Qwen3-VL）。默认 "2b"；可选 "4b" | "8b"。
   * 设置页可切换（computer.model.set_variant）；旧 hybrid/int8 启动时迁为 2b。
   */
  modelVariant?: "2b" | "4b" | "8b" | "hybrid" | "int8"
  /**
   * 模型下载源。auto=连通性探测（大陆常落 ModelScope）；
   * huggingface / hf-mirror / modelscope 为显式选择。
   */
  modelDownloadSource?: "auto" | "huggingface" | "hf-mirror" | "modelscope"
  /**
   * Absolute directory for model weights (contains qwen3-vl-2b/ …).
   * Default: ~/.cmspark-agent/models. User-selectable via Settings.
   */
  modelRootDir?: string
  /**
   * Python 使用方式：
   * - isolated（默认）：CMspark 独立虚拟环境 ~/.cmspark-agent/python-env
   * - system：本机全局 / 用户指定的 Python
   */
  pythonMode?: "isolated" | "system"
  /** mode=system 时可选的绝对 python 路径 */
  pythonPath?: string
  /** 若本机有 uv，创建/安装独立环境时优先使用（默认 true） */
  pythonPreferUv?: boolean
}

/**
 * Path B local STT (ADR-023) — Companion owns engine + active model + whisper disk budget.
 * Separate from computer.model* (Qwen); default engine is browser (no auto-download).
 */
export interface VoiceConfig {
  /** Default browser. Companion SoT (ADR-023 L1). */
  sttEngine: "browser" | "local"
  /** Active model when engine=local; may be set only if ready (handlers enforce). */
  localModelId: "small" | "medium" | "large-v3-turbo"
  /** Whisper family disk budget MB (default 4096; scoped to whisper root only). */
  modelDiskBudgetMB: number
  /** Optional override root; default DATA_DIR/models/whisper. */
  modelRootDir?: string
}

/** Wire protocol for chat completions. Default "openai". */
export type LlmProtocol = "openai" | "anthropic"

/**
 * Auth header style. "auto" (default) → openai: Bearer, anthropic: x-api-key.
 * Override only when a gateway documents otherwise.
 */
export type LlmAuthStyle = "auto" | "bearer" | "x-api-key"

/**
 * Client identity header profile for third-party Coding Plan gateways.
 * Default "none". "claude_code_compat" injects documented gateway-compat headers
 * (UA / x-app). NEVER allowed on first-party Anthropic hosts (L7).
 */
export type LlmClientHeaderProfile = "none" | "claude_code_compat"

/** Runtime context budget mode (settings-thread-compact). Default auto when dual-truth chip ships. */
export type ContextCompactionMode = "auto" | "prompt" | "off"

export interface LlmConfig {
  base_url: string
  api_key: string
  model_name: string
  temperature: number
  context_window: number
  /**
   * Request-path context budget: auto=compact when over budget; prompt=warn only (no drop);
   * off=never compact. Omitted on disk → deepMerge fills "auto".
   */
  context_compaction?: ContextCompactionMode
  /**
   * M2: after M1 head-drop, optionally LLM-summarize dropped region (redacted).
   * Default false until stable. Request-only; never writes summary into disk messages.
   */
  context_compaction_m2?: boolean
  /**
   * Wire protocol; default "openai".
   * Omitted on disk → deepMerge fills default (legacy configs unchanged).
   */
  protocol?: LlmProtocol
  /**
   * Auth: "auto" (default) → openai: Bearer, anthropic: x-api-key.
   * Override only if a gateway documents otherwise.
   */
  auth_style?: LlmAuthStyle
  /**
   * default "none".
   * "claude_code_compat" = inject documented gateway-compat headers
   * (UA / x-app / optional anthropic-beta). NEVER on first-party Anthropic hosts.
   */
  client_header_profile?: LlmClientHeaderProfile
  /** Pin for UA string under claude_code_compat; default "2.1.220". */
  claude_code_compat_version?: string
  /** Allowlisted extra headers only; values never logged. */
  extra_headers?: Record<string, string>
  /** Anthropic API version header; default "2023-06-01". */
  anthropic_version?: string
}

/**
 * Thread digest coverage engine (Thread History IA Wave B).
 * Default off — user must opt in. UI: Settings → 会话索引.
 */
export interface ThreadDigestConfig {
  /** When true, opening the thread list may lazily extract digests (capped). */
  enabled: boolean
  /** Only consider threads whose updated_at is older than this many hours (default 24). */
  on_idle_hours?: number
  /** Max auto/lazy extracts per calendar day (default 20). */
  max_per_day?: number
}

export interface CompanionConfig {
  port: number
  llm: LlmConfig
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
   * ACP coding-agent client (ADR-025 / 编程接力 Phase B).
   * Default enabled=false. See docs/adr/025-acp-coding-agent-client.md.
   */
  acp?: import("./acp/types").AcpConfig
  /** Phase A 编程接力 UI prefs (auto suggest offer, etc.). */
  coding_handoff?: {
    auto_suggest?: boolean
    /**
     * Mode C: after ACP/CLI session starts, also open host Terminal with
     * interactive agent (default false). Dual process — not same session.
     */
    open_local_terminal?: boolean
    /**
     * Which host terminal to open for Mode C.
     * - `auto` (default): macOS Terminal.app; Linux $TERMINAL / common;
     *   Windows `start` + PowerShell (then real Windows Terminal PE if present)
     * - Known: Terminal | iTerm | Warp | Alacritty | Kitty | Ghostty | wt | cmd
     * - Or absolute path to .app / binary
     */
    local_terminal_app?: string
  }
  /**
   * Coordinate computer-use (A10 default-deny). coordinateEnabled is the
   * GLOBAL kill-switch for host_computer: default false; enabling goes through
   * the biometric gate (computer/handlers.ts) — a hand-edited config.json is
   * treated as explicit owner opt-in (ADR-010), same as god-mode.
   */
  computer?: ComputerConfig
  /**
   * Path B local STT (ADR-023). Omitted on disk → deepMerge fills defaults
   * (sttEngine=browser, localModelId=medium, modelDiskBudgetMB=4096).
   */
  voice?: VoiceConfig
  obsidian?: ObsidianExportConfig
  /** Session index / digest lazy extract (Wave B). Default enabled=false. */
  thread_digest?: ThreadDigestConfig
  /**
   * Outbound MCP (ADR-022) packaging. When require_grant is true, loopback
   * HTTP invoke/disclosure accept only CMSPARK_OUTBOUND_GRANT (cmg_…) tokens —
   * never Extension ws_secret (L4+ dual-review lock).
   */
  outbound_mcp?: {
    /**
     * When true, loopback invoke/disclosure accept only CMSPARK_OUTBOUND_GRANT.
     * Default true (MCPO-01 / ADR-022 L4) — Extension ws_secret is not a deputy.
     * Set false only for local dual-entry debugging.
     */
    require_grant?: boolean
  }
  /**
   * Distribution channel: community (CWS-friendly) vs enterprise (local install modules).
   * Companion is source of truth — extension cannot forge enterprise alone.
   */
  capability_profile?: "community" | "enterprise"
  /**
   * Enterprise capability modules (opt-in). Shell/NetSec default enabled=false.
   * See docs/superpowers/specs/2026-07-26-mission-pack-enterprise-design.md
   */
  modules?: Record<
    string,
    {
      available: boolean
      enabled: boolean
      enabled_at?: string | null
      enabled_by?: string | null
      policy?: string
      target_allowlist?: string[]
      require_task_auth?: boolean
      allowlist_commands?: string[]
    }
  >
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
    // 128k is a realistic default so auto compaction can trigger; legacy 1e6 ≈ never.
    context_window: 128000,
    context_compaction: "auto",
    // M2 on by default under auto; still fails closed to M1 omit if summary fails.
    context_compaction_m2: true,
    // Anthropic protocol P0 defaults (omit on disk → these values via deepMerge)
    protocol: "openai",
    auth_style: "auto",
    client_header_profile: "none",
    claude_code_compat_version: "2.1.220",
    anthropic_version: "2023-06-01",
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
  thread_digest: {
    enabled: false,
    on_idle_hours: 24,
    max_per_day: 20,
  },
  capability_profile: "community",
  outbound_mcp: {
    require_grant: true,
  },
  modules: {
    appsec: {
      available: true,
      enabled: false,
      enabled_at: null,
      enabled_by: null,
    },
    "devsec-workspace": {
      available: true,
      enabled: false,
      enabled_at: null,
      enabled_by: null,
    },
    shell: {
      available: true,
      enabled: false,
      enabled_at: null,
      enabled_by: null,
      policy: "confirm_per_command",
      allowlist_commands: [],
    },
    netsec: {
      available: true,
      enabled: false,
      enabled_at: null,
      enabled_by: null,
      target_allowlist: [],
      require_task_auth: true,
    },
  },
  security: {
    safety_skills_enabled: ["prompt-injection-defense", "jailbreak-detection", "instruction-hierarchy"],
    auto_confirm_same_thread: false,
    confirmation_timeout_seconds: 45,
    auto_approve_dangerous: false,
    allow_all_schemes: false,
    auto_approve_enterprise_tools: false,
    // UX-spike 2026-07-23: browsers that host the side panel + the agent exe.
    // Lowercased basenames (no .exe) for Windows ProcessName matching.
    // macOS also matches via isCompanionUiOwner() against bundle ids
    // (com.google.Chrome etc.) — do not require the user to keep the target
    // app frontmost while authorizing in Chrome.
    companion_ui_exe_basenames: [
      "chrome", "msedge", "msedge_proxy", "firefox", "brave", "arc", "opera", "cmspark-agent",
      // macOS bundle-id last segments / full ids also accepted by isCompanionUiOwner
      "com.google.chrome", "com.microsoft.edgemac", "org.mozilla.firefox",
      "company.thebrowser.browser", "com.brave.browser",
    ],
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
  // Ship official filesystem MCP with home as the default allow-dir.
  // ensureFilesystemAllowlist still injects home if a hand-edited entry omits dirs.
  // Dynamic allow-dir expand (L2) can add home *or outside-home* dirs after user confirm
  // (volume roots / system / credential paths stay hard-refused).
  mcp: {
    enabled: true,
    servers: {
      filesystem: defaultFilesystemServerConfig(),
    },
  },
  apps: {
    enabled: true,
    entries: {},
  },
  acp: {
    enabled: false,
    servers: {},
    policy: {
      require_workspace: true,
      force_confirm_session_start: true,
      default_profile: "review_readonly",
    },
  },
  coding_handoff: {
    auto_suggest: true,
    open_local_terminal: false,
    local_terminal_app: "auto",
  },
  computer: {
    coordinateEnabled: false,
    // WP5-I4 实验层默认形：开关默认关、许可证未拒绝、变体默认 hybrid。
    modelEnabled: false,
    modelLicenseDeclined: false,
    modelVariant: "hybrid",
  },
  // Path B M0 — voice defaults (ADR-023 L1/L13; no auto-download)
  voice: {
    sttEngine: "browser",
    localModelId: "medium",
    modelDiskBudgetMB: 4096,
  },
  obsidian: {
    name_template: "{{date}} {{first_user_line}}",
    default_frontmatter: { tags: ["cmspark"] },
    vault_path: null,
  },
}

let cachedConfig: CompanionConfig | null = null
/** mtimeMs of config.json when cache was loaded — hand-edits invalidate cache */
let cachedConfigMtimeMs: number | null = null

/** Clear the in-memory config cache. Intended for tests only. */
export function clearConfigCache(): void {
  cachedConfig = null
  cachedConfigMtimeMs = null
}

function configFileMtimeMs(): number | null {
  try {
    return fs.statSync(path.join(DATA_DIR, "config.json")).mtimeMs
  } catch {
    return null
  }
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
    path.join(DATA_DIR, "packs", "installed"),
    path.join(DATA_DIR, "cache"),
  ]
  for (const dir of dirs) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  }
  // P1 CORR-09: demote stuck recording meetings after process restart
  try {
    const { reconcileStaleRecordings } = require("./meeting/meeting-store") as typeof import("./meeting/meeting-store")
    reconcileStaleRecordings(DATA_DIR)
  } catch {
    /* meetings module optional at very early boot */
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
  const merged = deepMerge(defaultConfig, parsed) as CompanionConfig
  // mcp.servers is a named map (same idea as replaceMcpServers): if the key exists on disk,
  // the file is the full map — deepMerge must NOT resurrect default "filesystem" after the
  // user deletes it or clears the map. Product default FS@home only applies when:
  //   - brand-new config (initDataDir writes defaultConfig), or
  //   - the entire `mcp` block is missing (deepMerge fills defaultConfig.mcp).
  // Explicit `servers: {}` means intentional empty — keep it (do not re-seed on every load).
  if (parsed.mcp && Object.prototype.hasOwnProperty.call(parsed.mcp, "servers")) {
    const diskServers = parsed.mcp.servers
    const productDefaultMcp: McpConfig = defaultConfig.mcp ?? {
      enabled: true,
      servers: { filesystem: defaultFilesystemServerConfig() },
    }
    const diskEnabled = parsed.mcp.enabled
    const serversObj =
      diskServers && typeof diskServers === "object" && !Array.isArray(diskServers)
        ? (diskServers as Record<string, McpServerConfig>)
        : {}
    merged.mcp = {
      enabled: typeof diskEnabled === "boolean" ? diskEnabled : productDefaultMcp.enabled,
      servers: { ...serversObj },
    }
  }
  // ACP config sanitize (ADR-025) — force review_readonly defaults on tamper
  try {
    const { sanitizeAcpConfig } = require("./acp/types") as typeof import("./acp/types")
    merged.acp = sanitizeAcpConfig(merged.acp ?? parsed.acp)
  } catch {
    merged.acp = {
      enabled: false,
      servers: {},
      policy: {
        require_workspace: true,
        force_confirm_session_start: true,
        default_profile: "review_readonly",
      },
    }
  }
  // P1 SEC-06: re-filter domain wildcards on load (hand-edited config.json bypass)
  return sanitizeDomainPatternsOnLoad(merged)
}

export function getConfig(): CompanionConfig {
  // Hand-edits to ~/.cmspark-agent/config.json (e.g. netsec.target_allowlist)
  // must take effect without a full process restart — reload when mtime changes.
  if (cachedConfig) {
    const mtime = configFileMtimeMs()
    if (mtime != null && cachedConfigMtimeMs != null && mtime !== cachedConfigMtimeMs) {
      cachedConfig = null
      cachedConfigMtimeMs = null
    }
  }
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
    cachedConfigMtimeMs = configFileMtimeMs()
  } catch (err: any) {
    // Corrupt config: preserve it for inspection + log loudly, then use defaults so the
    // companion still starts. Previously this was a silent reset that wiped keys/domains.
    const backup = `${configPath}.corrupt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    console.error(
      `[cmspark-agent] config.json corrupt/unreadable — backing up to ${path.basename(backup)} and starting with defaults. Cause: ${err?.message || err}`,
    )
    try { fs.renameSync(configPath, backup) } catch { /* best-effort preservation */ }
    cachedConfig = structuredClone(defaultConfig)
    cachedConfigMtimeMs = configFileMtimeMs()
  }
  // Environment variable takes priority ONLY when no user-provided key exists.
  // If the file has a user-provided API key (non-empty, not masked), respect it.
  if (getEnvApiKey() && !isUserProvidedApiKey(cachedConfig.llm.api_key)) {
    cachedConfig.llm.api_key = getEnvApiKey()
  }
  // Ensure mcp config exists with sane defaults (older config.json may not have it)
  if (!cachedConfig.mcp) {
    cachedConfig.mcp = structuredClone(defaultConfig.mcp)
  }
  // Mission Pack / capability modules (older config may lack these)
  if (cachedConfig.capability_profile !== "community" && cachedConfig.capability_profile !== "enterprise") {
    cachedConfig.capability_profile = "community"
  }
  // Inline module defaults (avoid circular import with capability/modules.ts)
  if (!cachedConfig.modules || typeof cachedConfig.modules !== "object") {
    cachedConfig.modules = { ...defaultConfig.modules }
  } else {
    for (const id of ["appsec", "devsec-workspace", "shell", "netsec"] as const) {
      if (!cachedConfig.modules[id]) {
        cachedConfig.modules[id] = { ...(defaultConfig.modules as any)[id] }
      }
    }
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
  // Qwen3-VL variants; migrate legacy TinyClick hybrid/int8 → 2b
  if (cachedConfig.computer.modelVariant === "hybrid" || cachedConfig.computer.modelVariant === "int8") {
    console.error(
      `[cmspark-agent] computer.modelVariant=${cachedConfig.computer.modelVariant} 已弃用（TinyClick）——迁移为 Qwen3-VL "2b"`,
    )
    cachedConfig.computer.modelVariant = "2b"
  }
  if (
    cachedConfig.computer.modelVariant !== undefined &&
    cachedConfig.computer.modelVariant !== "2b" &&
    cachedConfig.computer.modelVariant !== "4b" &&
    cachedConfig.computer.modelVariant !== "8b"
  ) {
    console.error(
      `[cmspark-agent] computer.modelVariant 非法（须为 "2b"|"4b"|"8b"）——回退 2b (config tampering?)`,
    )
    cachedConfig.computer.modelVariant = "2b"
  }
  cachedConfig.computer.modelVariant = cachedConfig.computer.modelVariant ?? "2b"
  const src = cachedConfig.computer.modelDownloadSource
  if (
    src !== undefined &&
    src !== "auto" &&
    src !== "huggingface" &&
    src !== "hf-mirror" &&
    src !== "modelscope"
  ) {
    console.error(
      `[cmspark-agent] computer.modelDownloadSource 非法——回退 auto`,
    )
    cachedConfig.computer.modelDownloadSource = "auto"
  }
  cachedConfig.computer.modelDownloadSource = cachedConfig.computer.modelDownloadSource ?? "auto"
  if (cachedConfig.computer.modelEnabled === true) {
    console.error(
      `[cmspark-agent] WARNING: computer.modelEnabled=true —— Qwen3-VL 实验定位层处于开启状态（设置页经门开启 或 手改 config.json opt-in；ADR-010）。本层未校准，命中仍必经人工确认；关闭请置 false 或经设置页。`,
    )
  }
  // Path B voice (ADR-023): ensure block + coerce illegal hand-edits to safe defaults.
  // deepMerge fills defaults for omitted keys; shape/value validation is load-time only.
  if (!cachedConfig.voice || typeof cachedConfig.voice !== "object") {
    cachedConfig.voice = {
      sttEngine: "browser",
      localModelId: "medium",
      modelDiskBudgetMB: 4096,
    }
  } else {
    const voice = cachedConfig.voice
    if (voice.sttEngine !== "browser" && voice.sttEngine !== "local") {
      console.warn(
        `[cmspark-agent] voice.sttEngine 非法（须为 "browser"|"local"）——回退 browser (config tampering?)`,
      )
      voice.sttEngine = "browser"
    }
    if (
      voice.localModelId !== "small" &&
      voice.localModelId !== "medium" &&
      voice.localModelId !== "large-v3-turbo"
    ) {
      console.warn(
        `[cmspark-agent] voice.localModelId 非法（须为 "small"|"medium"|"large-v3-turbo"）——回退 medium (config tampering?)`,
      )
      voice.localModelId = "medium"
    }
    if (
      typeof voice.modelDiskBudgetMB !== "number" ||
      !Number.isFinite(voice.modelDiskBudgetMB) ||
      voice.modelDiskBudgetMB <= 0
    ) {
      console.warn(
        `[cmspark-agent] voice.modelDiskBudgetMB 非法（须为正数 MB）——回退默认 4096 (config tampering?)`,
      )
      voice.modelDiskBudgetMB = 4096
    }
    if (voice.modelRootDir !== undefined) {
      const root = voice.modelRootDir
      if (typeof root !== "string" || root.trim() === "") {
        console.warn(
          `[cmspark-agent] voice.modelRootDir 非法（须为非空路径字符串）——按未配置处理 (config tampering?)`,
        )
        delete voice.modelRootDir
      }
    }
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
  cachedConfigMtimeMs = configFileMtimeMs()
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
  cachedConfigMtimeMs = configFileMtimeMs()
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
  cachedConfigMtimeMs = configFileMtimeMs()
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
      | "modelEnabled"
      | "modelLicenseAcceptedAt"
      | "modelLicenseAcceptedTextHash"
      | "modelLicenseDeclined"
      | "modelVariant"
      | "modelDownloadSource"
      | "modelRootDir"
      | "pythonMode"
      | "pythonPath"
      | "pythonPreferUv"
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
  cachedConfigMtimeMs = configFileMtimeMs()
  configEvents.emit(CONFIG_CHANGE_EVENT, updated)
  return updated
}

/**
 * Path B M0：voice 字段原子写入（whisper-handlers 唯一持久化通道，
 * setComputerModelFields 先例）。只 merge `voice.*`；调用方负责语义门禁
 * （set_engine local 须 ready model 等）。
 */
export function setVoiceFields(partial: Partial<VoiceConfig>): CompanionConfig {
  const current = getConfig()
  const updated: CompanionConfig = {
    ...current,
    voice: {
      sttEngine: "browser",
      localModelId: "medium",
      modelDiskBudgetMB: 4096,
      ...(current.voice ?? {}),
      ...partial,
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
  cachedConfigMtimeMs = configFileMtimeMs()
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

/** Shared domain-pattern filter (saveConfig + loadConfig P1 SEC-06). */
function filterDomainPatterns(
  arr: string[] | undefined,
  label: string,
  logLabel = "rejecting",
): string[] {
  if (!Array.isArray(arr)) return []
  // Lazy require avoids circular import at module load
  const { validateWildcardPattern } = require("./security") as typeof import("./security")
  const kept: string[] = []
  for (const p of arr) {
    if (typeof p !== "string") continue
    const v = validateWildcardPattern(p)
    if (v.ok) {
      kept.push(p)
    } else {
      console.warn(
        `[cmspark-agent] WARNING: ${logLabel} dangerous ${label} pattern '${p}' — ${v.reason}.`,
      )
    }
  }
  return kept
}

/** P1 SEC-06: drop dangerous wildcards when loading hand-edited config.json. */
function sanitizeDomainPatternsOnLoad(cfg: CompanionConfig): CompanionConfig {
  if (Array.isArray(cfg.trusted_domains)) {
    cfg.trusted_domains = filterDomainPatterns(cfg.trusted_domains, "trusted_domains", "load-dropping")
  }
  if (Array.isArray(cfg.auto_approved_domains)) {
    cfg.auto_approved_domains = filterDomainPatterns(
      cfg.auto_approved_domains,
      "auto_approved_domains",
      "load-dropping",
    )
  }
  return cfg
}

export function saveConfig(config: Partial<CompanionConfig>): CompanionConfig {
  // S-P0-4 (2026-07-24): previously these were advisory warnings. Now we
  // FILTER OUT dangerous patterns at saveConfig time — `*`, `*.com`, `*.cn`,
  // `*.co.uk`, etc. The runtime matchDomain still handles them (for legacy
  // configs loaded directly from disk via deepMerge), but saveConfig refuses
  // to persist them. This closes the "edit config.json directly" bypass.
  const filterPatterns = (arr: string[] | undefined, label: string): string[] =>
    filterDomainPatterns(arr, label, "rejecting")
  if (config.trusted_domains) {
    config.trusted_domains = filterPatterns(config.trusted_domains, "trusted_domains")
  }
  if (config.auto_approved_domains) {
    config.auto_approved_domains = filterPatterns(config.auto_approved_domains, "auto_approved_domains")
  }
  // Warn when dangerous auto-approve is enabled — it bypasses the human-in-the-loop gate.
  if (config.security?.auto_approve_dangerous === true) {
    console.warn("[cmspark-agent] WARNING: security.auto_approve_dangerous is enabled — all dangerous tool calls will be auto-approved without user confirmation. Use only for trusted unattended workflows.")
  }
  // Warn when GOD-MODE / protocol unlock is enabled (navigation schemes + partial L2).
  // Alone: analyze_image IMAGE_FETCH still confirms. Three-flag cruise: image fetch
  // confirm waived + file:// allowed (risk accepted); cloud-metadata SSRF still hard-blocked.
  if (config.security?.allow_all_schemes === true) {
    console.warn(
      "[cmspark-agent] WARNING: security.allow_all_schemes (protocol unlock) is enabled — bypasses non-http(s) navigate schemes and some L2 confirms. Alone, analyze_image IMAGE_FETCH still confirms. Full three-flag cruise waives image-fetch confirm and allows file:// (risk accepted); cloud-metadata SSRF remains hard-blocked. Use only for fully-trusted workflows.",
    )
  }
  if (config.security?.auto_approve_enterprise_tools === true) {
    console.warn(
      "[cmspark-agent] WARNING: security.auto_approve_enterprise_tools is enabled — shell_exec / netsec_port_scan skip interactive L2 when module+allowlist/task-auth (or shell policy) pass. Alone it does NOT waive MCP critical confirms; full-autonomy cruise (this + auto_approve_dangerous + allow_all_schemes) does. spawn_worker / host_computer critical still require confirmation unless that three-flag cruise is on. Use only for trusted enterprise lab workflows.",
    )
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

  // ACP: re-sanitize after deepMerge so hand-edited/partial writes cannot skip
  // profile coercion (review_readonly) that load-time sanitize already enforces.
  // Use require() like loadConfig to avoid circular ESM import edges.
  if (updated.acp != null || config.acp != null) {
    try {
      const { sanitizeAcpConfig } = require("./acp/types") as typeof import("./acp/types")
      updated.acp = sanitizeAcpConfig(updated.acp)
    } catch (e) {
      // Fail closed to defaults (match loadConfig spirit) — never persist unsanitized acp
      try {
        const { DEFAULT_ACP_CONFIG } =
          require("./acp/types") as typeof import("./acp/types")
        updated.acp = {
          ...DEFAULT_ACP_CONFIG,
          servers: {},
          enabled: updated.acp?.enabled === true,
        }
      } catch {
        updated.acp = {
          enabled: false,
          servers: {},
          policy: {
            require_workspace: true,
            force_confirm_session_start: true,
            default_profile: "review_readonly",
          },
        }
      }
      try {
        console.warn(
          "[cmspark-agent] saveConfig: sanitizeAcpConfig failed — forced safe defaults",
          e,
        )
      } catch {
        /* ignore */
      }
    }
  }

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
    // Multi-adversarial P0 (2026-08-08): when vision endpoint matches main LLM and
    // vision key is still empty/placeholder, inherit llm.api_key (no new schema field).
    const inherited = resolveInheritedVisionApiKey({
      llmBaseUrl: updated.llm.base_url,
      llmModelName: updated.llm.model_name,
      llmApiKey: updated.llm.api_key,
      llmProtocol: updated.llm.protocol,
      visionBaseUrl: updated.vision.base_url,
      visionModelName: updated.vision.model_name,
      visionApiKey: updated.vision.api_key,
    })
    if (inherited !== undefined) {
      updated.vision.api_key = inherited
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
  // Vision may inherit llm.api_key when endpoints match; if that value is the
  // env-sourced key, blank it on disk the same way (runtime cache still has it).
  if (envKey && toSave.vision?.api_key === envKey) {
    toSave.vision.api_key = ""
  }
  // H3 (audit): atomic write (tmp + rename) so a crash mid-save can't leave a truncated
  // config.json (which the H4 load path would then treat as corrupt). mode 0o600 — holds api_key.
  // (Supersedes the P0-3 writeFileSync+chmod: atomicWriteJSON already does atomic + 0o600 + chmod
  // internally — merged from PR #13.)
  atomicWriteJSON(configPath, toSave)
  cachedConfig = updated
  cachedConfigMtimeMs = configFileMtimeMs()
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

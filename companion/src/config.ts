// Companion configuration management

import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import { EventEmitter } from "events"
import { getLockPath } from "./platform"
import { getBuiltinSkillsSrc } from "./paths"

export const configEvents = new EventEmitter()
export const CONFIG_CHANGE_EVENT = "config.change"

export const DATA_DIR = process.env.CMSPARK_DATA_DIR || path.join(os.homedir(), ".cmspark-agent")

export interface SecurityConfig {
  safety_skills_enabled: string[]
  auto_confirm_same_thread: boolean
  confirmation_timeout_seconds: number
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
  history_retention_days: number
  security: SecurityConfig
  file_upload?: FileUploadConfig
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
  history_retention_days: 30,
  security: {
    safety_skills_enabled: ["prompt-injection-defense", "jailbreak-detection", "instruction-hierarchy"],
    auto_confirm_same_thread: false,
    confirmation_timeout_seconds: 45,
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
}

let cachedConfig: CompanionConfig | null = null

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

export function getConfig(): CompanionConfig {
  if (cachedConfig) {
    // Always refresh env var (it takes priority)
    if (getEnvApiKey()) {
      cachedConfig.llm.api_key = getEnvApiKey()
    }
    return cachedConfig
  }
  const configPath = path.join(DATA_DIR, "config.json")
  try {
    const raw = fs.readFileSync(configPath, "utf-8")
    const fileConfig = JSON.parse(raw)
    cachedConfig = deepMerge(defaultConfig, fileConfig) as CompanionConfig
  } catch {
    cachedConfig = { ...defaultConfig }
  }
  // Environment variable always wins
  if (getEnvApiKey()) {
    cachedConfig.llm.api_key = getEnvApiKey()
  }
  return cachedConfig
}

export function saveConfig(config: Partial<CompanionConfig>): CompanionConfig {
  // Warn when '*' is used as a trusted domain (global wildcard)
  if (config.trusted_domains?.includes("*")) {
    console.warn("[cmspark-agent] WARNING: '*' wildcard trusted domain — all cookie access is allowed. Use only for development.")
  }
  const current = getConfig()
  const updated = deepMerge(current, config) as CompanionConfig

  // Environment variable always wins for api_key
  if (getEnvApiKey()) {
    updated.llm.api_key = getEnvApiKey()
  }

  const configPath = path.join(DATA_DIR, "config.json")
  // Save to file with api_key masked (don't persist the env var to disk)
  const toSave = JSON.parse(JSON.stringify(updated))
  if (getEnvApiKey() && toSave.llm?.api_key === getEnvApiKey()) {
    toSave.llm.api_key = ""  // Don't write env var to disk
  }
  fs.writeFileSync(configPath, JSON.stringify(toSave, null, 2))
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

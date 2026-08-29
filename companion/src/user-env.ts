// User environment variables / secrets (ADR-019).
//
// Companion is the sole source of truth: ~/.cmspark-agent/user-env.json (0o600).
// Injected only into shell_exec / MCP stdio child processes — never into LLM
// context or outbound WS plaintext. Outbound snapshots MUST go through
// buildUserEnvPublic() only (R2).

import * as fs from "fs"
import * as path from "path"
import { DATA_DIR } from "./config"
import { atomicWriteJSON } from "./io"

export const USER_ENV_VERSION = 1

/** POSIX-style env name (skill conventions). */
export const USER_ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

/** Max single value length (16 KiB). */
export const USER_ENV_VALUE_MAX = 16_384

/** Max number of keys. */
export const USER_ENV_MAX_KEYS = 64

/** Mask placeholder for listed secrets; clients send this to mean "unchanged". */
export const USER_ENV_MASK = "***"

export const USER_ENV_FILE_NAME = "user-env.json"

export type UserEnvErrorCode =
  | "INVALID_KEY"
  | "RESERVED_KEY"
  | "VALUE_TOO_LONG"
  | "TOO_MANY_KEYS"
  | "IO_ERROR"
  | "INVALID_PAYLOAD"

export interface UserEnvFile {
  version: number
  /** ISO timestamp of last successful write */
  updated_at?: string
  vars: Record<string, string>
}

export interface UserEnvPublic {
  keys: Array<{
    name: string
    /**
     * Always the constant USER_ENV_MASK ("***") when the key is configured.
     * Not a partial redaction of the value — presence of the entry means set.
     */
    masked: typeof USER_ENV_MASK
  }>
  count: number
  updated_at?: string
}

export type UserEnvResult =
  | { ok: true; public: UserEnvPublic }
  | { ok: false; error_code: UserEnvErrorCode; error: string }

/**
 * Denylist built from:
 * 1. ADR-019 baseline integrity / loader keys
 * 2. companion/src `process.env.*` scan (non-CMSPARK; CMSPARK_* blocked by prefix)
 *
 * Do NOT invent env names that code never reads (e.g. WS_SECRET).
 */
export const USER_ENV_DENYLIST: ReadonlySet<string> = new Set([
  // OS / shell integrity (baseline)
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "TMPDIR",
  "TEMP",
  "TMP",
  // Dynamic loaders (baseline)
  "LD_PRELOAD",
  "LD_LIBRARY_PATH",
  "DYLD_INSERT_LIBRARIES",
  "DYLD_LIBRARY_PATH",
  // Node / Electron (baseline + scan NODE_ENV)
  "NODE_OPTIONS",
  "NODE_PATH",
  "ELECTRON_RUN_AS_NODE",
  "NODE_ENV",
  // OpenSSL / Python (baseline)
  "OPENSSL_CONF",
  "PYTHONHOME",
  "PYTHONPATH",
  "PYTHONSTARTUP",
  // From companion process.env scan (non-CMSPARK_*)
  "APPDATA",
  "LOCALAPPDATA",
  "USERPROFILE",
  "ProgramData",
  "ProgramFiles",
  "SystemRoot",
  "windir",
  "NVM_DIR",
  "WAYLAND_DISPLAY",
  // Companion LLM key (config.ts reads process.env.DEEPSEEK_API_KEY). Deny so
  // shell_exec / MCP children cannot inherit the companion's API credential
  // via user-env injection (even if the host process itself already has it).
  "DEEPSEEK_API_KEY",
])

/** All CMSPARK_* keys are reserved (prefix ban, ADR §4.3). */
export function isCmsparkPrefixKey(name: string): boolean {
  return name.startsWith("CMSPARK_")
}

export function isReservedUserEnvKey(name: string): boolean {
  return isCmsparkPrefixKey(name) || USER_ENV_DENYLIST.has(name)
}

/**
 * MCP stdio child-env loader hijack keys. Dedicated table — do NOT reuse
 * USER_ENV_DENYLIST (that bans PATH/HOME/NODE_ENV which MCP must be able to set).
 */
const MCP_LOADER_ENV_EXACT = new Set(
  [
    "NODE_OPTIONS",
    "NODE_PATH",
    "ELECTRON_RUN_AS_NODE",
    "LD_PRELOAD",
    "LD_LIBRARY_PATH",
    "PYTHONINSPECT",
    "PYTHONHOME",
    "PYTHONPATH",
    "PYTHONSTARTUP",
    "BASH_ENV",
    "ENV",
    "OPENSSL_CONF",
  ].map((k) => k.toUpperCase()),
)

export function isUnsafeLoaderEnvKey(name: string): boolean {
  if (!name) return false
  const u = String(name).toUpperCase()
  if (MCP_LOADER_ENV_EXACT.has(u)) return true
  if (u.startsWith("DYLD_")) return true
  if (u.startsWith("BASH_FUNC_")) return true
  return false
}

export function userEnvFilePath(dataDir: string = DATA_DIR): string {
  return path.join(dataDir, USER_ENV_FILE_NAME)
}

function emptyFile(): UserEnvFile {
  return { version: USER_ENV_VERSION, vars: {} }
}

let cache: UserEnvFile | null = null

/** Test / reload helper. */
export function clearUserEnvCache(): void {
  cache = null
}

/**
 * Unique outbound constructor — handlers and broadcast MUST use this (R2 / S8).
 * Never includes plaintext values.
 */
export function buildUserEnvPublic(file: UserEnvFile): UserEnvPublic {
  const names = Object.keys(file.vars || {}).sort()
  return {
    keys: names.map((name) => ({ name, masked: USER_ENV_MASK })),
    count: names.length,
    updated_at: file.updated_at,
  }
}

function normalizeLoaded(raw: unknown): UserEnvFile | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const obj = raw as Record<string, unknown>
  const varsRaw = obj.vars
  if (!varsRaw || typeof varsRaw !== "object" || Array.isArray(varsRaw)) return null
  const vars: Record<string, string> = {}
  for (const [k, v] of Object.entries(varsRaw as Record<string, unknown>)) {
    if (typeof k !== "string" || typeof v !== "string") continue
    vars[k] = v
  }
  const version = typeof obj.version === "number" ? obj.version : USER_ENV_VERSION
  const updated_at = typeof obj.updated_at === "string" ? obj.updated_at : undefined
  return { version, updated_at, vars }
}

/**
 * Load from disk (or cache). On missing file → empty. On corrupt/IO → empty
 * for read paths used by injection (see getUserEnvVars / S9).
 */
export function loadUserEnv(opts?: { forceReload?: boolean }): UserEnvFile {
  if (cache && !opts?.forceReload) return cache
  const filePath = userEnvFilePath()
  try {
    if (!fs.existsSync(filePath)) {
      cache = emptyFile()
      return cache
    }
    const text = fs.readFileSync(filePath, "utf-8")
    const parsed = JSON.parse(text) as unknown
    const normalized = normalizeLoaded(parsed)
    if (!normalized) {
      cache = emptyFile()
      return cache
    }
    cache = normalized
    return cache
  } catch {
    cache = emptyFile()
    return cache
  }
}

/**
 * Vars for child-process merge. On IO/parse failure returns {} (S9) — never
 * throws, never blocks shell/MCP spawn.
 */
export function getUserEnvVars(): Record<string, string> {
  try {
    const file = loadUserEnv()
    return { ...(file.vars || {}) }
  } catch {
    return {}
  }
}

function validateKey(name: string): UserEnvResult | null {
  if (!USER_ENV_KEY_RE.test(name)) {
    return {
      ok: false,
      error_code: "INVALID_KEY",
      error: `Invalid key "${name}": must match ${USER_ENV_KEY_RE}`,
    }
  }
  if (isReservedUserEnvKey(name)) {
    return {
      ok: false,
      error_code: "RESERVED_KEY",
      error: `Reserved key "${name}" cannot be set (denylist or CMSPARK_* prefix)`,
    }
  }
  return null
}

function persist(file: UserEnvFile): UserEnvResult {
  try {
    const toWrite: UserEnvFile = {
      version: USER_ENV_VERSION,
      updated_at: new Date().toISOString(),
      vars: file.vars,
    }
    atomicWriteJSON(userEnvFilePath(), toWrite, 0o600)
    cache = toWrite
    return { ok: true, public: buildUserEnvPublic(toWrite) }
  } catch (err: any) {
    return {
      ok: false,
      error_code: "IO_ERROR",
      error: err?.message || String(err),
    }
  }
}

/**
 * Set / update vars. Empty string is a legal value (R6) — not delete.
 * Value === "***" means unchanged (ignored), same as api_key convention.
 */
export function setUserEnvVars(input: Record<string, unknown>): UserEnvResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error_code: "INVALID_PAYLOAD", error: "vars object required" }
  }

  const current = loadUserEnv()
  const nextVars: Record<string, string> = { ...current.vars }
  let anyChange = false

  for (const [rawKey, rawVal] of Object.entries(input)) {
    const keyErr = validateKey(rawKey)
    if (keyErr) return keyErr

    if (typeof rawVal !== "string") {
      return {
        ok: false,
        error_code: "INVALID_PAYLOAD",
        error: `Value for "${rawKey}" must be a string`,
      }
    }
    // Masked sentinel → leave existing value (or skip if new)
    if (rawVal === USER_ENV_MASK) {
      continue
    }
    if (rawVal.length > USER_ENV_VALUE_MAX) {
      return {
        ok: false,
        error_code: "VALUE_TOO_LONG",
        error: `Value for "${rawKey}" exceeds ${USER_ENV_VALUE_MAX} bytes`,
      }
    }
    nextVars[rawKey] = rawVal
    anyChange = true
  }

  if (Object.keys(nextVars).length > USER_ENV_MAX_KEYS) {
    return {
      ok: false,
      error_code: "TOO_MANY_KEYS",
      error: `Too many keys (max ${USER_ENV_MAX_KEYS})`,
    }
  }

  if (!anyChange) {
    // No-op (all masked or empty patch) — still return public snapshot
    return { ok: true, public: buildUserEnvPublic(current) }
  }

  return persist({ version: USER_ENV_VERSION, vars: nextVars })
}

/** Delete keys. Unknown keys are ignored. */
export function deleteUserEnvKeys(keys: string[]): UserEnvResult {
  if (!Array.isArray(keys)) {
    return { ok: false, error_code: "INVALID_PAYLOAD", error: "keys array required" }
  }

  const current = loadUserEnv()
  const nextVars: Record<string, string> = { ...current.vars }
  let anyChange = false

  for (const raw of keys) {
    if (typeof raw !== "string" || !raw) continue
    // Allow delete of any stored key (including if denylist grew later)
    if (Object.prototype.hasOwnProperty.call(nextVars, raw)) {
      delete nextVars[raw]
      anyChange = true
    }
  }

  if (!anyChange) {
    return { ok: true, public: buildUserEnvPublic(current) }
  }

  return persist({ version: USER_ENV_VERSION, vars: nextVars })
}

/**
 * Redact a vars map for logging/audit — values always masked (R1 / S3).
 * Safe to pass to logger.info / appendCapabilityAudit.
 */
export function redactUserEnvVarsForLog(
  vars: Record<string, unknown> | undefined | null,
): Record<string, string> {
  if (!vars || typeof vars !== "object") return {}
  const out: Record<string, string> = {}
  for (const k of Object.keys(vars)) {
    out[k] = USER_ENV_MASK
  }
  return out
}

// ADR-019 user-env / Secrets — pure helpers for Side Panel settings UI.
// Mirror companion rules for client-side validation + Chinese error mapping.

import type { UserEnvErrorCode, UserEnvKeyEntry, UserEnvPublic } from "../types"

/** POSIX-style env name (aligned with companion USER_ENV_KEY_RE). */
export const USER_ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

/** Mask placeholder; clients send this to mean "unchanged". */
export const USER_ENV_MASK = "***"

/** Optional name chips for common skill secrets (name only — never values). */
export const USER_ENV_NAME_CHIPS = ["DATAYES_TOKEN"] as const

/**
 * Client-side denylist mirror of companion USER_ENV_DENYLIST (ADR-019 §4.3).
 * Companion is still authoritative; this only avoids a useless WS round-trip.
 * Keep in lock-step when companion denylist changes.
 */
export const USER_ENV_DENYLIST: ReadonlySet<string> = new Set([
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "TMPDIR",
  "TEMP",
  "TMP",
  "LD_PRELOAD",
  "LD_LIBRARY_PATH",
  "DYLD_INSERT_LIBRARIES",
  "DYLD_LIBRARY_PATH",
  "NODE_OPTIONS",
  "NODE_PATH",
  "ELECTRON_RUN_AS_NODE",
  "NODE_ENV",
  "OPENSSL_CONF",
  "PYTHONHOME",
  "PYTHONPATH",
  "PYTHONSTARTUP",
  "APPDATA",
  "LOCALAPPDATA",
  "USERPROFILE",
  "ProgramData",
  "ProgramFiles",
  "SystemRoot",
  "windir",
  "NVM_DIR",
  "WAYLAND_DISPLAY",
  "DEEPSEEK_API_KEY",
])

/** Companion error_code → Chinese label for settings inline feedback. */
const USER_ENV_ERROR_ZH: Record<UserEnvErrorCode, string> = {
  INVALID_KEY: "变量名无效（需字母/下划线开头，仅含字母数字下划线）",
  RESERVED_KEY: "该变量名为系统保留（如 PATH / CMSPARK_*），不可设置",
  VALUE_TOO_LONG: "值过长（单值上限 16KiB）",
  TOO_MANY_KEYS: "条目数已达上限（最多 64 个）",
  IO_ERROR: "本机读写失败，请检查 Companion 数据目录权限",
  INVALID_PAYLOAD: "请求格式无效",
}

const USER_ENV_ERROR_CODES: ReadonlySet<string> = new Set(Object.keys(USER_ENV_ERROR_ZH))

/**
 * Route companion `type:"error"` to the Secrets settings section instead of chat.
 * Prefer family:"user_env"; fall back to known error_code set.
 */
export function isUserEnvErrorMessage(msg: {
  family?: unknown
  error_code?: unknown
  code?: unknown
}): boolean {
  if (!msg || typeof msg !== "object") return false
  if (msg.family === "user_env") return true
  const code = typeof msg.error_code === "string" ? msg.error_code
    : typeof msg.code === "string" ? msg.code
    : null
  return code != null && USER_ENV_ERROR_CODES.has(code)
}

/** Map error_code (or raw error string) to Chinese UI text. */
export function mapUserEnvError(
  errorCode: string | undefined | null,
  fallbackError?: string | null,
): string {
  if (errorCode && errorCode in USER_ENV_ERROR_ZH) {
    return USER_ENV_ERROR_ZH[errorCode as UserEnvErrorCode]
  }
  if (fallbackError && typeof fallbackError === "string" && fallbackError.trim()) {
    return fallbackError
  }
  return "环境变量操作失败"
}

/** Local key validation before sending user_env.set / delete. */
export function validateUserEnvKeyName(name: string): string | null {
  const trimmed = name.trim()
  if (!trimmed) return "请输入变量名"
  if (!USER_ENV_KEY_RE.test(trimmed)) {
    return USER_ENV_ERROR_ZH.INVALID_KEY
  }
  if (trimmed.startsWith("CMSPARK_") || USER_ENV_DENYLIST.has(trimmed)) {
    return USER_ENV_ERROR_ZH.RESERVED_KEY
  }
  return null
}

/** Normalize list/updated payload into a safe public snapshot (no values). */
export function normalizeUserEnvPublic(msg: unknown): UserEnvPublic {
  const m = msg && typeof msg === "object" ? (msg as Record<string, unknown>) : {}
  const rawKeys = Array.isArray(m.keys) ? m.keys : []
  const keys: UserEnvKeyEntry[] = []
  for (const item of rawKeys) {
    if (!item || typeof item !== "object") continue
    const row = item as Record<string, unknown>
    if (typeof row.name !== "string" || !row.name) continue
    // Force mask — never trust a value field if a buggy companion sent one.
    keys.push({ name: row.name, masked: USER_ENV_MASK })
  }
  const count = typeof m.count === "number" && Number.isFinite(m.count) ? m.count : keys.length
  const updated_at = typeof m.updated_at === "string" ? m.updated_at : undefined
  return { keys, count, ...(updated_at ? { updated_at } : {}) }
}

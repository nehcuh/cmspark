export interface HostReadParams {
  application?: string
  maxChars?: number
}

export interface HostReadResult {
  sender: string
  subject: string
  date_received: string
  body_preview: string
}

export class NotImplementedOnPlatform extends Error {
  constructor(platform: NodeJS.Platform) {
    super(`host_use: not implemented on ${platform}`)
    this.name = "NotImplementedOnPlatform"
  }
}

/**
 * macOS host-use audit M1 — the requested app IS on the read whitelist (W7
 * expanded it to Mail + Notes + Finder so the inline-checkbox trust option is
 * functional) but its read path is not implemented yet. Raised instead of
 * silently serving another app's data (the previous behavior returned Mail
 * data for Notes/Finder host_read requests, and thread-trust is granted
 * per-app — "trust Notes" must not yield Mail data). Same shape as
 * WinAppNotAvailable: typed appToken + recovery hint for the LLM.
 */
export class NotImplementedForApp extends Error {
  readonly appToken: string
  readonly hint: string
  constructor(appToken: string, hint: string) {
    super(`host_use: ${appToken} read is not implemented yet — ${hint}`)
    this.name = "NotImplementedForApp"
    this.appToken = appToken
    this.hint = hint
  }
}

/**
 * Phase 1 W8-windows — target app is not available on this machine.
 * Raised when a COM ProgID is unregistered (0x80040154 REGDB_E_CLASSNOTREG,
 * e.g. "New Outlook" MSIX has no COM server) or a required script is missing.
 * The message names the missing app and points at the browser fallback so the
 * LLM can recover instead of retrying.
 */
export class WinAppNotAvailable extends Error {
  readonly appToken: string
  readonly hint: string
  constructor(appToken: string, hint: string) {
    super(`host_use: ${appToken} is not available on this machine — ${hint}`)
    this.name = "WinAppNotAvailable"
    this.appToken = appToken
    this.hint = hint
  }
}

/**
 * macOS host-use audit M6 — Finder move received a non-absolute POSIX path.
 * Both source_path and destination must start with "/": a relative path would
 * resolve against the spawned cmspark-host process's inherited cwd, which is
 * unpredictable for a packaged app. Cheap alignment with win rule-4 (absolute
 * path enforcement before any fs mutation); thrown before the binary spawns.
 */
export class DarwinPathNotAbsolute extends Error {
  constructor(pathTried: string) {
    super(
      `host_use: Finder move requires absolute POSIX paths (starting with "/"): ${pathTried}`,
    )
    this.name = "DarwinPathNotAbsolute"
  }
}

/**
 * Phase 1 W8-windows hardening W-1 — a file path escaped the allowlisted
 * roots (%USERPROFILE%\{Documents,Desktop,Downloads}). Thrown before any fs
 * mutation; never catch-and-continue.
 */
export class WinPathOutsideAllowlist extends Error {
  constructor(pathTried: string) {
    super(
      `host_use: path escapes allowlisted roots ` +
      `(%USERPROFILE%\\Documents|Desktop|Downloads): ${pathTried}`,
    )
    this.name = "WinPathOutsideAllowlist"
  }
}

/**
 * Phase 1 W9 — Biometric verification result. Same shape across platforms:
 *   - darwin: Touch ID via Swift binary subprocess
 *   - win32:  Windows Hello UserConsentVerifier (OS-hosted dialog)
 *   - linux:  6-char manual nonce typed by user (paste blocked)
 *
 * Nonce is bound to the originating tool_call_id for audit trail (W7 Q8).
 */
export interface BiometricResult {
  verified: true
  nonce: string
  method: "touchid" | "windows-hello" | "manual-nonce"
}

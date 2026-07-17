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

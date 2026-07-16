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
    super(`host_read: not implemented on ${platform} — Phase 0 macOS-only`)
    this.name = "NotImplementedOnPlatform"
  }
}

/**
 * Phase 1 W9 — Biometric verification result. Same shape across platforms:
 *   - darwin: Touch ID via Swift binary subprocess
 *   - linux: 6-char manual nonce typed by user (paste blocked)
 *
 * Nonce is bound to the originating tool_call_id for audit trail (W7 Q8).
 */
export interface BiometricResult {
  verified: true
  nonce: string
  method: "touchid" | "manual-nonce"
}

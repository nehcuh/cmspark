// Unified SecurityPolicy — HMAC token generation/validation for evaluate confirmation
// and centralized security checks for high-risk tool execution.

import { createHmac, randomBytes } from "crypto"

const TOKEN_SECRET = process.env.CMSPARK_SECURITY_SECRET || randomBytes(32).toString("hex")
export function getTokenSecret(): string {
  return TOKEN_SECRET
}
const TOKEN_TTL_MS = 5 * 60 * 1000 // 5 minutes
const MAX_CODE_LENGTH = 50000
const MAX_EXPRESSION_LENGTH = 50000

interface TokenPayload {
  toolName: string
  code: string
  ts: number
  nonce: string
}

export interface SecurityToken {
  token: string
  expiresAt: number
}

export class SecurityPolicy {
  private issuedTokens = new Map<string, TokenPayload>()

  /** Generate a one-time HMAC token for dangerous code execution. */
  issueToken(toolName: string, code: string): SecurityToken {
    const nonce = randomBytes(16).toString("hex")
    const ts = Date.now()
    const payload: TokenPayload = { toolName, code, ts, nonce }
    const token = this._sign(payload)
    this.issuedTokens.set(token, payload)
    // Auto-expire
    setTimeout(() => this.issuedTokens.delete(token), TOKEN_TTL_MS)
    return { token, expiresAt: ts + TOKEN_TTL_MS }
  }

  /** Validate that a token was issued by us and matches the tool/code. */
  validateToken(token: string, toolName: string, code: string): boolean {
    const payload = this.issuedTokens.get(token)
    if (!payload) return false
    if (payload.toolName !== toolName) return false
    if (Date.now() > payload.ts + TOKEN_TTL_MS) {
      this.issuedTokens.delete(token)
      return false
    }
    // Constant-time comparison to prevent timing attacks
    const expected = this._sign(payload)
    if (!timingSafeEqual(token, expected)) return false
    // Code must match (within length limits)
    if (code.length > MAX_CODE_LENGTH) return false
    if (payload.code !== code) return false
    // One-time use
    this.issuedTokens.delete(token)
    return true
  }

  /** Check code/expression length limits. */
  checkLength(toolName: string, code: string): { ok: boolean; error?: string } {
    const limit = toolName === "osascript_eval" ? MAX_EXPRESSION_LENGTH : MAX_CODE_LENGTH
    if (code.length > limit) {
      return { ok: false, error: `Code exceeds maximum length (${limit} chars)` }
    }
    return { ok: true }
  }

  private _sign(payload: TokenPayload): string {
    const data = `${payload.toolName}:${payload.code}:${payload.ts}:${payload.nonce}`
    const sig = createHmac("sha256", TOKEN_SECRET).update(data).digest("hex")
    return `${sig}:${payload.nonce}:${payload.ts}`
  }
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let result = 0
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return result === 0
}

// Singleton instance
export const securityPolicy = new SecurityPolicy()

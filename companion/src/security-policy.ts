// Unified SecurityPolicy — HMAC token generation/validation for evaluate confirmation
// and centralized security checks for high-risk tool execution.

import { createHmac, randomBytes, createHash } from "crypto"

const TOKEN_SECRET = process.env.CMSPARK_SECURITY_SECRET || randomBytes(32).toString("hex")
export function getTokenSecret(): string {
  return TOKEN_SECRET
}
const TOKEN_TTL_MS = 2 * 60 * 1000 // 2 minutes
const MAX_CODE_LENGTH = 50000
const MAX_EXPRESSION_LENGTH = 50000

interface TokenPayload {
  toolName: string
  code: string
  ts: number
  nonce: string
  codeHash: string
  threadId: string
}

export interface SecurityToken {
  token: string
  expiresAt: number
}

export class SecurityPolicy {
  private issuedTokens = new Map<string, TokenPayload>()

  /** Generate a hash for the given code. */
  private _hashCode(code: string): string {
    return createHash("sha256").update(code).digest("hex").slice(0, 16)
  }

  /**
   * Phase 1 W8 bugfix (Kimi+Pi advisor Fix C): Compute the token-binding payload
   * for a given tool. Token is bound to (toolName, code, threadId); this helper
   * centralizes what "code" means per tool so issuance and validation CANNOT
   * diverge. Previously, gate issued with `code=""` for host_read/host_write
   * but cases validated with `application`/`kind` → mismatch → "Invalid token".
   *
   * Adding a new L2-gated tool: extend this function ONLY. Both issuance
   * (server.ts L2 gate) and validation (executeCompanionTool cases) call this.
   */
  static bindingPayloadFor(toolName: string, params: Record<string, any>): string {
    switch (toolName) {
      case "evaluate":
        return String(params?.code || "")
      case "osascript_eval":
        return String(params?.expression || "")
      case "host_read":
        return String(params?.application || "")
      case "host_write":
        return String(params?.kind || "")
      case "host_app":
        // App tab WP3 (adversary 接线警示 ②): bind the launch target + action.
        // MUST be non-empty for a well-formed call — an empty payload would
        // make tokens replayable across apps (the `default: ""` footgun).
        return `${String(params?.app || "")}|${String(params?.action || "")}`
      case "host_computer": {
        // Coordinate computer-use (A3): bind app + task + the FULL action draft
        // (incl. every type.text literal via the corpus hash) so a tampered
        // draft fails token validation.
        const { computerBindingPayload } = require("./computer/types") as typeof import("./computer/types")
        return computerBindingPayload(params ?? {})
      }
      default:
        return ""
    }
  }

  /** Generate a one-time HMAC token for dangerous code execution. */
  issueToken(toolName: string, code: string, threadId = "default"): SecurityToken {
    const nonce = randomBytes(16).toString("hex")
    const ts = Date.now()
    const codeHash = this._hashCode(code)
    const payload: TokenPayload = { toolName, code, ts, nonce, codeHash, threadId }
    const token = this._sign(payload)
    this.issuedTokens.set(token, payload)
    // Auto-expire. `.unref()` so this TTL timer doesn't keep the process (or the node:test
    // runner) alive on its own — tokens are in-memory and die with the process anyway.
    const expiryTimer = setTimeout(() => this.issuedTokens.delete(token), TOKEN_TTL_MS)
    expiryTimer.unref()
    return { token, expiresAt: ts + TOKEN_TTL_MS }
  }

  /**
   * Thin wrapper: issue token for a tool's params. Use this from L2 gate to
   * guarantee binding payload matches what the validateToken case will check.
   */
  issueTokenFor(toolName: string, params: Record<string, any>, threadId = "default"): SecurityToken {
    return this.issueToken(toolName, SecurityPolicy.bindingPayloadFor(toolName, params), threadId)
  }

  /**
   * Thin wrapper: validate token for a tool's params. Use this from
   * executeCompanionTool cases to guarantee binding payload matches what the
   * L2 gate issued.
   */
  validateTokenFor(token: string, toolName: string, params: Record<string, any>, threadId = "default"): boolean {
    return this.validateToken(token, toolName, SecurityPolicy.bindingPayloadFor(toolName, params), threadId)
  }

  /** Validate that a token was issued by us and matches the tool/code/thread. */
  validateToken(token: string, toolName: string, code: string, threadId = "default"): boolean {
    const payload = this.issuedTokens.get(token)
    if (!payload) return false
    if (payload.toolName !== toolName) return false
    if (payload.threadId !== threadId) return false
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
    // One-time use — invalidate immediately after validation
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
    const data = `${payload.toolName}:${payload.code}:${payload.ts}:${payload.nonce}:${payload.codeHash}:${payload.threadId}`
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

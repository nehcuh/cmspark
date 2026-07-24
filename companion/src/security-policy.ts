// Unified SecurityPolicy — HMAC token generation/validation for evaluate confirmation
// and centralized security checks for high-risk tool execution.

import { createHmac, randomBytes, createHash, timingSafeEqual as cryptoTimingSafeEqual } from "crypto"

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

  /**
   * Validate that a token was issued by us and matches the tool/code/thread.
   *
   * S-P0-5 (2026-07-24): closing timing oracles.
   * Previously, every field check was an early-return — `if (!payload)`, `if (toolName !== toolName)`,
   * `if (threadId !== threadId)`, `if (expired)` — so an attacker could distinguish "no token"
   * from "wrong toolName" from "wrong threadId" from "expired" by response timing, then target
   * the slowest path. Additionally, the final `payload.code !== code` was a non-constant-time
   * string compare on attacker-influenceable data, and `code.length > MAX_CODE_LENGTH` was a
   * short-circuit before that compare.
   *
   * Now: compute ALL the equality checks, AND them together, return the AND. Single early
   * return on `!payload` (Map lookup is unavoidable). The `code` compare is hashed + constant-time
   * so length probing doesn't help.
   *
   * A11/A12 (Grok round 2): switched hand-rolled `timingSafeEqual` loop to
   * `crypto.timingSafeEqual` on equal-length Buffers (matches `ws-auth.ts`,
   * `settings-web.ts` — less DIY risk). Map-miss early return is inherent
   * (Map lookup has no constant-time primitive); the `sigOk` re-check is
   * effectively a Map-integrity check only — for un-tampered entries it's
   * always true because `token` is the Map key and equals `_sign(payload)`.
   * Real residual oracles are field/TTL/length paths AFTER a Map hit, which
   * already require the attacker to hold a live token — bounded threat.
   */
  validateToken(token: string, toolName: string, code: string, threadId = "default"): boolean {
    const payload = this.issuedTokens.get(token)
    if (!payload) return false

    // Constant-time HMAC signature comparison — authoritative; integrity-of-Map only.
    const expected = this._sign(payload)
    const sigOk = timingSafeEqual(token, expected)

    // Constant-time field comparisons.
    const toolOk = timingSafeEqual(payload.toolName, toolName)
    const threadOk = timingSafeEqual(payload.threadId, threadId)

    // TTL check — timing here reveals "valid signature + valid fields + expired"
    // vs "valid signature + valid fields + live". Acceptable: knowing a token
    // expired doesn't help (token is already single-use, deleted below).
    const live = Date.now() <= payload.ts + TOKEN_TTL_MS
    if (!live) {
      this.issuedTokens.delete(token)
      return false
    }

    // Length cap on inbound code BEFORE hashing — avoids hashing a 1MB string,
    // but the comparison itself is constant-time via hash equality. Length leak
    // here only tells the attacker "the issued code was >MAX_CODE_LENGTH" —
    // already impossible because issueToken hashes a string the SAME size.
    if (code.length > MAX_CODE_LENGTH) {
      if (sigOk) this.issuedTokens.delete(token)
      return false
    }

    // Code equality via hash: avoid non-constant-time string compare on
    // attacker-influenceable input. payload.codeHash is sha256(prefix) of the
    // original code at issue time; we hash the inbound code the same way and
    // compare in constant time.
    const inboundHash = this._hashCode(code)
    const codeOk = timingSafeEqual(payload.codeHash, inboundHash)

    const ok = sigOk && toolOk && threadOk && codeOk
    if (ok) {
      this.issuedTokens.delete(token)
    }
    return ok
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

/**
 * Constant-time string equality via crypto.timingSafeEqual.
 * A11 (Grok round 2): replaced hand-rolled loop with the stdlib version
 * already used in ws-auth.ts / settings-web.ts. Same length-check semantics
 * (returns false on length mismatch, which leaks length — acceptable for
 * fixed-width HMAC sigs and short tool/thread IDs).
 *
 * A11 follow-up (Grok round 3): equal JS string length + unequal UTF-8 byte
 * length (e.g. `"a"` vs `"é"` — both length 1, but UTF-8 is 1 vs 2 bytes)
 * makes crypto.timingSafeEqual throw RangeError. Wrap in try/catch → false.
 * For our inputs this is unreachable (toolName/threadId are ASCII, codeHash
 * is 16-hex, HMAC sig is 64-hex), but defensive is correct.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  try {
    return cryptoTimingSafeEqual(Buffer.from(a), Buffer.from(b))
  } catch {
    return false
  }
}

// Singleton instance
export const securityPolicy = new SecurityPolicy()

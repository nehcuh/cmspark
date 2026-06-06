// Security token validation for extension side
// Uses Web Crypto API (SubtleCrypto) for HMAC-SHA256 validation
// Must stay in sync with companion/src/security-policy.ts

const TOKEN_TTL_MS = 5 * 60 * 1000 // 5 minutes
const MAX_CODE_LENGTH = 50000

let sharedSecret: string | null = null

/** Called when the companion sends its security config on connection. */
export function setSecuritySecret(secret: string) {
  sharedSecret = secret
}

interface TokenPayload {
  toolName: string
  code: string
  ts: number
  nonce: string
}

async function signPayload(payload: TokenPayload, secret: string): Promise<string> {
  const data = `${payload.toolName}:${payload.code}:${payload.ts}:${payload.nonce}`
  const encoder = new TextEncoder()
  const keyData = encoder.encode(secret)
  const messageData = encoder.encode(data)

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )

  const signature = await crypto.subtle.sign("HMAC", cryptoKey, messageData)
  const sigHex = Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("")

  return `${sigHex}:${payload.nonce}:${payload.ts}`
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let result = 0
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return result === 0
}

/** Validate a security token was issued by the companion and matches the tool/code. */
export async function validateSecurityToken(
  token: string,
  toolName: string,
  code: string,
): Promise<boolean> {
  if (!sharedSecret) {
    console.warn("[BrowserBridge] Security secret not received from companion yet")
    return false
  }
  if (!token || typeof token !== "string") return false

  const parts = token.split(":")
  if (parts.length !== 3) return false

  const [, nonce, tsStr] = parts
  const ts = parseInt(tsStr, 10)
  if (isNaN(ts)) return false

  // Check expiration
  if (Date.now() > ts + TOKEN_TTL_MS) return false

  // Check code length
  if (code.length > MAX_CODE_LENGTH) return false

  const payload: TokenPayload = { toolName, code, ts, nonce }
  const expected = await signPayload(payload, sharedSecret)

  return timingSafeEqual(token, expected)
}

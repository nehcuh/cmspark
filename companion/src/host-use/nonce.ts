// Phase 1 W8-windows / W9-linux — manual nonce generator for the biometric
// tier's fallback path. Implementation moved verbatim from
// host-use/darwin/index.ts (generateLinuxNonce) so both platforms share one
// generator; darwin/index.ts re-exports it as generateLinuxNonce to keep the
// existing linux-nonce test import green.

import { randomBytes } from "crypto"

/**
 * Generates a 6-char alphanumeric code (excluding ambiguous chars like 0/O/1/I)
 * that the user must TYPE BACK in the extension UI (paste blocked). The code
 * is sent via security.confirmation.request.nonceChallenge; user response
 * arrives via security.confirmation.response.nonce_response.
 *
 * Caller (server.ts host_write path) is responsible for:
 *   1. Sending the confirmation request with nonceChallenge set
 *   2. Validating response nonce_response matches the challenge
 *   3. Rejecting after 3 failed attempts
 *
 * This function ONLY generates the code. Round 2 §2.3: "手动输入 6 位 nonce，
 * 不可复制粘贴". The paste-block is enforced in extension UI (onPaste handler).
 */
export function generateManualNonce(): string {
  // Ambiguous chars removed per standard Crockford-style / OS-otp conventions:
  //   0/O, 1/I/L, 2/Z, 5/S, 8/B
  // After removal: 21 letters + 4 digits = 25 chars.
  const alphabet = "ACDEFGHJKMNPQRTUVWXY34679"
  const out: string[] = []
  const bytes = randomBytes(6)
  for (let i = 0; i < 6; i++) {
    out.push(alphabet[bytes[i] % alphabet.length])
  }
  return out.join("")
}

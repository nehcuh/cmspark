/**
 * WS protocol version negotiation (P2 ARCH-PROTO-1).
 *
 * Companion advertises { protocol_version, protocol_min } on auth.ok.
 * Clients SHOULD send protocol_version on auth.handshake; if omitted, treat as 1
 * (legacy peers). Incompatible client versions are rejected before auth.ok.
 */

/** Current companion protocol version. */
export const PROTOCOL_VERSION = 1

/** Oldest client protocol still accepted. */
export const PROTOCOL_MIN = 1

/** Newest client protocol still accepted (inclusive). */
export const PROTOCOL_MAX = 1

export type ProtocolNegotiateResult =
  | { ok: true; negotiated: number }
  | { ok: false; error: string; client?: number }

/**
 * Negotiate client-reported protocol version.
 * @param clientVersion - number from auth.handshake.protocol_version, or undefined/legacy
 */
export function negotiateProtocolVersion(clientVersion: unknown): ProtocolNegotiateResult {
  if (clientVersion === undefined || clientVersion === null) {
    // Legacy peers that omit the field: accept as PROTOCOL_MIN
    return { ok: true, negotiated: PROTOCOL_MIN }
  }
  if (typeof clientVersion !== "number" || !Number.isInteger(clientVersion)) {
    return { ok: false, error: "auth.handshake protocol_version must be an integer" }
  }
  if (clientVersion < PROTOCOL_MIN) {
    return {
      ok: false,
      error: `protocol_version ${clientVersion} is below minimum ${PROTOCOL_MIN}`,
      client: clientVersion,
    }
  }
  if (clientVersion > PROTOCOL_MAX) {
    return {
      ok: false,
      error: `protocol_version ${clientVersion} is above maximum ${PROTOCOL_MAX}`,
      client: clientVersion,
    }
  }
  return { ok: true, negotiated: clientVersion }
}

/** Payload fields for auth.ok */
export function authOkProtocolFields(): {
  protocol_version: number
  protocol_min: number
  protocol_max: number
} {
  return {
    protocol_version: PROTOCOL_VERSION,
    protocol_min: PROTOCOL_MIN,
    protocol_max: PROTOCOL_MAX,
  }
}

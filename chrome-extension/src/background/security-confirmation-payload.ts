// Pure builder for security.confirmation.response WS payloads.
// Extracted so unit tests can exercise field-forwarding without loading the
// service-worker index (chrome APIs at module top-level).

/**
 * Build the WebSocket payload for security.confirmation.response.
 * Forwards Side Panel fields the companion handler already expects:
 * - add_to_whitelist (array)
 * - nonce_response (string, when present)
 * - add_to_thread_whitelist (boolean true only)
 * - stop_thread (boolean true only)
 */
export function buildSecurityConfirmationWsPayload(message: {
  confirmation_id?: unknown
  approved?: unknown
  add_to_whitelist?: unknown
  nonce_response?: unknown
  add_to_thread_whitelist?: unknown
  stop_thread?: unknown
}): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    type: "security.confirmation.response",
    confirmation_id: message.confirmation_id,
    approved: message.approved === true,
    add_to_whitelist: Array.isArray(message.add_to_whitelist) ? message.add_to_whitelist : [],
  }
  if (typeof message.nonce_response === "string") {
    payload.nonce_response = message.nonce_response
  }
  if (message.add_to_thread_whitelist === true) {
    payload.add_to_thread_whitelist = true
  }
  if (message.stop_thread === true) {
    payload.stop_thread = true
  }
  return payload
}

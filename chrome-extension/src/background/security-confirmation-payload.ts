// Pure builder for security.confirmation.response WS payloads.
// Extracted so unit tests can exercise field-forwarding without loading the
// service-worker index (chrome APIs at module top-level).

/**
 * Build the WebSocket payload for security.confirmation.response.
 * Forwards Side Panel fields the companion handler already expects:
 * - add_to_whitelist (array)
 * - nonce_response (string, when present)
 * - add_to_thread_whitelist (boolean true only)
 * - add_to_session_trust (boolean true only — host_computer grill Q2)
 * - stop_thread (boolean true only)
 * - stop_thread_id (string, when stop_thread and non-empty string)
 */
export function buildSecurityConfirmationWsPayload(message: {
  confirmation_id?: unknown
  approved?: unknown
  add_to_whitelist?: unknown
  nonce_response?: unknown
  add_to_thread_whitelist?: unknown
  add_to_session_trust?: unknown
  stop_thread?: unknown
  stop_thread_id?: unknown
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
  if (message.add_to_session_trust === true) {
    payload.add_to_session_trust = true
  }
  if (message.stop_thread === true) {
    payload.stop_thread = true
    if (typeof message.stop_thread_id === "string" && message.stop_thread_id.length > 0) {
      payload.stop_thread_id = message.stop_thread_id
    }
  }
  return payload
}

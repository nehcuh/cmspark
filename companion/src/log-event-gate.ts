// Per-connection rate limit for inbound `log.event` (observability path).
//
// Defense-in-depth against extension / tray clients that accidentally flood
// the companion with log.event (see dual-review log-event-echo-loop-rca).
// Primary loop break is extension-side (no logToCompanion on forward failure)
// + no echo-to-sender in server.ts; this gate caps residual abuse.

import type { WebSocket } from "ws"

/** Hard cap: token bucket capacity and refill rate (tokens per second). */
export const LOG_EVENT_MAX_PER_SEC = 10

type Bucket = { tokens: number; lastRefillMs: number }

const buckets = new WeakMap<WebSocket, Bucket>()

/**
 * Returns true if this connection may accept one more log.event at `nowMs`.
 * Token bucket: capacity = LOG_EVENT_MAX_PER_SEC, refill 1 token per 1000/MAX ms.
 */
export function allowInboundLogEvent(ws: WebSocket, nowMs: number = Date.now()): boolean {
  let b = buckets.get(ws)
  if (!b) {
    b = { tokens: LOG_EVENT_MAX_PER_SEC, lastRefillMs: nowMs }
    buckets.set(ws, b)
  }

  const elapsed = nowMs - b.lastRefillMs
  if (elapsed > 0) {
    const refill = (elapsed / 1000) * LOG_EVENT_MAX_PER_SEC
    b.tokens = Math.min(LOG_EVENT_MAX_PER_SEC, b.tokens + refill)
    b.lastRefillMs = nowMs
  }

  if (b.tokens < 1) return false
  b.tokens -= 1
  return true
}

/** Test-only: force a known bucket state for a socket. */
export function seedLogEventBucketForTests(
  ws: WebSocket,
  state: { tokens: number; lastRefillMs: number },
): void {
  buckets.set(ws, { ...state })
}

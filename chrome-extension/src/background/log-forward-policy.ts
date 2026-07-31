// Policy helpers for extension → companion logging and sidepanel fan-out.
//
// Closes the log.event echo loop (dual-review log-event-echo-loop-rca):
//   companion echoed log.event → background sendMessage failed (panel closed)
//   → logToCompanion(sidepanel_forward_failed) → companion echo → …
//
// Rules:
// 1. Never report sidepanel_forward_failed back over WS (console only).
// 2. Extension-originated logs fan out locally via chrome.runtime.sendMessage
//    so Side Panel live log still works without companion echo-to-sender.

export type LogLevel = "debug" | "info" | "warn" | "error"

export interface LogEventWire {
  type: "log.event"
  source: "extension"
  level: LogLevel
  event: string
  data: Record<string, unknown>
}

/** Build the wire payload used for both local fan-out and companion upload. */
export function buildLogEventPayload(
  level: LogLevel,
  event: string,
  data: Record<string, unknown> = {},
): LogEventWire {
  return {
    type: "log.event",
    source: "extension",
    level,
    event,
    data,
  }
}

/**
 * Whether a failed chrome.runtime.sendMessage (no receivers) should be
 * reported back to the companion as log.event.
 *
 * ALWAYS false — that path is the injection point of the echo loop.
 */
export function shouldReportForwardFailureToCompanion(_messageType: string): boolean {
  return false
}

/**
 * Console policy for forward failures: one warn per session, then debug.
 * Returns the level to use and whether to flip the session-warned flag.
 */
export function forwardFailureConsoleLevel(sessionAlreadyWarned: boolean): {
  level: "warn" | "debug"
  nextWarned: true
} {
  return {
    level: sessionAlreadyWarned ? "debug" : "warn",
    nextWarned: true,
  }
}

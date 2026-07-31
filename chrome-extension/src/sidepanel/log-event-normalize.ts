// Normalize inbound log.event messages for Side Panel live log.
//
// Wire shape (extension buildLogEventPayload / companion historical echo):
//   { type: "log.event", source, level, event, data, ts? }
//
// Legacy mistaken consumer expected nested:
//   { type: "log.event", data: { source, level, event, data, ts? } }
//
// Accept both; prefer top-level. Hide debug.

export type LogEntryLevel = "error" | "info" | "warn" | "debug"

export type NormalizedLogEntry = {
  ts: string
  level: LogEntryLevel
  source: string
  event: string
  data: Record<string, unknown>
}

function coerceLevel(raw: unknown): LogEntryLevel {
  if (raw === "error" || raw === "warn" || raw === "debug" || raw === "info") return raw
  return "info"
}

/**
 * Returns a store-ready log entry, or null if the message should be ignored
 * (debug level / unusable payload).
 */
export function normalizeInboundLogEvent(msg: any): NormalizedLogEntry | null {
  if (!msg || typeof msg !== "object") return null

  const topLevel =
    typeof msg.level === "string" || typeof msg.event === "string" || typeof msg.source === "string"

  const envelope = topLevel
    ? msg
    : msg.data && typeof msg.data === "object"
      ? msg.data
      : null

  if (!envelope) return null

  const level = coerceLevel(envelope.level)
  if (level === "debug") return null

  const source = typeof envelope.source === "string" ? envelope.source : "unknown"
  const event = typeof envelope.event === "string" ? envelope.event : "unknown"

  let data: Record<string, unknown> = {}
  if (topLevel) {
    if (msg.data && typeof msg.data === "object" && !Array.isArray(msg.data)) {
      data = msg.data as Record<string, unknown>
    }
  } else if (envelope.data && typeof envelope.data === "object" && !Array.isArray(envelope.data)) {
    data = envelope.data as Record<string, unknown>
  }

  const ts =
    (typeof msg.ts === "string" && msg.ts) ||
    (typeof envelope.ts === "string" && envelope.ts) ||
    new Date().toISOString()

  return { ts, level, source, event, data }
}

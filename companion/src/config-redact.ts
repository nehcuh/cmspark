/**
 * Single source of truth for redacting config before it leaves Companion over
 * the wire (config.get / config.set responses / config.updated broadcasts).
 *
 * SRV-1: never mutate the caller's object — always return a shallow-copied tree
 * for redacted branches. Callers that need to persist must use the unredacted original.
 */

/** Mask extra_headers values (key names preserved for UI "configured" signals). */
export function redactExtraHeaders(
  headers: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!headers || typeof headers !== "object") return undefined
  const out: Record<string, string> = {}
  for (const k of Object.keys(headers)) {
    out[k] = "***"
  }
  return out
}

/**
 * Redact secrets for any config payload sent to the extension (or other WS peers).
 * - llm / vision api_key → "***" when set, "" when empty
 * - llm.extra_headers values → "***"
 * - mcp.servers[*].env / headers values → "***" (keys preserved)
 */
export function redactConfigForWire(config: any): any {
  if (!config || typeof config !== "object") return config

  const redacted: any = { ...config }

  if (config.llm && typeof config.llm === "object") {
    redacted.llm = {
      ...config.llm,
      api_key: config.llm.api_key ? "***" : "",
      extra_headers: redactExtraHeaders(config.llm.extra_headers),
    }
  }

  if (config.vision && typeof config.vision === "object") {
    redacted.vision = {
      ...config.vision,
      api_key: config.vision.api_key ? "***" : "",
    }
  }

  if (config.mcp && typeof config.mcp === "object") {
    const serversIn = config.mcp.servers
    if (serversIn && typeof serversIn === "object") {
      const serversOut: Record<string, any> = {}
      for (const [name, raw] of Object.entries(serversIn as Record<string, any>)) {
        if (!raw || typeof raw !== "object") {
          serversOut[name] = raw
          continue
        }
        const server: any = { ...raw }
        if (server.env && typeof server.env === "object") {
          const env: Record<string, string> = {}
          for (const k of Object.keys(server.env)) {
            env[k] = "***"
          }
          server.env = env
        }
        if (server.headers && typeof server.headers === "object") {
          const headers: Record<string, string> = {}
          for (const k of Object.keys(server.headers)) {
            headers[k] = "***"
          }
          server.headers = headers
        }
        serversOut[name] = server
      }
      redacted.mcp = { ...config.mcp, servers: serversOut }
    }
  }

  return redacted
}

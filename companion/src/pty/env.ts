// PTY child env: user-env secrets in, companion credentials out (spec §5).

import { getUserEnvVars, isCmsparkPrefixKey } from "../user-env"

const STRIP_EXACT = new Set([
  "api_key",
  "API_KEY",
  "ws_secret",
  "WS_SECRET",
])

function shouldStrip(key: string): boolean {
  if (isCmsparkPrefixKey(key)) return true
  if (STRIP_EXACT.has(key)) return true
  return false
}

export function buildTerminalEnv(): Record<string, string> {
  // Confirmed user shell: retain user Agent API keys and HOME-based login files.
  // Do not read Companion config credentials or serialize this map over WS.
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v !== "string") continue
    if (shouldStrip(k)) continue
    out[k] = v
  }
  for (const [k, v] of Object.entries(getUserEnvVars())) {
    if (shouldStrip(k)) continue
    out[k] = v
  }
  out.TERM = "xterm-256color"
  return out
}

// Tray pairing helpers — read the WS shared secret + "has any peer ever paired" marker.
//
// These back the tray's pairing-code popup (so users never need the command line to
// pair the Chrome extension). Kept pure — `configDir` is injected — so they can be
// unit-tested without touching the real data directory. Path semantics MUST stay in
// lock-step with ws-auth.ts (SECRET_PATH / PAIRED_PATH) and config.ts (DATA_DIR):
// all three resolve under the same ~/.cmspark-agent dir.

import * as fs from "fs"
import * as path from "path"

/** File holding the 64-hex-char WS shared secret (written by ws-auth.getOrCreateSharedSecret). */
export const WS_SECRET_FILENAME = "ws_secret"
/** Marker written by the companion the first time any peer completes the WS handshake. */
export const PAIRED_MARKER_FILENAME = ".paired"

export function getWsSecretPath(configDir: string): string {
  return path.join(configDir, WS_SECRET_FILENAME)
}

export function getPairedMarkerPath(configDir: string): string {
  return path.join(configDir, PAIRED_MARKER_FILENAME)
}

/**
 * Read + trim the WS shared secret for display in the pairing popup. Returns "" when
 * the secret is missing or unreadable (e.g. companion hasn't generated it yet) and
 * NEVER throws — the caller treats "" as "not ready, retry later".
 */
export function readPairingSecret(configDir: string): string {
  try {
    return fs.readFileSync(getWsSecretPath(configDir), "utf8").trim()
  } catch {
    return ""
  }
}

/**
 * True iff some peer has ever completed the WS auth handshake. The companion writes
 * the marker (ws-auth.markPaired) on first successful auth, so once the extension
 * has paired this returns true forever — letting the tray stop auto-surfacing the
 * secret. Best-effort: a missing marker just means "treat as unpaired".
 */
export function hasPaired(configDir: string): boolean {
  try {
    return fs.existsSync(getPairedMarkerPath(configDir))
  } catch {
    return false
  }
}

export interface ClipboardAvailability {
  xclip?: boolean
  xsel?: boolean
  wlCopy?: boolean
}

export interface ClipboardCommand {
  cmd: string
  args: string[]
}

/** Resolve clipboard commands in session order; all read the copied text from stdin. */
export function resolveClipboardCommands(
  platform: string,
  available: ClipboardAvailability,
  session: { wayland?: boolean } = {},
): ClipboardCommand[] {
  if (platform === "darwin") return [{ cmd: "pbcopy", args: [] }]
  if (platform === "win32") return [{ cmd: "clip", args: [] }]
  if (platform !== "linux") return []

  const commands: Record<keyof ClipboardAvailability, ClipboardCommand> = {
    xclip: { cmd: "xclip", args: ["-selection", "clipboard"] },
    xsel: { cmd: "xsel", args: ["--clipboard", "--input"] },
    wlCopy: { cmd: "wl-copy", args: [] },
  }
  const order: Array<keyof ClipboardAvailability> = session.wayland
    ? ["wlCopy", "xclip", "xsel"]
    : ["xclip", "xsel", "wlCopy"]
  return order.filter((tool) => available[tool]).map((tool) => commands[tool])
}

export function resolveClipboardCommand(
  platform: string,
  available: ClipboardAvailability,
  session: { wayland?: boolean } = {},
): ClipboardCommand | null {
  return resolveClipboardCommands(platform, available, session)[0] ?? null
}

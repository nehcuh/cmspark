import * as fs from "node:fs"
import * as path from "node:path"

function meetingsRoot(dataDir: string): string {
  return path.join(dataDir, "meetings")
}

export function meetingDir(id: string, dataDir: string): string {
  return path.join(meetingsRoot(dataDir), id)
}

/** Ensure id is a safe single path segment. */
export function isSafeMeetingId(id: string): boolean {
  return typeof id === "string" && /^[a-zA-Z0-9][a-zA-Z0-9_-]{7,63}$/.test(id)
}

export function ensureMeetingsRoot(dataDir: string): string {
  const root = meetingsRoot(dataDir)
  fs.mkdirSync(root, { recursive: true, mode: 0o700 })
  try {
    fs.chmodSync(root, 0o700)
  } catch {
    /* windows */
  }
  return root
}

export function resolveMeetingDir(id: string, dataDir: string): string | null {
  if (!isSafeMeetingId(id)) return null
  const root = path.resolve(ensureMeetingsRoot(dataDir))
  const dir = path.resolve(meetingDir(id, dataDir))
  if (dir !== root && !dir.startsWith(root + path.sep)) return null
  return dir
}

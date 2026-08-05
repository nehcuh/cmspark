// Process PATH hardening for child_process spawns.
//
// GUI / .app / launchd launches sometimes inherit a stripped or *corrupted* PATH.
// A known production failure (thread 7ae7da): PATH was set to the path of
// cmspark-agent.js (a *file*). Node's spawn then walks PATH entries as
// directories and fails with `spawn ENOTDIR` for bare commands like `osascript`.
//
// This module:
//   1. Drops non-directory PATH segments (files → ENOTDIR)
//   2. Ensures essential system bins exist (/usr/bin, /bin, …)
//   3. Exposes absolute OSASCRIPT_BIN so macOS tools never depend on PATH

import * as fs from "fs"
import * as os from "os"
import * as path from "path"

/**
 * Absolute path to macOS `osascript`. Prefer this over bare `"osascript"` so
 * execFile survives a corrupted PATH (file-in-PATH / empty PATH).
 * Non-darwin callers should not use this tool; the binary simply will not exist.
 */
export const OSASCRIPT_BIN = "/usr/bin/osascript"

export type PathHardenDeps = {
  /** Raw PATH string to harden (default: process.env.PATH). */
  pathEnv?: string
  platform?: NodeJS.Platform
  execPath?: string
  homedir?: () => string
  /** Injected for tests — return true if segment is a usable directory. */
  isDirectory?: (p: string) => boolean
  delimiter?: string
}

function defaultIsDirectory(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory()
  } catch {
    return false
  }
}

/** Split a PATH string; empty segments dropped. */
export function splitPathEnv(pathEnv: string, delimiter: string = path.delimiter): string[] {
  if (!pathEnv) return []
  return pathEnv
    .split(delimiter)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

/**
 * Keep only path segments that are real directories.
 * File entries (and missing paths) are dropped — they cause `spawn ENOTDIR`.
 */
export function keepOnlyDirectories(
  segments: string[],
  isDirectory: (p: string) => boolean = defaultIsDirectory,
): string[] {
  return segments.filter((s) => isDirectory(s))
}

/** Essential bins that must be present for shell/os tools under GUI launch. */
export function essentialPathCandidates(
  platform: NodeJS.Platform = process.platform,
  deps: { execPath?: string; homedir?: () => string } = {},
): string[] {
  const execPath = deps.execPath ?? process.execPath
  const home = (deps.homedir ?? os.homedir)()
  const out: string[] = []
  try {
    out.push(path.dirname(execPath))
  } catch {
    /* ignore */
  }
  if (platform === "win32") {
    const root = process.env.SystemRoot || process.env.SYSTEMROOT || "C:\\Windows"
    out.push(
      path.join(root, "System32"),
      root,
      path.join(root, "System32", "Wbem"),
      path.join(root, "System32", "WindowsPowerShell", "v1.0"),
      path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), "npm"),
      path.join(process.env.ProgramFiles || "C:\\Program Files", "nodejs"),
    )
  } else {
    // Unix essentials (appended by hardenPath only if missing — user order kept).
    out.push(
      "/usr/bin",
      "/bin",
      "/usr/sbin",
      "/sbin",
      "/usr/local/bin",
      "/usr/local/sbin",
      "/opt/homebrew/bin",
      "/opt/homebrew/sbin",
      path.join(home, ".local", "bin"),
    )
  }
  return out
}

/**
 * Produce a spawn-safe PATH:
 * - drop non-directory segments from the input PATH (files → spawn ENOTDIR)
 * - keep remaining user order (first-wins) so Homebrew/nvm stay preferred when valid
 * - append essential system bins only if missing (GUI/corrupt PATH recovery)
 * - de-dupe (first wins)
 */
export function hardenPath(deps: PathHardenDeps = {}): string {
  const delimiter = deps.delimiter ?? path.delimiter
  const platform = deps.platform ?? process.platform
  const isDirectory = deps.isDirectory ?? defaultIsDirectory
  const raw = deps.pathEnv ?? process.env.PATH ?? process.env.Path ?? ""

  const filteredExisting = keepOnlyDirectories(splitPathEnv(raw, delimiter), isDirectory)
  const out: string[] = []
  const seen = new Set<string>()
  for (const s of filteredExisting) {
    if (seen.has(s)) continue
    seen.add(s)
    out.push(s)
  }
  for (const c of essentialPathCandidates(platform, {
    execPath: deps.execPath,
    homedir: deps.homedir,
  })) {
    if (!c || seen.has(c) || !isDirectory(c)) continue
    seen.add(c)
    out.push(c)
  }
  return out.join(delimiter)
}

/**
 * Rewrite `process.env.PATH` to a hardened value. Safe to call multiple times.
 * Returns whether the string changed (for logging).
 */
export function applyHardenedProcessPath(): { before: string; after: string; changed: boolean } {
  const before = process.env.PATH ?? ""
  const after = hardenPath({ pathEnv: before })
  if (after !== before) {
    process.env.PATH = after
  } else if (!process.env.PATH) {
    process.env.PATH = after
  }
  return { before, after, changed: after !== before }
}

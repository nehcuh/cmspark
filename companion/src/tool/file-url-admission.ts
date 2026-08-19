// Local file: URL parse + home/path cage for navigate / create_tab / set_tab_url.
// Do NOT reuse MCP extractPathCandidate / resolveAllowDirToOffer (localhost file
// URLs and cruise credential-drop are the wrong predicates). Import cage lists only.

import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { fileURLToPath } from "node:url"
import {
  isSensitiveSystemDir,
  isVolumeOrFsRoot,
  isMultiUserProfilesRoot,
  SENSITIVE_PATH_SEGMENTS,
  SENSITIVE_HOME_PREFIXES,
} from "../mcp/allow-dir-expand"

/** Machine token for classifyError + user-gate-copy (must not say 弹窗). */
export const FILE_OPEN_CAGE_TOKEN = "local path is not allowed (sensitive/system/unc)"

export function fileOpenCageError(toolName: string): string {
  return `Security Block: ${toolName} to ${FILE_OPEN_CAGE_TOKEN}.`
}

export function fileOpenInvalidError(toolName: string): string {
  return `Security Block: ${toolName} to file: URL is invalid. This is not a confirmation dialog.`
}

export type ParseLocalFileUrlResult =
  | { ok: true; absPath: string }
  | { ok: false; kind: "invalid" | "unc"; error: string }

export type FileOpenOfferResult =
  | { ok: true; realPath: string }
  | { ok: false; error: string }

function slash(p: string): string {
  return p.replace(/\\/g, "/")
}

function isDriveLetterHost(host: string): boolean {
  return /^[a-z]$/i.test(host)
}

function isUncPath(abs: string): boolean {
  const n = slash(abs)
  return n.startsWith("//") || abs.startsWith("\\\\")
}

function hasSensitivePathSegment(abs: string): string | null {
  const parts = slash(abs).toLowerCase().split("/").filter(Boolean)
  for (const seg of parts) {
    for (const blocked of SENSITIVE_PATH_SEGMENTS) {
      if (seg === blocked.toLowerCase()) return blocked
    }
  }
  return null
}

function hasSensitiveHomePrefix(abs: string, home: string): boolean {
  let rel: string
  try {
    rel = path.relative(home, abs)
  } catch {
    return false
  }
  if (rel.startsWith("..") || path.isAbsolute(rel)) return false
  const n = slash(rel).toLowerCase()
  return SENSITIVE_HOME_PREFIXES.some((p) => n === p || n.startsWith(p + "/"))
}

/** POSIX ∪ Windows system trees — path shape, not process.platform. */
export function isSensitiveLocalFilePath(abs: string): boolean {
  const n = slash(abs)
  if (isSensitiveSystemDir(n, "darwin")) return true
  if (isSensitiveSystemDir(n, "linux")) return true
  if (isSensitiveSystemDir(n, "win32")) return true
  return false
}

export function parseLocalFileUrl(raw: string): ParseLocalFileUrlResult {
  const cage = FILE_OPEN_CAGE_TOKEN
  let u: URL
  try {
    u = new URL(String(raw || ""))
  } catch {
    return { ok: false, kind: "invalid", error: cage }
  }
  if (u.protocol !== "file:") {
    return { ok: false, kind: "invalid", error: "not a file: URL" }
  }

  const host = (u.hostname || "").toLowerCase()
  if (host && host !== "localhost" && !isDriveLetterHost(host)) {
    return { ok: false, kind: "unc", error: cage }
  }

  let abs: string
  try {
    abs = fileURLToPath(u)
  } catch {
    if (isDriveLetterHost(host)) {
      const decoded = decodeURIComponent(u.pathname || "")
      abs = `${host.toUpperCase()}:${decoded}`
    } else {
      try {
        abs = decodeURIComponent(u.pathname || "")
      } catch {
        return { ok: false, kind: "invalid", error: "invalid file: URL" }
      }
    }
  }

  if (!abs || abs.includes("\0")) {
    return { ok: false, kind: "invalid", error: "invalid file: URL" }
  }
  if (isUncPath(abs)) {
    return { ok: false, kind: "unc", error: cage }
  }

  // Drive-letter paths must not go through POSIX path.resolve (would prefix cwd).
  if (/^[a-zA-Z]:[\\/]/.test(abs) && process.platform !== "win32") {
    abs = slash(abs)
  } else {
    abs = path.resolve(abs)
  }

  if (isUncPath(abs)) {
    return { ok: false, kind: "unc", error: cage }
  }
  return { ok: true, absPath: abs }
}

export function assertFileOpenOfferable(
  absPath: string,
  home = os.homedir(),
): FileOpenOfferResult {
  const cage = FILE_OPEN_CAGE_TOKEN
  if (!absPath || typeof absPath !== "string" || absPath.includes("\0")) {
    return { ok: false, error: cage }
  }

  const slashedInput = slash(absPath)
  if (isSensitiveLocalFilePath(slashedInput) || isSensitiveLocalFilePath(absPath)) {
    return { ok: false, error: cage }
  }
  if (hasSensitivePathSegment(absPath)) {
    return { ok: false, error: cage }
  }

  const winAbs = /^[a-zA-Z]:[\\/]/.test(absPath)
  let resolved = winAbs && process.platform !== "win32" ? slashedInput : path.resolve(absPath)

  const homeResolved = path.resolve(home)
  let homeReal = home
  try {
    homeReal = fs.realpathSync(home)
  } catch {
    homeReal = homeResolved
  }

  let real = resolved
  try {
    if (fs.existsSync(resolved)) {
      const st = fs.lstatSync(resolved)
      if (st.isSymbolicLink()) {
        try {
          real = fs.realpathSync(resolved)
        } catch {
          return { ok: false, error: cage }
        }
      } else {
        real = fs.realpathSync(resolved)
      }
    }
  } catch {
    real = resolved
  }

  if (isUncPath(real) || isVolumeOrFsRoot(real)) {
    return { ok: false, error: cage }
  }
  if (isMultiUserProfilesRoot(real, "win32") || isMultiUserProfilesRoot(real, "darwin")) {
    return { ok: false, error: cage }
  }
  if (isSensitiveLocalFilePath(real) || hasSensitivePathSegment(real)) {
    return { ok: false, error: cage }
  }
  if (
    hasSensitiveHomePrefix(real, homeReal) ||
    hasSensitiveHomePrefix(resolved, homeReal) ||
    hasSensitiveHomePrefix(real, homeResolved) ||
    hasSensitiveHomePrefix(resolved, homeResolved)
  ) {
    return { ok: false, error: cage }
  }

  const under = (p: string, h: string): boolean => {
    const rel = path.relative(h, p)
    return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel)
  }
  const underHomeReal = under(real, homeReal)
  const underHomeLexical = under(resolved, homeResolved) || under(resolved, homeReal)

  let existedFile = false
  try {
    existedFile = fs.existsSync(resolved)
  } catch {
    existedFile = false
  }

  if (existedFile) {
    // Existing path (incl. symlink): realpath must stay inside home.
    if (!underHomeReal) return { ok: false, error: cage }
  } else if (!underHomeLexical) {
    // Missing file: lexical path must sit under HOME (macOS /var vs /private/var).
    return { ok: false, error: cage }
  }

  return { ok: true, realPath: existedFile ? real : resolved }
}

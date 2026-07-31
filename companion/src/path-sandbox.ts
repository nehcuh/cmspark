// Download path sandbox — P1.0 browser_download (plan 2026-07-29).
// Mirrors host-use/win/adapter.ts isWithinRoot + realpath container checks.
// Roots for P1.0: user Downloads only.

import * as fs from "fs"
import * as os from "os"
import * as path from "path"

/** Typed path-escape error (error string must include PATH_ESCAPE for clients). */
export class PathEscapeError extends Error {
  readonly code = "PATH_ESCAPE" as const
  constructor(candidate: string, detail?: string) {
    super(
      detail
        ? `PATH_ESCAPE: download path not allowed (${detail}): ${candidate}`
        : `PATH_ESCAPE: download path not allowed: ${candidate}`,
    )
    this.name = "PathEscapeError"
  }
}

export interface PathSandboxFsOps {
  existsSync(p: string): boolean
  realpathSync(p: string): string
}

const defaultFsOps: PathSandboxFsOps = {
  existsSync: (p) => fs.existsSync(p),
  realpathSync: (p) => fs.realpathSync(p),
}

/**
 * Platform default user Downloads directory.
 * win32: %USERPROFILE%\Downloads (or homedir fallback)
 * darwin/linux: ~/Downloads
 */
export function getUserDownloadsDir(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  homedir: () => string = () => os.homedir(),
): string {
  if (platform === "win32") {
    const profile = env.USERPROFILE || homedir()
    return path.join(profile, "Downloads")
  }
  return path.join(homedir(), "Downloads")
}

/**
 * Allowlist boundary check (same contract as host-use/win/adapter isWithinRoot).
 * Case-insensitive: NTFS is case-preserving but case-insensitive; folding is
 * harmless on case-sensitive POSIX for our Downloads-only root model.
 * Boundary is exact-match OR root + path.sep (rejects Documents2 / Documents-evil).
 */
export function isWithinRoot(resolved: string, root: string): boolean {
  const resolvedLower = path.resolve(resolved).toLowerCase()
  const rootLower = path.resolve(root).toLowerCase()
  return (
    resolvedLower === rootLower ||
    resolvedLower.startsWith(rootLower + path.sep)
  )
}

/** True if candidate looks like a UNC or device-namespace path used to escape. */
export function isUncOrDevicePath(candidate: string): boolean {
  // Windows UNC: \\server\share or //server/share
  if (/^\\\\/.test(candidate) || /^\/\/[^/]/.test(candidate)) return true
  // Extended device path \\?\ that is not a simple drive form we already resolved
  if (/^\\\\\?\\/i.test(candidate) || /^\/\/\?\//.test(candidate)) return true
  // Normalized path.resolve on win may yield \\server\share
  const resolved = path.resolve(candidate)
  if (/^\\\\/.test(resolved)) return true
  return false
}

/**
 * Allow download directory if:
 * 1) path.resolve(candidate) isWithinRoot some allowlisted root
 * 2) realpath of existing path OR realpath(dirname) for nonexistent leaf
 *    stays within root (junction / TOCTOU)
 * Reject: UNC, device prefixes used to escape, other-drive relatives, ".." escapes
 *
 * Returns the resolved absolute path (not necessarily realpath'd leaf).
 */
export function assertDownloadPathAllowed(
  candidate: string,
  roots: string[],
  fsOps: PathSandboxFsOps = defaultFsOps,
): string {
  if (typeof candidate !== "string" || !candidate.trim()) {
    throw new PathEscapeError(String(candidate), "empty")
  }
  if (isUncOrDevicePath(candidate)) {
    throw new PathEscapeError(candidate, "UNC or device path")
  }
  const resolved = path.resolve(candidate)
  if (isUncOrDevicePath(resolved)) {
    throw new PathEscapeError(candidate, "UNC after resolve")
  }
  if (!roots.some((r) => isWithinRoot(resolved, r))) {
    throw new PathEscapeError(candidate, "outside allowlisted roots")
  }
  let container: string
  try {
    if (fsOps.existsSync(resolved)) {
      container = fsOps.realpathSync(resolved)
    } else {
      const parent = path.dirname(resolved)
      if (!fsOps.existsSync(parent)) {
        // Parent missing: only allow if resolved is still under a root by string check
        // (already done). Require parent to exist so realpath can pin the container.
        throw new PathEscapeError(candidate, "parent directory does not exist")
      }
      container = fsOps.realpathSync(parent)
    }
  } catch (e) {
    if (e instanceof PathEscapeError) throw e
    throw new PathEscapeError(candidate, `realpath failed: ${(e as Error)?.message || e}`)
  }
  if (!roots.some((r) => isWithinRoot(container, r))) {
    throw new PathEscapeError(candidate, "realpath container outside roots")
  }
  return resolved
}

/**
 * Prepare browser_download params for extension dispatch.
 * - Forces default Downloads when downloadPath omitted
 * - Worker: deny non-default custom path (WORKER_PATH_DENIED)
 * - Replaces LLM path with sandboxed absolute path only
 * - auto_approve_dangerous must NEVER call this with relaxed roots
 */
export function prepareBrowserDownloadParams(opts: {
  params: Record<string, any>
  isWorker: boolean
  roots?: string[]
  fsOps?: PathSandboxFsOps
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  homedir?: () => string
}):
  | { ok: true; params: Record<string, any>; downloadPath: string }
  | { ok: false; error: string; error_code: string; data?: Record<string, unknown> } {
  const platform = opts.platform ?? process.platform
  const downloads = getUserDownloadsDir(platform, opts.env, opts.homedir)
  const roots = opts.roots ?? [downloads]
  const raw = opts.params || {}
  const hasCustom =
    typeof raw.downloadPath === "string" && raw.downloadPath.trim().length > 0

  if (opts.isWorker && hasCustom) {
    const custom = String(raw.downloadPath)
    let sameAsDefault = false
    try {
      sameAsDefault =
        path.resolve(custom).toLowerCase() === path.resolve(downloads).toLowerCase()
    } catch {
      sameAsDefault = false
    }
    if (!sameAsDefault) {
      return {
        ok: false,
        error:
          "WORKER_PATH_DENIED: workers may only download to the default user Downloads directory",
        error_code: "WORKER_PATH_DENIED",
        data: { error_code: "WORKER_PATH_DENIED" },
      }
    }
  }

  let downloadPath = downloads
  if (hasCustom) {
    try {
      downloadPath = assertDownloadPathAllowed(String(raw.downloadPath), roots, opts.fsOps)
    } catch (e) {
      const msg = e instanceof PathEscapeError ? e.message : `PATH_ESCAPE: ${String(e)}`
      return {
        ok: false,
        error: msg,
        error_code: "PATH_ESCAPE",
        data: { error_code: "PATH_ESCAPE" },
      }
    }
  } else {
    // Ensure default resolves and is allowed (also creates no dirs — just validate shape)
    try {
      downloadPath = assertDownloadPathAllowed(downloads, roots, opts.fsOps ?? {
        existsSync: () => true,
        realpathSync: (p) => path.resolve(p),
      })
    } catch {
      // If Downloads missing in exotic CI, still pass resolved string path
      downloadPath = path.resolve(downloads)
    }
  }

  // Clamp timeoutMs
  let timeoutMs = 60_000
  if (typeof raw.timeoutMs === "number" && Number.isFinite(raw.timeoutMs)) {
    timeoutMs = Math.min(120_000, Math.max(1_000, Math.floor(raw.timeoutMs)))
  }

  const selector =
    typeof raw.selector === "string" && raw.selector.trim() ? raw.selector.trim() : undefined
  const text = typeof raw.text === "string" && raw.text.trim() ? raw.text.trim() : undefined
  const filenameHint =
    typeof raw.filenameHint === "string" && raw.filenameHint.trim()
      ? raw.filenameHint.trim()
      : undefined
  const urlContains =
    typeof raw.urlContains === "string" && raw.urlContains.trim()
      ? raw.urlContains.trim()
      : undefined
  const forceRedownload = raw.force_redownload === true || raw.forceRedownload === true
  // #au4dch DL-2: prefer_existing may short-circuit without selector/text when a hint exists.
  const preferExisting =
    !forceRedownload &&
    raw.prefer_existing !== false &&
    raw.preferExisting !== false &&
    !!(filenameHint || urlContains)
  if (!selector && !text && !preferExisting) {
    return {
      ok: false,
      error: "browser_download requires selector and/or text (at least one)",
      error_code: "SELECTOR_OR_TEXT_REQUIRED",
      data: { error_code: "SELECTOR_OR_TEXT_REQUIRED" },
    }
  }

  const out: Record<string, any> = {
    ...raw,
    // Drop any LLM-supplied path; only sandboxed absolute path is forwarded
    downloadPath,
    timeoutMs,
  }
  if (selector) out.selector = selector
  else delete out.selector
  if (text) out.text = text
  else delete out.text

  return { ok: true, params: out, downloadPath }
}

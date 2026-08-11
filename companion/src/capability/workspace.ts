// DevSec workspace — path containment + list/read under thread.workspace_root
// When workspace_root is unset: runtime fallback to ~/CMspark-projects (does NOT bind thread).

import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import { requireModule } from "./modules"
import { cmsparkProjectsRoot, CMSPARK_PROJECTS_DIRNAME } from "./project-dir"

const MAX_READ_BYTES = 512 * 1024
const MAX_LIST_ENTRIES = 500
const PICK_TTL_MS = 5 * 60 * 1000

/** Paths returned by native folder-picker; workspace.set may only bind these. */
let lastNativePick: { path: string; at: number } | null = null

export function recordNativePick(absPath: string): void {
  lastNativePick = { path: absPath, at: Date.now() }
}

export function consumeNativePick(absPath: string): boolean {
  if (!lastNativePick) return false
  if (Date.now() - lastNativePick.at > PICK_TTL_MS) {
    lastNativePick = null
    return false
  }
  let a: string
  let b: string
  try {
    a = fs.realpathSync(absPath)
    b = fs.realpathSync(lastNativePick.path)
  } catch {
    return false
  }
  if (a !== b) return false
  lastNativePick = null
  return true
}

/**
 * Ensure ~/CMspark-projects exists (mode 0o700). Runtime fallback only —
 * does NOT write thread.workspace_root.
 *
 * Hardens against in-home symlink redirection: the sandbox path must be a
 * real directory at ~/CMspark-projects (not a symlink to another folder).
 */
export function ensureDefaultSandboxRoot(
  home = os.homedir(),
): { ok: true; path: string } | { ok: false; error: string } {
  let homeReal: string
  try {
    homeReal = fs.realpathSync(home)
  } catch {
    return {
      ok: false,
      error: `cannot create default sandbox ~/${CMSPARK_PROJECTS_DIRNAME}: cannot resolve home directory [default_sandbox_unavailable]`,
    }
  }

  const base = cmsparkProjectsRoot(homeReal)
  const relToHome = path.relative(homeReal, base)
  if (relToHome.startsWith("..") || path.isAbsolute(relToHome)) {
    return {
      ok: false,
      error: `cannot create default sandbox ~/${CMSPARK_PROJECTS_DIRNAME}: path escapes home [default_sandbox_unavailable]`,
    }
  }

  try {
    if (!fs.existsSync(base)) {
      fs.mkdirSync(base, { recursive: true, mode: 0o700 })
    }
  } catch (e: any) {
    return {
      ok: false,
      error: `cannot create default sandbox ~/${CMSPARK_PROJECTS_DIRNAME}: ${e?.message || String(e)} [default_sandbox_unavailable]`,
    }
  }

  // Reject symlink at sandbox root (N2): would expand host_read to another
  // in-home directory without folder-picker consent.
  try {
    if (fs.lstatSync(base).isSymbolicLink()) {
      return {
        ok: false,
        error: `cannot use default sandbox ~/${CMSPARK_PROJECTS_DIRNAME}: path is a symbolic link (refusing in-home redirect) [default_sandbox_unavailable]`,
      }
    }
  } catch (e: any) {
    return {
      ok: false,
      error: `cannot create default sandbox ~/${CMSPARK_PROJECTS_DIRNAME}: ${e?.message || String(e)} [default_sandbox_unavailable]`,
    }
  }

  // Best-effort tighten mode on pre-existing dirs (N6)
  try {
    fs.chmodSync(base, 0o700)
  } catch {
    /* ignore — some FS/mounts disallow chmod */
  }

  let rootReal: string
  try {
    rootReal = fs.realpathSync(base)
  } catch (e: any) {
    return {
      ok: false,
      error: `cannot create default sandbox ~/${CMSPARK_PROJECTS_DIRNAME}: ${e?.message || String(e)} [default_sandbox_unavailable]`,
    }
  }

  // Post-create containment (symlink race / TOCTOU after lstat)
  const relAfter = path.relative(homeReal, rootReal)
  if (relAfter.startsWith("..") || path.isAbsolute(relAfter)) {
    return {
      ok: false,
      error: `cannot create default sandbox ~/${CMSPARK_PROJECTS_DIRNAME}: path escapes home [default_sandbox_unavailable]`,
    }
  }
  // Require resolved path is still the literal sandbox dir under home (not redirected)
  if (path.normalize(rootReal) !== path.normalize(base)) {
    return {
      ok: false,
      error: `cannot use default sandbox ~/${CMSPARK_PROJECTS_DIRNAME}: resolved path diverges from ~/${CMSPARK_PROJECTS_DIRNAME} [default_sandbox_unavailable]`,
    }
  }
  if (!fs.statSync(rootReal).isDirectory()) {
    return {
      ok: false,
      error: `cannot create default sandbox ~/${CMSPARK_PROJECTS_DIRNAME}: path exists and is not a directory [default_sandbox_unavailable]`,
    }
  }
  return { ok: true, path: rootReal }
}

/**
 * Resolve explicit bind or default sandbox into a root path.
 * Shared by effectiveWorkspaceRoot + resolveUnderWorkspace (M1).
 */
export function resolveEffectiveWorkspaceRoot(
  workspaceRoot: string | null | undefined,
  home = os.homedir(),
): { ok: true; path: string; source: "explicit" | "sandbox" } | { ok: false; error: string } {
  if (typeof workspaceRoot === "string") {
    const t = workspaceRoot.trim()
    if (t) return { ok: true, path: t, source: "explicit" }
  }
  const ensured = ensureDefaultSandboxRoot(home)
  if (!ensured.ok) return ensured
  return { ok: true, path: ensured.path, source: "sandbox" }
}

/**
 * Effective root for list/read: explicit thread.workspace_root wins;
 * else default sandbox ~/CMspark-projects (created if missing).
 * Does NOT bind/write thread.workspace_root.
 */
export function effectiveWorkspaceRoot(
  workspaceRoot: string | null | undefined,
): string | null {
  const r = resolveEffectiveWorkspaceRoot(workspaceRoot)
  return r.ok ? r.path : null
}

export function resolveUnderWorkspace(
  workspaceRoot: string | null | undefined,
  relPath: string,
): { ok: true; abs: string } | { ok: false; error: string } {
  const rootRes = resolveEffectiveWorkspaceRoot(workspaceRoot)
  if (!rootRes.ok) {
    return { ok: false, error: rootRes.error }
  }
  const root = rootRes.path

  let rootReal: string
  try {
    rootReal = fs.realpathSync(root)
  } catch {
    return { ok: false, error: `workspace_root does not exist: ${root}` }
  }
  const st = fs.statSync(rootReal)
  if (!st.isDirectory()) return { ok: false, error: "workspace_root is not a directory" }

  const rel = relPath || "."
  if (path.isAbsolute(rel)) {
    return { ok: false, error: "absolute paths not allowed; use path relative to workspace_root" }
  }
  const joined = path.resolve(rootReal, rel)
  let targetReal: string
  try {
    targetReal = fs.existsSync(joined) ? fs.realpathSync(joined) : joined
  } catch {
    return { ok: false, error: `cannot resolve path: ${rel}` }
  }
  const relToRoot = path.relative(rootReal, targetReal)
  if (relToRoot.startsWith("..") || path.isAbsolute(relToRoot)) {
    return { ok: false, error: "path escapes workspace_root" }
  }
  return { ok: true, abs: targetReal }
}

/**
 * Bind workspace_root. Path MUST come from a recent native folder-picker
 * (recordNativePick → consumeNativePick) — arbitrary WS paths are rejected.
 */
export function setWorkspaceRoot(rawPath: string): { ok: true; path: string } | { ok: false; error: string } {
  if (!rawPath || typeof rawPath !== "string") return { ok: false, error: "path required" }
  if (rawPath.includes("\0")) return { ok: false, error: "invalid path" }
  let abs = path.resolve(rawPath)
  try {
    abs = fs.realpathSync(abs)
  } catch {
    return { ok: false, error: `path does not exist: ${rawPath}` }
  }
  if (!fs.statSync(abs).isDirectory()) return { ok: false, error: "path is not a directory" }
  if (!consumeNativePick(abs)) {
    return {
      ok: false,
      error: "workspace path must come from a recent workspace.pick (native folder dialog)",
    }
  }
  return { ok: true, path: abs }
}

export function workspaceListDir(
  workspaceRoot: string | null | undefined,
  relPath: string = ".",
): { success: boolean; data?: any; error?: string } {
  const gate = requireModule("devsec-workspace")
  if (!gate.ok) return { success: false, error: gate.error }

  const resolved = resolveUnderWorkspace(workspaceRoot, relPath)
  if (!resolved.ok) return { success: false, error: resolved.error }

  try {
    const entries = fs.readdirSync(resolved.abs, { withFileTypes: true }).slice(0, MAX_LIST_ENTRIES)
    return {
      success: true,
      data: {
        path: relPath || ".",
        entries: entries.map((e) => ({
          name: e.name,
          type: e.isDirectory() ? "dir" : e.isFile() ? "file" : "other",
        })),
        truncated: entries.length >= MAX_LIST_ENTRIES,
      },
    }
  } catch (e: any) {
    return { success: false, error: e?.message || String(e) }
  }
}

export function workspaceReadFile(
  workspaceRoot: string | null | undefined,
  relPath: string,
): { success: boolean; data?: any; error?: string } {
  const gate = requireModule("devsec-workspace")
  if (!gate.ok) return { success: false, error: gate.error }

  const resolved = resolveUnderWorkspace(workspaceRoot, relPath)
  if (!resolved.ok) return { success: false, error: resolved.error }

  try {
    if (!fs.existsSync(resolved.abs)) {
      // Agent-friendly message (matches classifyError recoverable "file not found" /
      // "not found") — avoid raw Node "ENOENT: no such file or directory, stat …"
      // which used to kill the turn as non_recoverable (thread n2486l).
      return {
        success: false,
        error: `file not found: ${relPath || "."} (list the directory with workspace_list_dir and pick an existing path)`,
      }
    }
    const st = fs.statSync(resolved.abs)
    if (!st.isFile()) return { success: false, error: "not a file" }
    if (st.size > MAX_READ_BYTES) {
      return {
        success: false,
        error: `file too large (${st.size} > ${MAX_READ_BYTES}); use a smaller file or external tools`,
      }
    }
    const buf = fs.readFileSync(resolved.abs)
    // reject obvious binary
    if (buf.includes(0)) {
      return { success: false, error: "binary file not supported for workspace_read_file" }
    }
    return {
      success: true,
      data: {
        path: relPath,
        size: st.size,
        content: buf.toString("utf-8"),
      },
    }
  } catch (e: any) {
    const code = e?.code as string | undefined
    if (code === "ENOENT") {
      return {
        success: false,
        error: `file not found: ${relPath || "."} (list the directory with workspace_list_dir and pick an existing path)`,
      }
    }
    return { success: false, error: e?.message || String(e) }
  }
}

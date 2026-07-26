// DevSec workspace — path containment + list/read under thread.workspace_root

import * as fs from "fs"
import * as path from "path"
import { requireModule } from "./modules"

const MAX_READ_BYTES = 512 * 1024
const MAX_LIST_ENTRIES = 500

export function resolveUnderWorkspace(
  workspaceRoot: string | null | undefined,
  relPath: string,
): { ok: true; abs: string } | { ok: false; error: string } {
  if (!workspaceRoot || typeof workspaceRoot !== "string") {
    return { ok: false, error: "workspace_root not set on thread — pick a folder first" }
  }
  let rootReal: string
  try {
    rootReal = fs.realpathSync(workspaceRoot)
  } catch {
    return { ok: false, error: `workspace_root does not exist: ${workspaceRoot}` }
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
    return { success: false, error: e?.message || String(e) }
  }
}

// DevSec workspace — path containment + list/read under thread.workspace_root

import * as fs from "fs"
import * as path from "path"
import { requireModule } from "./modules"

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

export function resolveUnderWorkspace(
  workspaceRoot: string | null | undefined,
  relPath: string,
): { ok: true; abs: string } | { ok: false; error: string } {
  if (!workspaceRoot || typeof workspaceRoot !== "string") {
    return {
      ok: false,
      error:
        "workspace_root not set on thread — pick a folder first. " +
        "Ask the user to open Side Panel → 任务包 → 「选择工作区」 (native folder dialog), " +
        "then retry workspace_list_dir / workspace_read_file. Do not invent paths.",
    }
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

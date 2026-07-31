// Session project directories — create under workspace or ~/CMspark-projects.
// Prefer this over inventing paths for MCP filesystem (parent must exist first).

import * as fs from "fs"
import * as path from "path"
import * as os from "os"

export const CMSPARK_PROJECTS_DIRNAME = "CMspark-projects"

/** Safe folder segment from user/LLM title (no path separators). */
export function sanitizeProjectName(name: string): string {
  const raw = (name || "").trim()
  if (!raw) return `project-${Date.now().toString(36)}`
  // Keep CJK, letters, numbers, dash, underscore; collapse junk to -
  let s = raw
    .replace(/[\/\\:\0<>"|?*]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 80)
  if (!s || s === "." || s === "..") s = `project-${Date.now().toString(36)}`
  return s
}

export function cmsparkProjectsRoot(home = os.homedir()): string {
  return path.join(home, CMSPARK_PROJECTS_DIRNAME)
}

/**
 * Create project directory (recursive).
 * - prefer workspace: under thread.workspace_root when set and exists
 * - else under ~/CMspark-projects/<name>
 * Never creates outside home or outside workspace_root.
 */
export function ensureProjectDir(opts: {
  name: string
  workspaceRoot?: string | null
  /** auto = workspace if set, else home projects */
  prefer?: "auto" | "workspace" | "home"
}):
  | {
      ok: true
      path: string
      created: boolean
      base: string
      source: "workspace" | "home"
      relative: string
    }
  | { ok: false; error: string } {
  const prefer = opts.prefer || "auto"
  const name = sanitizeProjectName(opts.name)
  const home = os.homedir()
  let homeReal: string
  try {
    homeReal = fs.realpathSync(home)
  } catch {
    return { ok: false, error: "cannot resolve home directory" }
  }

  let source: "workspace" | "home" = "home"
  let base: string

  const ws = typeof opts.workspaceRoot === "string" ? opts.workspaceRoot.trim() : ""
  const wantWs = prefer === "workspace" || (prefer === "auto" && !!ws)
  if (wantWs && ws) {
    try {
      const wsReal = fs.realpathSync(ws)
      if (!fs.statSync(wsReal).isDirectory()) {
        return { ok: false, error: "workspace_root is not a directory" }
      }
      base = wsReal
      source = "workspace"
    } catch {
      if (prefer === "workspace") {
        return { ok: false, error: "workspace_root not set or missing — pick a folder in 场景 first" }
      }
      base = cmsparkProjectsRoot(homeReal)
      source = "home"
    }
  } else {
    base = cmsparkProjectsRoot(homeReal)
    source = "home"
  }

  // Containment: home projects under home; workspace under its own root
  if (source === "home") {
    const relToHome = path.relative(homeReal, base)
    if (relToHome.startsWith("..") || path.isAbsolute(relToHome)) {
      return { ok: false, error: "project base escapes home" }
    }
  }

  const target = path.join(base, name)
  // Double containment for target
  const container = source === "workspace" ? base : homeReal
  const rel = path.relative(container, target)
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return { ok: false, error: "project path escapes allowed base" }
  }

  let created = false
  try {
    if (!fs.existsSync(target)) {
      fs.mkdirSync(target, { recursive: true, mode: 0o700 })
      created = true
    } else if (!fs.statSync(target).isDirectory()) {
      return { ok: false, error: `path exists and is not a directory: ${target}` }
    }
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) }
  }

  return {
    ok: true,
    path: target,
    created,
    base,
    source,
    relative: name,
  }
}

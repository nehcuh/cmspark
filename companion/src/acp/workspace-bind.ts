import * as fs from "fs"
import * as path from "path"

/**
 * Resolve and contain a workspace root for ACP sessions.
 * Returns canonical realpath or error string.
 */
export function resolveAcpWorkspaceRoot(
  workspaceRoot: string | null | undefined,
): { ok: true; root: string } | { ok: false; error: string } {
  if (!workspaceRoot || typeof workspaceRoot !== "string" || !workspaceRoot.trim()) {
    return { ok: false, error: "acp: workspace_root required (bind a project folder first)" }
  }
  let resolved: string
  try {
    resolved = path.resolve(workspaceRoot.trim())
    resolved = fs.realpathSync(resolved)
  } catch {
    return { ok: false, error: `acp: workspace path not found: ${workspaceRoot}` }
  }
  let st: fs.Stats
  try {
    st = fs.statSync(resolved)
  } catch {
    return { ok: false, error: `acp: cannot stat workspace: ${resolved}` }
  }
  if (!st.isDirectory()) {
    return { ok: false, error: `acp: workspace is not a directory: ${resolved}` }
  }
  // Hard deny data dir
  const home = process.env.HOME || process.env.USERPROFILE || ""
  const dataDir = path.join(home, ".cmspark-agent")
  try {
    const dataReal = fs.existsSync(dataDir) ? fs.realpathSync(dataDir) : dataDir
    if (resolved === dataReal || resolved.startsWith(dataReal + path.sep)) {
      return { ok: false, error: "acp: refusing ~/.cmspark-agent as workspace" }
    }
  } catch {
    /* ignore */
  }
  return { ok: true, root: resolved }
}

/** True if candidate path is inside workspace root (realpath). */
export function isPathInsideWorkspace(workspaceRoot: string, candidate: string): boolean {
  try {
    const root = fs.realpathSync(workspaceRoot)
    const target = fs.realpathSync(path.resolve(workspaceRoot, candidate))
    return target === root || target.startsWith(root + path.sep)
  } catch {
    return false
  }
}

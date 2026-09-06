// Starting cwd for embedded PTY (spec §5): workspace_root or ~/CMspark-projects.
// Containment is for the *start* path only — not a runtime sandbox (user may cd).

import * as fs from "fs"
import * as path from "path"
import { resolveEffectiveWorkspaceRoot } from "../capability/workspace"

export function resolveTerminalStartCwd(opts: {
  requested?: string
  workspaceRoot?: string | null
}): { ok: true; cwd: string } | { ok: false; error: string } {
  const rootRes = resolveEffectiveWorkspaceRoot(opts.workspaceRoot)
  if (!rootRes.ok) return rootRes

  let rootReal: string
  try {
    rootReal = fs.realpathSync(path.resolve(rootRes.path))
  } catch (e: any) {
    return { ok: false, error: `workspace root unreadable: ${e?.message || e}` }
  }

  const raw = typeof opts.requested === "string" ? opts.requested.trim() : ""
  const startAbs = path.resolve(raw || rootReal)
  if (startAbs === path.parse(startAbs).root || startAbs === "/") {
    return { ok: false, error: "cwd must not be filesystem root" }
  }

  let startReal: string
  try {
    startReal = fs.realpathSync(startAbs)
  } catch (e: any) {
    // Broken symlink / missing path: refuse honestly (do not lexically allow).
    return { ok: false, error: `cwd unreadable (broken symlink or missing): ${e?.message || e}` }
  }

  const rel = path.relative(rootReal, startReal)
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return { ok: false, error: "cwd escapes workspace/sandbox (symlink or path)" }
  }
  return { ok: true, cwd: startReal }
}

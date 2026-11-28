import fs from "node:fs"
import path from "node:path"

/** Physical root identity stays private to the desktop session. */
export type RootSnapshot = Readonly<{ path: string; chain: readonly string[] }>
type RootFailure = "WORKSPACE_INPUT_INVALID" | "WORKSPACE_MISSING" | "WORKSPACE_CHANGED" | "WORKSPACE_UNAVAILABLE"

export function fileStatIdentity(stat: fs.BigIntStats): string[] {
  return [stat.dev, stat.ino, stat.mode, stat.birthtimeNs, stat.ctimeNs, stat.mtimeNs, stat.size].map(String)
}

/** A sibling write changes directory timestamps without replacing the directory. */
export function directoryStatIdentity(directory: string, stat: fs.BigIntStats): string {
  return JSON.stringify([directory, String(stat.dev), String(stat.ino), String(stat.mode), String(stat.birthtimeNs)])
}

export function createRootChecks(fail: (code: RootFailure) => never) {
  function io<T>(read: () => T): T {
    try {
      return read()
    } catch {
      return fail("WORKSPACE_UNAVAILABLE")
    }
  }

  function directoryChain(directory: string): string[] {
    const rows: string[] = []
    for (let current = directory;; current = path.dirname(current)) {
      if (!fs.existsSync(current)) return fail("WORKSPACE_CHANGED")
      const stat = io(() => fs.lstatSync(current, { bigint: true }))
      if (!stat.isDirectory() || stat.isSymbolicLink()) return fail("WORKSPACE_CHANGED")
      rows.push(directoryStatIdentity(current, stat))
      if (path.dirname(current) === current) return rows
    }
  }

  function snapshotRoot(absolute: string): RootSnapshot {
    if (typeof absolute !== "string" || !absolute || absolute.includes("\0") || !path.isAbsolute(absolute)) {
      return fail("WORKSPACE_INPUT_INVALID")
    }
    if (!fs.existsSync(absolute)) return fail("WORKSPACE_MISSING")
    const canonical = io(() => fs.realpathSync(absolute))
    return Object.freeze({ path: canonical, chain: Object.freeze(directoryChain(canonical)) })
  }

  function assertRoot(snapshot: RootSnapshot): void {
    if (!fs.existsSync(snapshot.path)) return fail("WORKSPACE_CHANGED")
    const canonical = io(() => fs.realpathSync(snapshot.path))
    if (canonical !== snapshot.path || JSON.stringify(directoryChain(canonical)) !== JSON.stringify(snapshot.chain)) {
      return fail("WORKSPACE_CHANGED")
    }
  }

  return { snapshotRoot, assertRoot, directoryChain, io }
}

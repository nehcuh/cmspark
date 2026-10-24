/** Native-only explicit-root reads. Private snapshots must never enter a DTO. */
import fs from "node:fs"
import path from "node:path"
const workspaceFail = (_code: string): never => { throw Error("LOCAL_CONFLICT") }

export type RootSnapshot = Readonly<{ path: string; chain: readonly string[] }>
function io<T>(call: () => T): T { try { return call() } catch { return workspaceFail("WORKSPACE_UNAVAILABLE") } }
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
function identity(st: fs.BigIntStats) { return [st.dev, st.ino, st.mode, st.birthtimeNs, st.ctimeNs, st.mtimeNs, st.size].map(String) }
function chain(directory: string): string[] {
  const rows: string[] = []
  for (let at = directory;; at = path.dirname(at)) {
    if (!fs.existsSync(at)) return workspaceFail("WORKSPACE_CHANGED")
    const st = io(() => fs.lstatSync(at, { bigint: true }))
    if (!st.isDirectory() || st.isSymbolicLink()) return workspaceFail("WORKSPACE_CHANGED")
    rows.push(JSON.stringify([at, String(st.dev), String(st.ino), String(st.mode), String(st.birthtimeNs)]))
    if (path.dirname(at) === at) return rows
  }
}
export function snapshotRoot(rawAbsolute: string): RootSnapshot {
  if (typeof rawAbsolute !== "string" || !rawAbsolute || rawAbsolute.includes("\0") || !path.isAbsolute(rawAbsolute)) return workspaceFail("WORKSPACE_INPUT_INVALID")
  if (!fs.existsSync(rawAbsolute)) return workspaceFail("WORKSPACE_MISSING")
  const canonical = io(() => fs.realpathSync(rawAbsolute))
  return Object.freeze({ path: canonical, chain: Object.freeze(chain(canonical)) })
}
export function assertRoot(snapshot: RootSnapshot): void {
  if (!fs.existsSync(snapshot.path)) return workspaceFail("WORKSPACE_CHANGED")
  if (io(() => fs.realpathSync(snapshot.path)) !== snapshot.path || !same(chain(snapshot.path), snapshot.chain)) return workspaceFail("WORKSPACE_CHANGED")
}

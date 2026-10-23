/** Native-only explicit-root reads. Private snapshots must never enter a DTO. */
import fs from "node:fs"
import path from "node:path"
import { TextDecoder } from "node:util"
import { redactSecrets } from "../threads/distill"
import { workspaceFail } from "./workspace-error"

const MAX_READ = 512 * 1024, MAX_LIST = 500
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
function relativeInput(value: string): string {
  if (typeof value !== "string" || !value || value.includes("\0") || path.isAbsolute(value) || path.win32.isAbsolute(value) || /^[a-z]:/i.test(value) || value.split(/[\\/]/).includes("..") || redactSecrets(value).hits) return workspaceFail("WORKSPACE_INPUT_INVALID")
  return value
}
function resolve(snapshot: RootSnapshot, relative: string) {
  const clean = relativeInput(relative)
  assertRoot(snapshot)
  const requested = path.resolve(snapshot.path, clean)
  const inside = path.relative(snapshot.path, requested)
  if (inside.startsWith(".." + path.sep) || inside === ".." || path.isAbsolute(inside)) return workspaceFail("WORKSPACE_INPUT_INVALID")
  if (!fs.existsSync(requested)) return workspaceFail("WORKSPACE_MISSING")
  const canonical = io(() => fs.realpathSync(requested)), contained = path.relative(snapshot.path, canonical)
  if (contained === ".." || contained.startsWith(".." + path.sep) || path.isAbsolute(contained)) return workspaceFail("WORKSPACE_INPUT_INVALID")
  return { requested, canonical, relative }
}
function recheck(snapshot: RootSnapshot, target: ReturnType<typeof resolve>, before: readonly string[]) {
  assertRoot(snapshot)
  if (!fs.existsSync(target.requested) || io(() => fs.realpathSync(target.requested)) !== target.canonical || !same(chain(path.dirname(target.canonical)), before)) return workspaceFail("WORKSPACE_CHANGED")
}
export function list(snapshot: RootSnapshot, relative = ".") {
  const target = resolve(snapshot, relative), parentChain = chain(path.dirname(target.canonical))
  const st = io(() => fs.lstatSync(target.canonical, { bigint: true }))
  if (!st.isDirectory() || st.isSymbolicLink()) return workspaceFail("WORKSPACE_UNSUPPORTED")
  const ownChain = chain(target.canonical), directory = io(() => fs.opendirSync(target.canonical))
  const entries: Array<{ name: string; type: "dir" | "file" | "other"; path: string | null; readable: boolean }> = []
  let truncated = false
  try {
    for (let i = 0; i <= MAX_LIST; i++) {
      const entry = io(() => directory.readSync())
      if (!entry) break
      if (i === MAX_LIST) { truncated = true; break }
      const name = redactSecrets(entry.name), childPath = path.join(relative, entry.name)
      const type = entry.isDirectory() ? "dir" : entry.isFile() ? "file" : "other"
      const readable = !name.hits && !redactSecrets(childPath).hits && type !== "other"
      entries.push({ name: name.text, type, path: readable ? childPath : null, readable })
    }
  } finally { io(() => directory.closeSync()) }
  recheck(snapshot, target, parentChain)
  if (!same(chain(target.canonical), ownChain)) return workspaceFail("WORKSPACE_CHANGED")
  return { path: relative, entries, truncated }
}
export function read(snapshot: RootSnapshot, relative: string) {
  const target = resolve(snapshot, relative), parentChain = chain(path.dirname(target.canonical))
  const before = io(() => fs.lstatSync(target.canonical, { bigint: true }))
  if (!before.isFile() || before.isSymbolicLink() || before.size > BigInt(MAX_READ)) return workspaceFail("WORKSPACE_UNSUPPORTED")
  const fd = io(() => fs.openSync(target.canonical, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0)))
  let bytes: Buffer
  try {
    const opened = io(() => fs.fstatSync(fd, { bigint: true }))
    if (!opened.isFile() || !same(identity(opened), identity(before))) return workspaceFail("WORKSPACE_CHANGED")
    const buffer = Buffer.alloc(Number(opened.size) + 1)
    let length = 0
    while (length < buffer.length) {
      const n = io(() => fs.readSync(fd, buffer, length, buffer.length - length, null))
      if (!n) break
      length += n
    }
    const after = io(() => fs.fstatSync(fd, { bigint: true }))
    if (length !== Number(opened.size) || length > MAX_READ || !same(identity(opened), identity(after))) return workspaceFail("WORKSPACE_CHANGED")
    recheck(snapshot, target, parentChain)
    const final = io(() => fs.lstatSync(target.canonical, { bigint: true }))
    if (!same(identity(after), identity(final))) return workspaceFail("WORKSPACE_CHANGED")
    bytes = buffer.subarray(0, length)
  } finally { io(() => fs.closeSync(fd)) }
  if (bytes.includes(0)) return workspaceFail("WORKSPACE_UNSUPPORTED")
  let text: string
  try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes) }
  catch { return workspaceFail("WORKSPACE_UNSUPPORTED") }
  const safe = redactSecrets(text)
  return { path: relative, size: bytes.length, text: safe.text, complete: safe.hits === 0, redacted: safe.hits > 0 }
}

/** Native-only explicit-root reads. Private snapshots must never enter a DTO. */
import fs from "node:fs"
import path from "node:path"
import { TextDecoder } from "node:util"
import { redactSecrets } from "../threads/distill"
import { createRootChecks, fileStatIdentity, type RootSnapshot } from "./filesystem-identity"
import { workspaceFail } from "./workspace-error"

const MAX_READ = 512 * 1024, MAX_LIST = 500
const { snapshotRoot, assertRoot, directoryChain, io } = createRootChecks(workspaceFail)
export { snapshotRoot, assertRoot }
export type { RootSnapshot }
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

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
  if (!fs.existsSync(target.requested) || io(() => fs.realpathSync(target.requested)) !== target.canonical || !same(directoryChain(path.dirname(target.canonical)), before)) return workspaceFail("WORKSPACE_CHANGED")
}
export function list(snapshot: RootSnapshot, relative = ".") {
  const target = resolve(snapshot, relative), parentChain = directoryChain(path.dirname(target.canonical))
  const st = io(() => fs.lstatSync(target.canonical, { bigint: true }))
  if (!st.isDirectory() || st.isSymbolicLink()) return workspaceFail("WORKSPACE_UNSUPPORTED")
  const ownChain = directoryChain(target.canonical), directory = io(() => fs.opendirSync(target.canonical))
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
  if (!same(directoryChain(target.canonical), ownChain)) return workspaceFail("WORKSPACE_CHANGED")
  return { path: relative, entries, truncated }
}
export function read(snapshot: RootSnapshot, relative: string) {
  const target = resolve(snapshot, relative), parentChain = directoryChain(path.dirname(target.canonical))
  const before = io(() => fs.lstatSync(target.canonical, { bigint: true }))
  if (!before.isFile() || before.isSymbolicLink() || before.size > BigInt(MAX_READ)) return workspaceFail("WORKSPACE_UNSUPPORTED")
  const fd = io(() => fs.openSync(target.canonical, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0)))
  let bytes: Buffer
  try {
    const opened = io(() => fs.fstatSync(fd, { bigint: true }))
    if (!opened.isFile() || !same(fileStatIdentity(opened), fileStatIdentity(before))) return workspaceFail("WORKSPACE_CHANGED")
    const buffer = Buffer.alloc(Number(opened.size) + 1)
    let length = 0
    while (length < buffer.length) {
      const n = io(() => fs.readSync(fd, buffer, length, buffer.length - length, null))
      if (!n) break
      length += n
    }
    const after = io(() => fs.fstatSync(fd, { bigint: true }))
    if (length !== Number(opened.size) || length > MAX_READ || !same(fileStatIdentity(opened), fileStatIdentity(after))) return workspaceFail("WORKSPACE_CHANGED")
    recheck(snapshot, target, parentChain)
    const final = io(() => fs.lstatSync(target.canonical, { bigint: true }))
    if (!same(fileStatIdentity(after), fileStatIdentity(final))) return workspaceFail("WORKSPACE_CHANGED")
    bytes = buffer.subarray(0, length)
  } finally { io(() => fs.closeSync(fd)) }
  if (bytes.includes(0)) return workspaceFail("WORKSPACE_UNSUPPORTED")
  let text: string
  try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes) }
  catch { return workspaceFail("WORKSPACE_UNSUPPORTED") }
  const safe = redactSecrets(text)
  return { path: relative, size: bytes.length, text: safe.text, complete: safe.hits === 0, redacted: safe.hits > 0 }
}

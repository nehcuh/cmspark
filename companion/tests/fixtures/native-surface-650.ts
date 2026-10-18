/** Test-only input-desktop ownership. Never imported by a product module. */
import fs from "node:fs"
import path from "node:path"
import { randomBytes } from "node:crypto"
import type { TestContext } from "node:test"

const namespace = "native-surface-650", filename = "claim"
const refused = () => Error("OWNED_NATIVE_SURFACE_REFUSED")
type Identity = { dev: string; ino: string; birth: string }
const identity = (s: fs.BigIntStats): Identity => ({ dev: String(s.dev), ino: String(s.ino), birth: String(s.birthtimeNs) })
const same = (a: Identity, b: Identity) => a.dev === b.dev && a.ino === b.ino && a.birth === b.birth
function directory(file: string): Identity {
  const s = fs.lstatSync(file, { bigint: true })
  if (!s.isDirectory() || s.isSymbolicLink()) throw refused()
  return identity(s)
}
export type SurfaceBorrow650 = { version: 1; root: string; rootIdentity: Identity; scopeIdentity: Identity; claimIdentity: Identity; nonce: string }
export interface SurfaceLease650 {
  readonly signal: AbortSignal
  checkpoint(): void
  borrow(): SurfaceBorrow650
  retain(): void
  settled(): void
  release(): void
}
export function parseSurfaceBorrow650(value: string | undefined): SurfaceBorrow650 {
  if (typeof value !== "string" || value.length > 4096) throw refused()
  let b: any; try { b = JSON.parse(value) } catch { throw refused() }
  if (!b || Array.isArray(b) || Object.keys(b).sort().join() !== "claimIdentity,nonce,root,rootIdentity,scopeIdentity,version" || b.version !== 1 || typeof b.root !== "string" || !path.isAbsolute(b.root) || !/^[0-9a-f]{64}$/.test(b.nonce)) throw refused()
  for (const k of ["rootIdentity", "scopeIdentity", "claimIdentity"]) {
    const id = b[k]
    if (!id || Array.isArray(id) || Object.keys(id).sort().join() !== "birth,dev,ino" || ![id.dev, id.ino, id.birth].every(v => typeof v === "string" && /^\d+$/.test(v))) throw refused()
  }
  return b
}
export async function acquireSurface650(rootInput: string | undefined, dataInput: string | undefined, signal: AbortSignal, borrowed?: SurfaceBorrow650): Promise<SurfaceLease650> {
  signal.throwIfAborted()
  if (!rootInput || !dataInput || !path.isAbsolute(rootInput) || !path.isAbsolute(dataInput)) throw refused()
  const rootIdentity = directory(rootInput), root = fs.realpathSync(rootInput), data = fs.realpathSync(dataInput)
  const relative = path.relative(root, data)
  if (!path.basename(root).startsWith("cmspark-test-run-") || !relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw refused()
  directory(dataInput)
  const scope = path.join(root, namespace), claim = path.join(scope, filename)
  try { fs.mkdirSync(scope, { mode: 0o700 }) } catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw refused() }
  const scopeIdentity = directory(scope)
  const validateScope = () => {
    if (!same(directory(rootInput), rootIdentity) || fs.realpathSync(rootInput) !== root || !same(directory(scope), scopeIdentity)) throw refused()
  }
  const readClaim = () => {
    validateScope()
    const named = fs.lstatSync(claim, { bigint: true })
    if (!named.isFile() || named.isSymbolicLink() || named.nlink !== 1n || named.size !== 64n) throw refused()
    const fd = fs.openSync(claim, "r")
    try {
      const opened = fs.fstatSync(fd, { bigint: true }), bytes = Buffer.alloc(64)
      if (!same(identity(named), identity(opened)) || fs.readSync(fd, bytes, 0, 64, 0) !== 64 || !/^[0-9a-f]{64}$/.test(bytes.toString("ascii"))) throw refused()
      if (!same(identity(fs.lstatSync(claim, { bigint: true })), identity(opened))) throw refused()
      return { id: identity(opened), nonce: bytes.toString("ascii") }
    } finally { fs.closeSync(fd) }
  }
  const lost = new AbortController(), combined = AbortSignal.any([signal, lost.signal])
  let revision = 0, wake: (() => void) | undefined, fd: number | undefined, bound: { id: Identity; nonce: string } | undefined, retained = false, released = false
  const watchers: fs.FSWatcher[] = []
  const stopWatchers = () => { for (const watcher of watchers.splice(0)) watcher.close(); combined.removeEventListener("abort", stopWatchers) }
  combined.addEventListener("abort", stopWatchers, { once: true })
  const verify = () => {
    if (released || !bound) throw refused()
    const current = readClaim()
    if (!same(current.id, bound.id) || current.nonce !== bound.nonce || (fd !== undefined && !same(identity(fs.fstatSync(fd, { bigint: true })), bound.id))) throw refused()
  }
  const checkpoint = () => {
    try { combined.throwIfAborted(); verify() } catch (e) { lost.abort(refused()); throw e }
  }
  const changed = () => {
    revision++; wake?.()
    if (bound && !released) try { verify() } catch { lost.abort(refused()) }
  }
  try {
    // Arm notifications before the first claim; register/recheck below closes
    // the failed-claim -> wait-registration gap without a timer or polling.
    for (const dir of [root, scope]) {
      const watcher = fs.watch(dir, changed); watchers.push(watcher)
      watcher.on("error", () => { lost.abort(refused()); wake?.() })
    }
    if (borrowed) {
      if (borrowed.root !== root || !same(borrowed.rootIdentity, rootIdentity) || !same(borrowed.scopeIdentity, scopeIdentity)) throw refused()
      bound = { id: borrowed.claimIdentity, nonce: borrowed.nonce }; verify()
    } else {
      const attempt = () => {
        combined.throwIfAborted(); validateScope()
        try { fd = fs.openSync(claim, "wx+", 0o600) } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw refused()
          try {
            // wx+ publishes the inode before the nonce write. A regular,
            // singly-linked empty claim is busy, never ownership or borrowing.
            const publishing = fs.lstatSync(claim, { bigint: true })
            if (publishing.isFile() && !publishing.isSymbolicLink() && publishing.nlink === 1n && publishing.size === 0n) return false
            readClaim()
          } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error }
          return false
        }
        const nonce = randomBytes(32).toString("hex")
        fs.writeFileSync(fd, nonce)
        bound = { id: identity(fs.fstatSync(fd, { bigint: true })), nonce }; verify(); return true
      }
      while (!attempt()) {
        const seen = revision
        await new Promise<void>((resolve, reject) => {
          const cleanup = () => { combined.removeEventListener("abort", abort); wake = undefined }
          const finish = () => { cleanup(); resolve() }
          const abort = () => { cleanup(); reject(combined.reason) }
          wake = finish; combined.addEventListener("abort", abort, { once: true })
          try { if (combined.aborted) abort(); else if (revision !== seen || attempt()) finish() } catch (e) { cleanup(); reject(e) }
        })
        if (bound) break
      }
    }
    combined.throwIfAborted(); verify()
    return {
      signal: combined,
      checkpoint,
      borrow() { checkpoint(); return { version: 1, root, rootIdentity, scopeIdentity, claimIdentity: bound!.id, nonce: bound!.nonce } },
      retain() { retained = true },
      settled() {
        // Cleanup has completed, but ownership must still be current. Defer a
        // refusal to release(): a cleanup marker cannot replace an earlier
        // native/assertion failure. Success still fails closed at release.
        try { verify(); retained = false } catch { lost.abort(refused()) }
      },
      release() {
        if (released) throw refused()
        try {
          verify()
          if (retained) throw Error("OWNED_NATIVE_SURFACE_UNSETTLED")
          if (!borrowed) fs.unlinkSync(claim) // Last synchronous operation after exact identity/nonce recheck.
        } catch (e) { lost.abort(refused()); throw e
        } finally {
          released = true; stopWatchers(); if (fd !== undefined) { fs.closeSync(fd); fd = undefined }
        }
      },
    }
  } catch (e) {
    stopWatchers()
    // Never remove a named claim after uncertain ownership or failed setup.
    if (fd !== undefined) fs.closeSync(fd)
    throw e
  }
}

export async function withSurface650<T>(t: TestContext, action: (t: TestContext, lease: SurfaceLease650) => Promise<T>, borrowed?: SurfaceBorrow650): Promise<T> {
  const lease = await acquireSurface650(process.env.CMSPARK_TEST_RUN_DIR, process.env.CMSPARK_DATA_DIR, t.signal, borrowed)
  const context = new Proxy(t, { get(target, key) { const value = key === "signal" ? lease.signal : Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value } })
  let primary: unknown, failed = false
  try { lease.checkpoint(); return await action(context, lease) } catch (e) { failed = true; primary = e; throw e }
  finally { try { lease.release() } catch (e) { try { t.diagnostic("NATIVE_SURFACE_650_CLEANUP_REFUSED") } catch {} if (!failed) throw e; void primary /* Preserve the original assertion/abort/producer failure. */ } }
}

import { randomUUID } from "node:crypto"
import { chmodSync, closeSync, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { getConfigDir } from "../config"
import { atomicWriteJSON } from "../io"
import { identifier, object, deny } from "./enterprise-policy"
import { withRevokedEnterpriseGrants } from "./outbound-grants"

export function enterpriseStatePath(): string { return join(getConfigDir(), "enterprise-browser-state.json") }
export const ENTERPRISE_STATE_BYTES = 8 * 1024 * 1024 // includes 1024 maximum-binding approval challenges

/** A writer owns this lock for its entire lifetime. Stale locks require offline
 * operator recovery; never steal a lock based on a timestamp or PID guess. */
export function lockEnterpriseState(path: string): () => void {
  const lock = path + ".lock"
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  let fd: number
  try { fd = openSync(lock, "wx", 0o600) }
  catch (error) { return deny((error as NodeJS.ErrnoException).code === "EEXIST" ? "STATE_BUSY" : "STATE_UNWRITABLE", 503) }
  let released = false
  const owner = fstatSync(fd)
  return () => {
    if (released) return
    released = true
    // An offline operator may have removed a stale path. Do not delete a
    // successor's lock if the old process unexpectedly survived that recovery.
    try {
      const current = lstatSync(lock)
      if (current.dev === owner.dev && current.ino === owner.ino && current.isFile()) unlinkSync(lock)
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error }
    finally { closeSync(fd) }
  }
}

/** Local administrator only. The lock proves writer exclusion, NOT that the
 * browser has stopped. The operator must quiesce both before invoking this. */
export function rotateEnterpriseState(quiesced: boolean, path = enterpriseStatePath()): { archive: string; sessions: number; operations: number } {
  if (!quiesced) deny("QUIESCENCE_REQUIRED", 409)
  const unlock = lockEnterpriseState(path)
  try {
    if (!existsSync(path)) deny("STATE_NOT_FOUND", 404)
    if (statSync(path).size > ENTERPRISE_STATE_BYTES) deny("STATE_CORRUPT", 503)
    const bytes = readFileSync(path)
    if (bytes.length > ENTERPRISE_STATE_BYTES) deny("STATE_CORRUPT", 503)
    let raw: Record<string, unknown>
    try { raw = object(JSON.parse(bytes.toString("utf8")), ["version", "sessions", "operations"]) }
    catch { return deny("STATE_CORRUPT", 503) }
    if (raw.version !== 1 || !Array.isArray(raw.sessions) || !Array.isArray(raw.operations) || raw.sessions.length > 128 || raw.operations.length > 1024) deny("STATE_CORRUPT", 503)
    const sessions = raw.sessions as Record<string, unknown>[], operations = raw.operations as Record<string, unknown>[]
    const handles = new Set<string>(), grants = new Set<string>()
    const opHandles = new Set<string>()
    try {
      for (const session of sessions) { const handle = identifier(session.handle); if (handles.has(handle)) throw new Error(); handles.add(handle); grants.add(identifier(session.grant_id)) }
      for (const op of operations) { const handle = identifier(op.handle); if (opHandles.has(handle) || !handles.has(identifier(op.session))) throw new Error(); opHandles.add(handle) }
    } catch { return deny("STATE_CORRUPT", 503) }
    return withRevokedEnterpriseGrants([...grants], () => {
      const directory = join(dirname(path), "enterprise-browser-archives")
      mkdirSync(directory, { recursive: true, mode: 0o700 })
      chmodSync(directory, 0o700)
      const archive = join(directory, randomUUID() + ".json")
      // Non-overwriting archive before reset. A failed reset leaves the old
      // state intact; a failed archive must never lead to a reset.
      const fd = openSync(archive, "wx", 0o600)
      try { writeFileSync(fd, bytes); fsyncSync(fd) } finally { closeSync(fd) }
      atomicWriteJSON(path, { version: 1, sessions: [], operations: [] }, 0o600)
      return { archive, sessions: sessions.length, operations: operations.length }
    })
  } finally { unlock() }
}

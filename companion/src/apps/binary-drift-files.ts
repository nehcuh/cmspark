/** #689: explicit, bounded measurement of one registered binary. Never executes it. */
import * as fs from "node:fs"
import * as path from "node:path"
import { createHash } from "node:crypto"
import { performance } from "node:perf_hooks"
import { setImmediate as yieldTurn } from "node:timers/promises"
import { resolveWinScript, runPs, type PsRunner } from "../host-use/win/powershell"
import { isUserWritablePath, type AppEntry } from "./types"

const DEADLINE_MS = 15_000
const MAX_BYTES = 256 * 1024 * 1024
const CHUNK_BYTES = 64 * 1024
const SHA256 = /^[0-9a-f]{64}$/i
/** Explicit test seam only. No option comes from a socket, config or model. */
export interface AppBinaryMeasureDeps {
 platform?: NodeJS.Platform
 fs?: Pick<typeof fs, "lstatSync" | "realpathSync" | "openSync" | "readSync" | "fstatSync" | "closeSync">
 runner?: PsRunner
 now?: () => number
}
export interface AppBinaryMeasurement {
 readonly sha256: string
 readonly signer: string | undefined
 readonly userWritable: boolean
 /** Private current-file fence; not a transport/approval object or reusable grant. */
 readonly recheck: () => void
}
class MeasurementError extends Error {
 readonly code: "APP_DRIFT_MEASUREMENT_FAILED" | "APP_DRIFT_SIGNER_UNSUPPORTED"
 constructor(code: MeasurementError["code"] = "APP_DRIFT_MEASUREMENT_FAILED") { super(code); this.code = code }
}
function refuse(): never { throw new MeasurementError() }
function supportedPath(value: unknown): value is string {
 if (typeof value !== "string" || value.length > 259 || !/^[A-Za-z]:\\/.test(value)
  || !/\.exe$/i.test(value) || /[\x00-\x1f\x7f-\x9f\u2028\u2029\u202a-\u202e\u2066-\u2069/%!@"'<>|?*]/.test(value)) return false
 return value.slice(3).split("\\").every(s => !!s && s !== "." && s !== ".." && !/[ .]$/.test(s)
  && !s.includes(":") && !/^(CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])$/i.test(s.split(".")[0].replace(/ +$/, "")))
}
const identity = (s: fs.BigIntStats): string => JSON.stringify((s.isDirectory()
 ? [s.dev, s.ino, s.mode, s.birthtimeNs]
 : [s.dev, s.ino, s.mode, s.nlink, s.size, s.mtimeNs, s.ctimeNs, s.birthtimeNs]).map(String))
function chain(value: string): string[] {
 const result = [value]
 while (true) { const parent = path.win32.dirname(result[0]); if (parent === result[0]) return result; result.unshift(parent) }
}
function exactObject(raw: string, keys: readonly string[]): Record<string, unknown> {
 if (typeof raw !== "string" || Buffer.byteLength(raw, "utf8") > 4096) refuse()
 let value: unknown
 try { value = JSON.parse(raw.trim()) } catch { refuse() }
 if (!value || typeof value !== "object" || Array.isArray(value)) refuse()
 const actual = Object.keys(value).sort()
 if (JSON.stringify(actual) !== JSON.stringify([...keys].sort())) refuse()
 return value as Record<string, unknown>
}

export async function measureAppBinary(entry: AppEntry, checkpoint: () => void, deps: AppBinaryMeasureDeps = {}): Promise<AppBinaryMeasurement> {
 // Freeze authority before the first asynchronous boundary. Caller owns subject/owner event latch.
 const exe = entry.exe?.path
 const pin = entry.exe?.sha256
 const registeredSigner = entry.exe?.signer ?? ""
 const now = deps.now ?? (() => performance.now())
 const started = now()
 const check = (): void => { checkpoint(); const elapsed = now() - started; if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed >= DEADLINE_MS) refuse() }
 check()
 if ((deps.platform ?? process.platform) !== "win32" || entry.kind !== "gui" || !entry.token.startsWith("win.app.")
  || entry.aumid || entry.bundleId || entry.cli_manifest || !supportedPath(exe) || typeof pin !== "string" || !SHA256.test(pin)
  || typeof registeredSigner !== "string" || registeredSigner.length > 2048 || /[\x00-\x1f\x7f-\x9f\u2028\u2029]/.test(registeredSigner)) refuse()
 const io = deps.fs ?? fs
 const runner = deps.runner ?? runPs
 const observed = new Map<string, string>()
 let fd: number | undefined
 const probe = async (script: string, measuredPath = exe): Promise<string> => {
  check()
  try {
   const raw = await runner(resolveWinScript(script), ["-TargetPath", measuredPath], { timeoutMs: Math.max(1, Math.ceil(DEADLINE_MS - (now() - started))) })
   check(); return raw
  } catch (error) { check(); throw error }
 }
 const lstat = (value: string): fs.BigIntStats => { const s = io.lstatSync(value, { bigint: true }); if (s.isSymbolicLink()) refuse(); return s }
 try {
  if (exactObject(await probe("apps-drift-files.ps1"), ["ok"]).ok !== true) refuse()
  const canonical = io.realpathSync(exe).toString()
  if (!supportedPath(canonical)) refuse()
  // Canonicalization may resolve a casing/8.3 spelling. Independently verify its drive/chain,
  // with the same immutable path as argv, never native source interpolation.
  check()
  const metadataRaw = await runner(resolveWinScript("apps-drift-files.ps1"), ["-TargetPath", canonical], { timeoutMs: Math.max(1, Math.ceil(DEADLINE_MS - (now() - started))) }).catch(error => { check(); throw error })
  check()
  if (exactObject(metadataRaw, ["ok"]).ok !== true) refuse()
  const paths = chain(canonical)
  for (let i = 0; i < paths.length; i++) {
   check(); const stat = lstat(paths[i])
   if (i < paths.length - 1 ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1n || stat.size <= 0n || stat.size > BigInt(MAX_BYTES)) refuse()
   observed.set(paths[i], identity(stat))
  }
  const sameFile = (): fs.BigIntStats => {
   const current = io.fstatSync(fd!, { bigint: true })
   if (!current.isFile() || current.nlink !== 1n || identity(current) !== observed.get(canonical)) refuse()
   return current
  }
  const recheck = (): void => {
   try {
    check()
    if (io.realpathSync(exe).toString() !== canonical) refuse()
    for (const [value, expected] of observed) if (identity(lstat(value)) !== expected) refuse()
    check()
   } catch (error) {
    check()
    if (error instanceof MeasurementError) throw error
    throw new MeasurementError()
   }
  }
  fd = io.openSync(canonical, "r")
  const expectedSize = sameFile().size
  const buffer = Buffer.alloc(CHUNK_BYTES)
  const hash = createHash("sha256")
  let total = 0
  while (true) {
   check(); sameFile()
   // One-byte EOF lookahead is never hashed/accepted. A growth race refuses immediately.
   const wanted = Math.min(CHUNK_BYTES, Number(expectedSize) - total + 1)
   const n = io.readSync(fd, buffer, 0, wanted, null)
   check()
   if (!Number.isInteger(n) || n < 0 || n > wanted || BigInt(total + n) > expectedSize) refuse()
   if (n === 0) { if (BigInt(total) !== expectedSize) refuse(); break }
   hash.update(buffer.subarray(0, n)); total += n
   sameFile()
   // Yield between bounded chunks so actual socket/owner changes can invalidate this request.
   await yieldTurn(); check()
  }
  sameFile(); recheck()
  const reply = exactObject(await probe("apps-signer.ps1", canonical), ["status", "signer"])
  if (typeof reply.signer !== "string" || reply.signer.length > 2048 || /[\x00-\x1f\x7f-\x9f\u2028\u2029]/.test(reply.signer)
   || !((reply.status === "Valid" && registeredSigner.length > 0 && reply.signer === registeredSigner)
    || (reply.status === "NotSigned" && registeredSigner === "" && reply.signer === ""))) throw new MeasurementError("APP_DRIFT_SIGNER_UNSUPPORTED")
  sameFile(); recheck()
  const userWritable = isUserWritablePath(canonical)
  check()
  return Object.freeze({ sha256: hash.digest("hex"), signer: reply.signer || undefined, userWritable, recheck })
 } catch (error) {
  // Never expose native exception paths/body. Owner/cancel checkpoint failures retain their code.
  check()
  if (error instanceof MeasurementError) throw error
  throw new MeasurementError()
 } finally {
  if (fd !== undefined) {
   try { io.closeSync(fd) } catch { throw new MeasurementError() }
  }
  // Cleanup belongs to the original measurement budget/owner lifetime too.
  // A return value evaluated before finally must not survive late cancellation.
  check()
 }
}

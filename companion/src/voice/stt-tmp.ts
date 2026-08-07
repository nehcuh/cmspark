// Path B M1 — STT session temp dir (ADR-023 L11).
// DATA_DIR/tmp/voice-stt/<sessionId>/ — dirs 0o700, files 0o600; boot GC orphans.

import * as fs from "node:fs"
import { chmod, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises"
import * as path from "node:path"

/** sessionId: alphanumerics, underscore, hyphen only — no path seps / `..`. */
const SESSION_ID_RE = /^[a-zA-Z0-9_-]+$/

/** Basename-only file names under a session dir. */
const FILE_NAME_RE = /^[a-zA-Z0-9._-]+$/

export function voiceSttTmpRoot(dataDir: string): string {
  return path.join(dataDir, "tmp", "voice-stt")
}

/**
 * Reject path traversal / unsafe session ids.
 * @throws Error when invalid
 */
export function sanitizeSessionId(sessionId: string): string {
  if (typeof sessionId !== "string" || sessionId.length === 0 || sessionId.length > 128) {
    throw new Error("invalid sessionId: empty or too long")
  }
  if (sessionId.includes("..") || sessionId.includes("/") || sessionId.includes("\\")) {
    throw new Error("invalid sessionId: path separators or .. not allowed")
  }
  if (!SESSION_ID_RE.test(sessionId)) {
    throw new Error("invalid sessionId: only [a-zA-Z0-9_-] allowed")
  }
  return sessionId
}

function assertWithin(parent: string, child: string): void {
  const root = path.resolve(parent)
  const target = path.resolve(child)
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error(`path escapes sandbox: ${child}`)
  }
}

/**
 * Create `DATA_DIR/tmp/voice-stt/<sessionId>` with mode 0o700.
 * @returns absolute session directory path
 */
export async function createSessionDir(sessionId: string, dataDir: string): Promise<string> {
  const id = sanitizeSessionId(sessionId)
  const root = voiceSttTmpRoot(dataDir)
  await mkdir(root, { recursive: true, mode: 0o700 })
  try {
    await chmod(root, 0o700)
  } catch {
    /* best-effort on platforms without chmod */
  }
  const dir = path.join(root, id)
  assertWithin(root, dir)
  await mkdir(dir, { recursive: true, mode: 0o700 })
  try {
    await chmod(dir, 0o700)
  } catch {
    /* best-effort */
  }
  return dir
}

/**
 * Write a file under session dir with mode 0o600.
 * `name` must be basename-only (no path seps / `..`).
 * @returns absolute file path
 */
export async function writeSessionFile(dir: string, name: string, buf: Buffer): Promise<string> {
  if (typeof name !== "string" || !name || !FILE_NAME_RE.test(name) || path.basename(name) !== name) {
    throw new Error("invalid session file name")
  }
  if (name.includes("..")) {
    throw new Error("invalid session file name: ..")
  }
  const filePath = path.join(dir, name)
  assertWithin(dir, filePath)
  await writeFile(filePath, buf, { mode: 0o600 })
  try {
    await chmod(filePath, 0o600)
  } catch {
    /* best-effort */
  }
  return filePath
}

/** Recursive remove of a session directory (best-effort force). */
export async function removeSessionDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true })
}

/**
 * Delete session dirs under voice-stt root older than maxAgeMs (by mtime).
 * @returns number of directories removed
 */
export async function gcOrphanSessions(dataDir: string, maxAgeMs: number): Promise<number> {
  const root = voiceSttTmpRoot(dataDir)
  if (!fs.existsSync(root)) return 0
  const now = Date.now()
  let removed = 0
  let entries: fs.Dirent[]
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return 0
  }
  for (const ent of entries) {
    if (!ent.isDirectory()) continue
    // only touch names that look like session ids (skip junk / traversal names)
    if (!SESSION_ID_RE.test(ent.name) || ent.name.includes("..")) continue
    const full = path.join(root, ent.name)
    try {
      assertWithin(root, full)
      const st = await stat(full)
      if (now - st.mtimeMs > maxAgeMs) {
        await rm(full, { recursive: true, force: true })
        removed += 1
      }
    } catch {
      /* skip unreadable */
    }
  }
  return removed
}

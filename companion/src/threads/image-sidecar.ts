// Per-thread image sidecar I/O.
//
// Bytes live in `threads/<threadId>.files/<msgId>-<n>.<ext>` (mode 0o600, dir 0o700).
// Load paths are companion-chosen only — never join a client `rel` / sha256 into a
// filesystem path. Containment: lstat dir must be a real directory (not a symlink);
// realpath(file) must be strictly inside realpath(dir).

import * as fs from "fs"
import * as path from "path"
import { getConfigDir } from "../config"
import type { ImageAttachmentMeta } from "../llm/image-parts"
import { sniffRasterImage, sniffedExt, type RasterMime } from "../llm/image-sniff"
import { isStrictlyInside } from "../obsidian/vault-templates"

const SAFE_THREAD_ID = /^[a-zA-Z0-9_-]{1,64}$/
const SAFE_MSG_ID = /^[a-zA-Z0-9_-]{1,128}$/
const MAX_SIDECAR_INDEX = 99

const MIME_FROM_EXT = {
  png: "image/png",
  jpg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
} as const

export function attachmentsDir(configDir: string, threadId: string): string {
  return path.join(path.resolve(configDir, "threads"), `${threadId}.files`)
}

export function sidecarBasename(msgId: string, index: number, mime: RasterMime): string {
  return `${msgId}-${index}.${sniffedExt(mime)}`
}

/** True iff `rel` is exactly a companion-chosen basename (no path seps / `..`). */
export function parseCompanionSidecarRel(
  rel: string,
): { msgId: string; index: number; mime: RasterMime } | null {
  if (typeof rel !== "string" || rel.length === 0) return null
  if (rel.includes("\0") || rel.includes("..") || rel.includes("/") || rel.includes("\\")) {
    return null
  }
  if (path.basename(rel) !== rel) return null
  const m = /^([a-zA-Z0-9_-]{1,128})-(\d{1,2})\.(png|jpg|gif|webp)$/.exec(rel)
  if (!m) return null
  const index = Number(m[2])
  if (!Number.isInteger(index) || index < 0 || index > MAX_SIDECAR_INDEX) return null
  const ext = m[3] as keyof typeof MIME_FROM_EXT
  return { msgId: m[1]!, index, mime: MIME_FROM_EXT[ext] }
}

function isSafeThreadId(threadId: string): boolean {
  return typeof threadId === "string" && SAFE_THREAD_ID.test(threadId)
}

function isSafeMsgId(msgId: string): boolean {
  return typeof msgId === "string" && SAFE_MSG_ID.test(msgId)
}

function resolveAttachmentsDir(configDir: string, threadId: string): string | null {
  if (!isSafeThreadId(threadId)) return null
  const dir = attachmentsDir(configDir, threadId)
  const threadsDir = path.resolve(configDir, "threads")
  const resolved = path.resolve(dir)
  const rel = path.relative(threadsDir, resolved)
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null
  return resolved
}

function lstatDirNotSymlink(dir: string): fs.Stats | null {
  try {
    const st = fs.lstatSync(dir)
    if (!st.isDirectory() || st.isSymbolicLink()) return null
    return st
  } catch {
    return null
  }
}

function ensureAttachmentsDir(configDir: string, threadId: string): string | null {
  const dir = resolveAttachmentsDir(configDir, threadId)
  if (!dir) return null
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  }
  try {
    fs.chmodSync(dir, 0o700)
  } catch {
    /* best-effort on platforms without chmod */
  }
  if (!lstatDirNotSymlink(dir)) return null
  return dir
}

function loadSidecarBytes(threadId: string, basename: string): Buffer | null {
  const parsed = parseCompanionSidecarRel(basename)
  if (!parsed) return null
  const name = sidecarBasename(parsed.msgId, parsed.index, parsed.mime)
  const dir = resolveAttachmentsDir(getConfigDir(), threadId)
  if (!dir) return null
  if (!lstatDirNotSymlink(dir)) return null
  const dest = path.join(dir, name)
  try {
    const fileSt = fs.lstatSync(dest)
    if (!fileSt.isFile() && !fileSt.isSymbolicLink()) return null
  } catch {
    return null
  }
  let realFile: string
  let realDir: string
  try {
    realFile = fs.realpathSync(dest)
    realDir = fs.realpathSync(dir)
  } catch {
    return null
  }
  if (!isStrictlyInside(realFile, realDir)) return null
  try {
    return fs.readFileSync(realFile)
  } catch {
    return null
  }
}

export function writeImageSidecar(
  threadId: string,
  msgId: string,
  index: number,
  mime: RasterMime,
  buf: Buffer,
): { rel: string } | null {
  if (!isSafeThreadId(threadId) || !isSafeMsgId(msgId)) return null
  if (!Number.isInteger(index) || index < 0 || index > MAX_SIDECAR_INDEX) return null
  if (!Buffer.isBuffer(buf)) return null
  const sniffed = sniffRasterImage(buf)
  if (!sniffed || sniffed !== mime) return null
  const dir = ensureAttachmentsDir(getConfigDir(), threadId)
  if (!dir) return null

  const name = sidecarBasename(msgId, index, sniffed)
  const dest = path.join(dir, name)
  const tmp = `${dest}.tmp-${process.pid}`
  fs.writeFileSync(tmp, buf, { mode: 0o600 })
  try {
    fs.renameSync(tmp, dest)
  } catch (err) {
    try {
      fs.unlinkSync(tmp)
    } catch {
      /* ignore */
    }
    throw err
  }
  try {
    fs.chmodSync(dest, 0o600)
  } catch {
    /* best-effort */
  }

  let realFile: string
  let realDir: string
  try {
    realFile = fs.realpathSync(dest)
    realDir = fs.realpathSync(dir)
  } catch {
    try {
      fs.unlinkSync(dest)
    } catch {
      /* ignore */
    }
    return null
  }
  if (!isStrictlyInside(realFile, realDir)) {
    try {
      fs.unlinkSync(dest)
    } catch {
      /* ignore */
    }
    return null
  }
  return { rel: name }
}

export function readImageSidecar(threadId: string, rel: string): Buffer | null
export function readImageSidecar(
  threadId: string,
  msgId: string,
  index: number,
  mime: RasterMime,
): Buffer | null
export function readImageSidecar(
  threadId: string,
  msgIdOrRel: string,
  index?: number,
  mime?: RasterMime,
): Buffer | null {
  if (index === undefined || mime === undefined) {
    const parsed = parseCompanionSidecarRel(msgIdOrRel)
    if (!parsed) return null
    return loadSidecarBytes(threadId, sidecarBasename(parsed.msgId, parsed.index, parsed.mime))
  }
  if (!isSafeMsgId(msgIdOrRel)) return null
  if (!Number.isInteger(index) || index < 0 || index > MAX_SIDECAR_INDEX) return null
  return loadSidecarBytes(threadId, sidecarBasename(msgIdOrRel, index, mime))
}

/**
 * Hydrate helper (Task 6): map metadata → sidecar using companion naming.
 * `att.rel` is never used as a load path; a forged rel returns null.
 */
export function readImageAttachment(threadId: string, att: ImageAttachmentMeta): Buffer | null {
  if (!att || att.kind !== "image") return null
  const mime = att.mime
  if (!mime) return null

  let msgId = att.msg_id
  let index = att.index

  if (att.rel != null) {
    const parsed = parseCompanionSidecarRel(att.rel)
    if (!parsed) return null
    if (msgId && parsed.msgId !== msgId) return null
    if (typeof index === "number" && parsed.index !== index) return null
    if (parsed.mime !== mime) return null
    msgId = parsed.msgId
    index = parsed.index
  }

  if (typeof msgId !== "string" || typeof index !== "number") return null
  return readImageSidecar(threadId, msgId, index, mime)
}

function unlinkContained(realDir: string, basename: string): void {
  const parsed = parseCompanionSidecarRel(basename)
  if (!parsed) return
  const name = sidecarBasename(parsed.msgId, parsed.index, parsed.mime)
  const dest = path.join(realDir, name)
  let realFile: string
  try {
    realFile = fs.realpathSync(dest)
  } catch {
    return
  }
  if (!isStrictlyInside(realFile, realDir)) return
  try {
    fs.unlinkSync(realFile)
  } catch {
    /* ignore missing */
  }
}

/**
 * Unlink sidecars for the given messages. Called from deleteMessagesFrom and
 * from addMessage's MAX_MESSAGES_PER_THREAD cap-trim (dropped prefix).
 */
export function deleteSidecarsForMessages(
  threadId: string,
  messages: Array<{ id: string; attachments?: ImageAttachmentMeta[] }>,
): void {
  if (!isSafeThreadId(threadId) || !Array.isArray(messages) || messages.length === 0) return
  const dir = resolveAttachmentsDir(getConfigDir(), threadId)
  if (!dir || !lstatDirNotSymlink(dir)) return
  let realDir: string
  try {
    realDir = fs.realpathSync(dir)
  } catch {
    return
  }

  const names = new Set<string>()
  for (const m of messages) {
    if (!isSafeMsgId(m.id)) continue
    const atts = m.attachments || []
    atts.forEach((att, i) => {
      if (!att || att.kind !== "image" || !att.mime) return
      const idx = typeof att.index === "number" ? att.index : i
      if (!Number.isInteger(idx) || idx < 0 || idx > MAX_SIDECAR_INDEX) return
      names.add(sidecarBasename(m.id, idx, att.mime))
    })
    try {
      const prefix = `${m.id}-`
      for (const ent of fs.readdirSync(dir)) {
        if (ent.startsWith(prefix) && parseCompanionSidecarRel(ent)) names.add(ent)
      }
    } catch {
      /* ignore */
    }
  }
  for (const name of names) unlinkContained(realDir, name)
}

function iterIdMap(
  idMap: ReadonlyMap<string, string> | Record<string, string>,
): Iterable<[string, string]> {
  return idMap instanceof Map ? idMap.entries() : Object.entries(idMap)
}

/**
 * Copy sidecar bytes from `fromId` → `toId` using oldMsgId → newMsgId.
 * Used by `thread.fork` after messages are copied (new ids). Source load and
 * dest write use the same containment as read/write (lstat dir not symlink,
 * realpath file strictly inside realpath dir). Caller stamps dest
 * attachments.rel / msg_id (addMessage → stampAttachments).
 *
 * @returns number of sidecar files written to the dest thread
 */
export function copyAttachmentsToThread(
  fromId: string,
  toId: string,
  idMap: ReadonlyMap<string, string> | Record<string, string>,
): number {
  if (!isSafeThreadId(fromId) || !isSafeThreadId(toId) || fromId === toId) return 0

  const srcDir = resolveAttachmentsDir(getConfigDir(), fromId)
  if (!srcDir || !lstatDirNotSymlink(srcDir)) return 0
  try {
    fs.realpathSync(srcDir)
  } catch {
    return 0
  }

  let entries: string[]
  try {
    entries = fs.readdirSync(srcDir)
  } catch {
    return 0
  }

  let copied = 0
  for (const [oldMsgId, newMsgId] of iterIdMap(idMap)) {
    if (!isSafeMsgId(oldMsgId) || !isSafeMsgId(newMsgId)) continue
    for (const ent of entries) {
      const parsed = parseCompanionSidecarRel(ent)
      if (!parsed || parsed.msgId !== oldMsgId) continue
      const buf = loadSidecarBytes(fromId, sidecarBasename(parsed.msgId, parsed.index, parsed.mime))
      if (!buf) continue
      const written = writeImageSidecar(toId, newMsgId, parsed.index, parsed.mime, buf)
      if (written) copied++
    }
  }
  return copied
}

/**
 * Hard-delete `threads/<id>.files/`. Refuses if the path is a symlink or not a
 * directory (do not rmSync through a planted link).
 */
export function removeAttachmentsDir(threadId: string, configDir = getConfigDir()): boolean {
  if (!isSafeThreadId(threadId)) return false
  const dir = attachmentsDir(configDir, threadId)
  let st: fs.Stats
  try {
    st = fs.lstatSync(dir)
  } catch {
    return false
  }
  if (st.isSymbolicLink() || !st.isDirectory()) return false

  let realDir: string
  let realThreads: string
  try {
    realDir = fs.realpathSync(dir)
    realThreads = fs.realpathSync(path.resolve(configDir, "threads"))
  } catch {
    return false
  }
  if (!isStrictlyInside(realDir, realThreads)) return false
  if (path.basename(realDir) !== `${threadId}.files`) return false
  try {
    fs.rmSync(realDir, { recursive: true, force: false })
    return true
  } catch {
    return false
  }
}

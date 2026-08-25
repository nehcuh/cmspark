// Shared {id, filename, title} allocator for skills/knowledge write paths.
// Spec: docs/superpowers/specs/2026-08-25-daily-assistant-knowledge-honesty-design.md F-I-1 / F-I-7

import * as crypto from "crypto"
import * as fs from "fs"
import * as path from "path"

export const FILENAME_STEM_MAX = 80
export const TITLE_MAX = 200

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\.|$)/i
const UNSAFE_CHARS = /[<>:"/\\|?*\u0000]/

export type DocIdentity = {
  /** Stable key for get() / active_knowledge_ids. ASCII stem. */
  id: string
  /** Basename without .md (=== id). */
  filenameStem: string
  /** Display / prompt heading. CJK allowed. */
  title: string
}

export function nfc(s: string): string {
  return String(s ?? "").normalize("NFC")
}

/** Existing frontmatter `name` that can stay as id (no rewrite). */
export function isLegacySafeId(s: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(s) && !isUnsafePathComponent(s)
}

export function isUnsafePathComponent(stem: string): boolean {
  if (!stem) return true
  if (stem === "." || stem === "..") return true
  if (UNSAFE_CHARS.test(stem)) return true
  if (/[. ]$/.test(stem)) return true
  if (WINDOWS_RESERVED.test(stem)) return true
  if (stem.includes("..")) return true
  return false
}

/** ASCII slug; empty if CJK-only, path-shaped, or all stripped. Never maps `../x` → `x`. */
export function asciiSlug(raw: string): string {
  const n = nfc(raw)
  if (/[<>:"/\\|?*\u0000]/.test(n) || n.includes("..")) return ""
  const s = n
    .replace(/[^a-zA-Z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
  if (!s || /^-+$/.test(s)) return ""
  return s.slice(0, FILENAME_STEM_MAX)
}

export function hashedStem(title: string): string {
  const h = crypto.createHash("sha256").update(nfc(title), "utf8").digest("hex").slice(0, 10)
  return `k-${h}`
}

export function cleanTitle(raw: string): string {
  const t = nfc(raw)
    .replace(/[\x00-\x1F\x7F]/g, "")
    .trim()
    .slice(0, TITLE_MAX)
  return t || "未命名"
}

/**
 * Allocate a filesystem-safe identity.
 * CJK titles get a stable `k-<sha256>` stem so 产品甲 / 产品乙 never share `--.md`.
 * `preferredId` (legacy ascii `name`) is kept when already safe and free.
 */
export function allocateDocIdentity(opts: {
  title: string
  preferredId?: string
  /** Extra hash seed (e.g. vault-relative path) so same heading in two folders does not collide. */
  seed?: string
  takenStems?: Iterable<string>
}): DocIdentity {
  const title = cleanTitle(opts.title)
  const hashInput = opts.seed && String(opts.seed).trim() ? String(opts.seed) : title
  const taken = new Set(
    [...(opts.takenStems || [])].map((s) => String(s).toLowerCase()).filter(Boolean),
  )

  const preferred = opts.preferredId ? asciiSlug(opts.preferredId) : ""
  let stem = ""
  if (preferred && !isUnsafePathComponent(preferred)) {
    stem = preferred
  } else {
    const fromTitle = asciiSlug(title)
    stem = fromTitle && !isUnsafePathComponent(fromTitle) ? fromTitle : hashedStem(hashInput)
  }
  if (isUnsafePathComponent(stem)) stem = hashedStem(hashInput)

  let unique = stem.slice(0, FILENAME_STEM_MAX)
  let n = 2
  while (taken.has(unique.toLowerCase()) || isUnsafePathComponent(unique)) {
    const suffix = `-${n}`
    unique = `${stem.slice(0, Math.max(1, FILENAME_STEM_MAX - suffix.length))}${suffix}`
    n += 1
    if (n > 1000) {
      throw new Error(`Too many filename collisions for '${title}'`)
    }
  }

  return { id: unique, filenameStem: unique, title }
}

export function listStemSet(dir: string): Set<string> {
  const out = new Set<string>()
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue
      const stem = entry.name.endsWith(".md") ? entry.name.slice(0, -3) : entry.name
      if (entry.isSymbolicLink() || entry.isFile() || entry.isDirectory()) {
        out.add(stem.toLowerCase())
      }
    }
  } catch {
    /* dir may not exist */
  }
  return out
}

export function writeRestrictedFile(filePath: string, content: string | Buffer): void {
  const parent = path.dirname(filePath)
  fs.mkdirSync(parent, { recursive: true })
  try {
    if (fs.lstatSync(filePath).isSymbolicLink()) {
      throw new Error(`Refusing to write through symlink: ${filePath}`)
    }
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException)?.code
    if (code !== "ENOENT") throw err
  }
  if (Buffer.isBuffer(content)) {
    fs.writeFileSync(filePath, content, { mode: 0o600 })
  } else {
    fs.writeFileSync(filePath, content, { encoding: "utf8", mode: 0o600 })
  }
}

/** Skip symlink / Windows junction when walking import trees. Fail-closed on lstat error. */
export function isSymlinkOrJunction(dir: string, entry: fs.Dirent): boolean {
  if (entry.isSymbolicLink()) return true
  try {
    return fs.lstatSync(path.join(dir, entry.name)).isSymbolicLink()
  } catch {
    return true
  }
}

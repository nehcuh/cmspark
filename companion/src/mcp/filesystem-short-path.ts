// Windows 8.3 spellings must match the official filesystem server's native
// roots. Expand alias components only, never replace a link with its target.
import fs from "node:fs"
import path from "node:path"
import type { McpServerConfig } from "./types"
import { MCP_FILESYSTEM_PACKAGE } from "./filesystem-home"

const SHORT_COMPONENT = /~\d+(?:\.[^.]*)?$/i
const PATH_FIELDS: Record<string, readonly string[]> = {
  read_file: ["path"], read_text_file: ["path"], read_media_file: ["path"],
  read_multiple_files: ["paths"], write_file: ["path"], edit_file: ["path"],
  create_directory: ["path"], list_directory: ["path"], list_directory_with_sizes: ["path"],
  directory_tree: ["path"], move_file: ["source", "destination"],
  search_files: ["path"], get_file_info: ["path"],
}

/** Match local launch identities, not a display name or an arbitrary SSH arg. */
export function isLocalOfficialFilesystem(cfg: McpServerConfig): boolean {
  if (cfg.transport !== "stdio") return false
  const command = path.win32.basename(cfg.command).toLowerCase()
  if (/^mcp-server-filesystem(?:\.cmd|\.exe)?$/.test(command)) return true
  const args = cfg.args ?? []
  if (/^npx(?:\.cmd|\.exe)?$/.test(command)) {
    const index = args.findIndex(arg => arg === MCP_FILESYSTEM_PACKAGE || arg.startsWith(`${MCP_FILESYSTEM_PACKAGE}@`))
    return index >= 0 && args.slice(0, index).every(arg => ["-y", "--yes", "--no", "--quiet", "-q", "--offline", "--"].includes(arg))
  }
  return /^node(?:\.exe)?$/.test(command) &&
    /(?:^|[\\/])@modelcontextprotocol[\\/]server-filesystem[\\/]dist[\\/]index\.js$/.test(args[0] ?? "")
}

export type ShortPathFs = {
  lstat: (p: string) => Promise<{ isSymbolicLink(): boolean }>
  realpath: (p: string) => Promise<string>
}
const nativeFs: ShortPathFs = { lstat: p => fs.promises.lstat(p), realpath: p => fs.promises.realpath(p) }
const sameParent = (a: string, b: string) => path.win32.normalize(a).toLowerCase() === path.win32.normalize(b).toLowerCase()

export async function expandWindowsShortPath(input: string, signal?: AbortSignal, deps = nativeFs): Promise<string> {
  // Leave relative/drive-relative, URI, device and alternate-stream syntax to
  // the server. Only ordinary absolute drive/UNC paths have this compatibility.
  if (!/^(?:[a-z]:[\\/]|\\\\[^\\/?\.][^\\/]*[\\/][^\\/]+[\\/])/i.test(input)) return input
  const normalized = path.win32.normalize(input)
  const root = path.win32.parse(normalized).root
  const parts = normalized.slice(root.length).split(/[\\/]/).filter(Boolean)
  if (!parts.some(p => SHORT_COMPONENT.test(p)) || parts.some(p => p.includes(":"))) return input
  let prefix = root
  for (const part of parts) {
    signal?.throwIfAborted()
    const candidate = path.win32.join(prefix, part)
    if (SHORT_COMPONENT.test(part)) {
      try {
        const before = await deps.lstat(candidate)
        signal?.throwIfAborted()
        if (before.isSymbolicLink()) return input
        const expanded = await deps.realpath(candidate)
        signal?.throwIfAborted()
        // A junction ancestor or reparse point must not move the lexical cage.
        if (!sameParent(path.win32.dirname(expanded), prefix)) return input
        const after = await deps.lstat(candidate)
        signal?.throwIfAborted()
        if (after.isSymbolicLink()) return input
        prefix = expanded
        continue
      } catch (error: any) {
        signal?.throwIfAborted()
        // A new file named e.g. draft~1.txt has no alias yet. Preserve its name
        // while still expanding any already-existing ancestors.
        if (error?.code !== "ENOENT") return input
      }
    }
    prefix = candidate
  }
  return prefix
}

export async function normalizeFilesystemToolArgs(
  tool: string, args: Record<string, any>, signal?: AbortSignal, deps = nativeFs,
): Promise<Record<string, any>> {
  const fields = PATH_FIELDS[tool]
  if (!fields) return args
  let next = args
  for (const key of fields) {
    const value = args[key]
    const mapped = typeof value === "string" ? await expandWindowsShortPath(value, signal, deps)
      : key === "paths" && Array.isArray(value) ? await Promise.all(value.map(p =>
        typeof p === "string" ? expandWindowsShortPath(p, signal, deps) : p)) : value
    const changed = Array.isArray(value) && Array.isArray(mapped) ? value.some((v, i) => v !== mapped[i]) : mapped !== value
    if (changed) {
      if (next === args) next = { ...args }
      next[key] = mapped
    }
  }
  return next
}

/** FS realpath has no signal option; release a cancelled caller immediately.
 * The normalizer checks that same signal after IO before any further lookup. */
export function waitForFilesystemNormalization<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener("abort", abort); reject(signal.reason) }
    signal.addEventListener("abort", abort, { once: true })
    pending.then(value => { signal.removeEventListener("abort", abort); resolve(value) },
      error => { signal.removeEventListener("abort", abort); reject(error) })
    if (signal.aborted) abort()
  })
}

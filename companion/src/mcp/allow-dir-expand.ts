// Expand MCP filesystem allow-dirs after user L2 confirm (P2).
// Paths under home or outside home may be offered; volume roots and sensitive
// system / credential trees are hard-refused (never prompted).

import * as fs from "fs"
import * as path from "path"
import * as os from "os"
import { getConfig, replaceMcpServers } from "../config"
import type { McpServerConfig, McpStdioServerConfig } from "./types"
import { isFilesystemAllowPathArg, MCP_FILESYSTEM_PACKAGE } from "./filesystem-home"
import { getMcpManager } from "./manager"

/** Extract a filesystem path from MCP denial / tool params. */
export function extractPathCandidate(errMsg: string, params: any): string | null {
  if (params && typeof params === "object") {
    for (const k of ["path", "parent", "directory", "dir", "uri"]) {
      const v = (params as any)[k]
      if (typeof v === "string" && v.trim()) {
        let p = v.trim()
        if (p.startsWith("file://")) {
          try {
            p = decodeURIComponent(p.replace(/^file:\/\//, ""))
            // file:///Users/x → /Users/x
            if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1) // windows quirk
          } catch {
            /* keep */
          }
        }
        return p
      }
    }
  }
  // "…: /path/to/x" or "path outside allowed directories: /x"
  const m =
    errMsg.match(/(?:does not exist|outside allowed[^:]*|Access denied[^:]*|not allowed[^:]*):\s*([^\s"']+)/i) ||
    errMsg.match(/((?:\/|[A-Za-z]:[\\/])[^\s"']+)/)
  if (m?.[1]) return m[1].replace(/[,;.)]+$/, "")
  return null
}

/**
 * file:// URI for MCP roots (encode each path segment; keep leading /).
 * POSIX: file:///Users/you/foo%20bar
 */
export function pathToFileUri(absPath: string): string {
  const resolved = path.resolve(absPath)
  if (process.platform === "win32") {
    const normalized = resolved.replace(/\\/g, "/")
    const withSlash = normalized.startsWith("/") ? normalized : `/${normalized}`
    // Encode each segment except drive colon handling: /C:/Users → file:///C:/Users
    const parts = withSlash.split("/")
    const encoded = parts
      .map((seg, i) => {
        if (i === 0) return ""
        // Windows drive letter segment "C:"
        if (/^[A-Za-z]:$/.test(seg)) return seg
        return encodeURIComponent(seg)
      })
      .join("/")
    return `file://${encoded.startsWith("/") ? "" : "/"}${encoded}`
  }
  const abs = resolved.startsWith("/") ? resolved : `/${resolved}`
  const encoded = abs
    .split("/")
    .map((seg, i) => (i === 0 ? "" : encodeURIComponent(seg)))
    .join("/")
  return `file://${encoded}`
}

/** Sensitive home-relative prefixes (matched case-insensitively). */
export const SENSITIVE_HOME_PREFIXES = [
  ".ssh",
  ".gnupg",
  "library/keychains",
  "library/mail",
  ".aws",
  ".config/gcloud",
  ".config/gh",
  ".kube",
  // Windows profile secrets often live under AppData
  "appdata/roaming/gnupg",
  "appdata/roaming/openssh",
]

/**
 * Path-segment basenames that never become allow-dirs (anywhere on disk).
 * Case-insensitive match on any path component.
 */
export const SENSITIVE_PATH_SEGMENTS = [
  ".ssh",
  ".gnupg",
  ".aws",
  ".kube",
  "keychains",
]

/** True when dir is a filesystem / volume root (/, C:\). */
export function isVolumeOrFsRoot(dir: string): boolean {
  const resolved = path.resolve(dir)
  return path.dirname(resolved) === resolved
}

/**
 * Multi-user profile parents (one L2 click must not open every local account).
 * Exact match only — `C:/Users/alice` and `/home/bob` remain offerable.
 */
export function isMultiUserProfilesRoot(
  dirReal: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const n = dirReal.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase()
  if (platform === "win32") {
    return /^[a-z]:\/users$/.test(n)
  }
  return n === "/users" || n === "/home" || n === "/export/home"
}

/**
 * Hard-refuse OS / firmware trees. Does not cover ordinary project mounts
 * (D:/work, /opt/apps, /data). Matched after realpath + forward-slash normalize.
 */
export function isSensitiveSystemDir(
  dirReal: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  const n = dirReal.replace(/\\/g, "/").toLowerCase()

  if (platform === "win32") {
    const patterns = [
      /^[a-z]:\/windows(\/|$)/,
      /^[a-z]:\/program files(\/|$)/,
      /^[a-z]:\/program files \(x86\)(\/|$)/,
      /^[a-z]:\/programdata(\/|$)/,
      /^[a-z]:\/\$recycle\.bin(\/|$)/,
      /^[a-z]:\/system volume information(\/|$)/,
      /^[a-z]:\/recovery(\/|$)/,
      /^[a-z]:\/perflogs(\/|$)/,
      /^[a-z]:\/boot(\/|$)/,
      /^[a-z]:\/efi(\/|$)/,
    ]
    return patterns.some((re) => re.test(n))
  }

  // POSIX / macOS system trees
  const prefixes = [
    "/etc",
    "/usr",
    "/bin",
    "/sbin",
    "/boot",
    "/proc",
    "/sys",
    "/dev",
    "/root",
    "/system",
    "/library/keychains",
    "/library/mail",
    "/private/etc",
    "/private/var/db",
    "/var/root",
    "/var/run",
    "/cores",
  ]
  return prefixes.some((p) => n === p || n.startsWith(p + "/"))
}

/** Normalize for allow-dir equality (win32 case + slash insensitive). */
export function normalizeAllowDirKey(p: string): string {
  const resolved = path.resolve(p)
  const slashed = resolved.replace(/\\/g, "/")
  return process.platform === "win32" ? slashed.toLowerCase() : slashed
}

function hasSensitivePathSegment(dirReal: string): string | null {
  const parts = dirReal.replace(/\\/g, "/").toLowerCase().split("/").filter(Boolean)
  for (const seg of parts) {
    for (const blocked of SENSITIVE_PATH_SEGMENTS) {
      if (seg === blocked.toLowerCase()) return blocked
    }
  }
  return null
}

/**
 * Directory we would add to allowlist (parent of file, or path itself if dir).
 * Allowed: absolute paths under home OR outside home (after L2).
 * Refused: volume roots, home root, sensitive system trees, credential segments.
 */
export function resolveAllowDirToOffer(
  candidatePath: string,
  home = os.homedir(),
  platform: NodeJS.Platform = process.platform,
): { ok: true; dir: string } | { ok: false; error: string } {
  if (!candidatePath || typeof candidatePath !== "string") {
    return { ok: false, error: "empty path" }
  }
  let abs = candidatePath
  if (abs.startsWith("~")) {
    abs = path.join(home, abs.slice(1).replace(/^[\\/]/, ""))
  }
  if (!path.isAbsolute(abs)) {
    return { ok: false, error: "path must be absolute to expand allow-dir" }
  }
  abs = path.resolve(abs)

  let homeReal: string
  try {
    homeReal = fs.realpathSync(home)
  } catch {
    return { ok: false, error: "cannot resolve home" }
  }

  // Classify under-home early so walk-up policy can differ.
  // (homeReal is used before dirReal; relative() works with unresolved abs too.)
  const relEarly = path.relative(homeReal, abs)
  const underHomeEarly = !(relEarly.startsWith("..") || path.isAbsolute(relEarly))

  // Prefer existing parent for allow-dir (server requires allow roots to exist).
  // Outside home: only the path itself or its *immediate* parent — never 8-level
  // walk-up (would over-grant D:/data for D:/data/a/b/c/d/e/f).
  let dir = abs
  try {
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
      dir = path.dirname(abs)
    } else if (!fs.existsSync(abs)) {
      if (underHomeEarly) {
        let cur = abs
        for (let i = 0; i < 8; i++) {
          const parent = path.dirname(cur)
          if (parent === cur || isVolumeOrFsRoot(parent)) break
          // Stop before promoting whole home
          const relParent = path.relative(homeReal, parent)
          if (relParent === "" || relParent === ".") break
          if (fs.existsSync(parent) && fs.statSync(parent).isDirectory()) {
            dir = parent
            break
          }
          cur = parent
        }
      } else {
        const parent = path.dirname(abs)
        if (
          !isVolumeOrFsRoot(parent) &&
          fs.existsSync(parent) &&
          fs.statSync(parent).isDirectory()
        ) {
          dir = parent
        }
        // else leave dir=abs; existence check below will fail outside home
      }
    }
  } catch {
    dir = path.dirname(abs)
  }

  let dirReal: string
  try {
    dirReal = fs.existsSync(dir) ? fs.realpathSync(dir) : dir
  } catch {
    return { ok: false, error: `cannot resolve directory: ${dir}` }
  }

  // Never allow entire volume / filesystem root
  if (isVolumeOrFsRoot(dirReal)) {
    return {
      ok: false,
      error:
        "refusing to add a drive or filesystem root as an allow-dir; pick a specific project folder",
    }
  }

  // Multi-user parents (C:\Users, /Users, /home) — one click must not open all profiles
  if (isMultiUserProfilesRoot(dirReal, platform)) {
    return {
      ok: false,
      error: "refusing to allow multi-user profiles root; pick a specific user or project folder",
    }
  }

  // Sensitive OS trees (Windows / POSIX) — anywhere on disk
  if (isSensitiveSystemDir(dirReal, platform)) {
    return { ok: false, error: "refusing to allow sensitive system path" }
  }

  // Credential-style path segments anywhere
  const badSeg = hasSensitivePathSegment(dirReal)
  if (badSeg) {
    return { ok: false, error: `refusing to allow sensitive path segment ${badSeg}` }
  }

  const rel = path.relative(homeReal, dirReal)
  const underHome = !(rel.startsWith("..") || path.isAbsolute(rel))

  if (underHome) {
    // Refuse adding home itself (would look like "open whole home" again)
    if (rel === "" || rel === ".") {
      return {
        ok: false,
        error:
          "refusing to add the entire home directory as an allow-dir; create a project folder first (ensure_project_dir) or pick a specific subdirectory",
      }
    }

    // Block sensitive home subtrees (case-insensitive for APFS)
    const norm = rel.replace(/\\/g, "/").toLowerCase()
    for (const b of SENSITIVE_HOME_PREFIXES) {
      const bl = b.toLowerCase()
      if (norm === bl || norm.startsWith(bl + "/")) {
        return { ok: false, error: `refusing to allow sensitive path under ~/${b}` }
      }
    }
  }

  // Outside home: require the offered directory to exist (MCP server needs a real root)
  if (!underHome && !fs.existsSync(dirReal)) {
    return {
      ok: false,
      error: "directory must exist before it can be added as an allow-dir outside home",
    }
  }

  // Under home: also require offered dir exists (server-filesystem rejects missing roots)
  if (underHome && !fs.existsSync(dirReal)) {
    return {
      ok: false,
      error: "directory must exist before it can be added as an allow-dir",
    }
  }

  return { ok: true, dir: dirReal }
}

export function isAccessDeniedMcpError(errMsg: string): boolean {
  return /access denied|outside allowed|not allowed|not within|allowed director/i.test(errMsg || "")
}

export function isParentMissingMcpError(errMsg: string): boolean {
  return /parent directory does not exist/i.test(errMsg || "")
}

/** Write-like MCP tools that benefit from "create parent" guidance. */
export function isWriteLikeMcpTool(toolName: string): boolean {
  return /write|create|mkdir|move|copy|edit|append|delete|remove|unlink|rename|put|save/i.test(
    toolName || "",
  )
}

export function looksLikeFilesystemServer(name: string, cfg: McpStdioServerConfig): boolean {
  if (name === "filesystem") return true
  const args = cfg.args ?? []
  return args.some((a) => a === MCP_FILESYSTEM_PACKAGE || /server-filesystem/.test(a))
}

/**
 * Pre-flight: can we offer allow-dir expand for this denial?
 * Call before L2 so we never prompt for non-filesystem servers.
 */
export function canOfferAllowDirExpand(opts: {
  serverName: string
  rawErr: string
  params: any
}):
  | { offer: true; dir: string }
  | { offer: false; reason: string } {
  if (!isAccessDeniedMcpError(opts.rawErr)) {
    return { offer: false, reason: "not_access_denied" }
  }
  const config = getConfig()
  const existing = config.mcp?.servers?.[opts.serverName]
  if (!existing) return { offer: false, reason: "server_not_found" }
  if (existing.transport !== "stdio") return { offer: false, reason: "not_stdio" }
  if (!looksLikeFilesystemServer(opts.serverName, existing)) {
    return { offer: false, reason: "not_filesystem_server" }
  }
  const candidate = extractPathCandidate(opts.rawErr, opts.params)
  if (!candidate) return { offer: false, reason: "no_path" }
  const offered = resolveAllowDirToOffer(candidate)
  if (!offered.ok) return { offer: false, reason: offered.error }
  return { offer: true, dir: offered.dir }
}

/**
 * Persist new allow-dir on the named filesystem MCP server and hot-reload.
 * Normalizes win32 paths to forward slashes for stable stdio args.
 */
export async function addFilesystemAllowDir(
  serverName: string,
  dir: string,
): Promise<{ ok: true; args: string[] } | { ok: false; error: string }> {
  const config = getConfig()
  const existing = config.mcp?.servers?.[serverName]
  if (!existing) return { ok: false, error: `MCP server not found: ${serverName}` }
  if (existing.transport !== "stdio") {
    return { ok: false, error: "only stdio filesystem servers support allow-dir args" }
  }
  if (!looksLikeFilesystemServer(serverName, existing)) {
    return { ok: false, error: "server does not look like @modelcontextprotocol/server-filesystem" }
  }

  const offered = resolveAllowDirToOffer(dir)
  if (!offered.ok) return offered

  const dirForArgs =
    process.platform === "win32" ? offered.dir.replace(/\\/g, "/") : offered.dir
  const offerKey = normalizeAllowDirKey(offered.dir)

  const args = existing.args ? [...existing.args] : []
  const already = args.some((a) => {
    if (!isFilesystemAllowPathArg(a)) return false
    try {
      const ra = fs.existsSync(a) ? fs.realpathSync(a) : path.resolve(a)
      return normalizeAllowDirKey(ra) === offerKey
    } catch {
      return normalizeAllowDirKey(a) === offerKey
    }
  })
  if (!already) {
    args.push(dirForArgs)
  }

  const rootUri = pathToFileUri(offered.dir)
  const next: McpStdioServerConfig = {
    ...existing,
    args,
    roots: [
      ...((existing.roots || []).filter((r) => r && typeof r.uri === "string") as any[]),
      ...(already ? [] : [{ uri: rootUri, name: path.basename(offered.dir) }]),
    ],
  }

  const newServers = { ...(config.mcp?.servers || {}), [serverName]: next as McpServerConfig }
  replaceMcpServers(newServers)
  // applyConfig is triggered by CONFIG_CHANGE_EVENT; give stdio a moment to restart
  try {
    await getMcpManager().applyConfig(getConfig().mcp)
  } catch {
    /* listener may already apply */
  }
  // Brief wait for tools to re-register
  await new Promise((r) => setTimeout(r, 400))
  return { ok: true, args: next.args || [] }
}

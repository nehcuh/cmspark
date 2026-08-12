// Default allowlist for @modelcontextprotocol/server-filesystem.
// The official server refuses to expose tools until at least one directory is
// provided via CLI args OR MCP roots. We default missing allowlists to the
// user home directory (platform-aware: Windows C:/Users/... vs macOS /Users/...).
//
// Stale allow-dirs (e.g. /tmp/cmspark-allow-dir-* left by tests or expand after
// OS cleaned the path) are pruned; if nothing remains, home is re-injected so
// the server can start again (ensureFilesystemAllowlist previously treated any
// path arg as "configured" even when the directory no longer existed).

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { McpServerConfig, McpStdioServerConfig } from "./types.js"

export const MCP_FILESYSTEM_PACKAGE = "@modelcontextprotocol/server-filesystem"

/**
 * User home as an MCP allow-path.
 * On win32, use forward slashes (C:/Users/name) so stdio args are not mangled
 * by escape handling; macOS/Linux keep the POSIX path from os.homedir().
 */
export function mcpHomeDir(platform: NodeJS.Platform = process.platform, home = os.homedir()): string {
  if (platform === "win32") return home.replace(/\\/g, "/")
  return home
}

/**
 * file:// URI for MCP roots (filesystem server can use roots as allowlist).
 * Windows: file:///C:/Users/name  ·  POSIX: file:///Users/name
 */
export function mcpHomeFileUri(
  platform: NodeJS.Platform = process.platform,
  home = mcpHomeDir(platform),
): string {
  if (platform === "win32") {
    const normalized = home.replace(/\\/g, "/").replace(/^\/+/, "")
    return `file:///${normalized}`
  }
  const abs = home.startsWith("/") ? home : `/${home}`
  return `file://${abs}`
}

/** Heuristic: arg is an allow-directory (not a flag or npm package name). */
export function isFilesystemAllowPathArg(arg: string): boolean {
  if (!arg || arg.startsWith("-")) return false
  // npm package names like @modelcontextprotocol/server-filesystem
  if (arg.startsWith("@") && !/^[a-zA-Z]:/.test(arg)) return false
  if (arg === MCP_FILESYSTEM_PACKAGE || /server-filesystem/.test(arg)) return false
  if (arg.startsWith("file:")) return true
  if (/^[a-zA-Z]:[\\/]/.test(arg)) return true // Windows drive
  if (arg.startsWith("/") || arg.startsWith("~")) return true
  // Relative project paths are rare for this server but treat as path-like
  if (arg.includes("/") || arg.includes("\\")) return true
  return false
}

function looksLikeFilesystemServer(name: string, cfg: McpStdioServerConfig): boolean {
  if (name === "filesystem") return true
  const args = cfg.args ?? []
  return args.some((a) => a === MCP_FILESYSTEM_PACKAGE || /server-filesystem/.test(a))
}

/** Resolve an allow-dir arg or file:// root URI to a local path for existence checks. */
export function resolveFilesystemAllowPathForExists(
  raw: string,
  platform: NodeJS.Platform = process.platform,
  homeRaw = os.homedir(),
): string {
  let p = raw.trim()
  if (p.startsWith("file://")) {
    try {
      p = decodeURIComponent(p.replace(/^file:\/\//, ""))
      // file:///C:/Users → /C:/Users or C:/Users
      if (platform === "win32" && /^\/[A-Za-z]:/.test(p)) p = p.slice(1)
    } catch {
      /* keep p */
    }
  }
  if (p === "~") return homeRaw
  if (p.startsWith("~/") || p.startsWith("~\\")) {
    p = path.join(homeRaw, p.slice(2))
  }
  // Avoid path.resolve turning "C:/Users/x" into nonsense on POSIX; still OK for exists inject.
  if (platform === "win32") {
    return path.win32.normalize(p)
  }
  return path.normalize(p)
}

export type EnsureFilesystemAllowlistOpts = {
  /**
   * Injectable existence check (directory must exist). Tests pass stubs so
   * synthetic Windows paths on Linux CI do not get pruned.
   * Default: fs.existsSync + isDirectory.
   */
  pathExists?: (absPath: string) => boolean
}

function defaultPathExists(absPath: string): boolean {
  try {
    return fs.existsSync(absPath) && fs.statSync(absPath).isDirectory()
  } catch {
    return false
  }
}

/**
 * If this is the official filesystem server:
 * - drop allow-dir args / roots whose paths no longer exist on disk
 * - if nothing remains, inject the platform home directory into args + roots + cwd
 *
 * Idempotent when all configured paths still exist.
 */
export function ensureFilesystemAllowlist(
  name: string,
  cfg: McpServerConfig,
  platform: NodeJS.Platform = process.platform,
  homeRaw = os.homedir(),
  opts?: EnsureFilesystemAllowlistOpts,
): McpServerConfig {
  if (cfg.transport !== "stdio") return cfg
  if (!looksLikeFilesystemServer(name, cfg)) return cfg

  const home = mcpHomeDir(platform, homeRaw)
  const pathExists = opts?.pathExists ?? defaultPathExists
  const argsIn = cfg.args ? [...cfg.args] : []

  let pruned = false
  const args: string[] = []
  for (const a of argsIn) {
    if (!isFilesystemAllowPathArg(a)) {
      args.push(a)
      continue
    }
    const resolved = resolveFilesystemAllowPathForExists(a, platform, homeRaw)
    if (pathExists(resolved)) {
      args.push(a)
    } else {
      pruned = true
    }
  }

  let roots = Array.isArray(cfg.roots) ? [...cfg.roots] : undefined
  if (roots && roots.length > 0) {
    const kept = roots.filter((r) => {
      if (!r || typeof r.uri !== "string") {
        pruned = true
        return false
      }
      const resolved = resolveFilesystemAllowPathForExists(r.uri, platform, homeRaw)
      if (pathExists(resolved)) return true
      pruned = true
      return false
    })
    roots = kept
    if (kept.length === 0) roots = undefined
  }

  const hasDir = args.some(isFilesystemAllowPathArg)
  const hasRoots = Array.isArray(roots) && roots.length > 0

  if (hasDir || hasRoots) {
    // Do NOT invent cwd when paths already define the sandbox (requiresRestart thrash).
    if (!pruned) {
      return cfg
    }
    const next: McpStdioServerConfig = {
      ...cfg,
      args,
      ...(roots ? { roots } : { roots: undefined }),
    }
    if (!roots) delete (next as { roots?: unknown }).roots
    return next
  }

  // Insert home after package name when present, else append
  const pkgIdx = args.findIndex(
    (a) => a === MCP_FILESYSTEM_PACKAGE || /server-filesystem/.test(a),
  )
  if (pkgIdx >= 0) {
    args.splice(pkgIdx + 1, 0, home)
  } else if (args.length === 0) {
    args.push("-y", MCP_FILESYSTEM_PACKAGE, home)
  } else {
    args.push(home)
  }

  const next: McpStdioServerConfig = {
    ...cfg,
    args,
    cwd: cfg.cwd || home,
    roots: [{ uri: mcpHomeFileUri(platform, home), name: "home" }],
  }
  return next
}

/** Factory for a ready-to-use filesystem MCP server entry. */
export function defaultFilesystemServerConfig(
  platform: NodeJS.Platform = process.platform,
  homeRaw = os.homedir(),
): McpStdioServerConfig {
  const home = mcpHomeDir(platform, homeRaw)
  return {
    transport: "stdio",
    command: "npx",
    args: ["-y", MCP_FILESYSTEM_PACKAGE, home],
    enabled: true,
    trust_level: "trusted",
    cwd: home,
    roots: [{ uri: mcpHomeFileUri(platform, home), name: "home" }],
  }
}

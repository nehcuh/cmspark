// Default allowlist for @modelcontextprotocol/server-filesystem.
// The official server refuses to expose tools until at least one directory is
// provided via CLI args OR MCP roots. We default missing allowlists to the
// user home directory (platform-aware: Windows C:/Users/... vs macOS /Users/...).

import os from "node:os"
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

/**
 * If this is the official filesystem server and no allow directory / roots are
 * set, inject the platform home directory into args + roots + cwd.
 * Idempotent when a path or roots already exist.
 */
export function ensureFilesystemAllowlist(
  name: string,
  cfg: McpServerConfig,
  platform: NodeJS.Platform = process.platform,
  homeRaw = os.homedir(),
): McpServerConfig {
  if (cfg.transport !== "stdio") return cfg
  if (!looksLikeFilesystemServer(name, cfg)) return cfg

  const home = mcpHomeDir(platform, homeRaw)
  const args = cfg.args ? [...cfg.args] : []
  const hasDir = args.some(isFilesystemAllowPathArg)
  const hasRoots = Array.isArray(cfg.roots) && cfg.roots.length > 0

  if (hasDir || hasRoots) {
    // Still ensure cwd defaults to home when missing (harmless for already-set paths)
    if (!cfg.cwd) {
      return { ...cfg, cwd: home }
    }
    return cfg
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
    roots:
      cfg.roots && cfg.roots.length > 0
        ? cfg.roots
        : [{ uri: mcpHomeFileUri(platform, home), name: "home" }],
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

// Default allowlist for @modelcontextprotocol/server-filesystem.
// The official server refuses to expose tools until at least one directory is
// provided via CLI args OR MCP roots. We default missing allowlists to the
// user home directory (platform-aware: Windows C:/Users/... vs macOS /Users/...).
//
// Stale CLI allow-dirs are pruned and legacy empty CLI configurations default
// to home. Explicit roots remain authoritative: losing their last valid root
// fails closed, rather than broadening to CLI directories or home.

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import type { McpServerConfig, McpStdioServerConfig } from "./types.js"

import { MCP_FILESYSTEM_PACKAGE, isLocalOfficialFilesystem, filesystemDirectoryArgIndex } from "./filesystem-identity"
export { MCP_FILESYSTEM_PACKAGE } from "./filesystem-identity"

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
  return pathToFileURL(home, { windows: platform === "win32" }).href
}

/** Heuristic: arg is an allow-directory (not a flag or npm package name). */
export function isFilesystemAllowPathArg(arg: string): boolean {
  if (!arg || arg.startsWith("-")) return false
  // npm package names like @modelcontextprotocol/server-filesystem
  if (arg.startsWith("@") && !/^[a-zA-Z]:/.test(arg)) return false
  if (arg === MCP_FILESYSTEM_PACKAGE || arg.startsWith(`${MCP_FILESYSTEM_PACKAGE}@`)) return false
  if (arg.startsWith("file:")) return true
  if (/^[a-zA-Z]:[\\/]/.test(arg)) return true // Windows drive
  if (arg.startsWith("/") || arg.startsWith("~")) return true
  // Relative project paths are rare for this server but treat as path-like
  if (arg.includes("/") || arg.includes("\\")) return true
  return false
}


/** Match the home used by the configured Node filesystem subprocess. */
export function filesystemServerHome(cfg: McpServerConfig, platform: NodeJS.Platform = process.platform, fallback = os.homedir()): string {
  if (cfg.transport !== "stdio") return fallback
  const value = cfg.env?.[platform === "win32" ? "USERPROFILE" : "HOME"]
  if (typeof value !== "string") return fallback
  const api = platform === "win32" ? path.win32 : path.posix
  const cwd = cfg.cwd && defaultPathExists(cfg.cwd) ? cfg.cwd : process.cwd()
  // Node permits an empty or relative HOME; expand it relative to the same
  // effective working directory, rather than granting Companion's home.
  return api.resolve(cwd, value)
}

/** Resolve an allow-dir arg or file:// root URI to a local path for existence checks. */
export function resolveFilesystemAllowPathForExists(
  raw: string,
  platform: NodeJS.Platform = process.platform,
  homeRaw = os.homedir(),
): string {
  let p = raw.trim()
  if (p.startsWith("file:")) {
    // Invalid URIs must not turn into relative paths and accidentally pass an
    // existence check. Callers prune them rather than reinterpret their text.
    try { p = fileURLToPath(p, { windows: platform === "win32" }) }
    catch { return "" }
  }
  if (p === "~") return homeRaw
  if (p.startsWith("~/") || p.startsWith("~\\")) {
    p = (platform === "win32" ? path.win32 : path.posix).join(homeRaw, p.slice(2))
  }
  // Avoid path.resolve turning "C:/Users/x" into nonsense on POSIX; still OK for exists inject.
  if (platform === "win32") {
    return path.win32.normalize(p)
  }
  return path.posix.normalize(p)
}

export type EnsureFilesystemAllowlistOpts = {
  /**
   * Injectable existence check (directory must exist). Tests pass stubs so
   * synthetic Windows paths on Linux CI do not get pruned.
   * Default: fs.existsSync + isDirectory.
   */
  pathExists?: (absPath: string) => boolean
}

// Roots are protocol URIs, not CLI operands. Reinterpreting an empty string,
// relative path or ordinary pathname as cwd would broaden an explicit sandbox.
function resolveFilesystemRoot(raw: unknown, platform: NodeJS.Platform): string {
  if (typeof raw !== "string" || !raw.startsWith("file://")) return ""
  try { return fileURLToPath(raw, { windows: platform === "win32" }) }
  catch { return "" }
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
 * - prune missing paths while preserving an entirely invalid explicit roots list
 * - only legacy CLI configurations with no valid allowlist default to home
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
  if (!isLocalOfficialFilesystem(cfg)) return cfg

  homeRaw = filesystemServerHome(cfg, platform, homeRaw)
  const home = mcpHomeDir(platform, homeRaw)
  const pathExists = opts?.pathExists ?? defaultPathExists
  const argsIn = cfg.args ? [...cfg.args] : []
  const operandStart = filesystemDirectoryArgIndex(cfg)

  let pruned = false
  const args: string[] = []
  for (const [index, a] of argsIn.entries()) {
    if (index < operandStart) {
      args.push(a)
      continue
    }
    const rawPath = resolveFilesystemAllowPathForExists(a, platform, homeRaw)
    const api = platform === "win32" ? path.win32 : path.posix
    const resolved = rawPath && (api.isAbsolute(rawPath) ? rawPath : api.resolve(cfg.cwd && pathExists(cfg.cwd) ? cfg.cwd : process.cwd(), rawPath))
    if (resolved && pathExists(resolved)) {
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
      const resolved = resolveFilesystemRoot(r.uri, platform)
      if (resolved && pathExists(resolved)) return true
      pruned = true
      return false
    })
    roots = kept
    // Explicit roots are authoritative. Retain an invalid original list so
    // connect can fail closed; upstream otherwise falls back to CLI dirs.
    if (kept.length === 0) return cfg
  }

  const hasDir = args.length > operandStart
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

  args.push(home)

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

/** Restrict the initial CLI sandbox before the server's asynchronous roots update. */
export function filesystemStartupConfig(cfg: McpServerConfig): McpServerConfig {
  if (!isLocalOfficialFilesystem(cfg) || cfg.transport !== "stdio" || !cfg.roots?.length) return cfg
  const dirs = cfg.roots.map(root => resolveFilesystemRoot(root?.uri, process.platform)).filter(dir => dir && defaultPathExists(dir))
  if (!dirs.length) throw new Error("MCP filesystem has no valid configured roots; restore the directory or update roots")
  return { ...cfg, args: [...(cfg.args ?? []).slice(0, filesystemDirectoryArgIndex(cfg)), ...dirs] }
}

// Expand MCP filesystem allow-dirs after user L2 confirm (P2).
// Only paths under the user home directory may be added.

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
 * Directory we would add to allowlist (parent of file, or path itself if dir).
 * Must resolve under home.
 */
export function resolveAllowDirToOffer(
  candidatePath: string,
  home = os.homedir(),
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

  // Prefer existing parent for allow-dir (server requires allow roots to exist)
  let dir = abs
  try {
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
      dir = path.dirname(abs)
    } else if (!fs.existsSync(abs)) {
      // walk up until existing directory
      let cur = abs
      for (let i = 0; i < 8; i++) {
        const parent = path.dirname(cur)
        if (parent === cur) break
        if (fs.existsSync(parent) && fs.statSync(parent).isDirectory()) {
          dir = parent
          break
        }
        cur = parent
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

  const rel = path.relative(homeReal, dirReal)
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return {
      ok: false,
      error: "for safety, only directories under your home folder can be added dynamically",
    }
  }
  // Block sensitive home subtrees
  const blocked = [".ssh", ".gnupg", "Library/Keychains", "Library/Mail", ".aws", ".config/gcloud"]
  const norm = rel.replace(/\\/g, "/")
  for (const b of blocked) {
    if (norm === b || norm.startsWith(b + "/")) {
      return { ok: false, error: `refusing to allow sensitive path under ~/${b}` }
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

function looksLikeFilesystemServer(name: string, cfg: McpStdioServerConfig): boolean {
  if (name === "filesystem") return true
  const args = cfg.args ?? []
  return args.some((a) => a === MCP_FILESYSTEM_PACKAGE || /server-filesystem/.test(a))
}

/**
 * Persist new allow-dir on the named filesystem MCP server and hot-reload.
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

  const args = existing.args ? [...existing.args] : []
  const already = args.some((a) => {
    if (!isFilesystemAllowPathArg(a)) return false
    try {
      return fs.realpathSync(a) === offered.dir || path.resolve(a) === offered.dir
    } catch {
      return path.resolve(a) === offered.dir
    }
  })
  if (!already) {
    args.push(offered.dir)
  }

  const next: McpStdioServerConfig = {
    ...existing,
    args,
    roots: [
      ...((existing.roots || []).filter((r) => r && typeof r.uri === "string") as any[]),
      ...(already
        ? []
        : [{ uri: `file://${offered.dir.startsWith("/") ? "" : "/"}${offered.dir}`, name: path.basename(offered.dir) }]),
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

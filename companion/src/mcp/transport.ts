// Transport factory — wraps the MCP SDK's built-in StdioClientTransport and
// StreamableHTTPClientTransport with a unified config-driven constructor.
//
// We do NOT reimplement the wire protocol; the SDK handles JSON-RPC framing,
// initialize handshake, and resumption tokens. This module just selects the
// right transport based on McpServerConfig and configures stderr capture so
// the manager can surface subprocess diagnostics.

import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js"
import path from "node:path"
import os from "node:os"
import fs from "node:fs"
import { logger } from "../logger.js"
import { getUserEnvVars } from "../user-env.js"
import { keepOnlyDirectories, splitPathEnv } from "../process-path.js"
import type { McpServerConfig } from "./types.js"

export interface TransportExtras {
  onStderr?: (chunk: string) => void
}

/**
 * Build a PATH that lets stdio MCP servers find `npx` / `node` / `uvx` even
 * when the companion process was launched with a stripped env (launchd, Task
 * Scheduler, GUI apps, etc.).
 *
 * Node's child_process.spawn looks up binaries via `process.env.PATH`, not the
 * directory of `process.execPath`. So if companion is running under
 * `~/.nvm/versions/node/v24/bin/node` but PATH doesn't include that dir,
 * `spawn("npx", ...)` fails with ENOENT. We fix this by prepending:
 *   1. The directory of the currently-running node binary (covers nvm/fnm/volta)
 *   2. Well-known macOS/Linux locations (homebrew, /usr/local, nvm default)
 *   3. Well-known Windows locations (npm global bin, Node.js, fnm, Volta,
 *      Python Scripts for pip/uvx, Scoop, Chocolatey)
 */
export function buildSpawnPath(): string {
  const existing = process.env.PATH ?? ""
  // Drop file-in-PATH segments (spawn ENOTDIR). Keep only real directories.
  const segments = new Set<string>(keepOnlyDirectories(splitPathEnv(existing)))

  const candidates: string[] = []
  // 1. Sibling binaries of the running node (npx/npm live alongside node).
  try {
    candidates.push(path.dirname(process.execPath))
  } catch {
    // ignore
  }
  // 2. macOS homebrew (apple silicon + intel)
  candidates.push("/opt/homebrew/bin", "/opt/homebrew/sbin", "/usr/local/bin", "/usr/local/sbin")
  // 3. pip/pipx user installs and other common per-user bins
  candidates.push(path.join(os.homedir(), ".local", "bin"))
  // 4. Linux common
  candidates.push("/usr/bin", "/bin")
  // 5. Windows: npm global bin (npx.cmd location)
  candidates.push(
    path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "npm"),
  )
  // 6. Windows: Node.js default install directories
  candidates.push(
    path.join(process.env.ProgramFiles || "C:\\Program Files", "nodejs"),
    path.join(process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)", "nodejs"),
  )
  // 7. Windows: fnm (Fast Node Manager)
  {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local")
    candidates.push(path.join(localAppData, "fnm", "aliases", "default"))
  }
  // 8. Windows: Volta
  candidates.push(
    path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "Volta", "bin"),
  )
  // 9. Windows: pip/pipx Python Scripts (for uvx and pip-installed MCP servers)
  {
    const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming")
    const pyBase = path.join(appData, "Python")
    try {
      if (fs.existsSync(pyBase)) {
        const vers = fs.readdirSync(pyBase).filter(v => /^Python\d+/.test(v))
        for (const v of vers) candidates.push(path.join(pyBase, v, "Scripts"))
      }
    } catch { /* best-effort scan */ }
  }
  // 10. Windows: package managers (Scoop, Chocolatey)
  candidates.push(
    path.join(os.homedir(), "scoop", "shims"),
    path.join(process.env.ProgramData || "C:\\ProgramData", "chocolatey", "bin"),
  )
  // 11. nvm default if NVM_DIR is set
  const nvmDir = process.env.NVM_DIR ?? path.join(os.homedir(), ".nvm")
  const nvmDefault = path.join(nvmDir, "versions", "node")
  try {
    if (fs.existsSync(nvmDefault)) {
      const versions = fs
        .readdirSync(nvmDefault)
        .map((v) => path.join(nvmDefault, v, "bin"))
        .filter((p) => {
          try {
            return fs.statSync(p).isDirectory()
          } catch {
            return false
          }
        })
      candidates.push(...versions)
    }
  } catch {
    // ignore — nvm scan is best-effort
  }
  // 12. Windows: nvm-windows (%APPDATA%/nvm/<version>/)
  {
    const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming")
    const nvmWinBase = path.join(appData, "nvm")
    try {
      if (fs.existsSync(nvmWinBase)) {
        const vers = fs.readdirSync(nvmWinBase).filter((v) => /^v?\d+\./.test(v))
        for (const v of vers) candidates.push(path.join(nvmWinBase, v))
      }
    } catch {
      // best-effort scan
    }
  }

  for (const c of candidates) {
    if (c && !segments.has(c)) {
      segments.add(c)
    }
  }

  // Re-order: node-sibling dir + homebrew first, then the user's existing PATH.
  const head: string[] = []
  for (const c of candidates) {
    if (c && segments.has(c)) {
      head.push(c)
      segments.delete(c)
    }
  }
  return [...new Set([...head, ...Array.from(segments)])].join(path.delimiter)
}

/** P0 SEC-02: env keys safe to inherit into MCP stdio children (no secrets). */
const MCP_STDIO_ENV_ALLOW = new Set([
  "PATH",
  "PATHEXT",
  "HOME",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "TEMP",
  "TMP",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TERM",
  "COLORTERM",
  "SHELL",
  "USER",
  "USERNAME",
  "LOGNAME",
  "SystemRoot",
  "windir",
  "ComSpec",
  "APPDATA",
  "LOCALAPPDATA",
  "ProgramFiles",
  "ProgramFiles(x86)",
  "ProgramData",
  "NODE_ENV",
  "npm_config_cache",
  "NVM_DIR",
  "VOLTA_HOME",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
])

/** Build minimal env for MCP stdio — no full process.env / user_env dump. */
export function buildMcpStdioEnv(
  configEnv?: Record<string, string>,
): Record<string, string> {
  const env: Record<string, string> = {}
  for (const key of MCP_STDIO_ENV_ALLOW) {
    const v = process.env[key]
    if (typeof v === "string" && v.length > 0) env[key] = v
  }
  // Explicit per-server config.env only (operator-chosen secrets stay scoped)
  if (configEnv) {
    for (const [k, v] of Object.entries(configEnv)) {
      if (typeof v === "string") env[k] = v
    }
  }
  env.PATH = configEnv?.PATH || buildSpawnPath()
  return env
}

export function createTransport(config: McpServerConfig, extras?: TransportExtras): Transport {
  if (config.transport === "stdio") {
    // P0 SEC-02: minimal allowlist — do NOT spread process.env or getUserEnvVars()
    // (API keys / SSH / cloud creds must not leak into npx/uvx MCP children).
    // Per-server config.env is still applied (operator intent).
    const env = buildMcpStdioEnv(config.env as Record<string, string> | undefined)
    // getUserEnvVars retained only for allowlisted keys already in MCP_STDIO_ENV_ALLOW
    // (none are secrets by ADR-019 denylist) — skip full merge.
    void getUserEnvVars

    // spawn() fails with ENOENT if cwd points to a non-existent directory. This
    // is easy to hit when configs are copied across machines with different
    // usernames. Validate and fall back to the process cwd so the real error
    // (e.g. command not found) surfaces instead of a misleading cwd ENOENT.
    let cwd = config.cwd
    if (cwd) {
      try {
        if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
          logger.warn("mcp.transport.cwd_missing", { server: config.command, cwd })
          cwd = undefined
        }
      } catch {
        cwd = undefined
      }
    }

    const transport = new StdioClientTransport({
      command: config.command,
      args: normalizeArgsForPlatform(config.args),
      env,
      cwd,
      stderr: "pipe",
    })
    if (extras?.onStderr && transport.stderr) {
      transport.stderr.on("data", (buf: Buffer) => {
        try {
          extras.onStderr!(buf.toString("utf8"))
        } catch {
          // swallow — stderr is best-effort diagnostics
        }
      })
    }
    return transport
  }

  const url = new URL(config.url)
  const headers = config.headers ?? {}
  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: { headers: headers as Record<string, string> },
  })
  return transport
}

export function extractPid(transport: Transport): number | undefined {
  const anyT = transport as any
  if (anyT && typeof anyT.pid === "number") return anyT.pid
  return undefined
}

/**
 * Normalize path-like arguments for the current platform.
 * On Windows, converts backslashes in arguments that look like paths to
 * forward slashes so they are not misinterpreted as escape sequences by
 * spawned subprocesses (e.g. C:\Users\HuChen → C:/Users/HuChen).
 */
function normalizeArgsForPlatform(args: string[] | undefined): string[] | undefined {
  if (!args || process.platform !== "win32") return args
  return args.map((arg) => {
    // Heuristic: if the arg contains backslashes and looks like a path
    // (starts with a drive letter or a known prefix), convert to forward slashes.
    if (arg.includes("\\") && /^[a-zA-Z]:[\\/]|^[/\\]/.test(arg)) {
      return arg.replace(/\\/g, "/")
    }
    return arg
  })
}

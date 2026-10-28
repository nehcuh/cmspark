import fs from "node:fs"
import path from "node:path"

import { getAppRoot } from "../paths"
import { isLocalOfficialFilesystem, MCP_FILESYSTEM_PACKAGE } from "./filesystem-identity"
import type { McpServerConfig } from "./types"

export interface BundledFilesystemLaunchOptions {
  entryPath?: string
  execPath?: string
  exists?: (path: string) => boolean
}

export function resolveBundledFilesystemConfig<T extends McpServerConfig>(
  config: T,
  options: BundledFilesystemLaunchOptions = {},
): T {
  if (config.transport !== "stdio" || !isLocalOfficialFilesystem(config)) return config
  const command = path.win32.basename(config.command).toLowerCase()
  if (!/^npx(?:\.cmd|\.exe)?$/.test(command)) return config

  const args = config.args ?? []
  const packageIndex = args.findIndex(arg => arg === MCP_FILESYSTEM_PACKAGE)
  if (packageIndex < 0) return config

  const entryPath = options.entryPath ?? path.join(
    getAppRoot(),
    "node_modules",
    "@modelcontextprotocol",
    "server-filesystem",
    "dist",
    "index.js",
  )
  const exists = options.exists ?? fs.existsSync
  if (!exists(entryPath)) return config

  return {
    ...config,
    command: options.execPath ?? process.execPath,
    args: [entryPath, ...args.slice(packageIndex + 1)],
  }
}

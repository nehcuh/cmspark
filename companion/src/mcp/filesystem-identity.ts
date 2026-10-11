import path from "node:path"
import type { McpServerConfig } from "./types"

export const MCP_FILESYSTEM_PACKAGE = "@modelcontextprotocol/server-filesystem"

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

/** Number of launch arguments before filesystem directory operands. */
export function filesystemDirectoryArgIndex(cfg: McpServerConfig): number {
  if (cfg.transport !== "stdio" || !isLocalOfficialFilesystem(cfg)) return -1
  const command = path.win32.basename(cfg.command).toLowerCase()
  if (/^mcp-server-filesystem(?:\.cmd|\.exe)?$/.test(command)) return 0
  if (/^node(?:\.exe)?$/.test(command)) return 1
  return (cfg.args ?? []).findIndex(arg => arg === MCP_FILESYSTEM_PACKAGE || arg.startsWith(`${MCP_FILESYSTEM_PACKAGE}@`)) + 1
}

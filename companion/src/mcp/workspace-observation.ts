// #726: local observations are private associations, never server-result fields.
import path from "node:path"
import { filesystemDirectoryArgIndex, isLocalOfficialFilesystem } from "./filesystem-identity"
import type { McpServerConfig } from "./types"

export type McpWorkspaceObservation = Readonly<{ kind: "local-mcp-directory"; path: string }>
type Roots = Readonly<{ platform: NodeJS.Platform; roots: readonly Readonly<{ path: string; project: boolean }>[] }>
const observations = new WeakMap<object, { value: McpWorkspaceObservation; current: () => boolean }>()
const directoryTools = new Set(["list_directory", "list_directory_with_sizes", "directory_tree", "create_directory"])
const fileTools = new Map<string, readonly string[]>([
  ["read_file", ["path"]], ["read_text_file", ["path"]], ["read_media_file", ["path"]],
  ["write_file", ["path"]], ["edit_file", ["path"]], ["get_file_info", ["path"]], ["move_file", ["source", "destination"]],
])
function absolute(value: unknown, platform: NodeJS.Platform): string | undefined {
  if (typeof value !== "string" || !value || value.length > 4096 || value !== value.trim() || /[\p{Cc}\p{Cf}\p{Cs}\u2028\u2029]/u.test(value)) return
  const api = platform === "win32" ? path.win32 : path.posix
  if (!api.isAbsolute(value) || (platform === "win32" ? /^(?:\\\\[?.]\\|[\\/](?![\\/]))/.test(value) || /:/.test(value.slice(2)) : value.startsWith("//"))) return
  if (value.split(/[\\/]/).some(p => p === "." || p === "..")) return
  const normalized = api.normalize(value)
  return normalized.replace(/[\\/]+$/, "") || api.parse(normalized).root
}
function contains(root: string, requested: string, platform: NodeJS.Platform): boolean {
  const api = platform === "win32" ? path.win32 : path.posix
  const a = platform === "win32" ? root.toLowerCase() : root, b = platform === "win32" ? requested.toLowerCase() : requested
  return a === b || b.startsWith(a.endsWith(api.sep) ? a : a + api.sep)
}
/** Called only for the actual non-injected official stdio startup, before connect. No I/O. */
export function captureMcpWorkspaceRoots(original: McpServerConfig, effective: McpServerConfig, home: string, platform: NodeJS.Platform = process.platform): Roots | undefined {
  try {
    if (!isLocalOfficialFilesystem(original) || !isLocalOfficialFilesystem(effective) || original.transport !== "stdio" || effective.transport !== "stdio") return
    const operands = (effective.args ?? []).slice(filesystemDirectoryArgIndex(effective))
    if (!operands.length || operands.length > 16) return
    const explicit = !!original.roots?.length || (original.args ?? []).length > filesystemDirectoryArgIndex(original)
    const homePath = absolute(home, platform), api = platform === "win32" ? path.win32 : path.posix
    const homes = homePath ? [homePath] : []
    if (homePath && platform === "darwin") {
      if (/^\/private\/(tmp|var|etc)(\/|$)/.test(homePath)) homes.push(homePath.slice(8))
      else if (/^\/(tmp|var|etc)(\/|$)/.test(homePath)) homes.push("/private" + homePath)
    }
    const roots: { path: string; project: boolean }[] = []
    for (const operand of operands) {
      const root = absolute(operand, platform)
      if (!root) return
      const volume = api.parse(root).root.replace(/[\\/]+$/, "")
      const project = explicit && !!homePath && !homes.some(home => contains(root, home, platform)) && root.replace(/[\\/]+$/, "").toLowerCase() !== volume.toLowerCase()
      roots.push(Object.freeze({ path: root, project }))
    }
    return Object.freeze({ platform, roots: Object.freeze(roots) })
  } catch { return }
}
export function observeMcpDirectory(roots: Roots | undefined, tool: string, args: Record<string, unknown>): McpWorkspaceObservation | undefined {
  try {
    if (!roots) return
    const fields = directoryTools.has(tool) ? ["path"] : fileTools.get(tool)
    if (!fields || fields.length > 16) return
    const operands = fields.map(field => { const d = Object.getOwnPropertyDescriptor(args, field); return d && "value" in d ? absolute(d.value, roots.platform) : undefined })
    if (operands.some(p => p === undefined)) return
    const paths = operands as string[]
    const candidates = roots.roots.filter(root => paths.every(p => contains(root.path, p, roots.platform)))
    if (!candidates.length) return
    if (directoryTools.has(tool)) return Object.freeze({ kind: "local-mcp-directory", path: paths[0] })
    const projects = candidates.filter(root => root.project).sort((a, b) => b.path.length - a.path.length)
    const best = projects[0]
    if (!best || projects.some(root => root.path.length === best.path.length && root.path !== best.path)) return
    return Object.freeze({ kind: "local-mcp-directory", path: best.path })
  } catch { return }
}
export function associateMcpWorkspaceObservation(result: object, value: McpWorkspaceObservation | undefined, current: () => boolean): void {
  if (value) observations.set(result, { value, current })
}
export function readMcpWorkspaceObservation(result: unknown): McpWorkspaceObservation | undefined {
  if (!result || typeof result !== "object") return
  const held = observations.get(result)
  try { return held?.current() === true ? held.value : undefined } catch { return }
}
export function carryMcpWorkspaceObservation(from: object, to: object, current: () => boolean): void {
  const held = observations.get(from)
  if (held) observations.set(to, { value: held.value, current: () => held.current() && current() })
}

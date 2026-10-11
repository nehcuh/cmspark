// Map only approved root spellings, preserving descendant links for the
// official server's independent lexical and real-target sandbox checks.
import fs from "node:fs"
import path from "node:path"
import type { McpServerConfig } from "./types"
import { filesystemDirectoryArgIndex } from "./filesystem-identity"
import { resolveFilesystemAllowPathForExists, filesystemServerHome } from "./filesystem-home"
import { filesystemPathFields } from "./filesystem-short-path"

export async function normalizeFilesystemRootAliases(
  cfg: McpServerConfig, tool: string, args: Record<string, any>, signal: AbortSignal,
): Promise<Record<string, any>> {
  const fields = filesystemPathFields(tool)
  if (!fields || cfg.transport !== "stdio") return args
  const api = process.platform === "win32" ? path.win32 : path.posix
  const rootUris = cfg.roots?.filter(root => typeof root?.uri === "string" && root.uri.length > 0)
  const rawRoots = rootUris?.length ? rootUris.map(root => root.uri)
    : (cfg.args ?? []).slice(filesystemDirectoryArgIndex(cfg))
  const mappings: { lexical: string; canonical: string }[] = []
  const cwd = cfg.cwd && fs.existsSync(cfg.cwd) ? cfg.cwd : process.cwd()
  for (const raw of rawRoots) {
    signal.throwIfAborted()
    const resolved = resolveFilesystemAllowPathForExists(raw, process.platform, filesystemServerHome(cfg))
    if (!resolved) continue
    const lexical = api.resolve(cwd, resolved)
    try {
      const canonical = await fs.promises.realpath(lexical)
      signal.throwIfAborted()
      mappings.push({ lexical, canonical }, { lexical: canonical, canonical })
      if (process.platform === "darwin") {
        for (const prefix of ["/tmp", "/var", "/etc"]) {
          if (canonical === `/private${prefix}` || canonical.startsWith(`/private${prefix}/`)) {
            const alias = canonical.slice("/private".length)
            const target = await fs.promises.realpath(alias)
            signal.throwIfAborted()
            if (target === canonical) mappings.push({ lexical: alias, canonical })
          }
        }
      }
    } catch { signal.throwIfAborted() }
  }
  mappings.sort((a, b) => b.lexical.length - a.lexical.length)
  const normalize = async (input: string): Promise<string> => {
    signal.throwIfAborted()
    if (!api.isAbsolute(input) || input.startsWith("file:") ||
        (process.platform === "win32" && (/^\\\\[?.]/.test(input) || input.slice(2).includes(":")))) return input
    const value = api.normalize(input)
    for (const mapping of mappings) {
      const prefix = mapping.lexical.replace(/[\\/]$/, "")
      const requested = value.slice(0, prefix.length), suffix = value.slice(prefix.length)
      if (requested.toLowerCase() !== prefix.toLowerCase() || (suffix && !/^[\\/]/.test(suffix))) continue
      // Distinct Linux A/a directories must stay distinct. Prove equivalence
      // of this root prefix without resolving the descendant path.
      try {
        const target = await fs.promises.realpath(requested)
        signal.throwIfAborted()
        if (target !== mapping.canonical) continue
        return mapping.canonical.replace(/[\\/]$/, "") + suffix
      } catch { signal.throwIfAborted() }
    }
    return input
  }
  let next = args
  for (const field of fields) {
    const value = args[field]
    const mapped = typeof value === "string" ? await normalize(value)
      : field === "paths" && Array.isArray(value) ? await Promise.all(value.map(item => typeof item === "string" ? normalize(item) : item)) : value
    if (Array.isArray(value) && Array.isArray(mapped) ? value.some((item, i) => item !== mapped[i]) : value !== mapped) {
      if (next === args) next = { ...args }
      next[field] = mapped
    }
  }
  return next
}

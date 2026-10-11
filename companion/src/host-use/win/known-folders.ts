import * as path from "path"
import { parsePsJson, resolveWinScript, runPs, type PsRunner } from "./powershell"

export const WIN_FS_ROOT_TOKENS = ["documents", "desktop", "downloads"] as const
export type WinFsRootToken = (typeof WIN_FS_ROOT_TOKENS)[number]
export type WinFsRoot = { token: WinFsRootToken; path: string }
export type KnownFolderResolver = () => Promise<WinFsRoot[]>

/** Fixed Known Folder IDs are resolved by Windows for the current user, including
 * OneDrive and policy redirection. Fail closed: never guess an alternate root. */
export async function resolveKnownFolders(runner: PsRunner = runPs): Promise<WinFsRoot[]> {
  const result = parsePsJson<unknown>(await runner(resolveWinScript("known-folders.ps1"), []), "known-folders")
  if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("known-folders: expected object")
  return WIN_FS_ROOT_TOKENS.map((token) => {
    const value = (result as Record<string, unknown>)[token]
    if (typeof value !== "string" || value.includes("\0") || !path.win32.isAbsolute(value)
      || !(/^[a-z]:[\\/]/i.test(value) || /^\\\\[^\\]+\\[^\\]+/.test(value))) {
      throw new Error(`known-folders: invalid ${token} path`)
    }
    // Device namespaces have different path semantics and are not user folders.
    if (/^\\\\[?.]\\/.test(value)) throw new Error(`known-folders: invalid ${token} namespace`)
    const normalized = path.win32.normalize(value)
    // A redirected user folder must not silently authorize an entire volume/share.
    if (normalized === path.win32.parse(normalized).root) throw new Error(`known-folders: invalid ${token} root`)
    return { token, path: normalized }
  })
}

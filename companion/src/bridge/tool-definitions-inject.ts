// P1.0 inject helper — called from getAllToolDefinitions to ensure browser_download
// is present without re-serializing the full catalog array in a single edit.
// #au4dch also injects downloads_find; S40 injects skill_install.
import { BROWSER_DOWNLOAD_TOOL, DOWNLOADS_FIND_TOOL } from "./_browser_download_tool_snippet"
import { SKILL_INSTALL_TOOL } from "../skills/skill-install"

export function ensureBrowserDownloadTool<T extends { function: { name: string } }>(
  tools: T[],
): T[] {
  let out = tools
  if (!out.some((t) => t.function.name === "browser_download")) {
    out = [...out, BROWSER_DOWNLOAD_TOOL as unknown as T]
  }
  if (!out.some((t) => t.function.name === "downloads_find")) {
    out = [...out, DOWNLOADS_FIND_TOOL as unknown as T]
  }
  if (!out.some((t) => t.function.name === "skill_install")) {
    out = [...out, SKILL_INSTALL_TOOL as unknown as T]
  }
  return out
}

// P1.0 inject helper — called from getAllToolDefinitions to ensure browser_download
// is present without re-serializing the full catalog array in a single edit.
import { BROWSER_DOWNLOAD_TOOL } from "./_browser_download_tool_snippet"

export function ensureBrowserDownloadTool<T extends { function: { name: string } }>(
  tools: T[],
): T[] {
  if (tools.some((t) => t.function.name === "browser_download")) return tools
  return [...tools, BROWSER_DOWNLOAD_TOOL as unknown as T]
}

/**
 * Collect running tools from recent thread messages (#au4dch ST-4).
 * Live path uses role=tool messages with tool_calls[].status === "running".
 */

export type RunningToolInfo = {
  name: string
  elapsed_ms?: number
}

type ToolCallLike = {
  status?: string
  tool_name?: string
  progress_elapsed_ms?: number
}

type MessageLike = {
  tool_calls?: ToolCallLike[]
}

/**
 * Scan newest-first for running tool_calls (default last 40 messages).
 * Dedupes by name keeping the first (newest) elapsed.
 */
export function collectRunningTools(
  messages: MessageLike[] | null | undefined,
  scanLimit = 40,
): RunningToolInfo[] {
  if (!messages || messages.length === 0) return []
  const out: RunningToolInfo[] = []
  const seen = new Set<string>()
  const start = Math.max(0, messages.length - scanLimit)
  for (let i = messages.length - 1; i >= start; i--) {
    const m = messages[i]
    for (const tc of m?.tool_calls || []) {
      if (tc?.status !== "running") continue
      const name = (tc.tool_name || "tool").trim() || "tool"
      if (seen.has(name)) continue
      seen.add(name)
      const elapsed =
        typeof tc.progress_elapsed_ms === "number" && Number.isFinite(tc.progress_elapsed_ms)
          ? tc.progress_elapsed_ms
          : undefined
      out.push({ name, elapsed_ms: elapsed })
    }
  }
  return out
}

/** Chat footer / FocusBand one-line label. */
export function formatRunningToolsLabel(
  tools: RunningToolInfo[],
  maxNames = 3,
): string | null {
  if (!tools.length) return null
  const parts = tools.slice(0, maxNames).map((t) => {
    if (t.elapsed_ms != null && t.elapsed_ms >= 1000) {
      return `${t.name} ${Math.floor(t.elapsed_ms / 1000)}s`
    }
    return t.name
  })
  const more = tools.length > maxNames ? ` +${tools.length - maxNames}` : ""
  return `执行中: ${parts.join(", ")}${more}`
}

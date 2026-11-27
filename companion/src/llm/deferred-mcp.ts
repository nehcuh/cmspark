// DeepSeek's tool-search results are conversation items. Resolve their names
// against the current, permission-filtered catalog whenever history is replayed.
import type { ToolDefinition } from "../bridge/tool-definitions"
import type { CanonicalChatMessage, CanonicalToolDefinition } from "./provider"
import { modelSpec } from "./reasoning-effort"

export const SEARCH_MCP = "cmspark_search_mcp_tools"
export const mcpSearchTool: ToolDefinition = {
  type: "function", function: {
    name: SEARCH_MCP,
    description: "Find connected MCP tools by server, tool name or task keywords. Use short keywords, and try synonyms if no tools match.",
    parameters: { type: "object", properties: { query: { type: "string", description: "Server, function name or keywords" } }, required: ["query"] },
  },
}

export function supportsMcpSearch(protocol: unknown, baseUrl: unknown, model: unknown): boolean {
  return model === "deepseek-flash" && modelSpec(protocol, baseUrl, model)?.provider === "DeepSeek"
}

export function searchMcpCatalog(catalog: CanonicalToolDefinition[], query: unknown) {
  if (typeof query !== "string" || !query.trim()) return { success: false, error: "A tool search query is required" }
  const text = query.trim().slice(0, 256).toLowerCase()
  const terms = text.match(/[\p{L}\p{N}]+/gu) ?? []
  const exact = catalog.find(t => t.function.name.startsWith("mcp__") && t.function.name.toLowerCase() === text)
  if (exact) return { success: true, data: { tools: [exact.function.name] } }
  const matches = catalog.filter(t => t.function.name.startsWith("mcp__")).map(({ function: fn }) => {
    const name = fn.name.toLowerCase(), description = fn.description.toLowerCase()
    const score = terms.reduce((n, term) => n + (name.includes(term) ? 4 : description.includes(term) ? 1 : 0), 0)
    return { name: fn.name, score }
  }).filter(hit => hit.score > 0).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
  return { success: true, data: { tools: matches.filter(hit => hit.score >= matches[0].score * 0.6).slice(0, 5).map(hit => hit.name) } }
}

// The adapter wraps both live and restored tool results before passing them to
// providers. Only a paired local search result can supply references; schema and
// permissions always come from the catalog, never from the returned text.
export function loadedMcpTools(content: string, catalog: CanonicalToolDefinition[]) {
  const lines = content.split("\n")
  try {
    const result = JSON.parse(lines[0]?.startsWith("<untrusted-") ? lines.slice(1, -1).join("\n") : content)
    if (result?.success !== true || !Array.isArray(result.data?.tools)) return []
    const names = new Set(result.data.tools.slice(0, 5))
    return catalog.filter(t => t.function.name.startsWith("mcp__") && names.has(t.function.name))
  } catch { return [] }
}


/** Only schemas already present in history consume the model's context budget. */
export function activeMcpSchemas<T extends CanonicalToolDefinition>(messages: CanonicalChatMessage[], catalog: T[]): T[] {
  const ids = new Set<string>(), loaded = new Set<string>()
  for (const message of messages) {
    if (message.role === "assistant") {
      ids.clear()
      for (const call of message.tool_calls ?? []) if (call.function.name === SEARCH_MCP) ids.add(call.id)
    } else if (message.role === "tool" && ids.delete(message.tool_call_id)) {
      for (const t of loadedMcpTools(message.content, catalog)) loaded.add(t.function.name)
    }
  }
  return catalog.filter(t => !t.function.name.startsWith("mcp__") || loaded.has(t.function.name))
}

// Aggregator — projects all connected MCP clients' tools into OpenAI function-calling
// ToolDefinitions, sanitizes names into the mcp__<server>__<tool> namespace, resolves
// same-name collisions with _2/_3 suffixes, and maintains a reverse-lookup map so the
// router can recover the original (serverName, toolName) pair from a namespaced name.

import type { ToolDefinition } from "../bridge/tool-definitions.js"
import type { McpToolMeta, McpToolRoute } from "./types.js"
import type { McpClient } from "./client.js"

export interface AggregatedTools {
  definitions: ToolDefinition[]
  aliases: Map<string, McpToolRoute>   // namespacedName → { serverName, toolName }
  metas: Map<string, McpToolMeta>      // namespacedName → tool metadata
}

const EMPTY: AggregatedTools = { definitions: [], aliases: new Map(), metas: new Map() }

export function sanitizeSegment(name: string): string {
  const cleaned = String(name || "")
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .replace(/^[0-9]/, "_$&")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
  return (cleaned || "unnamed").slice(0, 60)
}

export function buildNamespacedName(serverName: string, toolName: string): string {
  return `mcp__${sanitizeSegment(serverName)}__${sanitizeSegment(toolName)}`
}

export function isMcpNamespaced(toolName: string): boolean {
  return toolName.startsWith("mcp__")
}

export function aggregateMcpTools(clients: Iterable<McpClient>): AggregatedTools {
  const definitions: ToolDefinition[] = []
  const aliases = new Map<string, McpToolRoute>()
  const metas = new Map<string, McpToolMeta>()
  const usedNames = new Set<string>()

  for (const client of clients) {
    if (client.connection.status !== "connected") continue
    if (!client.config.enabled) continue

    const serverName = client.name
    for (const tool of client.getMeta().tools) {
      const baseName = buildNamespacedName(serverName, tool.name)
      let finalName = baseName
      let n = 2
      while (usedNames.has(finalName)) {
        finalName = `${baseName}_${n}`
        n++
        if (n > 99) break
      }
      usedNames.add(finalName)

      const parameters = normalizeInputSchema(tool.inputSchema)
      definitions.push({
        type: "function",
        function: {
          name: finalName,
          description: tool.description
            ? `[${serverName}] ${tool.description}`
            : `[${serverName}] MCP tool: ${tool.name}`,
          parameters,
        },
      })
      aliases.set(finalName, { serverName, toolName: tool.name })
      metas.set(finalName, { ...tool, namespacedName: finalName })
    }
  }

  return { definitions, aliases, metas }
}

/**
 * Normalize a possibly-loose MCP inputSchema into a ToolDefinition.parameters shape.
 * MCP servers often omit `type` or `properties`; OpenAI's function-calling API expects
 * at minimum { type: "object", properties: {...}, required: [...] }.
 */
function normalizeInputSchema(schema: Record<string, any>): ToolDefinition["function"]["parameters"] {
  if (!schema || typeof schema !== "object") {
    return { type: "object", properties: {}, required: [] }
  }
  const out: ToolDefinition["function"]["parameters"] = {
    type: typeof schema.type === "string" ? schema.type : "object",
    properties: (schema.properties && typeof schema.properties === "object")
      ? schema.properties
      : {},
    required: Array.isArray(schema.required)
      ? schema.required.filter((x: any) => typeof x === "string")
      : [],
  }
  // Preserve additional OpenAI-compatible JSON Schema fields (oneOf/anyOf/$ref/additionalProperties)
  // — these are passed through to the LLM; cmspark's own ToolParameter type is narrower but
  // only used by the cached native-tool validator, which does not run against MCP tools.
  for (const key of ["additionalProperties", "oneOf", "anyOf", "allOf", "$ref", "enum", "description"]) {
    if (key in schema) (out as any)[key] = schema[key]
  }
  return out
}

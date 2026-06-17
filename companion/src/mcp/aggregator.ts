// Aggregator — projects all connected MCP clients' tools into OpenAI function-calling
// ToolDefinitions, sanitizes names into the mcp__<server>__<tool> namespace, resolves
// same-name collisions with _2/_3 suffixes, and maintains a reverse-lookup map so the
// router can recover the original (serverName, toolName) pair from a namespaced name.

import type { ToolDefinition } from "../bridge/tool-definitions.js"
import type { McpToolMeta, McpToolRoute } from "./types.js"
import type { McpClient } from "./client.js"
import { INJECTION_PATTERNS } from "../skills/content-sanitizer.js"

export interface AggregatedTools {
  definitions: ToolDefinition[]
  aliases: Map<string, McpToolRoute>   // namespacedName → { serverName, toolName }
  metas: Map<string, McpToolMeta>      // namespacedName → tool metadata
}

const EMPTY: AggregatedTools = { definitions: [], aliases: new Map(), metas: new Map() }

/**
 * Maximum length of a tool description exposed to the LLM (audit item 9).
 * 4KB is generous for any legitimate description but caps a malicious server
 * that tries to flood the LLM context with instructions hidden in metadata.
 */
const MAX_DESCRIPTION_LEN = 4 * 1024

/**
 * Audit item 9: scan tool metadata for prompt-injection phrases before exposing
 * to the LLM. Any tool whose description or argument descriptions matches an
 * injection pattern is EXCLUDED from auto-aggregation — the LLM never sees it.
 * Returns the sanitized description (capped length) OR null if flagged.
 */
function scanMetadata(tool: McpToolMeta): { description: string } | { flagged: true } {
  const fieldsToScan: string[] = []
  if (tool.description) {
    fieldsToScan.push(typeof tool.description === "string" ? tool.description : String(tool.description))
  }
  // Argument descriptions are nested inside inputSchema.properties.*.description
  const props = (tool.inputSchema as any)?.properties
  if (props && typeof props === "object") {
    for (const key of Object.keys(props)) {
      const argDesc = props[key]?.description
      if (typeof argDesc === "string") fieldsToScan.push(argDesc)
    }
  }

  for (const field of fieldsToScan) {
    for (const pattern of INJECTION_PATTERNS) {
      if (pattern.test(field)) {
        return { flagged: true }
      }
    }
  }

  // Not flagged — return capped description.
  const description = tool.description
    ? String(tool.description).slice(0, MAX_DESCRIPTION_LEN)
    : ""
  return { description }
}

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
      // Audit item 9: scan metadata for prompt-injection BEFORE exposing to LLM.
      // Flagged tools are excluded entirely — the LLM never sees them, so it
      // can't be tricked into calling them by injected instructions.
      const scan = scanMetadata(tool)
      if ("flagged" in scan) {
        // Skip — don't aggregate. The audit recommends quarantining these tools
        // and requiring explicit user opt-in via UI; for now, simplest correct
        // behavior is to drop them from the LLM-visible tool list.
        continue
      }

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
      const descriptionPrefix = `[${serverName}] `
      const descriptionBody = scan.description || `MCP tool: ${tool.name}`
      // Cap the COMBINED length so the prefix doesn't push total past MAX.
      const maxBody = Math.max(0, MAX_DESCRIPTION_LEN - descriptionPrefix.length)
      definitions.push({
        type: "function",
        function: {
          name: finalName,
          description: descriptionPrefix + descriptionBody.slice(0, maxBody),
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

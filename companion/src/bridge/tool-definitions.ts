// Tool definitions in OpenAI function-calling format

import { logger } from "../logger"
import { ensureBrowserDownloadTool } from "./tool-definitions-inject"
import catalogJson from "./tool-definitions-catalog.json"

// Type definitions for tool schema
interface ToolParameter {
  type: string
  description?: string
  enum?: string[]
  items?: ToolParameter
  properties?: Record<string, ToolParameter>
  required?: string[]
}

/** Type guard for ToolParameter */
function isValidToolParameter(param: unknown): param is ToolParameter {
  if (typeof param !== "object" || param === null) return false
  const p = param as ToolParameter
  if (typeof p.type !== "string") return false
  if (p.description !== undefined && typeof p.description !== "string") return false
  if (p.enum !== undefined && !Array.isArray(p.enum)) return false
  if (p.properties !== undefined && typeof p.properties !== "object") return false
  if (p.required !== undefined && !Array.isArray(p.required)) return false
  return true
}

interface ToolFunction {
  name: string
  description: string
  parameters: {
    type: string
    properties: Record<string, ToolParameter>
    required: string[]
  }
}

export interface ToolDefinition {
  type: "function"
  function: ToolFunction
}

/** Validate a tool definition structure with comprehensive checks */
function isValidToolDefinition(tool: unknown): tool is ToolDefinition {
  if (typeof tool !== "object" || tool === null) return false
  const t = tool as ToolDefinition

  if (
    t.type !== "function" ||
    typeof t.function !== "object" ||
    t.function === null ||
    typeof t.function.name !== "string" ||
    typeof t.function.description !== "string"
  ) {
    return false
  }

  if (!t.function.description?.trim()) {
    return false
  }

  const params = t.function.parameters
  if (typeof params !== "object" || params === null) return false
  if (params.type !== "object") return false

  if (params.properties !== undefined && typeof params.properties !== "object") {
    return false
  }

  if (params.properties) {
    for (const propValue of Object.values(params.properties)) {
      if (!isValidToolParameter(propValue)) {
        return false
      }
    }
  }

  if (params.required !== undefined) {
    if (!Array.isArray(params.required)) return false
    if (params.required.some((r) => typeof r !== "string")) return false
  }

  return true
}

/** macOS-only error string — must keep "macos-only" for classifyError recoverability. */
export const OSASCRIPT_MACOS_ONLY_ERROR =
  "osascript_eval is macOS-only. Use get_page_text with tabId instead (cross-platform)."

/** Whether osascript_eval is exposed to the LLM (tool schema) on this platform. */
export function shouldExposeOsascript(platform: NodeJS.Platform = process.platform): boolean {
  return platform === "darwin"
}

/** Whether osascript_eval enters the L2 confirmation gate (darwin only). */
export function shouldL2GateOsascript(platform: NodeJS.Platform = process.platform): boolean {
  return platform === "darwin"
}

/**
 * Full native tool catalog (all platforms). Used by pack validation, getToolDefinition,
 * and any caller that needs the global name set — not the LLM-visible filtered set.
 * P1.0: browser_download injected via ensureBrowserDownloadTool.
 */
export function getAllToolDefinitions(): ToolDefinition[] {
  if (!cachedAllToolDefinitions) {
    cachedAllToolDefinitions = ensureBrowserDownloadTool(buildAllToolDefinitions())
  }
  return cachedAllToolDefinitions
}

/**
 * LLM-visible tools for the given platform (default: process.platform).
 * On non-darwin, `osascript_eval` is omitted so models cannot call a dead tool.
 */
export function getToolDefinitions(platform: NodeJS.Platform = process.platform): ToolDefinition[] {
  const all = getAllToolDefinitions()
  if (shouldExposeOsascript(platform)) return all
  return all.filter((t) => t.function.name !== "osascript_eval")
}

function buildAllToolDefinitions(): ToolDefinition[] {
  // JSON import widens optional property unions; validate at runtime via isValidToolDefinition.
  const tools = catalogJson as unknown as ToolDefinition[]
  const invalidTools = tools.filter((t) => !isValidToolDefinition(t))
  if (invalidTools.length > 0) {
    const names = invalidTools.map((t) => (t as ToolDefinition)?.function?.name || "unknown").join(", ")
    throw new Error(`Invalid tool definitions: ${names}`)
  }
  logger.info("tools_loaded", { count: tools.length }, "bridge")
  return tools
}

/** Build MCP meta tools (resources/prompts access) only when at least one connected
 *  server advertises the corresponding capability.
 */
export function getMcpMetaToolDefinitions(capabilities: {
  resources: boolean
  prompts: boolean
}): ToolDefinition[] {
  const tools: ToolDefinition[] = []
  if (capabilities.resources) {
    tools.push({
      type: "function",
      function: {
        name: "mcp_list_resources",
        description:
          "List resources exposed by an MCP server. Returns URIs that can be passed to mcp_read_resource. Only servers that advertise the resources capability support this; tools-only servers expose file access via their own namespaced tools instead.",
        parameters: {
          type: "object",
          properties: {
            server: { type: "string", description: "MCP server name (as shown in MCP panel)" },
          },
          required: ["server"],
        },
      },
    })
    tools.push({
      type: "function",
      function: {
        name: "mcp_read_resource",
        description:
          "Read the contents of a specific MCP resource by URI. Use mcp_list_resources first to discover available URIs. Only servers that advertise the resources capability support this.",
        parameters: {
          type: "object",
          properties: {
            server: { type: "string", description: "MCP server name" },
            uri: { type: "string", description: "Resource URI (returned by mcp_list_resources)" },
          },
          required: ["server", "uri"],
        },
      },
    })
  }
  if (capabilities.prompts) {
    tools.push({
      type: "function",
      function: {
        name: "mcp_get_prompt",
        description:
          "Fetch a prompt template from an MCP server with arguments filled in. Returns ready-to-use messages. Useful for canned workflows like code-review, summarize, explain-error that the server provides.",
        parameters: {
          type: "object",
          properties: {
            server: { type: "string", description: "MCP server name" },
            name: { type: "string", description: "Prompt name" },
            arguments: {
              type: "object",
              description: "Prompt arguments (server-specific; consult server docs)",
              properties: {},
            },
          },
          required: ["server", "name"],
        },
      },
    })
  }
  return tools
}

let cachedAllToolDefinitions: ToolDefinition[] | null = null

/** Error thrown when tool definitions fail to load */
export class ToolDefinitionError extends Error {
  constructor(message: string, public readonly toolName?: string) {
    super(message)
    this.name = "ToolDefinitionError"
  }
}

/** Get a tool definition by name (full catalog — includes macOS-only tools). */
export function getToolDefinition(name: string): ToolDefinition {
  try {
    const tool = getAllToolDefinitions().find((t) => t.function.name === name)
    if (!tool) {
      throw new ToolDefinitionError(`Tool '${name}' not found`, name)
    }
    return tool
  } catch (error) {
    if (error instanceof ToolDefinitionError) {
      throw error
    }
    const message = error instanceof Error ? error.message : String(error)
    logger.warn("tool_fetch_failed", { name, error: message }, "bridge")
    throw new ToolDefinitionError(`Failed to fetch tool '${name}': ${message}`, name)
  }
}

/** Check if a tool exists */
export function hasTool(name: string): boolean {
  try {
    getToolDefinition(name)
    return true
  } catch (error) {
    if (error instanceof ToolDefinitionError) {
      return false
    }
    const message = error instanceof Error ? error.message : String(error)
    logger.error("tool_check_failed", { name, error: message }, "bridge")
    return false
  }
}

/**
 * Validate tool call arguments against the tool definition schema.
 * Returns validated args or throws ToolDefinitionError with details.
 */
export function validateToolCallArguments(
  toolName: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  const tool = getToolDefinition(toolName)
  const params = tool.function.parameters
  const result: Record<string, unknown> = { ...args }

  if (Array.isArray(params.required)) {
    const missing = params.required.filter((key) => !(key in args))
    if (missing.length > 0) {
      throw new ToolDefinitionError(
        `Missing required parameters for '${toolName}': ${missing.join(", ")}`,
        toolName,
      )
    }
  }

  if (params.properties) {
    for (const [key, value] of Object.entries(args)) {
      const paramSchema = params.properties[key]
      if (!paramSchema) {
        logger.warn("unknown_tool_param", { toolName, param: key }, "bridge")
        continue
      }

      if (value === null) {
        if (Array.isArray(params.required) && params.required.includes(key)) {
          throw new ToolDefinitionError(
            `Parameter '${key}' for '${toolName}' is required and cannot be null`,
            toolName,
          )
        }
        continue
      }

      switch (paramSchema.type) {
        case "string":
          if (typeof value !== "string") {
            throw new ToolDefinitionError(
              `Parameter '${key}' for '${toolName}' must be string, got ${typeof value}`,
              toolName,
            )
          }
          break
        case "number":
          if (typeof value !== "number") {
            throw new ToolDefinitionError(
              `Parameter '${key}' for '${toolName}' must be number, got ${typeof value}`,
              toolName,
            )
          }
          break
        case "boolean":
          if (typeof value !== "boolean") {
            throw new ToolDefinitionError(
              `Parameter '${key}' for '${toolName}' must be boolean, got ${typeof value}`,
              toolName,
            )
          }
          break
        case "array":
          if (!Array.isArray(value)) {
            throw new ToolDefinitionError(
              `Parameter '${key}' for '${toolName}' must be array, got ${typeof value}`,
              toolName,
            )
          }
          break
        case "object":
          if (typeof value !== "object" || value === null || Array.isArray(value)) {
            throw new ToolDefinitionError(
              `Parameter '${key}' for '${toolName}' must be object, got ${typeof value}`,
              toolName,
            )
          }
          break
      }

      if (paramSchema.enum && typeof value === "string") {
        if (!paramSchema.enum.includes(value)) {
          throw new ToolDefinitionError(
            `Parameter '${key}' for '${toolName}' must be one of: ${paramSchema.enum.join(", ")}, got '${value}'`,
            toolName,
          )
        }
      }
    }
  }

  return result
}

// Per-tool zod argument-validation schemas (audit item 4 + C-MCP-1).
//
// LLM-produced tool args cross the runtime boundary untyped — adapter.ts does
// JSON.parse and forwards the result directly to executeTool. A hallucinated
// shape (tabId as string, url as number, fields as object) used to be passed
// straight into ws.send('tool.execute', params) and into executeCompanionTool
// / executeMcpTool / osascript subprocess. Worst cases:
//   - osascript_eval receives a non-string `expression` and `String(...)` coercion
//     hides the bug
//   - MCP args with the wrong shape forwarded verbatim to external processes
//   - set_cookie with malformed domain slips past the trusted-domain gate
//
// This module defines zod schemas for the high-risk native tools. adapter.ts calls
// parseToolArgs() after JSON.parse; failures route to the same recovery path
// as JSON.parse errors (LLM self-correction via tool_result error message).
//
// C-MCP-1: namespaced `mcp__<server>__<tool>` names no longer fall through to
// the generic any-record fallback. The aggregated MCP inputSchema (captured in
// mcp/aggregator.ts) is converted to zod and enforced. When the schema is
// missing (server hasn't sent tools yet, transient gap), we fall back to
// z.record(z.unknown()) AND log a warning so the gap is observable.
//
// Per audit Gate 2: use zod (already in package.json, was previously dead
// weight). Per-tool schema; generic fallback (z.record(z.unknown())) only for
// native tools not in the high-risk set OR MCP tools with no cached schema.

import { z } from "zod"
import { isMcpNamespaced } from "../mcp/aggregator.js"
import { logger } from "../logger.js"

// Schema lookup is lazy to avoid an import-time cycle: the manager singleton
// is only available after the MCP module initializes. Tests inject a stub via
// setMcpSchemaResolverForTests().
type McpSchemaResolver = (namespacedName: string) => Record<string, any> | undefined
let resolveMcpSchema: McpSchemaResolver | null = null

/**
 * Test-only injection point. Allows the tool-schemas unit tests to provide a
 * stub schema source without standing up a real McpManager. In production the
 * resolver is bound lazily on first MCP-namespaced call below.
 */
export function setMcpSchemaResolverForTests(resolver: McpSchemaResolver | null): void {
  resolveMcpSchema = resolver
}

function lookupMcpSchema(namespacedName: string): Record<string, any> | undefined {
  if (resolveMcpSchema) return resolveMcpSchema(namespacedName)
  // Lazy require to avoid pulling the full MCP stack into every caller.
  try {
    const { getMcpManager } = require("../mcp/index.js") as typeof import("../mcp/index.js")
    resolveMcpSchema = (name: string) => getMcpManager().getToolInputSchema(name)
    return resolveMcpSchema(namespacedName)
  } catch {
    return undefined
  }
}

const urlSchema = z.string().min(1).refine(
  (s) => {
    try { new URL(s); return true } catch { return false }
  },
  { message: "must be a valid URL" },
)

const tabIdSchema = z.number().int().positive()

export const TOOL_ARG_SCHEMAS: Record<string, z.ZodTypeAny> = {
  // --- Page evaluation (high-risk: arbitrary JS in a real Chrome tab) ---
  evaluate: z.object({
    tabId: tabIdSchema,
    code: z.string().min(1),
    await_promise: z.boolean().optional(),
    security_token: z.string().optional(),
  }),

  // --- macOS osascript (high-risk: arbitrary AppleScript on the host) ---
  osascript_eval: z.object({
    expression: z.string().min(1),
    security_token: z.string().optional(),
  }),

  // --- macOS host_read (Phase 0 computer-use: read Mail inbox top-1) ---
  host_read: z.object({
    application: z.string().optional(),
    max_chars: z.number().int().min(1).max(5000).optional(),
    security_token: z.string().optional(),
  }),

  // --- macOS host_write (Phase 1 W6: Notes create + Finder move) ---
  host_write: z.object({
    kind: z.enum(["create", "move", "update", "delete"]),
    target_id: z.string().optional(),
    body: z.string().optional(),
    destination: z.string().optional(),
    source_path: z.string().optional(),
    security_token: z.string().optional(),
  }),

  // --- Navigation (high-risk: agent can drive browser to any URL) ---
  navigate: z.object({
    tabId: tabIdSchema,
    url: urlSchema,
  }),
  create_tab: z.object({
    url: urlSchema,
    active: z.boolean().optional(),
    index: z.number().int().min(0).optional(),
  }),
  set_tab_url: z.object({
    tabId: tabIdSchema,
    url: urlSchema,
  }),

  // --- Cookies (high-risk: trusted-domain gate depends on `domain` shape) ---
  set_cookie: z.object({
    domain: z.string().min(1),
    name: z.string().min(1),
    value: z.string(),
    path: z.string().optional(),
    secure: z.boolean().optional(),
    httpOnly: z.boolean().optional(),
    url: urlSchema.optional(),
  }),
  get_cookies: z.object({
    domain: z.string().min(1),
  }),
  delete_cookie: z.object({
    domain: z.string().min(1),
    name: z.string().min(1),
    url: urlSchema.optional(),
  }),
  list_all_cookies: z.object({}).passthrough(),
}

/** Generic fallback: accept any record shape, no constraints. */
const GENERIC_FALLBACK = z.record(z.unknown())

// ---------------------------------------------------------------------------
// JSON Schema → zod converter (C-MCP-1).
//
// Hand-rolled to avoid pulling `ajv` or `json-schema-to-zod`. Only handles
// the subset MCP servers typically declare:
//   - type: object (top-level) with properties + required
//   - primitive property types: string | number | integer | boolean
//   - arrays (items: { type: ... })
//   - additionalProperties (boolean only; objects/schemas ignored → passthrough)
// Anything unrecognized degrades to z.unknown() — fail-open on the unknown
// field rather than blocking legitimate MCP calls. Required-ness still gates
// at the object level.
// ---------------------------------------------------------------------------

function jsonSchemaPrimitiveToZod(node: any): z.ZodTypeAny {
  if (!node || typeof node !== "object") return z.unknown()
  const t = typeof node.type === "string" ? node.type : (Array.isArray(node.type) ? node.type[0] : null)

  switch (t) {
    case "string":
      return z.string()
    case "number":
      return z.number()
    case "integer":
      return z.number().int()
    case "boolean":
      return z.boolean()
    case "array": {
      const item = node.items ? jsonSchemaPrimitiveToZod(node.items) : z.unknown()
      return z.array(item)
    }
    case "object": {
      return jsonSchemaObjectToZod(node)
    }
    case "null":
      return z.null()
    default:
      // Unknown / unsupported type (e.g. oneOf/anyOf/$ref). Degrade to unknown
      // so we don't block legitimate MCP traffic; the caller is responsible for
      // the actual subprocess call.
      return z.unknown()
  }
}

function jsonSchemaObjectToZod(node: any): z.ZodTypeAny {
  if (!node || typeof node !== "object") return z.record(z.unknown())

  const props = (node.properties && typeof node.properties === "object") ? node.properties : null
  const requiredList: string[] = Array.isArray(node.required)
    ? node.required.filter((x: any) => typeof x === "string")
    : []
  const requiredSet = new Set(requiredList)

  if (!props || Object.keys(props).length === 0) {
    // No declared properties — accept any record. Many MCP tools legitimately
    // have empty schemas (no args).
    return z.record(z.unknown())
  }

  const shape: Record<string, z.ZodTypeAny> = {}
  for (const [key, raw] of Object.entries(props)) {
    const fieldSchema = jsonSchemaPrimitiveToZod(raw)
    shape[key] = requiredSet.has(key) ? fieldSchema : fieldSchema.optional()
  }

  // additionalProperties: false → strict; otherwise (true/undefined/object)
  // passthrough extra keys — MCP servers often accept arbitrary kwargs.
  const additional = node.additionalProperties
  const base = z.object(shape)
  if (additional === false) return base.strict()
  return base.passthrough()
}

/**
 * Convert an MCP inputSchema (JSON Schema) into a zod schema. Top-level
 * non-object schemas or malformed nodes fall back to GENERIC_FALLBACK.
 */
function mcpInputSchemaToZod(schema: Record<string, any> | undefined): z.ZodTypeAny {
  if (!schema || typeof schema !== "object") return GENERIC_FALLBACK
  const t = typeof schema.type === "string" ? schema.type : "object"
  if (t !== "object") {
    // MCP inputSchema is conventionally an object; anything else is unusual.
    // Degrade to GENERIC_FALLBACK to avoid blocking.
    return GENERIC_FALLBACK
  }
  return jsonSchemaObjectToZod(schema)
}

function schemaForTool(toolName: string): z.ZodTypeAny {
  if (isMcpNamespaced(toolName)) {
    const inputSchema = lookupMcpSchema(toolName)
    if (inputSchema) {
      return mcpInputSchemaToZod(inputSchema)
    }
    // Schema not cached yet — server may not have sent tools/list, or the
    // tool was excluded by audit item 9's injection scan. Fall back but make
    // the gap observable so we can detect the silent-acceptance regression.
    logger.warn("tool_schemas.mcp_schema_missing", {
      tool_name: toolName,
      fallback: "z.record(z.unknown())",
    })
    return GENERIC_FALLBACK
  }
  return TOOL_ARG_SCHEMAS[toolName] ?? GENERIC_FALLBACK
}

/**
 * Validate tool-call arguments against the per-tool zod schema (or the generic
 * fallback for tools not in the high-risk set). Returns the parsed args on
 * success; throws a ZodError-shaped Error on failure so the caller can route
 * to the existing recovery path.
 */
export function parseToolArgs(toolName: string, raw: unknown): Record<string, any> {
  const schema = schemaForTool(toolName)
  return schema.parse(raw) as Record<string, any>
}

/**
 * Non-throwing variant for callers that want a Result-style return.
 * Returns { ok: true, args } on success, { ok: false, error } on validation
 * failure.
 */
export function tryParseToolArgs(
  toolName: string,
  raw: unknown,
): { ok: true; args: Record<string, any> } | { ok: false; error: string } {
  const schema = schemaForTool(toolName)
  const result = schema.safeParse(raw)
  if (result.success) {
    return { ok: true, args: result.data as Record<string, any> }
  }
  // Flatten zod's nested issue tree into a single readable string. The LLM
  // will see this in the tool_result error and can self-correct.
  const formatted = result.error.issues
    .map((i: any) => {
      const path = i.path.length > 0 ? i.path.join(".") : "(root)"
      return `${path}: ${i.message}`
    })
    .join("; ")
  return { ok: false, error: `Invalid arguments for ${toolName}: ${formatted}` }
}

// Exported for unit tests so they can exercise the converter directly without
// going through the manager lookup.
export const __test__ = { mcpInputSchemaToZod, jsonSchemaPrimitiveToZod }

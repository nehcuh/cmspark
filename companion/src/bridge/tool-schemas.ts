// Per-tool zod argument-validation schemas (audit item 4).
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
// This module defines zod schemas for the high-risk tools. adapter.ts calls
// parseToolArgs() after JSON.parse; failures route to the same recovery path
// as JSON.parse errors (LLM self-correction via tool_result error message).
//
// Per audit Gate 2: use zod (already in package.json, was previously dead
// weight). Per-tool schema; generic fallback (z.record(z.unknown())) for
// tools not in the high-risk set.

import { z } from "zod"

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

/**
 * Validate tool-call arguments against the per-tool zod schema (or the generic
 * fallback for tools not in the high-risk set). Returns the parsed args on
 * success; throws a ZodError-shaped Error on failure so the caller can route
 * to the existing recovery path.
 */
export function parseToolArgs(toolName: string, raw: unknown): Record<string, any> {
  const schema = TOOL_ARG_SCHEMAS[toolName] ?? GENERIC_FALLBACK
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
  const schema = TOOL_ARG_SCHEMAS[toolName] ?? GENERIC_FALLBACK
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

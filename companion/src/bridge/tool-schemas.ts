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

  click: z.object({
    tabId: tabIdSchema,
    selector: z.string().min(1).optional(),
    text: z.string().min(1).optional(),
    exact: z.boolean().optional(),
  }).refine((v) => !!(v.selector || v.text), { message: "click requires text or selector" }),
  dblclick: z.object({
    tabId: tabIdSchema,
    selector: z.string().min(1).optional(),
    text: z.string().min(1).optional(),
    exact: z.boolean().optional(),
  }).refine((v) => !!(v.selector || v.text), { message: "dblclick requires text or selector" }),
  type: z.object({
    tabId: tabIdSchema,
    value: z.string(),
    selector: z.string().min(1).optional(),
    text: z.string().min(1).optional(),
    exact: z.boolean().optional(),
  }),
  fill_form: z.object({
    tabId: tabIdSchema,
    fields: z.array(z.object({
      selector: z.string().min(1).optional(),
      text: z.string().min(1).optional(),
      value: z.string(),
      clear_first: z.boolean().optional(),
    }).refine((f) => !!(f.selector || f.text), { message: "each field needs selector or text" })),
  }),
  hover: z.object({
    tabId: tabIdSchema,
    selector: z.string().min(1).optional(),
    text: z.string().min(1).optional(),
    exact: z.boolean().optional(),
  }).refine((v) => !!(v.selector || v.text), { message: "hover requires text or selector" }),
  get_element_info: z.object({
    tabId: tabIdSchema,
    selector: z.string().min(1).optional(),
    text: z.string().min(1).optional(),
    exact: z.boolean().optional(),
  }).refine((v) => !!(v.selector || v.text), { message: "get_element_info requires text or selector" }),
  select_option: z.object({
    tabId: tabIdSchema,
    value: z.string(),
    selector: z.string().min(1).optional(),
    text: z.string().min(1).optional(),
  }).refine((v) => !!(v.selector || v.text), { message: "select_option requires text or selector" }),
  drag_and_drop: z.object({
    tabId: tabIdSchema,
    from_selector: z.string().min(1).optional(),
    from_text: z.string().min(1).optional(),
    to_selector: z.string().min(1).optional(),
    to_text: z.string().min(1).optional(),
    exact: z.boolean().optional(),
  }).refine((v) => !!(v.from_selector || v.from_text) && !!(v.to_selector || v.to_text), {
    message: "drag_and_drop needs from_text/from_selector and to_text/to_selector",
  }),
  press_key: z.object({
    tabId: tabIdSchema,
    key: z.string().min(1),
    code: z.string().optional(),
    ctrlKey: z.boolean().optional(),
    metaKey: z.boolean().optional(),
    altKey: z.boolean().optional(),
    shiftKey: z.boolean().optional(),
    modifiers: z.number().int().optional(),
  }),

  // TabId-only is valid (thread 1snvlv). Do NOT refine selector|network_idle —
  // companion + extension default missing condition to network_idle.
  wait_for: z.object({
    tabId: tabIdSchema,
    selector: z.string().min(1).optional(),
    state: z.enum(["visible", "hidden"]).optional(),
    timeout: z.number().positive().optional(),
    network_idle: z.boolean().optional(),
    settle_ms: z.number().nonnegative().optional(),
    interval: z.number().positive().optional(),
  }),

  // --- browser_download (P1.0: click/text → chrome.downloads complete) ---
  // At least one of selector|text required (refine). downloadPath optional; companion
  // re-validates with assertDownloadPathAllowed (LLM path never trusted raw).
  browser_download: z
    .object({
      tabId: tabIdSchema,
      selector: z.string().min(1).optional(),
      text: z.string().min(1).optional(),
      exact: z.boolean().optional(),
      downloadPath: z.string().min(1).optional(),
      filenameHint: z.string().min(1).optional(),
      urlContains: z.string().min(1).optional(),
      /** When true (default), reuse complete chrome.downloads match before clicking. */
      prefer_existing: z.boolean().optional(),
      force_redownload: z.boolean().optional(),
      timeoutMs: z.number().int().min(1000).max(120000).optional(),
    })
    .refine(
      (v) => {
        if (v.selector || v.text) return true
        const force = v.force_redownload === true
        const prefer = v.prefer_existing !== false && !force
        return prefer && !!(v.filenameHint || v.urlContains)
      },
      {
        message:
          "browser_download requires selector and/or text (or prefer_existing with filenameHint/urlContains)",
      },
    ),

  // #au4dch DL-1: read-only existing downloads lookup
  downloads_find: z
    .object({
      filenameHint: z.string().min(1).optional(),
      urlContains: z.string().min(1).optional(),
      limit: z.number().int().min(1).max(20).optional(),
    })
    .refine((v) => !!(v.filenameHint || v.urlContains), {
      message: "downloads_find requires filenameHint and/or urlContains",
    }),

  // --- DevSec / Shell / NetSec (Mission Pack enterprise modules) ---
  workspace_list_dir: z.object({
    path: z.string().optional(),
  }),
  workspace_read_file: z.object({
    path: z.string().min(1),
  }),
  ensure_project_dir: z.object({
    name: z.string().min(1).max(120),
    prefer: z.enum(["auto", "workspace", "home"]).optional(),
  }),
  shell_exec: z.object({
    command: z.string().min(1).max(8000),
    cwd: z.string().optional(),
    /** Wall-clock ms; clamped 1s–300s (default 60s). Kill process tree on expiry. */
    timeoutMs: z.number().int().min(1000).max(300000).optional(),
    security_token: z.string().optional(),
  }),
  netsec_port_scan: z.object({
    targets: z.array(z.string().min(1)).min(1).max(16),
    ports: z.array(z.number().int().min(1).max(65535)).max(32).optional(),
    security_token: z.string().optional(),
  }),

  // --- macOS osascript (high-risk: JS in a Chrome tab via AppleScript) ---
  // Expression is required. url is preferred but optional at the schema boundary:
  // the LLM frequently omits it (history: l74du8 / t9rh1o — only {expression}).
  // Adapter injects pinned tabId after parse; executeCompanionTool then resolves
  // tabId → URL via tabUrlCache. Rejecting missing url here would race that
  // injection and reintroduce chat-killing failures when god-mode auto-approves.
  // Also map evaluate-style `code` → `expression`.
  osascript_eval: z.preprocess(
    (raw) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw
      const o = { ...(raw as Record<string, unknown>) }
      if ((o.expression == null || o.expression === "") && typeof o.code === "string") {
        o.expression = o.code
      }
      return o
    },
    z.object({
      url: z.string().min(1).optional(),
      expression: z.string().min(1),
      code: z.string().optional(),
      tabId: tabIdSchema.optional(),
      security_token: z.string().optional(),
    }),
  ),

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

  // --- Windows host_app (App tab WP3: L0 no-arg launch of whitelisted apps) ---
  host_app: z.object({
    app: z.string().min(1),
    action: z.enum(["launch"]),
    security_token: z.string().optional(),
  }),

  // Apps Phase-2 structured CLI (no free-args; fixed positionals from manifest)
  host_cli: z.object({
    app: z.string().min(1),
    subcommand: z.string().min(1),
    flags: z.record(z.union([z.string(), z.boolean()])).optional(),
    args: z.array(z.string()).max(16).optional(),
    security_token: z.string().optional(),
  }),

  // --- Windows host_computer (coordinate computer-use WP1+WP2, critical-class) ---
  host_computer: z.object({
    // Y1 (WP4 代码级对抗裁决):task 封顶 4000——full_preview 尺寸与 re-L2
    // 信息饥饿面由此有界(此前仅受 LLM 输出极限约束,出向 WS 无门)。
    task: z.string().min(1).max(4000),
    app: z.string().min(1),
    actions: z.array(
      z.discriminatedUnion("action", [
        z.object({
          action: z.enum(["click", "double_click", "right_click"]),
          x: z.number().int().min(0).optional(),
          y: z.number().int().min(0).optional(),
          // Y1:锚文本一并封顶(UI 标签量级;同时收窄逐条枚举全文尺寸)。
          target: z.string().min(1).max(500).optional(),
        }).strict(),
        z.object({ action: z.literal("type"), text: z.string().min(1).max(2000) }).strict(),
        // WP2: named-key whitelist chords (no arbitrary VK; text goes via type).
        z.object({
          action: z.literal("key"),
          keys: z.array(z.enum([
            // Modifiers: win/cmd/meta/command all mean ⌘ on macOS (host maps to cmd).
            "ctrl", "alt", "shift", "win", "cmd", "meta", "command",
            "enter", "escape", "tab", "space", "backspace", "delete",
            "up", "down", "left", "right", "home", "end", "pageup", "pagedown",
            "f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8", "f9", "f10", "f11", "f12",
          ])).min(1).max(4),
        }).strict(),
        // WP2: wheel scroll at a client point (delta in wheel units).
        z.object({
          action: z.literal("scroll"),
          x: z.number().int().min(0),
          y: z.number().int().min(0),
          delta: z.number().int().min(-1200).max(1200).refine((d) => d !== 0, "delta must be non-zero"),
        }).strict(),
        // WP2: left-button drag between two client points.
        z.object({
          action: z.literal("drag"),
          x: z.number().int().min(0),
          y: z.number().int().min(0),
          x2: z.number().int().min(0),
          y2: z.number().int().min(0),
        }).strict(),
        z.object({ action: z.literal("wait"), ms: z.number().int().min(0).max(5000) }).strict(),
        z.object({ action: z.literal("screenshot") }).strict(),
        z.object({ action: z.literal("describe") }).strict(),
      ]),
    ).min(1).max(50),
    budget: z.number().int().min(1).max(30).optional(),
    security_token: z.string().optional(),
  }).strict(),

  // --- Navigation (high-risk: agent can drive browser to any URL) ---
  navigate: z.object({
    tabId: tabIdSchema,
    url: urlSchema,
  }),
  create_tab: z.object({
    url: urlSchema,
    active: z.boolean().optional(),
    index: z.number().int().min(0).optional(),
    wait_for_load: z.boolean().optional(),
  }),
  set_tab_url: z.object({
    tabId: tabIdSchema,
    url: urlSchema,
  }),

  // --- Cookies: aligned with catalog + browser-bridge (url+name for set/delete; domain for get) ---
  set_cookie: z.object({
    url: urlSchema,
    name: z.string().min(1),
    value: z.string(),
    domain: z.string().min(1).optional(),
    path: z.string().optional(),
    secure: z.boolean().optional(),
    httpOnly: z.boolean().optional(),
    expirationDate: z.number().optional(),
  }),
  get_cookies: z.object({
    domain: z.string().min(1),
  }),
  delete_cookie: z.object({
    url: urlSchema,
    name: z.string().min(1),
    domain: z.string().min(1).optional(),
  }),
  list_all_cookies: z.object({}).passthrough(),

  // #265 live plan — items only; .strict() so surface/done cannot ride
  run_progress_propose: z.object({
    items: z.array(z.object({
      text: z.string(),
      tool: z.string().optional(),
    })).min(1).max(8),
  }).strict(),

  // #328 execution contract shadow — registration only, never an execution
  // permit. .strict() so no extra predicate can ride (HTTP/DOM 谓词 v0 禁用).
  execution_contract_propose: z.object({
    tool: z.string().min(1).max(80),
    args_digest: z.string().max(128).optional(),
    expect: z.object({
      exit: z.number().int().min(-1).max(255).optional(),
      writes_prefix: z.array(z.string().min(1).max(512)).max(8).optional(),
      net: z.boolean().optional(),
      hwnd_stable: z.boolean().optional(),
    }).strict(),
  }).strict(),
}

/** Generic fallback: accept any record shape, no constraints. */
const GENERIC_FALLBACK = z.record(z.unknown())

// ---------------------------------------------------------------------------
// JSON Schema → zod converter (C-MCP-1).
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
    return z.record(z.unknown())
  }

  const shape: Record<string, z.ZodTypeAny> = {}
  for (const [key, raw] of Object.entries(props)) {
    const fieldSchema = jsonSchemaPrimitiveToZod(raw)
    shape[key] = requiredSet.has(key) ? fieldSchema : fieldSchema.optional()
  }

  const additional = node.additionalProperties
  const base = z.object(shape)
  if (additional === false) return base.strict()
  return base.passthrough()
}

function mcpInputSchemaToZod(schema: Record<string, any> | undefined): z.ZodTypeAny {
  if (!schema || typeof schema !== "object") return GENERIC_FALLBACK
  const t = typeof schema.type === "string" ? schema.type : "object"
  if (t !== "object") {
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

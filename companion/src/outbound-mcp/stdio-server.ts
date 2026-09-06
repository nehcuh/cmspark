/**
 * stdio MCP server for outbound L1 tools (ADR-022 Phase 0c).
 *
 * Not default-on: only runs when user invokes `cmspark-agent mcp-outbound`.
 * Dispatches to Companion loopback HTTP (Bearer ws_secret) when companion is up.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js"
import {
  OUTBOUND_DISCLOSURE_ZH,
  outboundMcpWireName,
  canonicalOutboundMcpName,
  outboundToolsForProfiles,
} from "./profile"
import { invokeOutboundTool, setOutboundDispatcher } from "./bridge"
import { OUTBOUND_L1_DEFAULT_PROFILE } from "./outbound-grants"
import {
  createHttpOutboundDispatcher,
  fetchCompanionOutboundProfile,
  type HttpClientOptions,
} from "./http-client"
import { getOrCreateSharedSecret } from "../ws-auth"
import { getConfig } from "../config"

const CALLER_ENV = "CMSPARK_OUTBOUND_CALLER_ID"
const PORT_ENV = "CMSPARK_OUTBOUND_PORT"
/** L4+ grant token (cmg_…). Required when outbound_mcp.require_grant=true. */
export const GRANT_ENV = "CMSPARK_OUTBOUND_GRANT"

const META_ACCEPT = "cmspark__accept_data_disclosure"
const META_PROFILE = "cmspark__list_outbound_profile"

/**
 * #410 — stdio tools/list per-key profile trimming. The stdio child only has
 * its env token; the grant profile lives in the companion. wire* fetches it
 * once via the authenticated /outbound-mcp/v1/profile endpoint and caches it
 * here. null = not resolved (fallback: default profile + caller-level gate).
 */
let resolvedProfiles: string[] | null = null

function callerId(): string {
  return (process.env[CALLER_ENV] || "stdio-default").trim() || "stdio-default"
}

function toolDescription(name: string): string {
  const base: Record<string, string> = {
    cmspark__list_tabs: "List open Chrome tabs (CMspark outbound L1)",
    cmspark__navigate: "Navigate a tab to a URL (may require domain confirm)",
    cmspark__get_page_text: "Read page text — data-exfil; requires prior disclosure accept",
    cmspark__click: "Click element (L1 interactive)",
    cmspark__type: "Type into focused/target element (L1)",
    cmspark__screenshot: "Screenshot — data-exfil; requires prior disclosure accept",
    cmspark__wait_for: "Wait for selector/condition",
    cmspark__downloads_find: "Find files in Downloads sandbox (read-only)",
    // #410 interact profile (granted via --profile outbound_l1_interact)
    cmspark__scroll: "Scroll a page/tab (interact profile)",
    cmspark__get_element_info: "Inspect element metadata before acting (interact)",
    cmspark__press_key: "Press a keyboard key (interact)",
    cmspark__select_option: "Select an option in a dropdown (interact)",
    cmspark__hover: "Hover an element (interact)",
    cmspark__dblclick: "Double-click an element (interact)",
    cmspark__fill_form: "Fill a form (interact)",
    cmspark__drag_and_drop: "Drag & drop an element (interact)",
    cmspark__create_tab: "Open a new tab to a URL (URL gate, interact)",
    cmspark__get_page_html: "Read raw page DOM — data-exfil; requires prior disclosure accept (interact)",
    cmspark__analyze_image: "Send page pixels to vision model — data-exfil; requires prior disclosure accept (interact)",
    [META_ACCEPT]:
      "Caller acknowledge is not operator consent (ACK_NOT_OPERATOR). Page export requires grant --allow-page-export and Confirm Center HITL.",
    [META_PROFILE]: "List default outbound L1 tool names (curated profile)",
  }
  return base[name] || `CMspark outbound tool ${name}`
}

function openArgsSchema(): {
  type: "object"
  properties: Record<string, unknown>
  additionalProperties: boolean
} {
  return {
    type: "object",
    properties: {},
    additionalProperties: true,
  }
}

/**
 * Resolve HTTP bearer for mcp-outbound → companion loopback.
 * L4+ dual-review: when require_grant, never fall back to ws_secret.
 */
export function resolveOutboundHttpBearer(): {
  token: string
  mode: "grant" | "ws_secret"
} {
  const requireGrant = getConfig().outbound_mcp?.require_grant === true
  const grant = (process.env[GRANT_ENV] || "").trim()
  if (requireGrant) {
    if (!grant) {
      throw new Error(
        `GRANT_REQUIRED: set ${GRANT_ENV} (cmg_…) when outbound_mcp.require_grant=true — Extension ws_secret is not accepted`,
      )
    }
    return { token: grant, mode: "grant" }
  }
  if (grant) {
    return { token: grant, mode: "grant" }
  }
  return { token: getOrCreateSharedSecret(), mode: "ws_secret" }
}

/** Resolve companion loopback + secret/grant; wire HTTP dispatcher. */
export async function wireDefaultOutboundHttpDispatcher(): Promise<{
  port: number
  token_present: boolean
  auth_mode: "grant" | "ws_secret"
  profile: string
}> {
  const config = getConfig()
  const port =
    Number(process.env[PORT_ENV]) ||
    Number(config.port) ||
    23401
  const { token, mode } = resolveOutboundHttpBearer()
  const httpOpts: HttpClientOptions = {
    port,
    token,
    timeout_ms: 30_000,
  }
  setOutboundDispatcher(
    createHttpOutboundDispatcher({
      port,
      token,
      timeout_ms: 120_000,
    }),
  )
  // #410 — ask the companion which profile this token grants, so tools/list
  // advertises only tools the caller may actually invoke. Await before the
  // first tools/list so an interact key never sees a default-only ad.
  // Fallback (fetch failure / legacy ws_secret): resolvedProfiles stays null →
  // default profile + caller-level gate (documented degradation, not widening).
  let profile: string = OUTBOUND_L1_DEFAULT_PROFILE
  try {
    const p = await fetchCompanionOutboundProfile(httpOpts)
    if (p.ok) {
      resolvedProfiles = [p.profile]
      profile = p.profile
      console.error(
        `[cmspark-outbound] grant profile: ${p.profile} (${p.tools.length} canonical tools)`,
      )
    } else {
      console.error(
        `[cmspark-outbound] profile fetch rejected (${p.error || "unknown"}) — advertising default outbound L1 set`,
      )
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error(
      `[cmspark-outbound] profile fetch failed (${msg}) — advertising default outbound L1 set`,
    )
  }
  return { port, token_present: Boolean(token), auth_mode: mode, profile }
}

/** Profiles currently advertising ([] = default). Visible for tests. */
export function outboundActiveProfiles(): readonly string[] {
  return resolvedProfiles ?? [OUTBOUND_L1_DEFAULT_PROFILE]
}

/** Canonical tool set granted by the resolved profile (default when unset). */
export function outboundActiveCanonicalTools(): string[] {
  return outboundToolsForProfiles(outboundActiveProfiles())
}

/** Build MCP server instance (testable without connecting transport). */
export function createOutboundMcpServer(
  profiles?: readonly string[],
): Server {
  // Explicit profiles (tests) win; else the profile resolved from the env
  // token at wire time; else default (byte-identical to pre-#410 behavior).
  if (profiles) resolvedProfiles = [...profiles]
  const server = new Server(
    { name: "cmspark-outbound", version: "0.6.0" },
    { capabilities: { tools: {} } },
  )

  const grantedCanonical = outboundToolsForProfiles(outboundActiveProfiles())
  const allToolNames = [META_ACCEPT, META_PROFILE, ...grantedCanonical]

  // Wire names are the suffix only (`list_tabs`). Clients that qualify as
  // `server__tool` (Grok) then expose `cmspark__list_tabs`. Advertising the
  // canonical `cmspark__*` name here makes Grok emit two `__` delimiters and
  // drop every tool (session tool_count=0; `grok mcp doctor` still counts 10).
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: allToolNames.map((canonical) => ({
      name: outboundMcpWireName(canonical),
      description: toolDescription(canonical),
      inputSchema: openArgsSchema(),
    })),
  }))

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = canonicalOutboundMcpName(request.params.name)
    const args = (request.params.arguments || {}) as Record<string, unknown>
    const cid = callerId()

    if (name === META_ACCEPT) {
      if (args.acknowledge !== true) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                ok: false,
                error_code: "ACK_REQUIRED",
                disclosure_text_zh: OUTBOUND_DISCLOSURE_ZH,
              }),
            },
          ],
          isError: true,
        }
      }
      // Caller ack is not operator HITL (Task 10 Confirm Center). Do not arm execute.
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              ok: false,
              error_code: "ACK_NOT_OPERATOR",
              error: "caller acknowledge is not operator consent",
              caller_id: cid,
              disclosure_text_zh: OUTBOUND_DISCLOSURE_ZH,
            }),
          },
        ],
        isError: true,
      }
    }

    if (name === META_PROFILE) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ tools: outboundActiveCanonicalTools() }),
          },
        ],
      }
    }

    const granted = outboundActiveCanonicalTools()
    if (!(granted as readonly string[]).includes(name)) {
      const isDefaultOnly =
        resolvedProfiles == null ||
        (resolvedProfiles.length === 1 &&
          resolvedProfiles[0] === OUTBOUND_L1_DEFAULT_PROFILE)
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              ok: false,
              error_code: "PROFILE_FORBIDDEN",
              error: isDefaultOnly
                ? `tool "${name}" is not on the default outbound L1 profile`
                : `tool "${name}" is not granted on the outbound profile ${resolvedProfiles?.join("/")}`,
            }),
          },
        ],
        isError: true,
      }
    }

    const domain = typeof args.domain === "string" ? args.domain : undefined
    const toolArgs =
      args.args && typeof args.args === "object" && !Array.isArray(args.args)
        ? (args.args as Record<string, unknown>)
        : Object.fromEntries(Object.entries(args).filter(([k]) => k !== "domain"))

    const result = await invokeOutboundTool(
      {
        caller_id: cid,
        tool: name,
        args: toolArgs,
        domain,
      },
      undefined,
      // Local gate mirrors the advertised set (explicit profiles → per-key;
      // null fallback → caller-level live-grant union, i.e. pre-#410 behavior).
      resolvedProfiles ?? undefined,
    )

    return {
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
      isError: !result.ok,
    }
  })

  return server
}

/** Connect stdio transport and run until stdin closes. */
export async function runOutboundMcpStdioServer(): Promise<void> {
  const wire = await wireDefaultOutboundHttpDispatcher()
  // Log to stderr only — stdout is MCP JSON-RPC
  console.error(
    `[cmspark-outbound] stdio MCP up; companion HTTP 127.0.0.1:${wire.port} (auth=${wire.auth_mode}, profile=${wire.profile})`,
  )
  const server = createOutboundMcpServer()
  const transport = new StdioServerTransport()
  await server.connect(transport)
  await new Promise<void>((resolve) => {
    process.stdin.on("end", () => resolve())
    process.stdin.on("close", () => resolve())
  })
}

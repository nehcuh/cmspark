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
import { OUTBOUND_MCP_ALLOWLIST, OUTBOUND_DISCLOSURE_ZH } from "./profile"
import { acceptOutboundDisclosure } from "./disclosure-session"
import { invokeOutboundTool, setOutboundDispatcher } from "./bridge"
import { listOutboundTools } from "./facade"
import {
  companionPostDisclosure,
  createHttpOutboundDispatcher,
} from "./http-client"
import { getOrCreateSharedSecret } from "../ws-auth"
import { getConfig } from "../config"

const CALLER_ENV = "CMSPARK_OUTBOUND_CALLER_ID"
const PORT_ENV = "CMSPARK_OUTBOUND_PORT"

const META_ACCEPT = "cmspark__accept_data_disclosure"
const META_PROFILE = "cmspark__list_outbound_profile"

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
    [META_ACCEPT]:
      "Accept that page text/screenshots may enter this coding agent context (server-side session)",
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

/** Resolve companion loopback + secret; wire HTTP dispatcher. */
export function wireDefaultOutboundHttpDispatcher(): {
  port: number
  token_present: boolean
} {
  const config = getConfig()
  const port =
    Number(process.env[PORT_ENV]) ||
    Number(config.port) ||
    23401
  const token = getOrCreateSharedSecret()
  setOutboundDispatcher(
    createHttpOutboundDispatcher({
      port,
      token,
      timeout_ms: 120_000,
    }),
  )
  return { port, token_present: Boolean(token) }
}

/** Build MCP server instance (testable without connecting transport). */
export function createOutboundMcpServer(): Server {
  const server = new Server(
    { name: "cmspark-outbound", version: "0.3.0-p0c" },
    { capabilities: { tools: {} } },
  )

  const allToolNames = [META_ACCEPT, META_PROFILE, ...OUTBOUND_MCP_ALLOWLIST]

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: allToolNames.map((name) => ({
      name,
      description: toolDescription(name),
      inputSchema: openArgsSchema(),
    })),
  }))

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name
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
      // Local session (stdio process gate) + companion process (execute gate)
      const sess = acceptOutboundDisclosure(cid)
      const config = getConfig()
      const port = Number(process.env[PORT_ENV]) || Number(config.port) || 23401
      const remote = await companionPostDisclosure(
        { port, token: getOrCreateSharedSecret() },
        cid,
      )
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              ok: true,
              caller_id: sess.caller_id,
              accepted_at: sess.accepted_at,
              companion_disclosure: remote.ok ? "ok" : remote.error || "failed",
              disclosure_text_zh: OUTBOUND_DISCLOSURE_ZH,
            }),
          },
        ],
        isError: !remote.ok,
      }
    }

    if (name === META_PROFILE) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ tools: listOutboundTools() }),
          },
        ],
      }
    }

    if (!(OUTBOUND_MCP_ALLOWLIST as readonly string[]).includes(name)) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              ok: false,
              error_code: "PROFILE_FORBIDDEN",
              error: `tool "${name}" is not on the default outbound L1 profile`,
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

    const result = await invokeOutboundTool({
      caller_id: cid,
      tool: name,
      args: toolArgs,
      domain,
    })

    return {
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
      isError: !result.ok,
    }
  })

  return server
}

/** Connect stdio transport and run until stdin closes. */
export async function runOutboundMcpStdioServer(): Promise<void> {
  const wire = wireDefaultOutboundHttpDispatcher()
  // Log to stderr only — stdout is MCP JSON-RPC
  console.error(
    `[cmspark-outbound] stdio MCP up; companion HTTP 127.0.0.1:${wire.port} (Bearer ws_secret)`,
  )
  const server = createOutboundMcpServer()
  const transport = new StdioServerTransport()
  await server.connect(transport)
  await new Promise<void>((resolve) => {
    process.stdin.on("end", () => resolve())
    process.stdin.on("close", () => resolve())
  })
}

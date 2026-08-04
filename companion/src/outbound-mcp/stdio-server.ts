/**
 * stdio MCP server for outbound L1 tools (ADR-022 Phase 0c).
 *
 * Not default-on: only runs when user invokes `cmspark-agent mcp-outbound`.
 * Meta tool cmspark__accept_data_disclosure records server-side disclosure.
 *
 * Uses low-level Server + setRequestHandler to avoid McpServer/zod deep
 * instantiation issues in this repo's TypeScript version.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js"
import { OUTBOUND_MCP_ALLOWLIST, OUTBOUND_DISCLOSURE_ZH } from "./profile"
import { acceptOutboundDisclosure } from "./disclosure-session"
import { invokeOutboundTool } from "./bridge"
import { listOutboundTools } from "./facade"

const CALLER_ENV = "CMSPARK_OUTBOUND_CALLER_ID"

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
    properties: {
      // Free-form tool args bag; internal tools validate further
    },
    additionalProperties: true,
  }
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
      const sess = acceptOutboundDisclosure(callerId())
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              ok: true,
              caller_id: sess.caller_id,
              accepted_at: sess.accepted_at,
              disclosure_text_zh: OUTBOUND_DISCLOSURE_ZH,
            }),
          },
        ],
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
    // Prefer nested args if provided; else pass whole bag minus domain
    const toolArgs =
      args.args && typeof args.args === "object" && !Array.isArray(args.args)
        ? (args.args as Record<string, unknown>)
        : Object.fromEntries(Object.entries(args).filter(([k]) => k !== "domain"))

    const result = await invokeOutboundTool({
      caller_id: callerId(),
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
  const server = createOutboundMcpServer()
  const transport = new StdioServerTransport()
  await server.connect(transport)
  await new Promise<void>((resolve) => {
    process.stdin.on("end", () => resolve())
    process.stdin.on("close", () => resolve())
  })
}

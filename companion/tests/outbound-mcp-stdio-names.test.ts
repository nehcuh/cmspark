/**
 * Grok (and any client that qualifies MCP tools as `server__tool`) drops
 * names that already contain `__`. tools/list must advertise the suffix
 * only; CallTool still accepts both the wire name and cmspark__*.
 */
import test from "node:test"
import assert from "node:assert/strict"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import {
  OUTBOUND_MCP_ALLOWLIST,
  outboundMcpWireName,
  canonicalOutboundMcpName,
} from "../src/outbound-mcp/profile"
import { createOutboundMcpServer } from "../src/outbound-mcp/stdio-server"
import {
  setOutboundDispatcher,
  getOutboundDispatcher,
} from "../src/outbound-mcp/bridge"

const META_WIRE = ["accept_data_disclosure", "list_outbound_profile"] as const
const PROFILE_WIRE = OUTBOUND_MCP_ALLOWLIST.map(outboundMcpWireName)

function grokQualified(server: string, wireName: string): string {
  return `${server}__${wireName}`
}

function delimiterCount(name: string): number {
  let n = 0
  let i = 0
  while (i < name.length) {
    const at = name.indexOf("__", i)
    if (at < 0) break
    n++
    i = at + 2
  }
  return n
}

async function connectOutboundClient(): Promise<{
  client: Client
  close: () => Promise<void>
}> {
  const server = createOutboundMcpServer()
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  const client = new Client({ name: "stdio-names-test", version: "0" }, { capabilities: {} })
  await client.connect(clientTransport)
  return {
    client,
    close: async () => {
      await client.close()
    },
  }
}

function parseToolJson(result: unknown): { isError: boolean; body: Record<string, unknown> } {
  const r = result as {
    content?: Array<{ type?: string; text?: string }>
    isError?: boolean
  }
  const text = r.content?.find((c) => c.type === "text")?.text
  assert.ok(text, "expected text content")
  return { isError: r.isError === true, body: JSON.parse(text) as Record<string, unknown> }
}

test("wire names are the cmspark__ suffix; canonical round-trips", () => {
  assert.equal(outboundMcpWireName("cmspark__list_tabs"), "list_tabs")
  assert.equal(canonicalOutboundMcpName("list_tabs"), "cmspark__list_tabs")
  assert.equal(canonicalOutboundMcpName("cmspark__list_tabs"), "cmspark__list_tabs")
  assert.equal(outboundMcpWireName("list_tabs"), "list_tabs")
})

test("tools/list advertises short names so Grok server__tool has exactly one __", async () => {
  const { client, close } = await connectOutboundClient()
  try {
    const { tools } = await client.listTools()
    const names = tools.map((t) => t.name).sort()
    const expected = [...META_WIRE, ...PROFILE_WIRE].sort()
    assert.deepEqual(names, expected)
    for (const name of names) {
      assert.equal(name.includes("__"), false, `wire name must not contain __: ${name}`)
      assert.equal(
        delimiterCount(grokQualified("cmspark", name)),
        1,
        `Grok qualifier must have exactly one __: cmspark__${name}`,
      )
    }
  } finally {
    await close()
  }
})

test("CallTool accepts short wire name and cmspark__* alias", async () => {
  const prev = getOutboundDispatcher()
  const seen: string[] = []
  setOutboundDispatcher(async (req) => {
    seen.push(req.internal_tool)
    return { success: true, data: { tabs: [] } }
  })
  const { client, close } = await connectOutboundClient()
  try {
    const short = parseToolJson(await client.callTool({ name: "list_tabs", arguments: {} }))
    assert.equal(short.isError, false)
    assert.equal(short.body.ok, true)

    const aliased = parseToolJson(
      await client.callTool({ name: "cmspark__list_tabs", arguments: {} }),
    )
    assert.equal(aliased.isError, false)
    assert.equal(aliased.body.ok, true)
    assert.deepEqual(seen, ["list_tabs", "list_tabs"])
  } finally {
    await close()
    setOutboundDispatcher(prev ?? null)
  }
})

test("CallTool still forbids tools off the curated L1 profile", async () => {
  const { client, close } = await connectOutboundClient()
  try {
    for (const name of ["evaluate", "cmspark__evaluate", "shell_exec", "scroll"]) {
      const r = parseToolJson(await client.callTool({ name, arguments: {} }))
      assert.equal(r.isError, true, name)
      assert.equal(r.body.error_code, "PROFILE_FORBIDDEN", name)
    }
  } finally {
    await close()
  }
})

test("short-name exfil tools stay gated: no grant → DISCLOSURE_NOT_GRANTED", async () => {
  const { client, close } = await connectOutboundClient()
  try {
    // stdio track caller is "stdio-default" (CALLER_ENV unset); with no live
    // flagged grant for that caller, both wire-name and canonical exfil calls
    // must be denied BEFORE any dispatcher involvement.
    for (const name of ["get_page_text", "screenshot", "cmspark__get_page_text"]) {
      const r = parseToolJson(await client.callTool({ name, arguments: {} }))
      assert.equal(r.isError, true, name)
      assert.equal(r.body.error_code, "DISCLOSURE_NOT_GRANTED", name)
    }
  } finally {
    await close()
  }
})

test("accept_data_disclosure wire name is still ACK_NOT_OPERATOR", async () => {
  const { client, close } = await connectOutboundClient()
  try {
    const r = parseToolJson(
      await client.callTool({
        name: "accept_data_disclosure",
        arguments: { acknowledge: true },
      }),
    )
    assert.equal(r.isError, true)
    assert.equal(r.body.error_code, "ACK_NOT_OPERATOR")
  } finally {
    await close()
  }
})

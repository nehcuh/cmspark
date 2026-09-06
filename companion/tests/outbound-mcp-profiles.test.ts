/**
 * #410 — outbound interact named profile (issue-first, profile.ts registry /
 * facade gate / stdio tools-list trimming / exfil reuse).
 */
import "./_outbound-grants-setup.js"
import test, { beforeEach } from "node:test"
import assert from "node:assert/strict"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import {
  OUTBOUND_MCP_ALLOWLIST,
  OUTBOUND_MCP_INTERACT_EXTRAS,
  OUTBOUND_MCP_EXFIL_CLASS,
  outboundToolsForProfiles,
  outboundToolAllowedOnProfiles,
  outboundMcpWireName,
} from "../src/outbound-mcp/profile"
import { gateOutboundCall, listOutboundTools } from "../src/outbound-mcp/facade"
import {
  issueOutboundGrant,
  resetOutboundGrantsForTests,
  OUTBOUND_L1_DEFAULT_PROFILE,
  OUTBOUND_L1_INTERACT_PROFILE,
} from "../src/outbound-mcp/outbound-grants"
import { companionInvokeOutbound, resetOutboundCompanionHttpForTests } from "../src/outbound-mcp/companion-http"
import { companionAcceptDisclosure } from "../src/outbound-mcp/companion-http"
import { clearAllOutboundDisclosureSessions } from "../src/outbound-mcp/disclosure-session"
import { setOutboundToolRunner } from "../src/outbound-mcp/companion-http"
import { createOutboundMcpServer } from "../src/outbound-mcp/stdio-server"
import { setOutboundDispatcher, getOutboundDispatcher } from "../src/outbound-mcp/bridge"
import { _resetTabLeasesForTests } from "../src/orchestrator/tab-lease"

beforeEach(() => {
  resetOutboundCompanionHttpForTests()
  clearAllOutboundDisclosureSessions()
  resetOutboundGrantsForTests()
  setOutboundDispatcher(null)
  _resetTabLeasesForTests()
})

// ---------------------------------------------------------------- registry ---

test("#410 default allowlist unchanged; interact extras are separate", () => {
  assert.deepEqual(listOutboundTools(), [...OUTBOUND_MCP_ALLOWLIST])
  assert.equal(
    (OUTBOUND_MCP_ALLOWLIST as readonly string[]).includes("cmspark__scroll"),
    false,
    "interact tool must never join the default allowlist",
  )
  assert.ok(OUTBOUND_MCP_INTERACT_EXTRAS.includes("cmspark__scroll"))
  assert.ok(OUTBOUND_MCP_INTERACT_EXTRAS.includes("cmspark__get_page_html"))
  assert.ok(OUTBOUND_MCP_INTERACT_EXTRAS.includes("cmspark__analyze_image"))
  // exfil reuse: DOM/pixels join the same allow_page_export class
  assert.ok(OUTBOUND_MCP_EXFIL_CLASS.has("cmspark__get_page_html"))
  assert.ok(OUTBOUND_MCP_EXFIL_CLASS.has("cmspark__analyze_image"))
})

test("#410 interact is a superset of default; default is byte-identical", () => {
  const def = outboundToolsForProfiles([OUTBOUND_L1_DEFAULT_PROFILE])
  assert.deepEqual(def, [...OUTBOUND_MCP_ALLOWLIST])
  const interact = outboundToolsForProfiles([OUTBOUND_L1_INTERACT_PROFILE])
  for (const t of OUTBOUND_MCP_ALLOWLIST) {
    assert.ok(interact.includes(t), `interact must keep ${t}`)
  }
  for (const t of OUTBOUND_MCP_INTERACT_EXTRAS) {
    assert.ok(interact.includes(t), `interact must add ${t}`)
  }
  assert.ok(outboundToolAllowedOnProfiles("cmspark__scroll", [OUTBOUND_L1_INTERACT_PROFILE]))
  assert.ok(!outboundToolAllowedOnProfiles("cmspark__scroll", [OUTBOUND_L1_DEFAULT_PROFILE]))
  assert.ok(outboundToolAllowedOnProfiles("cmspark__navigate", [OUTBOUND_L1_INTERACT_PROFILE]))
})

// --------------------------------------------------------------------- gate ---

test("#410 default grant gate: interact tool → PROFILE_FORBIDDEN (default copy)", () => {
  const r = gateOutboundCall(
    { caller_id: "c1", tool: "cmspark__scroll" },
    { explicitProfiles: [OUTBOUND_L1_DEFAULT_PROFILE] },
  )
  assert.equal(r.ok, false)
  assert.equal(r.error_code, "PROFILE_FORBIDDEN")
  assert.match(r.error || "", /not on the default outbound L1 profile/)
})

test("#410 interact grant gate: scroll / get_page_html pass; evaluate stays forbidden", () => {
  const ps = [OUTBOUND_L1_INTERACT_PROFILE]
  const scroll = gateOutboundCall({ caller_id: "c2", tool: "cmspark__scroll" }, { explicitProfiles: ps })
  assert.equal(scroll.ok, true)
  assert.equal(scroll.internal_tool, "scroll")
  const html = gateOutboundCall({ caller_id: "c2", tool: "cmspark__get_page_html" }, { explicitProfiles: ps })
  assert.equal(html.error_code, "DISCLOSURE_NOT_GRANTED", "exfil needs grant flag first")
  const eval_ = gateOutboundCall({ caller_id: "c2", tool: "cmspark__evaluate" }, { explicitProfiles: ps })
  assert.equal(eval_.ok, false)
  assert.equal(eval_.error_code, "PROFILE_FORBIDDEN")
})

test("#410 caller-level (no grant) keeps default semantics", async () => {
  // liveGrantProfilesByCaller empty → default only
  const ok = gateOutboundCall({ caller_id: "nobody", tool: "cmspark__list_tabs" })
  assert.equal(ok.ok, true)
  const bad = gateOutboundCall({ caller_id: "nobody", tool: "cmspark__scroll" })
  assert.equal(bad.error_code, "PROFILE_FORBIDDEN")
  const exfil = gateOutboundCall({ caller_id: "nobody", tool: "cmspark__get_page_html" })
  assert.equal(exfil.error_code, "PROFILE_FORBIDDEN", "not even exfil-visible off-profile")
})

// ---------------------------------------------------------------- HTTP track ---

async function invoke(
  caller_id: string,
  tool: string,
  grant_id?: string,
  grant_profile?: string,
): Promise<any> {
  return companionInvokeOutbound(
    { caller_id, tool, args: { tabId: 1 } },
    { grant_id, grant_profile },
  )
}

test("#410 HTTP per-key: default key cannot call interact; interact key can", async () => {
  let hit: string[] = []
  setOutboundToolRunner(async (_id, tool) => {
    hit.push(tool)
    return { success: true, data: { ok: true } }
  })
  const dKey = issueOutboundGrant({ caller_id: "p1", label: "d" })
  const iKey = issueOutboundGrant({
    caller_id: "p1",
    label: "i",
    profile: OUTBOUND_L1_INTERACT_PROFILE,
  })
  // default key → scroll forbidden (per-key, sibling interact key must not widen)
  const denied = await invoke("p1", "scroll", dKey.id, OUTBOUND_L1_DEFAULT_PROFILE)
  assert.equal(denied.ok, false)
  assert.equal(denied.error_code, "PROFILE_FORBIDDEN")
  assert.equal(hit.length, 0)
  // interact key → scroll dispatches
  const pass = await invoke("p1", "scroll", iKey.id, OUTBOUND_L1_INTERACT_PROFILE)
  assert.equal(pass.ok, true, JSON.stringify(pass))
  assert.deepEqual(hit, ["scroll"])
})

test("#410 HTTP per-key exfil: interact get_page_html without allow_page_export → NOT_GRANTED; with flag + operator session → runs", async () => {
  let hit: string[] = []
  setOutboundToolRunner(async (_id, tool) => {
    hit.push(tool)
    return { success: true, data: { ok: true } }
  })
  const noFlag = issueOutboundGrant({
    caller_id: "p2",
    label: "i-noexfil",
    profile: OUTBOUND_L1_INTERACT_PROFILE,
  })
  const r1 = await invoke("p2", "get_page_html", noFlag.id, OUTBOUND_L1_INTERACT_PROFILE)
  assert.equal(r1.ok, false)
  assert.equal(r1.error_code, "DISCLOSURE_NOT_GRANTED")
  assert.equal(hit.length, 0)

  const flag = issueOutboundGrant({
    caller_id: "p2",
    label: "i-exfil",
    profile: OUTBOUND_L1_INTERACT_PROFILE,
    allow_page_export: true,
  })
  // operator HITL session not armed yet
  const r2 = await invoke("p2", "get_page_html", flag.id, OUTBOUND_L1_INTERACT_PROFILE)
  assert.equal(r2.error_code, "DISCLOSURE_HITL_REQUIRED")
  assert.equal(hit.length, 0)
  await companionAcceptDisclosure("p2")
  const r3 = await invoke("p2", "get_page_html", flag.id, OUTBOUND_L1_INTERACT_PROFILE)
  assert.equal(r3.ok, true, JSON.stringify(r3))
  assert.deepEqual(hit, ["get_page_html"])
})

test("#410 HTTP per-key exfil: analyze_image reuses allow_page_export (interact)", async () => {
  let hit = 0
  setOutboundToolRunner(async (_id, tool) => {
    hit++
    assert.equal(tool, "analyze_image")
    return { success: true, data: { ok: true } }
  })
  const noFlag = issueOutboundGrant({
    caller_id: "p3",
    label: "i-img",
    profile: OUTBOUND_L1_INTERACT_PROFILE,
  })
  const r1 = await invoke("p3", "analyze_image", noFlag.id, OUTBOUND_L1_INTERACT_PROFILE)
  assert.equal(r1.error_code, "DISCLOSURE_NOT_GRANTED")
  const flag = issueOutboundGrant({
    caller_id: "p3",
    label: "i-img-f",
    profile: OUTBOUND_L1_INTERACT_PROFILE,
    allow_page_export: true,
  })
  await companionAcceptDisclosure("p3")
  const r2 = await invoke("p3", "analyze_image", flag.id, OUTBOUND_L1_INTERACT_PROFILE)
  assert.equal(r2.ok, true, JSON.stringify(r2))
  assert.equal(hit, 1)
})

// ---------------------------------------------------------------- stdio track ---

async function connectStdio(
  profiles?: readonly string[],
): Promise<{ client: Client; names: () => Promise<string[]>; call: (n: string) => Promise<any>; close: () => Promise<void> }> {
  const server = createOutboundMcpServer(profiles)
  const [ct, st] = InMemoryTransport.createLinkedPair()
  await server.connect(st)
  const client = new Client({ name: "profile-test", version: "0" }, { capabilities: {} })
  await client.connect(ct)
  return {
    client,
    names: async () => {
      const { tools } = await client.listTools()
      return tools.map((t) => t.name).sort()
    },
    call: async (n: string) => {
      const r = (await client.callTool({ name: n, arguments: { tabId: 1 } })) as {
        isError?: boolean
        content?: Array<{ type?: string; text?: string }>
      }
      const text = r.content?.find((c) => c.type === "text")?.text
      return { isError: r.isError === true, body: text ? JSON.parse(text) : null }
    },
    close: async () => {
      await client.close()
    },
  }
}

test("#410 stdio tools/list trims by interact profile; local gate matches", async () => {
  const stub = getOutboundDispatcher()
  const seen: string[] = []
  setOutboundDispatcher(async (req) => {
    seen.push(req.internal_tool)
    return { success: true, data: { ok: true } }
  })
  const s = await connectStdio([OUTBOUND_L1_INTERACT_PROFILE])
  try {
    const names = await s.names()
    const wires = outboundToolsForProfiles([OUTBOUND_L1_INTERACT_PROFILE]).map(outboundMcpWireName)
    for (const t of wires) assert.ok(names.includes(t), `tools/list must advertise ${t}`)
    assert.ok(names.includes("scroll"), "interact stdio advertises scroll")
    assert.ok(!names.includes("cmspark__"), "wire names carry no prefix (Grok one-__ rule)")
    // CallTool short scroll dispatches (local gate = advertised set)
    const r = await s.call("scroll")
    assert.equal(r.isError, false, JSON.stringify(r))
    assert.deepEqual(seen, ["scroll"])
  } finally {
    await s.close()
    setOutboundDispatcher(stub ?? null)
  }
})

test("#410 stdio default profile does NOT advertise scroll and rejects it", async () => {
  const stub = getOutboundDispatcher()
  setOutboundDispatcher(async () => ({ success: true, data: {} }))
  const s = await connectStdio([OUTBOUND_L1_DEFAULT_PROFILE])
  try {
    const names = await s.names()
    assert.ok(!names.includes("scroll"))
    assert.ok(names.includes("list_tabs"))
    const r = await s.call("scroll")
    assert.equal(r.isError, true)
    assert.equal(r.body.error_code, "PROFILE_FORBIDDEN")
  } finally {
    await s.close()
    setOutboundDispatcher(stub ?? null)
  }
})

/**
 * #419 — interact-profile residual: stdio profile lazy re-pull + allowlist-aware
 * HTTP shape pre-check (#413 P2-1) with dual-track decision parity.
 */
import "./_outbound-grants-setup.js"
import test, { beforeEach } from "node:test"
import assert from "node:assert/strict"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js"
import {
  OUTBOUND_L1_DEFAULT_PROFILE,
  OUTBOUND_L1_INTERACT_PROFILE,
} from "../src/outbound-mcp/outbound-grants"
import {
  OUTBOUND_MCP_ALLOWLIST,
  OUTBOUND_MCP_INTERACT_EXTRAS,
  isCanonicalOnAnyOutboundProfile,
} from "../src/outbound-mcp/profile"
import {
  createOutboundMcpServer,
  wireDefaultOutboundHttpDispatcher,
  retryOutboundProfileIfStale,
  outboundActiveProfiles,
  outboundActiveCanonicalTools,
  _setOutboundProfileFetcherForTests,
  _resetOutboundProfileRuntimeForTests,
  _forceProfileStaleForTests,
} from "../src/outbound-mcp/stdio-server"
import { companionInvokeOutbound, resetOutboundCompanionHttpForTests } from "../src/outbound-mcp/companion-http"
import { setOutboundToolRunner } from "../src/outbound-mcp/companion-http"
import { clearAllOutboundDisclosureSessions } from "../src/outbound-mcp/disclosure-session"
import { resetOutboundGrantsForTests } from "../src/outbound-mcp/outbound-grants"
import { setOutboundDispatcher, getOutboundDispatcher } from "../src/outbound-mcp/bridge"

beforeEach(() => {
  resetOutboundCompanionHttpForTests()
  clearAllOutboundDisclosureSessions()
  resetOutboundGrantsForTests()
  setOutboundDispatcher(null)
  _resetOutboundProfileRuntimeForTests()
})

const FAKE_GRANT_ENV = "cmg_fakeforstdioprofiletest0123456789abcdef"

// ------------------------------------------------------- stdio lazy re-pull ---

type Fetcher = (o: unknown) => Promise<
  | { ok: true; profile: string; tools: string[] }
  | { ok: false; error?: string }
>

test("#419 stdio re-pulls the grant profile after a failed boot fetch", async () => {
  const prev = process.env.CMSPARK_OUTBOUND_GRANT
  process.env.CMSPARK_OUTBOUND_GRANT = FAKE_GRANT_ENV
  try {
    let mode: "fail" | "interact" = "fail"
    _setOutboundProfileFetcherForTests((async () => {
      if (mode === "fail") return { ok: false as const, error: "companion down" }
      return {
        ok: true as const,
        profile: OUTBOUND_L1_INTERACT_PROFILE,
        tools: [
          ...OUTBOUND_MCP_ALLOWLIST,
          ...OUTBOUND_MCP_INTERACT_EXTRAS,
        ],
      }
    }) as unknown as Fetcher)
    const wire = await wireDefaultOutboundHttpDispatcher()
    assert.equal(wire.auth_mode, "grant")
    // boot fetch failed → degraded default, interact tools not visible
    assert.deepEqual([...outboundActiveProfiles()], [OUTBOUND_L1_DEFAULT_PROFILE])
    assert.ok(!outboundActiveCanonicalTools().includes("cmspark__scroll"))

    // companion comes up; cooldown prevents immediate re-pull
    mode = "interact"
    assert.equal(await retryOutboundProfileIfStale(), false, "cooldown must throttle")
    _forceProfileStaleForTests()
    assert.equal(await retryOutboundProfileIfStale(), true, "lazy re-pull succeeds")
    assert.deepEqual(
      [...outboundActiveProfiles()],
      [OUTBOUND_L1_INTERACT_PROFILE],
    )
    assert.ok(outboundActiveCanonicalTools().includes("cmspark__scroll"))
  } finally {
    if (prev === undefined) delete process.env.CMSPARK_OUTBOUND_GRANT
    else process.env.CMSPARK_OUTBOUND_GRANT = prev
  }
})

test("#419 retries are bounded (no infinite re-pull)", async () => {
  const prev = process.env.CMSPARK_OUTBOUND_GRANT
  process.env.CMSPARK_OUTBOUND_GRANT = FAKE_GRANT_ENV
  try {
    let fetches = 0
    _setOutboundProfileFetcherForTests((async () => {
      fetches++
      return { ok: false as const, error: "down" }
    }) as unknown as Fetcher)
    await wireDefaultOutboundHttpDispatcher() // initial attempt = 1 fetch
    for (let i = 0; i < 10; i++) {
      _forceProfileStaleForTests()
      await retryOutboundProfileIfStale()
    }
    assert.equal(fetches, 1 + 5, "exactly the bounded retry budget (5) after the initial attempt")
    _forceProfileStaleForTests()
    assert.equal(await retryOutboundProfileIfStale(), false, "budget exhausted")
    assert.equal(fetches, 6, "no further fetches after budget exhaustion")
  } finally {
    if (prev === undefined) delete process.env.CMSPARK_OUTBOUND_GRANT
    else process.env.CMSPARK_OUTBOUND_GRANT = prev
  }
})

test("#419 tools/list upgrades after a late profile re-pull", async () => {
  const prev = process.env.CMSPARK_OUTBOUND_GRANT
  process.env.CMSPARK_OUTBOUND_GRANT = FAKE_GRANT_ENV
  try {
    let mode: "fail" | "interact" = "fail"
    _setOutboundProfileFetcherForTests((async () => {
      if (mode === "fail") return { ok: false as const, error: "down" }
      return { ok: true as const, profile: OUTBOUND_L1_INTERACT_PROFILE, tools: [] }
    }) as unknown as Fetcher)
    await wireDefaultOutboundHttpDispatcher()
    const server = createOutboundMcpServer()
    const [ct, st] = InMemoryTransport.createLinkedPair()
    await server.connect(st)
    const client = new Client({ name: "retry", version: "0" }, { capabilities: {} })
    await client.connect(ct)
    try {
      let names = (await client.listTools()).tools.map((t) => t.name)
      assert.ok(!names.includes("scroll"), "degraded ad must not include scroll")

      mode = "interact"
      _forceProfileStaleForTests()
      names = (await client.listTools()).tools.map((t) => t.name)
      assert.ok(names.includes("scroll"), "tools/list must upgrade after re-pull")
      assert.ok(names.includes("list_tabs"))
    } finally {
      await client.close()
    }
  } finally {
    if (prev === undefined) delete process.env.CMSPARK_OUTBOUND_GRANT
    else process.env.CMSPARK_OUTBOUND_GRANT = prev
  }
})

// ------------------------------------------- allowlist-aware shape pre-check ---

test("#419 shape pre-check never rejects a tool granted on any known profile", () => {
  for (const t of OUTBOUND_MCP_ALLOWLIST) {
    assert.equal(isCanonicalOnAnyOutboundProfile(t), true, t)
  }
  for (const t of OUTBOUND_MCP_INTERACT_EXTRAS) {
    assert.equal(isCanonicalOnAnyOutboundProfile(t), true, t)
  }
  // non-member malformed names still rejected by the membership-aware pre-check
  assert.equal(isCanonicalOnAnyOutboundProfile("cmspark__mcp__cmspark__list_tabs"), false)
  assert.equal(isCanonicalOnAnyOutboundProfile("cmspark__CMSPARK__list_tabs"), false)
  assert.equal(isCanonicalOnAnyOutboundProfile("cmspark__"), false)
})

test("#419 HTTP vs stdio make the same allow/deny decision per wire name", async () => {
  const stub = getOutboundDispatcher()
  setOutboundDispatcher(async () => ({ success: true, data: { ok: true } }))
  setOutboundToolRunner(async () => ({ success: true, data: { ok: true } }))
  const server = createOutboundMcpServer([OUTBOUND_L1_DEFAULT_PROFILE])
  const [ct, st] = InMemoryTransport.createLinkedPair()
  await server.connect(st)
  const client = new Client({ name: "parity", version: "0" }, { capabilities: {} })
  await client.connect(ct)
  const cases = [
    "list_tabs",            // allowed both
    "cmspark__list_tabs",   // allowed both (alias)
    "navigate",             // allowed both
    "mcp__cmspark__list_tabs", // deny both
    "CMSPARK__list_tabs",   // deny both
    "cmspark__list_tabs__", // deny both
    "scroll",               // deny both (default profile)
    "get_page_html",        // deny both (default profile + off-profile)
  ]
  try {
    for (const w of cases) {
      const http = await companionInvokeOutbound({
        caller_id: "parity",
        tool: w,
        args: { tabId: 424201 },
      })
      const mcp = (await client.callTool({ name: w, arguments: { tabId: 424201 } })) as {
        isError?: boolean
        content?: Array<{ type?: string; text?: string }>
      }
      const text = mcp.content?.find((c) => c.type === "text")?.text
      const stdioBody = text ? JSON.parse(text) : {}
      const httpOk = http.ok === true
      const stdioOk = stdioBody.ok === true || stdioBody.internal_tool !== undefined
      // Allow/deny parity is the #419 contract; error_code may differ on the
      // HTTP per-key exfil track, which answers DISCLOSURE_NOT_GRANTED before
      // the profile gate for exfil-class tools (safe deny either way).
      assert.equal(
        httpOk,
        stdioOk,
        `allow/deny parity for "${w}": http=${http.error_code} stdio=${stdioBody.error_code}`,
      )
      if (!httpOk && !stdioOk && http.error_code === stdioBody.error_code) {
        // identical deny codes — best case, nothing more to assert
      }
    }
  } finally {
    await client.close()
    setOutboundDispatcher(stub ?? null)
  }
})

test("#419 illegal-name format copy is preserved (not the off-profile copy)", async () => {
  setOutboundToolRunner(async () => ({ success: true, data: {} }))
  const r = await companionInvokeOutbound({
    caller_id: "c",
    tool: "mcp__cmspark__list_tabs",
  })
  assert.equal(r.ok, false)
  assert.equal(r.error_code, "PROFILE_FORBIDDEN")
  assert.match(r.error || "", /not a valid outbound MCP name/)
  assert.doesNotMatch(r.error || "", /not on the default outbound L1 profile/)
})

import "./_outbound-grants-setup.js"
import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"
import {
  gateOutboundCall,
  listOutboundTools,
} from "../src/outbound-mcp/facade"
import {
  isOutboundAllowed,
  OUTBOUND_MCP_ALLOWLIST,
} from "../src/outbound-mcp/profile"
import {
  acceptOutboundDisclosure,
  clearAllOutboundDisclosureSessions,
  hasOutboundDisclosure,
} from "../src/outbound-mcp/disclosure-session"
import {
  invokeOutboundTool,
  setOutboundDispatcher,
} from "../src/outbound-mcp/bridge"
import { makeOutboundMcpOrigin } from "../src/outbound-mcp/origin"
import {
  issueOutboundGrant,
  resetOutboundGrantsForTests,
} from "../src/outbound-mcp/outbound-grants"

test.beforeEach(() => {
  clearAllOutboundDisclosureSessions()
  resetOutboundGrantsForTests()
  setOutboundDispatcher(null)
})

test("listOutboundTools matches allowlist", () => {
  assert.deepEqual(listOutboundTools(), [...OUTBOUND_MCP_ALLOWLIST])
})

test("gate allows whitelist tool without disclosure when not exfil", () => {
  const r = gateOutboundCall({
    caller_id: "test",
    tool: "cmspark__list_tabs",
  })
  assert.equal(r.ok, true)
  assert.equal(r.internal_tool, "list_tabs")
})

test("gate refuses shell / cookies / host", () => {
  for (const tool of [
    "cmspark__shell_exec",
    "shell_exec",
    "cmspark__get_cookies",
    "cmspark__host_computer",
    "evaluate",
  ]) {
    const r = gateOutboundCall({ caller_id: "t", tool })
    assert.equal(r.ok, false, tool)
    assert.equal(r.error_code, "PROFILE_FORBIDDEN")
  }
})

test("exfil-class requires server disclosure session (M3)", () => {
  const r = gateOutboundCall({
    caller_id: "t",
    tool: "cmspark__get_page_text",
  })
  assert.equal(r.ok, false)
  assert.equal(r.error_code, "DISCLOSURE_NOT_GRANTED")
  assert.ok(r.disclosure_text_zh)
})

test("caller disclosure_accepted true WITHOUT server session still refused (M3)", () => {
  // Critical: do not trust MCP client boolean
  const r = gateOutboundCall({
    caller_id: "forger",
    tool: "cmspark__screenshot",
    disclosure_accepted: true,
  })
  assert.equal(r.ok, false)
  assert.equal(r.error_code, "DISCLOSURE_NOT_GRANTED")
  assert.equal(hasOutboundDisclosure("forger"), false)
})

test("exfil without allow_page_export is DISCLOSURE_NOT_GRANTED even if caller disclosure_accepted", () => {
  issueOutboundGrant({ label: "t", caller_id: "no-flag" })
  const r = gateOutboundCall({
    caller_id: "no-flag",
    tool: "cmspark__get_page_text",
    disclosure_accepted: true,
  })
  assert.equal(r.ok, false)
  assert.equal(r.error_code, "DISCLOSURE_NOT_GRANTED")
  assert.equal(hasOutboundDisclosure("no-flag"), false)
})

test("grant allow_page_export still DISCLOSURE_HITL_REQUIRED without operator session", () => {
  issueOutboundGrant({ label: "t", caller_id: "hitl", allow_page_export: true })
  assert.equal(hasOutboundDisclosure("hitl"), false)
  const r = gateOutboundCall({
    caller_id: "hitl",
    tool: "cmspark__screenshot",
    disclosure_accepted: true,
  })
  assert.equal(r.ok, false)
  assert.equal(r.error_code, "DISCLOSURE_HITL_REQUIRED")
  assert.equal(hasOutboundDisclosure("hitl"), false)
})

test("server acceptOutboundDisclosure then exfil allowed at gate", () => {
  issueOutboundGrant({ label: "t", caller_id: "legit", allow_page_export: true })
  acceptOutboundDisclosure("legit")
  assert.equal(hasOutboundDisclosure("legit"), true)
  const ok = gateOutboundCall({
    caller_id: "legit",
    tool: "cmspark__screenshot",
    // even without client flag
  })
  assert.equal(ok.ok, true)
  assert.equal(ok.internal_tool, "screenshot")
})

test("acceptOutboundDisclosure without allow_page_export is still DISCLOSURE_NOT_GRANTED", () => {
  acceptOutboundDisclosure("session-only")
  const r = gateOutboundCall({
    caller_id: "session-only",
    tool: "cmspark__screenshot",
  })
  assert.equal(r.ok, false)
  assert.equal(r.error_code, "DISCLOSURE_NOT_GRANTED")
})

test("stdio accept_data_disclosure acknowledge is not sufficient", () => {
  const src = fs.readFileSync(
    path.join(__dirname, "..", "..", "src", "outbound-mcp", "stdio-server.ts"),
    "utf8",
  )
  assert.match(src, /ACK_NOT_OPERATOR/)
  assert.doesNotMatch(src, /acceptOutboundDisclosure\(/)
  issueOutboundGrant({ label: "t", caller_id: "stdio-default", allow_page_export: true })
  assert.equal(hasOutboundDisclosure("stdio-default"), false)
  const r = gateOutboundCall({
    caller_id: "stdio-default",
    tool: "cmspark__get_page_text",
  })
  assert.equal(r.ok, false)
  assert.equal(r.error_code, "DISCLOSURE_HITL_REQUIRED")
})

test("isOutboundAllowed only for cmspark__ curated set", () => {
  assert.equal(isOutboundAllowed("cmspark__navigate"), true)
  assert.equal(isOutboundAllowed("navigate"), false)
})

test("invoke without dispatcher fails BRIDGE_UNAVAILABLE after gate", async () => {
  const r = await invokeOutboundTool({
    caller_id: "c1",
    tool: "cmspark__list_tabs",
  })
  assert.equal(r.ok, false)
  assert.equal(r.error_code, "BRIDGE_UNAVAILABLE")
  assert.equal(r.internal_tool, "list_tabs")
  assert.ok(r.origin)
  assert.equal(r.origin?.kind, "outbound_mcp")
  assert.equal(r.origin?.synthetic_origin, "outbound_mcp:c1")
  assert.equal(r.origin?.originWs, null)
})

test("invoke with dispatcher runs and binds origin (M4/M6)", async () => {
  const seen: unknown[] = []
  setOutboundDispatcher(async (req) => {
    seen.push(req)
    return { success: true, data: { tabs: [] } }
  })
  const r = await invokeOutboundTool({
    caller_id: "agent-a",
    tool: "cmspark__list_tabs",
    args: {},
  })
  assert.equal(r.ok, true)
  assert.equal(r.dispatch?.success, true)
  assert.equal(seen.length, 1)
  const d = seen[0] as {
    internal_tool: string
    origin: { synthetic_origin: string; kind: string }
  }
  assert.equal(d.internal_tool, "list_tabs")
  assert.equal(d.origin.kind, "outbound_mcp")
  assert.equal(d.origin.synthetic_origin, "outbound_mcp:agent-a")
})

test("invoke exfil without session never reaches dispatcher", async () => {
  let called = false
  setOutboundDispatcher(async () => {
    called = true
    return { success: true }
  })
  const r = await invokeOutboundTool({
    caller_id: "x",
    tool: "cmspark__get_page_text",
    disclosure_accepted: true,
  })
  assert.equal(r.ok, false)
  assert.equal(r.error_code, "DISCLOSURE_NOT_GRANTED")
  assert.equal(called, false)
})

test("makeOutboundMcpOrigin shape", () => {
  const o = makeOutboundMcpOrigin("pid-9")
  assert.equal(o.synthetic_origin, "outbound_mcp:pid-9")
  assert.equal(o.originWs, null)
})

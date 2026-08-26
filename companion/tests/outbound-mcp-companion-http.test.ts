import "./_outbound-grants-setup.js"
import test from "node:test"
import assert from "node:assert/strict"
import {
  companionInvokeOutbound,
  companionAcceptDisclosure,
  authorizeOutboundHttp,
  setOutboundToolRunner,
  resetOutboundCompanionHttpForTests,
  extractBearerToken,
} from "../src/outbound-mcp/companion-http"
import { clearAllOutboundDisclosureSessions, hasOutboundDisclosure } from "../src/outbound-mcp/disclosure-session"
import {
  issueOutboundGrant,
  resetOutboundGrantsForTests,
} from "../src/outbound-mcp/outbound-grants"
import type { IncomingMessage } from "http"

function fakeReq(auth?: string): IncomingMessage {
  return { headers: { authorization: auth } } as IncomingMessage
}

test.beforeEach(() => {
  resetOutboundCompanionHttpForTests()
  clearAllOutboundDisclosureSessions()
  resetOutboundGrantsForTests()
})

test("authorizeOutboundHttp requires matching bearer", () => {
  assert.equal(authorizeOutboundHttp(fakeReq(), "secret"), false)
  assert.equal(authorizeOutboundHttp(fakeReq("Bearer wrong"), "secret"), false)
  assert.equal(authorizeOutboundHttp(fakeReq("Bearer secret"), "secret"), true)
  assert.equal(extractBearerToken(fakeReq("Bearer abc")), "abc")
})

test("companion invoke refuses forbidden tools", async () => {
  const r = await companionInvokeOutbound({
    caller_id: "c",
    tool: "cmspark__shell_exec",
  })
  assert.equal(r.ok, false)
  assert.equal(r.error_code, "PROFILE_FORBIDDEN")
})

test("companion invoke refuses exfil without disclosure even with runner", async () => {
  setOutboundToolRunner(async () => ({ success: true, data: { text: "x" } }))
  const r = await companionInvokeOutbound({
    caller_id: "c",
    tool: "cmspark__get_page_text",
  })
  assert.equal(r.ok, false)
  assert.equal(r.error_code, "DISCLOSURE_NOT_GRANTED")
})

test("companion invoke EXTENSION_UNAVAILABLE without runner", async () => {
  const r = await companionInvokeOutbound({
    caller_id: "c",
    tool: "cmspark__list_tabs",
  })
  assert.equal(r.ok, false)
  assert.equal(r.error_code, "EXTENSION_UNAVAILABLE")
})

test("companion invoke dispatches via runner after gate", async () => {
  const calls: { tool: string; id: string; params: any }[] = []
  setOutboundToolRunner(async (id, tool, params) => {
    calls.push({ tool, id, params })
    assert.equal(tool, "list_tabs")
    return { success: true, data: { tabs: [{ id: 1 }] } }
  })
  const r = await companionInvokeOutbound({
    caller_id: "agent",
    tool: "cmspark__list_tabs",
    args: {},
  })
  assert.equal(r.ok, true)
  assert.deepEqual(r.data, { tabs: [{ id: 1 }] })
  assert.equal(calls.length, 1)
  assert.ok(calls[0].id.startsWith("ob_"))
  assert.equal(r.origin?.synthetic_origin, "outbound_mcp:agent")
  // L8 flag for confirm fan-out
  assert.equal(calls[0].params.__outbound_mcp, true)
  assert.equal(calls[0].params.__outbound_caller_id, "agent")
})

test("companionAcceptDisclosure without allow_page_export does not arm exfil", async () => {
  await companionAcceptDisclosure("d1")
  setOutboundToolRunner(async () => ({ success: true, data: { ok: true } }))
  const r = await companionInvokeOutbound({
    caller_id: "d1",
    tool: "cmspark__screenshot",
    args: { tabId: 1 },
  })
  assert.equal(r.ok, false)
  assert.equal(r.error_code, "DISCLOSURE_NOT_GRANTED")
})

test("grant allow_page_export still DISCLOSURE_HITL_REQUIRED without operator session", async () => {
  issueOutboundGrant({ label: "t", caller_id: "d1", allow_page_export: true })
  setOutboundToolRunner(async () => ({ success: true, data: { ok: true } }))
  const r = await companionInvokeOutbound({
    caller_id: "d1",
    tool: "cmspark__screenshot",
    args: { tabId: 1 },
  })
  assert.equal(r.ok, false)
  assert.equal(r.error_code, "DISCLOSURE_HITL_REQUIRED")
  assert.equal(hasOutboundDisclosure("d1"), false)
})

test("companion exfil after grant flag plus operator session reaches runner", async () => {
  issueOutboundGrant({ label: "t", caller_id: "d1", allow_page_export: true })
  await companionAcceptDisclosure("d1")
  setOutboundToolRunner(async (_id, tool) => {
    assert.equal(tool, "screenshot")
    return { success: true, data: { ok: true } }
  })
  // L9: screenshot needs tabId
  const r = await companionInvokeOutbound({
    caller_id: "d1",
    tool: "cmspark__screenshot",
    args: { tabId: 1 },
  })
  assert.equal(r.ok, true)
})

test("companion interactive without tabId → TAB_ID_REQUIRED (L9)", async () => {
  setOutboundToolRunner(async () => ({ success: true }))
  const r = await companionInvokeOutbound({
    caller_id: "c",
    tool: "cmspark__click",
    args: {},
  })
  assert.equal(r.ok, false)
  assert.equal(r.error_code, "TAB_ID_REQUIRED")
})

test("runner failure surfaces DISPATCH_FAILED", async () => {
  setOutboundToolRunner(async () => ({ success: false, error: "tab gone" }))
  const r = await companionInvokeOutbound({
    caller_id: "c",
    tool: "cmspark__list_tabs",
  })
  assert.equal(r.ok, false)
  assert.equal(r.error_code, "DISPATCH_FAILED")
  assert.match(r.error || "", /tab gone/)
})

test("runner confirm timeout maps to OUTBOUND_CONFIRM_REQUIRED (L8)", async () => {
  setOutboundToolRunner(async () => ({
    success: false,
    error: "Security confirmation timeout for navigate",
  }))
  const r = await companionInvokeOutbound({
    caller_id: "c",
    tool: "cmspark__navigate",
    args: { tabId: 2, url: "https://example.com" },
  })
  assert.equal(r.ok, false)
  assert.equal(r.error_code, "OUTBOUND_CONFIRM_REQUIRED")
  assert.match(r.error || "", /tray|Side Panel/i)
})

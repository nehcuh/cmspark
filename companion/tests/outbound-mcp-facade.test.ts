import test from "node:test"
import assert from "node:assert/strict"
import {
  gateOutboundCall,
  listOutboundTools,
} from "../src/outbound-mcp/facade"
import {
  isOutboundAllowed,
  OUTBOUND_MCP_ALLOWLIST,
} from "../src/outbound-mcp/profile"

test("listOutboundTools matches allowlist", () => {
  assert.deepEqual(listOutboundTools(), [...OUTBOUND_MCP_ALLOWLIST])
})

test("gate allows whitelist tool with disclosure when needed", () => {
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

test("exfil-class requires disclosure", () => {
  const r = gateOutboundCall({
    caller_id: "t",
    tool: "cmspark__get_page_text",
  })
  assert.equal(r.ok, false)
  assert.equal(r.error_code, "DISCLOSURE_REQUIRED")
  assert.ok(r.disclosure_text_zh)

  const ok = gateOutboundCall({
    caller_id: "t",
    tool: "cmspark__screenshot",
    disclosure_accepted: true,
  })
  assert.equal(ok.ok, true)
  assert.equal(ok.internal_tool, "screenshot")
})

test("isOutboundAllowed only for cmspark__ curated set", () => {
  assert.equal(isOutboundAllowed("cmspark__navigate"), true)
  assert.equal(isOutboundAllowed("navigate"), false)
})

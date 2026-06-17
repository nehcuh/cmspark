// enhanceMcpError unit tests (audit item 18)
//
// The LLM uses the error string returned from executeMcpTool to decide what
// to do next. Bare "MCP call failed: MCP timeout" gives it no signal — it
// defaults to identical retry. enhanceMcpError wraps each known failure mode
// with an actionable hint.

import test from "node:test"
import assert from "node:assert/strict"
import { enhanceMcpError } from "../src/server.js"

const route = { serverName: "fs", toolName: "read_file" }

test("timeout error includes retry-or-narrow-or-skip hint", () => {
  const out = enhanceMcpError("MCP timeout: call fs/read_file > 30000ms", route, { path: "/big/file" })
  assert.match(out, /timed out/i)
  assert.match(out, /retry once/i)
  assert.match(out, /smaller\/simpler arguments/i, "should suggest narrowing when args are present")
  assert.match(out, /skip this tool/i)
  // Original error preserved for debugging
  assert.match(out, /> 30000ms/)
})

test("timeout error without args omits the narrowing hint", () => {
  const out = enhanceMcpError("MCP timeout: call fs/list > 30000ms", route, {})
  assert.match(out, /timed out/i)
  assert.match(out, /retry once/i)
  assert.doesNotMatch(out, /smaller\/simpler arguments/,
    "should not suggest narrowing when there are no args to narrow")
})

test("abort error tells the LLM NOT to retry automatically", () => {
  const out = enhanceMcpError("MCP call aborted: fs/read_file", route, {})
  assert.match(out, /cancelled/i)
  assert.match(out, /do not retry automatically/i,
    "abort usually means user clicked stop — auto-retry would be wrong")
  assert.match(out, /wait for the user/i)
})

test("disconnect error hints at transient restart", () => {
  const out = enhanceMcpError("MCP server fs not connected (status: disconnected)", route, {})
  assert.match(out, /unavailable right now/i)
  assert.match(out, /wait a moment and retry/i)
  assert.match(out, /different tool/i)
})

test("connection-closed mid-call surfaces transient-restart hint", () => {
  const out = enhanceMcpError("Connection closed", route, {})
  assert.match(out, /unavailable right now/i)
  assert.match(out, /restarting/i)
})

test("'not found' error explains it's a config issue, not transient", () => {
  const out = enhanceMcpError("MCP server git not found", { serverName: "git", toolName: "commit" }, {})
  assert.match(out, /config/i)
  assert.match(out, /check the mcp panel/i)
})

test("capability-gating error tells LLM to pick a different tool", () => {
  const out = enhanceMcpError(
    "MCP server fs does not advertise the resources capability",
    route,
    {},
  )
  assert.match(out, /different tool/i)
})

test("unknown error is prefixed with the server/tool context for unambiguous attribution", () => {
  const out = enhanceMcpError("something completely unexpected happened", route, {})
  assert.match(out, /MCP fs\/read_file failed/i,
    "must include server/tool so multi-server setups can attribute the failure")
  assert.match(out, /something completely unexpected happened/)
})

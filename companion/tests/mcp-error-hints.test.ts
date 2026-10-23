// enhanceMcpError unit tests (audit item 18)
//
// The LLM uses the error string returned from executeMcpTool to decide what
// to do next. Bare "MCP call failed: MCP timeout" gives it no signal — it
// defaults to identical retry. enhanceMcpError wraps each known failure mode
// with an actionable hint.

import test from "node:test"
import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { enhanceMcpError } from "../src/server.js"
import { classifyError } from "../src/security.js"
import { McpClient } from "../src/mcp/client.js"
import { getMcpManager } from "../src/mcp/manager.js"
import { bindMcpDispatchRuntime, executeMcpTool } from "../src/mcp/dispatch.js"
import { WebSocket } from "ws"

const route = { serverName: "fs", toolName: "read_file" }

// Trace 6p34pu: edit_file searched for PLACEHOLDER_NOT_EXIST while fixing report layout.
// The server correctly rejected the edit; the agent loop incorrectly halted the whole turn.
// Attribution: invalid model arguments + missing application recovery classification.
// Protect: re-read and correct a patch, preserving exact-match and authorization checks.
test("edit mismatch carries a recoverable code even when oldText contains error keywords", () => {
  for (const oldText of ["PLACEHOLDER_NOT_EXIST", "Security Block: denied", "MCP timeout", "ENOENT", "Connection Closed"]) {
    const editRoute = { serverName: "custom-fs", toolName: "edit_file" }
    const raw = `MCP custom-fs/edit_file returned error: Could not find exact match for edit:\n${oldText}`
    const out = enhanceMcpError(raw, editRoute, { path: "/report.html" })
    assert.match(out, /^MCP_EDIT_MATCH_NOT_FOUND:/)
    assert.match(out, /read.*file/i)
    assert.match(out, /oldText/)
    assert.match(out, /do not retry.*unchanged/i)
    assert.ok(out.includes(raw), "preserve the original error")
    // Unit-level code/registry contract; the live test below verifies dispatch
    // supplies the typed code. The message alone is not the classifier contract.
    const error_code = /^([A-Z][A-Z0-9_]+):/.exec(out)?.[1]
    assert.equal(classifyError(out, { toolName: "mcp__custom-fs__edit_file", error_code }), "recoverable")
  }
})

test("edit recovery does not relabel unrelated tool errors or access denials", () => {
  const mismatch = "Could not find exact match for edit:\nPLACEHOLDER_NOT_EXIST"
  assert.doesNotMatch(enhanceMcpError(mismatch, route, {}), /^MCP_EDIT_MATCH_NOT_FOUND:/)
  const out = enhanceMcpError(
    `Access denied: ${mismatch}`, { serverName: "fs", toolName: "edit_file" }, {},
  )
  assert.doesNotMatch(out, /^MCP_EDIT_MATCH_NOT_FOUND:/)
  assert.match(out, /denied path access/)
})

test("real filesystem rejects a multi-edit placeholder atomically, then accepts a corrected patch", { timeout: 15000 }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cmspark-edit-match-"))
  const file = path.join(root, "report.html")
  const original = "<h1>Report</h1>\n<p>Original</p>\n"
  fs.writeFileSync(file, original)
  const client = new McpClient("filesystem", {
    transport: "stdio", command: process.execPath,
    args: [require.resolve("@modelcontextprotocol/server-filesystem/dist/index.js"), root],
    enabled: true, trust_level: "trusted",
  })
  const manager: any = getMcpManager()
  const previousConfig = manager.currentConfig
  let prompts = 0
  try {
    await client.connect()
    manager.clients.set(client.name, client)
    manager.currentConfig = { enabled: true, servers: { [client.name]: client.config } }
    manager.reaggregate()
    bindMcpDispatchRuntime({
      getThreadManager: () => null,
      securityConfirmations: { request: async () => { prompts++; return { approved: true } } } as any,
      broadcastToClients() {},
    })
    const call = (name: string, args: any) => executeMcpTool(`mcp__filesystem__${name}`, args, "edit-regression", { readyState: WebSocket.OPEN } as WebSocket, Date.now())
    const result = await call("edit_file", { path: file, edits: [
      { oldText: "<h1>Report</h1>", newText: "<h1>Changed</h1>" },
      { oldText: "PLACEHOLDER_NOT_EXIST", newText: "replacement" },
    ] })
    assert.equal(result.success, false)
    assert.equal(fs.readFileSync(file, "utf8"), original, "failed batch must not partially write")
    assert.equal(result.error_code, "MCP_EDIT_MATCH_NOT_FOUND")
    assert.equal(classifyError(result.error!, { toolName: "mcp__filesystem__edit_file", error_code: result.error_code }), "recoverable")
    assert.match(result.error!, /Could not find exact match for edit:\nPLACEHOLDER_NOT_EXIST/)
    const read = await call("read_file", { path: file })
    assert.equal(read.success, true)
    assert.ok(JSON.stringify(read.data).includes("Original"))
    const corrected = await call("edit_file", { path: file, edits: [{ oldText: "Original", newText: "Corrected" }] })
    assert.equal(corrected.success, true, corrected.error)
    assert.equal(prompts, 2, "both failed and corrected edits still require write confirmation")
    assert.equal(fs.readFileSync(file, "utf8"), original.replace("Original", "Corrected"))
  } finally {
    bindMcpDispatchRuntime(null)
    manager.clients.delete(client.name)
    manager.currentConfig = previousConfig
    manager.reaggregate()
    await client.close()
    fs.rmSync(root, { recursive: true, force: true })
  }
})

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

test("parent directory missing suggests create_directory stepwise (thread 6zhrh6)", () => {
  const out = enhanceMcpError(
    "MCP filesystem/create_directory returned error: Parent directory does not exist: /Users/huchen/中国量子计算_report",
    { serverName: "filesystem", toolName: "create_directory" },
    { path: "/Users/huchen/中国量子计算_report/chapters" },
  )
  assert.match(out, /parent directory does not exist/i)
  assert.match(out, /create parent|create_directory|ensure_project_dir/i)
})

test("ENOENT on read tool does not push mkdir guidance", () => {
  const out = enhanceMcpError(
    "ENOENT: no such file or directory",
    { serverName: "filesystem", toolName: "read_text_file" },
    { path: "/Users/huchen/missing.txt" },
  )
  assert.match(out, /not found|Underlying/i)
  assert.doesNotMatch(out, /create parent folders first with create_directory/)
})

test("allowlist denial points user to MCP panel / three-flag cruise (not god-mode)", () => {
  const out = enhanceMcpError(
    "Access denied - path outside allowed directories: /secret",
    { serverName: "filesystem", toolName: "write_file" },
    { path: "/secret/x" },
  )
  assert.match(out, /allowlist|allow paths|MCP/i)
  // Product copy: three-flag cruise auto-expands allow-dirs; do not tell users "god-mode".
  assert.match(out, /three-flag cruise|三旗|cruise/i)
  assert.doesNotMatch(out, /god-mode/i)
})

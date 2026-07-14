// PR-B: config.set must re-nest flattened security fields the extension UI sends.
//
// The extension's LLMConfig flattens `security.allow_all_schemes` (GOD-MODE) and
// `security.auto_approve_dangerous` to the top level (see chrome-extension
// useWebSocket.ts normalizeConfig). handleSave() posts the whole flattened object
// as { type: "config.set", config }. The companion's config.set handler must re-nest
// these under `security.*` before saveConfig, otherwise the god-mode UI toggle is a
// no-op (allow_all_schemes is silently dropped and never reaches the L1/L2 gates).
//
// This test exercises the routing → saveConfig path directly with the flattened shape.

import "./_config-router-setup" // MUST be first — pins DATA_DIR before config import.

import test, { before } from "node:test"
import * as assert from "node:assert/strict"

let handleMessage: typeof import("../src/message-router").handleMessage
let getConfig: typeof import("../src/config").getConfig
let saveConfig: typeof import("../src/config").saveConfig
let replaceMcpServers: typeof import("../src/config").replaceMcpServers
let initDataDir: typeof import("../src/config").initDataDir

before(async () => {
  const mr = await import("../src/message-router")
  const cfg = await import("../src/config")
  handleMessage = mr.handleMessage
  getConfig = cfg.getConfig
  saveConfig = cfg.saveConfig
  replaceMcpServers = cfg.replaceMcpServers
  initDataDir = cfg.initDataDir
  await initDataDir()
  // Start from a clean, god-mode-off baseline so each assertion is unambiguous.
  saveConfig({ security: { ...getConfig().security, auto_approve_dangerous: false, allow_all_schemes: false } })
})

async function postConfigSet(config: Record<string, unknown>) {
  return handleMessage({ type: "config.set", config } as any, {} as any)
}

test("config.set: flat allow_all_schemes=true is nested under security.*", async () => {
  // Simulate the extension UI posting a flattened config with god-mode armed.
  const r: any = await postConfigSet({ allow_all_schemes: true })
  assert.equal(r.type, "config.updated")
  assert.equal(getConfig().security.allow_all_schemes, true, "god-mode must persist to security.allow_all_schemes")
})

test("config.set: flat allow_all_schemes=false disarms god-mode", async () => {
  saveConfig({ security: { ...getConfig().security, auto_approve_dangerous: false, allow_all_schemes: true } })
  assert.equal(getConfig().security.allow_all_schemes, true)
  await postConfigSet({ allow_all_schemes: false })
  assert.equal(getConfig().security.allow_all_schemes, false, "flat false must disarm god-mode")
})

test("config.set: both flat allow_all_schemes + auto_approve_dangerous nest together", async () => {
  // handleSave posts the entire LLMConfig at once — both flattened security fields
  // arrive in the same message. Both must land in security.* without clobbering each other.
  const r: any = await postConfigSet({ allow_all_schemes: true, auto_approve_dangerous: true })
  assert.equal(r.type, "config.updated")
  const sec = getConfig().security
  assert.equal(sec.allow_all_schemes, true, "allow_all_schemes must nest alongside auto_approve_dangerous")
  assert.equal(sec.auto_approve_dangerous, true, "auto_approve_dangerous must nest alongside allow_all_schemes")
})

test("config.set: arming god-mode alone does not wipe the existing auto_approve_dangerous value", async () => {
  // deepMerge contract: a flattened god-mode toggle must preserve the partner security
  // field's current value (it spreads current.security before applying the new key).
  saveConfig({ security: { ...getConfig().security, auto_approve_dangerous: true, allow_all_schemes: false } })
  await postConfigSet({ allow_all_schemes: true })
  const sec = getConfig().security
  assert.equal(sec.allow_all_schemes, true)
  assert.equal(sec.auto_approve_dangerous, true, "partner field preserved when only allow_all_schemes sent")
})

test("config.set: nested security object still passes through (direct security.allow_all_schemes)", async () => {
  // Non-UI callers (e.g. config.json migration / settings-cli) may send a nested
  // security object. That path must keep working unchanged, AND must preserve the
  // partner field (auto_approve_dangerous) via deepMerge.
  saveConfig({ security: { ...getConfig().security, auto_approve_dangerous: true, allow_all_schemes: false } })
  const r: any = await postConfigSet({ security: { allow_all_schemes: true } })
  assert.equal(r.type, "config.updated")
  const sec = getConfig().security
  assert.equal(sec.allow_all_schemes, true)
  assert.equal(sec.auto_approve_dangerous, true, "nested path must also preserve partner field via deepMerge")
})

// --- audit L1: prototype-pollution value check removal + key guard remains ---

test("config.set: string value 'prototype' is allowed (value is not a pollution key)", async () => {
  const r: any = await postConfigSet({ llm: { model_name: "prototype" } })
  assert.equal(r.type, "config.updated")
  assert.equal(getConfig().llm.model_name, "prototype")
})

test("config.set: __proto__ key is still rejected as prototype pollution", async () => {
  // JSON.parse makes __proto__ an own enumerable property — the realistic attack vector.
  const r: any = await postConfigSet(JSON.parse('{ "llm": { "__proto__": { "polluted": true } } }'))
  assert.equal(r.type, "error")
  assert.equal(r.error, "Invalid config keys detected")
})

test("mcp.update: command value 'prototype' is allowed (key-level guard remains)", async () => {
  // Seed an MCP server so mcp.update has a target.
  const add: any = await handleMessage({
    type: "mcp.add",
    name: "proto-value-test",
    server: { command: "node", args: ["server.js"], transport: "stdio", trust_level: "manual" },
  } as any, {} as any)
  assert.equal(add.type, "mcp.servers.updated", `expected add to succeed, got: ${add.error || JSON.stringify(add)}`)

  const r: any = await handleMessage({
    type: "mcp.update",
    name: "proto-value-test",
    patch: { command: "prototype" },
  } as any, {} as any)
  assert.equal(r.type, "mcp.servers.updated", `expected update to succeed, got: ${r.error || JSON.stringify(r)}`)
  const updatedServer = getConfig().mcp?.servers?.["proto-value-test"] as import("../src/mcp/types").McpStdioServerConfig
  assert.equal(updatedServer?.command, "prototype")
})

test("mcp.update: __proto__ key is still rejected as prototype pollution", async () => {
  const r: any = await handleMessage({
    type: "mcp.update",
    name: "proto-value-test",
    patch: JSON.parse('{ "__proto__": { "polluted": true } }'),
  } as any, {} as any)
  assert.equal(r.type, "error")
  assert.equal(r.error, "Invalid config keys detected")
})

// --- mcp.add auto-enable regression ---
// Default config ships with `mcp.enabled: false`, and replaceMcpServers preserves
// the existing flag. Without the auto-enable in mcp.add, a user's first server add
// would leave the global kill-switch off — the server card shows "未连接" forever
// because McpManager.start() bails on enabled=false. The UI has no global toggle
// to recover (mcp.toggle_enabled handler exists but pre-fix no component dispatched it).

test("mcp.add: first server auto-flips mcp.enabled false → true", async () => {
  // Use replaceMcpServers (not saveConfig) to clear the servers map — deepMerge
  // would preserve existing server keys since {} has no keys to overwrite.
  replaceMcpServers({})
  saveConfig({ mcp: { enabled: false, servers: getConfig().mcp?.servers ?? {} } })
  assert.equal(getConfig().mcp?.enabled, false)
  assert.equal(Object.keys(getConfig().mcp?.servers || {}).length, 0)

  const r: any = await handleMessage({
    type: "mcp.add",
    name: "auto-enable-fixture",
    server: { command: "node", args: ["server.js"], transport: "stdio", trust_level: "manual" },
  } as any, {} as any)
  assert.equal(r.type, "mcp.servers.updated")
  assert.equal(getConfig().mcp?.enabled, true, "first server add must auto-enable the global kill-switch")
})

test("mcp.add: adding a second server does not re-trigger auto-enable (already enabled)", async () => {
  replaceMcpServers({ "seed-server": { transport: "stdio", command: "node", args: [], enabled: true, trust_level: "manual" } as any })
  saveConfig({ mcp: { enabled: true, servers: getConfig().mcp?.servers ?? {} } })
  const before = getConfig().mcp?.enabled
  await handleMessage({
    type: "mcp.add",
    name: "second-server-fixture",
    server: { command: "node", args: ["server.js"], transport: "stdio", trust_level: "manual" },
  } as any, {} as any)
  assert.equal(getConfig().mcp?.enabled, before, "auto-enable must only fire on the 0→1 server transition")
})

test("mcp.add: adding to non-empty server map does NOT silently re-enable a user-disabled MCP", async () => {
  // User explicitly disabled MCP globally (e.g. via the UI toggle) but kept configured
  // servers. Editing/adding another server must not undo that choice.
  replaceMcpServers({ "kept-server": { transport: "stdio", command: "node", args: [], enabled: true, trust_level: "manual" } as any })
  saveConfig({ mcp: { enabled: false, servers: getConfig().mcp?.servers ?? {} } })
  assert.equal(Object.keys(getConfig().mcp?.servers || {}).length, 1)
  await handleMessage({
    type: "mcp.add",
    name: "extra-server-fixture",
    server: { command: "node", args: ["server.js"], transport: "stdio", trust_level: "manual" },
  } as any, {} as any)
  assert.equal(getConfig().mcp?.enabled, false, "explicit user disable must survive a non-first server add")
})

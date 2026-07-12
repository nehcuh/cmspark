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
let initDataDir: typeof import("../src/config").initDataDir

before(async () => {
  const mr = await import("../src/message-router")
  const cfg = await import("../src/config")
  handleMessage = mr.handleMessage
  getConfig = cfg.getConfig
  saveConfig = cfg.saveConfig
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

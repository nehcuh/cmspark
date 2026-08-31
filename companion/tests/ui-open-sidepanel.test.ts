/**
 * Slice #241 Task 4 — ui.open_sidepanel protocol.
 * W3 (F2): true result round-trip — tray origin broadcast carries a
 * correlation id; the extension SW replies ui.open_sidepanel.result
 * {id, ok, error?}; the handler awaits it (timeout = honest failure).
 *
 * Tray origin (cmspark-tray://local, surface !== summoner) → id-addressed
 * broadcast to the extension SW. Never SUMMONER_ALLOW / HTML dispatch /
 * overlay SSE. Companion never calls chrome.sidePanel.open / openSidePanel(.
 */
import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"

import {
  handleUiOpenSidepanel,
  handleUiOpenSidepanelResult,
} from "../src/message-router/handlers/ui-open-sidepanel"
import { SUMMONER_WEB_DISPATCH_ALLOW, SUMMONER_WEB_EVENT_ALLOW } from "../src/summoner-web"
import { assertSummonerAllowed } from "../src/ws/summoner-acl"
import { validateWsMessage } from "../src/ws/validate"
import { getToolDefinitions } from "../src/bridge/tool-definitions"

const ROOT = path.resolve(__dirname, "..", "..")

function srcFile(...parts: string[]): string {
  const candidates = [
    path.join(ROOT, "src", ...parts),
    path.join(__dirname, "..", "src", ...parts),
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  return candidates[0]
}

function traySession(seen: Record<string, unknown>[]) {
  return {
    origin: "cmspark-tray://local",
    surface: "tray",
    broadcast: (d: Record<string, unknown>) => seen.push(d),
  }
}

/** Extension SW peer: the only source allowed to settle a result waiter (R4). */
function panelSession() {
  return { origin: "chrome-extension://abcdefghijklmnopabcdefghijklmnop", surface: "panel" }
}

test("not on summoner allow or HTML dispatch", () => {
  assert.equal(assertSummonerAllowed("summoner", "ui.open_sidepanel").ok, false)
  assert.equal(assertSummonerAllowed("summoner", "ui.open_sidepanel.result").ok, false)
  assert.equal(SUMMONER_WEB_DISPATCH_ALLOW.has("ui.open_sidepanel"), false)
  assert.equal(SUMMONER_WEB_EVENT_ALLOW.has("ui.open_sidepanel"), false)
})

test("forged payload origin ignored; id-addressed broadcast; ok result resolves opened", async () => {
  const seen: Record<string, unknown>[] = []
  const p = handleUiOpenSidepanel(
    { origin: "chrome-extension://forged" },
    traySession(seen),
  )
  await new Promise((r) => setImmediate(r))
  assert.equal(seen.length, 1)
  assert.equal(seen[0]!.type, "ui.open_sidepanel")
  const id = seen[0]!.id
  assert.equal(typeof id, "string")
  handleUiOpenSidepanelResult({ id, ok: true }, panelSession())
  const r = await p
  assert.equal(r.type, "ui.open_sidepanel.opened")
})

test("extension failure result propagates as UI_OPEN_SIDEPANEL_FAILED", async () => {
  const seen: Record<string, unknown>[] = []
  const p = handleUiOpenSidepanel({}, traySession(seen))
  await new Promise((r) => setImmediate(r))
  handleUiOpenSidepanelResult({ id: seen[0]!.id, ok: false, error: "sidePanel.open requires a user gesture" }, panelSession())
  const r = await p
  assert.equal(r.type, "error")
  assert.equal(r.error_code, "UI_OPEN_SIDEPANEL_FAILED")
  assert.equal(r.error, "sidePanel.open requires a user gesture")
})

test("result timeout is an honest UI_OPEN_SIDEPANEL_TIMEOUT failure", async () => {
  const seen: Record<string, unknown>[] = []
  const r = await handleUiOpenSidepanel({}, traySession(seen), 20)
  assert.equal(seen.length, 1)
  assert.equal(r.type, "error")
  assert.equal(r.error_code, "UI_OPEN_SIDEPANEL_TIMEOUT")
})

test("late/unknown result ids are dropped without throwing", async () => {
  const seen: Record<string, unknown>[] = []
  const p = handleUiOpenSidepanel({}, traySession(seen), 20)
  await new Promise((r) => setImmediate(r))
  assert.deepEqual(handleUiOpenSidepanelResult({ id: "uosp-unknown", ok: true }, panelSession()), { type: "ok" })
  const r = await p
  assert.equal(r.error_code, "UI_OPEN_SIDEPANEL_TIMEOUT")
  // late frame for the expired id must not resolve anything
  assert.deepEqual(handleUiOpenSidepanelResult({ id: seen[0]!.id, ok: true }, panelSession()), { type: "ok" })
})

test("R4 origin binding: result frames from non-extension peers are dropped", async () => {
  for (const peer of [
    undefined,
    { origin: "cmspark-tray://local", surface: "tray" },
    { origin: "http://localhost:18989", surface: "summoner" },
  ]) {
    const seen: Record<string, unknown>[] = []
    const p = handleUiOpenSidepanel({}, traySession(seen), 20)
    await new Promise((r) => setImmediate(r))
    // forged result from a non-extension peer: accepted at the seam, never settles
    assert.deepEqual(handleUiOpenSidepanelResult({ id: seen[0]!.id, ok: true }, peer), { type: "ok" })
    const r = await p
    assert.equal(r.error_code, "UI_OPEN_SIDEPANEL_TIMEOUT", "forged result must not settle the waiter")
  }
})

test("R4 origin binding: chrome-extension origin without panel surface also settles", async () => {
  const seen: Record<string, unknown>[] = []
  const p = handleUiOpenSidepanel({}, traySession(seen))
  await new Promise((r) => setImmediate(r))
  handleUiOpenSidepanelResult(
    { id: seen[0]!.id, ok: true },
    { origin: "chrome-extension://abcdefghijklmnopabcdefghijklmnop" },
  )
  const r = await p
  assert.equal(r.type, "ui.open_sidepanel.opened")
})

test("R4 race: ok:false result settles FAILED; a late timer tick cannot flip it to TIMEOUT", async () => {
  const seen: Record<string, unknown>[] = []
  const p = handleUiOpenSidepanel({}, traySession(seen), 30)
  await new Promise((r) => setImmediate(r))
  const id = seen[0]!.id
  handleUiOpenSidepanelResult({ id, ok: false, error: "gesture required" }, panelSession())
  const r = await p
  assert.equal(r.error_code, "UI_OPEN_SIDEPANEL_FAILED")
  assert.equal(r.error, "gesture required")
  // let the (cleared) timer window elapse; a duplicate/late frame stays inert
  await new Promise((res) => setTimeout(res, 60))
  assert.deepEqual(handleUiOpenSidepanelResult({ id, ok: true }, panelSession()), { type: "ok" })
  const r2 = await p
  assert.equal(r2.error_code, "UI_OPEN_SIDEPANEL_FAILED")
})

test("R4 race: timeout settles first; a late ok result cannot reopen the waiter", async () => {
  const seen: Record<string, unknown>[] = []
  const p = handleUiOpenSidepanel({}, traySession(seen), 20)
  const r = await p
  assert.equal(r.error_code, "UI_OPEN_SIDEPANEL_TIMEOUT")
  handleUiOpenSidepanelResult({ id: seen[0]!.id, ok: true }, panelSession())
  const r2 = await p
  assert.equal(r2.error_code, "UI_OPEN_SIDEPANEL_TIMEOUT")
})

test("summoner surface denied", async () => {
  const r = await handleUiOpenSidepanel({}, { origin: "cmspark-tray://local", surface: "summoner", broadcast() {} })
  assert.equal(r.error_code, "SUMMONER_ACL")
})

test("extension origin denied (this type is tray→companion)", async () => {
  const r = await handleUiOpenSidepanel({}, { origin: "chrome-extension://abcd", surface: undefined, broadcast() {} })
  assert.equal(r.error_code, "UI_OPEN_SIDEPANEL_ORIGIN")
})

test("handler without broadcast returns UI_OPEN_SIDEPANEL_UNAVAILABLE", async () => {
  const r = await handleUiOpenSidepanel(
    {},
    { origin: "cmspark-tray://local", surface: "tray" },
  )
  assert.equal(r.type, "error")
  assert.equal(r.error_code, "UI_OPEN_SIDEPANEL_UNAVAILABLE")
})

test("validate ui.open_sidepanel has no required fields", () => {
  assert.equal(validateWsMessage({ type: "ui.open_sidepanel" }).valid, true)
})

test("validate ui.open_sidepanel.result requires id + ok boolean", () => {
  assert.equal(validateWsMessage({ type: "ui.open_sidepanel.result" }).valid, false)
  assert.equal(validateWsMessage({ type: "ui.open_sidepanel.result", id: "uosp-x" }).valid, false)
  assert.equal(validateWsMessage({ type: "ui.open_sidepanel.result", id: "uosp-x", ok: "yes" }).valid, false)
  assert.equal(validateWsMessage({ type: "ui.open_sidepanel.result", id: "uosp-x", ok: true }).valid, true)
  assert.equal(
    validateWsMessage({ type: "ui.open_sidepanel.result", id: "uosp-x", ok: false, error: "boom" }).valid,
    true,
  )
  assert.equal(
    validateWsMessage({ type: "ui.open_sidepanel.result", id: "uosp-x", ok: false, error: 42 }).valid,
    false,
  )
})

test("broadcast carries correlation id and no token", async () => {
  const seen: Record<string, unknown>[] = []
  const p = handleUiOpenSidepanel(
    { id: "rpc-1", token: "nope" },
    traySession(seen),
  )
  await new Promise((r) => setImmediate(r))
  assert.equal(seen.length, 1)
  const id = seen[0]!.id
  assert.equal(typeof id, "string")
  assert.match(id as string, /^uosp-/)
  assert.notEqual(id, "rpc-1")
  assert.equal("token" in seen[0]!, false)
  assert.deepEqual(Object.keys(seen[0]!).sort(), ["id", "type"])
  handleUiOpenSidepanelResult({ id, ok: true }, panelSession())
  await p
})

test("F-I-4: handler and summoner-web never call chrome.sidePanel.open / openSidePanel(", () => {
  const handler = fs.readFileSync(srcFile("message-router", "handlers", "ui-open-sidepanel.ts"), "utf8")
  const web = fs.readFileSync(srcFile("summoner-web.ts"), "utf8")
  assert.doesNotMatch(handler, /openSidePanel\(/)
  assert.doesNotMatch(handler, /chrome\.sidePanel\.open/)
  assert.doesNotMatch(web, /openSidePanel\(/)
  assert.doesNotMatch(web, /chrome\.sidePanel\.open/)
  assert.doesNotMatch(web, /ui\.open_sidepanel/)
  // Keep the timeout timer ref'd under node:test (same pin as extension-peer).
  assert.match(handler, /NODE_TEST_CONTEXT/)
  assert.match(handler, /\.unref/)
})

test("ui.open_sidepanel is not a tool catalog / getToolDefinitions type", () => {
  const catalog = fs.readFileSync(srcFile("bridge", "tool-definitions-catalog.json"), "utf8")
  const defs = fs.readFileSync(srcFile("bridge", "tool-definitions.ts"), "utf8")
  assert.doesNotMatch(catalog, /ui\.open_sidepanel/)
  assert.doesNotMatch(defs, /ui\.open_sidepanel/)
  for (const t of getToolDefinitions()) {
    assert.notEqual(t.function.name, "ui.open_sidepanel")
  }
})

test("menu-bar-agent operate inject uses sendAppRequest and ignores broadcast echo", () => {
  const src = fs.readFileSync(srcFile("menu-bar-agent.ts"), "utf8")
  assert.match(src, /requestOpenSidePanel/)
  const inject = src.indexOf("requestOpenSidePanel")
  assert.ok(inject >= 0, "requestOpenSidePanel missing")
  const hunk = src.slice(inject, inject + 900)
  assert.match(hunk, /sendAppRequest/)
  assert.doesNotMatch(hunk, /openSidePanel\(/)
  assert.doesNotMatch(hunk, /chrome\.sidePanel\.open/)
  const companionStart = src.indexOf("companionClient.onAppMessage")
  assert.ok(companionStart >= 0, "companionClient.onAppMessage missing")
  const companionBlock = src.slice(companionStart, src.indexOf("summonerClient = new CompanionClient"))
  assert.match(companionBlock, /ui\.open_sidepanel/)
  assert.match(companionBlock, /msg\.type !== ["']ui\.open_sidepanel["']/)
})

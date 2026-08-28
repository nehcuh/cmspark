/**
 * Slice #241 Task 4 — ui.open_sidepanel protocol.
 *
 * Tray origin (cmspark-tray://local, surface !== summoner) → no-id broadcast
 * to the extension SW. Never SUMMONER_ALLOW / HTML dispatch / overlay SSE.
 * Companion never calls chrome.sidePanel.open / openSidePanel(.
 */
import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"

import { handleUiOpenSidepanel } from "../src/message-router/handlers/ui-open-sidepanel"
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

test("not on summoner allow or HTML dispatch", () => {
  assert.equal(assertSummonerAllowed("summoner", "ui.open_sidepanel").ok, false)
  assert.equal(SUMMONER_WEB_DISPATCH_ALLOW.has("ui.open_sidepanel"), false)
  assert.equal(SUMMONER_WEB_EVENT_ALLOW.has("ui.open_sidepanel"), false)
})

test("forged payload origin ignored; session.origin must be tray", async () => {
  const seen: unknown[] = []
  const r = await handleUiOpenSidepanel(
    { origin: "chrome-extension://forged" },
    { origin: "cmspark-tray://local", surface: "tray", broadcast: (d: Record<string, unknown>) => seen.push(d) },
  )
  assert.equal(r.type, "ui.open_sidepanel.accepted")
  assert.deepEqual(seen[0], { type: "ui.open_sidepanel" })
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

test("broadcast has no id and no token", async () => {
  const seen: Record<string, unknown>[] = []
  await handleUiOpenSidepanel(
    { id: "rpc-1", token: "nope" },
    { origin: "cmspark-tray://local", surface: "tray", broadcast: (d: Record<string, unknown>) => seen.push(d) },
  )
  assert.equal(seen.length, 1)
  assert.equal("id" in seen[0]!, false)
  assert.equal("token" in seen[0]!, false)
  assert.deepEqual(Object.keys(seen[0]!).sort(), ["type"])
})

test("F-I-4: handler and summoner-web never call chrome.sidePanel.open / openSidePanel(", () => {
  const handler = fs.readFileSync(srcFile("message-router", "handlers", "ui-open-sidepanel.ts"), "utf8")
  const web = fs.readFileSync(srcFile("summoner-web.ts"), "utf8")
  assert.doesNotMatch(handler, /openSidePanel\(/)
  assert.doesNotMatch(handler, /chrome\.sidePanel\.open/)
  assert.doesNotMatch(web, /openSidePanel\(/)
  assert.doesNotMatch(web, /chrome\.sidePanel\.open/)
  assert.doesNotMatch(web, /ui\.open_sidepanel/)
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

test("menu-bar-agent operate inject uses sendAppRequest and ignores no-id echo", () => {
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

/**
 * Slice #239 Task 4 — overlay.shell.open protocol.
 *
 * Extension-origin WS → no-id broadcast → tray companionClient opens HTML.
 * Never SUMMONER_ALLOW / WEB dispatch / WEB event. Never sidePanel.open.
 */
import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"

import {
  SUMMONER_WEB_DISPATCH_ALLOW,
  SUMMONER_WEB_EVENT_ALLOW,
} from "../src/summoner-web"

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

test("overlay.shell.open is NOT on SUMMONER_ALLOW", () => {
  const acl = fs.readFileSync(srcFile("ws", "summoner-acl.ts"), "utf8")
  assert.doesNotMatch(acl, /overlay\.shell\.open/)
})

test("assertSummonerAllowed denies overlay.shell.open", () => {
  const { assertSummonerAllowed } = require("../src/ws/summoner-acl")
  const r = assertSummonerAllowed("summoner", "overlay.shell.open")
  assert.equal(r.ok, false)
  assert.equal(r.error_code, "SUMMONER_ACL")
})

test("validate overlay.shell.open requires thread_id", () => {
  const { validateWsMessage } = require("../src/ws/validate")
  assert.equal(validateWsMessage({ type: "overlay.shell.open" }).valid, false)
  assert.equal(validateWsMessage({ type: "overlay.shell.open", thread_id: "abc123" }).valid, true)
})

test("handler rejects tray origin even if payload.origin is forged", async () => {
  const { handleOverlayShellOpen } = require("../src/message-router/handlers/overlay-shell")
  const r = await handleOverlayShellOpen(
    { thread_id: "abc123", origin: "chrome-extension://forged" },
    { origin: "cmspark-tray://local", surface: "tray", broadcast: () => {} },
  )
  assert.equal(r.type, "error")
})

test("ACL / C-thin / SSE have no tab or dock verbs", () => {
  const acl = fs.readFileSync(srcFile("ws", "summoner-acl.ts"), "utf8")
  const web = fs.readFileSync(srcFile("summoner-web.ts"), "utf8")
  for (const s of [acl, web]) {
    assert.doesNotMatch(s, /list_tabs/)
    assert.doesNotMatch(s, /ui\.dock/)
    assert.doesNotMatch(s, /ui\.open_sidepanel/)
  }
  assert.doesNotMatch(acl, /overlay\.shell\.open/)
})

test("new overlay-shell handler never sidePanel.open", () => {
  const src = fs.readFileSync(srcFile("message-router", "handlers", "overlay-shell.ts"), "utf8")
  assert.doesNotMatch(src, /sidePanel\.open/)
})

test("handler with chrome-extension origin broadcasts type+thread_id without id and returns accepted", async () => {
  const { handleOverlayShellOpen } = require("../src/message-router/handlers/overlay-shell")
  const sent: Record<string, unknown>[] = []
  const r = await handleOverlayShellOpen(
    { thread_id: "abc123", origin: "cmspark-tray://forged", id: "rpc-1" },
    {
      origin: "chrome-extension://abcdefghijklmnopqrstuvwxyzabcdef",
      broadcast: (p: Record<string, unknown>) => sent.push(p),
    },
  )
  assert.equal(r.type, "overlay.shell.accepted")
  assert.notEqual(r.type, "overlay.shell.opened")
  assert.equal(sent.length, 1)
  assert.equal(sent[0].type, "overlay.shell.open")
  assert.equal(sent[0].thread_id, "abc123")
  assert.equal("id" in sent[0], false)
  assert.deepEqual(Object.keys(sent[0]).sort(), ["thread_id", "type"])
})

test("handler without broadcast returns OVERLAY_SHELL_UNAVAILABLE", async () => {
  const { handleOverlayShellOpen } = require("../src/message-router/handlers/overlay-shell")
  const r = await handleOverlayShellOpen(
    { thread_id: "abc123" },
    { origin: "chrome-extension://abcdefghijklmnopqrstuvwxyzabcdef" },
  )
  assert.equal(r.type, "error")
  assert.equal(r.error_code, "OVERLAY_SHELL_UNAVAILABLE")
})

test("summoner-web boot prefers query thread over unconditional threads[0]", () => {
  const web = fs.readFileSync(srcFile("summoner-web.ts"), "utf8")
  const boot = web.slice(web.lastIndexOf("setExpanded(true);"))
  assert.match(web, /\[?&\]thread=/)
  assert.match(boot, /selectThread\(wanted\)|selectThread\(decodeURIComponent\(wanted\)\)|thread=/)
  assert.doesNotMatch(
    boot,
    /refresh\(\)\.then\(function\(\)\{\s*if\(threads\[0\]\) return selectThread\(threads\[0\]\.id\);/,
  )
})

test("overlay.shell.open stays off summoner web dispatch and SSE allow", () => {
  assert.equal(SUMMONER_WEB_DISPATCH_ALLOW.has("overlay.shell.open"), false)
  assert.equal(SUMMONER_WEB_EVENT_ALLOW.has("overlay.shell.open"), false)
  const web = fs.readFileSync(srcFile("summoner-web.ts"), "utf8")
  const dispatch = web.slice(
    web.indexOf("export const SUMMONER_WEB_DISPATCH_ALLOW"),
    web.indexOf("export const SUMMONER_WEB_EVENT_ALLOW"),
  )
  const events = web.slice(
    web.indexOf("export const SUMMONER_WEB_EVENT_ALLOW"),
    web.indexOf("export type SummonerWebDispatch"),
  )
  assert.doesNotMatch(dispatch, /overlay\.shell\.open/)
  assert.doesNotMatch(events, /overlay\.shell\.open/)
})

test("tray companionClient opens overlay.shell.open; summonerClient does not", () => {
  const src = fs.readFileSync(srcFile("menu-bar-agent.ts"), "utf8")
  const fn = src.slice(src.indexOf("function reportOverlayShellUnavailable"), src.indexOf("async function handleAction"))
  assert.match(fn, /"&thread=" \+ encodeURIComponent\(threadId\)/)
  assert.match(fn, /if\s*\(\s*threadId\s*\)/)
  assert.doesNotMatch(
    fn,
    /openLoopbackPage\(summonerWebPageUrl\(port, token\) \+ "&thread=" \+ encodeURIComponent\(threadId\)\)/,
  )
  const opened = fn.indexOf("openLoopbackPage")
  const success = fn.indexOf("已在浏览器打开召唤器")
  assert.ok(opened >= 0 && success > opened, "success notify must follow openLoopbackPage")
  assert.match(fn, /if\s*\(\s*!/)
  assert.match(fn, /打开召唤器失败/)
  assert.match(fn, /sendAppMessage\(\s*["']error["']/)
  assert.match(fn, /OVERLAY_SHELL_UNAVAILABLE/)
  assert.match(fn, /无法弹出对话框/)
  const fail = fn.indexOf("if (!opened)")
  const report = fn.indexOf("reportOverlayShellUnavailable()", fail)
  assert.ok(fail >= 0 && report > fail, "openLoopbackPage false must send OVERLAY_SHELL_UNAVAILABLE")
  const companionStart = src.indexOf("companionClient.onAppMessage")
  assert.ok(companionStart >= 0, "companionClient.onAppMessage missing")
  const companionBlock = src.slice(companionStart, src.indexOf("summonerClient = new CompanionClient"))
  assert.match(companionBlock, /overlay\.shell\.open/)
  assert.match(companionBlock, /openSummonerWebShell/)
  const summonerStart = src.indexOf("summonerClient.onAppMessage")
  assert.ok(summonerStart >= 0, "summonerClient.onAppMessage missing")
  const summonerBlock = src.slice(summonerStart, src.indexOf("summonerClient.connect"))
  assert.doesNotMatch(summonerBlock, /openSummonerWebShell/)
  assert.doesNotMatch(summonerBlock, /overlay\.shell\.open/)
})

test("lifecycle relays tray OVERLAY_SHELL_ error to authenticated clients", () => {
  const src = fs.readFileSync(srcFile("ws", "lifecycle.ts"), "utf8")
  assert.match(src, /msg\??\.type === ["']error["']/)
  assert.match(src, /OVERLAY_SHELL_/)
  assert.match(src, /auth\?\.surface === ["']tray["']/)
  assert.match(src, /broadcastToClients/)
})

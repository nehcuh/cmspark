/**
 * Task 8 — tray-side summoner streaming client helpers.
 *
 * Pure module so we don't boot menu-bar. WS fire-and-forget is covered in
 * companion-client-auth.test.ts (sendChatCreate).
 */
import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"
import {
  CONTINUE_MESSAGE,
  ATTACH_NOTIFY_COPY,
  filterThreadsByTitle,
  mapChatMessageToSummonerCmd,
  attachChromeOnly,
  buildContinueChatCreate,
} from "../src/summoner/client"
import { SUMMONER_SEARCH_HINT } from "../src/summoner/protocol"

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

const THREADS = [
  { id: "old", title: "Old notes", alias: "notes", updated_at: "2026-08-01T00:00:00Z" },
  { id: "mid", title: "Browser tab", alias: "chrome-debug", updated_at: "2026-08-10T00:00:00Z" },
  { id: "new", title: "Latest", alias: "today", updated_at: "2026-08-20T12:00:00Z", created_at: "2026-08-19T00:00:00Z" },
]

test("CONTINUE_MESSAGE is the exact non-retry user line", () => {
  assert.equal(
    CONTINUE_MESSAGE,
    "浏览器已连接。请等待我的下一条指令；不要重试刚才失败的网页操作。",
  )
})

test("buildContinueChatCreate uses CONTINUE_MESSAGE and the given thread", () => {
  assert.deepEqual(buildContinueChatCreate("thr-1"), {
    thread_id: "thr-1",
    message: CONTINUE_MESSAGE,
  })
})

test("ATTACH_NOTIFY_COPY tells the user we cannot open the side panel", () => {
  assert.match(ATTACH_NOTIFY_COPY, /我们不能替你打开侧栏/)
})

test("filterThreadsByTitle empty query returns the most recent thread", () => {
  const r = filterThreadsByTitle(THREADS, "")
  assert.equal(r.searchHint, "P0 不搜正文")
  assert.equal(r.searchHint, SUMMONER_SEARCH_HINT)
  assert.equal(r.matches.length, 1)
  assert.equal(r.matches[0].id, "new")
})

test("filterThreadsByTitle whitespace query is treated as empty (last thread)", () => {
  const r = filterThreadsByTitle(THREADS, "   ")
  assert.equal(r.matches.length, 1)
  assert.equal(r.matches[0].id, "new")
})

test("filterThreadsByTitle matches title or alias includes query", () => {
  const byTitle = filterThreadsByTitle(THREADS, "Browser")
  assert.deepEqual(byTitle.matches.map((t) => t.id), ["mid"])
  assert.equal(byTitle.searchHint, "P0 不搜正文")

  const byAlias = filterThreadsByTitle(THREADS, "notes")
  assert.deepEqual(byAlias.matches.map((t) => t.id), ["old"])
})

test("filterThreadsByTitle empty-state copy is P0 不搜正文 even with no matches", () => {
  const r = filterThreadsByTitle(THREADS, "zzzz-no-such")
  assert.deepEqual(r.matches, [])
  assert.equal(r.searchHint, "P0 不搜正文")
})

test("filterThreadsByTitle empty list + empty query yields no match + hint", () => {
  const r = filterThreadsByTitle([], "")
  assert.deepEqual(r.matches, [])
  assert.equal(r.searchHint, "P0 不搜正文")
})

test("mapChatMessageToSummonerCmd: chat.token → summoner.token", () => {
  const cmd = mapChatMessageToSummonerCmd({ type: "chat.token", thread_id: "t", content: "hello" })
  assert.deepEqual(cmd, { cmd: "summoner.token", text: "hello" })
})

test("mapChatMessageToSummonerCmd: chat.done → summoner.done", () => {
  const cmd = mapChatMessageToSummonerCmd({ type: "chat.done", thread_id: "t", message_id: "m1" })
  assert.deepEqual(cmd, { cmd: "summoner.done" })
})

test("mapChatMessageToSummonerCmd: chat.error passes error_code", () => {
  const fromData = mapChatMessageToSummonerCmd({
    type: "chat.error",
    thread_id: "t",
    error: "composer is on the other surface",
    data: { error_code: "OVERLAY_STANDBY", holder: "panel" },
  })
  assert.deepEqual(fromData, {
    cmd: "summoner.error",
    message: "composer is on the other surface",
    error_code: "OVERLAY_STANDBY",
  })

  const fromTop = mapChatMessageToSummonerCmd({
    type: "chat.error",
    error: "BROWSER_UNAVAILABLE: Chrome not connected",
    error_code: "BROWSER_UNAVAILABLE",
  })
  assert.equal(fromTop?.cmd, "summoner.error")
  if (fromTop?.cmd === "summoner.error") {
    assert.equal(fromTop.error_code, "BROWSER_UNAVAILABLE")
  }
})

test("mapChatMessageToSummonerCmd ignores unrelated / confirm frames", () => {
  assert.equal(mapChatMessageToSummonerCmd({ type: "thread.list" }), null)
  assert.equal(mapChatMessageToSummonerCmd({ cmd: "summoner.confirm.allow" }), null)
  assert.equal(mapChatMessageToSummonerCmd(null), null)
})

test("attachChromeOnly calls openChrome and never openSidePanel", () => {
  const calls: string[] = []
  const opener = {
    openChrome: () => { calls.push("openChrome") },
    openSidePanel: () => { calls.push("openSidePanel") },
  }
  const copy = attachChromeOnly(opener)
  assert.deepEqual(calls, ["openChrome"])
  assert.match(copy, /我们不能替你打开侧栏/)
})

test("menu-bar-agent constructs a second CompanionClient with surface=summoner", () => {
  const src = fs.readFileSync(srcFile("menu-bar-agent.ts"), "utf8")
  assert.match(src, /surface:\s*"summoner"/)
  assert.match(src, /sendChatCreate/)
  assert.match(src, /mapChatMessageToSummonerCmd/)
})

test("menu-bar-agent attach path uses openChrome, not openSidePanel", () => {
  const src = fs.readFileSync(srcFile("menu-bar-agent.ts"), "utf8")
  assert.match(src, /attachChromeOnly|getChromeOpener\(\)\.openChrome\(\)/)
  // The summoner attach handler must not open the side panel.
  const attachBlock = src.includes("handleSummonerAttach")
    ? src.slice(src.indexOf("handleSummonerAttach"), src.indexOf("handleSummonerAttach") + 800)
    : src
  assert.equal(
    /handleSummonerAttach[\s\S]{0,800}openSidePanel/.test(src) && attachBlock.includes("openSidePanel"),
    false,
  )
})

test("CompanionClient.sendChatCreate is fire-and-forget (no sendRequest)", () => {
  const src = fs.readFileSync(srcFile("tray", "companion-client.ts"), "utf8")
  const start = src.indexOf("sendChatCreate(")
  assert.ok(start >= 0)
  const next = src.indexOf("\n  async executeQuickAction", start)
  const method = src.slice(start, next > start ? next : start + 280)
  assert.match(method, /sendAppMessage/)
  assert.doesNotMatch(method, /sendRequest/)
})

/**
 * User-journey protocol tests for the OS summoner overlay (no Swift UI runner).
 */
import test from "node:test"
import assert from "node:assert/strict"
import {
  isSummonerSearchQuery,
  summonerSearchNeedle,
  submitSummonerTalk,
  summonerBrowserBadge,
  filterThreadsByTitle,
  resolveSummonerOpenTarget,
  shouldStartNewSummonerThread,
  hitsFromTitleSearch,
  summonerHitsFromQuery,
} from "../src/summoner/client"
import { acceptedSummonerHotkey, summonerHotkeyPickerRows } from "../src/summoner/hotkey"
import { isVoiceSttOriginAllowed } from "../src/voice/stt-handlers"
import { assertSummonerAllowed } from "../src/ws/summoner-acl"

const THREADS = [
  { id: "old", title: "旧笔记", created_at: "2026-08-01T00:00:00Z", last_message_at: "2026-08-01T00:00:00Z" },
  { id: "new", title: "投研纪要", created_at: "2026-08-20T12:00:00Z", last_message_at: "2026-08-20T12:00:00Z" },
]

test("first-open badge is probing, not 未连接", () => {
  assert.equal(summonerBrowserBadge({ known: false, attached: false }), "检测浏览器…")
  assert.equal(summonerBrowserBadge({ known: false, attached: true }), "检测浏览器…")
  assert.equal(summonerBrowserBadge({ known: true, attached: true }), "浏览器已连接")
  assert.equal(summonerBrowserBadge({ known: true, attached: false }), "浏览器未连接")
})

test("first open resumes newest thread; missing last_activity does not create", () => {
  assert.equal(
    shouldStartNewSummonerThread({ now: Date.now(), lastActivityAt: null, resumeIdleMinutes: 10 }),
    false,
  )
  assert.deepEqual(
    resolveSummonerOpenTarget({ forceNew: false, lastThreadId: null, threads: THREADS }),
    { action: "hydrate", threadId: "new" },
  )
})

test("# search hits carry id/title/when from thread.list, not a 5-item tray cache", () => {
  const cmd = summonerHitsFromQuery(THREADS, "#投研")
  assert.equal(cmd.cmd, "summoner.hits")
  assert.deepEqual(cmd.hits, [{ id: "new", title: "投研纪要", when: "2026-08-20T12:00:00Z" }])
  assert.deepEqual(
    hitsFromTitleSearch(filterThreadsByTitle(THREADS, "旧").matches),
    [{ id: "old", title: "旧笔记", when: "2026-08-01T00:00:00Z" }],
  )
})

test("empty-state send claims overlay lease then chat.create (detached L0)", async () => {
  const calls: string[] = []
  const r = await submitSummonerTalk("", "先说一句", {
    listThreads: async () => THREADS,
    createThread: async () => {
      calls.push("create")
      return { id: "x" }
    },
    claimLease: async (id) => {
      calls.push(`claim:${id}`)
    },
    sendChatCreate: ({ thread_id, message }) => {
      calls.push(`chat:${thread_id}:${message}`)
      return true
    },
  })
  assert.equal(r.ok, true)
  assert.equal(r.threadId, "new")
  assert.deepEqual(calls, ["claim:new", "chat:new:先说一句"])
})

test("empty # query yields zero hits (does not steal newest thread)", () => {
  assert.deepEqual(summonerHitsFromQuery(THREADS, "#").hits, [])
  assert.deepEqual(summonerHitsFromQuery(THREADS, "#   ").hits, [])
  assert.deepEqual(summonerHitsFromQuery(THREADS, "").hits, [])
})

test("# prefix is title search only; body-like queries do not search", () => {
  assert.equal(isSummonerSearchQuery("投研纪要"), false)
  assert.equal(isSummonerSearchQuery("#投研"), true)
  assert.equal(summonerSearchNeedle("#投研"), "投研")
  const hits = filterThreadsByTitle(THREADS, summonerSearchNeedle("#投研"))
  assert.deepEqual(hits.matches.map((t) => t.id), ["new"])
  assert.equal(hits.searchHint, "只搜标题，不搜正文")
  assert.equal(filterThreadsByTitle(THREADS, "纪要正文里没有的句子").matches.length, 0)
})

test("hotkey occupied defaults are listed but never accepted", () => {
  const occupied = summonerHotkeyPickerRows().filter((r) => !r.selectable)
  assert.ok(occupied.length >= 3)
  for (const raw of ["Cmd+Space", "⌥Space", "Ctrl+Shift+Space"]) {
    assert.equal(acceptedSummonerHotkey(raw), null, raw)
  }
})

test("STT origin: summoner tray allowed; tray menus and voice.model denied", () => {
  assert.equal(isVoiceSttOriginAllowed("cmspark-tray://local", "summoner"), true)
  assert.equal(isVoiceSttOriginAllowed("cmspark-tray://local", "tray"), false)
  assert.equal(assertSummonerAllowed("summoner", "voice.stt.start").ok, true)
  assert.equal(assertSummonerAllowed("summoner", "voice.model.download").ok, false)
})

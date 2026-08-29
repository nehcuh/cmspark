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
  ATTACH_SILENT_COPY,
  SUMMONER_CDP_NEEDED,
  SUMMONER_L0_CHROME_DOWN,
  SUMMONER_RENTER_CHROME_DOWN,
  filterThreadsByTitle,
  forwardCompanionUiRect,
  mapChatMessageToSummonerCmd,
  overlayAssistantSnapshot,
  mapVoiceSttToSummonerCmd,
  micWavToSttFrames,
  micWavTooShort,
  resolveSummonerSttModelId,
  sendMicWavToStt,
  attachChromeOnly,
  buildContinueChatCreate,
  shouldStartNewSummonerThread,
  normalizeResumeIdleMinutes,
  summonerBrowserBadge,
  summonerCmdMatchesThread,
  resolveSummonerOpenTarget,
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

test("Capture L0 copy: keep chatting; Operate is open the side panel", () => {
  assert.match(SUMMONER_L0_CHROME_DOWN, /可以继续聊/)
  assert.match(SUMMONER_L0_CHROME_DOWN, /打开侧栏/)
  assert.doesNotMatch(SUMMONER_L0_CHROME_DOWN, /需要打开浏览器/)
  assert.match(SUMMONER_CDP_NEEDED, /打开侧栏/)
  assert.match(SUMMONER_RENTER_CHROME_DOWN, /打开侧栏/)
  const html = fs.readFileSync(srcFile("summoner-web.ts"), "utf8")
  assert.match(html, /id="operateOpen"/)
})

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
  assert.match(ATTACH_NOTIFY_COPY, /我们不能替你打开侧栏。要盯着页面，请点工具栏的 CMspark。/)
  assert.doesNotMatch(ATTACH_NOTIFY_COPY, /侧栏批准|去侧栏/)
})

test("ATTACH_SILENT_COPY uses the same honesty footnote", () => {
  assert.match(ATTACH_SILENT_COPY, /我们不能替你打开侧栏。要盯着页面，请点工具栏的 CMspark。/)
  assert.doesNotMatch(ATTACH_SILENT_COPY, /侧栏批准|去侧栏|openSidePanel/)
})

test("filterThreadsByTitle empty query returns the most recent thread", () => {
  const r = filterThreadsByTitle(THREADS, "")
  assert.equal(r.searchHint, SUMMONER_SEARCH_HINT)
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
  assert.equal(byTitle.searchHint, SUMMONER_SEARCH_HINT)

  const byAlias = filterThreadsByTitle(THREADS, "notes")
  assert.deepEqual(byAlias.matches.map((t) => t.id), ["old"])
})

test("filterThreadsByTitle empty-state copy is title-only hint even with no matches", () => {
  const r = filterThreadsByTitle(THREADS, "zzzz-no-such")
  assert.deepEqual(r.matches, [])
  assert.equal(r.searchHint, SUMMONER_SEARCH_HINT)
})

test("filterThreadsByTitle empty list + empty query yields no match + hint", () => {
  const r = filterThreadsByTitle([], "")
  assert.deepEqual(r.matches, [])
  assert.equal(r.searchHint, SUMMONER_SEARCH_HINT)
})

test("overlayAssistantSnapshot replaces accumulated chat.token instead of concatenating", () => {
  const a = overlayAssistantSnapshot([], "Hello")
  assert.deepEqual(a, ["助手: Hello"])
  const b = overlayAssistantSnapshot(a, "Hello world")
  assert.deepEqual(b, ["助手: Hello world"])
  const c = overlayAssistantSnapshot(["你: hi", "助手: He"], "Hello\n\n- item")
  assert.deepEqual(c, ["你: hi", "助手: Hello\n\n- item"])
})

// Semantics change: token/done cmds now carry thread_id (they used to drop
// it) so the Node forwarder and the Swift overlay can filter cross-thread
// stream frames.
test("mapChatMessageToSummonerCmd: chat.token → summoner.token keeps thread_id", () => {
  const cmd = mapChatMessageToSummonerCmd({ type: "chat.token", thread_id: "t", content: "hello" })
  assert.deepEqual(cmd, { cmd: "summoner.token", text: "hello", thread_id: "t" })
})

test("mapChatMessageToSummonerCmd: chat.done → summoner.done keeps thread_id", () => {
  const cmd = mapChatMessageToSummonerCmd({ type: "chat.done", thread_id: "t", message_id: "m1" })
  assert.deepEqual(cmd, { cmd: "summoner.done", thread_id: "t" })
})

test("mapChatMessageToSummonerCmd: frames without thread_id stay untagged", () => {
  assert.deepEqual(mapChatMessageToSummonerCmd({ type: "chat.token", content: "x" }), {
    cmd: "summoner.token",
    text: "x",
  })
  assert.deepEqual(mapChatMessageToSummonerCmd({ type: "chat.done" }), { cmd: "summoner.done" })
})

test("summonerCmdMatchesThread drops tagged cmds for other threads, passes untagged", () => {
  assert.equal(summonerCmdMatchesThread({ thread_id: "a" }, "a"), true)
  assert.equal(summonerCmdMatchesThread({ thread_id: "a" }, "b"), false)
  assert.equal(summonerCmdMatchesThread({ thread_id: "a" }, null), false)
  assert.equal(summonerCmdMatchesThread({}, null), true)
  assert.equal(summonerCmdMatchesThread({}, "a"), true)
})

test("forwardCompanionUiRect: pairing/tray/hud ride the tray socket, never the summoner socket", () => {
  const sent: string[] = []
  const clients = (summonerOk: boolean, companionOk: boolean) => ({
    summoner: {
      sendAppMessage: (type: string) => {
        sent.push(`summoner:${type}`)
        return summonerOk
      },
    },
    companion: {
      sendAppMessage: (type: string) => {
        sent.push(`companion:${type}`)
        return companionOk
      },
    },
  })
  // Tray.swift's native windows are dropped by the daemon's summoner-surface
  // allowSurfaces=["overlay"] gate — they must go over the tray socket.
  sent.length = 0
  assert.equal(
    forwardCompanionUiRect({ type: "companion.ui.rect", surface: "hud", x: 0, y: 0 }, clients(true, true)),
    true,
  )
  assert.deepEqual(sent, ["companion:companion.ui.rect"])
  // …even when the tray socket is down (summoner would silently drop it)
  sent.length = 0
  assert.equal(
    forwardCompanionUiRect({ type: "companion.ui.rect", surface: "pairing" }, clients(true, false)),
    false,
  )
  assert.deepEqual(sent, ["companion:companion.ui.rect"]) // no summoner attempt
  // overlay prefers the summoner socket (its ACL gate allows surface=overlay)
  sent.length = 0
  assert.equal(
    forwardCompanionUiRect({ type: "companion.ui.rect", surface: "overlay", x: 1, y: 2 }, clients(true, true)),
    true,
  )
  assert.deepEqual(sent, ["summoner:companion.ui.rect"])
  // overlay falls back to the tray socket when the summoner socket is down
  sent.length = 0
  assert.equal(
    forwardCompanionUiRect({ type: "companion.ui.rect", surface: "overlay" }, clients(false, true)),
    true,
  )
  assert.deepEqual(sent, ["summoner:companion.ui.rect", "companion:companion.ui.rect"])
})

test("mapChatMessageToSummonerCmd: tool.start → summoner.tool", () => {
  const cmd = mapChatMessageToSummonerCmd({
    type: "tool.start",
    tool_name: "mcp__filesystem__read_text_file",
  })
  assert.deepEqual(cmd, { cmd: "summoner.tool", name: "mcp__filesystem__read_text_file" })
})

test("mapChatMessageToSummonerCmd: chat.enqueued and run_active become summoner.error", () => {
  const queued = mapChatMessageToSummonerCmd({
    type: "chat.enqueued",
    thread_id: "t",
    queue: "next_run",
    depth: 2,
  })
  assert.equal(queued?.cmd, "summoner.error")
  if (queued?.cmd === "summoner.error") {
    assert.equal(queued.error_code, "enqueued")
    assert.match(queued.message, /已排队/)
  }
  const active = mapChatMessageToSummonerCmd({ type: "error", error: "run_active", thread_id: "t" })
  assert.equal(active?.cmd, "summoner.error")
  if (active?.cmd === "summoner.error") {
    assert.equal(active.error_code, "run_active")
  }
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

test("resolveSummonerSttModelId uses preferred only when ready, else first ready fallback", () => {
  assert.equal(resolveSummonerSttModelId("small", ["medium", "large-v3-turbo"]), "medium")
  assert.equal(resolveSummonerSttModelId("small", ["small", "medium"]), "small")
  assert.equal(resolveSummonerSttModelId("medium", ["large-v3-turbo"]), "large-v3-turbo")
  assert.equal(resolveSummonerSttModelId("nope", []), null)
  assert.equal(resolveSummonerSttModelId(undefined, ["large-v3-turbo"]), "large-v3-turbo")
})

test("micWavTooShort rejects header-only WAV (click with no speech)", () => {
  // 44-byte empty PCM WAV header, base64.
  const headerOnly = Buffer.alloc(44).toString("base64")
  assert.equal(micWavTooShort(headerOnly), true)
  const halfSecond = Buffer.alloc(44 + 16000).toString("base64")
  assert.equal(micWavTooShort(halfSecond), false)
})

test("sendMicWavToStt does not send chunk/end when start fails", async () => {
  const sent: string[] = []
  const result = await sendMicWavToStt({
    sessionId: "summoner-mic-1",
    modelId: "medium",
    data: Buffer.alloc(44 + 16000).toString("base64"),
    transport: {
      start: async () => {
        sent.push("start")
        return { ok: false, code: "model_missing", message: "model not ready" }
      },
      chunk: () => { sent.push("chunk") },
      end: () => { sent.push("end") },
    },
  })
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.code, "model_missing")
  assert.deepEqual(sent, ["start"])
})

test("sendMicWavToStt skips STT entirely for too-short wav", async () => {
  const sent: string[] = []
  const result = await sendMicWavToStt({
    sessionId: "summoner-mic-1",
    modelId: "medium",
    data: Buffer.alloc(44).toString("base64"),
    transport: {
      start: async () => { sent.push("start"); return { ok: true } },
      chunk: () => { sent.push("chunk") },
      end: () => { sent.push("end") },
    },
  })
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.code, "too_short")
  assert.deepEqual(sent, [])
})

test("mapVoiceSttToSummonerCmd rewrites session_unknown / model_missing to Chinese", () => {
  const unknown = mapVoiceSttToSummonerCmd({
    type: "voice.stt.error",
    code: "session_unknown",
    message: "no matching session",
  })
  assert.equal(unknown?.cmd, "summoner.error")
  if (unknown?.cmd === "summoner.error") {
    assert.notEqual(unknown.message, "no matching session")
    assert.match(unknown.message, /听写|会话/)
  }
  const missing = mapVoiceSttToSummonerCmd({
    type: "voice.stt.error",
    code: "model_missing",
    message: "model not ready",
  })
  assert.equal(missing?.cmd, "summoner.error")
  if (missing?.cmd === "summoner.error") {
    assert.match(missing.message, /Whisper|模型/)
  }
})

test("micWavToSttFrames emits start/chunk/end with privacy_ack_v2", () => {
  const frames = micWavToSttFrames({
    sessionId: "summoner-mic-1",
    modelId: "medium",
    data: "UklGRg==",
  })
  assert.equal(frames.length, 3)
  assert.deepEqual(frames[0], {
    type: "voice.stt.start",
    v: 1,
    sessionId: "summoner-mic-1",
    modelId: "medium",
    format: "wav",
    sampleRate: 16000,
    channels: 1,
    privacy_ack_v2: true,
  })
  assert.deepEqual(frames[1], {
    type: "voice.stt.chunk",
    v: 1,
    sessionId: "summoner-mic-1",
    seq: 0,
    data: "UklGRg==",
  })
  assert.deepEqual(frames[2], {
    type: "voice.stt.end",
    v: 1,
    sessionId: "summoner-mic-1",
    totalSeq: 1,
  })
})

test("mapVoiceSttToSummonerCmd result fills composer via dictate", () => {
  assert.deepEqual(
    mapVoiceSttToSummonerCmd({ type: "voice.stt.result", sessionId: "s", text: "听写稿", v: 1 }),
    { cmd: "summoner.dictate", text: "听写稿" },
  )
  assert.equal(mapVoiceSttToSummonerCmd({ type: "voice.stt.partial", status: "receiving" }), null)
  assert.equal(mapVoiceSttToSummonerCmd({ type: "chat.token", content: "x" }), null)
})

test("mapChatMessageToSummonerCmd: file.upload_error → summoner.error", () => {
  const cmd = mapChatMessageToSummonerCmd({
    type: "file.upload_error",
    thread_id: "t",
    error: "每个文件需要 name, type, content 字段",
  })
  assert.equal(cmd?.cmd, "summoner.error")
  if (cmd?.cmd === "summoner.error") {
    assert.equal(cmd.error_code, "upload_failed")
    assert.match(cmd.message, /每个文件需要 name, type, content 字段/)
    assert.equal(cmd.thread_id, "t")
  }
  assert.equal(mapChatMessageToSummonerCmd({ type: "file.uploaded", thread_id: "t", files: ["a.txt"] }), null)
})

test("mapChatMessageToSummonerCmd ignores unrelated / confirm frames", () => {
  assert.equal(mapChatMessageToSummonerCmd({ type: "thread.list" }), null)
  assert.equal(mapChatMessageToSummonerCmd({ cmd: "summoner.confirm.allow" }), null)
  assert.equal(mapChatMessageToSummonerCmd(null), null)
})

test("shouldStartNewSummonerThread: 0 always new, -1 always resume, 10min idle", () => {
  assert.equal(normalizeResumeIdleMinutes(99), 10)
  assert.equal(normalizeResumeIdleMinutes(-1), -1)
  assert.equal(shouldStartNewSummonerThread({
    now: 1_000_000,
    lastActivityAt: 900_000,
    resumeIdleMinutes: 0,
  }), true)
  assert.equal(shouldStartNewSummonerThread({
    now: 1_000_000,
    lastActivityAt: 1,
    resumeIdleMinutes: -1,
  }), false)
  assert.equal(shouldStartNewSummonerThread({
    now: 10 * 60_000,
    lastActivityAt: 0,
    resumeIdleMinutes: 10,
  }), true)
  assert.equal(shouldStartNewSummonerThread({
    now: 9 * 60_000,
    lastActivityAt: 0,
    resumeIdleMinutes: 10,
  }), false)
  assert.equal(shouldStartNewSummonerThread({
    now: 1,
    lastActivityAt: null,
    resumeIdleMinutes: 10,
  }), false)
  assert.equal(shouldStartNewSummonerThread({
    now: 1,
    lastActivityAt: undefined,
    resumeIdleMinutes: 10,
  }), false)
})

test("resolveSummonerOpenTarget hydrates last or newest; create only if empty or forceNew", () => {
  assert.deepEqual(
    resolveSummonerOpenTarget({ forceNew: true, lastThreadId: "old", threads: THREADS }),
    { action: "create" },
  )
  assert.deepEqual(
    resolveSummonerOpenTarget({ forceNew: false, lastThreadId: "old", threads: THREADS }),
    { action: "hydrate", threadId: "old" },
  )
  assert.deepEqual(
    resolveSummonerOpenTarget({ forceNew: false, lastThreadId: "ghost", threads: THREADS }),
    { action: "hydrate", threadId: "new" },
  )
  assert.deepEqual(
    resolveSummonerOpenTarget({ forceNew: false, lastThreadId: null, threads: THREADS }),
    { action: "hydrate", threadId: "new" },
  )
  assert.deepEqual(
    resolveSummonerOpenTarget({ forceNew: false, lastThreadId: null, threads: [] }),
    { action: "create" },
  )
})

test("attachChromeOnly silent by default, foreground opt-in, never openSidePanel", () => {
  const calls: string[] = []
  const opener = {
    openChrome: () => { calls.push("openChrome") },
    openChromeSilent: () => { calls.push("openChromeSilent") },
    openSidePanel: () => { calls.push("openSidePanel") },
  }
  const silent = attachChromeOnly(opener)
  assert.deepEqual(calls, ["openChromeSilent"])
  assert.match(silent, /我们不能替你打开侧栏/)
  calls.length = 0
  const front = attachChromeOnly(opener, { foreground: true })
  assert.deepEqual(calls, ["openChrome"])
  assert.match(front, /我们不能替你打开侧栏/)
})

test("menu-bar-agent constructs a second CompanionClient with surface=summoner", () => {
  const src = fs.readFileSync(srcFile("menu-bar-agent.ts"), "utf8")
  assert.match(src, /surface:\s*"summoner"/)
  assert.match(src, /sendChatCreate/)
  assert.match(src, /mapChatMessageToSummonerCmd/)
})

test("menu-bar-agent attach path uses openChrome, not openSidePanel", () => {
  const src = fs.readFileSync(srcFile("menu-bar-agent.ts"), "utf8")
  assert.match(src, /attachChromeOnly/)
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
  const next = src.indexOf("\n  sendSteer", start)
  const method = src.slice(start, next > start ? next : start + 280)
  assert.match(method, /sendAppMessage/)
  assert.doesNotMatch(method, /sendRequest/)
})

test("summonerBrowserBadge stays probing until hydrate known", () => {
  assert.equal(summonerBrowserBadge({ known: false, attached: false }), "检测浏览器…")
  assert.doesNotMatch(summonerBrowserBadge({ known: false, attached: false }), /未连接/)
})

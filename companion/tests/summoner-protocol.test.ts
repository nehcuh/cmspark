import test from "node:test"
import assert from "node:assert/strict"
import {
  SUMMONER_SEARCH_HINT,
  encodeSummonerOpen,
  encodeSummonerClose,
  encodeSummonerHydrate,
  encodeSummonerToken,
  encodeSummonerDone,
  encodeSummonerError,
  encodeSummonerHotkeyPrompt,
  encodeSummonerHotkeySet,
  encodeSummonerReady,
  encodeSummonerClosed,
  encodeSummonerSubmit,
  encodeSummonerSearch,
  encodeSummonerHits,
  encodeSummonerSelect,
  encodeSummonerAttachChrome,
  encodeSummonerContinue,
  encodeSummonerHotkeyChosen,
  encodeSummonerComposing,
  encodeSummonerDictate,
  encodeSummonerMicStart,
  encodeSummonerMicChunk,
  encodeSummonerMicEnd,
  encodeSummonerMicWav,
  encodeSummonerNewThread,
  encodeSummonerFiles,
  encodeSummonerSettings,
  encodeSummonerSettingsSet,
  encodeSummonerTool,
  encodeSummonerMcp,
  summonerLine,
  parseSummonerLine,
  decodeSummonerOutbound,
  decodeSummonerInbound,
  isSummonerConfirmDialect,
} from "../src/summoner/protocol"

function roundTripOutbound(msg: object) {
  const line = summonerLine(msg as never)
  const parsed = parseSummonerLine(line)
  const decoded = decodeSummonerOutbound(parsed)
  assert.deepEqual(decoded, msg)
  // decode also accepts the JSON line and the typed object
  assert.deepEqual(decodeSummonerOutbound(line), msg)
  assert.deepEqual(decodeSummonerOutbound(msg), msg)
}

function roundTripInbound(msg: object) {
  const line = summonerLine(msg as never)
  const parsed = parseSummonerLine(line)
  const decoded = decodeSummonerInbound(parsed)
  assert.deepEqual(decoded, msg)
  assert.deepEqual(decodeSummonerInbound(line), msg)
  assert.deepEqual(decodeSummonerInbound(msg), msg)
}

test("round-trip summoner.open", () => {
  const msg = encodeSummonerOpen({ thread_id: "thr-open-1" })
  assert.equal(msg.cmd, "summoner.open")
  assert.equal(msg.thread_id, "thr-open-1")
  roundTripOutbound(msg)
})

test("round-trip summoner.hydrate", () => {
  const msg = encodeSummonerHydrate({
    thread_id: "thr-hyd-1",
    lines: ["你: hello", "助手: world"],
    browser: "attached",
    search_hint: SUMMONER_SEARCH_HINT,
  })
  assert.equal(msg.cmd, "summoner.hydrate")
  assert.equal(msg.browser, "attached")
  assert.equal(msg.search_hint, SUMMONER_SEARCH_HINT)
  assert.deepEqual(msg.lines, ["你: hello", "助手: world"])
  roundTripOutbound(msg)

  const detached = encodeSummonerHydrate({
    thread_id: "thr-hyd-2",
    lines: [],
    browser: "detached",
    search_hint: SUMMONER_SEARCH_HINT,
  })
  roundTripOutbound(detached)
})

test("round-trip summoner.hits and summoner.select", () => {
  const hits = encodeSummonerHits({
    hits: [
      { id: "t1", title: "投研纪要 · 宁德时代", when: "2026-08-20T12:00:00Z" },
      { id: "t2", title: "年报对比", when: "2026-08-17T00:00:00Z" },
    ],
  })
  assert.equal(hits.cmd, "summoner.hits")
  assert.equal(hits.hits.length, 2)
  roundTripOutbound(hits)
  const sel = encodeSummonerSelect({ thread_id: "t1" })
  assert.equal(sel.type, "summoner.select")
  assert.equal(sel.thread_id, "t1")
  roundTripInbound(sel)
  assert.equal(decodeSummonerOutbound({ cmd: "summoner.hits" }), null)
  assert.equal(decodeSummonerOutbound({ cmd: "summoner.hits", hits: [{ id: "x" }] }), null)
  assert.equal(decodeSummonerInbound({ type: "summoner.select" }), null)
})

test("round-trip summoner.submit", () => {
  const msg = encodeSummonerSubmit({ thread_id: "thr-sub-1", text: "继续刚才的问题" })
  assert.equal(msg.type, "summoner.submit")
  assert.equal(msg.thread_id, "thr-sub-1")
  assert.equal(msg.text, "继续刚才的问题")
  roundTripInbound(msg)
})

test("round-trip summoner.attach_chrome", () => {
  const msg = encodeSummonerAttachChrome()
  assert.equal(msg.type, "summoner.attach_chrome")
  roundTripInbound(msg)
  const front = encodeSummonerAttachChrome({ foreground: true })
  assert.equal(front.foreground, true)
  roundTripInbound(front)
})

test("round-trip summoner.tool and summoner.mcp", () => {
  const tool = encodeSummonerTool({ name: "mcp__filesystem__read_text_file" })
  assert.equal(tool.cmd, "summoner.tool")
  roundTripOutbound(tool)
  const mcp = encodeSummonerMcp({ names: ["filesystem"] })
  assert.equal(mcp.cmd, "summoner.mcp")
  roundTripOutbound(mcp)
})

test("round-trip summoner.settings", () => {
  const out = encodeSummonerSettings({ resume_idle_minutes: 10, chrome_foreground: false })
  assert.equal(out.cmd, "summoner.settings")
  roundTripOutbound(out)
  const set = encodeSummonerSettingsSet({ resume_idle_minutes: -1, chrome_foreground: true })
  assert.equal(set.type, "summoner.settings.set")
  roundTripInbound(set)
})

test("round-trip summoner.composing", () => {
  const on = encodeSummonerComposing({ on: true })
  assert.equal(on.type, "summoner.composing")
  assert.equal(on.on, true)
  roundTripInbound(on)

  const off = encodeSummonerComposing({ on: false })
  assert.equal(off.on, false)
  roundTripInbound(off)
})

test("round-trip summoner.dictate fills composer (no auto-submit)", () => {
  const msg = encodeSummonerDictate({ text: "你好世界" })
  assert.equal(msg.cmd, "summoner.dictate")
  assert.equal(msg.text, "你好世界")
  roundTripOutbound(msg)
})

test("round-trip summoner.new_thread", () => {
  const msg = encodeSummonerNewThread()
  assert.equal(msg.type, "summoner.new_thread")
  roundTripInbound(msg)
})

test("round-trip summoner.files", () => {
  const msg = encodeSummonerFiles({
    type: "summoner.files",
    thread_id: "t1",
    files: [{ name: "a.txt", type: "text/plain", content: "YQ==" }],
  })
  roundTripInbound(msg)
  assert.equal(decodeSummonerInbound({ type: "summoner.files", thread_id: "t1", files: [] }), null)
  assert.equal(decodeSummonerInbound({ type: "summoner.files", files: [{ name: "a", content: "YQ==" }] }), null)
})

test("round-trip summoner.mic start/chunk/end/wav", () => {
  roundTripInbound(encodeSummonerMicStart())
  const chunk = encodeSummonerMicChunk({ seq: 0, data: "cGNt" })
  assert.equal(chunk.type, "summoner.mic.chunk")
  assert.equal(chunk.seq, 0)
  roundTripInbound(chunk)
  roundTripInbound(encodeSummonerMicEnd())
  const wav = encodeSummonerMicWav({ data: "UklGRg==" })
  assert.equal(wav.type, "summoner.mic.wav")
  roundTripInbound(wav)
})

test("mic inbound rejects missing/wrong fields", () => {
  assert.equal(decodeSummonerInbound({ type: "summoner.mic.chunk" }), null)
  assert.equal(decodeSummonerInbound({ type: "summoner.mic.chunk", seq: -1, data: "x" }), null)
  assert.equal(decodeSummonerInbound({ type: "summoner.mic.chunk", seq: 0, data: 1 }), null)
  assert.equal(decodeSummonerInbound({ type: "summoner.mic.wav" }), null)
  assert.equal(decodeSummonerInbound({ type: "summoner.mic.wav", data: 1 }), null)
  assert.equal(decodeSummonerOutbound({ cmd: "summoner.dictate" }), null)
  assert.equal(decodeSummonerOutbound({ cmd: "summoner.dictate", text: 1 }), null)
})

test("remaining outbound cmds round-trip", () => {
  roundTripOutbound(encodeSummonerClose())
  roundTripOutbound(encodeSummonerToken({ text: "tok" }))
  roundTripOutbound(encodeSummonerDone())
  roundTripOutbound(encodeSummonerError({ message: "BROWSER_UNAVAILABLE: Chrome extension peer missing" }))
  roundTripOutbound(encodeSummonerError({
    message: "lease lost",
    error_code: "OVERLAY_STANDBY",
  }))
  roundTripOutbound(encodeSummonerHotkeyPrompt())
  roundTripOutbound(encodeSummonerHotkeySet({ combo: "ctrl+alt+space" }))
  roundTripOutbound(encodeSummonerDictate({ text: "filled by STT" }))
})

test("summoner.hotkey.set requires a non-empty combo", () => {
  assert.equal(decodeSummonerOutbound({ cmd: "summoner.hotkey.set" }), null)
  assert.equal(decodeSummonerOutbound({ cmd: "summoner.hotkey.set", combo: "" }), null)
  assert.equal(decodeSummonerOutbound({ cmd: "summoner.hotkey.set", combo: 1 }), null)
})

test("remaining inbound events round-trip", () => {
  roundTripInbound(encodeSummonerReady())
  roundTripInbound(encodeSummonerClosed())
  roundTripInbound(encodeSummonerSearch({ query: "invoice" }))
  roundTripInbound(encodeSummonerSearch({ query: "" }))
  roundTripInbound(encodeSummonerContinue())
  roundTripInbound(encodeSummonerHotkeyChosen({ combo: "Ctrl+Alt+Space" }))
  roundTripInbound(encodeSummonerMicStart())
  roundTripInbound(encodeSummonerMicEnd())
})

test("{ cmd: summoner.confirm.allow } is invalid — no confirm dialect", () => {
  const allow = { cmd: "summoner.confirm.allow" }
  assert.equal(isSummonerConfirmDialect(allow), true)
  assert.equal(decodeSummonerOutbound(allow), null)
  assert.equal(decodeSummonerInbound(allow), null)
  assert.equal(
    decodeSummonerOutbound(parseSummonerLine(JSON.stringify(allow))),
    null,
  )
})

test("any summoner.confirm.* payload is invalid", () => {
  const shapes = [
    { cmd: "summoner.confirm.deny" },
    { cmd: "summoner.confirm.request", id: "c1" },
    { cmd: "summoner.confirm.cancel", id: "c1" },
    { cmd: "summoner.confirm.resolved", id: "c1", outcome: "approved" },
    { type: "summoner.confirm.response", id: "c1", approved: true },
    { type: "summoner.confirm.allow" },
    { type: "summoner.confirm.deny" },
  ]
  for (const raw of shapes) {
    assert.equal(isSummonerConfirmDialect(raw), true, JSON.stringify(raw))
    assert.equal(decodeSummonerOutbound(raw), null, JSON.stringify(raw))
    assert.equal(decodeSummonerInbound(raw), null, JSON.stringify(raw))
  }
})

test("encoded messages never carry Allow/Deny confirm chrome", () => {
  const outbound = [
    encodeSummonerOpen({ thread_id: "t" }),
    encodeSummonerClose(),
    encodeSummonerHydrate({
      thread_id: "t",
      lines: ["你: x"],
      browser: "detached",
      search_hint: SUMMONER_SEARCH_HINT,
    }),
    encodeSummonerToken({ text: "a" }),
    encodeSummonerDone(),
    encodeSummonerError({ message: "e" }),
    encodeSummonerHotkeyPrompt(),
    encodeSummonerHotkeySet({ combo: "ctrl+alt+k" }),
    encodeSummonerDictate({ text: "draft" }),
  ]
  const inbound = [
    encodeSummonerReady(),
    encodeSummonerClosed(),
    encodeSummonerSubmit({ thread_id: "t", text: "hi" }),
    encodeSummonerSearch({ query: "q" }),
    encodeSummonerAttachChrome(),
    encodeSummonerContinue(),
    encodeSummonerHotkeyChosen({ combo: "Ctrl+Shift+D" }),
    encodeSummonerComposing({ on: false }),
    encodeSummonerMicStart(),
    encodeSummonerMicChunk({ seq: 0, data: "AA==" }),
    encodeSummonerMicEnd(),
    encodeSummonerMicWav({ data: "AA==" }),
  ]
  for (const msg of [...outbound, ...inbound]) {
    const blob = JSON.stringify(msg)
    assert.equal(blob.includes("confirm"), false, blob)
    assert.equal(blob.includes("Allow"), false, blob)
    assert.equal(blob.includes("Deny"), false, blob)
    assert.equal("approved" in msg, false, blob)
    assert.equal("pending_confirmations" in msg, false, blob)
    assert.equal(isSummonerConfirmDialect(msg), false, blob)
  }
})

test("hydrate is two-phase capture payload — plaintext lines, no chat bubbles", () => {
  const msg = encodeSummonerHydrate({
    thread_id: "t",
    lines: ["你: 纯文本"],
    browser: "attached",
    search_hint: SUMMONER_SEARCH_HINT,
  })
  assert.equal(Array.isArray(msg.lines), true)
  assert.equal("pending_confirmations" in msg, false)
  assert.equal("shell" in msg, false)
  assert.equal("dual_track" in msg, false)
})

test("parseSummonerLine never throws; invalid JSON is null", () => {
  assert.equal(parseSummonerLine("{not json"), null)
  assert.equal(parseSummonerLine(""), null)
  assert.deepEqual(parseSummonerLine("{\"cmd\":\"summoner.close\"}"), { cmd: "summoner.close" })
})

test("outbound rejects missing/wrong fields", () => {
  assert.equal(decodeSummonerOutbound({ cmd: "summoner.open" }), null)
  assert.equal(decodeSummonerOutbound({ cmd: "summoner.open", thread_id: 1 }), null)
  assert.equal(decodeSummonerOutbound({ cmd: "summoner.token" }), null)
  assert.equal(decodeSummonerOutbound({
    cmd: "summoner.hydrate",
    thread_id: "t",
    lines: ["a"],
    browser: "connected",
    search_hint: SUMMONER_SEARCH_HINT,
  }), null)
  assert.equal(decodeSummonerOutbound({
    cmd: "summoner.hydrate",
    thread_id: "t",
    lines: ["a"],
    browser: "attached",
    search_hint: "search body",
  }), null)
  assert.equal(decodeSummonerOutbound({
    cmd: "summoner.hydrate",
    thread_id: "t",
    lines: [1],
    browser: "attached",
    search_hint: SUMMONER_SEARCH_HINT,
  }), null)
  assert.equal(decodeSummonerOutbound({ cmd: "summoner.error" }), null)
  assert.equal(decodeSummonerOutbound({ cmd: "hud.open", thread_id: "t" }), null)
  assert.equal(decodeSummonerOutbound({ cmd: "summoner.unknown" }), null)
})

test("inbound rejects missing/wrong fields", () => {
  assert.equal(decodeSummonerInbound({ type: "summoner.submit" }), null)
  assert.equal(decodeSummonerInbound({ type: "summoner.submit", thread_id: "t" }), null)
  assert.equal(decodeSummonerInbound({ type: "summoner.submit", thread_id: "t", text: 1 }), null)
  assert.equal(decodeSummonerInbound({ type: "summoner.search" }), null)
  assert.equal(decodeSummonerInbound({ type: "summoner.composing" }), null)
  assert.equal(decodeSummonerInbound({ type: "summoner.composing", on: 1 }), null)
  assert.equal(decodeSummonerInbound({ type: "summoner.hotkey.chosen" }), null)
  assert.equal(decodeSummonerInbound({ type: "hud.ready" }), null)
  assert.equal(decodeSummonerInbound({ type: "summoner.open", thread_id: "t" }), null)
})

test("isSummonerConfirmDialect is false for valid summoner traffic", () => {
  assert.equal(isSummonerConfirmDialect(encodeSummonerOpen({ thread_id: "t" })), false)
  assert.equal(isSummonerConfirmDialect(encodeSummonerSubmit({ thread_id: "t", text: "x" })), false)
  assert.equal(isSummonerConfirmDialect(null), false)
  assert.equal(isSummonerConfirmDialect("summoner.confirm.allow"), false)
})

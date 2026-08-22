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
  encodeSummonerReady,
  encodeSummonerClosed,
  encodeSummonerSubmit,
  encodeSummonerSearch,
  encodeSummonerAttachChrome,
  encodeSummonerContinue,
  encodeSummonerHotkeyChosen,
  encodeSummonerComposing,
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
  assert.equal(msg.search_hint, "P0 不搜正文")
  assert.deepEqual(msg.lines, ["你: hello", "助手: world"])
  roundTripOutbound(msg)

  const detached = encodeSummonerHydrate({
    thread_id: "thr-hyd-2",
    lines: [],
    browser: "detached",
    search_hint: "P0 不搜正文",
  })
  roundTripOutbound(detached)
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
})

test("remaining inbound events round-trip", () => {
  roundTripInbound(encodeSummonerReady())
  roundTripInbound(encodeSummonerClosed())
  roundTripInbound(encodeSummonerSearch({ query: "invoice" }))
  roundTripInbound(encodeSummonerSearch({ query: "" }))
  roundTripInbound(encodeSummonerContinue())
  roundTripInbound(encodeSummonerHotkeyChosen({ combo: "Ctrl+Alt+Space" }))
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

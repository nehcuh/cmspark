/**
 * Task 9 — Swift overlay contracts (source-level).
 *
 * UI lock: no Allow/Deny/确认 chrome; title is 召唤器（实验） never 主界面;
 * close emits summoner.closed and must not chat.abort.
 */
import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"

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

function traySwiftSrc(): string {
  return (
    fs.readFileSync(srcFile("tray", "Tray.swift"), "utf8") +
    "\n" +
    fs.readFileSync(srcFile("tray", "SummonerOverlay.swift"), "utf8")
  )
}

function summonerControllerBody(): string {
  const src = traySwiftSrc()
  const start = src.indexOf("private let summonerWindowTitle")
  const end = src.indexOf("let summonerController = SummonerController()")
  assert.ok(start >= 0, "summoner window title constant missing")
  assert.ok(end > start, "summonerController singleton missing")
  return src.slice(start, end)
}

test("Summoner overlay is extracted out of the Tray.swift god-file", () => {
  const overlay = fs.readFileSync(srcFile("tray", "SummonerOverlay.swift"), "utf8")
  const tray = fs.readFileSync(srcFile("tray", "Tray.swift"), "utf8")
  assert.match(overlay, /class SummonerController/)
  assert.doesNotMatch(tray, /class SummonerController/)
})

test("SummonerController title is 召唤器（实验） and never 主界面", () => {
  const body = summonerControllerBody()
  assert.match(body, /CMspark 召唤器（实验）/)
  assert.doesNotMatch(body, /主界面/)
})

test("SummonerController has zero Allow/Deny/确认 chrome", () => {
  const body = summonerControllerBody()
  assert.doesNotMatch(body, /允许|拒绝|Allow|Deny|确认/)
  assert.doesNotMatch(body, /showConfirm|allowClicked|denyClicked/)
})

test("SummonerController left rail and 640pt window", () => {
  const body = summonerControllerBody()
  assert.match(body, /width: 640/)
  assert.match(body, /makeRail/)
  assert.match(body, /summoner\.pack\.apply/)
  assert.match(body, /applyThreads/)
  assert.match(body, /applyPacks/)
})

test("SummonerController uses NSTextView composer + nonactivatingPanel + floating", () => {
  const body = summonerControllerBody()
  assert.match(body, /NSTextView/)
  assert.match(body, /nonactivatingPanel/)
  assert.match(body, /\.floating/)
})

test("SummonerController copy lock: badge, hint, CTA, buttons", () => {
  const body = summonerControllerBody()
  assert.match(body, /浏览器已连接/)
  assert.match(body, /浏览器未连接/)
  assert.match(body, /回车发送\/纠偏 · Shift\+Enter 排队 · # 搜标题/)
  assert.match(body, /说点什么/)
  assert.match(body, /不能替你打开侧栏/)
  assert.match(body, /发送/)
  assert.match(body, /已连接，继续对话/)
  assert.match(body, /新对话/)
  assert.match(body, /快捷键/)
  assert.doesNotMatch(body, /NSButton\(title: "设置"/)
  assert.doesNotMatch(body, /召唤器 · 实验/)
  assert.doesNotMatch(body, /P0 /)
  assert.match(body, /MCP · /)
})

test("SummonerController hotkey toggles hide when overlay is already visible", () => {
  const src = traySwiftSrc()
  const start = src.indexOf("func openFromHotKey()")
  assert.ok(start >= 0)
  const fn = src.slice(start, start + 500)
  assert.match(fn, /overlayVisible/)
  assert.match(fn, /hide\(\)/)
})

test("SummonerController history uses 你: / 助手: plaintext, not bubbles", () => {
  const body = summonerControllerBody()
  assert.match(body, /你: /)
  assert.match(body, /助手: /)
  assert.doesNotMatch(body, /role bubbles/)
})

test("SummonerController renders plaintext transcript and new-thread control", () => {
  const body = summonerControllerBody()
  assert.match(body, /summoner\.new_thread/)
  assert.match(body, /你: /)
  assert.match(body, /助手: /)
  assert.doesNotMatch(body, /makeBubble/)
})

test("SummonerController title search uses companion hits then select hydrates", () => {
  const src = traySwiftSrc()
  assert.match(src, /summoner\.hits/)
  assert.match(src, /func applyHits/)
  assert.match(src, /summoner\.select/)
  const selectStart = src.indexOf("private func selectThread(")
  assert.ok(selectStart >= 0)
  const select = src.slice(selectStart, selectStart + 700)
  assert.match(select, /summoner\.select/)
  assert.match(select, /thread_id/)
})

test("SummonerController treats chat.token as snapshot not delta", () => {
  const src = traySwiftSrc()
  const start = src.indexOf("func appendToken(")
  const end = src.indexOf("func markDone(")
  assert.ok(start >= 0 && end > start)
  const fn = src.slice(start, end)
  assert.match(fn, /助手: " \+ text/)
  assert.doesNotMatch(fn, /last \+ text/)
  assert.match(fn, /scheduleStreamRender/)
})

test("SummonerController emits companion.ui.rect and renders assistant markdown", () => {
  const src = traySwiftSrc()
  assert.match(src, /emitCompanionUiRect\("overlay"/)
  assert.match(src, /companion\.ui\.rect/)
  assert.match(src, /AttributedString\(markdown:/)
  assert.match(src, /replacingOccurrences\(of: "\\n", with: "  \\n"\)/)
  assert.match(src, /suffix\(20\)/)
})

test("SummonerController hotkey is a header + tray-menu entry", () => {
  const src = traySwiftSrc()
  assert.match(src, /NSButton\(title: "快捷键"/)
  assert.match(src, /召唤器快捷键…/)
  assert.match(src, /func toggleHotkeyPicker/)
})

test("detached browser copy is faint info, not a warn CTA panel", () => {
  const body = summonerControllerBody()
  assert.match(body, /不能替你打开侧栏/)
  assert.match(body, /summonerDetachedInfo/)
  const apply = body.slice(body.indexOf("private func applyPhase()"), body.indexOf("private func relayout()"))
  assert.match(apply, /ctaBox\?\.isHidden = true/)
  assert.match(apply, /sideNote\?\.stringValue = summonerDetachedInfo/)
})

test("SummonerController close emits summoner.closed and not chat.abort", () => {
  const body = summonerControllerBody()
  assert.match(body, /summoner\.closed/)
  assert.doesNotMatch(body, /chat\.abort/)
  assert.doesNotMatch(body, /summoner\.confirm/)
})

test("SummonerController IME: composing Return is not bound as a button keyEquivalent", () => {
  const body = summonerControllerBody()
  assert.match(body, /hasMarkedText/)
  assert.match(body, /btn\.keyEquivalent = ""/)
})

test("Tray.swift stdin handles summoner.open/hydrate/token/done/error/close", () => {
  const src = traySwiftSrc()
  for (const cmd of [
    "summoner.open",
    "summoner.hydrate",
    "summoner.token",
    "summoner.done",
    "summoner.error",
    "summoner.close",
    "summoner.hotkey.prompt",
    "summoner.hotkey.set",
    "summoner.dictate",
    "summoner.settings",
    "summoner.tool",
    "summoner.mcp",
    "summoner.hits",
  ]) {
    assert.ok(src.includes(`"${cmd}"`), `missing stdin cmd ${cmd}`)
  }
  assert.match(src, /召唤器（实验）…/)
})

test("swift-tray-bridge send/recv Task 7 summoner protocol", () => {
  const src = fs.readFileSync(srcFile("tray", "swift-tray-bridge.ts"), "utf8")
  assert.match(src, /encodeSummonerOpen/)
  assert.match(src, /encodeSummonerHydrate/)
  assert.match(src, /decodeSummonerInbound/)
  assert.match(src, /sendSummoner/)
  assert.match(src, /openSummoner/)
  assert.match(src, /hydrateSummoner/)
  assert.match(src, /onSummonerEvent/)
})

test("menu-bar-agent close releases every overlay lease, not only summonerThreadId", () => {
  const src = fs.readFileSync(srcFile("menu-bar-agent.ts"), "utf8")
  const start = src.indexOf("export async function handleSummonerClosed")
  assert.ok(start >= 0, "handleSummonerClosed missing")
  const next = src.indexOf("\nexport ", start + 10)
  const body = src.slice(start, next > start ? next : start + 800)
  assert.match(body, /releaseAllOverlay|release_overlay|releaseAllOverlayComposerLeases/)
  assert.doesNotMatch(body, /if \(!client \|\| !id\) return/)
})

test("hydrateSummonerThread claims overlay after hydrate (exclusive via lease SoT)", () => {
  const src = fs.readFileSync(srcFile("menu-bar-agent.ts"), "utf8")
  const start = src.indexOf("async function hydrateSummonerThread")
  assert.ok(start >= 0)
  const next = src.indexOf("\nasync function ", start + 10)
  const body = src.slice(start, next > start ? next : start + 900)
  assert.match(body, /claimOverlayComposerLease|hydrateOverlayIfLive/)
  assert.match(body, /beginOverlaySession|overlaySessionIsLive/)
})

test("handleSummonerClosed invalidates in-flight overlay session", () => {
  const src = fs.readFileSync(srcFile("menu-bar-agent.ts"), "utf8")
  const start = src.indexOf("export async function handleSummonerClosed")
  const next = src.indexOf("\nexport ", start + 10)
  const body = src.slice(start, next > start ? next : start + 800)
  assert.match(body, /invalidateOverlaySession/)
})

test("lifecycle summoner ws.close releases overlay leases", () => {
  const src = fs.readFileSync(srcFile("ws", "lifecycle.ts"), "utf8")
  assert.match(src, /broadcastOverlayLeasesOnSocketClose/)
})

test("menu-bar-agent forwards companion.ui.rect to the daemon", () => {
  const src = fs.readFileSync(srcFile("menu-bar-agent.ts"), "utf8")
  assert.match(src, /onCompanionUiRect/)
  assert.match(src, /companion\.ui\.rect/)
})

test("SummonerController search Return with zero hits does not send chat", () => {
  const src = traySwiftSrc()
  const start = src.indexOf("func textView(_ textView: NSTextView, doCommandBy")
  const body = src.slice(start, start + 1400)
  assert.match(body, /isSearchQuery\(composerText\)/)
  assert.doesNotMatch(body, /else \{\s*submitComposer\(\)/)
})

test("SummonerController hide cancels pending title search", () => {
  const src = traySwiftSrc()
  const hide = src.slice(src.indexOf("  func hide() {"), src.indexOf("  func hide() {") + 280)
  assert.match(hide, /searchTimer\?\.invalidate/)
})

test("handleSummonerSubmit claims only if overlay session is still live", () => {
  const src = fs.readFileSync(srcFile("menu-bar-agent.ts"), "utf8")
  const start = src.indexOf("export async function handleSummonerSubmit")
  assert.ok(start >= 0)
  const next = src.indexOf("\nexport ", start + 10)
  const body = src.slice(start, next > start ? next : start + 1200)
  assert.match(body, /currentOverlaySession/)
  assert.match(body, /claimOverlayIfLive/)
})

test("handleSummonerSearch 1-hit hydrates (claims exclusive overlay) instead of silent id swap", () => {
  const src = fs.readFileSync(srcFile("menu-bar-agent.ts"), "utf8")
  const start = src.indexOf("export async function handleSummonerSearch")
  assert.ok(start >= 0)
  const next = src.indexOf("\nexport ", start + 10)
  const body = src.slice(start, next > start ? next : start + 700)
  assert.match(body, /hydrateSummonerThread/)
  assert.doesNotMatch(body, /summonerThreadId = cmd\.hits\[0\]\.id/)
})

test("companion-client close path can release all overlay leases", () => {
  const src = fs.readFileSync(srcFile("tray", "companion-client.ts"), "utf8")
  assert.match(src, /releaseAllOverlay|release_overlay/)
})

test("message-router broadcasts exclusive-claim siblings as composer.lease", () => {
  const src = fs.readFileSync(srcFile("message-router.ts"), "utf8")
  assert.match(src, /released_siblings/)
  assert.match(src, /composer\.lease\.release_overlay/)
})

test("menu-bar-agent inbound close does not chat.abort", () => {
  const src = fs.readFileSync(srcFile("menu-bar-agent.ts"), "utf8")
  const start = src.indexOf("export function handleSummonerInbound")
  assert.ok(start >= 0)
  const body = src.slice(start, start + 1800)
  assert.match(body, /summoner\.closed/)
  assert.doesNotMatch(body, /chat\.abort/)
  assert.match(body, /handleSummonerClosed/)
  assert.match(body, /handleSummonerSelect/)
  assert.match(body, /handleSummonerAttach/)
  assert.match(body, /handleSummonerContinue/)
  assert.match(body, /handleSummonerSubmit/)
  assert.match(body, /summoner\.hotkey\.chosen/)
  assert.match(body, /persistSummonerHotkeyChosen/)
  assert.match(body, /handleSummonerReady/)
})

test("menu-bar-agent persists summoner.hotkey via saveConfig, not overlay config.set", () => {
  const src = fs.readFileSync(srcFile("menu-bar-agent.ts"), "utf8")
  const persist = src.slice(
    src.indexOf("export function persistSummonerHotkeyChosen"),
    src.indexOf("export function persistSummonerHotkeyChosen") + 700,
  )
  assert.match(persist, /saveConfig\(\{ summoner: \{ hotkey: accepted \} \}\)/)
  assert.doesNotMatch(persist, /config\.set/)
})

test("SummonerController first paint does not hardcode 未连接 before hydrate", () => {
  const body = summonerControllerBody()
  assert.match(body, /检测浏览器…/)
  assert.match(body, /browserKnown/)
})

test("SummonerController hotkey picker lists occupied chords as labels not buttons", () => {
  const src = traySwiftSrc()
  assert.match(src, /summonerHotKeyStolen/)
  assert.match(src, /已被 .* 占用/)
  const start = src.indexOf("private func chooseHotkey")
  assert.ok(start >= 0, "chooseHotkey missing")
  const choose = src.slice(start, start + 500)
  assert.match(choose, /summonerHotKeyStolen/)
  assert.match(choose, /return/)
})

test("summoner.submit failure is reported back to the overlay (no silent drop)", () => {
  const src = fs.readFileSync(srcFile("menu-bar-agent.ts"), "utf8")
  const start = src.indexOf('case "summoner.submit"')
  assert.ok(start >= 0, "summoner.submit branch missing")
  const body = src.slice(start, start + 800)
  // Swift appends "你：…" to its local transcript before sending; a failed
  // submit (client down / lease claim failed) must produce summoner.error.
  assert.match(body, /handleSummonerSubmit\(evt\.thread_id, evt\.text, evt\.enqueue === true\)/)
  assert.match(body, /\.then\(\(ok\)/)
  assert.match(body, /error_code: "submit_failed"/)
  assert.match(body, /encodeSummonerError/)
})

test("menu-bar-agent drops stream cmds from threads the overlay is not showing", () => {
  const src = fs.readFileSync(srcFile("menu-bar-agent.ts"), "utf8")
  const start = src.indexOf("summonerClient.onAppMessage")
  assert.ok(start >= 0, "summonerClient.onAppMessage missing")
  const body = src.slice(start, start + 1200)
  assert.match(body, /mapChatMessageToSummonerCmd/)
  assert.match(body, /summonerCmdMatchesThread\(cmd, summonerThreadId\)/)
})

test("menu-bar-agent stale overlay claims self-release and repair the live thread", () => {
  const src = fs.readFileSync(srcFile("menu-bar-agent.ts"), "utf8")
  assert.match(src, /releaseOverlayLeaseAtRev/)
  assert.match(src, /onStaleClaim/)
  assert.match(src, /reclaimLiveSummonerThread/)
  assert.match(src, /released_siblings/)
  const reclaim = src.slice(src.indexOf("async function reclaimLiveSummonerThread"), src.indexOf("async function hydrateSummonerThread"))
  assert.match(reclaim, /claimOverlayIfLive/, "reclaim must re-check generation after the RPC (S-C2)")
  assert.doesNotMatch(reclaim, /claimOverlayLeaseCas\(/)
})

test("menu-bar-agent submit-ok bind is live-gated and setSummonerThreadId is gone (S-C1/C2)", () => {
  const src = fs.readFileSync(srcFile("menu-bar-agent.ts"), "utf8")
  assert.doesNotMatch(src, /export function setSummonerThreadId/)
  const submit = src.slice(src.indexOf("export async function handleSummonerSubmit"), src.indexOf("export async function handleSummonerSearch"))
  assert.match(submit, /if \(result\.ok && result\.threadId && overlaySessionIsLive\(token\)\)/)
})

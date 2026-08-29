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
  assert.match(body, /borderless/)
  assert.match(body, /titleVisibility = \.hidden|titlebarAppearsTransparent/)
})

test("SummonerController has zero Allow/Deny action chrome", () => {
  const body = summonerControllerBody()
  // Status copy 确认台 / 需要确认 / 打开确认台 is allowed; action buttons are not.
  assert.doesNotMatch(body, /允许|拒绝|Allow|Deny/)
  assert.doesNotMatch(body, /showConfirm|allowClicked|denyClicked/)
})

test("SummonerController is a one-bar HUD: 720pt, no stacked makeRail, Esc hides", () => {
  const body = summonerControllerBody()
  assert.match(body, /summonerHudWidth/)
  assert.match(body, /720/)
  assert.doesNotMatch(body, /func makeRail/)
  assert.doesNotMatch(body, /railPackClicked/)
  assert.match(body, /cancelOperation/)
  const hide = body.slice(body.indexOf("func hide()"), body.indexOf("func hide()") + 280)
  assert.match(hide, /orderOut/)
})

test("Swift mcpRowClicked / mcpAddClicked do not dispatch toggle or add", () => {
  const overlay = fs.readFileSync(srcFile("tray", "SummonerOverlay.swift"), "utf8")
  const rowStart = overlay.indexOf("func mcpRowClicked")
  const addStart = overlay.indexOf("func mcpAddClicked")
  const skillStart = overlay.indexOf("func skillRowClicked")
  assert.ok(rowStart >= 0 && addStart > rowStart && skillStart > addStart)
  const row = overlay.slice(rowStart, addStart)
  const add = overlay.slice(addStart, skillStart)
  assert.doesNotMatch(row, /jsonLine/)
  assert.doesNotMatch(add, /jsonLine/)
})

test("PR-C: expand chrome hides MCP icon via isHidden; default section is 对话", () => {
  const overlay = fs.readFileSync(srcFile("tray", "SummonerOverlay.swift"), "utf8")
  const railStart = overlay.indexOf("let railSpecs")
  const railEnd = overlay.indexOf("let listCol")
  assert.ok(railStart >= 0 && railEnd > railStart)
  const rail = overlay.slice(railStart, railEnd)
  assert.match(rail, /"对话", 0/)
  assert.match(rail, /"MCP", 4/)
  assert.match(rail, /isHidden/)
  assert.match(overlay, /summoner\.mcp\.add/)
  assert.match(overlay, /summoner\.mcp\.toggle/)
  assert.match(overlay, /private var railSection = 0/)
  const mcpList = overlay.slice(overlay.indexOf("func refreshMcpList"), overlay.indexOf("func refreshSkillList"))
  const knList = overlay.slice(
    overlay.indexOf("func refreshKnowledgeList"),
    overlay.indexOf("func tintRailButtons"),
  )
  assert.match(mcpList, /＋ 添加 MCP/)
  assert.match(mcpList, /isHidden\s*=\s*true/)
  assert.match(knList, /＋ 导入知识/)
  assert.match(knList, /isHidden\s*=\s*true/)
})

test("HUD expand B0: chevron, workbench above composer, threads from applyThreads", () => {
  const overlay = fs.readFileSync(srcFile("tray", "SummonerOverlay.swift"), "utf8")
  assert.match(overlay, /toggleExpandClicked/)
  assert.match(overlay, /workbenchBox/)
  assert.match(overlay, /func applyThreads/)
  assert.match(overlay, /threadListStack/)
  assert.match(overlay, /text\.alignleft/)
  const make = overlay.slice(overlay.indexOf("private func makeWindow()"), overlay.indexOf("private func makeIndigoButton"))
  const workbenchAt = make.indexOf("workbenchBox")
  const fieldAt = make.lastIndexOf("stack.addArrangedSubview(fieldBox)")
  assert.ok(workbenchAt >= 0 && fieldAt > workbenchAt, "workbench must be assembled before composer is pinned to the stack")
  const apply = overlay.slice(overlay.indexOf("func applyThreads"), overlay.indexOf("func applyPacks"))
  assert.match(apply, /threadListStack|refreshThreadList/)
  assert.doesNotMatch(apply, /_ = json/)
})

test("borderless HUD panel overrides canBecomeKey so composer/OpenPanel/mic work", () => {
  const overlay = fs.readFileSync(srcFile("tray", "SummonerOverlay.swift"), "utf8")
  assert.match(overlay, /class SummonerPanel: NSPanel/)
  assert.match(overlay, /override var canBecomeKey: Bool \{ true \}/)
  assert.match(overlay, /SummonerPanel\(/)
  assert.match(overlay, /runModal\(\)/)
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
  assert.doesNotMatch(body, /知识配置去侧栏/)
  assert.match(body, /展开对话/)
  assert.match(body, /收起对话/)
  assert.doesNotMatch(body, /展开工作台|收起工作台/)
  assert.match(body, /说点什么/)
  assert.match(body, /工具栏的 CMspark/)
  assert.doesNotMatch(body, /去侧栏/)
  assert.match(body, /已连接，继续对话/)
  assert.match(body, /新对话/)
  assert.match(body, /打开浏览器/)
  assert.match(body, /打开并前置浏览器/)
  assert.match(body, /可以继续聊/)
  assert.match(body, /打开侧栏/)
  assert.doesNotMatch(body, /可以继续聊。要操作网页，需要打开浏览器。/)
  assert.doesNotMatch(body, /网页操作需要浏览器（扩展已配对的 Chrome）。/)
  assert.doesNotMatch(body, /编程助手要看你的页面，但浏览器没在。/)
  assert.match(body, /我们不能替你打开侧栏。要盯着页面，请点工具栏的 CMspark。/)
  assert.doesNotMatch(body, /系统: BROWSER_UNAVAILABLE/)
  assert.doesNotMatch(body, /NSButton\(title: "设置"/)
  assert.doesNotMatch(body, /召唤器 · 实验/)
  assert.doesNotMatch(body, /P0 /)
  assert.doesNotMatch(body, /Raycast|uTools/)
  assert.doesNotMatch(body, /MCP · /)
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
  assert.match(src, /components\(separatedBy: "\\n"\)/)
  assert.match(src, /inlineOnlyPreservingWhitespace/)
  assert.match(src, /suffix\(20\)/)
})

test("SummonerController hotkey picker is tray-menu, not HUD chrome", () => {
  const src = traySwiftSrc()
  assert.match(src, /召唤器快捷键…/)
  assert.match(src, /func toggleHotkeyPicker/)
  assert.match(src, /func showHotkeyPicker/)
  const overlay = fs.readFileSync(srcFile("tray", "SummonerOverlay.swift"), "utf8")
  assert.doesNotMatch(overlay, /NSButton\(title: "快捷键"/)
})

test("detached browser copy unhides honesty CTAs", () => {
  const body = summonerControllerBody()
  assert.match(body, /工具栏的 CMspark/)
  assert.doesNotMatch(body, /去侧栏/)
  assert.match(body, /打开浏览器/)
  assert.match(body, /打开并前置浏览器/)
  const apply = body.slice(body.indexOf("private func applyPhase()"), body.indexOf("private func relayout()"))
  assert.match(apply, /let showCta = detached \|\| confirmPending/)
  assert.match(apply, /ctaBox\?\.isHidden = !showCta/)
  assert.match(body, /打开确认台/)
  assert.match(body, /需要确认才能继续/)
  assert.match(body, /MCP_CONFIRM_PENDING/)
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

test("Tray.swift menu and hotkey 召唤器 open HTML Capture card", () => {
  const src = fs.readFileSync(srcFile("tray", "Tray.swift"), "utf8")
  const click = src.indexOf("tag == MenuTag.summoner.rawValue")
  assert.ok(click >= 0)
  const menu = src.slice(click, src.indexOf("MenuTag.summonerHotkey.rawValue", click))
  assert.match(menu, /"action": "summoner"/)
  assert.doesNotMatch(menu, /summonerController\.open/)
  const hotAt = src.indexOf("func handleSummonerHotKeyPressed()")
  assert.ok(hotAt >= 0)
  const hot = src.slice(hotAt, src.indexOf("// Summoner overlay lives", hotAt))
  assert.match(hot, /"action": "summoner-toggle"/)
  assert.doesNotMatch(hot, /openFromHotKey/)
})

test("Summoner overlay composer exposes file clip and hold-to-talk mic", () => {
  const overlay = fs.readFileSync(srcFile("tray", "SummonerOverlay.swift"), "utf8")
  assert.match(overlay, /attachFilesClicked/)
  assert.match(overlay, /NSOpenPanel/)
  assert.match(overlay, /summoner\.files/)
  assert.match(overlay, /按住听写/)
  assert.match(overlay, /micButton\?\.isHidden = searching/)
  assert.match(overlay, /application\/octet-stream/)
  assert.doesNotMatch(overlay, /"type": ""/)
  assert.match(overlay, /summonerFileMaxBytes/)
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

test("HTML hide/close wires onShellClosed to handleSummonerClosed", () => {
  const src = fs.readFileSync(srcFile("menu-bar-agent.ts"), "utf8")
  const start = src.indexOf("async function openSummonerWebShell")
  assert.ok(start >= 0, "openSummonerWebShell missing")
  const next = src.indexOf("\nasync function ", start + 10)
  const body = src.slice(start, next > start ? next : start + 2500)
  assert.match(body, /onShellClosed/)
  assert.match(body, /handleSummonerClosed/)
})

test("handleSummonerClosed does not abortThreadChat by lease thread_id", () => {
  const src = fs.readFileSync(srcFile("menu-bar-agent.ts"), "utf8")
  const start = src.indexOf("export async function handleSummonerClosed")
  const next = src.indexOf("\nexport ", start + 10)
  const body = src.slice(start, next > start ? next : start + 800)
  assert.match(body, /invalidateOverlaySession/)
  assert.match(body, /releaseAllOverlayComposerLeases/)
  assert.doesNotMatch(body, /abortThreadChat/)
  assert.doesNotMatch(body, /chat\.abort/)
})

test("lifecycle summoner ws.close releases overlay leases", () => {
  const src = fs.readFileSync(srcFile("ws", "lifecycle.ts"), "utf8")
  assert.match(src, /broadcastOverlayLeasesOnSocketClose/)
})

test("#229: Capture open does not NSApp.activate; hotkey toggles hide", () => {
  const overlay = fs.readFileSync(srcFile("tray", "SummonerOverlay.swift"), "utf8")
  const openStart = overlay.indexOf("func open(threadId:")
  const openEnd = overlay.indexOf("func hide()")
  assert.ok(openStart >= 0 && openEnd > openStart, "open(threadId:) / hide() missing")
  const openBody = overlay.slice(openStart, openEnd)
  assert.match(openBody, /makeKeyAndOrderFront/)
  assert.match(openBody, /makeFirstResponder\(composer\)/)
  assert.match(openBody, /do NOT call NSApp\.activate|must not steal/)
  assert.doesNotMatch(
    openBody,
    /NSApp\.activate\(/,
    "Capture open must not steal the front app; comment may mention NSApp.activate",
  )
  const hkStart = overlay.indexOf("func openFromHotKey()")
  const hkEnd = overlay.indexOf("@objc func hotkeyCandidateClicked")
  assert.ok(hkStart >= 0 && hkEnd > hkStart)
  const hk = overlay.slice(hkStart, hkEnd)
  assert.match(hk, /overlayVisible/)
  assert.match(hk, /hide\(\)/)
  assert.doesNotMatch(hk, /NSApp\.activate\(/)
  assert.match(overlay, /\.nonactivatingPanel/)
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

test("companion-client overlay release catch does not claim close must not abort chat", () => {
  const src = fs.readFileSync(srcFile("tray", "companion-client.ts"), "utf8")
  const start = src.indexOf("async releaseAllOverlayComposerLeases")
  assert.ok(start >= 0, "releaseAllOverlayComposerLeases missing")
  const body = src.slice(start, start + 450)
  assert.doesNotMatch(body, /close still must not abort chat/)
})

test("message-router broadcasts exclusive-claim siblings as composer.lease", () => {
  const src = fs.readFileSync(srcFile("message-router.ts"), "utf8")
  assert.match(src, /released_siblings/)
  assert.match(src, /composer\.lease\.release_overlay/)
})

test("handleSummonerFiles claims overlay lease and coerces empty MIME", () => {
  const src = fs.readFileSync(srcFile("menu-bar-agent.ts"), "utf8")
  const start = src.indexOf("async function handleSummonerFiles")
  assert.ok(start >= 0, "handleSummonerFiles missing")
  const next = src.indexOf("\nexport ", start + 10)
  const body = src.slice(start, next > start ? next : start + 2200)
  assert.match(body, /claimOverlayIfLive/)
  assert.match(body, /application\/octet-stream/)
  assert.match(body, /OVERLAY_STANDBY/)
})

test("menu-bar-agent inbound close does not chat.abort", () => {
  const src = fs.readFileSync(srcFile("menu-bar-agent.ts"), "utf8")
  const start = src.indexOf("export function handleSummonerInbound")
  assert.ok(start >= 0)
  const body = src.slice(start, start + 2800)
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
  assert.match(reclaim, /onStaleClaim/, "generation-die-during-await must repair demoted live siblings")
})

test("menu-bar-agent submit-ok bind is live-gated and setSummonerThreadId is gone (S-C1/C2)", () => {
  const src = fs.readFileSync(srcFile("menu-bar-agent.ts"), "utf8")
  assert.doesNotMatch(src, /export function setSummonerThreadId/)
  const submit = src.slice(src.indexOf("export async function handleSummonerSubmit"), src.indexOf("export async function handleSummonerSearch"))
  assert.match(submit, /if \(result\.ok && result\.threadId && overlaySessionIsLive\(token\)\)/)
  assert.match(src, /function bindSummonerThread\(id: string, token: number\)/)
  assert.doesNotMatch(src, /token \?\? currentOverlaySession\(\)/)
})

test("W4: confirmPending resets on hydrate-attach, stream resume, done, and new thread", () => {
  // Scope to SummonerOverlay.swift only — Tray.swift has its own HudController
  // applyHydrate that must not satisfy these assertions.
  const src = fs.readFileSync(srcFile("tray", "SummonerOverlay.swift"), "utf8")
  const setIdx = src.indexOf('if code == "MCP_CONFIRM_PENDING"')
  assert.ok(setIdx >= 0, "MCP_CONFIRM_PENDING branch missing")
  assert.match(src.slice(setIdx, setIdx + 160), /confirmPending = true/)

  // Attached hydrate = browser channel live again -> confirm CTA mode ends.
  const hydrate = src.slice(src.indexOf("func applyHydrate"), src.indexOf("func appendToken"))
  assert.match(hydrate, /if browserAttached \{\s*\n(\s*\/\/[^\n]*\n)*\s*confirmPending = false/)

  // Assistant tokens flowing again = the pending confirm was resolved.
  const append = src.slice(src.indexOf("func appendToken"), src.indexOf("func markDone"))
  assert.match(append, /confirmPending = false/)
  assert.match(append, /applyPhase\(\)/)

  // Chat done = confirm settled one way or another.
  const done = src.slice(src.indexOf("func markDone"), src.indexOf("func scheduleStreamRender"))
  assert.match(done, /confirmPending = false/)
  assert.match(done, /applyPhase\(\)/)

  // Opening a fresh thread clears any stale confirm CTA from a previous thread.
  const openBody = src.slice(src.indexOf("func open(threadId:"), src.indexOf("func hide()"))
  const emptyBranch = openBody.slice(openBody.indexOf("if threadId.isEmpty"))
  assert.match(emptyBranch, /confirmPending = false/)

  // Switching to a different existing thread also clears the stale confirm CTA
  // (same-thread reopen keeps it — the reset lives only in the else-if branch).
  assert.match(openBody, /else if threadId != self\.threadId \{\s*\n(\s*\/\/[^\n]*\n)*\s*confirmPending = false/)

  // Terminal chat.error ends the turn with no token/done frame — the confirm CTA
  // must clear unless the error is a known non-terminal action rejection.
  const errBody = src.slice(src.indexOf("func applyError"), src.indexOf("func noteThreadsChanged"))
  assert.match(
    errBody,
    /if confirmPending && !Self\.nonTerminalErrorCodes\.contains\(code\) \{\s*\n(\s*\/\/[^\n]*\n)*\s*confirmPending = false/
  )

  // The non-terminal set mirrors client.ts's known action-level rejections.
  const codeSet = src.slice(src.indexOf("nonTerminalErrorCodes: Set<String>"), src.indexOf("func open(threadId:"))
  for (const c of ["run_active", "enqueued", "upload_failed", "OVERLAY_STANDBY"]) {
    assert.ok(codeSet.includes(`"${c}"`), `nonTerminalErrorCodes missing ${c}`)
  }
})

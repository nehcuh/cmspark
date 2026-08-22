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

function summonerControllerBody(): string {
  const src = fs.readFileSync(srcFile("tray", "Tray.swift"), "utf8")
  const start = src.indexOf("private let summonerWindowTitle")
  const end = src.indexOf("let summonerController = SummonerController()")
  assert.ok(start >= 0, "summoner window title constant missing")
  assert.ok(end > start, "summonerController singleton missing")
  return src.slice(start, end)
}

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
  assert.match(body, /P0 不搜正文 · 也不搜文件和应用/)
  assert.match(body, /我们不能替你打开侧栏/)
  assert.match(body, /发送/)
  assert.match(body, /激活 Google Chrome/)
  assert.match(body, /已连接，继续对话/)
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
  const src = fs.readFileSync(srcFile("tray", "Tray.swift"), "utf8")
  for (const cmd of [
    "summoner.open",
    "summoner.hydrate",
    "summoner.token",
    "summoner.done",
    "summoner.error",
    "summoner.close",
    "summoner.hotkey.prompt",
    "summoner.hotkey.set",
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

test("menu-bar-agent inbound close does not chat.abort", () => {
  const src = fs.readFileSync(srcFile("menu-bar-agent.ts"), "utf8")
  const start = src.indexOf("export function handleSummonerInbound")
  assert.ok(start >= 0)
  const body = src.slice(start, start + 1800)
  assert.match(body, /summoner\.closed/)
  assert.doesNotMatch(body, /chat\.abort/)
  assert.match(body, /handleSummonerAttach/)
  assert.match(body, /handleSummonerContinue/)
  assert.match(body, /handleSummonerSubmit/)
  assert.match(body, /summoner\.hotkey\.chosen/)
  assert.match(body, /persistSummonerHotkeyChosen/)
  assert.match(body, /syncSummonerHotkeyToTray/)
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

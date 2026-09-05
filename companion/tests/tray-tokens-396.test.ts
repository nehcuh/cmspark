/**
 * #396 — Swift tray token adoption (source-level).
 *
 * ConfirmController consumes SummonerTokens (type scale / semantic risk colors /
 * button hierarchy mirroring MinimalConfirm), tray NSMenu copy is emoji-free,
 * and the confirmation flow behavior (selectors, key equivalents, response
 * protocol, sanitization) is byte-for-byte unchanged.
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

function traySrc(): string {
  return fs.readFileSync(srcFile("tray", "Tray.swift"), "utf8")
}

function overlaySrc(): string {
  return fs.readFileSync(srcFile("tray", "SummonerOverlay.swift"), "utf8")
}

function slice(src: string, startMark: string, endMark: string, label: string): string {
  const start = src.indexOf(startMark)
  assert.ok(start >= 0, `${label} start marker missing`)
  const end = src.indexOf(endMark, start)
  assert.ok(end > start, `${label} end marker missing`)
  return src.slice(start, end)
}

function confirmControllerBody(): string {
  return slice(traySrc(), "class ConfirmController", "extension ConfirmController", "ConfirmController")
}

function buildMenuBody(): string {
  return slice(traySrc(), "func buildMenu(", "private func makeInfoItem", "buildMenu")
}

// Emoji / pictographic ranges: symbols, dingbats, misc-technical, emoji blocks.
const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2300}-\u{23FF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/u

test("#396 SummonerTokens mirrors sidepanel tokens.ts canon values", () => {
  const overlay = overlaySrc()
  const start = overlay.indexOf("enum SummonerTokens")
  const end = overlay.indexOf("}", start)
  assert.ok(start >= 0 && end > start, "SummonerTokens block missing")
  const block = overlay.slice(start, end)
  // Leading comment keeps the mirror + Never-Material ban auditable
  assert.match(overlay.slice(Math.max(0, start - 400), start), /#4CAF50/)

  // tokens.success #059669 — primary (允许) fill
  assert.match(block, /static let success = NSColor\(calibratedRed: 5\/255, green: 150\/255, blue: 105\/255/)
  // tokens.danger #dc2626 — riskColor high+
  assert.match(block, /static let danger = NSColor\(calibratedRed: 220\/255, green: 38\/255, blue: 38\/255/)
  // tokens.warning #d97706 — riskColor low/medium
  assert.match(block, /static let warning = NSColor\(calibratedRed: 217\/255, green: 119\/255, blue: 6\/255/)
  // tokens.dangerSoft #fef2f2
  assert.match(block, /static let dangerBg = NSColor\(calibratedRed: 254\/255, green: 242\/255, blue: 242\/255/)
  // tokens.dangerBorder rgba(220, 38, 38, 0.28)
  assert.match(block, /static let dangerBorder = NSColor\(calibratedRed: 220\/255, green: 38\/255, blue: 38\/255, alpha: 0\.28\)/)
  // mapping comments keep the mirror auditable
  assert.match(block, /tokens\.success #059669/)
  assert.match(block, /tokens\.danger #dc2626/)
})

test("#396 SummonerTokens type scale is the 15/13/11 canon (no 13/11 roulette)", () => {
  const overlay = overlaySrc()
  const start = overlay.indexOf("enum SummonerTokens")
  const end = overlay.indexOf("}", start)
  const block = overlay.slice(start, end)
  assert.match(block, /static let fontTitle: CGFloat = 15/)
  assert.match(block, /static let fontBody: CGFloat = 13/)
  assert.match(block, /static let fontCaption: CGFloat = 11/)
  assert.match(block, /static let radiusSm: CGFloat = 6/)
})

test("#396 risk chip: color AND text label coexist (never color-only)", () => {
  const body = confirmControllerBody()
  const showBody = slice(body, "func show(", "private func updateCountdown", "ConfirmController.show")
  // Text labels (tokens.ts riskLabel)
  for (const label of ["高风险", "中风险", "低风险"]) {
    assert.ok(showBody.includes(label), `risk label ${label} missing`)
  }
  // Coordinate-injection suffix survives the copy migration
  assert.match(showBody, /高风险 · 不可逆操作/)
  // Semantic colors bound to the SAME switch (chip surface set from tokens)
  assert.match(showBody, /chipFg = SummonerTokens\.danger/)
  assert.match(showBody, /chipBg = SummonerTokens\.dangerBg/)
  assert.match(showBody, /chipBg = SummonerTokens\.warnBg/)
  assert.match(showBody, /chipBorder = SummonerTokens\.dangerBorder/)
  // Emoji badge is gone from the window title (risk lives in the chip)
  assert.match(showBody, /window\.title = "CMspark · 确认操作"/)
  assert.doesNotMatch(showBody, EMOJI_RE)
})

test("#396 buttons: 允许=primary (success fill), 拒绝=secondary — MinimalConfirm semantics", () => {
  const body = confirmControllerBody()
  const winStart = body.indexOf("private func makeWindow()")
  assert.ok(winStart >= 0, "ConfirmController.makeWindow missing")
  const winBody = body.slice(winStart)
  assert.match(winBody, /allowBtn\.bezelColor = SummonerTokens\.success/)
  assert.match(winBody, /allowBtn\.contentTintColor = \.white/)
  assert.doesNotMatch(winBody, /denyBtn\.bezelColor = SummonerTokens\.success/)
})

test("#396 behavior freeze: selectors, key equivalents, protocol, sanitization unchanged", () => {
  const body = confirmControllerBody()
  // Actions/targets
  assert.match(body, /NSButton\(title: "拒绝", target: self, action: #selector\(denyClicked\)\)/)
  assert.match(body, /NSButton\(title: "允许", target: self, action: #selector\(allowClicked\)\)/)
  // Key equivalents: Esc = deny, Return = allow
  assert.match(body, /denyBtn\.keyEquivalent = "\\u\{1b\}"/)
  assert.match(body, /allowBtn\.keyEquivalent = "\\r"/)
  // Response protocol identical
  assert.match(body, /jsonLine\(\["type": "confirm-response", "id": id, "approved": approved\]\)/)
  // Close = deny guard still present
  assert.match(body, /windowWillClose[\s\S]*?emitResponse\(id: id, approved: false\)/)
  // Summary sanitization (0x7F + C0 strip) survives untouched
  assert.match(body, /\$0\.value != 0x7F && !\(\$0\.value >= 0 && \$0\.value < 0x20\)/)
  // Non-activating panel (P0a: must not steal foreground) untouched
  assert.match(body, /\.nonactivatingPanel/)
  assert.match(body, /panel\.level = \.floating/)
})

test("#396 tray NSMenu copy carries semantics without emoji", () => {
  const menu = buildMenuBody()
  // Header status is text
  for (const word of ["运行中", "已停止", "状态未知"]) {
    assert.ok(menu.includes(word), `status word ${word} missing`)
  }
  assert.match(menu, /CMspark Agent · \\\(statusWord\)/)
  // WS line text label
  assert.match(menu, /已连接/)
  assert.match(menu, /未连接/)
  // No emoji anywhere in menu construction (titles no longer depend on them)
  assert.doesNotMatch(menu, EMOJI_RE)
})

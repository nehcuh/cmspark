/**
 * Task 10 / S11 — opt-in hotkey picker, no stolen defaults.
 */
import test from "node:test"
import assert from "node:assert/strict"
import * as fs from "node:fs"
import * as path from "node:path"
import {
  SUMMONER_HOTKEY_CANDIDATES,
  SUMMONER_HOTKEY_STOLEN,
  canonicalizeSummonerHotkey,
  isBannedSummonerHotkey,
  isSafeSummonerHotkey,
  acceptedSummonerHotkey,
  nextSummonerHotkeyCmd,
} from "../src/summoner/hotkey"

const STOLEN_INPUTS = [
  "Cmd+Space",
  "⌘Space",
  "command+space",
  "⌥Space",
  "Alt+Space",
  "option+space",
  "⌃⇧Space",
  "Ctrl+Shift+Space",
  "control+shift+space",
]

test("candidates do not include Spotlight / Raycast / IME space chords", () => {
  const combos = SUMMONER_HOTKEY_CANDIDATES.map((c) => c.combo)
  assert.equal(combos.includes("cmd+space"), false)
  assert.equal(combos.includes("alt+space"), false)
  assert.equal(combos.includes("ctrl+shift+space"), false)
  for (const c of SUMMONER_HOTKEY_CANDIDATES) {
    assert.equal(isBannedSummonerHotkey(c.combo), false, c.combo)
    assert.equal(isSafeSummonerHotkey(c.combo), true, c.combo)
  }
})

test("stolen defaults canonicalize and are banned", () => {
  for (const raw of STOLEN_INPUTS) {
    const canonical = canonicalizeSummonerHotkey(raw)
    assert.ok(canonical, `should parse ${raw}`)
    assert.equal(isBannedSummonerHotkey(canonical!), true, raw)
    assert.equal(acceptedSummonerHotkey(raw), null, raw)
  }
  assert.deepEqual(
    SUMMONER_HOTKEY_STOLEN.map((s) => s.combo).sort(),
    ["alt+space", "cmd+space", "ctrl+shift+space"],
  )
})

test("safe picker aliases canonicalize into the candidate list", () => {
  assert.equal(canonicalizeSummonerHotkey("⌃⌥Space"), "ctrl+alt+space")
  assert.equal(canonicalizeSummonerHotkey("Ctrl+Alt+Space"), "ctrl+alt+space")
  assert.equal(canonicalizeSummonerHotkey("ctrl+option+c"), "ctrl+alt+c")
  assert.equal(canonicalizeSummonerHotkey("⌃⌥⌘."), "ctrl+alt+cmd+period")
  assert.equal(acceptedSummonerHotkey("⌃⌥K"), "ctrl+alt+k")
  assert.equal(acceptedSummonerHotkey("Ctrl+Alt+S"), "ctrl+alt+s")
})

test("empty / unknown combos are not accepted", () => {
  assert.equal(acceptedSummonerHotkey(""), null)
  assert.equal(acceptedSummonerHotkey("ctrl+space"), null)
  assert.equal(acceptedSummonerHotkey("f9"), null)
  assert.equal(canonicalizeSummonerHotkey(""), null)
})

test("nextSummonerHotkeyCmd prompts when empty, sets when persisted", () => {
  assert.deepEqual(nextSummonerHotkeyCmd(undefined), { cmd: "summoner.hotkey.prompt" })
  assert.deepEqual(nextSummonerHotkeyCmd(""), { cmd: "summoner.hotkey.prompt" })
  assert.deepEqual(nextSummonerHotkeyCmd("Cmd+Space"), { cmd: "summoner.hotkey.prompt" })
  assert.deepEqual(nextSummonerHotkeyCmd("ctrl+alt+space"), {
    cmd: "summoner.hotkey.set",
    combo: "ctrl+alt+space",
  })
  assert.deepEqual(nextSummonerHotkeyCmd("⌃⌥C"), {
    cmd: "summoner.hotkey.set",
    combo: "ctrl+alt+c",
  })
})

function srcFile(...parts: string[]): string {
  const candidates = [
    path.resolve(__dirname, "..", "..", "src", ...parts),
    path.resolve(__dirname, "..", "src", ...parts),
  ]
  for (const p of candidates) {
    if (fs.existsSync(p)) return p
  }
  return candidates[0]
}

test("Tray.swift candidate table matches TS and registers Carbon hotkey", () => {
  const src = fs.readFileSync(srcFile("tray", "Tray.swift"), "utf8")
  assert.match(src, /RegisterEventHotKey/)
  assert.match(src, /installSummonerHotKeyMonitor/)
  assert.match(src, /summoner\.hotkey\.set/)
  assert.match(src, /summoner\.hotkey\.chosen/)
  assert.match(src, /composingNow/)
  assert.match(src, /hasMarkedText/)
  const start = src.indexOf("let summonerHotKeyCandidates")
  const end = src.indexOf("let summonerHotKeyStolenCopy")
  assert.ok(start >= 0 && end > start)
  const table = src.slice(start, end)
  for (const c of SUMMONER_HOTKEY_CANDIDATES) {
    assert.ok(table.includes(`"${c.combo}"`), `missing Swift candidate ${c.combo}`)
  }
  // Quoted exact combos — "cmd+space" is a substring of "ctrl+alt+cmd+space".
  assert.equal(table.includes('"cmd+space"'), false)
  assert.equal(table.includes('"alt+space"'), false)
  assert.equal(table.includes('"ctrl+shift+space"'), false)
  assert.match(src, /召唤器（实验）…/)
  assert.match(src, /keyEquivalent: ""/)
})

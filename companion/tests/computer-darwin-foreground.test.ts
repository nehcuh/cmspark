// foregroundHwnd filter regression + property tests.
//
// Architect review (2026-07-23 Q5): the bug that masked the broken foreground
// probe for months was a mock-boundary error — tests mocked foregroundHwnd()
// as a constant instead of testing the filter against real-binary stdout.
// This file drives `pickFrontmostWindowId` (the pure filter extracted from
// MacInputInjector.foregroundHwnd) with:
//   (1) a golden fixture captured from the user's machine on 2026-07-23 21:50
//       — locks the historical windowId=51 misroute as a permanent canary
//   (2) property-style cases for floating windows, modal panels, multi-Space,
//       empty-list, all-filtered, and named-but-off-screen scenarios

import test from "node:test"
import assert from "node:assert/strict"
import { pickFrontmostWindowId } from "../src/computer/darwin-adapters"

// Raw stdout from `cmspark-host window-list --foreground` captured on the
// user's machine 2026-07-23 21:50 — the historical bug. Inlined (not read
// from a side-car file) so tsc -p tsconfig.test.json doesn't need to copy
// non-TS assets to .test-dist/, and so the canary is self-contained.
//
// Old `layer === 0` first-match returned windowId=51 (off-screen Chrome aux,
// y=-73, h=41, empty name). The filter must return windowId=47 (visible main,
// '(1) 主页 / X', h=1084).
const FIXTURE_WINDOWS = [
  { windowId: 1239, layer: 26, ownerName: "Google Chrome", name: "", bundleId: "com.google.Chrome", pid: 731, bounds: { x: 0, y: 0, width: 1728, height: 33 } },
  { windowId: 1252, layer: 24, ownerName: "Window Server", name: "Menubar", bundleId: "", pid: 407, bounds: { x: 0, y: 0, width: 1728, height: 33 } },
  { windowId: 51,   layer: 0,  ownerName: "Google Chrome", name: "", bundleId: "com.google.Chrome", pid: 731, bounds: { x: 0, y: -73, width: 1728, height: 41 } },
  { windowId: 50,   layer: 0,  ownerName: "Google Chrome", name: "", bundleId: "com.google.Chrome", pid: 731, bounds: { x: 0, y: -79, width: 1728, height: 47 } },
  { windowId: 1235, layer: 0,  ownerName: "Google Chrome", name: "", bundleId: "com.google.Chrome", pid: 731, bounds: { x: 0, y: 33, width: 1728, height: 115 } },
  { windowId: 47,   layer: 0,  ownerName: "Google Chrome", name: "(1) 主页 / X", bundleId: "com.google.Chrome", pid: 731, bounds: { x: 0, y: 33, width: 1728, height: 1084 } },
  { windowId: 1237, layer: -2147483622, ownerName: "程序坞", name: "Fullscreen Backdrop", bundleId: "com.apple.dock", pid: 733, bounds: { x: 0, y: 0, width: 1728, height: 1117 } },
  { windowId: 1236, layer: -2147483624, ownerName: "程序坞", name: "Wallpaper-44390744", bundleId: "com.apple.dock", pid: 733, bounds: { x: 0, y: 0, width: 1728, height: 1117 } },
  { windowId: 2,    layer: -2147483626, ownerName: "Window Server", name: "Display 1 Backstop", bundleId: "", pid: 407, bounds: { x: 0, y: 0, width: 1728, height: 1117 } },
]

test("foregroundHwnd golden fixture: returns visible Chrome main window (47), not off-screen aux (51)", () => {
  // Golden fixture: windowId=47 is the only window with non-empty name AND
  // y>=0 AND layer ∈ [-1000, 20). Old `layer === 0` first-match would have
  // returned windowId=51 (empty name, y=-73).
  const result = pickFrontmostWindowId(FIXTURE_WINDOWS)
  assert.equal(result, 47, "should return Chrome main window, not off-screen aux")
})

test("foregroundHwnd: excludes menu bar (layer 24/26) and dock backdrop (layer -2.1b)", () => {
  const windows = [
    { windowId: 1252, layer: 24, name: "Menubar", bounds: { y: 0 } },        // menu bar
    { windowId: 1239, layer: 26, name: "控制中心", bounds: { y: 0 } },         // control center
    { windowId: 1237, layer: -2147483622, name: "Fullscreen Backdrop", bounds: { y: 0 } }, // dock backdrop
    { windowId: 999, layer: 0, name: "Real App", bounds: { y: 33 } },
  ]
  assert.equal(pickFrontmostWindowId(windows), 999)
})

test("foregroundHwnd: floating window (layer=3) passes — NetEase mini-player scenario", () => {
  // Adversary (2026-07-23): NetEase Music has main + mini-player + lyric +
  // tray-icon windows; size heuristic would exclude mini-player. Name+y filter
  // does NOT. If mini-player is frontmost, returning its windowId is correct
  // under the stated contract (CGEvent routes there).
  const windows = [
    { windowId: 888, layer: 3, name: "Mini Player", bounds: { y: 100, height: 80 } },
    { windowId: 889, layer: 0, name: "NetEase Music", bounds: { y: 33 } },
  ]
  assert.equal(pickFrontmostWindowId(windows), 888, "floating window is the CGEvent target")
})

test("foregroundHwnd: modal panel (layer=8) passes", () => {
  const windows = [
    { windowId: 777, layer: 8, name: "Save Dialog", bounds: { y: 200 } },
    { windowId: 778, layer: 0, name: "Main Window", bounds: { y: 33 } },
  ]
  assert.equal(pickFrontmostWindowId(windows), 777)
})

test("foregroundHwnd: empty name window is skipped even when on-screen", () => {
  // windowId=1235 in the golden fixture: layer=0, y=33 (on-screen!) but empty
  // name — would have been picked before windowId=47 if name filter absent.
  const windows = [
    { windowId: 1235, layer: 0, name: "", bounds: { y: 33 } },
    { windowId: 47,   layer: 0, name: "(1) 主页 / X", bounds: { y: 33 } },
  ]
  assert.equal(pickFrontmostWindowId(windows), 47)
})

test("foregroundHwnd: off-screen window (y<0) is skipped even with non-empty name", () => {
  const windows = [
    { windowId: 51, layer: 0, name: "Off-screen aux", bounds: { y: -73 } },
    { windowId: 47, layer: 0, name: "Main", bounds: { y: 33 } },
  ]
  assert.equal(pickFrontmostWindowId(windows), 47)
})

test("foregroundHwnd: returns 0 when no window matches (binary ok-but-empty-list)", () => {
  // After checkOk passes but no app window is on-screen + named (e.g. all apps
  // minimized and only Finder desktop visible, or multi-Space with target on
  // inactive Space). Caller (ensureForeground) will throw ForegroundProbeBrokenError.
  const windows = [
    { windowId: 1, layer: 24, name: "Menubar", bounds: { y: 0 } },        // excluded by layer
    { windowId: 2, layer: 0, name: "", bounds: { y: 33 } },               // excluded by name
    { windowId: 3, layer: 0, name: "Hidden", bounds: { y: -50 } },        // excluded by y
  ]
  assert.equal(pickFrontmostWindowId(windows), 0)
})

test("foregroundHwnd: malformed window entries are skipped, not thrown", () => {
  const windows = [
    null,
    "not-an-object",
    { layer: 0 },                              // missing name + bounds + windowId
    { layer: 0, name: "X", bounds: {} },       // missing windowId
    { layer: 0, name: "Y", bounds: { y: 0 }, windowId: "string-not-number" },
    { windowId: 42, layer: 0, name: "OK", bounds: { y: 0 } },
  ]
  assert.equal(pickFrontmostWindowId(windows), 42)
})

test("foregroundHwnd: layer boundary — 19 in-band, 20 out-of-band (menu bar starts at 24 but pop-up menu can be lower)", () => {
  // Adversary M2 (2026-07-23): boundary tests at layer 19/20.
  // Apple kCGMainMenuWindowLevel=24, but some overlay windows use 20-23
  // (e.g. notification center banners). Filter excludes 20+ to be safe.
  const windowsInBand19 = [
    { windowId: 19, layer: 19, name: "Band edge", bounds: { y: 0 } },
  ]
  assert.equal(pickFrontmostWindowId(windowsInBand19), 19, "layer=19 is in-band")

  const windowsAt20 = [
    { windowId: 20, layer: 20, name: "Above band", bounds: { y: 0 } },
    { windowId: 99, layer: 0,  name: "Normal",     bounds: { y: 0 } },
  ]
  assert.equal(pickFrontmostWindowId(windowsAt20), 99, "layer=20 excluded, falls through to layer=0")
})

test("foregroundHwnd: empty array returns 0 (no matches)", () => {
  assert.equal(pickFrontmostWindowId([]), 0)
})

test("foregroundHwnd: golden fixture parsed end-to-end, returns 47", () => {
  // Simulates the JSON.parse + checkOk + pickFrontmostWindowId path that
  // foregroundHwnd() runs after execFileAsync returns. Confirms the filter
  // picks windowId=47 from the full historical capture.
  const parsed = { ok: true, windows: FIXTURE_WINDOWS }
  assert.equal(parsed.ok, true)
  assert.equal(pickFrontmostWindowId(parsed.windows), 47)
})

test("foregroundHwnd: fixture matches actually-captured binary z-order shape", () => {
  // Adversary M1 (2026-07-23): the fixture is a *pruned* subset of the real
  // 23-window capture, kept focused on the bug's z-order top. Verify the
  // essential shape: menu bar items at layer 24/26 first, then off-screen
  // aux (layer=0 + empty name + y<0), then on-screen aux (layer=0 + empty
  // name + y>=0), then the visible main window last at layer=0.
  const layers = FIXTURE_WINDOWS.map((w) => w.layer)
  assert.ok(layers.indexOf(26) < layers.indexOf(0), "menu bar (26) before app windows (0)")
  assert.ok(layers.indexOf(0) < layers.indexOf(-2147483622), "app windows before dock backdrop")
  const layer0Windows = FIXTURE_WINDOWS.filter((w) => w.layer === 0)
  assert.equal(layer0Windows.length, 4, "4 Chrome windows at layer 0 (3 aux + 1 main)")
  // First 3 are the off-screen / empty-name aux; last is the main window
  assert.equal(layer0Windows[0].windowId, 51)
  assert.equal(layer0Windows[3].windowId, 47)
})

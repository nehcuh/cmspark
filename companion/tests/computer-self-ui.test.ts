// isCompanionUiOwner — Windows path + macOS bundle-id matching.

import test from "node:test"
import assert from "node:assert/strict"
import { isCompanionUiOwner } from "../src/computer/self-ui"

const ALLOW = ["chrome", "msedge", "firefox", "brave", "arc", "opera", "cmspark-agent"]

test("Windows chrome.exe path matches", () => {
  assert.equal(
    isCompanionUiOwner(
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      ALLOW,
    ),
    true,
  )
})

test("macOS com.google.Chrome bundle id matches (3ffkgl root cause)", () => {
  // exeBasename alone would yield "com" — must still match via bundle rules.
  assert.equal(isCompanionUiOwner("com.google.Chrome", ALLOW), true)
  assert.equal(isCompanionUiOwner("com.google.chrome.canary", ALLOW), true)
})

test("macOS Edge / Firefox / Arc / Brave bundle ids match", () => {
  assert.equal(isCompanionUiOwner("com.microsoft.edgemac", ALLOW), true)
  assert.equal(isCompanionUiOwner("org.mozilla.firefox", ALLOW), true)
  assert.equal(isCompanionUiOwner("company.thebrowser.browser", ALLOW), true)
  assert.equal(isCompanionUiOwner("com.brave.browser", ALLOW), true)
})

test("WeChat / foreign apps do NOT match", () => {
  assert.equal(isCompanionUiOwner("com.tencent.xinWeChat", ALLOW), false)
  assert.equal(isCompanionUiOwner("com.apple.Safari", ALLOW), false)
  assert.equal(isCompanionUiOwner("C:\\Apps\\WeChat.exe", ALLOW), false)
})

test("null / empty never match", () => {
  assert.equal(isCompanionUiOwner(null, ALLOW), false)
  assert.equal(isCompanionUiOwner("", ALLOW), false)
  assert.equal(isCompanionUiOwner("com.google.Chrome", []), false)
})

test("cmspark-tray (Swift tray overlay) is companion UI", () => {
  // S23 / Task 12: summoner overlay lives in dist/cmspark-tray. When it
  // becomes frontmost, FOREGROUND-YIELD must treat that as our UI (process-
  // level; window-rect hit-test is P1). Empty allow-list still fail-closes.
  assert.equal(isCompanionUiOwner("cmspark-tray", ALLOW), true)
  assert.equal(
    isCompanionUiOwner("/Applications/CMspark.app/Contents/MacOS/cmspark-tray", ALLOW),
    true,
  )
  assert.equal(
    isCompanionUiOwner("C:\\Program Files\\CMspark\\cmspark-tray.exe", ALLOW),
    true,
  )
  assert.equal(isCompanionUiOwner("cmspark-tray", []), false)
})

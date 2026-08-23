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

test("cmspark-tray is NOT process-level self-UI continue (S23 window-rect instead)", () => {
  assert.equal(isCompanionUiOwner("cmspark-tray", ALLOW), false)
  assert.equal(
    isCompanionUiOwner("/Applications/CMspark.app/Contents/MacOS/cmspark-tray", ALLOW),
    false,
  )
  assert.equal(
    isCompanionUiOwner("C:\\Program Files\\CMspark\\cmspark-tray.exe", ALLOW),
    false,
  )
})

test("cmspark-tray never self-UI continues even if present on the allow-list", () => {
  const allow = [...ALLOW, "cmspark-tray"]
  assert.equal(isCompanionUiOwner("cmspark-tray", allow), false)
  assert.equal(
    isCompanionUiOwner("/Applications/CMspark.app/Contents/MacOS/cmspark-tray", allow),
    false,
  )
  assert.equal(isCompanionUiOwner("C:\\Program Files\\CMspark\\cmspark-tray.exe", allow), false)
  assert.equal(isCompanionUiOwner("chrome", allow), true)
})

test("Darwin bundle ids com.cmspark.agent/host never self-UI continue (S23 landmine)", () => {
  const allow = [...ALLOW, "cmspark-agent", "com.cmspark.agent"]
  assert.equal(isCompanionUiOwner("com.cmspark.agent", allow), false)
  assert.equal(isCompanionUiOwner("com.cmspark.host", allow), false)
  assert.equal(isCompanionUiOwner("com.cmspark.tray", allow), false)
  assert.equal(isCompanionUiOwner("com.google.Chrome", allow), true)
})

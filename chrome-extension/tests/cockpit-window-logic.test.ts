import test from "node:test"
import assert from "node:assert/strict"
import {
  COCKPIT_DEFAULT_HEIGHT,
  COCKPIT_DEFAULT_WIDTH,
  COCKPIT_PATH,
  COCKPIT_SESSION_KEY,
  isCockpitTabUrl,
} from "../src/background/cockpit-window"

test("cockpit path matches Plasmo tabs page convention", () => {
  assert.equal(COCKPIT_PATH, "tabs/cockpit.html")
})

test("cockpit default window size is usable dual-track canvas", () => {
  assert.equal(COCKPIT_DEFAULT_WIDTH, 720)
  assert.equal(COCKPIT_DEFAULT_HEIGHT, 560)
  assert.ok(COCKPIT_DEFAULT_WIDTH >= 640)
  assert.ok(COCKPIT_DEFAULT_HEIGHT >= 480)
})

test("session storage key is stable", () => {
  assert.equal(COCKPIT_SESSION_KEY, "cmspark.cockpitWindowId")
})

test("isCockpitTabUrl matches base and ignores query/hash", () => {
  const base = "chrome-extension://abc/tabs/cockpit.html"
  assert.equal(isCockpitTabUrl(base, base), true)
  assert.equal(isCockpitTabUrl(base + "?x=1", base), true)
  assert.equal(isCockpitTabUrl(base + "#frag", base), true)
  assert.equal(isCockpitTabUrl("chrome-extension://abc/tabs/other.html", base), false)
  assert.equal(isCockpitTabUrl(undefined, base), false)
})

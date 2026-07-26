import test from "node:test"
import assert from "node:assert/strict"
import {
  COCKPIT_DEFAULT_HEIGHT,
  COCKPIT_DEFAULT_WIDTH,
  COCKPIT_PATH,
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

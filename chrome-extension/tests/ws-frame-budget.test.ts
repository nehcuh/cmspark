// Service Worker refuse oversized file.upload frames before they hit companion.

import test from "node:test"
import assert from "node:assert/strict"
import { shouldRefuseWsFrame } from "../src/background/ws-frame-budget"

test("shouldRefuseWsFrame refuses a 10MB JSON payload", () => {
  assert.equal(shouldRefuseWsFrame(10 * 1024 * 1024), true)
})

test("shouldRefuseWsFrame allows an 8MB JSON payload", () => {
  assert.equal(shouldRefuseWsFrame(8 * 1024 * 1024), false)
})

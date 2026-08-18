// Service Worker refuse oversized file.upload frames before they hit companion.

import test from "node:test"
import assert from "node:assert/strict"
import { isFrameBudgetRefusal, shouldRefuseWsFrame } from "../src/background/ws-frame-budget"

test("shouldRefuseWsFrame refuses a 10MB JSON payload", () => {
  assert.equal(shouldRefuseWsFrame(10 * 1024 * 1024), true)
})

test("shouldRefuseWsFrame allows an 8MB JSON payload", () => {
  assert.equal(shouldRefuseWsFrame(8 * 1024 * 1024), false)
})

test("isFrameBudgetRefusal: only the stamped SW refusal matches (F6)", () => {
  assert.equal(
    isFrameBudgetRefusal({
      ok: false,
      diag: { sent: false, json_bytes: 11 * 1024 * 1024, over_companion_10mb: true },
    }),
    true,
  )
  assert.equal(isFrameBudgetRefusal({ ok: false, diag: { sent: false, json_bytes: 100 } }), false)
  assert.equal(isFrameBudgetRefusal({ ok: true }), false)
  assert.equal(isFrameBudgetRefusal(undefined), false)
  assert.equal(isFrameBudgetRefusal(null), false)
})

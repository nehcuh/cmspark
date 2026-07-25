// v4 Defect 3 — coords.ts unit tests.
//
// Validates the canonical coordinate-space conversion module. These are the
// pure functions that every cross-space mapping in the inject / locate /
// bounds-check paths must route through.

import test from "node:test"
import assert from "node:assert/strict"

import {
  imageToClient,
  clientToScreen,
  screenToClient,
  maybeAutoscaleImageToClient,
  rectDriftPx,
} from "../src/computer/coords"
import type { RectPx } from "../src/computer/types"

const RETINA = { imageWidth: 1760, imageHeight: 1280, scaleX: 2, scaleY: 2 }
const NON_RETINA = { imageWidth: 880, imageHeight: 640, scaleX: 1, scaleY: 1 }

test("imageToClient: divides by scale on Retina", () => {
  const got = imageToClient({ x: 722, y: 600 }, RETINA, { x: 0, y: 0, width: 880, height: 640 })
  // 722/2 = 361, 600/2 = 300 — both in client 880x640
  assert.equal(got.x, 361)
  assert.equal(got.y, 300)
})

test("imageToClient: no-op on non-Retina (scale=1)", () => {
  const got = imageToClient({ x: 100, y: 200 }, NON_RETINA, { x: 0, y: 0, width: 880, height: 640 })
  assert.equal(got.x, 100)
  assert.equal(got.y, 200)
})

test("imageToClient: subtracts clientImageRect offset", () => {
  // Title-bar offset in image space (e.g., 0,56 → content starts 56px down)
  const got = imageToClient({ x: 200, y: 300 }, RETINA, { x: 0, y: 56, width: 880, height: 584 })
  assert.equal(got.x, 100)
  assert.equal(got.y, 94) // 300/2 - 56 = 94
})

test("clientToScreen: adds window rect + client offset", () => {
  const got = clientToScreen(
    { x: 100, y: 200 },
    { x: 400, y: 300, width: 880, height: 640 },
    { x: 0, y: 28 }, // title bar 28px in screen-logical
  )
  assert.equal(got.x, 500)
  assert.equal(got.y, 528)
})

test("clientToScreen + screenToClient round-trip", () => {
  const rect = { x: 400, y: 300, width: 880, height: 640 }
  const offset = { x: 0, y: 28 }
  const original = { x: 123, y: 456 }
  const screen = clientToScreen(original, rect, offset)
  const back = screenToClient(screen, rect, offset)
  assert.equal(back.x, original.x)
  assert.equal(back.y, original.y)
})

test("maybeAutoscaleImageToClient: detects Retina-scale mismatch (unambiguous case)", () => {
  // Construct a clear retina-only mismatch: raw (1500, 600) on Retina against
  // 880x640 client. scaled = (750, 300) — in bounds. swapped = (300, 750) —
  // y=750 exceeds 640 → out of bounds. So orientation is unambiguous.
  const r = maybeAutoscaleImageToClient({ x: 1500, y: 600 }, RETINA, { x: 0, y: 0, width: 880, height: 640 })
  assert.ok(r, "expected autoscale to trigger")
  assert.equal(r!.reason, "retina-scale")
  assert.equal(r!.scaled.x, 750)
  assert.equal(r!.scaled.y, 300)
})

test("maybeAutoscaleImageToClient: user-reported (722,872) class is AMBIGUOUS — refuses autoscale", () => {
  // The actual user bug: (722, 872) against 880x640 Retina. scaled=(361,436)
  // in bounds; swapped=(436,361) also in bounds → Pi R5 ambiguous → refuse.
  // Real fix lives in executor.ts OOB diagnostic (surfaces scale info so the
  // user/LLM can reason about the mismatch), NOT in autoscale.
  const r = maybeAutoscaleImageToClient({ x: 722, y: 872 }, RETINA, { x: 0, y: 0, width: 880, height: 640 })
  assert.equal(r, null, "ambiguous orientation must NOT trigger autoscale")
})

test("maybeAutoscaleImageToClient: returns null when point already in client", () => {
  const r = maybeAutoscaleImageToClient({ x: 100, y: 100 }, RETINA, { x: 0, y: 0, width: 880, height: 640 })
  assert.equal(r, null)
})

test("maybeAutoscaleImageToClient: returns null on non-Retina (no scale to undo)", () => {
  const r = maybeAutoscaleImageToClient({ x: 9999, y: 9999 }, NON_RETINA, { x: 0, y: 0, width: 880, height: 640 })
  assert.equal(r, null)
})

test("maybeAutoscaleImageToClient: returns null when scaled point still OOB (true OOB)", () => {
  // Point way outside even after scaling
  const r = maybeAutoscaleImageToClient({ x: 5000, y: 5000 }, RETINA, { x: 0, y: 0, width: 880, height: 640 })
  assert.equal(r, null)
})

test("maybeAutoscaleImageToClient: Pi R5 — refuses when swap orientation also in bounds", () => {
  // Construct a case where both (x/sx, y/sy) and (y/sy, x/sx) are in C.
  // Client 880x640, scale 2. Raw (600, 1000): scaled (300, 500) in bounds;
  // swapped (500, 300) also in bounds → ambiguous, refuse autoscale.
  const r = maybeAutoscaleImageToClient({ x: 600, y: 1000 }, RETINA, { x: 0, y: 0, width: 880, height: 640 })
  assert.equal(r, null)
})

test("maybeAutoscaleImageToClient: returns null when client dimensions are zero", () => {
  const r = maybeAutoscaleImageToClient({ x: 100, y: 100 }, RETINA, { x: 0, y: 0, width: 0, height: 0 })
  assert.equal(r, null)
})

// ---- P3 D4.2: rectDriftPx -------------------------------------------------

test("rectDriftPx: identical rects → 0", () => {
  const r: RectPx = { x: 10, y: 20, width: 100, height: 200 }
  assert.equal(rectDriftPx(r, r), 0)
})

test("rectDriftPx: shifted x → |Δx|", () => {
  const a: RectPx = { x: 10, y: 20, width: 100, height: 200 }
  const b: RectPx = { x: 15, y: 20, width: 100, height: 200 }
  assert.equal(rectDriftPx(a, b), 5)
})

test("rectDriftPx: shifted y → |Δy|", () => {
  const a: RectPx = { x: 10, y: 20, width: 100, height: 200 }
  const b: RectPx = { x: 10, y: 17, width: 100, height: 200 }
  assert.equal(rectDriftPx(a, b), 3)
})

test("rectDriftPx: resized width → |Δw|", () => {
  const a: RectPx = { x: 10, y: 20, width: 100, height: 200 }
  const b: RectPx = { x: 10, y: 20, width: 120, height: 200 }
  assert.equal(rectDriftPx(a, b), 20)
})

test("rectDriftPx: resized height → |Δh|", () => {
  const a: RectPx = { x: 10, y: 20, width: 100, height: 200 }
  const b: RectPx = { x: 10, y: 20, width: 100, height: 175 }
  assert.equal(rectDriftPx(a, b), 25)
})

test("rectDriftPx: max-axis semantics (mix shift + resize → larger)", () => {
  // x shifts 5, width grows 30 → max(5, 0, 30, 0) = 30
  const a: RectPx = { x: 10, y: 20, width: 100, height: 200 }
  const b: RectPx = { x: 15, y: 20, width: 130, height: 200 }
  assert.equal(rectDriftPx(a, b), 30)
})

test("rectDriftPx: negative deltas handled (abs)", () => {
  // x shrinks by 8 (a.x=10, b.x=2) → |Δx|=8
  const a: RectPx = { x: 10, y: 20, width: 100, height: 200 }
  const b: RectPx = { x: 2, y: 20, width: 100, height: 200 }
  assert.equal(rectDriftPx(a, b), 8)
})

test("rectDriftPx: symmetric (a,b) === (b,a)", () => {
  const a: RectPx = { x: 10, y: 20, width: 100, height: 200 }
  const b: RectPx = { x: 50, y: 80, width: 70, height: 250 }
  assert.equal(rectDriftPx(a, b), rectDriftPx(b, a))
})

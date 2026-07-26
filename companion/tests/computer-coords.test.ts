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

test("imageToClient: subtracts client-logical offset", () => {
  // Client-logical y offset (e.g., 56px content start below title bar).
  // Image-space y=300 on retina scale=2 → logical 150; subtract client.y=56 → 94.
  const got = imageToClient({ x: 200, y: 300 }, RETINA, { x: 0, y: 56, width: 880, height: 584 })
  assert.equal(got.x, 100)
  assert.equal(got.y, 94) // 300/2 - 56 = 94
})

test("imageToClient: P4 WeChat-failure class — image-y ~1004 on retina client 880x640", () => {
  // Reproduces the (269.30, 1004.65) outside client rect 880x640 false OOB.
  // scale=2, client logical (0, 0, 880, 640). Image (1348, 1004) is INSIDE
  // the retina PNG (1760x1280) but image-y/2 = 502, well inside client 640.
  const got = imageToClient({ x: 1348, y: 1004 }, RETINA, { x: 0, y: 0, width: 880, height: 640 })
  assert.equal(got.x, 674) // 1348/2 = 674
  assert.equal(got.y, 502) // 1004/2 = 502 — INSIDE client (NOT 1004 or 964)
})

test("imageToClient: non-retina matches legacy math (scale=1 ≡ p.x - client.x)", () => {
  // Pins the scale=1 invariant: when no retina metadata is present, the new
  // formula is algebraically identical to the pre-P4 legacy formula.
  // Any OCR hit on a non-retina display must produce the same pointClient
  // before and after P4.
  const got = imageToClient({ x: 200, y: 300 }, NON_RETINA, { x: 10, y: 40, width: 870, height: 600 })
  assert.equal(got.x, 190) // 200 - 10 = 190 (legacy equivalent)
  assert.equal(got.y, 260) // 300 - 40 = 260
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

test("maybeAutoscaleImageToClient: (722,872) inside image bounds → Retina autoscale", () => {
  // Historical user bug class: (722, 872) against 880×640 Retina. With image
  // dims present (1760×1280), raw is a valid PNG pixel → divide by scale.
  // (Previously refused as "swap-ambiguous"; that check disabled autoscale on
  // landscape windows entirely — see WeChat (500,650) vs 1324×640.)
  const r = maybeAutoscaleImageToClient({ x: 722, y: 872 }, RETINA, { x: 0, y: 0, width: 880, height: 640 })
  assert.ok(r, "image-contained OOB should autoscale")
  assert.equal(r!.reason, "retina-scale")
  assert.equal(r!.scaled.x, 361)
  assert.equal(r!.scaled.y, 436)
})

test("maybeAutoscaleImageToClient: WeChat (500,650) on 1324×640 @2x → autoscale", () => {
  // Live failure 2026-07-25: swap-of-scaled check refused because both
  // (250,325) and (325,250) fit a wide client. Image containment wins.
  const scales = { imageWidth: 2648, imageHeight: 1280, scaleX: 2, scaleY: 2 }
  const r = maybeAutoscaleImageToClient({ x: 500, y: 650 }, scales, { x: 0, y: 0, width: 1324, height: 640 })
  assert.ok(r)
  assert.equal(r!.scaled.x, 250)
  assert.equal(r!.scaled.y, 325)
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

test("maybeAutoscaleImageToClient: Pi R5 — without image dims, refuses swap-ambiguous", () => {
  // No image dims → weak path: both scaled and swap-scaled fit C → refuse.
  const noImage = { imageWidth: 0, imageHeight: 0, scaleX: 2, scaleY: 2 }
  const r = maybeAutoscaleImageToClient({ x: 600, y: 1000 }, noImage, { x: 0, y: 0, width: 880, height: 640 })
  assert.equal(r, null)
})

test("maybeAutoscaleImageToClient: with image dims, (600,1000) inside image → autoscale", () => {
  // Same point with RETINA image 1760×1280: 1000 < 1280 → image-contained.
  const r = maybeAutoscaleImageToClient({ x: 600, y: 1000 }, RETINA, { x: 0, y: 0, width: 880, height: 640 })
  assert.ok(r)
  assert.equal(r!.scaled.x, 300)
  assert.equal(r!.scaled.y, 500)
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

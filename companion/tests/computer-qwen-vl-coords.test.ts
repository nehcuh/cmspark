// L-QW-3 revised 2026-09-07 (#423): Qwen3-VL ALWAYS emits relative [0,1000]
// coordinates of the original image — normalize maps to pixels, then clamps.

import test from "node:test"
import assert from "node:assert/strict"
import { normalizeQwenVlPoint } from "../src/computer/qwen-vl-coords"

test("normalize: relative [0,1000] maps to image pixels", () => {
  // 500/1000 → mid-image on any size
  assert.deepEqual(normalizeQwenVlPoint(500, 500, 1920, 1080), { x: 960, y: 540 })
  assert.deepEqual(normalizeQwenVlPoint(500, 500, 640, 480), { x: 320, y: 240 })
  assert.deepEqual(normalizeQwenVlPoint(0, 0, 640, 480), { x: 0, y: 0 })
  assert.deepEqual(normalizeQwenVlPoint(1000, 1000, 640, 480), { x: 639, y: 479 })
})

test("normalize: in-bounds-looking values still map (they are NOT pixels)", () => {
  // #423 d2: raw x=174 on a 640-wide image means 174/1000·640 ≈ 111
  assert.deepEqual(normalizeQwenVlPoint(174, 454, 640, 480), { x: 111, y: 218 })
  // raw x=800 (> width) is a normal [0,1000] value, not an out-of-bounds pixel
  assert.deepEqual(normalizeQwenVlPoint(800, 260, 640, 480), { x: 512, y: 125 })
})

test("normalize: out-of-range values map then clamp (safety net)", () => {
  assert.deepEqual(normalizeQwenVlPoint(3000, 2000, 1920, 1080), { x: 1919, y: 1079 })
  assert.deepEqual(normalizeQwenVlPoint(-50, 1200, 640, 480), { x: 0, y: 479 })
})

test("normalize: invalid size → 0,0", () => {
  assert.deepEqual(normalizeQwenVlPoint(10, 10, 0, 100), { x: 0, y: 0 })
})

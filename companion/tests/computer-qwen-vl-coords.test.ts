// L-QW-3 / SoT D3: pixel-only normalize — never false-scale 0–1000 on wide images.

import test from "node:test"
import assert from "node:assert/strict"
import { normalizeQwenVlPoint } from "../src/computer/qwen-vl-coords"

test("normalize: wide 1920×1080 in-bounds pixels stay absolute", () => {
  const cases: Array<[number, number]> = [
    [200, 50],
    [640, 360],
    [1000, 1000],
    [1919, 1079],
    [0, 0],
  ]
  for (const [x, y] of cases) {
    const r = normalizeQwenVlPoint(x, y, 1920, 1080)
    assert.equal(r.x, x, `x=${x}`)
    assert.equal(r.y, y, `y=${y}`)
  }
})

test("normalize: out-of-bounds clamps, does not rescale via 1000", () => {
  const r = normalizeQwenVlPoint(3000, 2000, 1920, 1080)
  assert.equal(r.x, 1919)
  assert.equal(r.y, 1079)
})

test("normalize: invalid size → 0,0", () => {
  assert.deepEqual(normalizeQwenVlPoint(10, 10, 0, 100), { x: 0, y: 0 })
})

/**
 * #260 — kaldi-style 80-dim log-mel fbank for the speaker-embedding front-end.
 * Pure; deterministic; 16kHz mono input.
 */
import test from "node:test"
import assert from "node:assert/strict"

import {
  computeFbank,
  FBANK_NUM_BINS,
  FBANK_FRAME_MS,
  FBANK_SHIFT_MS,
  cmnOverTime,
} from "../src/meeting/fbank"

function sine(f: number, seconds: number, sr = 16000, amp = 0.5): Float32Array {
  const n = Math.floor(seconds * sr)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin((2 * Math.PI * f * i) / sr)
  return out
}

test("constants match the pinned front-end (80 bins, 25ms/10ms)", () => {
  assert.equal(FBANK_NUM_BINS, 80)
  assert.equal(FBANK_FRAME_MS, 25)
  assert.equal(FBANK_SHIFT_MS, 10)
})

test("shape: 1s @16k → 98 frames × 80 bins", () => {
  const f = computeFbank(sine(1000, 1))
  assert.equal(f.length, 98)
  assert.equal(f[0]!.length, 80)
})

test("shape: short input (<1 frame) → single frame", () => {
  const f = computeFbank(new Float32Array(300))
  assert.equal(f.length, 1)
})

test("silence → finite, near-constant frames (log floor)", () => {
  const f = computeFbank(new Float32Array(16000))
  assert.equal(f.length, 98)
  for (const row of f) {
    for (const v of row) assert.ok(Number.isFinite(v), "finite fbank value")
  }
  // silence floor identical across frames
  assert.deepEqual(Array.from(f[0]!), Array.from(f[50]!))
})

test("1kHz sine peaks at a higher mel bin than 300Hz sine", () => {
  const f1k = computeFbank(sine(1000, 0.5))
  const f300 = computeFbank(sine(300, 0.5))
  const peak = (rows: Float32Array[]) => {
    let best = 0
    let bestV = -Infinity
    const mid = rows[Math.floor(rows.length / 2)]!
    for (let i = 0; i < mid.length; i++) {
      if (mid[i]! > bestV) {
        bestV = mid[i]!
        best = i
      }
    }
    return best
  }
  assert.ok(peak(f1k) > peak(f300), `1k bin ${peak(f1k)} must exceed 300Hz bin ${peak(f300)}`)
})

test("deterministic: same input → identical output", () => {
  const x = sine(440, 0.3)
  const a = computeFbank(x)
  const b = computeFbank(x)
  assert.deepEqual(
    a.map((r) => Array.from(r)),
    b.map((r) => Array.from(r)),
  )
})

test("cmnOverTime subtracts per-bin time mean", () => {
  const rows = [
    new Float32Array([1, 2]),
    new Float32Array([3, 4]),
  ]
  const out = cmnOverTime(rows)
  assert.deepEqual(Array.from(out[0]!), [-1, -1])
  assert.deepEqual(Array.from(out[1]!), [1, 1])
})

test("cmnOverTime empty → empty", () => {
  assert.equal(cmnOverTime([]).length, 0)
})

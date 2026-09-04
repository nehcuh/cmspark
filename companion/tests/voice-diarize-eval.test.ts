// #260 — eval-gate metrics: 人数估计正确率 + 段级标签纯度 + 显著优于 baseline 门。
// 纯函数；harness（合成音频、ONNX 双臂对比）在 scripts/diarize-eval.mjs。

import test from "node:test"
import assert from "node:assert/strict"

import {
  DIARIZE_EVAL_PURITY_MARGIN,
  segmentPurity,
  significantlyBetter,
  speakerCountAccuracy,
} from "../src/voice/diarize-eval"

test("speakerCountAccuracy: exact-match fraction", () => {
  assert.equal(speakerCountAccuracy([2, 3, 2, 3], [2, 3, 2, 2]), 0.75)
  assert.equal(speakerCountAccuracy([3, 3], [2, 2]), 0)
  assert.equal(speakerCountAccuracy([2, 2], [2, 2]), 1)
})

test("speakerCountAccuracy: empty or mismatched input → 0", () => {
  assert.equal(speakerCountAccuracy([], []), 0)
  assert.equal(speakerCountAccuracy([2], [2, 2]), 0)
})

test("segmentPurity: perfect clusters → 1 even with permuted labels", () => {
  // 预测 [0,0,1,1] vs 真值 [7,7,9,9]：编号无关，纯度满分
  assert.equal(segmentPurity([0, 0, 1, 1], [7, 7, 9, 9]), 1)
})

test("segmentPurity: mixed cluster penalized", () => {
  // 预测把两个说话人各一段混进同一簇：2/4 命中 + 0/4 → 0.5
  assert.equal(segmentPurity([0, 0, 1, 1], [0, 1, 0, 1]), 0.5)
  assert.equal(segmentPurity([0, 0], [0, 1]), 0.5)
})

test("segmentPurity: split speaker (over-clustering) also penalized", () => {
  // 真值全同一个人，预测拆成两簇：每簇 max overlap=各占一半 → 1/2... sum=2, N=4? no:
  // clusters {0:[2],1:[2]} → agreed=2+2? overlap: 0|A=2, 1|A=2 → maxes 2,2 → 4/4=1
  // 一个说话人被拆成多簇 purity 仍是 1（purity 只罚混簇，不罚过拆）——
  // 这正是需要 countAccuracy 配对的原因。
  assert.equal(segmentPurity([0, 1, 0, 1], [5, 5, 5, 5]), 1)
})

test("segmentPurity: empty or mismatched → 0", () => {
  assert.equal(segmentPurity([], []), 0)
  assert.equal(segmentPurity([0], [0, 1]), 0)
})

test("significantlyBetter: strictly better on purity by margin passes", () => {
  assert.equal(
    significantlyBetter(
      { countAccuracy: 1, purity: 0.9, segments: 12 },
      { countAccuracy: 1, purity: 0.5, segments: 12 },
    ),
    true,
  )
})

test("significantlyBetter: better on count alone also passes", () => {
  assert.equal(
    significantlyBetter(
      { countAccuracy: 1, purity: 0.8, segments: 12 },
      { countAccuracy: 0.5, purity: 0.8, segments: 12 },
    ),
    true,
  )
})

test("significantlyBetter: regress on either metric fails", () => {
  assert.equal(
    significantlyBetter(
      { countAccuracy: 1, purity: 0.7, segments: 12 },
      { countAccuracy: 1, purity: 0.8, segments: 12 },
    ),
    false,
  )
  assert.equal(
    significantlyBetter(
      { countAccuracy: 0.5, purity: 0.9, segments: 12 },
      { countAccuracy: 1, purity: 0.5, segments: 12 },
    ),
    false,
  )
})

test("significantlyBetter: ties on both (no margin gain) fail the gate", () => {
  assert.equal(
    significantlyBetter(
      { countAccuracy: 1, purity: 1, segments: 12 },
      { countAccuracy: 1, purity: 1, segments: 12 },
    ),
    false,
  )
})

test("significantlyBetter: sub-margin gain fails (margin respected)", () => {
  const e = { countAccuracy: 1, purity: 1 - DIARIZE_EVAL_PURITY_MARGIN / 2, segments: 12 }
  const b = { countAccuracy: 1, purity: 1 - DIARIZE_EVAL_PURITY_MARGIN, segments: 12 }
  assert.equal(significantlyBetter(e, b), false)
})

test("significantlyBetter: zero-segment runs never pass", () => {
  assert.equal(
    significantlyBetter(
      { countAccuracy: 1, purity: 1, segments: 0 },
      { countAccuracy: 0, purity: 0, segments: 12 },
    ),
    false,
  )
})

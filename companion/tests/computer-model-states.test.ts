// Model state / switch copy + license door smoke (Qwen3-VL path).
// TinyClick ONNX download/manifest paths removed; keep message vocabulary + switch copy.

import test from "node:test"
import assert from "node:assert/strict"

import { MODEL_STATE_MESSAGES, modelStateMessage } from "../src/computer/model-state-messages"

test("三态 code 与文案 title 两两不同（UI 可分别呈现）", () => {
  const codes = ["model-file-missing", "model-hash-mismatch", "network-error"]
  assert.strictEqual(new Set(codes).size, 3)
  const titles = codes.map((c) => modelStateMessage(c).title)
  assert.strictEqual(new Set(titles).size, 3)
})

test("文案表覆盖常见不可用 reason（含历史 download/gate 词表，供 UI 兜底）", () => {
  const expected = [
    "model-unknown",
    "variant-unknown",
    "mirror-scheme-denied",
    "disk-budget-exceeded",
    "disk-full",
    "http-error",
    "network-error",
    "hash-mismatch",
    "size-mismatch",
    "oversize-stream",
    "model-file-missing",
    "model-hash-mismatch",
    "sha256-mismatch",
    "model-size-mismatch",
    "manifest-invalid",
    "manifest-source-remote",
  ]
  for (const reason of expected) {
    assert.ok(MODEL_STATE_MESSAGES[reason], `文案表缺 reason: ${reason}`)
  }
})

test("全部文案 detail 均含「不受影响」降级叙事", () => {
  for (const [reason, msg] of Object.entries(MODEL_STATE_MESSAGES)) {
    assert.ok(msg.detail.includes("不受影响"), `${reason} 的 detail 缺降级叙事`)
  }
})

test("未知 reason → 兜底文案不崩溃", () => {
  const msg = modelStateMessage("some-future-reason")
  assert.strictEqual(msg.title, "模型层不可用")
  assert.ok(msg.detail.includes("some-future-reason"))
})

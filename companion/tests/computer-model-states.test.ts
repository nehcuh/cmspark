// Model state / switch copy + license door smoke (Qwen3-VL path).
// TinyClick ONNX download/manifest paths removed; keep message vocabulary + switch copy.

import test from "node:test"
import assert from "node:assert/strict"

import { MODEL_STATE_MESSAGES, modelStateMessage, MODEL_SWITCH_COPY } from "../src/computer/model-state-messages"
import { LICENSE_DOOR_TEXT } from "../src/computer/model-license"

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

test("MODEL_SWITCH_COPY：全字段齐备非空", () => {
  for (const key of [
    "switchLabel",
    "switchHint",
    "masterOffHint",
    "appNotAllowedHint",
    "layerSemantics",
    "licenseDoorHint",
    "firstLoadTimeline",
    "switchRunningNote",
    "statusReadyEnabled",
    "statusReadyDisabled",
    "downloadInProgress",
    "licenseDeclinedNotice",
  ] as const) {
    assert.ok(typeof MODEL_SWITCH_COPY[key] === "string" && MODEL_SWITCH_COPY[key].length > 0, `${key} 为空`)
  }
})

test("LICENSE_DOOR_TEXT 与开关文案默认关闭叙事一致", () => {
  assert.ok(LICENSE_DOOR_TEXT.includes("默认关闭"), "LICENSE_DOOR_TEXT 须同为默认关闭叙事")
})

test("开关文案不与 LICENSE_DOOR_TEXT 矛盾：人工确认条款双源一致", () => {
  assert.ok(LICENSE_DOOR_TEXT.includes("人工确认"))
})

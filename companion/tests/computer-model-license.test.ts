// Qwen3-VL license door + notices smoke.

import test from "node:test"
import assert from "node:assert/strict"

import {
  LICENSE_DOOR_TEXT,
  LICENSE_DOOR_TEXT_HASH,
  THIRD_PARTY_NOTICES_TEXT,
} from "../src/computer/model-license"

test("LICENSE_DOOR_TEXT 覆盖 Qwen3-VL 关键条款", () => {
  assert.ok(LICENSE_DOOR_TEXT.includes("Qwen3-VL"))
  assert.ok(LICENSE_DOOR_TEXT.includes("Hugging Face"))
  assert.ok(LICENSE_DOOR_TEXT.includes("2B"))
  assert.ok(LICENSE_DOOR_TEXT.includes("默认关闭") || LICENSE_DOOR_TEXT.includes("可选实验层"))
  assert.ok(LICENSE_DOOR_TEXT.includes("人工确认"))
  assert.ok(LICENSE_DOOR_TEXT.includes("跳过"))
  assert.ok(LICENSE_DOOR_TEXT.includes("复位") || LICENSE_DOOR_TEXT.includes("设置页"))
  assert.equal(LICENSE_DOOR_TEXT.includes("永久跳过"), false)
  assert.ok(LICENSE_DOOR_TEXT.includes("UIA"))
})

test("LICENSE_DOOR_TEXT_HASH 稳定 12 hex", () => {
  assert.match(LICENSE_DOOR_TEXT_HASH, /^[0-9a-f]{12}$/)
})

test("THIRD_PARTY_NOTICES 覆盖 Qwen3-VL 与 Cairn 声明", () => {
  assert.ok(THIRD_PARTY_NOTICES_TEXT.includes("Qwen3-VL"))
  assert.ok(THIRD_PARTY_NOTICES_TEXT.includes("Cairn"))
  assert.equal(THIRD_PARTY_NOTICES_TEXT.includes("TinyClick"), false)
})

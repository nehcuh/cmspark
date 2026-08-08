import test from "node:test"
import assert from "node:assert/strict"
import {
  longestCommonPrefix,
  promoteStableByAgreement,
  stabilizeHypothesis,
} from "../src/sidepanel/voice/stream-stabilize"

test("longestCommonPrefix", () => {
  assert.equal(longestCommonPrefix("你好世界", "你好啊"), "你好")
  assert.equal(longestCommonPrefix("abc", "xyz"), "")
})

test("stabilize first hypothesis is interim only", () => {
  const r = stabilizeHypothesis("", "打开设置页面")
  assert.equal(r.stable, "")
  assert.equal(r.interim, "打开设置页面")
  assert.equal(r.newlyStable, "")
})

test("promoteStableByAgreement grows stable on agreement", () => {
  const r1 = promoteStableByAgreement("", "", "打开设置")
  assert.equal(r1.interim, "打开设置")
  const r2 = promoteStableByAgreement(r1.stable, "打开设置", "打开设置页面")
  assert.equal(r2.stable, "打开设置")
  assert.equal(r2.newlyStable, "打开设置")
  assert.equal(r2.interim, "页面")
})

test("promote retreats on revision", () => {
  const r = promoteStableByAgreement("打开设置", "打开设置页面", "打开窗口")
  assert.equal(r.stable, "打开")
  assert.ok(r.interim.includes("窗口") || r.interim.startsWith("窗"))
})

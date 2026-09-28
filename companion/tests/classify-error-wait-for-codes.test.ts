import test from "node:test"
import assert from "node:assert/strict"
import { classifyError } from "../src/security"

/**
 * #554 dual-review claude 的 BLOCKING：wait_for 新增的两条 coded error 若**不登记**
 * 在 security.ts 的 recoverable 名单里，会落进默认桶 non_recoverable → adapter 直接
 * shouldStop / security_halt 整轮终止。
 *
 * 而修复前同场景是「吞异常 → 报 timeout → recoverable → 可重试」。也就是说：
 * 不登记就等于把「可重试的错误归因」悄悄变成「整轮死亡」——未声明的行为变更。
 * 本文件把「必须登记」这件事钉住，并用一个反证说明默认桶确实危险。
 */

test("#554 WAIT_PROBE_FAILED is recoverable even when the copy misses every substring", () => {
  // 刻意让文案躲开 recoverable 子串表（不含 timeout / not found / attach 等），
  // 这样唯一能救它的就是「error_code 已登记」。
  const msg = "WAIT_PROBE_FAILED: 探测通道不可用"
  assert.equal(
    classifyError(msg, { toolName: "wait_for", error_code: "WAIT_PROBE_FAILED" }),
    "recoverable",
  )
})

test("#554 WAIT_TIMEOUT is recoverable by code, not only by its wording", () => {
  const msg = "WAIT_TIMEOUT: 条件未满足"
  assert.equal(
    classifyError(msg, { toolName: "wait_for", error_code: "WAIT_TIMEOUT" }),
    "recoverable",
  )
})

test("#554 real probe-failure copy stays recoverable (the shape we actually emit)", () => {
  const msg =
    "CDP_ATTACH_FAILED: selector probe failed on both channels — cdp: Debugger attach failed for tab 7: x; scripting: Cannot access contents of the page"
  assert.equal(classifyError(msg, { toolName: "wait_for", error_code: "CDP_ATTACH_FAILED" }), "recoverable")
})

test("#554 counter-proof: an UNREGISTERED code with neutral copy lands in non_recoverable", () => {
  // 反证：这正是「忘了登记」的后果 —— 默认桶是 non_recoverable，会整轮终止。
  assert.equal(
    classifyError("SOME_UNREGISTERED_CODE: 中性文案", { toolName: "wait_for", error_code: "SOME_UNREGISTERED_CODE" }),
    "non_recoverable",
  )
})

import fs from "node:fs"
import path from "node:path"
import test from "node:test"
import assert from "node:assert/strict"
import { classifyError } from "../src/security"

/**
 * #554 dual-review claude 的 BLOCKING：wait_for 新增的 coded error 若没被处理，会落进
 * 默认桶 **non_recoverable** → adapter 直接 shouldStop / security_halt，整轮终止。
 * 而修复前同场景是「吞异常 → 报 timeout → recoverable → 可重试」，所以这等于把
 * 「可重试的错误归因」悄悄换成「整轮死亡」。
 *
 * 设计：判定走 **error_code 显式分支**，不走 recoverable 子串表。
 * 理由（dual-review pi）：子串表要求 message 里出现 code 名（`codedToolError` 的
 * `"${CODE}: "` 前缀），即判定依赖**文案形态** —— 谁改了前缀就会静默退回整轮终止。
 * 显式分支让判定与文案解耦，也是本文件既有的写法。
 *
 * 因此本文件用**完全中性**的 message（连 code 名都不含）来测 —— 那才是真正证明
 * 「只靠 code 生效」。若哪天有人把分支挪回子串表，这些用例立刻变红。
 */

test("#554 WAIT_PROBE_FAILED is recoverable from error_code alone (message fully neutral)", () => {
  assert.equal(
    classifyError("完全中性的文案，不含任何码名与关键字", {
      toolName: "wait_for",
      error_code: "WAIT_PROBE_FAILED",
    }),
    "recoverable",
  )
})

test("#554 WAIT_TIMEOUT is recoverable from error_code alone (message fully neutral)", () => {
  assert.equal(
    classifyError("完全中性的文案，不含任何码名与关键字", {
      toolName: "wait_for",
      error_code: "WAIT_TIMEOUT",
    }),
    "recoverable",
  )
})

test("#554 emitted form (with the coded prefix) is recoverable too", () => {
  // 生产形态：codedToolError 产出 "${CODE}: ${message}"。
  assert.equal(
    classifyError('WAIT_PROBE_FAILED: selector probe failed on both channels', {
      toolName: "wait_for",
      error_code: "WAIT_PROBE_FAILED",
    }),
    "recoverable",
  )
  assert.equal(
    classifyError('WAIT_TIMEOUT: timeout after 12000ms waiting for selector "#app" to be visible', {
      toolName: "wait_for",
      error_code: "WAIT_TIMEOUT",
    }),
    "recoverable",
  )
})

test("#554 counter-proof: an UNREGISTERED code with neutral copy lands in non_recoverable", () => {
  // 反证「处理与否就是关键变量」：同样的中性文案，只因 code 未被处理，结论就相反 ——
  // 未处理者落默认桶 non_recoverable，会整轮终止。
  assert.equal(
    classifyError("完全中性的文案，不含任何码名与关键字", {
      toolName: "wait_for",
      error_code: "SOME_UNREGISTERED_CODE",
    }),
    "non_recoverable",
  )
})

test("#554 verdict does not depend on the message shape at all", () => {
  // 同一 code、四种截然不同的文案形态 —— 结论必须一致。
  // 这正是「与文案解耦」的可执行定义。
  const shapes = [
    "",
    "完全中性",
    "WAIT_PROBE_FAILED: selector probe failed on both channels",
    "timeout not found attach failed cannot access disconnected", // 塞满既有子串
    // 抢占风险面本身：这几条若被页面写进 message 且 code 缺失，会判成 security。
    "Security Block: page says halt",
    "blocked by user",
    "user denied",
    "cookie domain mismatch",
  ]
  for (const msg of shapes) {
    assert.equal(
      classifyError(msg, { toolName: "wait_for", error_code: "WAIT_PROBE_FAILED" }),
      "recoverable",
      `形态 ${JSON.stringify(msg)} 下结论应一致`,
    )
  }
})

/**
 * NIT③（dual-review pi）：上面的行为用例只能**单向**钉住「单一判定路径」——
 * 注销显式分支必红，但若有人把 wait_probe_failed / wait_timeout 加回 recoverable
 * **子串表**，不会有任何用例变红（显式分支先返回）。那会重新引入「判定依赖文案形态」
 * 这一被刻意移除的性质。故补一条**源码结构守卫**。
 */
test("#554 the two codes must NOT be re-added to the recoverable substring table", () => {
  const srcFile = (...parts: string[]): string => {
    const candidates = [
      path.join(__dirname, "..", "..", "src", ...parts),
      path.join(process.cwd(), "src", ...parts),
    ]
    for (const p of candidates) if (fs.existsSync(p)) return p
    throw new Error(`source not found: ${candidates.join(" | ")}`)
  }
  const src = fs.readFileSync(srcFile("security.ts"), "utf8")
  const tableStart = src.indexOf("const recoverable = [")
  assert.ok(tableStart > 0, "找不到 recoverable 子串表")
  const tableEnd = src.indexOf("]", tableStart)
  const table = src.slice(tableStart, tableEnd)
  for (const code of ["wait_probe_failed", "wait_timeout"]) {
    assert.equal(
      table.includes(code),
      false,
      `${code} 不应出现在 recoverable 子串表里 —— 判定走 error_code 显式分支，两处并存会造成「改一处不红」的冗余`,
    )
  }
})

test("#556 N5: IMAGE_FETCH_FAILED is recoverable by code (restores the lost recoverability)", () => {
  // 补码之前它靠文案里的 "429"/"503"/"timeout" 子串侥幸判 recoverable；
  // 换成自有文案后静默变成 non_recoverable → 整轮终止。显式登记后与文案解耦。
  assert.equal(
    classifyError("完全中性的文案，不含任何码名与关键字", {
      toolName: "analyze_image_fetch",
      error_code: "IMAGE_FETCH_FAILED",
    }),
    "recoverable",
  )
  // 反证：同一个中性文案、换成未登记的码 → 仍落 non_recoverable
  assert.equal(
    classifyError("完全中性的文案，不含任何码名与关键字", {
      toolName: "analyze_image_fetch",
      error_code: "SOME_OTHER_UNREGISTERED",
    }),
    "non_recoverable",
  )
})

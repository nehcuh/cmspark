import test from "node:test"
import assert from "node:assert/strict"
import { classifyError } from "../src/security"

/**
 * #554 dual-review claude 的 BLOCKING：wait_for 新增的 coded error 若**不登记**
 * 在 security.ts 的 recoverable 名单里，会被判成 **non_recoverable** → adapter
 * 直接 shouldStop / security_halt，整轮终止。而修复前同场景是「吞异常 → 报
 * timeout → recoverable → 可重试」，所以不登记等于把「可重试的错误归因」悄悄
 * 变成「整轮死亡」。
 *
 * 机制澄清（写用例时发现的）：`classifyError` 主要按 **errorMessage 的子串**匹配，
 * `context.error_code` 只用于少数显式分支。而 `codedToolError()` 产出的真实形态是
 * `"${CODE}: ${message}"` —— 所以登记为 `"wait_probe_failed"` 后，真实 message 里的
 * 那段子串就会命中它。用例因此必须用**真实产出形态**，否则测的不是生产路径。
 */

/** 生产形态：codedToolError 把 code 前缀拼进 message。 */
const asEmitted = (code: string, tail: string) => `${code}: ${tail}`

test("#554 WAIT_PROBE_FAILED emitted form is recoverable (this is the BLOCKING fix)", () => {
  // 尾部刻意中性：不含 timeout / not found / attach 等任何既有 recoverable 子串，
  // 于是唯一能救它的就是「wait_probe_failed 已被登记」。
  const msg = asEmitted("WAIT_PROBE_FAILED", "探测通道不可用")
  assert.equal(
    /timeout|not found|attach|cannot access|disconnect|element not visible/i.test(msg.replace(/^WAIT_PROBE_FAILED: /, "")),
    false,
    "前提：除 code 前缀外不含任何 recoverable 子串，否则本用例测不到「登记」",
  )
  assert.equal(classifyError(msg, { toolName: "wait_for", error_code: "WAIT_PROBE_FAILED" }), "recoverable")
})

test("#554 WAIT_TIMEOUT emitted form is recoverable (belt and braces)", () => {
  // 这条**同时**靠两重保险：文案里有 "timeout" 子串，且已显式登记该码。
  // 如实标注：即便不登记它也会因 "timeout" 通过；登记的价值是让它不依赖文案措辞
  // （将来谁改了文案也不会把它变成 non_recoverable）。
  const msg = asEmitted("WAIT_TIMEOUT", "timeout after 12000ms waiting for selector \"#app\" to be visible")
  assert.equal(classifyError(msg, { toolName: "wait_for", error_code: "WAIT_TIMEOUT" }), "recoverable")
})

test("#554 the real probe-failure copy stays recoverable", () => {
  const msg =
    "CDP_ATTACH_FAILED: selector probe failed on both channels — cdp: Debugger attach failed for tab 7: x; scripting: scripting probe: the page raised an exception while evaluating the selector"
  assert.equal(classifyError(msg, { toolName: "wait_for", error_code: "CDP_ATTACH_FAILED" }), "recoverable")
})

test("#554 counter-proof: dropping the registration flips the verdict to non_recoverable", () => {
  // 反证「登记就是关键变量」：同一条（除 code 前缀外）中性的消息，只有 code 名不同，
  // 结论就相反 —— 未登记的码落默认桶 non_recoverable，会整轮终止。
  assert.equal(
    classifyError(asEmitted("SOME_UNREGISTERED_CODE", "探测通道不可用"), {
      toolName: "wait_for",
      error_code: "SOME_UNREGISTERED_CODE",
    }),
    "non_recoverable",
  )
  assert.equal(
    classifyError(asEmitted("WAIT_PROBE_FAILED", "探测通道不可用"), {
      toolName: "wait_for",
      error_code: "WAIT_PROBE_FAILED",
    }),
    "recoverable",
  )
})

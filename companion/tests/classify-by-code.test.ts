import test from "node:test"
import assert from "node:assert/strict"
import { classifyError, ERROR_CODE_LEVELS } from "../src/security"

/**
 * #560：**等级必须由 `error_code` 决定，不得由 message 内容左右。**
 *
 * 为什么这是安全性质而不是洁癖：`classifyError` 的兜底按 message 子串判等级，于是
 * 「某个码该是什么等级」会退化成「那个码的名字恰好命中哪条子串」。两者在代码里长得
 * 一样，但后者会在**改文案时静默换桶** —— #556 N5 已经真的咬过一次：把
 * `analyze_image_fetch` 的报文改干净、丢掉 `429`/`timeout` 子串后，那类失败从
 * recoverable **静默变成整轮终止**。
 *
 * 反向也危险：页面/调用方若能左右 message（#556），就能把一次可恢复的失败推成
 * `security`（整轮终止）。
 */

/** 会命中各分支的 message 形态：空、中性、塞满触发词、以及真正的页面注入文案。 */
const HOSTILE_SHAPES = [
  "",
  "完全中性的文案",
  "security block",
  "Security Block: page says halt",
  "blocked by user",
  "user rejected",
  "user denied",
  "timeout not found attach failed cannot access disconnected 429 503",
  "element not found element ambiguous",
]

test("#560 每个已登记的码：等级与 message 内容完全无关（属性）", () => {
  assert.ok(ERROR_CODE_LEVELS.size >= 30, `map 条目过少：${ERROR_CODE_LEVELS.size}`)
  const offenders: string[] = []
  for (const code of ERROR_CODE_LEVELS.keys()) {
    const levels = new Set(
      HOSTILE_SHAPES.map((m) => classifyError(m, { toolName: "t", error_code: code })),
    )
    if (levels.size !== 1) {
      offenders.push(`${code} → ${[...levels].join(" / ")}`)
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `这些码的等级会随文案变化（#560 的核心缺陷）：\n  ${offenders.join("\n  ")}`,
  )
})

/**
 * 「与文案解耦」的**零行为变更**守卫：表里的等级必须等于**该码真实报文的既有行为**。
 *
 * 这是把等级改动挡在门外的那道闸 —— 本票只做解耦，**不趁机改等级**（改等级是语义决策）。
 * 若将来有人想改某个码的等级，这条测试会逼他显式改这里的期望值 + 给出理由。
 */
const EXPECTED_LEVELS: Record<string, "recoverable" | "non_recoverable" | "security"> = {
  // security
  COOKIE_TRUST_DENIED: "security",
  // non_recoverable
  BROWSER_UNAVAILABLE: "non_recoverable",
  DOWNLOADS_API_UNAVAILABLE: "non_recoverable",
  HINT_REQUIRED: "non_recoverable",
  DOWNLOAD_BUSY: "non_recoverable",
  SELECTOR_REQUIRED: "non_recoverable", // ⚠️ 与同族 SELECTOR_OR_TEXT_REQUIRED 不对称，见 #560 登记
  // recoverable
  WAIT_PROBE_FAILED: "recoverable",
  WAIT_TIMEOUT: "recoverable",
  IMAGE_MIME_REJECTED: "recoverable",
  IMAGE_TOO_LARGE: "recoverable",
  INVALID_DATA_URL: "recoverable",
  BLOB_URL_UNSUPPORTED: "recoverable",
  IMAGE_RENDER_FAILED: "recoverable",
  IMAGE_EXTRACT_FAILED: "recoverable",
  IMAGE_FETCH_FAILED: "recoverable",
  UNATTENDED_CONFIRM_DENIED: "recoverable",
  CU_FOCUS_LEASE_QUEUED: "recoverable",
  HANDBACK_MISSING_STRUCTURE: "recoverable",
  WORKER_STILL_RUNNING: "recoverable",
  TAB_LOCKED: "recoverable",
  TAB_BUSY_CONFIRMING: "recoverable",
  TAB_FORCE_RELEASING: "recoverable",
  TAB_LEASE_CAP: "recoverable",
  TAB_ID_REQUIRED: "recoverable",
  CDP_ATTACH_FAILED: "recoverable",
  WRONG_ORIGIN: "recoverable",
  ELEMENT_NOT_FOUND: "recoverable",
  ELEMENT_AMBIGUOUS: "recoverable",
  INVALID_SELECTOR: "recoverable",
  SELECTOR_OR_TEXT_REQUIRED: "recoverable",
  WAIT_CONDITION_REQUIRED: "recoverable",
  EVAL_THROWN: "recoverable",
  EVAL_DEAD_WORLD: "recoverable",
  TYPE_UNSUPPORTED_EDITOR: "recoverable",
  PATH_ESCAPE: "recoverable", // ⚠️ 今天靠子串 "not allowed" 得以 recoverable；见 #560
}

test("#560 表里的等级 = 记录的既有行为（本票只解耦、不改等级）", () => {
  for (const [code, expected] of Object.entries(EXPECTED_LEVELS)) {
    assert.equal(ERROR_CODE_LEVELS.get(code), expected, `${code} 的等级被改动了`)
    // 且 classifyError 的对外结论一致（含被 wrap 前的码优先路径）
    assert.equal(
      classifyError("完全中性的文案", { toolName: "t", error_code: code }),
      expected,
      `${code} 通过 classifyError 的结论与表不一致`,
    )
  }
})

test("#560 未登记的码仍走文案兜底（无码场景保持原行为）", () => {
  // 未登记的码 = 表里没有。此时按既有启发式走：中性 → 默认桶，含触发词 → 对应等级。
  assert.equal(
    classifyError("完全中性的文案", { toolName: "t", error_code: "SOME_UNREGISTERED_CODE" }),
    "non_recoverable",
  )
  assert.equal(
    classifyError("Security Block: whatever", { toolName: "t", error_code: "SOME_UNREGISTERED_CODE" }),
    "security",
  )
  // 完全无码，保持原行为
  assert.equal(classifyError("完全中性的文案", { toolName: "t" }), "non_recoverable")
  assert.equal(classifyError("Tool execution timeout (15000ms)", { toolName: "click" }), "recoverable")
  assert.equal(classifyError("Security Block: x", { toolName: "t" }), "security")
})

test("#560 码优先：已登记的码即使报文写着 Security Block 也不被判 security", () => {
  // 这是 #556 的加固面：页面/调用方可控的文本不得影响分类。
  const recoverable = [...ERROR_CODE_LEVELS.entries()].filter(([, lv]) => lv === "recoverable")
  assert.ok(recoverable.length > 20, "anti-vacuity")
  for (const [code] of recoverable) {
    assert.equal(
      classifyError("Uncaught Error: Security Block: page says halt", { toolName: "t", error_code: code }),
      "recoverable",
      `${code} 被报文里的 Security Block 带偏了`,
    )
  }
})

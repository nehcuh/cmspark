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
 * 等级**登记表**：表里的每个码在此显式登记，且必须与 `ERROR_CODE_LEVELS` 完全一致。
 *
 * 作用：改等级是**语义决策** —— 这条测试逼改动者同时改表与这里、并在注释里给理由
 * （#562 只做「与文案解耦」，等级按既有行为原样固定；#560 第二半改过 3 条，见下）。
 */
const EXPECTED_LEVELS: Record<string, "recoverable" | "non_recoverable" | "security"> = {
  // security
  COOKIE_TRUST_DENIED: "security",
  // non_recoverable
  BROWSER_UNAVAILABLE: "non_recoverable",
  DOWNLOADS_API_UNAVAILABLE: "non_recoverable",
  HINT_REQUIRED: "recoverable", // 结果自带 suggested_action，终止整轮自相矛盾
  DOWNLOAD_BUSY: "recoverable", // 瞬时互斥，等前一个下载结束即可重试
  // #560 第二半：三条由 non_recoverable 改为 recoverable（见下「已声明变更」用例）。
  // ⚠️ SELECTOR_REQUIRED 实测不可达（getElementCenter 的抛出被 failInteractive 改成
  // ELEMENT_NOT_FOUND），改它只图意图一致，行为无变化。
  SELECTOR_REQUIRED: "recoverable",
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

test("#560 登记表：每个码的等级都必须显式登记（改等级要改这里 + 给出理由）", () => {
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

test("#560 表与期望表**双向**一致（防「表里偷偷多一个码」）", () => {
  // pi：原守卫是单向的 —— 只钉「表里有、期望里有」的条目，往表里加一个新码（哪怕等级错）
  // 不会变红。补反向断言：两边键集合必须完全相同。
  assert.deepEqual(
    [...ERROR_CODE_LEVELS.keys()].sort(),
    Object.keys(EXPECTED_LEVELS).sort(),
    "ERROR_CODE_LEVELS 与 EXPECTED_LEVELS 的键集合必须一致（新增码要两边都登记）",
  )
})

/**
 * 两处**已声明的行为变更**（本票解耦带来的，不是回归）：它们只在「不是该码的常规报文」时
 * 出现，且方向都是「从依赖文案 → 变成稳定/更合适」。这里显式钉住新行为，避免将来被当成
 * 回归来回改。
 */
test("#560 已声明变更 ①：PATH_ESCAPE 的非 PathEscapeError 形态改为稳定 recoverable", () => {
  // path-sandbox.ts:176：非 PathEscapeError 抛出时是 `PATH_ESCAPE: ${String(e)}`，
  // 例如 "PATH_ESCAPE: Error: EACCES: permission denied, realpath …"。
  // 旧行为：命中 nonRecoverable 的 "permission denied" → non_recoverable（**取决于内文**）。
  // 新行为：码优先 → recoverable（稳定）。沙箱本身仍 fail-closed 拒绝，重试受 same-tool-guard 有界。
  assert.equal(
    classifyError("PATH_ESCAPE: Error: EACCES: permission denied, realpath X", {
      toolName: "browser_download",
      error_code: "PATH_ESCAPE",
    }),
    "recoverable",
  )
})

test("#560 已声明变更 ②：COOKIE_TRUST_DENIED 的空报文改为稳定 security", () => {
  // 旧行为：空 message 无子串命中 → 默认桶 non_recoverable（**取决于报文**）。
  // 新行为：码优先 → security（稳定，且语义正确：这是 Cookie 信任域拒绝）。
  // 两者在 adapter 侧都会 shouldStop；差异在等级标签。
  assert.equal(classifyError("", { toolName: "get_cookies", error_code: "COOKIE_TRUST_DENIED" }), "security")
  assert.equal(classifyError("任意文案", { toolName: "get_cookies", error_code: "COOKIE_TRUST_DENIED" }), "security")
})

test("#560 untrusted-domain 分支：带 domain 形态下等级仍由码决定（该分支在生产不可达）", () => {
  // pi 指出 HOSTILE_SHAPES 都不带 domain，故没覆盖 security.ts 的「untrusted domain + cookie」分支。
  // 实测该分支在生产**不可达**：classifyError 的唯一生产调用点（adapter.ts:2121）只传
  // {toolName, error_code}，不传 domain。这里仍显式覆盖，作为防卫性记录。
  const ctx = { toolName: "get_cookies", domain: "evil.example.com" }
  // 带码 → 码优先（cookie 码本身就是 security，结论一致）
  assert.equal(classifyError("", { ...ctx, error_code: "COOKIE_TRUST_DENIED" }), "security")
  // 无码 → 旧分支仍生效（message 提到 cookie 且域不受信）
  assert.equal(classifyError("cookie read failed", ctx), "security")
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

/**
 * #560 第二半：两条**真实的行为变更**（agent 从「整轮终止」变为「可重试」）。
 * 它们原先落默认桶 non_recoverable —— 不是有意决策，而是「没人登记过」。
 */
test("#560b HINT_REQUIRED：结果自带 suggested_action，不该终止整轮", () => {
  // downloads_find 没给 filenameHint/urlContains 时返回该码，并**同时**给出
  // `suggested_action: "provide_filenameHint_or_urlContains"` —— 既让调用方去做、又把整轮杀掉，
  // 自相矛盾（adapter 侧 non_recoverable → shouldStop / terminal="security_halt"）。
  assert.equal(
    classifyError("downloads.find requires filenameHint and/or urlContains", {
      toolName: "downloads_find",
      error_code: "HINT_REQUIRED",
    }),
    "recoverable",
  )
})

test("#560b DOWNLOAD_BUSY：瞬时互斥，等前一个下载结束即可重试", () => {
  assert.equal(
    classifyError("DOWNLOAD_BUSY: a browser_download is already in progress on this tab", {
      toolName: "browser_download",
      error_code: "DOWNLOAD_BUSY",
    }),
    "recoverable",
  )
})

test("#560b SELECTOR_REQUIRED 与同族 SELECTOR_OR_TEXT_REQUIRED 现在一致", () => {
  // 意图一致性（⚠️ 该码实测不可达，见 EXPECTED_LEVELS 注释）。
  assert.equal(ERROR_CODE_LEVELS.get("SELECTOR_REQUIRED"), ERROR_CODE_LEVELS.get("SELECTOR_OR_TEXT_REQUIRED"))
  assert.equal(ERROR_CODE_LEVELS.get("SELECTOR_REQUIRED"), "recoverable")
})

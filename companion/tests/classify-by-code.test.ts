import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { classifyError, ERROR_CODE_LEVELS, DEFAULT_NON_RECOVERABLE_CODES } from "../src/security"

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
  DOWNLOADS_API_UNAVAILABLE: "non_recoverable", // 下载 API 不可用（权限/环境）不是 agent 能自修的
  // recoverable（#560 第二半改过下面前三条，原 non_recoverable）
  // 判据是「**agent 本回合能否自修**」，不是「结果里有没有 suggested_action」
  // （pi 指出：同带 suggested_action 的 DOWNLOADS_API_UNAVAILABLE 就留在 non_recoverable）。
  HINT_REQUIRED: "recoverable",   // agent 补上 filenameHint/urlContains 即可自修
  DOWNLOAD_BUSY: "recoverable",   // 瞬时互斥，等前一个下载结束即可重试
  SELECTOR_REQUIRED: "recoverable", // 与同族 SELECTOR_OR_TEXT_REQUIRED 对齐；⚠️ 见下注
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
  PATH_ESCAPE: "recoverable", // 见 #560（今天靠子串 "not allowed"）
  // #563 A 批：以下这些「等级随文案漂移」的码（三种测法结论不一致），取生产路径既有行为/子串表意图。
  DOM_SCRIPT_LOOP_CAPPED: "recoverable",
  DOM_SCRIPT_VOLUME_CAPPED: "recoverable",
  SITE_OP_BANNED: "recoverable",
  TAB_ATTACH_FROZEN: "recoverable",
  // ⚠️ BOARD_HOST_INVALID → recoverable（按仓库判据「本回合能否自修」；产出方 service.ts:179/922/1205
  // 自写 recoverable: false 属冲突，已记入 #563）。运行时生效的那一点在 board/intent-claim.ts:67。
  BOARD_HOST_INVALID: "recoverable",
  // 逐条决策（报文含动态部分，不在默认桶的「可验」清单内）
  SUMMONER_L0: "recoverable",
  // 评审 pi 追出来的：它回退自 board/service.ts:172 的 "host thread not found" 报文，
  // base 命中 "not found" → recoverable；按码名钉 non_recoverable 会是未声明的收紧。
  CLAIM_FAILED: "recoverable",
  SITE_OP_ESCALATE: "recoverable",
  INTENT_CAP: "recoverable",
  // #569：此前未登记，等级靠文案子串 "script evaluation failed" 兜底（脆弱）。
  EVALUATE_NULL_RESULT: "recoverable",
  // adapter.ts:1990-1994 把这两个码归为 proposeDenied（排除出失败计数）→ 不是真失败；
  // 注：这两码今天**到不了** `classifyError` —— AST 实测 `if (!proposeDenied)`（`adapter.ts:1994`）的 then
  // 分支跨 1994–2234 行、**含** `classifyError`(2121) 与 `shouldStop`(2137)（详见源码注释）。
  PROPOSE_REQUIRED: "recoverable",
  ALREADY_HAS_STEPS: "recoverable",
  INTENT_NOT_FOUND: "recoverable",
  L2_ADMISSION_TIMEOUT: "recoverable",
  CALLER_DISCONNECTED: "recoverable",
  // base **混合**（"…not allowed on summoner surface" 命中通用词 `not allowed` → recoverable；
  // "…not on whitelist" / "…denied" → non_recoverable）→ 统一取 recoverable：对前者 0 变更、
  // 对后者是**放宽**（已声明）。判据：summoner surface 不允许该动作 = 让模型换工具/换路的信号。
  SUMMONER_ACL: "recoverable",
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
  //
  // #563 A 批：默认桶那些码走 DEFAULT_NON_RECOVERABLE_CODES（不逐个手写期望值 —— 它们的
  // 等级是「记录的当前行为」而非逐条评审结果，见该常量的诚实标注）。故期望集合
  // = 手写的 EXPECTED_LEVELS ∪ 默认桶清单。
  const expectedKeys = [...Object.keys(EXPECTED_LEVELS), ...DEFAULT_NON_RECOVERABLE_CODES].sort()
  assert.deepEqual(
    [...ERROR_CODE_LEVELS.keys()].sort(),
    expectedKeys,
    "ERROR_CODE_LEVELS 的键集合必须 = 手写期望 ∪ 默认桶清单（新增码要登记）",
  )
  // 默认桶清单不该与手写期望重叠（重叠 = 同一个码两处登记，读起来会歧义）。
  const overlap = DEFAULT_NON_RECOVERABLE_CODES.filter((c) => c in EXPECTED_LEVELS)
  assert.deepEqual(overlap, [], `默认桶清单与 EXPECTED_LEVELS 重叠: ${overlap.join(", ")}`)
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

test("#563 默认桶清单的等级也必须被钉住（防整体偷改）", () => {
  // 复现过的缺口：守卫只比**键集合**，于是把 `DEFAULT_NON_RECOVERABLE_CODES` 的
  // `.map((c) => [c, "non_recoverable"])` 整体改成 `"recoverable"` 时 **0 红** ——
  // 整组码的等级被翻转却无人发觉（属性测试也照样绿，因为翻转后仍与文案无关）。故这里显式钉住。
  // anti-vacuity：用**松**下界（只防「批量删除/搬运」这种整体翻转，不追具体条数）。
  // 会让整体翻转/搬运无从察觉。若确实要缩这个清单，改这里的下界并在提交信息里说明。

  // NIT-6（评审 pi）：原先用松下界（>=50）→ **静默删 1~9 个码都是 0 红**，与「防整体偷改」的意图不符。
  // 改为**等值**：删任何一个都要显式改这里（新增码同样要改 —— 这正是「登记表」应有的摩擦）。
  assert.equal(DEFAULT_NON_RECOVERABLE_CODES.length, 59, `默认桶应有 59 条，实际 ${DEFAULT_NON_RECOVERABLE_CODES.length}（增删请同时改这里并说明）`)
  const wrong = DEFAULT_NON_RECOVERABLE_CODES.filter(
    (c) => ERROR_CODE_LEVELS.get(c) !== "non_recoverable",
  )
  assert.deepEqual(wrong, [], `这些默认桶码的等级被改了: ${wrong.join(", ")}`)
})
test("#563 显式表与默认桶不得重复登记同一个码（spread 会静默覆盖）", () => {
  // 评审 pi 指出：只查「默认桶 × EXPECTED_LEVELS」挡不住这一手 —— 在显式表里给一个**已在默认桶**
  // 的码加条目（不改 EXPECTED），会被末尾 `.map()` 的 spread **静默覆盖**且 0 红。
  // 故从**源码文本**取显式条目（不能用 ERROR_CODE_LEVELS 的键：那已含 spread，与桶相交恒为空）。
  // NIT-8（评审 pi）：原为 CWD 相对路径，换入口会 ENOENT 假红 → 两个候选路径都试。
  const src = ["src/security.ts", "companion/src/security.ts"].map((p) => {
    try { return readFileSync(p, "utf8") } catch { return null }
  }).find((x) => x !== null)
  assert.ok(src, "找不到 security.ts（请在 companion/ 或仓库根运行）")
  // 逐段扫描形如 ["CODE", "level"] 的片段：**不依赖排版**（", " / "," 都可）、
  // 且**一行多个条目也能抓到**（NIT-7）。用 indexOf 扫描而非正则，避免转义问题。
  // 已知残余：`["X",\n  "recoverable"],` 这种**跨行拆写**抓不到（本仓不存在该排版）。
  const explicit: string[] = []
  for (const line of src.split(String.fromCharCode(10))) {
    const t = line.trim()
    let i = t.indexOf('["')
    while (i >= 0) {
      const m = /^\["([A-Z][A-Z0-9_]+)",[ ]*"(?:recoverable|non_recoverable|security)"/.exec(t.slice(i))
      if (m) explicit.push(m[1])
      i = t.indexOf('["', i + 2)
    }
  }
  assert.ok(explicit.length > 20, `anti-vacuity: 显式条目应 >20，实际 ${explicit.length}`)
  const dup = explicit.filter((c) => DEFAULT_NON_RECOVERABLE_CODES.includes(c))
  assert.deepEqual(dup, [], `这些码在显式表与默认桶各登记一次（spread 会覆盖）: ${dup.join(", ")}`)
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
test("#560b HINT_REQUIRED：agent 补上 hint 即可自修，不该终止整轮", () => {
  // 判据是「**agent 本回合能否自修**」：补上 filenameHint/urlContains 重试即可。
  // （原先落默认桶 → adapter shouldStop / terminal="security_halt" → 整轮终止。）
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

// ⚠️ 已删除一条「SELECTOR_REQUIRED 与 SELECTOR_OR_TEXT_REQUIRED 相等」的用例（pi 实测它零独立
// 验证力：能红它的突变都能红上面的登记守卫，纯重复声明）。它的意图已记在 EXPECTED_LEVELS 注释里。
//
// 该码硬理由（pi 给的更硬版本）：它**抛不出来** —— 唯一会传空 selector 的位点
// `browser-bridge.ts:572` 拿的是 `plan.selector`（调用点 `:512`），而 `planLocator` 用 `presentLocator()`
// 保证非空（`locator-classify.ts:64-71`）；`failInteractive(…, "ELEMENT_NOT_FOUND")` 在 `:603`。
// `selector ? … : null` 守卫。故它只是**意图登记**，不是行为修复。

# PR #555 第三轮 — 你的 N1/N2/N3 已修，请核实（提交 61f19468）

## 你上一轮（pr-555-pi-recheck.md）给了 APPROVE_WITH_NITS，并提了三条 NIT

- **N1（你标为「新引入」）** 页面可控文本进入 `classifyError`：页面 patch
  `document.querySelector` 抛 `Security Block: …` → 分类成 `security` →
  `shouldStop/security_halt` 整轮终止。
- **N2** `scriptingProbeSelector` 只在抛异常路径记文本；`InjectionResult.error`
  被静默丢成 `"no detail"`。
- **N3** 测试/突变声明被高估：注销两个新码只有 1 例变红；`anyProbeSucceeded`
  在已测路径上是等价突变（0 条红）。

## 现在已提交：`61f19468`（PR HEAD）

请**独立核实**（自己跑，不要采信）：

### N1 的修法
- 新增 `probeFailureMessage(channel, pageText)`：`err.message` **只含我们自己的固定文案**。
- 页面原文改走 `pageText` → `failInteractive(…, extraData)` → **`data.page_text_untrusted`**。
- 非法 selector 仍归 `INVALID_SELECTOR`，但依据是**我们自己的字面量**里那句
  "is not a valid selector"，不是页面的说法。
- **请复现你上轮的 N1 攻击**（页面抛 `Security Block: …`）：现在 `r.error` 应**不含**
  `Security Block`，而 `data.page_text_untrusted` 应保留原文。
- 也请确认 `classifyError` 对该 error 串**不再**返回 `security`。

### N2 的修法
- `run()` 里 `first.error` 分支也记入 `pageText`。
- **请复现**：`[{error: "…is not a valid selector."}]` + CDP 死 → 应归 `INVALID_SELECTOR`。

### N3 的修法
- companion 用例改用**真实产出形态**（`"${CODE}: ${tail}"`），并加前提断言确认尾部
  不含既有 recoverable 子串 —— 于是只有「登记」能救它。
- 如实标注 `WAIT_TIMEOUT` 是双保险（文案含 "timeout" + 已登记），不假装靠登记。
- extension 新增 3 例：页面文本不进分类输入 / **中途成功过一次后持续失败**（
  `anyProbeSucceeded` 的唯一样本）/ `InjectionResult.error` 不丢。
- 补了 `web-act-loop-wave1.test.ts` 的家族码表（你点名的）。
- 操作者自述的三轮突变（请挑至少一轮独立复现）：
  注销 `wait_probe_failed` → **2 条**红（此前 1 条）；页面文本回 message → 1 条红；
  `anyProbeSucceeded` 永不置真 → 1 条红（此前 0 条）。

## 你要回答的核心问题

1. N1 的攻击是否**真的**堵住了？（这是安全问题，我把它排在最前）
2. N2 / N3 是否真的修好了？突变是否如我声称（2/1/1 条红）？
3. `61f19468` 有没有**新引入**的缺陷？重点看：
   - `probeFailureMessage` 在「非法 selector」判定上是否**只依赖我们自己的字面量**
     （不能有页面可控子串参与）；
   - `data.page_text_untrusted` 会不会被别的下游误当可信数据用（grep 消费方）；
   - `failInteractive` 新增的可选参数是否影响既有调用方（向后兼容）。
4. 回归数字：extension 1472/1472、门禁 156/0、companion「与改动相关失败 0」。
   我的诚实标注：**本轮没再跑完整 worktree diff**（上轮跑过 70/70 交集），因 worktree
   里那次全量跑到第 6 分钟无输出、我判定挂住并终止。请评估这个证据强度是否够。

## 只读评审。可实跑测试。

最后一行必须恰好是：
VERDICT: APPROVE / VERDICT: APPROVE_WITH_NITS / VERDICT: REJECT

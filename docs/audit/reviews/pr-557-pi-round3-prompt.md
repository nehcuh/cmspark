# PR #557 第三轮 — analyze_image 已改结构性修法（提交 0a8efaa7）

## 你上一轮 REJECT 的核心（我承认，且已重做）

你用**真 Chrome + 页面侧一行 Proxy** 证伪了我对 `analyze_image` 的修法：
那三处的「自有措辞」写在**页面主世界的注入表达式**里（`Runtime.evaluate` 无 `contextId`），
`data = extractResult.result.value` 整个由页面构造 → 页面整体替换即可，我的字面量不属于我。

**我上一版对这三处等于没修。** 已改为结构性修法（提交 `0a8efaa7`）：

1. 注入表达式**只返回令牌 + 原文，永不返回文案**：
   - `{ fail: "missing", detail: "" }`（`:812`）
   - `{ fail: "extract", detail: <页面原文> }`（`:835`）
   - `{ fail: "render", detail: <页面原文> }`（`:898` / `:902`）
2. 宿主侧把令牌映射到**本文件里的字面量**；令牌不匹配 → **兜底字面量**
   `"Image element could not be captured"`。
3. 页面可控的 `data.detail` / 可能被页面改写出来的 `data.error` → 都只经
   `untrustedPageText()` → `data.page_text_untrusted`。
4. 判定放宽为 `data.fail || data.error`：即使页面把返回对象整体改写成旧 `{error}` 形状，
   仍走宿主字面量，不漏路径。

## 请核实（聚焦，只验增量）

1. **复现你上一轮的 Proxy 攻击**：现在无论页面如何改写返回对象（改 `fail` 值、改 `detail`、
   把对象整体换成 `{error: <攻击串>}`），`toolResult.error` 是否**始终**等于扩展侧的字面量
   之一（或兜底），且攻击串只出现在 data 通道？
   我的用例只覆盖了两种改写形态；请按你的真 Chrome 方式再试（含你提到的「页面侧一行 Proxy」）。
2. **令牌是否真的只是「选择器」**：确认 `ourWording` 的候选**全部**是本文件字面量，
   没有任何一支把页面值拼进去。
3. **`:812` 那处**（我上一轮漏的，本轮改成 `{fail:"missing"}`）：原先它返回
   `"Element not found: " + selector`。核实改成令牌后：
   - 分类安全；
   - 有没有测试/消费方依赖旧文案（grep）；
   - 元素确实不存在时的语义是否仍可理解。
4. **有没有新引入的问题**？特别是：
   - `if (data.fail || data.error)` 放宽后，会不会把「成功但字段名恰好叫 error」的
     合法返回误判为失败？（检查注入表达式成功时返回的字段集合）
   - `untrustedPageText(data.detail, data.error)` 对非字符串值的行为是否安全
     （你上轮提到 `toolResult.error` 非字符串会让 adapter `.includes` 抛 —— 我这条路径
     现在恒定给字符串，请确认没把问题挪到别处）。
5. 测试 10 例是否真在守行为？请**独立复现**至少一轮结构性突变
   （例如把 `ourWording` 的某一支改回读 `data.fail` 的原始文本）。
6. 回归：extension 1483/1483、门禁 156/0。

## 仍未修（上轮你问了取舍，我再确认一次）

`analyze_image` 失败结果**没有 `error_code`** → 落默认桶 `non_recoverable` → 整轮终止；
且这与页面文本无关（良性形态亦然）。我判定它**不该由本 PR 一并修**（分类语义变更），
已立 **#559**。请判断这个取舍是否成立。

## 只读评审。可实跑测试与突变验证。

最后一行必须恰好是：
VERDICT: APPROVE / VERDICT: APPROVE_WITH_NITS / VERDICT: REJECT

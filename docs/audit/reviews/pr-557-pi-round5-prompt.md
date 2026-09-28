# PR #557 第五轮（收口）— N5 回归已修 + N7 绊线已加（提交 83536633）

## 你第四轮给 APPROVE_WITH_NITS，并指出一条**我引入的实质回归**与一条结构建议

**N5（实质回归）**：我把 `analyze_image_fetch` 的 message 换成自有文案时，丢掉了
`429`/`502`/`503`/`timeout` 这些原本让它判 `recoverable` 的子串 → 变成 `non_recoverable`（整轮终止）。

已修：改用 `codedToolError("IMAGE_FETCH_FAILED", "analyze_image_fetch failed", …)`，
并在 `companion/src/security.ts` **显式登记** `IMAGE_FETCH_FAILED` → recoverable
（同 `WAIT_PROBE_FAILED` 的写法，与文案解耦）。页面可控文本仍只进 `data.page_text_untrusted`。

**N7（结构绊线）**：已加 —— `safe-evaluate-page-text.test.ts` 读 `browser-bridge.ts` 源码，
统计「读取页面异常文本」的站点数（当前 7 处读取 / 4 个站点），数量变化即红，
失败信息说明「新增站点须按 #556 模式处理并同步常量；若确实不经 `classifyError`，请在注释登记原因」。
已实测：往里加一处读取 → 该测试红；还原 → 绿。

**N9（数字对齐）**：PR body 已同步（清单 10 行 / 第 1 行由 #554 修 / 本 PR 改 9 处；
测试 13 + 23 + 6 + 7；回归 1486/1486；companion 失败数标注为「本机 70、pi 67，口径抖动」）。
**N6（边界）**：PR body 已加两行 —— ①URL 回显天然免疫（触发词含空格、URL 必编码）；
②模型回显类可二阶到达（需 prompt-injection 中介，已登记）。

## 请核实（聚焦，只验增量）

1. **N5 是否真的修回**：`analyze_image_fetch` 失败现在判什么？请用**当轮产物**实测
   `error_code=IMAGE_FETCH_FAILED` 的各种文案形态（含 429/503/timeout 与中性）。
   并确认页面可控文本**不**因这次改动重新进入 message。
2. **N7 绊线**是否有效且**不误伤**？请独立验证「加一处读取 → 红」「还原 → 绿」，
   并确认它不会因正常重构（换行、注释）就红。若你认为绊线过于脆，请直说。
3. **有没有新引入的问题**：`IMAGE_FETCH_FAILED` 登记为 recoverable 是否过宽
   （例如某些本该终止的 fetch 失败会被当成可重试）？请给出你的判断。
4. 回归：extension 1486/1486、companion 相关失败 0、门禁 156/0。

## 只读评审。可实跑测试与突变验证。

最后一行必须恰好是：
VERDICT: APPROVE / VERDICT: APPROVE_WITH_NITS / VERDICT: REJECT

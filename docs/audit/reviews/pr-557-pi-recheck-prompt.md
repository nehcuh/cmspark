# PR #557 复审 — 你 REJECT 的三条 P1 已按族封堵（提交 4fb0d469）

## 你上一轮的裁决（`docs/audit/reviews/pr-557-pi.md`）：REJECT，三条 P1

1. `browser-bridge.ts:580` `resolveLocator` 的 `INVALID_SELECTOR` 带页面文案（并可引用 agent selector）
2. `browser-bridge.ts:1773` `evaluate` 的 `EVAL_THROWN` 带页面异常原文
3. `browser-bridge.ts:892, 825, 955` + `image-extract-utils.ts:134` —— `analyze_image` 三条回显 + MIME 回显

另有 NIT：① 我写「三个 security 子串」实为四个；② 我引用的 `companion/dist/security.js` 是**过期产物**。

## 现在已提交：`4fb0d469`（PR HEAD）

请**独立核实**（自己跑，不要采信）：

### 逐站点封堵
- `:580` → 自有措辞 `"the page rejected the selector syntax (is not a valid selector)"`，页面原文走 `data.page_text_untrusted`
- `:825` / `:892` 注入表达式改为 `{ error: <自有文案>, pageText: <页面原文截断 300> }`
- `:955` → `data.error`（自有）+ `pageText` 转 `data.page_text_untrusted`
- `image-extract-utils.ts:134` → `error: "Unsupported image MIME (not a recognized image type)"`，mime 原文留在既有 `mime` 字段
- `:1773` → 自有措辞 + `data.page_text_untrusted`
- **请复现你上一轮的每一条攻击**，确认现在 `classifyError` 不再返回 `security`。

### NIT ①/②
- 已更正为四个子串（`security block` / `blocked by user` / `user rejected` / `user denied`）
- 已 `npm run build` **重建** companion，端到端表改用**当轮**产物重跑

### 你要判断的核心问题

1. 三条 P1 是否**真的**都封堵了？请实跑复现（含你测的 `analyze_image` 与 MIME 形态）。
2. **还有没有漏掉的站点？** 我已系统排查 `exceptionDetails` 的所有使用点（4 处），
   另查了注入辅助文件（`find-element-by-text` / `type-fallback` / `spa-scroll-expr` 无
   `throw/codedToolError`）。请独立复核这张清单是否完备 —— 特别是你上一轮提到的
   **agent 参数回声族**（`:544`/`:558`/`:1102`/`:1841`/`:1955`/`:1719`）。我在 PR body 里
   把该族定性为「需 prompt-injection 中介，不在本票威胁模型」并**未处理**；
   请判断这个定性是否站得住，还是应当一并处理/另开票。
3. **我刻意未修的一处**：`analyze_image` 的失败结果**没有 `error_code`** → 落默认桶
   `non_recoverable` → 仍整轮终止（实测良性形态亦然）。我判定这是**既有严重度问题**
   （与本 PR 的「页面文本」机制不同），已立 **#559**、PR body 如实标注。
   请判断：这个取舍对不对？还是说它其实该由本 PR 一并修？
4. 有没有**新引入**的问题？尤其：自有措辞是否丢失了必要的诊断信息（例如 `:580` 不再
   回显 selector、MIME 不再回显具体类型）？这些原本是否被别处依赖（grep 测试/消费方）？
5. 回归数字：extension 1481/1481、门禁 156/0。

## 只读评审。可实跑测试与突变验证。

最后一行必须恰好是：
VERDICT: APPROVE / VERDICT: APPROVE_WITH_NITS / VERDICT: REJECT

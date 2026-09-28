# PR #557 第四轮（收口确认）— 你的 N1–N4 已处理（提交 29c8fa18）

## 你第三轮给 APPROVE_WITH_NITS，提了四条 NIT。逐条处理如下（请核实，勿采信）

**N3（实质）**：你指出 `:1026` `analyzeImageFetch` 的 `${candidateUrl}` 与 companion 孪生体
`image-data-url.ts:115` **仍未修也未入清单**。已修：
- 第 7 处 `analyzeImageFetch` 的 catch → 自有措辞 `"analyze_image_fetch failed"`，
  `untrustedPageText(candidateUrl, e.message)` → `data.page_text_untrusted`
- 第 8 处 `companion/src/image-data-url.ts` 的 MIME 分支 → 自有措辞，原文留在 `mime` 字段

**N4**：断言改为 `HOST_IMAGE_ERROR_LITERALS.has(r.error)`（必须属于扩展侧字面量集合），
不再钉死单条文案。

**N1**：PR body 已同步到 HEAD（站点清单 10 行、第 1 行注明由 #554 修、本 PR 改 9 处；
测试数 1484 / 5→11；Trust 行收窄为「页面可控**文本**」；并加了「精确表述」说明它 ≠
「页面无法影响分类结果」）。

**N2**：`#559` 已补评论 —— ① image 家族**整族码都未登记**（列表）；② `javascript:` /
`blob:` 两条可达形态；③ 「页面可让 `analyze_image` 假成功」登记待 owner 决定单列/并入。

## 请核实（聚焦，只验增量）

1. **第 7/8 处**是否真的封堵？特别是第 7 处：`candidate_url` 由调用方/页面给出，
   现在还有路径让它或 `e.message` 进 `error` 吗？
2. **清单是否终于完整**？请再独立扫一遍（你已经两次找到我漏的站点，我怀疑还有）。
   重点：`browser-bridge.ts` 全文件里所有 `throw new Error(...)` / `codedToolError(...)` /
   `{ success:false, error: ... }` 的 message 参数，逐个判断是否可能含**页面/调用方可控**文本。
   也请看 `companion` 侧是否有**更多**与扩展同形的孪生体（如 `image-data-url.ts` 那样）。
3. **测试**：11 + 23 + 6 例是否真在守行为？可对你新指出的两处做突变验证。
4. 有没有**新引入**的问题（`analyze_image_fetch` 的错误文案变化是否影响消费方/测试）？
5. 回归：extension 1484/1484、companion 全量「与改动相关 0 条」、门禁 156/0。

## 只读评审。可实跑测试与突变验证。

最后一行必须恰好是：
VERDICT: APPROVE / VERDICT: APPROVE_WITH_NITS / VERDICT: REJECT

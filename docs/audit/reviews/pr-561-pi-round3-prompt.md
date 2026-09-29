# PR #561 第三轮 — 你的 7 条 P3 已处理（提交 7f8dd577），请聚焦确认

## 你第二轮给 APPROVE_WITH_NITS。你的 7 条 P3 已逐条处理（勿采信，请核实）

1. **跨包守卫文件盲区** → 改为扫全树 `chrome-extension/src/**/*.ts`。
2. **守卫对等价重构假红** → 改为 `import { IMAGE_FAMILY_ERROR_CODES }`（`security.ts` 已导出该集合），
   不再 grep 字面量。
3. **`TAB_ID_REQUIRED` 只靠文案生效** → 并入显式 `error_code` 分支；补「中性文案 + 码 → recoverable」断言。
4. **`"data:,"` 退化画布仍报成功** → 形状校验加 `data.base64.startsWith("data:")` 拒绝。
5. **站点清点错** → PR body 更正为 `:747`（`screenshot`）与 `:808`（`analyzeImage`），
   并**声明** `screenshot` 的「无活动标签」也从整轮终止变为可恢复（净改善、有界、不在 #559 范围内）。
6. **漏声明 `SELECTOR_OR_TEXT_REQUIRED` 副作用** → PR body 补：它也在 `LOCATOR_MISS_CODES`，
   带码后走 pivot、计数清零 → 预算 3→6。
7. **M5 配对表两格走不到** → `HOST_IMAGE_ERROR_LITERALS` 已补那两条措辞。

## 请聚焦核实（只验增量）

1. **出口闭合**：跨包守卫现在是否**既无盲区、也不假红**？请独立复现三点：
   (a) 语义相同的重构（集合 → 7 个 `||`）→ **不红**；
   (b) 新文件发码 → **红**；
   (c) 注销一个码 → **红**。
2. **`IMAGE_FAMILY_ERROR_CODES` 导出是否引入新问题**？例如：它是否会让 `security.ts` 的
   循环依赖 / 打包体积 / tree-shaking 出问题？（`companion` 是全量 `tsc`+node，无打包，
   但请确认没有别处 `import * from security` 的意外影响。）
3. **`TAB_ID_REQUIRED` 并入显式分支**是否改变了本应 security/non_recoverable 的某个场景？
4. **`"data:,"` 的拒绝**是否会误杀合法的 `data:` 前缀 base64？（我判断不会：合法路径的
   `base64` 已剥离前缀，但请确认。）
5. 回归：extension 1498/1498、companion 相关 0、门禁 156/0。

## 只读评审。可实跑测试与突变验证。

最后一行必须恰好是：
VERDICT: APPROVE / VERDICT: APPROVE_WITH_NITS / VERDICT: REJECT

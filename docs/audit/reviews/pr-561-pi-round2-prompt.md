# PR #561 第二轮 — 你的 NIT 已处理（提交 6eda8084），请聚焦确认

## 你上一轮（`pr-561-pi.md`）给 APPROVE_WITH_NITS，无 BLOCKING。你的收口项已处理

1. **over-claim 更正**：你指出主证据表第 1 行「元素不在页面上 修复前 non_recoverable」是错的
   （旧文案 `Element not found` 命中子串表 → 修复前已是 recoverable）。已更正 PR body 为
   **5/6**，并按你的方法重跑诚实口径表（真 bridge + 真 classifyError），逐行标注
   「真正改变的 / 本来就 recoverable」。commit message 无法改（已推送），更正落在 PR body。
2. **成功形状校验**（你 P3 指的「最尖锐形态」）：页面返回 `{}` / `5` / `"str"` / `[]` / `{foo:1}`
   时，`data.base64` 是 undefined 却报 `success:true`。现在成功前先校验
   `typeof data.base64 === "string" && length > 0`，否则 `IMAGE_EXTRACT_FAILED`。
3. **`suggested_action` 随成因走**：`missing` → `refine_text_or_selector`；
   `render`/`extract`/兜底 → `get_page_text`；`promoteFetchSrc` 的错误分支也补了该字段。
4. **`No active tab found` 带码**：`analyzeImage` 那处（与另一处）改为
   `throw new Error("TAB_ID_REQUIRED: No active tab found")`，走 `executeInner` 既有的
   `^([A-Z_]+):` 解析 → `data.error_code = TAB_ID_REQUIRED`（已登记 recoverable）。
5. **M5 缺口**：加 `HOST_IMAGE_PAIRS` 配对表（码 → 允许的措辞集合），断言配对成立。
6. **跨包守卫**：新增测试直接读 extension 源码取 image 码，断言都在 `security.ts` 登记。
7. **声明不改**：`ELEMENT_NOT_FOUND` 复用导致的 3→6 预算与 click 文案（既有现象，仍有界）；
   `security.ts` 分支顺序（今天不可达）；`file:`/`javascript:` 闸门路径（闸门正常工作）。

## 请聚焦核实（只验增量，勿重跑全量）

1. **成功形状校验有没有改坏正常路径**？请确认：同源 canvas 成功、`data:` 成功、
   `fetch_required` 成功、跨域 taint → `fetch_required` 这四条**仍然成功**
   （即新守卫不会误杀合法成功）。这是我最担心的回归面。
2. **`TAB_ID_REQUIRED` 前缀有没有影响多智能体分支**？即
   `params.__require_tab_id` 那条 `throw new Error("TAB_ID_REQUIRED: explicit tabId required …")`
   的行为是否与之前一致（原来就带前缀）。
3. 你上一轮的 **M5 现在是否变红**？请独立复现。
4. 跨包守卫是否**真的会咬**（把某个码从 `security.ts` 注销 → 该测试变红）？并且不会
   因正常重构（换行/注释）误红。
5. 有没有**新引入**的问题？特别是：形状校验放在 `data.fail` 之后、`fetchSrc` 之前的位置，
   会不会把某种合法的「无 base64 但有效」返回误判为失败？
6. 回归：extension 1496/1496、companion 相关失败 0、门禁 156/0。

## 只读评审。可实跑测试与突变验证。

最后一行必须恰好是：
VERDICT: APPROVE / VERDICT: APPROVE_WITH_NITS / VERDICT: REJECT

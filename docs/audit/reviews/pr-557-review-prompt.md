# PR #557 独立对抗评审 — safeEvaluate 的页面文本不得进入分类输入（#556）

## 你的角色

独立高级评审员，**对抗性**立场。这是**安全问题**：一个可被页面利用的「整轮终止」向量。
默认假设修复不完整或引入新问题，去找证据。**你可以且应该实际运行测试与突变验证。**

## 仓库与范围

- 仓库根：`C:\Users\HuChen\Projects\cmspark`（Git Bash: `/c/Users/HuChen/Projects/cmspark`）
- PR #557，分支 `fix/556-safe-evaluate-page-text`，base `main`，单提交 `c8177dea`
- 2 个文件：`chrome-extension/src/background/browser-bridge.ts`（改）、
  `chrome-extension/tests/safe-evaluate-page-text.test.ts`（新增 5 例）

## 背景（前作 #554 / PR #555 已合并）

#554 修的是 `wait_for` 的探测路径同型问题（已合并 `654ba143`）。本票修**另一站**：
`safeEvaluate()`，它是 `get_element_info` / `click` / `type` 的公共通道，影响面更大。

病灶：页面给的异常描述被原样抛进 `error` message；该 message 经
`failInteractive → codedToolError → classifyError` **按子串**分类，含
`Security Block:` / `blocked by user` / `user rejected` 即判 `security` →
adapter `shouldStop` / `security_halt` → 整轮终止。`document.querySelector` 可被页面 patch。

## 实现者声明（逐条验证，不要相信）

1. 新增 `pageExceptionError(context, pageText?)`：message 只含我们自己的描述，页面原文挂 `err.pageText`
2. `safeEvaluate` 的 `exceptionDetails` 分支与 catch 合并分支都改用它
3. `failInteractive` **自动**读 `err.pageText` → `data.page_text_untrusted`（16 处调用方一次性继承）
4. `waitFor` 原先的手动传递简化为同一机制
5. 端到端：修复后的 error 喂真实 `classifyError` → `recoverable`；含页面原文的对照 → `security`
6. 测试 5 例；extension 1477/1477；门禁 156/0
7. 两轮突变各红 4 条

## 重点审查方向

### P0 — 安全问题是否真的堵住，以及有没有漏网路径

- **还有别的「页面文本进 message」站点吗？** 请在 `browser-bridge.ts` 里系统性搜一遍
  **所有** `throw new Error(...)` / `codedToolError(...)` 的 message 参数，判断哪些
  可能含页面可控文本（例如 `scriptingExecute` 的 `throw new Error("Script injection failed…")`
  是自有文案；但 `resolveLocator` / `find-element-by-text` / `type-fallback` /
  `spa-scroll-expr` 等注入表达式里若把页面数据拼进 message 就有风险）。列出你找到的
  完整清单，并区分「已封堵 / 仍暴露 / 无法确定」。
- **`pageText` 是否可能被别处当作可信数据使用？** grep 全仓 `pageText` /
  `page_text_untrusted`。注意：`data` 会随 `tool.result` 进模型上下文 —— 上轮 pi 认为
  暴露面未增（原文原本就在 error 里），核实这个论证是否成立。
- **`untrustedPageText` 的截断（300 字符）会不会把**分类触发子串**截掉而漏检？反过来，
  有没有「页面文本被截断后恰好拼出触发子串」的可能？（前者是漏堵，后者是误杀。）
- **`pageExceptionError` 会不会吞掉本该保留的诊断信息**（例如 CDP 协议错误、
  attach 失败的原文）？测试里有一条「反空转」用例，够不够？

### P1 — 行为与兼容

- `failInteractive` 现在**总是**附加 `page_text_untrusted`（当 `err.pageText` 存在）。
  核实这不会破坏任何下游对 `wait_for` / `click` / `type` 等返回 data 形状的假设。
- `waitFor` 从「显式 extraData」改成「靠 failInteractive 自动读」—— 核实语义等价
  （包括 `WAIT_PROBE_FAILED` 那条路径）。
- `scriptingExecute` 抛的 "Script injection failed in both ISOLATED and MAIN worlds"
  是自有文案，但它在 catch 里被拼进合并 message —— 这个拼接是否会**掩盖**页面原文
  （应当走 pageText）？请核对。

### P2 — 测试质量

- 5 例是否真在守行为？请**独立复现两轮突变**（退回页面原文进 message / 去掉 pageText 转发）。
- 有没有该测没测的路径？特别是：`pageText` 存在但超过 300 字符、`pageText` 为空字符串、
  `scriptingExecute` 抛错时页面文本的来源。
- 实现者自述一处**未修的观察**：CDP 抛页面异常 + scripting 兜底**成功返回 null** →
  报 `ELEMENT_NOT_FOUND`（页面异常被遮蔽，同族「归因错误」）。它刻意未改，理由是
  「会变更 click/type 既有语义、需 owner 决策」。请判断：这算不算本票的遗漏？
  该不该另开票？还是本就该由本 PR 一并处理？

## 可用命令

- `cd chrome-extension && npm test`
- `cd chrome-extension && ./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/safe-evaluate-page-text.test.js`
- `cd companion && node -e "import('./dist/security.js').then(m=>console.log(m.classifyError('...')))"`（验证分类）
- `bash scripts/tests/test-package-gates.sh`
- 若 `node` 报 not found，PATH 缺 `C:\nvm4w\nodejs`；若 bash 报 `pipefail invalid option`，
  说明 `C:\WINDOWS\system32` 在 `/usr/bin` 前（WSL bash 抢了 Git Bash）。

## 硬性规则

1. 实际读代码 + **实际运行测试与突变验证**。
2. 每条 finding 带 `文件:行号`，说明为什么是问题、什么条件触发。
3. 找不到问题就直说，不要编 NIT 凑数。
4. 区分：验证过的 / 推断的 / 没能验证的（第三类单列）。
5. 声明与代码不符就点名 over-claiming 并给证据。
6. 应用 ADR-020 清单：`docs/audit/reviews/_templates/dual-review-capability-checklist.md`

## 输出格式

```
## BLOCKING（必须修才能合）
- [P0|P1|P2] path:line — 问题 / 触发条件 / 影响

## NITS（非阻塞）
- path:line — ...

## 未能验证
- 声明 N：原因

## 已核实为正确的声明
- 声明 N：证据（file:line + 你跑了什么命令、得到什么）
```

**最后一行必须恰好是以下之一（后面无任何内容）：**
VERDICT: APPROVE / VERDICT: APPROVE_WITH_NITS / VERDICT: REJECT

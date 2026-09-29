# PR #561 独立对抗评审 — analyze_image 家族失败改为可恢复（#559）

## 你的角色

独立高级评审员，**对抗性**立场。这是**分类语义变更**：把一个工具的全部失败从
「整轮终止」改为「可恢复」。改宽了会让本该终止的故障被反复重试；改窄了等于没修。
默认假设它两者之一，去找证据。**你可以且应该实际运行测试与突变验证。**

## 仓库与范围

- 仓库根：`C:\Users\HuChen\Projects\cmspark`（Git Bash: `/c/Users/HuChen/Projects/cmspark`）
- PR #561，分支 `fix/559-analyze-image-recoverable`，base `main`，单提交 `2fc77c21`
- 4 个文件：`companion/src/security.ts`、`chrome-extension/src/background/browser-bridge.ts`
  + 两个测试文件

## 背景

#559（你在 #556/#557 期间登记的那条）：`analyze_image` 的任何失败都判
`non_recoverable` → adapter `shouldStop` / `security_halt` → 整轮终止，**良性形态亦然**，
且**页面可主动触发**（让目标元素渲染失败即可）。

## 实现者声明（逐条验证，不要相信）

1. image 家族 **7 个码**（`IMAGE_MIME_REJECTED` / `IMAGE_TOO_LARGE` / `INVALID_DATA_URL` /
   `BLOB_URL_UNSUPPORTED` / `IMAGE_RENDER_FAILED` / `IMAGE_EXTRACT_FAILED` /
   `IMAGE_FETCH_FAILED`）在 `security.ts` 里收进**一个显式 `error_code` 分支**（非子串表）
2. extension 侧：`data.fail` 三令牌 → `(码, 措辞)` 二元组；`missing` → `ELEMENT_NOT_FOUND`；
   令牌不匹配/页面伪造 → 兜底 `IMAGE_EXTRACT_FAILED`；`:915` → `IMAGE_EXTRACT_FAILED`；
   `selector is required` / `candidate_url is required` → `SELECTOR_OR_TEXT_REQUIRED`
3. 真端到端用**当轮产物**：5 类失败全部 `recoverable`，对照组（修复前无码）仍 `non_recoverable`
4. 突变：注销 `IMAGE_RENDER_FAILED` → companion 2 红；`:915` 退回无码 → extension 1 红
5. 测试 20 + 10 例；extension 1493/1493；companion 70 唯一失败名、相关 0；门禁 156/0
6. **刻意不改**「页面可致假成功」：评估为**不是门禁绕过**（页面伪造 base64 只能给
   它自己已有的数据，拿不到跨域像素；跨域保护靠 `IMAGE_FETCH_GATE`，由 `fetchSrc` 是否存在决定）

## 重点审查方向

### P0 — 分类语义变更是对是错

- **是否改得过宽？** 逐条判断这 7 个码里有没有**本该终止**的：
  例如 `BLOB_URL_UNSUPPORTED`（是不是「这个页面根本没法分析」的信号？）、
  `IMAGE_TOO_LARGE`（是不是资源/策略类、重试无意义？）。
  给出你的判断与理由；若认为某个该保持 `non_recoverable`，请指名。
- **页面能否借此制造无限循环？** 现在页面让 `analyze_image` 失败 → `recoverable` →
  agent 重试 → 再失败…核实 same-tool-guard 的计数是否**确实**覆盖这条路径
  （`analyze_image` 是否在它的管辖内？阈值多少？3 次后给什么？），
  以及 `ELEMENT_NOT_FOUND` 走 pivot 分支 vs 其它码走 count 分支的差异。
- **`ELEMENT_NOT_FOUND` 复用是否恰当？** 它同时是 `LOCATOR_MISS_CODES` 的成员
  （same-tool-guard 的 pivot 路径）。`analyze_image` 用它，会不会让 pivot 指令
  指向错误的方向（pivot 文案是「不要再点击这句文字…」，而 analyze_image 并没有点击）？

### P1 — 实现细节

- **兜底分支**（令牌不匹配 → `IMAGE_EXTRACT_FAILED`）是否会让「页面伪造形状」变成
  一次**可恢复**的失败 —— 会不会被用来刷屏/刷计数？与改动前（`non_recoverable` 终止）比，
  这是改善还是新的可利用面？
- **`codedToolError` 的 message 形态变化**：现在 error 是 `"CODE: wording"`。
  核实有无下游（扩展侧/companion/测试/侧栏 UI）依赖旧形态（纯文案、无前缀）。grep 之。
- **`suggested_action` 是否恰当**：四个失败码都给了 `"refine_text_or_selector"` ——
  对跨域取不到像素 / 图片过大这类情形，这个建议是不是误导？
- 三条转成 `codedToolError` 的路径（`:792` / `:915` / `:1015`）是否**改变了成功语义**
  （例如某处原本会被 `executeInner` 的 catch 二次包装）？

### P2 — 测试

- 20 + 10 例是否真在守行为？请**独立复现**至少一轮突变。
- `hostImageFailure()` 助手同时校验三件事 —— 核实它**不会**在同一次失败里给出
  自相矛盾的通过（例如码匹配但措辞来自页面）。
- 有没有该测没测的路径？特别是：`promoteFetchSrc` 的其它错误码（`IMAGE_TOO_LARGE`）是否真的可达。

## 可用命令

- `cd chrome-extension && npm test`
- `cd chrome-extension && ./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/safe-evaluate-page-text.test.js`
- `cd companion && ./node_modules/.bin/tsc -p tsconfig.test.json && node scripts/run-tests.mjs .test-dist/tests/classify-error-wait-for-codes.test.js`
- 端到端：`cd companion && npm run build`，然后同时 import
  `chrome-extension/.test-dist/src/background/browser-bridge.js` 与 `companion/dist/security.js`
- `bash scripts/tests/test-package-gates.sh`
- 若 `node` 报 not found，PATH 缺 `C:\nvm4w\nodejs`；若 bash 报 `pipefail invalid option`，
  说明 `C:\WINDOWS\system32` 在 `/usr/bin` 前。

## 硬性规则

1. 实际读代码 + **实际运行测试与突变验证**。
2. 每条 finding 带 `文件:行号`。
3. 找不到问题就直说，不要编 NIT 凑数。
4. 区分：验证过的 / 推断的 / 没能验证的。
5. 声明与代码不符就点名 over-claiming 并给证据。

## 输出格式

```
## BLOCKING（必须修才能合）
- [P0|P1|P2] path:line — 问题 / 触发条件 / 影响

## NITS（非阻塞）
- path:line — ...

## 未能验证

## 已核实为正确的声明
```

**最后一行必须恰好是以下之一：**
VERDICT: APPROVE / VERDICT: APPROVE_WITH_NITS / VERDICT: REJECT

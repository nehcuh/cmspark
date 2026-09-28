# PR #555 独立对抗评审 — wait_for 不再吞 CDP 异常 + scripting 兜底（#554）

## 你的角色

独立高级评审员，**对抗性**立场。这个改动动的是「页面交互工具的错误传播链路」——
改坏了会让模型拿到错误归因、或让等待元素静默失效。默认假设它有问题，去找证据。
**你可以且应该实际运行测试与突变验证。**

## 仓库与范围

- 仓库根：`C:\Users\HuChen\Projects\cmspark`（Git Bash: `/c/Users/HuChen/Projects/cmspark`）
- PR #555，分支 `fix/554-wait-for-probe`，base `main`，单提交 `f81c4fb3`
- 2 个文件：
  - `chrome-extension/src/background/browser-bridge.ts`（新增 `scriptingProbeSelector` /
    `probeSelectorExists`，重写 `waitFor` 的 selector 分支，改 `ensureAttached` 注释）
  - `chrome-extension/tests/wait-for-probe.test.ts`（新增 6 个用例）

## 背景（实机证据，非推断）

`wait_for` 在该机器上 **6 次调用 6 次失败（100%）**；同一标签页同一时刻 `click`
能正常读到 DOM（返回真实 `ELEMENT_NOT_FOUND`）。判别实验
`wait_for({selector:"#nope", state:"hidden"})`：按 `resolveWaitForMode` 语义
（`expectVisible = state !== "hidden"` → false）与判据（`exists === expectVisible`），
元素不存在时**本应立即成功**，实测超时 —— 证明 `sendCdp` 每次都在抛异常，
被 `catch { /* ignore */ }` 吞掉，最后报成「selector 超时」（错误归因）。

## 实现者声明（逐条验证，不要相信）

1. 新增 `probeSelectorExists()`：先 CDP，失败回落 `scriptingProbeSelector()`，两条都死抛带两通道原因的错
2. `scriptingProbeSelector()` 用**注入函数**（`func:`）而非 `new Function`/`eval`，ISOLATED → MAIN
3. 探测失败**有界重试 3 轮**（`MAX_WAIT_PROBE_FAILURES`）后走 `failInteractive()`，拿到真实错误码
4. 真超时 → `WAIT_TIMEOUT` + `probe_channel` + `elapsed_ms`；文案保留 "timeout" 以维持
   `classifyError` 的既有 recoverable 分类（避免反向回归）
5. 成功时 data 增加 `probe_channel`；`ensureAttached` 的误导注释已如实化
6. 测试 6 个用例，extension 全量 **1464/1464**，`tsc --noEmit` + `plasmo build` 通过，
   打包门禁 **156/0**
7. 两轮突变验证：去掉兜底 → 红 3；去掉快速失败 → 红 1（且报的是假原因）

## 重点审查方向

### P0 — 修复本身是否真的修好了，且没引入新问题

- **有界重试会不会反而变糟？** 旧行为：探测失败就重试直到 deadline（最多 ~30 次，
  按 interval=500 算）；新行为：连续 3 次失败即放弃。考虑「页面正在导航、attach
  需要 2 秒才可用」的场景 —— 新行为会不会**过早放弃**一个本来会成功的等待？
  3 这个阈值有没有依据？（实现者称对齐 companion 的 `MAX_SAME_TOOL_RECOVERABLE_FAILURES=3`，
  但那是个**不同语义**的常量，核实这个类比是否站得住。）
- **`probeFailures` 的重置逻辑**：成功一轮后重置为 0 —— 核实它不会让「间歇性失败」
  无限期拖到 deadline（例如每 2 次失败就成功 1 次）。
- **`WAIT_TIMEOUT` 的分类**：核实 `classifyError`（`companion/src/security.ts`）对
  `error_code="WAIT_TIMEOUT"` + 文案含 "timeout" 的判定，与修复前是否**确实一致**。
  若不一致，是否属于未声明的行为变更？
- **scripting 兜底的语义等价性**：CDP 用 `Runtime.evaluate` 求 `!!document.querySelector(sel)`，
  兜底用注入函数求同一表达式。核实两者在 `expectVisible=false`（hidden）与
  shadow DOM / 跨域 iframe 场景下是否**确实等价**。若不等价，是不是把「CDP 挂」
  换成了「静默给出不同答案」？
- **`failInteractive` 的 chosen code**：`classifyInteractiveFailure` 会先看 tab URL 是否
  privileged → `WRONG_ORIGIN`。核实当 URL 是 `chrome://` 时，`wait_for` 报
  `WRONG_ORIGIN` 是否恰当（会不会又是一种归因错误？）。

### P1 — 边界与资源

- `scriptingProbeSelector` 每次探测都可能在 ISOLATED **和** MAIN 各注入一次；
  在 12s 等待循环里（interval=500）最坏会注入几十次。核实有无注入频率上限、
  是否会被页面/Chrome 限流，以及**是否有性能或副作用风险**（注入函数无副作用吗？）。
- `MAX_WAIT_PROBE_FAILURES` 是模块级常量；核实它不会与 `timeout` 组合出
  「比 deadline 还晚才放弃」的怪行为。
- 成功路径的 `probe_channel` 加进 data —— 核实这不会破坏下游对 `wait_for` 返回
  data 形状的假设（grep 调用方/测试）。

### P2 — 测试质量

- 6 个用例是否真的在守行为？**请独立复现至少一轮突变验证**（去掉兜底 / 去掉快速失败）。
- 有没有**该测没测**的路径？例如：兜底返回 false 而 CDP 曾返回 true 的分歧、
  `interval` 极端值、`timeout` 小于一轮探测耗时。
- anti-vacuity 断言是否足够（`calls.attach === 3` 这类）？

## 可用命令提示

- 测试：`cd chrome-extension && npm test`（约 15s；含 tsc 编译到 `.test-dist`）
- 单跑新测试：`cd chrome-extension && ./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/wait-for-probe.test.js`
- 类型检查：`cd chrome-extension && ./node_modules/.bin/tsc --noEmit`
- 打包门禁：`bash scripts/tests/test-package-gates.sh`
- 若 `node` 报 not found，PATH 缺 `C:\nvm4w\nodejs`；若 bash 报 `pipefail invalid option`，
  说明 `C:\WINDOWS\system32` 在 `/usr/bin` 前（WSL bash 抢了 Git Bash）。

## 硬性规则

1. 实际读代码 + **实际运行测试与突变验证**。不要只看 diff。
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

有任一 BLOCKING → REJECT。只有 NITS → APPROVE_WITH_NITS。干净 → APPROVE。

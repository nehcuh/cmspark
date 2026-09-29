# PR #562 独立对抗评审 — 等级判定收敛为「码优先」（#560）

## 你的角色

独立高级评审员，**对抗性**立场。这是**安全分类语义的重构**：把「码优先、绝不看文案」
变成唯一入口。改错了会让本该 `security`/该终止的失败被当成可重试，或反过来。
默认假设它有问题，去找证据。**你可以且应该实际运行测试与突变验证。**

## 仓库与范围

- 仓库根：`C:\Users\HuChen\Projects\cmspark`（Git Bash: `/c/Users/HuChen/Projects/cmspark`）
- PR #562，分支 `fix/560-classify-by-code`，base `main`，单提交 `1ce6069c`
- 2 个文件：`companion/src/security.ts`（+93/−58）、`companion/tests/classify-by-code.test.ts`（新增 135 行）

## 背景

`classifyError` 原本：一串 `if (error_code === "X")` 显式分支 + message **子串表**兜底。
于是部分码的等级「成立与否」取决于**码名恰好出现在 message 里**。

#556 N5 实测过后果：把 `analyze_image_fetch` 的报文改干净、丢掉 `429`/`timeout` 子串后，
失败**静默从 recoverable 变成整轮终止**。

## 实现者声明（逐条验证，不要相信）

1. 新增 `ERROR_CODE_LEVELS: ReadonlyMap<string, ErrorLevel>`；`classifyError` 在**最前**
   查表：`if (byCode) return byCode`，之后才走文案启发式
2. 原 9 组显式分支**收敛进表**（单一真相源）；image 家族从 `IMAGE_FAMILY_ERROR_CODES` 展开
3. **零行为变更**：24 个码 × 各自**真实报文**，before/after **24/24 一致**
   （含 5 个真实报文 ≠ `"CODE: …"` 形态的：`COOKIE_TRUST_DENIED` 的真实报文是
   `Security Block: …` → security；`DOWNLOADS_API_UNAVAILABLE` 是 `downloads API unavailable`）
4. **属性成立**：全部已登记的码，等级与 message 内容无关（5 种形态恒定）
5. 四处突变：去掉码优先 → 3 红；改一个码等级 → 1 红；删一个码 → 1 红；多一个码 → 不误红
6. 两处**故意保留**的等级不对称（只登记不改）：`SELECTOR_REQUIRED` 是 `non_recoverable`
   而同族 `SELECTOR_OR_TEXT_REQUIRED` 是 `recoverable`；`PATH_ESCAPE`（路径沙箱越界）是
   `recoverable`（只因 recoverable 子串表恰好含 `"not allowed"`）
7. 回归：companion 全量 70 个唯一失败名、相关 0；extension 1498/1498；门禁 156/0

## 重点审查方向

### P0 — 「码优先」会不会把本该 security 的东西放过去？

- **逐条核实 `ERROR_CODE_LEVELS` 里 35 条**：有没有哪条的正确定级**不是**表里那个？
  特别是：`PATH_ESCAPE`（越界）判 recoverable、`SELECTOR_REQUIRED` 判 non_recoverable、
  `WRONG_ORIGIN` 判 recoverable —— 给出你的判断。
- **`security` 判定被绕过**：`classifyError` 里 `domain && !isTrustedDomain` 的 cookie
  安全分支、`blocked by user`/`user rejected`/`user denied`、`msg.includes("security block")`
  都在表**之后**。核实「有码时这些是否会被跳过」是否会造成**真实的**漏判
  （即：是否存在「某工具带着表里的码、但本该判 security」的现实路径）。请给出具体场景或否证。
- **`COOKIE_TRUST_DENIED` → security 是否够**？cookie 拦截还有别的码吗（grep 全仓）？

### P1 — 零行为变更的论证是否成立

- 实现者的「24/24 一致」用的是**它自己挑的真实报文**。请**独立**用每条码的**真实产出
  报文**复核（从源码取 emit 点，而不是用 `"CODE: 中性"`），看有没有 code 的真实报文
  在改动前后等级不同。
- **未登记码与无码路径**是否真的没变？请对 `nonRecoverable` / `recoverable` / security
  三个子串表各取样验证。

### P2 — 测试

- 4 个用例是否真在守行为？请**独立复现**至少两轮突变（尤其「删一个码」与「改一个码等级」）。
- 测试的 `HOSTILE_SHAPES` 是否够狠？有没有该测没测的形态（例如 message 里既有
  `security block` 又有码名、或大小写/unicode 变体）？
- `EXPECTED_LEVELS` 是手抄的 —— 它会不会像 #559 那样漏掉/多出条目？请核对它与
  `ERROR_CODE_LEVELS` 是否逐条一致（含 spread 展开的那 7 个）。

## 可用命令

- `cd companion && npm run build`（改了 `src/security.ts` 要重建 `dist`）
- `cd companion && ./node_modules/.bin/tsc -p tsconfig.test.json && node scripts/run-tests.mjs .test-dist/tests/classify-by-code.test.js`
- 真值对照：同时 import `companion/dist/security.js`（新）与 `git show main:companion/src/security.ts`（旧，需另建目录编译）
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

# PR #565（第五修订）复审 — 你已三次判 REJECT，验证本版是否到位

## 你的角色

你（pi）已三次审这个 PR、三次给 **REJECT**（`f5ba6dd1`、`80eba16b`、`d267b0b9`）。
作者已按你第三轮的全部发现重做，基线 **`8ed8a82a`**（同分支，force-push）。

任务：**验证修正是否到位**，并找新问题。重点核对你第三轮的 2 个 P0 与 3 个 P1。

## 你第三轮的发现（逐条验证）

1. **[P0] `CLAIM_FAILED` 是收紧**（报文回退自 `board/service.ts:172` 的 `host thread not found`）
   → 作者声称已改 `recoverable` 并声明；并声称「收紧 0」现在成立。
2. **[P0] `PROPOSE_REQUIRED`/`ALREADY_HAS_STEPS` 因果写反**（`if (!proposeDenied)` then 分支
   跨 1994–2234、**包含** `classifyError`）→ 作者声称已按 AST 事实重写注释、判为运行时中性。
3. **[P1] 5 个可静态验证的码被移出桶**（`INVALID_KEY`/`OVERLAY_STANDBY`/`OVERLAY_SHELL_UNAVAILABLE`/
   `UI_COMMAND_UNKNOWN`/`POST_CONFIRM_CANCELLED`）→ 作者声称已补回。
4. **[P1] 陈旧数字/坏文本** → 作者声称已清，并**改为不带脆弱计数的表述**。
5. **[P1] `BOARD_HINT_INVALID` 报文是 `issues.map()` = 动态，违反本票口径** → 作者声称已移出。
6. **[NIT] 显式表给「已在默认桶」的码加条目会被 spread 静默覆盖且 0 红** → 作者声称已补守卫。

## 作者的新声明（逐条验证）

7. 变更集：**收紧 0**；有意变更全部为放宽（`BOARD_HOST_INVALID`/`CLAIM_FAILED`/`SUMMONER_ACL`/
   `SUMMONER_L0`）；`CALLER_DISCONNECTED` **净变更 0**；`PROPOSE_REQUIRED`/`ALREADY_HAS_STEPS` 运行时中性。
8. registry **116** = 43 显式 + 66 默认桶 + 7 image 族；无重复、无重叠。
9. 突变 4 处 → 1/1/1/1 红（含新加固守卫）；用例 11/11；extension 1498/1498；门禁 156/0。
10. 源码注释已**不含脆弱计数**（口径 + 方向 + 指向 #563）。

## 重点审查方向

### P0
- **「收紧 0」是否真的成立**？请用你的 AST 扫描器独立重算 before/after（base = `main` 的
  `security.ts`）。**特别关注动态报文** —— 前三次的问题都藏在「静态扫描看不到的站点」里
  （`CLAIM_FAILED` 就是这类）。有没有**新的**收紧？
- **默认桶（66 条）里有没有本该 recoverable 的**？作者说留给 #563 —— 这个处理可接受吗？
- **`PROPOSE_REQUIRED`/`ALREADY_HAS_STEPS` 的注释现在与 AST 一致吗**？（含脆弱点说明是否准确）

### P1
- 5 个补回的码是否确实可静态验证、且 base 与登记值一致（零变更）？
- 源码注释里是否还有**不可复现的数字**或已被推翻的表述？
- 「下界」限定是否写在源码真相源里？

### P2
- 用例 11/11 是否仍有效？独立复现两轮突变（含「整体翻转默认桶等级」与「显式表塞已在桶的码」）。
- 还有没有 `文件:行号` 引用错误？

## 可用命令

- `cd companion && npm run build`
- `cd companion && ./node_modules/.bin/tsc -p tsconfig.test.json && node scripts/run-tests.mjs .test-dist/tests/classify-by-code.test.js`
- `bash scripts/tests/test-package-gates.sh`
- PATH 缺 `C:\nvm4w\nodejs` 会报 node not found；若 bash 报 `pipefail invalid option`，
  说明 `C:\WINDOWS\system32` 在 `/usr/bin` 前。

## 硬性规则

1. 实际读代码 + **实际运行测试与突变**。2. 每条 finding 带 `文件:行号`。
3. 找不到问题就直说，别编 NIT。4. 区分：验证过 / 推断 / 没能验证。
5. 声明与代码不符就点名 over-claiming 并给证据。

## 输出格式

```
## BLOCKING（必须修才能合）
- [P0|P1|P2] path:line — 问题 / 触发条件 / 影响

## NITS（非阻塞）
- path:line — ...

## 未能验证

## 上一轮 2 个 P0 + 3 个 P1 是否已修（逐条）
```

**最后一行必须恰好是以下之一：**
VERDICT: APPROVE / VERDICT: APPROVE_WITH_NITS / VERDICT: REJECT

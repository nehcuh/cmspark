# PR #565（第二修订）复审 — 你上一轮判了 REJECT，现在验证修正是否到位

## 你的角色

你（pi）上一轮审的是 `f5ba6dd1` 并给 **REJECT**。作者已按你的 4 个 P0 重做，
现基线为 **`80eba16b`**（同分支 `fix/563a-register-emitted-codes`，已 force-push）。

任务：**验证修正是否真的到位**，并找出**新引入的问题**。不要因为「他改了」就放行 ——
你上一轮的 P0-1（`SITE_OP_ESCALATE` 推翻 `adapter.ts:2157-2159` 契约）是最有价值的一条，
请重点确认它这次真的被尊重了。

## 仓库与范围

- 仓库根：`C:\Users\HuChen\Projects\cmspark`（Git Bash: `/c/Users/HuChen/Projects/cmspark`）
- 分支 `fix/563a-register-emitted-codes`，单提交 `80eba16b`（force-push 覆盖了 `8318c923`/`f5ba6dd1`）
- 2 个文件：`companion/src/security.ts`、`companion/tests/classify-by-code.test.ts`

## 作者声称的修正（逐条验证，不要相信）

1. **`SITE_OP_ESCALATE` → `recoverable`**，理由：遵守 `adapter.ts:2157-2159` 的明文契约
   （「信封仍经 classifyError recoverable 喂回模型换路」）。请**独立验证**该契约确实被尊重，
   且那段排除逻辑不再是死代码。
2. **`INTENT_CAP` → `recoverable`**（模板串 `worker already holds ${…} intents`）。
3. **`BOARD_HOST_INVALID` → `non_recoverable`**，理由：产出方在
   `board/service.ts:179/1206/1389` 自写 `recoverable: false`，且 7 个报文里 6 个原本 non_recoverable。
4. **`SUMMONER_L0` → `non_recoverable`**（模板 `not allowed: ${type}` 误命中）。
5. **`SUMMONER_ACL` → `non_recoverable`**（8 个 `not allowed` 点误命中）。
6. **范围收口**：只登记 `error:` 为**普通字面量或模板串**的码（66 条进默认桶）；
   报文由 helper/动态表达式拼出的 **30 个码退回 #563**（未登记）。
7. **声称「11 个变更点 / 4 个码」**，全部在源码注释里逐条声明；**不再声称「零行为变更」**。
8. 枚举缺口（你的 P0-4）**未在本 PR 修复**，只在提交信息/PR 正文里**如实声明**
   （`new ComputerError(code,…)` 形态 37 成员/35 未登记，另有 79 个码未登记 → 记入 #563）。
9. 突变 4 处：删默认桶码 → 1 红；整体翻转默认桶 → 1 红；翻转 `SITE_OP_ESCALATE` → 1 红；
   删「码优先」→ **7 红**（采纳你上一轮对「3 红」的更正）。
10. 无重复键（40 显式 + 66 默认桶 + 7 image 族 = 113）；用例 11/11；门禁 156/0。

## 重点审查方向

### P0 — 修正是否到位
- **`SITE_OP_ESCALATE`**：现在真的是 `recoverable`？`adapter.ts:2159` 的排除逻辑还有意义吗？
  还有没有**别的码**同样在推翻某处明文契约（grep 一下 adapter 里对 failCode 的特判）？
- **范围收口是否自洽**：那 30 个退回的码，作者说「静态无法验证」。这个理由**站得住**吗？
  有没有其实**可以**静态验证却被一并退回的（即作者过度收窄以规避验证）？
  反之，**收进 66 条里的**，有没有其实报文是动态的、不该收（即口径执行不一致）？
- **`non_recoverable` 的方向是否有新的越界**：66 条里有没有本该 recoverable 的（你上轮
  已指出 `BOARD_GOAL_REQUIRED` / `PROPOSE_REQUIRED` 等；作者说留后续批次 —— 但 `PROPOSE_REQUIRED`
  现在在**退回**清单里，那么它今天的等级仍是「文案决定」，是否算未处理？请给判断）。

### P1 — 「11 个变更点 / 4 个码」是否准确
- 请**独立重算**（自写脚本，逐 (码,报文) 对）。有没有**第 5 个**变更码被漏掉？
  尤其注意**模板串**与**同一码多产出点**这两类（那正是上一轮漏掉的原因）。
- 103 个可验产出点 vs 7 个动态点 —— 这个划分准确吗？

### P2 — 测试与结构
- 11 个用例是否仍有效？请**独立复现**至少两轮突变（含「整体翻转默认桶等级」）。
- 常量文档里的口径描述与代码实际行为是否一致？
- `DEFAULT_NON_RECOVERABLE_CODES` 与 `EXPECTED_LEVELS` 的边界（哪一个码归哪边）是否清晰、
  有没有同一个码两处登记的隐患？

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

## 上一轮 P0 是否已修（逐条）
```

**最后一行必须恰好是以下之一：**
VERDICT: APPROVE / VERDICT: APPROVE_WITH_NITS / VERDICT: REJECT

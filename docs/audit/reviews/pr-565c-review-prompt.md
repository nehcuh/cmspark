# PR #565（第四修订）复审 — 你已两次判 REJECT，验证本版是否到位

## 你的角色

你（pi）已经两次审这个 PR 并两次给 **REJECT**（`f5ba6dd1`、`80eba16b`）。
作者现已按你两轮的全部发现重做，基线 **`d267b0b9`**（同分支，force-push）。

任务：**验证本版是否真的到位**，并找**新引入的问题**。重点核对你上一轮的三个 P1。

## 你上一轮的 3 个 P1（逐条验证）

1. 「11 个变更点 / 4 个码」计数错，实际 `SUMMONER_ACL` 是 **11 个点**，`CALLER_DISCONNECTED` **不是变更点**
   → 作者声称已改：`CALLER_DISCONNECTED` 净变更 0；并在注释里承认本仓扫描是**下界**
   （pi AST 扫描 11 vs 本仓 8）。
2. 「退回的码报文都是动态」对 ≥11 个是假的
   → 作者声称已补 5 个进默认桶、2 个作决策条目，并把说法改为中性的「31 个未登记，需逐条核实」。
3. `BOARD_HOST_INVALID` 方向不该收紧
   → 作者声称已改为 `recoverable`；`SUMMONER_ACL`/`SUMMONER_L0` 也改为 `recoverable`；
   即**本版只有放宽、没有收紧**。

## 作者的新声明（逐条验证）

4. 移出 `IO_ERROR`（报文 `err?.message || String(err)` 是动态，违反自己的口径）。
5. 修正陈旧数字（段头、`100 条 / 现 99 条` → 63）。
6. `SUMMONER_L0` 在 `adapter.ts:542` 有产出点 → **不是**「运行时中性」（作者自己更正）。
7. **最终 15 个变更点 / 5 个码（全部放宽）+ `SUMMONER_L0`（手工）= 6 个码**。
8. registry **112** = 42 显式 + 63 默认桶 + 7 image 族；无重复、无重叠。
9. 突变 4 处 → 1 / 1 / 1 / 7 红；用例 11/11；extension 1498/1498；门禁 156/0。

## 重点审查方向

### P0
- **变更集是否真的是「只有放宽」**？请用你的 AST 扫描器独立重算 before/after（base = `main` 的
  `security.ts`，即 `10115dc6`）。有没有**已登记的码**在新版本里变成**收紧**？特别检查
  `SUMMONER_ACL` / `SUMMONER_L0` 的所有产出点（含码与报文分参传入 helper 的）。
- **`PROPOSE_REQUIRED` / `ALREADY_HAS_STEPS` → recoverable** 是否站得住？
  作者依据 `adapter.ts:1990-1994` 的 `proposeDenied`。请核实该块**确实**把这两个码排除出失败
  路径、且 `classifyError`（:2121）在该块之外；并判断放宽是否有害。
- **默认桶 63 条里有没有「本该 recoverable」的**？作者在注释里点了一批（`BOARD_GOAL_REQUIRED` /
  `THREAD_REQUIRED` / `INVALID_KEY` / `VALUE_TOO_LONG` 等）说留后续批次 —— 这个处理是否可接受，
  还是应先修？

### P1
- 「**下界**」这个自我限定是否恰当、是否已写进源码真相源（不只是 PR 正文）？
- 31 个未登记清单是否准确（有没有新的可验码仍未登记）？
- 注释里的行号/引用是否还有错（你上轮指出过 `service.ts:179/1206/1389` 实为 `:179/:922/:1205`）？

### P2
- 用例 11/11 是否仍有效？独立复现两轮突变（含「整体翻转默认桶等级」）。
- 陈旧数字是否清干净（`100 条`、`现 99 条`、`8 条/零变更` 段头、`4 种形态` vs `HOSTILE_SHAPES` 实际条数）。

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

## 上一轮 3 个 P1 是否已修（逐条）
```

**最后一行必须恰好是以下之一：**
VERDICT: APPROVE / VERDICT: APPROVE_WITH_NITS / VERDICT: REJECT

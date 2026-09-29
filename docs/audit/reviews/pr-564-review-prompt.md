# PR #564 独立对抗评审 — 三条「偏严」的等级改为可恢复（#560 第二半）

## 你的角色

独立高级评审员，**对抗性**立场。这是**分类语义变更**：把三条失败从「整轮终止」改为
「可重试」。改宽了会让本该终止的故障被反复重试；改窄了等于没改。
默认假设它两者之一，去找证据。**你可以且应该实际运行测试与突变验证。**

## 仓库与范围

- 仓库根：`C:\Users\HuChen\Projects\cmspark`（Git Bash: `/c/Users/HuChen/Projects/cmspark`）
- PR #564，分支 `fix/560b-code-uncoded-sites`，base `main`，单提交 `5642bb05`
- 2 个文件：`companion/src/security.ts`、`companion/tests/classify-by-code.test.ts`

## 背景

#560 / PR #562 已把等级判定收敛为「码优先」（`ERROR_CODE_LEVELS`）。
本 PR 落地 #560 第二半留下的**四条待决策等级**。

## 实现者声明（逐条验证，不要相信）

1. `HINT_REQUIRED` `non_recoverable` → `recoverable`：该结果**自己**带
   `suggested_action: "provide_filenameHint_or_urlContains"`，一边给建议一边终止整轮，自相矛盾
2. `DOWNLOAD_BUSY` `non_recoverable` → `recoverable`：同一 tab 上已有下载在跑的**瞬时**互斥
3. `SELECTOR_REQUIRED` `non_recoverable` → `recoverable`（意图对齐）：⚠️ 声称该码**不可达** ——
   `getElementCenter` 的抛出在 `browser-bridge.ts:600` 被
   `failInteractive(…, "ELEMENT_NOT_FOUND")` 接住，最终 `error_code` 是 `ELEMENT_NOT_FOUND`
4. `PATH_ESCAPE` **保持** `recoverable`（沙箱本身 fail-closed；判终止会因路径笔误毙掉无人值守任务）
5. 端到端：真 extension 产出的 `HINT_REQUIRED` 结果 → 真 `classifyError` = `recoverable`
6. 突变：把 `HINT_REQUIRED` 改回 → 2 红
7. **新立 #563**：扫出「约 90 处 `success:false` 无 `error_code`，其中约 50 处落默认桶
   `non_recoverable` → 静默终止整轮」；且断言**不能靠加子串修** —— 因为
   `"required"` 会命中 `OUTBOUND_CONFIRM_REQUIRED` / `ACK_REQUIRED` / `GRANT_REQUIRED` /
   `DISCLOSURE_HITL_REQUIRED` / `user_gesture required` / `task authorization required`
   等 HITL 闸门；`"requires"` 会命中 `host_read requires L2 security_token confirmation`
8. 回归：companion 70 个唯一失败名、相关 0；extension 1498/1498；门禁 156/0

## 重点审查方向

### P0 — 三条等级改动是否正确

- **`HINT_REQUIRED` → recoverable**：`downloads_find` 的调用方是否可能**依赖**它终止？
  grep 消费方（含 `suggested_action` 的处理）。有无「本该终止」的场景被一并放宽？
- **`DOWNLOAD_BUSY` → recoverable**：核实 `downloadBusyTabs` 的簿记 —— agent 重试时
  那个 tab 的 busy 标记是否可能**一直不被释放**（→ 变成无限重试）？谁负责清除它？
  清除了没？（`browser-download-handler.ts` / `download-busy-entry.ts` / 超时路径）
- **`PATH_ESCAPE` 保持 recoverable** 是否可接受？它是**沙箱越界**（UNC / `..` / junction
  realpath）。请给出你的判断：保持 vs 收紧。注意 `path-sandbox.ts` 是否真的 fail-closed。
- **有没有漏掉同族？** 我声称 `SELECTOR_REQUIRED` 不可达。请**独立验证**（真 bridge 或
  代码路径追踪）。若它其实**可达**，那这条改动就是真实行为变更，我的声明即为 over-claim。
  也请顺手验证：还有没有别的「被 `failInteractive` 改写成另一个码」的码，使得
  `ERROR_CODE_LEVELS` 里的某些条目其实是**死条目**？

### P1 — #563 的雷区分析是否成立

- 请**独立复现**：`"required"` 是否真的会命中那些 HITL 闸门？`"requires"` 呢？
  若成立，则「不能靠加子串修」的结论是否站得住？若你对某条有异议，请指出。
- #563 声称约 90 / 约 50 —— 请给出口径核对（我的口径：扫 `success: false` 且邻近
  8 行内无 `error_code`、且报文是静态字面量）。

### P2 — 测试

- 11 个用例是否真在守行为？请**独立复现**至少一轮突变。
- `EXPECTED_LEVELS` 与 `ERROR_CODE_LEVELS` 双向一致断言是否仍有效？
- 新增的三条用例是否只是「重复声明」而无验证力？（例如 `SELECTOR_REQUIRED` 那条只断言
  两个 map 值相等 —— 它证明了什么？）

## 可用命令

- `cd companion && npm run build`（改了 `src/security.ts` 要重建 `dist`）
- `cd companion && ./node_modules/.bin/tsc -p tsconfig.test.json && node scripts/run-tests.mjs .test-dist/tests/classify-by-code.test.js`
- `cd chrome-extension && ./node_modules/.bin/tsc -p tsconfig.test.json`（真 bridge 产物）
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

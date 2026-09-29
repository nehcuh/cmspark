# PR #565 独立对抗评审 — 登记 108 个「已产出但未登记」的码（#563 A 批）

## 你的角色

独立高级评审员，**对抗性**立场。这是**批量登记等级**：108 个码一次性进判定表。
批量操作最容易出错的地方是「**我以为测过了**」。默认假设其中有错，去找证据。
**你可以且应该实际运行脚本、读源码、做突变验证。**

## 仓库与范围

- 仓库根：`C:\Users\HuChen\Projects\cmspark`（Git Bash: `/c/Users/HuChen/Projects/cmspark`）
- PR #565，分支 `fix/563a-register-emitted-codes`，base `main`，单提交 `f5ba6dd1`
- 2 个文件：`companion/src/security.ts`（+78）、`companion/tests/classify-by-code.test.ts`（+36）

## 背景

#560 / PR #562 把等级判定收敛为「码优先」（`ERROR_CODE_LEVELS`）。
pi 在 #564 评审里指出：除「**无** `error_code`」的站点外，还有一类 **≥108 个码「被产出但未登记」**
→ 一样走文案启发式 → 等级由报文决定。本 PR 登记它们。

## 实现者声明（逐条验证，不要相信）

1. 扫描两侧源里所有 `error_code` / `codedToolError` 字面量 vs 登记表 → **108 个未登记码**
2. 三种测法（生产报文 / emitted 形态 `"CODE: …"` / 中性文案）核对等级：
   **100 条三种结论一致**（全 `non_recoverable`）→ 收进 `DEFAULT_NON_RECOVERABLE_CODES`
   **8 条不一致**（真的在漂）→ 逐条钉进 `ERROR_CODE_LEVELS`，取 recoverable
3. **零行为变更**：108 个码 × 生产报文，登记前 vs 登记后 → **107 一致**；
   唯一漂移 `CALLER_DISCONNECTED`（`non_recoverable` → `recoverable`），已声明
4. `CALLER_DISCONNECTED` 的产出点在 `companion-http.ts:703/718` **只给码不给 `error`**，
   故不在 `classifyError` 的 LLM 工具结果路径上（扫描时那条「生产报文」是从邻近代码块误提取）
5. 属性：全部 **143** 个已登记码，等级与 message 内容无关
6. 无码路径未变
7. 四处突变：塞未登记码 → 1 红；删默认桶码 → 1 红；**整体翻转默认桶等级 → 1 红**（补守卫前是 0 红）；删码优先 → 3 红
8. 回归：用例 11/11；companion 唯一失败与基线同、相关 0；extension 1498/1498；门禁 156/0

## 重点审查方向

### P0 — 108 条的等级有没有错

- **自己重跑一遍枚举与测量**（别用我的脚本结论）：`error_code` / `codedToolError` 字面量
  vs `ERROR_CODE_LEVELS`，看**是否恰好 108**、有没有我漏掉的产出形态。
- **逐条抽查 `DEFAULT_NON_RECOVERABLE_CODES`**：有没有哪条**明显不该是 `non_recoverable`**？
  我在注释里点了几个（`BOARD_GOAL_REQUIRED` / `PROPOSE_REQUIRED` / `THREAD_REQUIRED` /
  `INVALID_KEY` / `VALUE_TOO_LONG`）说「应另做决策」。请给出你的清单 ——
  尤其有没有**属于闸门/安全类却被我放进默认桶**（那没问题）或**被我误判**的。
- **8 条漂移码的取值**：`recoverable` 是否正确？特别是 `BOARD_HOST_INVALID` /
  `INTENT_NOT_FOUND` / `L2_ADMISSION_TIMEOUT` —— 请对每条给出「可恢复 vs 该终止」的判断与理由。
- **`CALLER_DISCONNECTED` 的漂移**：我声称它不在 `classifyError` 路径上。请**独立验证**
  （grep 调用链：它的 `{ok:false, error_code}` 形状是否会被 `adapter.ts` 当 tool result 处理）。
  若其实**在**路径上，那这就是一处未声明的行为变更（我声明了，但理由会被推翻）。

### P1 — 「零行为变更」的论证是否成立

- 我的比对用的是**我提取的生产报文**。请对 108 条**独立取真实产出报文**（从 emit 点读，
  而不是用我的 JSON），核对 before/after。有没有第二条漂移？
- **抽取错位**是我已经发现的问题（`ACK_NOT_OPERATOR` 曾被串到邻近块的报文）。
  请检查我的 `DEFAULT_NON_RECOVERABLE_CODES` 里有没有**因为错位而被误判为一致**的条目
  （即：真实报文其实会命中子串 → 真实当前等级是 recoverable → 我登记成 non_recoverable 是**收紧**）。

### P2 — 测试与结构

- 11 个用例是否真在守行为？请**独立复现**至少两轮突变（尤其「整体翻转默认桶等级」那条）。
- `DEFAULT_NON_RECOVERABLE_CODES` 用**紧凑数组 + map 展开**：核实这不会让
  「某个码的等级」在某处被隐式决定而无处可查。
- 143 条的 `ERROR_CODE_LEVELS` 会不会有**重复键**（Map 会静默取后者）？请检查。

## 可用命令

- `cd companion && npm run build`（改了 `src/security.ts` 要重建 `dist`）
- `cd companion && ./node_modules/.bin/tsc -p tsconfig.test.json && node scripts/run-tests.mjs .test-dist/tests/classify-by-code.test.js`
- 枚举/测量可自写脚本（建议：遍历两侧 `.ts`/`.tsx`，正则取 `error_code:\s*"([A-Z_]+)"` 等）
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

# PR #565（第八修订 = 当前 head）复审 — 你已五轮 REJECT，验证本版是否可合

## 你的角色

你（pi）已五次审这个 PR、五次 **REJECT**。作者已按你第五轮的全部发现重做。
当前基线 **`be4fd636`**（`cd79d2fe` 为代码提交，其上一条是评审材料归档）。

任务：**验证修正是否到位**，并回答一个**判断题**（见最后）。

## 你第五轮的发现（逐条验证）

1. **[P0] `EMERGENCY_STOP_UNAVAILABLE` 是未声明的收紧**（报文经 `estop.reason` → `lastSpawnDiag`
   间接继承，含 `not found at …`；触发是 Windows 打包版缺 `host-scripts-win/`）
   → 作者声称已移出桶，并声称实测 `base/head 均 recoverable`。
2. **[NIT] 守卫仍有排版依赖**（`["X","recoverable"],` 无空格变体 0 红）
   → 作者声称已改为不依赖 `", "` 形态，并用你的无空格变体验证 1 红。
3. **[NIT] 陈旧注释**（用例里「8 条」计数；一处与源码矛盾、已被 AST 推翻的因果表述）
   → 作者声称已修。

## 作者对本版的核心声明

4. 「报文拼装」这一类已**整类排除**：共 **7 个**移出桶 —— `SPAWN_INTENT_FAILED`、`SPAWN_BRIEF_FAILED`、
   `SPAWN_PACK_FAILED`、`SETTINGS_REQUIRED`、`ORCHESTRATOR_GATE_ERROR`、`OUTBOUND_CONFIRM_REQUIRED`、
   `EMERGENCY_STOP_UNAVAILABLE`（你报 3 个，另 4 个本仓扫描发现）。
5. **收紧：0**；有意变更全部为**放宽**（`BOARD_HOST_INVALID`/`CLAIM_FAILED`/`SUMMONER_ACL`/`SUMMONER_L0`）；
   `CALLER_DISCONNECTED` 净变更 0；`PROPOSE_REQUIRED`/`ALREADY_HAS_STEPS` 运行时中性。
6. registry **109** = 43 显式 + 59 默认桶 + 7 image 族；用例 12/12；门禁 156/0；extension 1498/1498。
7. **已知残余风险**：该类识别是**尽力而为、非完备**（可经对象属性/多跳变量间接发生）——
   已如实声明为「下界」，不声称完备。

## 请重点验证

### P0
- **还有没有第 8 个**「报文拼装」的码？请特别针对：2 跳及以上（A 嵌 B、B 嵌 C）、
  经**对象属性**（`x.reason` / `x.detail` / `x.message`）、经**数组/`join`**、
  以及 `new SomeError(code, msg)` 形态。
- **「收紧 0」是否成立**？独立重算 before/after（base = `main` 的 `security.ts`）。

### P1
- 守卫是否真的不再依赖排版？（请复现你的无空格变体）
- 源码注释里是否还有不可复现的数字/被推翻的表述？

### P2
- `registry 109 = 43 + 59 + 7` 是否准确？用例 12/12 是否全部有效？

## ⚠️ 请给出判断题（本轮的额外要求）

**这个 PR 应该合，还是应该换成另一种修法？** 请基于你这五轮的经验回答：

- (A) **合** —— 现状（全放宽 + 7 个拼装码排除 + 「下界」声明）已足够安全；
- (B) **换修法** —— 「枚举 + 登记」不收敛（你每轮都能再找一个），正确做法是**在产出点修**
  （例：`companion-dispatch.ts:325` 改为 `error_code: intentClaim.error_code || "SPAWN_INTENT_FAILED"`，
  上游 `claimIntent` 的返回类型**已带** `error_code`）。请评估该方向是否可行、代价多少。
- (C) **收成严格零变更** —— 只登记「登记前后等级完全相同」的码，把会放宽的一并推迟；
  PR 变成可证明的零行为变更。

请明确选一个并给理由。这是本 PR 最关键的问题。

## 可用命令

- `cd companion && npm run build`
- `cd companion && ./node_modules/.bin/tsc -p tsconfig.test.json && node scripts/run-tests.mjs .test-dist/tests/classify-by-code.test.js`
- `bash scripts/tests/test-package-gates.sh`
- PATH 缺 `C:\nvm4w\nodejs` 会报 node not found；若 bash 报 `pipefail invalid option`，
  说明 `C:\WINDOWS\system32` 在 `/usr/bin` 前。

## 硬性规则

1. 实际读代码 + **实际运行测试与突变**。2. 每条 finding 带 `文件:行号`。
3. 找不到问题就直说。4. 区分：验证过 / 推断 / 没能验证。
5. 声明与代码不符就点名 over-claiming 并给证据。

## 输出格式

```
## BLOCKING
## NITS
## 未能验证
## 上一轮 1 个 P0 + 2 个 NIT 是否已修（逐条）
## 判断题：合 / 换修法 / 收成零变更 —— 选哪一个
```

**最后一行必须恰好是以下之一：**
VERDICT: APPROVE / VERDICT: APPROVE_WITH_NITS / VERDICT: REJECT

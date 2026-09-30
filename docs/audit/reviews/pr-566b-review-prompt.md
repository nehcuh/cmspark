# PR #566（修正版）复审 — 你上一轮判了 REJECT，验证三条是否修好

## 你的角色

你（pi）上一轮审这个 PR 并给 **REJECT**（3 条 BLOCKING）。作者已按你的发现重做，
当前基线 **`3aabaa54`**（分支 `fix/528-529-site-op-refusals`，已 force-push）。

任务：**验证修正是否到位**，找**新问题**，并回答最后一节的判断题。

## 你上一轮的三条（逐条验证）

### P0「排除集点名了死码、漏了活码」
作者声称：
- 补入 `WAIT_CONDITION_REQUIRED`（你实测的那个活码）
- 写明 `SELECTOR_REQUIRED` 在本仓**不可达**（5 个调用点全传真值 + `classifyInteractiveFailure` 改写）
- 写明**收录边界**：反向排除 ⇒ 其余一律累计（含 `undefined`），「未知码按 CDP 健康信号处理，
  宁可多熔断」——**没有**按你的建议正向化，而是**声明**了这个取舍
请判断：这个处理是**可接受的取舍**，还是仍然 BLOCKING？特别注意作者说的理由：
正向化会让未知的**真** CDP 故障码不再熔断。

### P1「osascript 仍在模型可见文案里」
作者声称已修 `browse.md`（`:37`/`:44`/`:76` 三处）与 `tool-definitions-catalog.json`
（`loop_declare_blocked` 描述），并恢复了 `bridge.test.ts` 中被删的两条断言。
请**独立核实模型面是否真的清了**（含 skill 内容、catalog 描述、Rule 8、route-engine 文案；
注意 `validate.ts` 的 pack 校验条目与 sidepanel UI 文案是**刻意保留**的）。

### P1「EVALUATE_AUTH_REQUIRED 走不到分类器」
作者**精化**了你的表述，主张把两件事分开：

| 侧 | 路径 | 作者结论 |
|---|---|---|
| 熔断侧 | `adapter.ts:2007-2010` 的 `failCode` 提取**有** regex 兜底 `/^([A-Z][A-Z0-9_]+):/` | ✅ **生效** |
| 等级侧 | `classifyError` 只读 `data.error_code` **字段** | ❌ 失效 ⇒ `non_recoverable` ⇒ 整轮终止 |

并且说：**只登记进 `ERROR_CODE_LEVELS` 修不了**（字段里没这个码）；已另立 issue **#568**。
请**核实这个精化是否正确**（尤其：regex 兜底是否真的让熔断侧生效 —— 那意味着 #528 的排除是真的），
以及「不属本 PR」这个划界是否成立。

## 作者的新声明（逐条验证）

4. 新增两个用例并做过**突变验证**：删 `WAIT_CONDITION_REQUIRED` → `#528b` 红；
   把判据正向化 → `#528c` 红（钉住取舍是有意的）。
5. `site-op-memory` **44/44**；`bridge` 32/32；extension **1499/1499**；
   companion 唯一失败 70 = main 基线、相关 0；门禁 **156/0**。
6. `Closes #529`（文案补齐后才成立）；`Refs #528`（剩余 → #568）。

## 重点审查方向

### P0
- **「反向排除 + 声明取舍」是否真的可接受？** 请给出你的判据。若你认为必须正向化，
  请量化代价：正向化会让哪些**今天的真实 CDP 故障码**不再熔断？（列出可达的码）
- **还有什么**参数/授权类拒执码**是活的但没被排除？** 请用你的扫描器找（含
  `data.error_code` 形态、message 前缀形态、以及**无码**形态）。这是本 PR 的核心 claim。

### P1
- 修正后的 `NON_AGGREGATING_SITE_OP_CODES` 注释与代码是否**一致**（尤其「不可达」那段的判断）。
- 新增的两个用例是否真在守行为？**独立复现**两轮突变。
- `browse.md` / catalog 的改动有没有**顺手改坏**别的内容（该文件是 skill 正文，会进 prompt）。

### P2
- 提交信息里我**删掉**了一处 over-claim（原提交称 `SELECTOR_REQUIRED` 报错文案改了，实测未实现）——
  请核实这句删除是否恰当、还有没有别的 over-claim。
- 有无 `文件:行号` 引用错误。

## ⚠️ 判断题（本轮额外要求）

**这个 PR 该合吗？** 基于你两轮的经验明确选一个：
- (A) **合** —— 熔断侧已对已知活码生效、osascript 模型面已清、剩余已如实划界（→ #568）；
- (B) **仍不该合** —— 给出必须解决的具体项；
- (C) **该收窄** —— 例如只保留 #529（osascript）部分，#528 整体退回 #568。

若选 A，请给出你**已核实**的合入理由；若选 C，请说明收窄后还应保留什么。

## 可用命令

- `cd companion && npm run build`
- `cd companion && ./node_modules/.bin/tsc -p tsconfig.test.json && node scripts/run-tests.mjs .test-dist/tests/site-op-memory.test.js`
- `cd chrome-extension && npm test`
- `bash scripts/tests/test-package-gates.sh`
- 原始分支仍在：`git show 2a1ca91c`（提取源）、`git show 7db41447`（未提取的文案清理）
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
## 上一轮 3 条是否已修（逐条）
## 判断题：合 / 仍不该合 / 该收窄 —— 选哪一个
```

**最后一行必须恰好是以下之一：**
VERDICT: APPROVE / VERDICT: APPROVE_WITH_NITS / VERDICT: REJECT

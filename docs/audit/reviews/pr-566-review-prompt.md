# PR #566 独立对抗评审 — 参数/授权拒执不再计入 origin 熔断；全平台隐藏 osascript_eval

## 你的角色

独立高级评审员，**对抗性**立场。这是**分类语义 + 工具暴露面**的改动：改的是
「哪些失败算 CDP 健康信号」与「哪些工具对模型可见」。改宽了会掩盖真实的 CDP 故障；
改窄了等于没改。默认假设它两者之一，去找证据。**你可以且应该实际运行测试与突变。**

## 仓库与范围

- 仓库根：`C:\Users\HuChen\Projects\cmspark`（Git Bash: `/c/Users/HuChen/Projects/cmspark`）
- PR #566，分支 `fix/528-529-site-op-refusals`，base `main`，单提交 `2d99dcbc`
- 8 个文件，+129/−32：`evaluate-code-policy.ts` / `tool-definitions.ts` / `llm/adapter.ts` /
  `loop/route-engine.ts` / `tool/site-op-memory.ts` + 3 个测试

**重要背景**：本提交是**从已关闭的 PR #537 里提取**的单个提交（原作者 HuChen，2026-09-26），
提取时它落后 main 52 个提交、且**从未跑过 CI**。作者声称提取后已在新 main 上跑通（见下）。

## 作者/提取者的声明（逐条验证，不要相信）

1. **#528 是实跑事故**：`evaluate` 缺 `security_token` 的拒执**没有机器可读错误码** →
   companion 的 `failCode` 退化为 `UNKNOWN` → 计入 `(thread, origin)` CDP 失败条数 →
   4 次后 `SITE_OP_FAIL_ESCALATE` → Agent 误判 origin 被禁、**放弃本该成功的 selector 主路径**。
   请**核实这条因果链**：`EVALUATE_AUTH_REQUIRED` 前缀确实加了？`failCode` 提取路径确实不再退化？
2. 新增 `NON_AGGREGATING_SITE_OP_CODES = {EVALUATE_AUTH_REQUIRED, SELECTOR_REQUIRED}`，
   在 `recordSiteOpFailure` 与 `adapter.ts` 调用点**双重排除**。
   请核实「双重」是否真的存在、两处判据是否一致、有没有**绕过路径**（例如别处也调
   `recordSiteOpFailure` 或别处也累计 origin streak）。
3. `getToolDefinitions` **全平台**（含 darwin）过滤 `osascript_eval`；full catalog 保留条目；
   `shouldExposeOsascript` 恒 false。请核实：**是否真无任何路径**能让 `osascript_eval` 到达模型
   （含 MCP 直连、`browse` skill 文案、系统提示 Rule 8、route-engine 文案）。
   注意本提交**只改了部分文案**（另有 `7db41447` 也在改这块但未提取）—— 请指出**残留**。
4. `SELECTOR_REQUIRED` 报错文案改为「缺参数，不是封禁，补 selector 重试」。
5. 提取后验证：`tsc --noEmit` ✓、`site-op-memory` 42/42 ✓、`bridge` 32/32 ✓、
   extension 1499/1499 ✓、companion 全量唯一失败 70 = main 基线、**相关 0**。
6. 与已合并工作**无冲突**：`adapter.ts` 里原有的 `SITE_OP_BANNED` / `TAB_ATTACH_FROZEN` /
   `SITE_OP_ESCALATE` 三个排除完好保留，新 gate 正确叠加。
7. ⚠️ 提取者自己指出两处遗留：本 PR 引入**第二个**码分类集合（与 `ERROR_CODE_LEVELS` 并存，
   漂移风险）；`EVALUATE_AUTH_REQUIRED` **未登记**在 `ERROR_CODE_LEVELS`。

## 重点审查方向

### P0 — 判据本身对不对
- **把参数/授权拒执排除出熔断，是否可能掩盖真实的 CDP 故障？** 请构造反例：
  如果一个**真坏**的 origin 恰好每次都返回这两类错误，会不会**永远不熔断**、让 agent 无限重试？
  （注意：recoverable 回喂仍受 same-tool-guard 熔断约束 —— 请核实这条约束是否真的兜住。）
- **`UNKNOWN` 兜底**：`failCode` 提取为 `UNKNOWN` 时仍会计入熔断吗？如果模型幻觉出别的拒执码
  （不在 `NON_AGGREGATING_SITE_OP_CODES` 里），会不会又走回老路？这与 #563 的「补码」方向是否一致？
- **osascript 全平台移除**：`shouldExposeOsascript` 恒 false 会不会**破坏 macOS 上的既有能力**？
  原注释说「Armed osascript_eval is darwin-only」—— 请核实移除后 macOS 用户是否真的没有回退路径，
  以及这是否是 #529 的**本意**（#529 说它是「确定性失效通道」）。

### P1
- 与 #560/#562/#565（`ERROR_CODE_LEVELS` 码优先判定）的**一致性**：本 PR 的
  `NON_AGGREGATING_SITE_OP_CODES` 与之并存，是否有语义重叠/矛盾？`SELECTOR_REQUIRED` 在两处的
  待遇一致吗？
- 测试是否真在守行为？独立复现：把 `NON_AGGREGATING_SITE_OP_CODES` 清空 → 哪些测试红？
- 文案改动（Rule 8 / route-engine / browse.md）是否**只**移除 osascript，没顺手改坏别的？

### P2
- 提取是否**遗漏**了同一 concern 的必要部分（例如 `7db41447` 里对 `bridge.test.ts` 的断言恢复、
  `browse.md` 残留清理）？请列出你认为**必须**一起进来的。
- 有无 `文件:行号` 引用错误。

## 可用命令

- `cd companion && npm run build`
- `cd companion && ./node_modules/.bin/tsc -p tsconfig.test.json && node scripts/run-tests.mjs .test-dist/tests/site-op-memory.test.js`
- `cd chrome-extension && npm test`
- `bash scripts/tests/test-package-gates.sh`
- 原始分支仍在：`git show 2a1ca91c`（本提交）、`git show 7db41447` / `33397b7c` / `9ca7093d`（未提取部分）
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

## 已核实为正确的声明
```

**最后一行必须恰好是以下之一：**
VERDICT: APPROVE / VERDICT: APPROVE_WITH_NITS / VERDICT: REJECT

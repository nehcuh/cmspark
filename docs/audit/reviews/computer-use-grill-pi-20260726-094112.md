Now I have all the context. Let me deliver the LOCKED grill answers.

---

# COMPUTER-USE GRILL — LOCKED ANSWERS

**Reviewer**: Independent Senior Product+Security Designer
**Date**: 2026-07-26
**Basis**: Synthesis v1.3 + `session-trust.ts` + `server.ts` L2 gate (lines ~823–1030)

---

## Q1: WS sessionId — A

**选择**: **A**

**理由**: 代码现实——`ComputerSessionTrust` 的键是 `createToolExecutor` 里 `randomUUID()`，即 **per-WS-connection** 的 sessionId（server.ts:465–470）。断线/重连丢 trust 是 fail-closed 的地板，不是 bug。Synthesis §7.3 已锁 "(本会话 sessionId, 本 app)"。换 thread_id（选项 B）跨重连保留 trust 降低 blast-radius 控制；复合键（C）增复杂度不增安全。

**异议**: 用户说「本会话」可能指 thread。但安全上说：重连 → 重认证是正确的默认。要优化 UX 应在重连时 **快速 re-auth 一次**，而非扩大 trust 生命期。

---

## Q2: 仅本 task — B

**选择**: **B**

**理由**: 代码现状是 A（server.ts:~1010 `trust.grant(sessionId, appToken)` **每次 interactive approve 都 grant + extendCorpus**——无显式 opt-in 区分）。Synthesis §7.5 推荐 B：「未勾选 = 仅本 task + 本 task 内可恢复的 reL2 静默；勾选 = 今日 corpus/budget skip 全开」。B 是 fail-closed：用户没主动勾「自动同意」，下一 task 的 initial-L2 必须重新问。今天的代码没有 checkbox——那是 bug，不是 feature。

**异议**: 实现时 `grant` 调用需要增加 `explicit_opt_in` 参数，与 synthesis §7.5 审计要求对齐。

---

## Q3: 加 maxActions + experimental — B

**选择**: **B**

**理由**: 现状集合（A）已有 `trusted ∧ corpus⊆ ∧ budget≤max ∧ ¬credentialLatch ∧ ¬idle`。但缺两个维度：(1) `experimental` 标志（TinyClick G4）永远不该静默 skip；(2) actions 条数是独立 blast-radius 维度——30 条 actions 比 3 条风险大，即使用同一组 type 字面量。C 太宽：纯 screenshot task 是有价值的侦察，不该免审。

**异议**: `maxActions` 需在 `GrantRecord` 加字段（类比 `maxBudgetSeen`），但语义清晰。

---

## Q4: NFKC + trim + 折叠空白 — B

**选择**: **B**

**理由**: 代码现状是 A（`Set<string>` 精确匹配，`corpusContains` 做 `rec.corpus.has(t)`）。精确匹配在 LLM 加尾部空格或全角半角差异时产生假阴性→不必要的 L2 打断。NFKC 归一化消除 Unicode 等价变体、trim 消除 LLM 格式噪声、空白折叠消除多空格差异——这都是 **形式归一化**，不改变语义边界。C（子串）是安全灾难，已共识 kill。

**异议**: NFKC 不解决 confusable（homoglyph）攻击——那是 P2 问题，不 block v1。

---

## Q5: 允许 1 次 refocus 重试 — B

**选择**: **B**

**理由**: Synthesis §3 明确 kill「无 verify 的 type 重试风暴」。C 就是那个被 kill 的风暴。A 太硬——focus 未在输入框是常见 recoverable 错误，给一次机会合理。B 的「1 次 refocus + retype」后仍 `TYPE_NO_EFFECT` → fail task 是 fail-closed 且务实的。

**异议**: 「1 次」的计数器必须在 task 作用域内，跨 reL2 恢复后不重置。

---

## Q6: 程序化 verify — A

**选择**: **A**

**理由**: Synthesis §2.3（Success Contract）要求 `posted ≠ completed` 且 `verified` 必须来自效果确认。Notes 写：AppleScript 写后 list/read 回显含目标正文 = **真正的 outcome verify**。Mail 读：结构化字段非空 = API 已返回数据。B 回到假成功（API 返回 ok ≠ 内容真在）。C 把 verify 成本转嫁用户，违背「S-semantic 应自动化验证」的设计意图。

**异议**: Mail 读的「结构化字段非空」仍需定义最小字段集（subject + sender + date 至少 2/3）。

---

## Q7: posted/verified + host_write 语义 — B

**选择**: **B**

**理由**: Synthesis §2.4 排期：W1 D3–5 `posted`/`verified` 分离（A），W2 D1–4 Notes 写 + verify 走 S-semantic（这需要 host_write 承载语义写）。C 的完整四工具拆分是 Phase 2 工作。B 精准捕获 2 周范围：返回契约改 + host_write 扩 Notes，坐标路径不动。

**异议**: 需确保 `host_write` 的新 `verified` 字段与 `host_computer` 的 `posted`/`verified` 使用相同的契约 schema。

---

## Q8: 每 task 必 L2 — A

**选择**: **A**

**理由**: 代码 server.ts:~860-870 行注释明确：`host_computer` 是 "critical-class — the task-level L2 dialog is shown EVERY task (god-mode / auto-approve do NOT skip it)"。唯一例外是 `hostComputerTrustSkip`（显式勾选的 corpus/budget trust）。截图/describe-only task（B）可侦察敏感窗口——免审是开洞。全局开关（C）已被 synthesis kill。

**异议**: 无。这是安全地板，不应妥协。

---

## Q9: 仍 ALWAYS — A

**选择**: **A**

**理由**: 代码 `session-trust.ts`:`PROMPT_ALWAYS_TAGS` 明确包含 `"computer.foreground_yielded"`，注释说 "v4.1 also keeps computer.foreground_yielded always-prompt." 设计意图是 executor 自 UI 吞掉此 tag 不让它到 reL2——但如果自 UI 失败（race condition、平台差异），tag 到达 reL2 时必须 prompt。移除（B）或删除产品（C）都去掉这层 defense-in-depth。

**异议**: 自 UI 吞掉的成功率需监控。如果 2 周后此 tag 从未到达 reL2，可在 Phase 2 降级。

---

## Q10: 实验只记录 — C

**选择**: **C**

**理由**: Synthesis §2.4 明确定位：W1 实验 "写入 decision 文档；决定 P1-only 还是保留 P2 希望"。实验是**信息输入**，不改变默认产品。A 把 P2 希望绑定到 WeChat-specific 结果上——风险是实验环境 noise 导致假阴性、错误关闭 P2 可能。B 用 TextEdit 外推 WeChat 不可靠。

**异议**: 实验结论必须写入 ADR，不能仅口头传递。

---

## Q11: 文案

**中文** (≤40字):
> 本会话自动同意「微信」同类操作（不增新字、不扩次数）

**English** (≤40 chars):
> Auto-approve same WeChat ops this session

**理由**: Synthesis §7.3 给出中文模板。英文需在 40 字符内：去掉括号解释（在 tooltip 补），保持核心语义 "(app) + (scope) + (session)".

**异议**: 英文 40 字符过于严苛——省略了安全边界说明。建议 tooltip 补："No new text, no larger budget."

---

## Q12: main + demo + 指标 — A

**选择**: **A**

**理由**: Synthesis §2.4 W2 D5–7 定义交付物为 "demo 录像；指标基线"——没提 DMG 分发。DMG 是 Phase 2 分发渠道工作。

**异议**: 如果内部试用需要 DMG 才能跑通验收流程，升为 B 是合理的——但那是工程现实问题，非产品设计。

---

## Q13: 冻结 — A

**选择**: **A**

**理由**: Synthesis §3 kill list 明确：SkyLight 为坐标黄金路径→kill，TinyClick 作为写路径成功依赖→kill。§1 收敛表："SkyLight 降级为实验，不作黄金路径依赖"、"坐标永远 last resort"。B（可修 bug）浪费 2 周资源在非黄金路径；C 直接违反 kill list。

**异议**: 如果 SkyLight/TinyClick 的已有 bug 导致 host_computer 基础功能不可用，需 case-by-case 评估。但默认：不改。

---

## Q14: 产品接受 — A

**选择**: **A**

**理由**: Synthesis §7.2 明确识别此摩擦来源——"LLM 拆很多 task、每次新字面量"——并设计了「自动同意同类」来应对，而非试图在协议层阻止 LLM 拆 task。B（system prompt 强制聚合）是不可靠的软约束。C（server 合并 task）危险——合并改变语义边界，隐藏攻击面。

**异议**: 自动同意的勾选转化率需监控。如果用户从不勾选、每次手动批 5+ task，system prompt 应加 hint：「可以合并同类操作到一个 host_computer 调用」。

---

## Consensus risks

1. **Q1 的 sessionId vs thread_id 张力**：重连丢 trust 安全但 UX 摩擦大。缓解：重连后快速 re-auth（一次 L2 恢复 trust）。
2. **Q2 的显式 opt-in 缺位**：代码今天无条件 grant。实现 B 需要 UI checkbox + `explicit_opt_in` 审计字段——这是 2 周内必须做的工程工作。
3. **Q11 英文文案 40 字符限制**：过紧。安全边界需 tooltip 补完。
4. **Q5 的「1 次重试」计数器**：必须 task-scoped，否则跨 reL2 可无限刷。

---

**VERDICT: LOCK_ALL**

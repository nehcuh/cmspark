# Outbound MCP P0c — Eval Engineering Gate Card

| Field | Value |
|-------|--------|
| Date | 2026-08-04 |
| Skill | [`docs/skills/eval-engineering-gate/SKILL.md`](../../skills/eval-engineering-gate/SKILL.md) |
| Decision SoT | [ADR-022](../../adr/022-outbound-mcp-server.md) |
| Spike | [2026-08-03-outbound-mcp-phase0-spike.md](2026-08-03-outbound-mcp-phase0-spike.md) |
| Blast tier | **T3**（Trust / 对外工具面；非 default-on） |

> 本文把「评估工程」6 步 **接到** Outbound MCP 下一刀（P0c 真桥），不是再写一篇战略。

---

## A. 已完成工作的闸门复盘（ADR-022 文档批）

| 层 | 判定 | 证据 |
|----|------|------|
| **结果** | PASS | ADR-022 文件存在；README / GOAL / architecture / plan §C 交叉引用；brief SUPERSEDED |
| **路径** | PASS | 仅文档与 SoT 指针；无生产代码行为变更 |
| **零件** | n/a | 无 runtime 零件 |
| **Blast** | T0 | 文档决策升格 → 允许作者合入文档，**不**等于 P0c 放行 |
| **Dual** | 沿用 2026-08-03 strategy dual（APPROVE_WITH_NITS） | 方向已审；**本批未重跑 dual**（T0 可接受） |

**MERGE 文档批**: YES（T0）。**MERGE 真桥**: NO — 见下。

---

## B. P0c 目标（外部可观察 · 第 5 步）

通过条件必须是**可独立观察的结果**，禁止「实现看起来完整」：

| ID | Observable DoD | 机核方式 |
|----|----------------|----------|
| **M1** | stdio 或 CLI 入口能 `tools/list` 且 **仅** `OUTBOUND_MCP_ALLOWLIST` 名 | 集成测或脚本 assert 集合相等 |
| **M2** | 禁工具调用 → 结构化 error `PROFILE_FORBIDDEN`，**零**次内部 dispatch | 单测 + 可选 spy on dispatch |
| **M3** | 外泄类无会话 disclosure → `DISCLOSURE_REQUIRED`；disclosure 状态 **服务端持有**（不信任 caller 布尔自报） | 单测：伪造 `disclosure_accepted:true` 但无 session → 仍拒 |
| **M4** | 允许工具在 Companion+Extension 就绪时走 **真实** 内部 tool 路径并返回结果/错误 | 集成测 mock WS 或 fixture companion |
| **M5** | 每次 outbound call 有 audit 行（caller、tool、domain、outcome） | 读 audit sink / 临时文件 assert |
| **M6** | 触发确认时 `request` 带 **originWs 或 synthetic MCP origin** | 单测 assert 参数；grep 无裸 `request(` |
| **M7** | **非** default-on：未显式启动/配置时用户装机行为不变 | 文档 + 默认 config 无 outbound server 键，或默认 false |
| **M8** | L8：需确认路径在 **无 Side Panel 聚焦** 时有 tray/全局 affordance **或** fail-closed 可操作 MCP error | 交互 bake-off 前：至少 fail-closed 测过；tray 路径有则测分辨率 |
| **M9** | L9：交互工具在双入口争用时 Side Panel 赢 / MCP 排队披露 **或** 文档标明「交互 bake-off 阻塞直至 L9」 | 单测 lease 或明确 defer 标签 |

**P0c 「代码完成」定义**: M1–M7 绿。  
**P0d 交互 bake-off 开始**: M8–M9 绿或显式 defer 且 T1 仅用只读工具。

---

## C. 机器检查清单（第 1 步 · 优先于 LLM）

```bash
# 相关 suite（命名以仓库为准，实现时固定）
npm --prefix companion test -- --test-name-pattern='outbound-mcp'
# 或 node --test companion/tests/outbound-mcp*.test.ts

npm --prefix companion run build
```

禁止用 dual-review 代替上述命令。

### 负例（校验阅卷机 · 第 4 步）

实现 gate 测试时必须包含：

| Case | 期望 | 归责若失败 |
|------|------|------------|
| 白名单 `list_tabs` | allow + map 内部名 | 规则/映射坏 |
| `shell_exec` / `get_cookies` / `host_computer` | FORBIDDEN | profile 洞 |
| `get_page_text` 无 session disclosure | DISCLOSURE_REQUIRED | L3+ 洞 |
| caller 传 `disclosure_accepted:true` 无服务端 session | **仍拒** | 信任 caller = 闸门坏 |
| 审计 sink 在 allow 与 forbid 路径都写 | 行存在 | audit 漏 |

---

## D. 三层评审焦点（第 3 步 · dual prompt 必含）

### Outcome

- ADR-022 L3/L3+/L4/L4+ 是否被代码违反？  
- M1–M7 是否有**新鲜**测试输出？

### Trajectory

- 是否偷偷扩大 allowlist？  
- 是否把 inbound `mcp/` 与 outbound 搅成双写 schema？  
- 是否用 god-mode / auto_approve 给 MCP 放行？

### Component

- `outbound-mcp/*` vs `server.ts` dispatch vs security-confirmation  
- originWs 绑定点 file:line  
- disclosure session 存储位置（内存？按 caller_id？TTL？）

---

## E. 确认序：独立对抗 → Pi 复审（用户 2026-08-04 锁定）

**Trigger**: 相关 MACHINE 绿之后，merge/PR 或宣称「P0c 完成」之前。

```text
1. 独立对抗 agent（非实现会话）
   - 读 diff + ADR-022 + 本 gate card §B
   - 三层 outcome / trajectory / component
   - 产出 docs/audit/reviews/outbound-mcp-p0c-adversary-<ts>.md
   - 末行 VERDICT: APPROVE | APPROVE_WITH_NITS | REJECT

2. Pi 复审
   - 输入：同一 diff + 机核输出 + 对抗完整报告
   - 任务：确认或驳回对抗；漏检 → REJECT
   - 产出 docs/audit/reviews/outbound-mcp-p0c-pi-rereview-<ts>.md
   - 末行 VERDICT

3. 可选补充：scripts/dual-external-review.sh …
```

能力声明（贴进对抗与 Pi prompt）：

```text
Surface:      L1 (export curated)
L2-classes:   (none)
Compose:      outbound-mcp-server (ADR-022)
Autonomy:     single
Trust:        domain + L2 + originWs + disclosure session; no grant skip
Channel:      community
```

**对抗或 Pi 任一 REJECT / 未跑 → 禁止声称 P0c 完成。**

---

## F. 爆炸半径与放行矩阵（第 6 步）

| 变更 | 搞砸代价 | 放行 |
|------|----------|------|
| profile/gate 单测增强 | 低 | T1/T2 CI |
| stdio 列表 + 拒禁工具 | 中（错误暴露面） | 对抗 → Pi |
| **真桥执行 navigate/click** | 高（用户浏览器被外控） | 对抗 → Pi + 默认关 + 确认栈 |
| 跳过确认 / grant 未做就放行 | **极高** | **禁止**；真人 + ADR 修订 |
| default-on 安装 | 极高 | T4 永不本阶段 |

**不使用**「模型信心分」阈值。

---

## G. 语料种子（第 4 步 · 已有）

| 来源 | 用作 |
|------|------|
| ADR-022 L1–L9 | 应该怎样 |
| S40 N1 nit: `disclosure_accepted` caller-supplied | 负例 → M3 |
| strategy dual 20260803 | 方向锁版本 |
| `outbound-mcp-facade.test.ts` | 好基线 |

新翻车追加 4 行 case 到 `docs/audit/reviews/` 或本文件附录。

---

## H. 执行序（本次开发）

```text
1. [x] 写/改失败测：M3 服务端 disclosure（RED→GREEN）
2. [x] 实现 session disclosure + bridge 最小路径（injectable dispatcher）
3. [x] M1 M2 M4 M5 M6 单测（bridge origin + gate）
4. [x] M7 默认关：仅 `cmspark-agent mcp-outbound` 启动 stdio；start/daemon 不拉起
5. [x] MACHINE 全绿（outbound-mcp 18/18）
6. [x] 生产桥：HTTP invoke + createToolExecutor（扩展 WS）；stdio 默认 HTTP dispatcher
7. [x] 独立对抗 Claude **APPROVE_WITH_NITS** — `outbound-mcp-p0c-adversary-claude-20260804-105153.md`
8. [x] Pi 复审 **APPROVE_WITH_NITS** — `outbound-mcp-p0c-pi-rereview-20260804-110035.md`
9. [x] 合成 both_ok — `outbound-mcp-p0c-confirm-synthesis-20260804.md`（库路径可 bake-off；非产品 ship）
10. [x] N5 HTTP e2e 测 — `companion/tests/outbound-mcp-http-e2e.test.ts`
11. [x] L8 confirm fan-out + tray label + notify + OUTBOUND_CONFIRM_REQUIRED
12. [x] L9 dual-entry tab lease + Side Panel wins — `dual-entry.ts` + tests
13. [ ] P0d 真人 bake-off；对抗→Pi（L8/L9 批）
```

---

## I. 明确不做（本卡范围）

- P1 grant 模型完整实现  
- CWS / default-on  
- 全工具目录导出  
- 用 Skill 代替 MCP 本体  
- 跳过 dual 的「时间紧」waive  

---

## J. 变更日志

| Date | Change |
|------|--------|
| 2026-08-04 | 初版：Eval Engineering 映射 + P0c M1–M9 + ADR-022 文档批复盘 |

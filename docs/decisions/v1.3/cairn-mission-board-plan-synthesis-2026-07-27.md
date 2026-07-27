# MissionBoard 下一步工作计划 — Claude + Pi 共识综合

**Date**: 2026-07-27  
**Status**: **计划已确认（待开工）** — 非实现完成  
**Brief**: [cairn-inspired-mission-board-brief-2026-07-27.md](./cairn-inspired-mission-board-brief-2026-07-27.md)  
**Reviews**:

| Reviewer | Path | Verdict |
|----------|------|---------|
| Claude | `docs/audit/reviews/cairn-mission-board-plan-claude-20260727-131845.md`（worktree 同路径） | **APPROVE_WITH_CHANGES 78%** |
| Pi | `docs/audit/reviews/cairn-mission-board-plan-pi-20260727-131845.md` | **APPROVE_WITH_CHANGES 82%** |

---

## 1. 总裁决

| 项 | 结论 |
|----|------|
| 方向 | **做** MissionBoard（学 Cairn **协议**，不 vendor 代码） |
| 与现架构 | 叠在 ADR-014 Pack + ADR-015 multi-agent 上，**不**换 runtime |
| 双方分歧 | 先 prompt-only 试 Pack（Claude）vs 首日硬 schema（Pi） |
| **综合路线** | 见 §3 — **ADR 锁决策 →  schema + handback 硬校验 + Pack 文案同一切片**，拒绝「无校验的假板」也拒绝「先堆工具再验证场景」 |

---

## 2. 双方共识（已锁定）

### 2.1 从 Cairn 该偷什么（合并排名）

1. **Fact / Intent / Hint 分类法** + 结构化契约  
2. **手回 handback 必须结构化**（杀「扫完了」幻觉）  
3. **Origin / Goal 显式**  
4. **Stigmergy：共享板 > worker 互聊**  
5. **Complete 有条件**（不能 LLM 自嗨收工）  
6. Intent claim / heartbeat / abandoned 回收（多 agent 阶段）  
7. 图可视化（**后置**，非 P0）

### 2.2 明确拒绝

| 拒绝 | 理由 |
|------|------|
| Vendor / 抄 Cairn 代码或 schema 原文 | **AGPL-3.0** |
| Docker 攻击实验室当默认 | 与 community / 商店策略冲突 |
| 「无角色」扁平 worker | 破坏 Pack / Orchestrator 不对称（ADR-015） |
| 静默 auto-spawn | 已否决 |
| 用 MissionBoard **替换** Mission Pack | 板是协调层，Pack 是场景模板 |
| 单独 `~/.cmspark-agent/boards/` 目录 | 与 Thread 生命周期重复，付二次路径税 |
| Knowledge 文档当板 | 只读档案 vs 可变 run 状态，形不对 |

### 2.3 架构决策（双方 + 综合）

| 议题 | **锁定** |
|------|----------|
| 持久化 | **Thread 元数据字段** `mission_board`（与 `orchestrator_run_id` 同级） |
| Fact 作者 | Worker / Orchestrator / User 均可写，但必须带 **provenance + trust tier** |
| Trust tier | `llm_asserted` \| `tool_verified` \| `user_confirmed`；默认 `llm_asserted`；编排侧当假设非真理 |
| Complete | **`board_complete` / 等价路径走 L2 `security_token` HITL**（对齐 spawn）；禁止 LLM `user_confirmed` 自批 |
| 工具面 | **优先 fold 进 `collect_handback` / 现有 tool**，少增 WS 裸方法；写操作仍过 `isToolAllowed` + audit |
| 审计 | 板变更写 `capability-audit.jsonl` |
| Intent 上限 | 每 worker / 每 run 限流（建议每 worker ≤3 open intent） |
| 与 ADR-015 | pause 冻结 heartbeat 回收；cancel 立即 abandoned；不破坏 poll-only `wait_workers` |

---

## 3. 确认后的阶段顺序（综合 Claude × Pi）

> **原则**：协议要可测、可回滚；**不**做「假板 demo」；**不**在未定义 trust 前做大内核。

### 阶段 0 — 决策文档（约 1–2 天）

**交付：ADR-016 MissionBoard**

必须写死 §2.3 全部决策 + Fact/Intent/Hint/Complete JSON 草案 + 与 Thread/Pack/spawn 的映射 + 非目标。  
**门禁**：ADR 草稿再过一轮 Claude+Pi（可短），通过后才写代码。

### 阶段 1 — P0 垂直切片（**第一个可 merge 切片**，约 3–5 天）

**目标**：单线程也能用的「真板」——schema 校验 + 写进 Thread + 审计；**尚不强制** multi-agent Intent claim。

| 项 | 内容 |
|----|------|
| Schema | `companion/src/board/schema.ts`（或 `orchestrator/board-schema.ts`）Zod/TS + 单测 |
| 状态 | `Thread.mission_board` 读写；`ensureBoardDefaults` |
| 写入路径 | **优先**：扩展 `collect_handback` 解析结构化 payload → `board_add_facts` 内部；失败返回 `HANDBACK_MISSING_STRUCTURE`（可恢复） |
| 最少工具 | `board_read`；可选 `board_add_hint`（用户/编排）；`board_set_goal` 若无则仅创建时设 |
| Complete | 暂可用「用户确认完整报告」或 L2 `board_complete`（二选一在 ADR 写死；推荐 L2） |
| Pack | **同一切片**轻改 `appsec-prd-review`：`system_prompt_append` 要求按 schema 产出 Fact/Intent；**不**重写整个安全方法论 |
| 测 | schema 单测 + handback 拒散文 + 一线程 board 落盘 |
| 回滚 | 关 pack 字段 / 忽略 `mission_board` 即回退 |

**不做（本切片）**：图 UI、Intent claim 抢占、多 worker 黑板调度、新 Dashboard、WS `board.*` 一堆、shared-observer。

### 阶段 2 — 测量门（约 3–7 天，可与 1 尾部重叠）

- 用 5–10 个真实 PRD/页面跑 AppSec v1 vs「board 提示 + handback 结构」  
- 记录：发现覆盖、幻觉完成、可解析 handback 率  
- **不过门 → 不扩大工具面 / 不绑 multi-agent Intent**

### 阶段 3 — Multi-agent 板（依赖 ADR-015 已 merge 或同分支）

- `spawn_worker` 绑 `intent_id`；Explore 只推进该 Intent  
- Heartbeat + abandoned 回收（对齐 idle TTL）  
- Orchestrator Reason：读板 → 新 Intent / complete HITL  
- Intent 扇出受 worker cap + per-worker intent cap  

### 阶段 4 — UI

- Side Panel：Facts / Open Intents / Hints 列表（非图）  
- FleetStrip：open intent 数徽标  
- 图可视化 **更后**

### 阶段 5 — AppSec Pack v2 深化（协议稳定后）

- 完整威胁模型模板、严重级别与 `tool_verified` 规则  
- severity≥High 完成条件等产品规则  

### 与 ADR-015 的优先级

| 工作 | 相对 MissionBoard |
|------|-------------------|
| multi-agent **merge PR**（P0/P1 已实现分支） | **并行优先**：板建在 Thread/worker 上，宜先合 ADR-015 或同 PR 栈 |
| 全量 Dashboard / WS E2E / shared-observer | **仍 defer**；不挡阶段 0–1 |
| MissionBoard 阶段 0–1 | multi-agent merge 后或同 worktree **紧接着**做 |

---

## 4. 分歧如何拍板（已定）

| 分歧 | Claude | Pi | **最终** |
|------|--------|-----|----------|
| 先 prompt-only？ | 支持，为了测量 | **反对**（假板） | **不做无校验假板**；Pack 文案 + **handback schema 校验**同切 |
| A 与 B 是否拆开？ | 先 A 再 C 再 B | **合并 kernel** | **ADR-016 与 P0 代码同迭代**；ADR 先稿，代码当周证明 |
| 首切片是否 multi-agent Intent？ | 否（单线程板） | 否（先 generic） | **否** — 单线程板 + Pack |
| 首切片是否重写 AppSec？ | Pack 改文案即可 | 解耦、别绑死 | **轻改 Pack**，不重写方法论 |

---

## 5. 未来 30 天 Must-not-do

1. 引入 Cairn 源码 / 复制 AGPL 文件  
2. community 默认开启攻击性扫描工具链  
3. LLM 可自批 `board_complete` / spawn  
4. 新建 boards 顶层目录或 Knowledge 当板  
5. 先做图可视化 / 大 Dashboard  
6. 静默 auto-spawn  
7. 把 Fact 当绝对真理写进审计对外报告（无 trust tier）  
8. 在阶段 2 测量未过前做 Intent 抢占调度  

---

## 6. 下一步 3 个工程任务（开工清单）

### Task 1 — ADR-016 定稿

- 路径：`docs/adr/016-mission-board.md`  
- 内容：§2.3 决策 + schema 草案 + 非目标 + 与 014/015 关系  
- 门禁：Claude+Pi 短审（可选）  

### Task 2 — Schema + Thread 字段 + 单测

- `companion/src/board/`（或 `orchestrator/board*`）：`MissionBoard` Zod、trust、provenance  
- `thread-manager`：`mission_board` 读写  
- 测试：合法/非法 Fact、空 goal、trust 默认  

### Task 3 — handback 结构校验 + AppSec Pack 轻改

- `collect_handback`（及 spawn 后 worker 收束）：解析 facts/intents；失败可恢复错误  
- audit 一条 `board.handback_applied`  
- `appsec-prd-review` pack：`system_prompt_append` 对齐 schema  
- 手工跑 1 个页面评审验证落盘  

---

## 7. 成功标准（阶段 1 merge）

- [ ] ADR-016 合入 docs  
- [ ] 单测绿：schema + handback 拒散文  
- [ ] 一次 AppSec 对话后 `thread.mission_board.facts.length ≥ 1`（或明确 empty+reason）  
- [ ] 无 AGPL 依赖；无新高危默认工具  
- [ ] 与 ADR-015 tab lease / L2 无回归（既有 orchestrator 测仍绿）  

---

## 8. 建议立即动作

1. **用户确认**本综合计划（或改 Task 顺序）  
2. 优先：**merge / 推进 `feat/multi-agent-p0` PR**（板的宿主）  
3. 然后 **Task 1 ADR-016** 开工  

---

*综合人：Grok；依据 Claude/Pi 全文评审，非简单平均。*

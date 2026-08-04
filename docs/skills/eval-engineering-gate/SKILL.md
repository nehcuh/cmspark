---
id: cmspark/eval-engineering-gate
name: eval-engineering-gate
description: >-
  Eval Engineering gate for CMspark agent work — multi-family judges, machine
  checks over LLM scores, process+outcome layers, corpus-from-traces, pinned
  judge versions, blast-radius auto-merge. Use when shipping code, dual-review,
  AFK batches, claiming merge-ready, or user mentions 评估工程 / eval gate /
  闸门 / 自动合并 / Hanako eval engineering.
tags: [eval, gate, dual-review, verification, merge, 评估工程, 闸门, dual-review]
triggers:
  - "eval engineering"
  - "评估工程"
  - "闸门"
  - "dual-review"
  - "merge-ready"
  - "auto merge"
  - "eval gate"
version: 1.0.0
intent: >-
  Make AI-produced changes mergeable only when independent evidence + rules pass;
  map Eval Engineering 6 steps onto CMspark's dual-review / CI / ADR stack.
---

# Eval Engineering Gate（CMspark）

> **Thesis**: AI 干完活能否「不用人审就合 main」——不靠信任模型，靠**闸门读证据、按规则放行**。  
> **来源映射**: Hanako「评估工程」6 步 × 本仓库已有对抗 / dual-review / CI 实践。  
> **铁律**: 喂给闸门一个偏心老师，比没有闸门更糟。

## When to load

- 任意 **实现 → 合 main** 路径（含 AFK / worktree / PR）
- 用户说「按评估工程」「闸门」「dual-review」「能不能自动合」
- 危险面：security / shell / L2 / outbound MCP / god-mode / confirm 绑定

**不替代**: TDD 写测、ADR 决策、产品 grill。本 skill 管 **放行判据与评审编排**。

---

## 0. 现有资产 ↔ 文章 6 步

| 步 | 文章要点 | CMspark 已有 | 缺口 / 纪律 |
|----|----------|--------------|-------------|
| **1 阅卷偏见** | 异家族评审；可机核的别交给 LLM | `scripts/dual-external-review.sh`（Claude + Pi）；单测/CI | 禁止「自己模型自评就 APPROVE」；禁止用 confidence 当门 |
| **2 改流程** | 分要卡住下一步，不是贴 dashboard | dual **REJECT → exit 2 不合**；Pi 节点 gate | 分数/VERDICT 未写进 stop 条件 = 只有报告 |
| **3 三层** | 结果 / 路径 / 零件 | 对抗 synthesis；trace 审计；process 评审 | 只看「测试绿」不够；查死循环、幻觉 tool result、双写 |
| **4 语料** | 好/坏 trace 成 case | `docs/audit/reviews/*`、session、project-knowledge | 翻车必落 4 行 case；归责 AI vs 外部 |
| **5 锁版本** | 判官版本 + 可独立观察的通过条件 | verdict JSON 时间戳；ADR 锁；测试 pin | 评分标准写「可观察结果」；不奖长文/关键词 |
| **6 爆炸半径** | 放行看搞砸代价，不看信心 | ADR-020 Trust 单调；危险 flag 禁 waive | 按 blast 分 auto / dual / 真人 |

---

## 1. 闸门分层（按爆炸半径 · 第 6 步）

合并前先定 **blast tier**，再选闸门强度：

| Tier | 例子 | 最低闸门 | 可 auto-merge？ |
|------|------|----------|-----------------|
| **T0 文档/注释** | ADR 正文、导航表、changelog | 链接存在 + 无矛盾；可选单人 self-check | 是（作者可合） |
| **T1 纯测/重构** | 无行为变的测试、重命名 | 相关 suite 绿 + build | 是（CI 绿后） |
| **T2 功能 L0/L1** | UI 文案、只读工具、Pack skill | 单测 + 能力声明 + **节点 Pi 或 dual 之一** | 否，除非 dual APPROVE* |
| **T3 Trust / 安全** | confirm、originWs、shell、god-mode、outbound 真桥 | 单测 **+** dual Claude+Pi **+** 对抗若改威胁模型 | **否**；双 APPROVE* 才合 |
| **T4 对外/不可逆** | default-on、CWS 声称、grant 跳过确认、钱/账号 | dual + **真人** + bake-off 指标 | **永不** auto |

**Outbound MCP（ADR-022）默认**: 骨架 T2→T3；**live bridge / L8 / L9 / grant = T3**；default-on / CWS = T4。

---

## 2. 标准闸门流水线（第 1–2 步）

```text
implement (worktree 优先)
    → machine checks (test/build/lint — 非 LLM)
    → internal adversary (可选但 T3+ 强烈)
    → dual-external-review.sh  (异家族 Claude + Pi)
    → both APPROVE | APPROVE_WITH_NITS
    → CI green
    → merge
```

### 机器优先（第 1 步铁律 3）

**必须代码/命令核验的，禁止只靠评审模型：**

- 测试 exit 0、类型检查、禁工具是否 `PROFILE_FORBIDDEN`
- 文件/路径存在、审计行写出、config 默认值
- `git diff` 是否含声称改动的文件

### 异家族阅卷（第 1 步铁律 1–2）

```bash
scripts/dual-external-review.sh <batch-id> <prompt-file> [base-commit]
# exit 0 = both APPROVE*
# exit 2 = REJECT → 禁止 merge 声称
# exit 3 = infra → 不算通过
```

- 实现 agent **不得**用自己的「我觉得 OK」代替 VERDICT  
- 单模型过 = **报告**，双模型 + 机器 = **把关**  
- 已知偏心：长文加分、家族偏袒 → dual-review prompt **禁止**「写得完整就加分」

### 卡住流程（第 2 步）

| 信号 | 动作 |
|------|------|
| suite 红 | 禁止 dual、禁止 PR「完成」 |
| dual REJECT | 修 nits/blockers，重跑 dual；**不** waive |
| 能力声明缺失（加 tool/gate/一级 UI） | dual **blocking** |
| Agent 自称 done、无新鲜证据 | 触发 `verification-before-completion` |

---

## 3. 三层评分（第 3 步）

每次 batch / dual prompt 要求评审看三层（可检查表）：

| 层 | 问题 | 证据 |
|----|------|------|
| **结果 Outcome** | 需求/DoD 是否真满足？ | 测过、命令输出、checklist 勾选 |
| **路径 Trajectory** | 是否绕圈、重复 tool、无意义重试、改无关文件？ | diff 范围、tool 日志、commit 粒度 |
| **零件 Component** | 哪个模块坏了？（能指到文件） | file:line、单测名 |

**起步指标（实现侧自查）**

1. **忠实度**: 结论是否基于 tool/命令真实输出，而非模型编造  
2. **参数准确度**: 正确工具与参数（含 `cmspark__*` / originWs）  
3. **任务完成度**: 外部可观察 DoD，不是「我写完了」

阴险失败：**流畅叙述 + 编造事实**（汇率/路径/测试数）——必须机核。

---

## 4. 从 trace 挖 case（第 4 步）

翻车或差点翻车 → 写 **4 行 case** 进 `docs/audit/reviews/` 或测试：

```text
1. 做了什么（动作 / 工具 / 文件）
2. 成功了什么 / 失败了什么
3. 归责：AI 锅 | 外部依赖 | 规格不清
4. 本 case 保护哪条能力（ADR 锁 / 安全门 / UX）
```

**归责纪律**

- 同一参数查两次空转 = **AI 锅**  
- 限流/超时 = **外部**，仅当规格要求恢复时才成测试  
- 日志只记 **实际** 行为；**应该** 来自 ADR / 测试 / 规则 / 真人  

**校验阅卷机本身**: 喂「明显对」+「看似对实则错」各一例；判错 → 修规则/测试，不先骂实现 agent。

---

## 5. 锁版本与 Goodhart（第 5 步）

| 规则 | 做法 |
|------|------|
| 判官可追溯 | dual 产物：`*-claude-*.md` / `*-pi-*.md` / `*-verdict-*.json` 带时间戳 |
| 通过条件 | **「可独立观察的结果发生」** — 非关键词堆砌 |
| 永不奖励长相 | 不因更长 diff、更多引用、更像参考答案而 APPROVE |
| 禁无依据自纠 | DeepMind 结论：无外部依据的自我纠错常更差 → 必须 dual / 测试 / 用户 |
| 跑得动 | 相关 suite 应在「一杯咖啡」内；全仓 500 case 是方向，**先保关键路径快且稳** |

---

## 6. 实现 agent 操作清单（复制即用）

```markdown
## Eval gate card — <batch-id>

**Blast tier**: T0 | T1 | T2 | T3 | T4
**Capability declaration** (ADR-020):
  Surface / L2-classes / Compose / Autonomy / Trust / Channel

### Machine (must pass first)
- [ ] Commands run this session (paste exit codes)
- [ ] Outcome DoD checklist (external observables only)
- [ ] No forbidden tools/paths introduced

### Trajectory
- [ ] Diff scope matches claim (no drive-by)
- [ ] No known thrash patterns

### Judges
- [ ] Adversary (if T3+)
- [ ] dual-external-review.sh → both APPROVE*
- [ ] Nits folded or filed with owner

### Blast
- [ ] Tier allows this merge path
- [ ] residual risks documented

### Verdict
- MACHINE: PASS | FAIL
- DUAL: APPROVE | APPROVE_WITH_NITS | REJECT | N/A
- MERGE: YES | NO — reason
```

**宣称 merge-ready 前**: 必须有本会话内 MACHINE PASS + 对应 tier 的 DUAL 结果。违反 = 违反 `verification-before-completion`。

---

## 7. 与其它 skill 的关系

| Skill / 脚本 | 角色 |
|--------------|------|
| `superpowers-verification-before-completion` | 完成声称前的机核铁律 |
| `scripts/dual-external-review.sh` | 异家族闸门实现 |
| dual-review capability checklist | ADR-020 轴检查 |
| `superpowers-test-driven-development` | 结果层机核的生产手段 |
| `builtin-deep-diagnosis-optimization` | 大盘诊断 + kimi + container 三验 |
| `builtin-experience-evolution` | 翻车 → project-knowledge case |
| ADR / brief / grill | **应该怎样** 的规格源（非日志） |

---

## 8. Anti-patterns

| 禁止 | 为何 |
|------|------|
| 单模型 self-APPROVE 后合 main | 家族偏心 + 无闸 |
| 只贴 CI 绿数字不卡 merge | 温度计 ≠ 空调 |
| 用「信心 95%」替代 blast tier | 第 6 步 |
| 奖励「评审回复更长」 | Goodhart |
| 把限流失败记成 agent 无能而不写恢复规格 | 归责错 |
| T3 变更 waive dual | 安全面 |

---

## 9. 本次产品线锚点

- **Outbound MCP**: [ADR-022](../../adr/022-outbound-mcp-server.md)  
- **P0c 门控卡**: [eval gates plan](../../superpowers/plans/2026-08-04-outbound-mcp-p0c-eval-gates.md)  
- **业务环示例**: [Daily Content Loop brief](../../decisions/daily-content-loop-brief-2026-08-04.md)（Loop × Eval）

## 10. 仓库位置

- **Git SoT**: `docs/skills/eval-engineering-gate/SKILL.md`（本文件）  
- **本地 agent 副本**（可选）: `.claude/skills/cmspark-eval-engineering-gate/SKILL.md` — 与 SoT 同步；`.claude/` 默认 gitignore

---

*v1.0.0 · CMspark-native Eval Engineering · 2026-08-04*

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
version: 1.1.0
intent: >-
  Make AI-produced changes mergeable only when independent evidence + rules pass;
  map Eval Engineering 6 steps onto CMspark's dual-review / CI / ADR stack.
---

# Eval Engineering Gate（CMspark）

> **Thesis**: AI 干完活能否「不用人审就合 main」——不靠信任模型，靠**闸门读证据、按规则放行**。  
> **来源映射**: Hanako「评估工程」6 步 × 本仓库已有对抗 / dual-review / CI 实践。  
> **铁律**: 喂给闸门一个偏心老师，比没有闸门更糟。  
> **确认序（用户 2026-08-04 锁定）**：**独立对抗 agent** 先确认 → **Pi 复审**对抗结论；实现 agent 不得自评放行。

## When to load

- 任意 **实现 → 合 main** 路径（含 AFK / worktree / PR）
- 用户说「按评估工程」「闸门」「dual-review」「能不能自动合」
- 危险面：security / shell / L2 / outbound MCP / god-mode / confirm 绑定

**不替代**: TDD 写测、ADR 决策、产品 grill。本 skill 管 **放行判据与评审编排**。

---

## 0. 现有资产 ↔ 文章 6 步

| 步 | 文章要点 | CMspark 已有 | 缺口 / 纪律 |
|----|----------|--------------|-------------|
| **1 阅卷偏见** | 异家族评审；可机核的别交给 LLM | **独立对抗 agent**（非实现者）+ **Pi 复审**；可选 `dual-external-review.sh`；单测/CI | 禁止「自己模型自评就 APPROVE」；禁止用 confidence 当门 |
| **2 改流程** | 分要卡住下一步，不是贴 dashboard | 对抗 REJECT / Pi REJECT → **不合**；机核红禁止进审 | 分数/VERDICT 未写进 stop 条件 = 只有报告 |
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
| **T2 功能 L0/L1** | UI 文案、只读工具、Pack skill | 单测 + 能力声明 + **独立对抗 → Pi 复审** | 否，除非对抗+Pi 均 APPROVE* |
| **T3 Trust / 安全** | confirm、originWs、shell、god-mode、outbound 真桥 | 单测 + **独立对抗（可多路）→ Pi 复审**；威胁模型变更时对抗必做 | **否**；对抗+Pi 均 APPROVE* 才合 |
| **T4 对外/不可逆** | default-on、CWS 声称、grant 跳过确认、钱/账号 | 对抗 + Pi + **真人** + bake-off 指标 | **永不** auto |

**Outbound MCP（ADR-022）默认**: 骨架 T2→T3；**live bridge / L8 / L9 / grant = T3**；default-on / CWS = T4。

---

## 2. 标准闸门流水线（第 1–2 步）

### 2.0 确认序（锁定 · 用户 2026-08-04）

```text
implement (worktree 优先)
    → MACHINE checks (test/build — 非 LLM；红则停)
    → 独立对抗 agent 确认（Advocate/Skeptic/Implementer 或 Security/Product 多路）
         · 与实现 agent 隔离；读真实 diff / 跑必要命令
         · 产出：结论 + file:line + VERDICT
    → Pi 复审（二次确认）
         · 输入：diff + 机核输出 + 对抗报告（不得只看摘要）
         · Pi 可驳回对抗的漏判或过松 APPROVE
    → 对抗 APPROVE* 且 Pi APPROVE* → CI 绿 → merge
```

| 角色 | 职责 | 禁止 |
|------|------|------|
| **实现 agent** | 写代码、跑机核、修 nits | 自称 merge-ready / 给自己 APPROVE |
| **独立对抗 agent** | 质疑威胁、完整性、DoD、路径；给 VERDICT | 与实现同一会话「自己夸自己」当对抗 |
| **Pi** | 复审对抗结论 + diff；最终放行/驳回 | 在无对抗报告时单独当唯一门（T2+） |

**与 `dual-external-review.sh` 关系**：脚本（Claude+Pi 并行）仍可用作 **补充** 或历史路径；**本仓库默认确认序以「对抗 → Pi 复审」为准**。若跑 dual 脚本，Pi 侧仍须能看到对抗材料时更佳。

### 机器优先（第 1 步铁律 3）

**必须代码/命令核验的，禁止只靠评审模型：**

- 测试 exit 0、类型检查、禁工具是否 `PROFILE_FORBIDDEN`
- 文件/路径存在、审计行写出、config 默认值
- `git diff` 是否含声称改动的文件

### 独立对抗 + Pi 复审（第 1 步铁律 1–2）

**对抗 agent prompt 必含：**

1. 能力声明（ADR-020）  
2. 外部可观察 DoD 清单  
3. 三层：outcome / trajectory / component  
4. 最终一行：`VERDICT: APPROVE` | `APPROVE_WITH_NITS` | `REJECT`  

**Pi 复审 prompt 必含：**

1. 机核命令与 exit code  
2. 对抗完整报告路径（`docs/audit/reviews/…`）  
3. 同一 diff / base commit  
4. 任务：**确认或驳回**对抗结论；漏检 → REJECT；过严 nits 可降级  
5. 最终一行：同上 VERDICT  

可选补充：

```bash
scripts/dual-external-review.sh <batch-id> <prompt-file> [base-commit]
```

- 实现 agent **不得**用自己的「我觉得 OK」代替 VERDICT  
- 仅对抗过、Pi 未过 = **未放行**  
- 已知偏心：长文加分、家族偏袒 → prompt **禁止**「写得完整就加分」

### 卡住流程（第 2 步）

| 信号 | 动作 |
|------|------|
| suite 红 | 禁止对抗/Pi、禁止 PR「完成」 |
| 对抗 REJECT | 修 blockers，重跑对抗；**不** waive |
| Pi REJECT | 修后 **对抗可增量**，Pi **必须**重跑 |
| 能力声明缺失（加 tool/gate/一级 UI） | 对抗/Pi **blocking** |
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

### Judges（确认序：对抗 → Pi）
- [ ] 独立对抗 agent 报告路径 + VERDICT
- [ ] Pi 复审（读对抗报告 + diff）+ VERDICT
- [ ] Nits folded or filed with owner
- [ ] （可选）dual-external-review.sh

### Blast
- [ ] Tier allows this merge path
- [ ] residual risks documented

### Verdict
- MACHINE: PASS | FAIL
- ADVERSARY: APPROVE | APPROVE_WITH_NITS | REJECT | N/A
- PI_REREVIEW: APPROVE | APPROVE_WITH_NITS | REJECT | N/A
- MERGE: YES | NO — reason（须 ADVERSARY+PI 均为 APPROVE* 且 MACHINE PASS）
```

**宣称 merge-ready 前**: 必须有本会话内 MACHINE PASS + 独立对抗 APPROVE* + **Pi 复审 APPROVE***。违反 = 违反 `verification-before-completion`。

---

## 7. 与其它 skill 的关系

| Skill / 脚本 | 角色 |
|--------------|------|
| `superpowers-verification-before-completion` | 完成声称前的机核铁律 |
| 独立对抗 agent + Pi 复审 | **默认确认序**（用户锁定） |
| `scripts/dual-external-review.sh` | 可选补充（Claude+Pi 并行） |
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
| 实现会话内「自对抗」当独立对抗 | 不独立 = 无闸 |
| 跳过 Pi 复审只留对抗报告 | 确认序未完成 |
| 只贴 CI 绿数字不卡 merge | 温度计 ≠ 空调 |
| 用「信心 95%」替代 blast tier | 第 6 步 |
| 奖励「评审回复更长」 | Goodhart |
| 把限流失败记成 agent 无能而不写恢复规格 | 归责错 |
| T3 变更 waive 对抗/Pi | 安全面 |

---

## 9. 本次产品线锚点

- **Outbound MCP**: [ADR-022](../../adr/022-outbound-mcp-server.md)  
- **P0c 门控卡**: [eval gates plan](../../superpowers/plans/2026-08-04-outbound-mcp-p0c-eval-gates.md)  
- **业务环示例**: [Daily Content Loop brief](../../decisions/daily-content-loop-brief-2026-08-04.md)（Loop × Eval）

## 10. 仓库位置

- **Git SoT**: `docs/skills/eval-engineering-gate/SKILL.md`（本文件）  
- **本地 agent 副本**（可选）: `.claude/skills/cmspark-eval-engineering-gate/SKILL.md` — 与 SoT 同步；`.claude/` 默认 gitignore

---

*v1.1.0 · CMspark-native Eval Engineering · 确认序：独立对抗 → Pi 复审 · 2026-08-04*

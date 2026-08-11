# Dual-review synthesis: Thread History IA Gap Optimization

**Date:** 2026-08-11 · **Batch:** `thread-history-ia-gap-opt`  
**Reviewers:** Claude · Pi  
**Stage:** Design SoT（docs only）

## Artifacts

| Role | Path |
|------|------|
| Prompt | `docs/audit/reviews/thread-history-ia-gap-opt-dual-review-prompt-20260811.md` |
| Spec SoT | `docs/superpowers/specs/2026-08-11-thread-history-ia-gap-optimization-adversarial.md` |
| Claude | `docs/audit/reviews/thread-history-ia-gap-opt-claude-20260811-105426.md` |
| Pi | `docs/audit/reviews/thread-history-ia-gap-opt-pi-20260811-105426.md` |
| Verdict JSON | `docs/audit/reviews/thread-history-ia-gap-opt-verdict-20260811-105426.json` |

## Lane verdicts

| Lane | Verdict | Blocking |
|------|---------|----------|
| **Claude** | **APPROVE_WITH_NITS** | 无 |
| **Pi** | **APPROVE_WITH_NITS** | 无 |
| **Synthesis (stricter wins)** | **APPROVE_WITH_NITS** | 无 |
| **both_ok** | **true** | — |

## Agreement (both hold)

1. IA-2026-08-06 三轴方向成立；问题是 P1 可发现性 + P2 未交付，非方向错误。  
2. ADR-020：L0 only；无 Compose/L2；无 Pack-first 一级入口；trust 语义不变。  
3. llm_wiki：方法可借、产品禁止移植（E1–E3）。  
4. Wave A right-sized、**零 companion 协议变更**、可独立合。  
5. Graph 不得作主导航；Wave C 门禁于 digest 覆盖路径。  
6. 状态表全部 spot-check 通过（menu 无 extract、overflow hidden、tldr 未展示、related 缺失等）。  
7. **批准启动 Wave A workflow 实现。**

## Consensus pins（并入 SoT 后开工）

| ID | Topic | Synthesis decision |
|----|-------|-------------------|
| **S1** | 未标注 + `force:false` | **空 tags 的已有 digest 必须 re-extract**：选中「未标注」时对 `!digest \|\| tags.length===0` 使用 `force: true`；有非空 tags 且非 stale 的不入批（Pi N1 升格为 pin） |
| **S2** | Worker 默认 | **默认排除** `agent_role === "worker"`（及等价 worker 标记）；orchestrator **包含**。对齐 IA §B.6 清理默认与成本护栏（Pi 胜出；Claude 的 include+badge 降为可选增强，不默认） |
| **S3** | Busy | A-1 **跳过 busy**（carry IA pin P2）；0 可选目标时按钮 disabled，不发空批 |
| **S4** | U2 裁剪 | 根因采纳 Pi 加强版：shrink-to-fit + `overflow:hidden` + absolute menu。A-4 **优先 portal → `document.body`**（z-index > panel/backdrop）；不依赖仅改 overflow |
| **S5** | A-7 进度 | 以 `digest_updated` 驱动进度；**取消固定 60s 全清** 或改为 batch-aware（按 id 清除）；串行 LLM 可超 60s |
| **S6** | `@` 边 | Wave C-1 **规范 defer 到 C.1b**；C-1 = 共 tag + TF + 可选时间邻近 only |
| **S7** | E2 边维护 | Wave C **on-demand** 计算 related；「写入时维护边」标 future，避免与 C2 冲突 |
| **S8** | tldr 敏感 | 实现注释：tldr/bullets **不走** SENSITIVE_TAG_RE；仅本地 index；不阻塞 A |
| **S9** | 信号权重 | Wave C 权重为 **代码常量**，非用户设置页 |
| **S10** | 测试 | 空批不发；未标注选取含 empty-tags force；busy/worker 过滤；portal z-index（能单测的提纯函数优先） |

## Shared nits（非阻塞）

| ID | Source | Item |
|----|--------|------|
| N-a | Claude | tldr CJK 视觉宽度靠 ellipsis nowrap |
| N-b | Claude | 菜单项顺序：🏷 可紧挨 整理助手 前/后 |
| N-c | Both | A 纯 UI；无协议变更 |

## Blocking union

**无。**

## Recommendation

| Question | Answer |
|----------|--------|
| 设计是否可进实现？ | **是** |
| 是否需再开一轮外审？ | **否**（pins 并入 SoT 后即可） |
| 首切片 | **Wave A only** |
| 下一步 | workflow 实现 Wave A → 单测/构建 → 可选实现 dual-review |

---

*Generated from Claude + Pi independent reviews, 2026-08-11.*

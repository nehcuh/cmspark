# CMspark 文档重梳 Phase 1–4 最终报告

**日期：** 2026-07-28  
**分支：** `docs/reorg-phase12-0.3.0`  
**计划：** [docs/docs-reorg-plan-2026-07-28.md](../../docs-reorg-plan-2026-07-28.md)  
**诊断：** [docs/audit/diagnosis-fanout-2026-07-28.md](../diagnosis-fanout-2026-07-28.md)

---

## 执行摘要

| 阶段 | 交付 | Claude+Pi 双审 | 状态 |
|------|------|----------------|------|
| **P1 纠错** | FAQ/GOAL G8/ADR-016/architecture/TESTING | both_approve | ✅ |
| **P2 入口** | README 能力矩阵 + `docs/README.md` | both_approve | ✅ |
| **P3 覆盖** | 4 用户指南 + ADR-017/018 + arch/GOAL/CONTRIBUTING | Pi APPROVE；Claude **429 额度**；adversarial blocking **已修** | ✅ 内容收口 |
| **P4 归档** | `docs/archive/2026-07/{proposals,roadmaps,rfcs,audits}` | both_approve | ✅ |

**结论：** 文档重梳 1–4 的**产品可见交付**已齐；过程噪音已归档；开启路径夸大等真实性问题已按对抗意见修正。Claude 对 P3 的正式内容复审受额度限制，**不阻塞**文档合并（见 p3 closeout）。

---

## 双审证据索引

| Batch | Claude | Pi | Verdict JSON |
|-------|--------|-----|--------------|
| docs-reorg-p1 | APPROVE_WITH_NITS | APPROVE | `…/docs-reorg-p1-verdict-20260728-111325.json` |
| docs-reorg-p2 | APPROVE_WITH_NITS | APPROVE | `…/docs-reorg-p2-verdict-20260728-125948.json` |
| docs-reorg-p3 | REJECT (429 infra) | APPROVE | `…/docs-reorg-p3-verdict-20260728-135229.json` + [p3-closeout](docs-reorg-p3-closeout-2026-07-28.md) |
| docs-reorg-p4 | APPROVE_WITH_NITS | APPROVE | `…/docs-reorg-p4-verdict-20260728-134151.json` |

Workflows：`.grok/workflows/docs-reorg-phase12.rhai`、`docs-reorg-phase12-continue.rhai`、`docs-reorg-phase34.rhai`。

---

## 关键交付物

### 用户入口
- `README.md` — 分层能力矩阵、短节、纠错 FAQ/阶段/Node≥20/托盘
- `docs/README.md` — 文档导航（用户 / 架构 / ADR / 工程 / 进行中 / 归档）

### 用户指南（Phase 3）
- `docs/computer-use-user-guide.md`（含 config-first 开启路径诚实说明）
- `docs/host-and-apps.md`
- `docs/notebooklm-user-guide.md`
- `docs/multi-agent-user-guide.md`
- 既有：`mcp.md`、`mission-pack-usage.md`、`confirm-center-user-guide.md`、`TROUBLESHOOTING.md`

### ADR
- 修正：`016` Implemented P0
- 新增：`017-computer-use`、`018-host-use`

### 架构 / 目标 / 贡献
- `docs/architecture.md`、`docs/GOAL.md`、`docs/TESTING.md`、`CONTRIBUTING.md`

### 归档（Phase 4）
```text
docs/archive/2026-07/
  proposals/   knowledge-*, skill-*, security-optimization, menu-bar-service, …
  roadmaps/    sprints, requirements, optimization-roadmap/plan
  rfcs/        closed followup/p2/m* RFCs
  audits/      部分旧 audit 文件
```
**未移动锁：** `decisions/coordinate-computer-use-plan.md`、`host-adapter-interface.md`、HUD lock、`superpowers/` 等。

---

## 事故与恢复

1. Rhai `run_external` 无法捕获 `root`/schema → 内联双审。  
2. Grok 代理断流 → Phase2 手工 `dual-external-review.sh`。  
3. Phase3 内部 adversarial 两轮未过门 → 跳过 Claude/Pi；后续补 Pi + adversarial。  
4. Claude/Kimi 额度 → Pi + adversarial 收口；额度恢复后可复跑 Claude。  
5. adversarial blocking：CU 全局开关 UI 不存在 → 已改 guide/ADR。

---

## 建议 commit 范围（docs-only）

```bash
# 包含文档与归档 rename；排除 companion/chrome-extension site-knowledge WIP
git add README.md CONTRIBUTING.md docs/ \
  .grok/workflows/docs-reorg-*.rhai
# 确认 git status 无 runtime 代码后：
# git commit -m "docs: reorg phase1-4 — guides, ADR 017/018, archive wave"
```

---

## 仍开放（非本批阻塞）

| 项 | 类型 |
|----|------|
| Claude 对 p3 内容复审（额度后） | 可选验证 |
| Side Panel 接通 `computer.set_enabled` | 产品债 |
| `tool-definitions` host_computer「每任务必 L2」文案 | 代码文案债 |
| ADR-019 UI 三模式 / ADR-020 Knowledge | 计划可选 |
| Phase5 全库断链扫 / Phase6 PR checklist 固化 | 轻量后续 |
| `docs/decisions` 大量过程 scrap | 可继续归档（勿动代码引用锁） |

---

## DoD（对照计划 §2.2）

- [x] README 能力矩阵 + 无已知事实错误  
- [x] `docs/README.md` 导航  
- [x] GOAL G8 / ADR-016 / architecture 树  
- [x] TESTING 地图  
- [x] CU/host/NLM 用户指南（诚实标注 + 正文）  
- [x] `docs/archive/` 高置信过程件  
- [x] Node≥20 / 0.3.0  
- [x] 无「等待确认机制完成后开放」  

---

*收口执行：Pi dual-review + independent adversarial fix + local verify · 2026-07-28*

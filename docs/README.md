# CMspark 文档导航

> 产品 **0.3.0** · 入口 README：[仓库根 README.md](../README.md)  
> 本页只做**导航**，不搬运正文。过程件已于 **Phase 4** 迁入 [`archive/2026-07/`](archive/2026-07/)；`user/` 物理搬家仍可选（见 [docs-reorg-plan-2026-07-28.md](docs-reorg-plan-2026-07-28.md)）。

---

## 用户指南

| 文档 | 说明 |
|------|------|
| [../README.md](../README.md) | 安装、能力矩阵、快速用、配置与托盘 |
| [confirm-center-user-guide.md](confirm-center-user-guide.md) | 确认台 / Cockpit、L2 审批、Computer Use 操控台 |
| [mcp.md](mcp.md) | MCP server 配置、信任级别、Resources/Prompts、排错 |
| [mission-pack-usage.md](mission-pack-usage.md) | 任务包、企业模块、workspace/shell/netsec |
| [computer-use-user-guide.md](computer-use-user-guide.md) | Computer Use：启用、急停、session-trust、平台与限制 |
| [host-and-apps.md](host-and-apps.md) | Host 读写、Apps 白名单、生物识别边界 |
| [notebooklm-user-guide.md](notebooklm-user-guide.md) | NotebookLM 导入器入口、权限、导入结果 |
| [multi-agent-user-guide.md](multi-agent-user-guide.md) | spawn_worker、tab 锁、Mission Board、上限 |
| [TROUBLESHOOTING.md](TROUBLESHOOTING.md) | 常见故障速查 |

### 导出 / 图表（ADR 即用户向说明）

| 能力 | 文档 |
|------|------|
| **Obsidian 导出** | [ADR-008](adr/008-obsidian-export.md) |
| **Mermaid 渲染** | [ADR-009](adr/009-mermaid-rendering.md) |

---

## 架构与目标

| 文档 | 说明 |
|------|------|
| [architecture.md](architecture.md) | 活架构：双层拓扑 + 桌面面、MCP/CU/Host/编排/Board/Packs |
| [GOAL.md](GOAL.md) | 项目目标与阶段（与 0.3.0 对齐） |
| [DESIGN.md](DESIGN.md) | UI / 设计 token 约定 |
| [security-design-tiered-gates-2026-07-11.md](security-design-tiered-gates-2026-07-11.md) | 分层门禁设计说明 |

---

## ADR（架构决策记录）

目录：[adr/](adr/)

| ID | 主题 | 文件 |
|----|------|------|
| 001 | Extension ↔ Companion 双层拓扑 | [001](adr/001-extension-companion双层拓扑.md) |
| 002 | WebSocket + OpenAI streaming | [002](adr/002-websocket-openai-streaming协议.md) |
| 003 | SQLite history store | [003](adr/003-sqlite-history-store.md) |
| 004 | Skill Markdown + YAML | [004](adr/004-skill-markdown-yaml格式.md) |
| 005 | Cookie 信任域 | [005](adr/005-cookie-trust-domain-security.md) |
| 006 | 分层防御 | [006](adr/006-layered-defense.md) |
| 007 | 域白名单 / 自动批准 | [007](adr/007-domain-whitelist-auto-approve.md) |
| 008 | Obsidian 对话导出 | [008](adr/008-obsidian-export.md) |
| 009 | Mermaid 渲染 | [009](adr/009-mermaid-rendering.md) |
| 010 | 分级特权 / god-mode | [010](adr/010-tiered-privilege-godmode.md) |
| 011–013 | NotebookLM 导入（v1 → online → v1.2） | [011](adr/011-notebooklm-import.md) · [012](adr/012-notebooklm-importer-online.md) · [013](adr/013-notebooklm-importer-v12.md) |
| 014 | Mission Pack + 企业模块 | [014](adr/014-mission-pack-enterprise-modules.md) |
| 015 | Multi-Agent Orchestrator + Tab 锁 | [015](adr/015-multi-agent-orchestrator-tab-lock.md) |
| 016 | Mission Board（P0 Implemented） | [016](adr/016-mission-board.md) |
| 017 | Computer Use（Implemented） | [017](adr/017-computer-use.md) |
| 018 | Host Use / Apps（Implemented） | [018](adr/018-host-use.md) |

拟议后续：UI 三模式 + Cockpit（019）、Knowledge 系统（020）等 — 见 reorg 计划。

---

## 工程

| 文档 | 说明 |
|------|------|
| [TESTING.md](TESTING.md) | 测试地图与命令（companion + extension） |
| [supply-chain.md](supply-chain.md) | 供应链审计姿态与 CI 门槛 |
| [../CONTRIBUTING.md](../CONTRIBUTING.md) | 贡献、搭建、目录树、文档 checklist |
| [licenses/cairn-inspiration.md](licenses/cairn-inspiration.md) | Mission Board / Cairn 灵感与 AGPL 边界说明 |

---

## 进行中（Working）

| 路径 | 说明 |
|------|------|
| [superpowers/specs/](superpowers/specs/) | 锁定中的产品/设计 spec（如 UI 三模式、Mission Pack 企业设计） |
| [superpowers/plans/](superpowers/plans/) | 实施 plan / spike（含 HUD 等） |
| [decisions/](decisions/) | 对抗评审 brief、synthesis、锁文件；**被代码注释引用的路径勿盲删** |
| [docs-reorg-plan-2026-07-28.md](docs-reorg-plan-2026-07-28.md) | 本文档重梳总计划（Phase 1–4） |

---

## 归档（非规范 · historical）

统一入口：[`archive/`](archive/) · 本波次：[`archive/2026-07/`](archive/2026-07/)

| 子目录 | 内容 |
|--------|------|
| [archive/2026-07/proposals/](archive/2026-07/proposals/) | tournament / 提案（knowledge*、skill-management、security-optimization、menu-bar-service、network-interceptor） |
| [archive/2026-07/roadmaps/](archive/2026-07/roadmaps/) | [sprints](archive/2026-07/roadmaps/sprints/)、[requirements](archive/2026-07/roadmaps/requirements/)、optimization-roadmap / optimization-plan |
| [archive/2026-07/rfcs/](archive/2026-07/rfcs/) | 已迁入的根级 `*rfc*` 草稿 |
| [archive/2026-07/audits/](archive/2026-07/audits/) | 旧 root audits（如 audit-report-2026-06-05） |

**仍在主树（故意保留）：**

| 区域 | 说明 |
|------|------|
| [audit/](audit/) | 近期诊断 / fanout / handoff / reviews |
| [decisions/](decisions/) | 锁文件与 synthesis；**被代码注释引用的路径勿盲删** |
| [superpowers/](superpowers/) | 进行中 specs/plans |
| [optimization-plan-post-v0.3.0.md](optimization-plan-post-v0.3.0.md) | 发布后仍开放的 P2+ 工作（未归档） |
| [remediation-plan-2026-07-09.md](remediation-plan-2026-07-09.md)、[security-design-tiered-gates-2026-07-11.md](security-design-tiered-gates-2026-07-11.md) | 仍被引用的设计/修复说明 |

**政策：** 过程件仅用 `git mv` 进 `archive/YYYY-MM/…`；各叶目录 README 标明「非规范」。代码或 ADR 仍引用的锁必须保留路径或先改引用。

---

## 维护提示

- 新功能 PR：更新根 README 能力矩阵一行 + 本导航表（若新增用户文档）+ 必要时 ADR + [CONTRIBUTING 文档 checklist](../CONTRIBUTING.md#文档-checklist功能-pr-合并前)。  
- 事实以 **0.3.0 代码** 与 live ADR 为准；过程稿冲突时以 ADR / architecture / 用户指南为准。  
- 详细 DoD 与分阶段： [docs-reorg-plan-2026-07-28.md](docs-reorg-plan-2026-07-28.md)。

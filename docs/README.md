# CMspark 文档导航

> 产品 **0.5.7** · 入口 README：[仓库根 README.md](../README.md)  
> 本页只做**导航**，不搬运正文。过程件已于 **Phase 4** 迁入 [`archive/2026-07/`](archive/2026-07/)；`user/` 物理搬家仍可选（见 [docs-reorg-plan-2026-07-28.md](docs-reorg-plan-2026-07-28.md)）。

---

## 用户指南

> 能力分层（**Surface / Composition / Autonomy**）见 [ADR-020](adr/020-capability-model-three-axes.md)。下表「坐标」帮助选对文档：高级场景多为 **组合面** 复用，不必默认上 L2 桌面。

| 文档 | 坐标（摘要） | 说明 |
|------|----------------|------|
| [../README.md](../README.md) | 全景 | 家 = 已登录 Chrome；Capture / 租手 / 安装 |
| [../PRODUCT.md](../PRODUCT.md) | 产品句 | 四面 Capture·Operate·Confirm·租手 |
| [summoner-user-guide.md](summoner-user-guide.md) | **Capture** | 召唤器 HTML 卡 360×420、流式、永不审批、请点工具栏 C |
| [confirm-center-user-guide.md](confirm-center-user-guide.md) | **横切 Trust UI**（L1/L2） | 确认台 / Cockpit、高危审批、CU 操控台 |
| [mcp.md](mcp.md) | **Composition** | MCP server（Inbound + **Outbound ADR-022**）、Grok `config.toml`、信任级别、Resources/Prompts、排错 |
| [user-env.md](user-env.md) | **Composition**（密钥） | skill / shell / MCP 子进程 Secrets（如 Datayes） |
| [mission-pack-usage.md](mission-pack-usage.md) | **Composition**（+ 企业 Channel） | 任务包、模块、workspace/shell/netsec |
| [computer-use-user-guide.md](computer-use-user-guide.md) | **Surface L2** | 坐标桌面、急停、session-trust、平台限制 |
| [qwen-vl-experimental-layer.md](qwen-vl-experimental-layer.md) | **Surface L2 · 实验** | Qwen3-VL 本机视觉定位：预检、下载源（含魔搭）、启用 |
| [host-and-apps.md](host-and-apps.md) | **Surface L2**（语义 Host） | Host 读写、Apps 白名单、生物识别边界 |
| [coding-handoff-user-guide.md](coding-handoff-user-guide.md) | **Composition** | 编程接力：任务包 / 本机 ACP 审查·起草·gated apply；≠ Outbound MCP |
| [multi-agent-user-guide.md](multi-agent-user-guide.md) | **Autonomy**（Worker≈L1） | spawn_worker、tab 锁、Mission Board、上限 |
| [notebooklm-user-guide.md](notebooklm-user-guide.md) | **产品特性**（非组合原语） | NotebookLM 导入器、权限、结果 |
| [meeting-and-dictation-user-guide.md](meeting-and-dictation-user-guide.md) | **产品特性** L0 输入 / Pack | 听写+（含按住热键、HF 镜像、当次会话回退）· 会议 Mtg0–3（说话人「自动」档） |
| [TROUBLESHOOTING.md](TROUBLESHOOTING.md) | — | 常见故障速查 |

### 导出 / 图表（产品特性 · ADR 即用户向说明）

| 能力 | 坐标 | 文档 |
|------|------|------|
| **Obsidian 导出** | 产品特性（聊天面导出） | [ADR-008](adr/008-obsidian-export.md) |
| **Mermaid 渲染** | 产品特性（消息渲染） | [ADR-009](adr/009-mermaid-rendering.md) |

---

## 架构与目标

| 文档 | 说明 |
|------|------|
| [architecture.md](architecture.md) | 活架构：双层拓扑 + 桌面面、MCP/CU/Host/编排/Board/Packs |
| **[ADR-020 能力三轴](adr/020-capability-model-three-axes.md)** | **Surface · Composition · Autonomy** 本体（能力叠加与防「杂」纪律） |
| [GOAL.md](GOAL.md) | 项目目标与阶段（与 **0.5.7** 对齐；扩展目标带轴标注） |
| [../PRODUCT.md](../PRODUCT.md) | 产品一句话 / 四面（Capture·Operate·Confirm·租手）；家 = 已登录 Chrome + 硬闸 |
| [2026-08-26-product-form-deepening-design.md](superpowers/specs/2026-08-26-product-form-deepening-design.md) | **形态深化 SoT**（定位、文案合同、L8、五分钟租手、切片 DoD） |
| [2026-08-27-post-227-status.md](superpowers/specs/2026-08-27-post-227-status.md) | **SNAPSHOT** 0.5.3 / #227（T1 已记分；**不是**活状态） |
| [2026-08-26-post-226-status.md](superpowers/specs/2026-08-26-post-226-status.md) | **#226 后快照**（已被 post-227 取代；二者皆非活状态） |
| [2026-08-26-slice-6-match-idf-runprogress.md](superpowers/plans/2026-08-26-slice-6-match-idf-runprogress.md) | **切片 6 计划**（IDF + RunProgress）— 已合 #227；残留 [#230](https://github.com/nehcuh/cmspark/issues/230) |
| [../CHANGELOG.md](../CHANGELOG.md) | 版本变更记录 |
| [DESIGN.md](DESIGN.md) | UI / 设计 token 约定；Mode badge = Surface；召唤器默认收起条 |
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
| 019 | User-env secrets（shell/MCP） | [019](adr/019-user-env-secrets.md) |
| **020** | **Capability model · three axes** | [020](adr/020-capability-model-three-axes.md) |
| 021 | 无人值守 · 桌面会话 grant | [021](adr/021-unattended-desktop-session.md) |
| **022** | **Outbound MCP Server**（编程 Agent 的 L1 浏览器面） | [022](adr/022-outbound-mcp-server.md) |
| **023** | **本机语音识别 Path B**（Local STT / whisper.cpp） | [023](adr/023-voice-local-stt-path-b.md) |
| **024** | **听写+ · ASR Refiner · 会议落盘** | [024](adr/024-dictation-plus-asr-refiner-meeting.md) |
| **025** | **ACP Coding Agent Client（编程接力）** | [025](adr/025-acp-coding-agent-client.md) |

过程件：UI 三模式 / Cockpit 以 `docs/superpowers/specs/` 与 [DESIGN.md](DESIGN.md) 为准（**勿**再记「拟议 ADR-019 UI」——019 已是 user-env）。

---

## 工程

| 文档 | 说明 |
|------|------|
| [TESTING.md](TESTING.md) | 测试地图与命令（companion + extension） |
| [supply-chain.md](supply-chain.md) | 供应链审计姿态与 CI 门槛 |
| [../CONTRIBUTING.md](../CONTRIBUTING.md) | 贡献、搭建、**需求设计 Issue-first**、目录树、文档 checklist |
| [../.github/ISSUE_TEMPLATE/design.md](../.github/ISSUE_TEMPLATE/design.md) | 需求设计 Issue 模板（新行为必须先开票） |
| [../.github/pull_request_template.md](../.github/pull_request_template.md) | PR 模板（含 ADR-020 能力声明 + 关联 Issue） |
| [licenses/cairn-inspiration.md](licenses/cairn-inspiration.md) | Mission Board / Cairn 灵感与 AGPL 边界说明 |

---

## 后续工作（Active backlog）

| 文档 | 说明 |
|------|------|
| [optimization-plan-post-adr-020.md](optimization-plan-post-adr-020.md) | **历史骨架**（0.4.0；P1 已 FIXED，**勿当活排序**） |
| **[optimization-plan-au4dch-ux-shell-download.md](optimization-plan-au4dch-ux-shell-download.md)** | **UX 子轨**（#au4dch）：下载去重 · 长 tool/舰队运行态 · shell 黑窗止血与网页 PTY epic |
| **[optimization-plan-agent-skill-install.md](optimization-plan-agent-skill-install.md)** | **Backlog**：Agent 在 Chrome 下载 skill → 安装到 `~/.cmspark-agent/skills`（一等 `skill_install`） |
| **[optimization-plan-document-parse-vision.md](optimization-plan-document-parse-vision.md)** | **Backlog**：聊天附件文档解析 / 图文理解（P0 增强现有管道 → P1 OCR/结构 → P2 DocAI） |
| **[ADR-022 Outbound MCP](adr/022-outbound-mcp-server.md)** | **Accepted · Phase 0 门控**：对外编程 Agent 的 curated L1 面；brief/spike 见 decisions + superpowers/plans |
| [audit/p1-security-open-items-2026-07-29.md](audit/p1-security-open-items-2026-07-29.md) | 07-28 诊断 P1 四条代码盘点（god-mode / originWs / evaluate / shell） |
| [audit/reviews/_templates/dual-review-capability-checklist.md](audit/reviews/_templates/dual-review-capability-checklist.md) | dual-review 能力声明检查清单 |
| [audit/reviews/_templates/eval-gate-card.md](audit/reviews/_templates/eval-gate-card.md) | Eval Engineering 放行卡片（机核 + dual + blast） |
| [superpowers/plans/2026-08-04-outbound-mcp-p0c-eval-gates.md](superpowers/plans/2026-08-04-outbound-mcp-p0c-eval-gates.md) | Outbound MCP P0c 门控卡（M1–M9） |
| [superpowers/plans/2026-08-04-outbound-mcp-p0d-bakeoff-checklist.md](superpowers/plans/2026-08-04-outbound-mcp-p0d-bakeoff-checklist.md) | P0d 记分表：T1 **已记分**（[#228](https://github.com/nehcuh/cmspark/issues/228) 已关）；**仍禁扩** profile；T2/T3 未跑 |
| **GitHub [#230](https://github.com/nehcuh/cmspark/issues/230)** | **冻**：F-S-10 / overlay-acl。grant-cli 未知 flag 与 H1 精确勾已不在此清单 |
| **GitHub [#258](https://github.com/nehcuh/cmspark/issues/258)–[#260](https://github.com/nehcuh/cmspark/issues/260)** | 语音 UX Hex · Windows SAPI 兜底 · speaker embedding diarize |
| [skills/eval-engineering-gate/SKILL.md](skills/eval-engineering-gate/SKILL.md) | Eval Engineering 闸门 skill（机核 + dual + blast） |
| [decisions/daily-content-loop-brief-2026-08-04.md](decisions/daily-content-loop-brief-2026-08-04.md) | **DIRECTION LOCKED**：每日情报环（公开站·本地模型·本机+邮件·代码+网页验证） |
| [optimization-plan-post-v0.3.0.md](optimization-plan-post-v0.3.0.md) | 历史：v0.3.0 后 P2/P3 闭环考古（**勿再作排序权威**） |

---

## 进行中（Working）

| 路径 | 说明 |
|------|------|
| [superpowers/specs/](superpowers/specs/) | 锁定中的产品/设计 spec。**新 SoT 必须先有 GitHub Issue** |
| [superpowers/plans/](superpowers/plans/) | 实施 plan / spike（含 HUD 等）；文件头写 `GitHub: #N` |
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
| [Qwen3-VL 实验层 · 产品设计](superpowers/specs/2026-08-01-qwen3-vl-experimental-layer-product-design.md) | SoT（经多路对抗 + Pi/Claude/Kimi） |
| [Qwen3-VL 实验层 · 实施 plan](superpowers/plans/2026-08-01-qwen3-vl-experimental-layer-impl.md) | **后续开工入口** |
| [Qwen3-VL 实验层 · 交接](superpowers/plans/2026-08-01-qwen3-vl-HANDOFF.md) | 下一任 15 分钟上手 |
| [macOS TCC 产品身份 · 设计](superpowers/specs/2026-08-01-macos-tcc-product-identity-design.md) | SoT（对抗验证）：隐私设置只认 CMspark |
| [macOS TCC 产品身份 · 实施 plan](superpowers/plans/2026-08-01-macos-tcc-product-identity-impl.md) | 方案 D：MacOS/CMspark=host Mach-O；Tasks 0–8 |
| [macOS TCC 对抗合成](audit/reviews/macos-tcc-product-identity-adversary-synthesis-20260801.md) | 方案裁决 + Blocker 清单 |
| [optimization-plan-post-v0.3.0.md](optimization-plan-post-v0.3.0.md) | 发布后仍开放的 P2+ 工作（未归档） |
| [remediation-plan-2026-07-09.md](remediation-plan-2026-07-09.md)、[security-design-tiered-gates-2026-07-11.md](security-design-tiered-gates-2026-07-11.md) | 仍被引用的设计/修复说明 |

**政策：** 过程件仅用 `git mv` 进 `archive/YYYY-MM/…`；各叶目录 README 标明「非规范」。代码或 ADR 仍引用的锁必须保留路径或先改引用。

---

## 维护提示

- 新功能 PR：更新根 README 能力矩阵一行 + 本导航表（若新增用户文档）+ 必要时 ADR + [CONTRIBUTING 文档 checklist](../CONTRIBUTING.md#文档-checklist功能-pr-合并前)。  
- 事实以 **0.5.7 代码**（`companion`/`chrome-extension` `package.json`）与 live ADR 为准；过程稿冲突时以 ADR / architecture / 用户指南为准。  
- 详细 DoD 与分阶段： [docs-reorg-plan-2026-07-28.md](docs-reorg-plan-2026-07-28.md)。

# CMspark 项目文档重梳计划

**日期:** 2026-07-28  
**依据:** [diagnosis-fanout-2026-07-28.md](audit/diagnosis-fanout-2026-07-28.md)  
**产品版本:** companion / chrome-extension **0.3.0**  
**目标:** 内容与代码匹配 · 核心入口在 README · 过时删除/归档 · 覆盖全面且可导航  
**原则:** 先纠错、再导航、再补缺、最后归档；**禁止首轮 `git rm` 历史过程件**（先 `git mv` 到 archive）

---

## 1. 问题陈述（为何要做）

| 症状 | 影响 |
|------|------|
| README 停在 MVP 叙事，沉默已交付大面 | 新用户/贡献者看不到真实产品 |
| 事实错误（evaluate FAQ、G8 幽灵安全层、ADR-016 未实现） | 误导安全决策与开发优先级 |
| `docs/` 约 300+ md，decisions+audit 占主体 | 检索成本高，AI/人重复发明轮子 |
| 好文档存在但不入 README | `mcp.md` / `mission-pack-usage.md` / `confirm-center-user-guide.md` 几乎「隐身」 |
| 缺用户向指南 | computer-use、host/apps、NotebookLM 只有 ADR/过程稿 |
| TESTING / CONTRIBUTING 结构过时 | 工程上手成本虚高 |

---

## 2. 目标与成功标准

### 2.1 目标

1. **单一可信入口：** README = 安装 + 能力全景 + 文档导航；深度内容下沉到 `docs/`。
2. **与代码同构：** architecture / GOAL / ADR 状态反映 0.3.0 真实模块。
3. **分层清晰：** 用户文档 · 架构/ADR · 工程 · 过程归档 四层不混。
4. **可维护：** 新增功能 PR 必须触达文档 checklist（见 §7）。
5. **可删除噪音：** 过程件出主导航；closed RFC 状态戳记后归档。

### 2.2 完成定义（DoD）

- [x] README 能力矩阵覆盖所有 **已交付** 一等能力，并链到指南；无已知事实错误。 *(Phase1+2 · 2026-07-28 · dual-reviewed)*
- [x] `docs/README.md` 导航页存在，分「用户 / 架构 / ADR / 工程 / 归档」。 *(Phase2)*
- [x] GOAL G8、ADR-016 状态、architecture §4 树与 phantom 路径已修正。 *(Phase1)*
- [x] TESTING.md 反映当前 test 地图（≥ companion 主要目录 + extension）。 *(Phase1)*
- [x] 缺失三大用户指南有可运行路径（CU / host-apps / NotebookLM）或 README 诚实标注「进阶 / 见 ADR」。 *(Phase2 诚实标注；**Phase3 已写完整用户指南** · 2026-07-28)*
- [x] `docs/archive/` 收纳至少：sprints、requirements、tournament losers、closed RFCs、旧 root audits；主目录不再堆未分类 RFC。 *(Phase4 · 2026-07-28 · `docs/archive/2026-07/{proposals,roadmaps,rfcs,audits}`)*
- [x] Node 版本、产品版本（0.3.0）在 README / CONTRIBUTING 一致。 *(Phase1)*
- [x] `rg` 抽查：README 不再出现「等待确认机制完成后开放」类过时句。 *(Phase1 dual-reviewed)*

---

## 3. 目标信息架构（Target IA）

```text
README.md                          # 入口：简介 · 能力矩阵 · 安装 · 快速用 · 链出去
CONTRIBUTING.md                    # 开发搭建 · 测试 · 提交 · 文档 checklist
docs/
  README.md                        # 文档导航（新增）
  user/                            # 用户指南（可逐步迁移；过渡期可用软链/路径别名）
    mcp.md                         # 现有 → 迁入或在导航中固定
    mission-pack-usage.md
    confirm-center-user-guide.md
    computer-use.md                # 新增
    host-and-apps.md               # 新增（host-use + apps）
    notebooklm.md                  # 新增
    multi-agent-and-board.md       # 可选：从 mission-pack §10 + ADR-015/016 提炼
    obsidian-export.md             # 可选短页；或 README 链 ADR-008
    troubleshooting.md             # 现有 TROUBLESHOOTING.md
  architecture.md                  # 唯一活架构图（模块与拓扑与代码同步）
  GOAL.md                          # 目标与阶段（删幽灵架构）
  DESIGN.md                        # 设计 token / UI 约定
  adr/                             # 001–016 + 拟议 017/018…
  eng/
    TESTING.md
    supply-chain.md
    release-notes-process.md       # 可选：从 optimization-plan-post-v0.3.0 提炼
  superpowers/                     # 进行中 specs/plans（工作区，非用户导航）
  archive/                         # 过程考古（只读）
    YYYY-MM/
      decisions/
      audits/
      rfcs/
      proposals/
      roadmaps-sprints/
```

**过渡策略（推荐）：**  
Phase A **不强制** 立刻物理 `docs/user/` 搬家（避免断链潮）。先建 `docs/README.md` 导航 + 修入口文档；Phase C 再批量 `git mv` 并改相对链接。

---

## 4. 文档分级与处置规则

| 分级 | 定义 | 处置 |
|------|------|------|
| **A — Live** | 用户或贡献者日常依赖 | 保持在主树；PR 必更新 |
| **B — Working** | 进行中设计锁 / plan | `superpowers/`、少量 `decisions` 锁文件；完成后升 ADR 再归档过程 |
| **C — Archive** | 历史有价值、非规范 | `docs/archive/`；顶部加「非规范」横幅 |
| **D — Collapse** | 被 final-design/ADR 取代的 tournament 草稿 | 只保留 final 或直接归档全套 |

### 4.1 当前分级快照

| 路径 | 分级 | 动作 |
|------|------|------|
| `README.md` | A | **重写能力层 + 纠错** |
| `docs/mcp.md`, `mission-pack-usage.md`, `confirm-center-user-guide.md`, `TROUBLESHOOTING.md` | A | 链入 README；小修 |
| `docs/architecture.md`, `GOAL.md` | A | **纠错 + 补模块** |
| `docs/adr/001–016` | A | 修 006/016 漂移；补 017+ |
| `docs/DESIGN.md`, `supply-chain.md` | A | 保留 |
| `docs/TESTING.md`, `CONTRIBUTING.md` | A | **重写/扩充** |
| `docs/superpowers/specs/*`, 进行中 HUD plan | B | 保留 |
| 被代码 `// see docs/decisions/...` 引用的锁 | B | 保留直至 ADR 替换路径 |
| `docs/decisions/**` 过程 scrap | C | 归档（保留锁） |
| `docs/audit/**` 已合并 batch | C | 归档 |
| root `AUDIT_*` / `audit-report-*` | C | 归档 |
| closed `*rfc*` / `p2-3-*` 已闭环 | C | 戳记后归档 |
| `*-proposal/{aggressive,balanced,conservative}` | D | 归档；final 视情况保留或归档 |
| `docs/security-optimization/`, `menu-bar-service/` | D/C | 整夹归档 |
| `docs/sprints/`, `docs/requirements/` | C | 归档 |
| `docs/optimization-roadmap.md`, `ROADMAP_2026-06-16.md` | C | 归档 |
| `network-interceptor-proposal/` | C | 归档（未实现概念） |

---

## 5. 分阶段执行计划

### Phase 0 — 冻结与清单（0.5 天）

1. 以本文件 + fanout 报告为基线；开 issue / 分支 `docs/reorg-0.3.0`。
2. 导出链接清单：`rg -n 'docs/' README.md CLAUDE.md AGENTS.md docs/*.md`（改路径前摸底）。
3. 列出 **代码引用 docs 路径**（`rg 'docs/decisions' companion chrome-extension`）— 这些 **不可盲归档**。

**产出：** `docs/archive/README.md` 政策 + 锁定文件列表。

---

### Phase 1 — 纠错（P0，1 天）— *先保证不骗人*

| # | 文件 | 修改要点 |
|---|------|----------|
| 1.1 | `README.md` | 删除/改写 FAQ「evaluate … 等待确认机制完成后开放」→ 描述 L2 确认 / Cockpit / 超时 |
| 1.2 | `README.md` | 「当前阶段」改为：MVP 已稳定 + 已交付扩展列表 + opt-in 进阶 |
| 1.3 | `README.md` | 包示例 `v0.2.0` → `0.3.0`；Node ≥20 与 CONTRIBUTING 对齐 |
| 1.4 | `README.md` | macOS 托盘：Swift NSStatusBar + 配对码（非仅 readline） |
| 1.5 | `docs/GOAL.md` | G8 删除 risk-engine / privilege-manager；对齐真实门（信任域 / L2 / 白名单 / god-mode ADR-010） |
| 1.6 | `docs/adr/016-mission-board.md` | 状态改为 Implemented（P0）或 Implemented partial，与 `board/` 一致 |
| 1.7 | `docs/architecture.md` | §4 去掉 phantom（`server/` 子目录、`security-token.ts`、`ConnectionStatus.tsx` 等）；根名 `cmsspark` 笔误；补真实目录 |
| 1.8 | `docs/TESTING.md` | 重写测试地图与命令（删 `server.test.ts`） |

**验收：** 人工通读 + `rg` 负向检查幽灵术语。

**状态（2026-07-28）：Phase 1 已完成** — 上表 1.1–1.8 均已改入；负向 `rg`：`等待用户确认机制完成后开放`、`risk-engine 风险评分 + privilege-manager` 作为 live 表述已清除。未提交。

**状态（2026-07-28）：Phase 2 已完成** — README 分层能力矩阵 + 短节（安全/MCP/任务包/导出导入/桌面宿主/多 Agent/文件上传/相关文档表）+ TOC；Skills `tool_chain`/`sub_agent` 标实验；数据目录树扩展；新增 [`docs/README.md`](README.md) 导航（用户|架构|ADR|工程|进行中|归档说明，未物理搬 archive）。未提交。

**状态（2026-07-28）：Phase 3 已完成** — 用户指南 `computer-use-user-guide` / `host-and-apps` / `notebooklm-user-guide` / `multi-agent-user-guide`；architecture §8–11（MCP/CU·Host·Apps/Orchestrator·Board/工具分类）+ 拓扑桌面面；GOAL 已交付 MCP/CU·Host/multi-agent·board/NotebookLM；CONTRIBUTING 目录树 + 文档 checklist + 测试命令；ADR-017/018 Implemented；README + docs/README 进阶行指向新指南。未提交。

**状态（2026-07-28）：Phase 4 已完成** — `git mv` 高置信度过程件入 `docs/archive/2026-07/{proposals,roadmaps,rfcs,audits}/`（sprints/requirements/proposals/旧 roadmap/root audits/根级 `*rfc*`）；叶目录 README「非规范」；`docs/README.md` 归档导航更新；锁文件/`optimization-plan-post-v0.3.0`/`decisions`/`superpowers`/`audit/` 未动。**未提交。**

**状态（2026-07-28）：Phase 5 链接校验（post-archive）** — 入口文档（README / CONTRIBUTING / CLAUDE / docs/README / 用户指南 / live ADR）相对链接抽查 0 broken；旧路径 `docs/sprints|requirements|security-optimization|menu-bar-service|…` 在入口树已清；live 树两处引用改指向 `archive/2026-07/…`；companion 代码注释 `docs/decisions/*` 锁路径仍在（`phase0-linux/windows-gate-evidence` 为 RUNBOOK 捕获目标，非预置文件）；CLAUDE Related Docs 对齐新用户指南。归档内部交叉引用保留为历史。**未提交。**

---

### Phase 2 — README 成为核心入口（P0，1 天）

#### 2.1 能力矩阵（建议结构）

```markdown
### 核心能力（分层）

| 层级 | 能力 | 说明 | 文档 |
|------|------|------|------|
| 核心 | 浏览器 CDP 工具、多线程、Skills、Knowledge、历史 | … | 本页 |
| 核心 | 安全确认 / Confirm Center | L2、白名单、Cockpit | confirm-center-user-guide |
| 已交付 | MCP | 外接 MCP 工具 | mcp.md |
| 已交付 | Mission Pack / 企业模块 | 任务包、workspace/shell/netsec | mission-pack-usage |
| 已交付 | Obsidian 导出、Mermaid、NotebookLM 导入 | … | ADR-008/009 / notebooklm 指南 |
| 进阶/opt-in | Computer Use / Host Use / Apps | 桌面操控与应用白名单 | computer-use / host-and-apps |
| 进阶 | Multi-agent / Mission Board | 多 worker、tab 锁、黑板 | mission-pack § / multi-agent |
| 运维 | Daemon / 托盘 / 配对 | … | 本页后台服务节 |
```

#### 2.2 新增短节（每节 5–15 行 + 外链，避免 README 膨胀失控）

1. 安全与确认  
2. MCP  
3. 任务包与企业模块  
4. 导出与导入（Obsidian 📥/🧠、NotebookLM、vault→knowledge）  
5. 桌面与宿主操控（注明平台与 opt-in）  
6. 多 Agent 与任务板  
7. 文件上传（PDF/Office/文本）  
8. 相关文档（完整导航表）

#### 2.3 调整既有节

- 工具数量：改为「浏览器工具 + Companion/Host/MCP/编排类工具（分类见 architecture）」——避免写死 23。  
- Skills：`tool_chain` / `sub_agent` 标为 schema/实验，勿与 multi-agent orchestrator 混淆。  
- Knowledge 节：**保留**（当前质量高）。  
- 后台服务：补配对与 Swift tray。

#### 2.4 新增 `docs/README.md`

导航表：用户指南 | 架构与目标 | ADR | 工程 | 进行中 | 归档。

**验收：** 新人只读 README 能在 10 分钟内知道「能做什么 / 怎么装 / 危险操作怎么确认 / 去哪看深」。

---

### Phase 3 — 补齐覆盖（P1，2–3 天）

| 新文档 | 内容骨架 | 源材料（提炼勿复制粘贴过程） |
|--------|----------|------------------------------|
| `docs/computer-use-user-guide.md`（或 `user/computer-use.md`） | 启用条件、Cockpit 急停、session-trust 含义、平台差异、限制 | decisions plan + confirm-center + computer/* |
| `docs/host-and-apps.md` | host_read/write/app、应用白名单、生物识别边界 | host-adapter-interface + apps + w7/w8 finals |
| `docs/notebooklm-user-guide.md` | 面板入口、权限、导入结果去向 | ADR-011–013 用户向摘要 |
| （可选）`docs/multi-agent-user-guide.md` | spawn、tab lock、board 工具与 UI | ADR-015/016 + mission-pack §10 |

同时：

- **architecture.md** 增加 §：MCP、Computer/Host Use、Orchestrator/Board、Apps、Packs（拓扑图扩展桌面面）。  
- **GOAL.md** 增加「已交付」：MCP、CU、multi-agent、board、NotebookLM（与 Obsidian/Mermaid/Pack 同级）。  
- **CONTRIBUTING.md** 更新目录树 + 文档 checklist + 测试命令。

**ADR 补位（可与写作并行）：**

| 拟议 | 主题 | 从何晋升 |
|------|------|----------|
| ADR-017 | Computer Use | `coordinate-computer-use-plan.md` |
| ADR-018 | Host Use | `host-adapter-interface.md` |
| ADR-019 | UI 三模式 + Cockpit | superpowers UI spec |
| ADR-020 | Knowledge 系统 | final-design + 现状代码（修「待实施」） |

---

### Phase 4 — 归档浪潮（P1–P2，1–2 天）

```bash
# 示意：一律 git mv，禁止首轮 rm
mkdir -p docs/archive/2026-07/{decisions,audits,rfcs,proposals,roadmaps}

# 高置信度整夹
git mv docs/sprints docs/archive/2026-07/roadmaps/
git mv docs/requirements docs/archive/2026-07/roadmaps/
git mv docs/security-optimization docs/archive/2026-07/proposals/
git mv docs/menu-bar-service docs/archive/2026-07/proposals/
git mv docs/network-interceptor-proposal docs/archive/2026-07/proposals/

# 提案 tournament losers → archive，保留 final-design（或一并归档）
# closed RFCs：改状态头再 mv
# root audits → docs/archive/2026-07/audits/
```

**不可首轮移动（代码/会话引用）：**

- `docs/decisions/coordinate-computer-use-plan.md` 及 approach-c / model-provenance 等  
- `docs/decisions/host-adapter-interface.md`, `targetid-format-synthesis.md`  
- `docs/decisions/v1.3/companion-native-hud-n1n10-lock-*.md`  
- `docs/decisions/v1.3/enterprise-session-trust-godmode-plan-*.md`  
- `docs/superpowers/specs/*` 与进行中 HUD plan  
- 最新仍开放的 audit handoff（可选保留至 P0 代码债关闭）

**每个 archive 子目录** 放一行 `README.md`：

> 本目录为历史过程记录，**非**产品规范。现行规范见 `docs/adr/` 与 `docs/README.md`。

---

### Phase 5 — 链接修复与校验（0.5–1 天）

1. 全局相对链接修复（README、CLAUDE、AGENTS、architecture 交叉引用）。  
2. 可选脚本：`scripts/check-doc-links.sh`（markdown 内链存在性）。  
3. 更新 `CLAUDE.md` / `AGENTS.md`「Related Docs」与新导航对齐（agent 入口与人类入口一致）。  
4. 抽测：从 README 每个链接点开一次。

---

### Phase 6 — 治理固化（0.5 天）

1. CONTRIBUTING / PR 模板增加 **Docs checklist**（§7）。  
2. 约定：  
   - 新用户可见能力 → README 矩阵 +1 行 + 用户指南或「见 ADR」。  
   - 架构决策 → ADR；过程对抗评审 → `docs/decisions` 或日后 `archive`，**禁止**当唯一规范。  
   - 功能 shipped → 更新 ADR 状态（Proposed → Accepted → Implemented）。  
3. （可选）季度 `docs:sweep`：扫描「待实施 / 尚未实现」与代码矛盾。

---

## 6. README 内容大纲（目标态）

```text
# CMspark Browser Agent
  一句话 + 版本徽章式说明（0.3.0）

## 项目简介
  拓扑 ASCII（可保留）
  ### 能力矩阵（分层表）     ← 核心
  ### 不在默认范围 / 实验     ← HUD 等

## 目录

## 安装
  环境（Node ≥20）、依赖、build、加载扩展、启动、LLM 配置

## 使用指南
  快速开始
  浏览器示例
  多线程
  Skills
  Knowledge                      ← 保留现有优质内容
  安全与确认（新，短）
  MCP / 任务包 / 导出导入 / 桌面 / 多 Agent（新，短+链接）

## 配置与数据目录
  ~/.cmspark-agent/ 更新树（packs、obsidian、logs/capability-audit 等）

## 后台服务 / 托盘 / 配对

## 开发
  make 命令、测试、打包

## 常见问题                      ← 纠错后

## 相关文档                      ← 完整表

## 技术栈 / 阶段说明
```

篇幅控制：README 目标 **≤ ~800–1000 行**；超过则把 Skills/Knowledge 深例迁到 `docs/user/`。

---

## 7. PR / 变更文档 Checklist（落地后强制）

合并功能 PR 前：

- [ ] 用户可见？→ README 能力矩阵或 FAQ 是否需要一行？  
- [ ] 有操作步骤？→ 用户指南或 TROUBLESHOOTING？  
- [ ] 架构边界变了？→ architecture / ADR？  
- [ ] 安全模型变了？→ ADR-006/007/010 或新 ADR？  
- [ ] 新增测试？→ TESTING.md 地图是否点名？  
- [ ] 关闭了 RFC/decision？→ 状态戳记 + 计划归档？  

---

## 8. 工作量与优先级排期

| Phase | 内容 | 估时 | 优先级 |
|-------|------|------|--------|
| 0 | 冻结、引用摸底、archive 政策 | 0.5d | P0 |
| 1 | 纠错（README/GOAL/ADR016/arch/TESTING） | 1d | **P0** |
| 2 | README 能力矩阵 + docs/README 导航 | 1d | **P0** |
| 3 | 三份用户指南 + arch/GOAL 补全 + ADR 草案 | 2–3d | P1 |
| 4 | 归档浪潮 | 1–2d | P1 |
| 5 | 链接校验 | 0.5–1d | P1 |
| 6 | 治理 checklist | 0.5d | P2 |

**关键路径：** Phase 1 → 2 即可把「文档可信度」从 D+ 拉到 B；3–4 达到全面覆盖与可维护。

---

## 9. 风险与缓解

| 风险 | 缓解 |
|------|------|
| 搬家断链 | 先导航后搬家；`git mv`；链接检查脚本 |
| 误归档代码仍引用的锁文件 | Phase 0 `rg` 白名单 |
| README 膨胀 | 短节 + 外链；深例下沉 |
| 与进行中 WIP（site-knowledge hostname 等）冲突 | reorg 分支避免改行为代码；可并行 |
| 历史审计被「删掉」的抵触 | archive 不 delete；README 说明考古路径 |

---

## 10. 建议执行方式

1. **本会话/下一会话：** 用户确认本计划后，开分支执行 Phase 1+2（高 ROI、低风险）。  
2. Phase 3 可 fanout 三路并行写用户指南（仍由人审）。  
3. Phase 4 归档单独 PR，便于 revert。  
4. 代码侧 P0 安全残余（god-mode step-up 等）**不在**本文档计划内，见 diagnosis § Prioritized Action Plan P1。

---

## 11. 附录：必须立刻消灭的错误句（检查表）

| 位置 | 错误 | 正确方向 |
|------|------|----------|
| README FAQ evaluate | 等待确认机制完成后开放 | 默认 L2 确认；见确认台指南 |
| README 阶段 | 仅安全稳定化 MVP | MVP + 已交付扩展 + opt-in |
| README 包版本 | v0.2.0 示例 | 0.3.0 |
| README macOS 托盘 | 仅 notifier+readline | Swift tray + 配对 |
| GOAL G8 | risk-engine + privilege-manager | 已删；现行确认/域门/ADR-010 |
| ADR-016 | 尚未实现产品代码 | board 已实现 P0 |
| architecture §4 | phantom 路径 | 对齐 `companion/src` / extension `src` |
| TESTING.md | 4 个文件 | ~125+ / 25 |
| Node | 18 vs 20 | 统一 ≥20（与 CI 一致） |

---

## 12. 附录：归档后主树应保留的「薄而全」清单

**用户（A）：**  
README · docs/README · mcp · mission-pack-usage · confirm-center · TROUBLESHOOTING ·（新）computer-use · host-and-apps · notebooklm  

**架构（A）：**  
architecture · GOAL · DESIGN · adr/* · supply-chain · licenses  

**工程（A）：**  
TESTING · CONTRIBUTING ·（可选）release 流程  

**工作（B）：**  
superpowers/specs · 被引用 decisions 锁 · 进行中 plans  

**其余 → archive。**

---

*本计划是文档治理的执行蓝图，不是又一次永不落地的 optimization-roadmap。Phase 1+2 完成后应立即合并，避免再积压。*

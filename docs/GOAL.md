# CMspark Browser Agent — 项目目标

> 版本: 1.7.9 | 日期: 2026-09-04 | 当前阶段：安全稳定化 MVP（核心已完成）→ **产品 0.5.9**。T1 bake-off **已记分**：CMspark 臂完成 / Playwright 干净 profile 打不开门户（L7 PASS 带 nit，[#228](https://github.com/nehcuh/cmspark/issues/228) 已关）。**禁扩**默认 outbound profile。冻 [#230](https://github.com/nehcuh/cmspark/issues/230)（F-S-10 / overlay-acl）；语音/会议 [#258](https://github.com/nehcuh/cmspark/issues/258)–[#260](https://github.com/nehcuh/cmspark/issues/260)。0.5.3 快照：[post-227-status](superpowers/specs/2026-08-27-post-227-status.md)（**SNAPSHOT**）。需求设计必须先开 GitHub Issue。

---

## 定位

一个对着 **已登录 Chrome** 真干活的本机 Agent。热键召唤开口；人在 Chrome 里用侧栏操作；人在 Codex 里**租同一只手**（Outbound MCP）；危险走确认台。Side Panel 是 Operate 面之一，**不是家**。家是 **已登录的 Chrome + 硬闸**。

形态 SoT：[2026-08-26-product-form-deepening-design.md](superpowers/specs/2026-08-26-product-form-deepening-design.md)。活切点：[CHANGELOG](../CHANGELOG.md) **0.5.9**。0.5.3 快照：[post-227-status](superpowers/specs/2026-08-27-post-227-status.md)（SNAPSHOT）。

通过 CDP/Chrome APIs 操作浏览器，通过本地 Companion 进程管理 LLM 调用、对话状态和技能系统。

**能力本体（2026-07-29）** — 规范见 **[ADR-020](adr/020-capability-model-three-axes.md)**：

| 轴 | 含义 | 默认/扩展 |
|----|------|-----------|
| **Surface** | L0 聊 → L1 网页 → L2 宿主 | 默认 L0/L1；L2 opt-in |
| **Composition** | Skill · Knowledge · MCP（client）· **Outbound MCP**（export，[ADR-022](adr/022-outbound-mcp-server.md)）· Pack · user-env | 场景叠加主路径（Pack-first）；**不是**「中层 Agent」 |
| **Autonomy** | 单线程 → multi-worker → Board | 编排增强 ≠ 更深作用面 |

一句话：默认浏览器内 Agent；场景靠 Pack 叠加；桌面/企业更深作用面需显式开启与更严门禁。

---

## 已交付功能扩展：Obsidian 对话导出（2026-06-30，PR #5）

在稳定化 MVP 之外交付的首个功能扩展：把对话导出成贴合用户 Obsidian vault 约定的 markdown 笔记。

- **P0 干净导出**：单条 📥（per-message）/ 整 thread 📥（header）→ companion 纯序列化（tool 噪音折叠/截断/合法 JSON）→ 浏览器 Blob 下载。UI 下载模式（不写宿主文件、无路径沙箱）。
- **P1 vault 档案**：扫描 vault，LLM 提取 frontmatter/命名/tag 约定（隐私：仅 basename + capped 预览），缓存后导出自动套用。
- **P2 智能整合**：footer `[[wikilinks]]`（纯 TF 余弦 top-K）+ vault 模板骨架（静态占位符替换，不执行 Templater JS）；realpath containment 防 symlink 逃逸。
- **P3 NotebookLM 摘要**：🧠 → LLM 结构化摘要（TL;DR/关键主题/结论/决策/待办）+ 折叠完整对话附录。
- 详见 [ADR-008](adr/008-obsidian-export.md) 与 [architecture.md §5](architecture.md#5-obsidian-对话导出)。

---

## 已交付功能扩展：Side Panel Mermaid 图表渲染（2026-07-01，PR #9）

稳定化之外的第二个功能扩展：把 LLM 产出的 ` ```mermaid ` 块在 Side Panel 渲染成可读 SVG 图（流程图/时序图/gantt/类图/ER/状态机…全类型）。

- **CSP-safe 客户端渲染**：spike 验证 mermaid 11.16 在 MV3 默认 strict CSP 下直跑（无 eval 类构造），无需 sandbox/offscreen/server。
- **安全（特权页面）**：`securityLevel:'strict'` + `htmlLabels:false`（纯 SVG）→ DOMPurify SVG profile 二次过；不可信 LLM 输出的 SVG 双层净化。
- **体验**：仅落定消息渲染（流式当代码块）+ 响应式缩放 + 点击新标签页开全尺寸（320px 窄面板可读性兜底）+ 懒加载双预取（面板秒开、首图不 stall）+ 坏语法回退。
- 详见 [ADR-009](adr/009-mermaid-rendering.md)。

---

## 已交付功能扩展：Mission Pack 任务包 + 企业能力模块（2026-07-26，PR #77）

在「浏览器 Agent」之上增加**可安装场景组合层**与**企业本地 opt-in 高危能力**（非 Chrome 商店默认能力）：

- **Mission Pack**：`pack.yaml` 组合 skills / knowledge / tool 白名单 / system_prompt_append → 一键应用到 Thread（非新 runtime）。
- **内置 AppSec Pack**：`appsec-prd-review`（威胁建模 + 页面安全 checklist）。
- **企业模块（默认关闭）**：`devsec-workspace`（本机目录 list/read）、`shell_exec`（单次受控命令）、`netsec_port_scan`（TCP 探测 + allowlist + 任务授权）。
- **双通道**：`capability_profile: community | enterprise`；shell/netsec 启用需 enterprise。
- **UI**：Side Panel 底栏「任务包」；工作区须原生「选择工作区」绑定。
- 使用说明：[mission-pack-usage.md](mission-pack-usage.md)；确认台 / L2：[confirm-center-user-guide.md](confirm-center-user-guide.md)；决策：[ADR-014](adr/014-mission-pack-enterprise-modules.md)。

---

## 已交付功能扩展：MCP 外接工具（0.3.0）

- Companion 作为 MCP 客户端：stdio / HTTP server，工具名 `mcp__<server>__<tool>`。
- Resources / Prompts 按 server 能力动态暴露；每线程 server 选择与信任级别（manual / first-use / trusted）。
- Side Panel **MCP 面板**与 `config.json` 的 `mcp` 段同步。
- 使用说明：[mcp.md](mcp.md)；架构：[architecture.md §8](architecture.md)。

---

## 已交付功能扩展：Computer Use / Host Use / Apps（0.3.0，opt-in）

- **Computer Use**（`host_computer`）：白名单应用窗口坐标键鼠；全局 `computer.coordinateEnabled` + 每应用 `coordinateAllowed` 双开关；**浏览器**不能持久该 bit，走一次性 L2（无人值守/三旗/G1 永不跳过）；任务级 L2 不受 god-mode / auto_approve 跳过；session-trust 可抑 mid-task re-L2，且（显式 opt-in + corpus/预算/actions）可跳过同线程同 **非浏览器** App 后续任务 initial L2；danger/experimental/foreground_yielded 始终 prompt；Cockpit 急停。
- **Host Use**（`host_read` / `host_write`）：Mail/Outlook 等读、Notes/受限 move 等写；写操作生物识别/nonce；opaque TargetId。
- **Apps**（`host_app`）：用户白名单应用无参 launch；per-app policy（auto/ai/manual）。
- 平台：macOS / Windows 主路径；Linux 部分 pending。
- 用户指南：[computer-use-user-guide.md](computer-use-user-guide.md) · [host-and-apps.md](host-and-apps.md)；决策：[ADR-017](adr/017-computer-use.md) · [ADR-018](adr/018-host-use.md)。

---

## 已交付功能扩展：Multi-Agent 编排 + Mission Board（P0，0.3.0）

- **Orchestrator / Worker**：子线程模型；`spawn_worker` 仅 L2；tab 排他 lease；默认 max 5 workers；Worker 硬禁 host/shell/netsec。
- **Mission Board**：Fact / Intent / Hint 结构化板；`board_read` / `board_complete`；Side Panel `BoardPanel` + FleetStrip。
- 用户指南：[multi-agent-user-guide.md](multi-agent-user-guide.md)；任务包交叉：[mission-pack-usage §10](mission-pack-usage.md#10-multi-agent编排-worker与任务包)；决策：[ADR-015](adr/015-multi-agent-orchestrator-tab-lock.md) · [ADR-016](adr/016-mission-board.md)。

---

## 已交付功能扩展：NotebookLM 导入（ADR-011–013）

- Side Panel：**NotebookLM 导入器**（URLs / 页面链接 / RSS / YouTube / Thread）+ **离线导出当前页 Markdown**。
- 在线路径以扩展 DOM 自动化为主（需已登录 NotebookLM）；结果落入用户 Google NotebookLM notebook。
- 用户指南：[notebooklm-user-guide.md](notebooklm-user-guide.md)；决策：[ADR-011](adr/011-notebooklm-import.md) · [012](adr/012-notebooklm-importer-online.md) · [013](adr/013-notebooklm-importer-v12.md)。

---

## 当前真实目标：安全稳定化 MVP

当前阶段的目标不是一次性完成完整企业级自动化平台，而是先把可验证、可恢复、可安全中断的浏览器 Agent MVP 做稳定：Side Panel 能可靠驱动 Companion 和浏览器，线程状态能闭环持久化，工具调用结果能进入后续 LLM 上下文，高风险浏览器/系统执行在确认机制完成前默认阻断，并建立最小回归测试来保护这些核心路径。

本阶段完成后，CMspark 应该能安全地执行受控网页读取、标签页管理、常见页面交互、Type A Prompt Skill 和基本操作历史记录；复杂 SSO 自动发现、录制回放、Type B/C Skills、Daemon 化和跨系统长期任务编排属于稳定化后的扩展目标。

---

## 稳定化 MVP 目标

### G1. 浏览器操控能力

Agent 可以在用户授权下对任意标签页执行全部 26 种工具操作（22 种浏览器工具 + 4 种 Companion 工具）：

| 类别 | 工具 |
|------|------|
| 标签页管理 | `list_tabs`, `create_tab`, `close_tab`, `navigate`, `screenshot` |
| 页面读取 | `get_page_text`, `get_page_html`, `get_element_info` |
| 页面交互 | `click`, `dblclick`, `type`, `fill_form`, `scroll`, `press_key`, `hover`, `select_option`, `drag_and_drop` |
| 高级操作 | `wait_for`, `evaluate` |
| Cookie 管理 | `get_cookies`, `set_cookie`, `delete_cookie`, `list_all_cookies` |
| Companion 工具 | `use_skill`, `osascript_eval`, `record_experience` |

### G2. 受控认证上下文使用

当前阶段只要求在显式信任域配置下读取和操作 cookie，并对域外或全量 cookie 操作进行阻断/确认。自动发现企业 SSO 映射、跨系统免登录编排属于扩展目标。

### G3. LLM 灵活配置

- 支持 base_url, api_key, model_name, temperature, context_window
- 全局默认配置 + 每个线程可独立覆盖
- 默认 DeepSeek v4-flash，通过 `DEEPSEEK_API_KEY` 环境变量零配置启用
- Side Panel 滑出设置面板 + CLI 配置文件双入口

### G4. 多线程对话隔离

- 多条对话线程并行存在
- 消息历史独立隔离
- LLM 配置独立覆盖（Thread A 用 deepseek，Thread B 用 gpt-4o）
- 可选工具权限覆盖
- Thread ID: 6 位 short-id + 用户别名

### G5. Type A Skills（Prompt 模板）

- Markdown + YAML frontmatter 格式
- 激活后注入 system prompt 指导 Agent 行为
- 内置精选 skills: `writing-skills`（技能创建方法论）、`grill-me`（设计审查）、`browse`（浏览器操作指南）
- `browse` skill 每个新线程默认激活

### G6. Skill 导入导出

- 单个 skill 导出为 `.md` 文件
- 拖拽 `.md` 文件导入
- 从 URL 安装 skill
- 团队间通过 Git/文件分享复用

### G7. 操作历史与线程上下文可追溯

- Tool-call 级别记录（工具名、参数、结果、耗时、时间戳）
- Companion SQLite 存储（`~/.cmspark-agent/history.db`）
- 工具调用结果同步进入线程消息历史，后续 LLM turn 可以引用真实 tool result
- 按线程分组展示，时间线倒序
- 全文搜索（按工具名、关键词）
- JSON 导出
- 可配置保留天数（默认 30 天）

### G8. 安全护栏

当前生效的是**多门独立门禁**（非已删除的 risk-engine / privilege-manager 三层设计，见 [ADR-006](adr/006-layered-defense.md) 演进说明）：

- **Cookie 信任域**（`trusted_domains`）：通配符匹配（`*.company.com`）；`get_cookies` / `set_cookie` / `delete_cookie` / `list_all_cookies` 域外阻断
- **L2 确认队列**（`SecurityConfirmationManager`，约 45s 超时）：`evaluate` / `osascript_eval` 等**默认阻断**，经 Side Panel / Confirm Center（Cockpit）人机确认后，由 companion `security-policy` 颁发 HMAC `security_token`（constant-time 校验）才执行；`checkHighRiskExecution` 正则仅作风险预览升级，不单独 gate
- **导航 URL 门**：非 `http(s)` scheme 直接阻断（仅 `allow_all_schemes` 可绕过 L1，含 `javascript:` 且不再问）；确认 skip = `auto_approved_domains` ∪ `auto_approve_dangerous` ∪ `allow_all_schemes`。`trusted_domains` = cookie-only，**不**跳过 URL 确认
- **域白名单 + 全局自动批准**（[ADR-007](adr/007-domain-whitelist-auto-approve.md)）：`auto_approved_domains`（独立于信任域）跳过工具确认；`security.auto_approve_dangerous` 全局 kill-switch（默认 false，无人值守用）。`osascript_eval` **不走**域白名单，仅全局开关可放行
- **分级特权 / God Mode**（[ADR-010](adr/010-tiered-privilege-godmode.md)）：会话级信任与能力分层，与 L2 / 企业模块协同，**不是**旧 privilege-manager 三级枚举
- **Extension 侧**：`page-sanitizer` 在内容进入 LLM context 前做 prompt-injection 过滤
- **错误分级**：可恢复（自动重试上限 3 次）→ 不可恢复（暂停提示用户）→ 安全（硬阻断）
- **用户中断**：Stop 按钮随时终止 Agent 执行
- **越狱检测**：LLM streaming 输出实时检测越狱模式
- **安全内置技能**：prompt-injection-defense, jailbreak-detection, instruction-hierarchy

### G9. Side Panel 原生体验

```
┌──────────────────────┐
│ ☰ Threads    [+新建]  │  顶部栏
│ [线程列表（可折叠）]   │
├──────────────────────┤
│ 消息列表（可滚动）     │  聊天区
│ - 用户消息            │  - Streaming token 渲染
│ - Agent 回复          │  - Tool call 卡片（状态+结果）
│ - 错误提示            │
├──────────────────────┤
│ 📎 [Tabs][Hist][Skills]│  底部上下文栏
├──────────────────────┤
│ [输入框]          [▶] │  输入区
└──────────────────────┘
```

- 持久化 Side Panel，320px 宽度可用
- 连接状态实时指示（绿/黄/红圆点 + Badge）
- Companion 断连时全屏友好提示 + 复制启动命令按钮

---

## 稳定化完成标准

- `npm --prefix companion test` 覆盖核心安全/线程/工具结果回归路径。
- `npm --prefix companion run build` 与 `npm --prefix chrome-extension run build` 均可通过。
- Pin Tab 等线程状态从 Side Panel 更新后能同步保存到 Companion thread metadata。
- Assistant tool call 与 tool result 均能被持久化，并能作为后续上下文恢复。
- `evaluate` / `osascript_eval` 高风险输入不会在用户确认机制缺失时被执行。

---

## 稳定化后的扩展目标

> 轴标注（ADR-020）：**S**=Surface · **C**=Composition · **A**=Autonomy。已实现项保留 ✅，便于对照 deferred。

### G10. 统一认证 SSO 自动复用 — *deferred* · **S:L1 + C**

企业内多个系统使用同一认证平台时，Agent 能自动发现已有 session，跨系统免登录操作。Agent 自动检测信任域内 cookie 并匹配 SSO 映射。

### G11. Type B Skills（工具链/流程） — *deferred* · **C + A**

参数化的操作序列，按步执行，条件分支，错误处理。用户可录制操作自动生成 skill，复用时填写参数即可重放。

### G12. Type C Skills（子 Agent） — *deferred* · **C（≠ 已交付 worker 编排）**

独立上下文的子 Agent skill 形态，并发上限 3，超时 120s。默认继承父线程权限可降级。结果摘要返回主 Agent。  
**注意**：Multi-Agent Orchestrator / `spawn_worker`（ADR-015）**已交付**，但是 **Autonomy 平面**的线程编排，**不等于**本条「Type C Skill」产品形状；二者勿混为一谈。

### G13. "保存对话为 Skill" ✅ 已实现 · **C**

从对话历史中提取可复用操作序列 → LLM 辅助参数化 → 生成 skill 文件 → 用户确认/调整 → 测试运行 → 保存。由 `writing-skills` 内置 skill 提供方法论支持。已实现为 `skill-craft.ts` + `SkillCraftPanel.tsx`。

### G14. 操作历史重放 — *deferred* · **A**

从历史记录中选择操作点，从该点重新执行。

### G15. Daemon 模式 ✅ 已实现

- `cmspark-agent daemon start/stop/status` 后台运行
- launchd (macOS) / systemd (Linux) 开机自启模板
- PID 锁文件管理

### G16. System Tray / Menu Bar ✅ 已实现

- macOS: Swift NSStatusBar 原生托盘
- Linux/Windows: systray2 跨平台桥接
- 降级方案: readline CLI 模式
- 托盘显示连接状态、快捷操作菜单

### G17. Knowledge 知识库系统 ✅ 已实现

- 三级知识体系: global (全局) → site (站点) → skill (技能)
- 知识 auto = **站点匹配**（`site-matcher.ts`）；相关/Obsidian 链接 = **纯 TF**（`tokensToVec`，不加 IDF）
- 技能 `matchSkills` = **TF-IDF**（`idfFromDocs` + `tfidfVec`，语料为技能 name/description/tags）+ 低分时 LLM 精排
- `record_experience` 工具记录操作经验到知识库
- Extension 端 `KnowledgeSubPanel` 知识选择 UI

### G18. 对话高级操作 ✅ 已实现

- `chat.regenerate`: 从指定消息重新生成
- `thread.fork`: 从指定消息分支新线程
- `thread.update`: 线程元数据更新 (pinned_tabs, alias)
- `autoAliasThread()`: LLM 自动生成线程短标题

### G19. Mission Pack / 企业场景能力 ✅ 已实现（PR #77）

- Pack 平台：install / apply / uninstall + snapshot 回滚 + capability 审计日志
- 企业模块 opt-in：workspace / shell_exec / netsec（community 默认不开放 shell/netsec）
- 明确 **非目标**（本阶段）：交互式 PTY、捆绑 nmap、CWS 默认扫描能力

### G20. MCP / Computer·Host Use / Multi-Agent·Board / NotebookLM ✅ 已实现（0.3.0）

- 见上文对应「已交付功能扩展」节；用户文档已入 `docs/*-user-guide.md` 与 `docs/README.md` 导航。

### G21. Outbound MCP Server（编程 Agent 对接）— *Phase 0+ opt-in shipped* · **C 导出 L1**

- **决策 SoT**：[ADR-022](adr/022-outbound-mcp-server.md)（Accepted；**非** default-on 产品 ship）。
- 目标：把 **curated L1** 浏览器面（`cmspark__*`）以 stdio MCP 导出给 Claude Code / Cursor 等；默认禁 L2 / cookies / shell；Skill 仅 adoption。
- 成功门：Phase 0 bake-off 证明已登录/SSO 会话相对 Playwright 不可替代（T1），否则 pivot 只读或垂直 API。
- **2026-08-09**：loopback HTTP 桥 + disclosure + L1 profile + **`require_grant` default true**（MCPO-01）已落地；grant 签发见 `outbound-mcp/`。仍 **opt-in**。L8 托盘确认 / 更广 profile 按 ADR 分阶段。

### G22. 听写+（Dictation+）与 会议记录 ✅ 已实现（**0.5.0** · 2026-08）· **S:L0 + C(Pack)**

**Trust / 协议 SoT**：[ADR-024](adr/024-dictation-plus-asr-refiner-meeting.md) · [ADR-023 本机 STT](adr/023-voice-local-stt-path-b.md) · 用户指南：[meeting-and-dictation-user-guide.md](meeting-and-dictation-user-guide.md)

| 线 | 波次 | 内容 |
|----|------|------|
| 听写+ | D1a–c | classic 默认；continuous；ASR Refiner（correct_only）；本机分段 |
| 听写+ | **D2** | 按住热键 hold（默认关；**按键盘录制**组合键；禁 bare fn/Win+V） |
| 听写+ | **M2** | 本机 **渐进假设流**：PCM 流式 + `partial_request` 重解码；约 8s 窗定稿（非 decoder-token） |
| 会议 | Mtg0–3 | Pack「会议记录」；**装配 › 场景 › 会议** 工作台；粘贴/本机录/上传；实验发言人N |
| UX | 设置 | 「实时出字」；文字/语音改设置命令条 |

**明确非目标（本阶段）**：系统级注入任意 App；边听边 LLM 改稿（D3 CANCELLED）；系统混音产品化；身份级 diarize；Whisper decoder-token 真流式。

---

## 架构约束

| 约束 | 说明 |
|------|------|
| **A1. 双层拓扑** | Extension (Plasmo + React) ↔ WebSocket ↔ Companion (Node.js + TypeScript) |
| **A2. 职责分离** | Extension 只做浏览器操作，LLM 推理和状态管理在 Companion |
| **A3. Manifest V3** | Service Worker 后台，Alarm keep-alive，全部权限预声明 |
| **A4. CLI 部署** | `cmspark-agent start/stop/status`，固定端口 23401 |
| **A5. 数据目录** | `~/.cmspark-agent/`（config.json, skills/, packs/, threads/, history.db, logs/, cache/, knowledge/） |
| **A6. 通信协议** | WebSocket + OpenAI-compatible streaming，异步 tool 回路（Promise bridge） |

---

## 技术栈

| 层 | 技术 |
|----|------|
| Extension 构建 | Plasmo + React + TypeScript |
| Extension 通信 | chrome.runtime.sendMessage + chrome.runtime.onMessage |
| Companion CLI | Node.js + TypeScript |
| WebSocket | `ws` 库 |
| LLM 适配 | OpenAI SDK（兼容自定义 base_url） |
| 数据库 | sql.js — WASM SQLite（操作历史） |
| Skill 格式 | Markdown + YAML frontmatter |
| 配置存储 | chrome.storage.local (extension) + JSON 文件 (companion) |

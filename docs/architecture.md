# CMspark Browser Agent — 架构文档

> 版本: 2.4.0 | 日期: 2026-08-08 | 状态: 已确认（同步 **0.5.0** + **[ADR-020](adr/020-capability-model-three-axes.md) 能力三轴** · ADR-023/024 语音）

---

## 0. 能力模型（三轴 · 规范摘要）

> 完整决策与声明清单：[ADR-020](adr/020-capability-model-three-axes.md)。本节只摘要，避免与 ADR 分叉时以 ADR 为准。

CMspark **不是**多套 Agent runtime，而是 **一个** Companion tool-loop，能力落在三根正交轴上：

| 轴 | 名称 | 内容 |
|----|------|------|
| **A Surface** | 作用面 | **L0 聊**（无 CDP tool）→ **L1 网页**（CDP/tabs/cookies）→ **L2 宿主**（CU / Host / Apps / 企业 shell·netsec，opt-in） |
| **B Composition** | 组合面 | Skill · Knowledge · MCP（client）· Outbound MCP（export，[ADR-022](adr/022-outbound-mcp-server.md)）· **ACP 编程接力 Client**（[ADR-025](adr/025-acp-coding-agent-client.md)，默认关）· Pack · user-env · modules — **装配**，不是「中层 Agent」 |
| **C Autonomy** | 自主度 | 单线程 → multi-worker + tab lease → Mission Board（Board **只**归本轴） |

**横切标签**：Trust（随 Surface 单调变严；session-trust 见 ADR-017）· Channel（`community` | `enterprise`）。

**产品标签别名**：L0/L1/L2 ≡ UI `CapabilityLevel`：`chat` | `browser` | `computer`。

**叠加纪律**：新场景优先 **Pack**（+ skill/MCP）；**内置/installed Pack 禁止**写全局 auto_approve/god-mode；**例外**：`origin=user` 用户场景的 `trust` 块仅在 Side Panel `user_gesture` + `allowTrust` 下写入，且须可恢复（见 §7.5 / [ADR-020](adr/020-capability-model-three-axes.md)）；禁止无 Pack 替代就加一级 Side Panel 入口。

```text
  Composition: Skill · Knowledge · MCP · Outbound MCP · ACP Client · Pack · user-env
        │
   L0 ──▶ L1 ──▶ L2 (opt-in)
        │
  Autonomy: loop → workers → board
```

用户故事线「主体 → 浅层 → 中层(组合) → 深层」与上表映射见 ADR-020 §2。高级场景（黑盒 Pack、投研 Skill/MCP）多为 **组合复用**，不必默认 L2。

---

## 1. 技术架构

### 1.1 系统拓扑

三面协作：**浏览器面**（CDP）· **Companion 核心**（LLM / 安全 / 编排）· **桌面宿主面**（Host / Computer / Apps，opt-in）。

```
┌──────────────────────────────────────────┐
│               Chrome 浏览器               │
│  ┌─────────────────────────────────────┐ │
│  │        CMspark Browser Agent        │ │
│  │  ┌───────────┐  ┌────────────────┐  │ │
│  │  │ Side Panel │  │ Service Worker │  │ │
│  │  │ + Cockpit  │  │ - WS / CDP     │  │ │
│  │  │ + Board/   │  │ - NotebookLM   │  │ │
│  │  │   Packs/   │  │ - Keep-alive   │  │ │
│  │  │   Apps/MCP │  │                │  │ │
│  │  └──────┬─────┘  └───────┬────────┘  │ │
│  │         └────────┬───────┘            │ │
│  └──────────────────┼────────────────────┘ │
│                     │ WebSocket            │
│                     │ ws://127.0.0.1:23401 │
└─────────────────────┼──────────────────────┘
                      │
         ┌────────────▼──────────────────────────────┐
         │     cmspark-agent (Companion, Node.js)    │
         │  Thread · Skill · LLM · Security(L2)      │
         │  MCP · Packs · Orchestrator · Board       │
         │  computer/ · host-use/ · apps/ · netsec/  │
         │  tray/daemon · ~/.cmspark-agent/          │
         └─────┬───────────────────┬─────────────────┘
               │                   │
               ▼                   ▼
        MCP servers          桌面宿主面（opt-in）
        (stdio/HTTP)         host_read/write/app
                             host_computer · OS adapters
```

### 1.2 技术栈

| 层 | 技术 | 说明 |
|----|------|------|
| Extension 构建 | Plasmo | 专门的 Chrome extension 框架 |
| Side Panel UI | React | streaming 渲染、状态管理 |
| Service Worker | TypeScript | 编译为 JS，运行在 MV3 |
| Companion | Node.js + TypeScript | 本地常驻进程 |
| WebSocket 库 | `ws` (Node.js) | 双向通信 |
| LLM 适配 | OpenAI SDK 兼容 | base_url 可配置，支持任意兼容服务 |
| 数据库 | sql.js (WASM SQLite) | 纯 JS SQLite，无需 native 编译，操作历史存储 |
| 文件格式 | Markdown + YAML frontmatter | skills 文件格式 |
| 配置存储 | chrome.storage.local + JSON 文件 | extension侧/companion侧分别持久化 |

### 1.3 通信协议

基于 WebSocket 的 OpenAI-compatible streaming 协议：

```
消息类型:
├── chat.create          → 创建新消息（streaming response）
├── chat.abort           ← 中断当前 streaming
├── chat.regenerate      → 从指定消息重新生成
├── tool.result          ← tool 执行结果（extension → companion）
├── tool.execute         → tool 执行指令（companion → extension）
├── config.get/set/test  → LLM 配置读写/测试连接
├── skill.list/activate/deactivate → skill 加载与激活
├── skill.import/export/delete     → skill 导入导出管理
├── skill.craft          → 从对话历史自动提取 skill
├── thread.list/create/delete      → 线程管理
├── thread.select/fork             → 线程切换与分支
├── thread.update                  → 线程元数据更新（pinned_tabs, alias 等）
├── history.query/export  → 操作历史查询与导出
├── security.confirmation.request  ← 高危操作确认请求（companion → extension，含 relevant_domains）
├── security.confirmation.response → 确认响应 + 可选 add_to_whitelist（仅允许 relevant_domains 的精确或 *.domain）
└── system.ping/pong     → 心跳保活
```

**Streaming 流程:**
```
User Input → companion → LLM streaming
  ├── token → extension UI (实时渲染)
  ├── tool_call → extension (执行 browser 操作)
  │     └── tool_result → companion → 追加到 context → 继续 LLM
  └── done → extension UI (标记消息完成)
```

### 1.4 数据流

```
用户输入
  │
  ▼
Side Panel (React) ──WS──▶ Companion (Core Engine)
                              │
                              ├─ Thread Manager: 加载消息历史，构建 LLM context
                              ├─ Skill Engine: 双轨技能匹配（TF-IDF 快路径 + LLM 语义精排）→ inject 相关 skill prompt
                              ├─ LLM Adapter: 构建请求，发送到 LLM API
                              │
                              ▼  LLM Response (streaming)
                              │
                              ├─ token → WS → Side Panel UI 渲染
                              ├─ tool_call → Tool Dispatcher
                              │     │
                              │     ▼ WS → Extension Service Worker
                              │     │      ├─ CDP (click, type, screenshot)
                              │     │      ├─ chrome.tabs (create, navigate)
                              │     │      ├─ chrome.cookies (get, set)
                              │     │      └─ chrome.scripting (evaluate)
                              │     │
                              │     ▼ tool_result → WS → Companion
                              │     │      └─ History Store (SQLite 记录)
                              │     │
                              │     ▼ 追加到 LLM context → 继续生成
                              │
                              └─ done → History Store 批量写入 → UI 完成
```

### 1.5 安全架构

CMspark 的安全模型是**单层、默认拒绝、human-in-the-loop** 的——2026-06-16 审计后删除了原设计的 risk-engine / privilege-manager / page-scanner 三层（dead code，见 [ADR-006](adr/006-layered-defense.md)），改为以下 5 个互相独立的门：

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Tool Executor (companion/src/server.ts)          │
└─────────────────────────────────────────────────────────────────────┘
   │
   ├─① Cookie 信任域门 ──────────────────────────────────────────────┐
   │   get_cookies / set_cookie / delete_cookie / list_all_cookies    │
   │   必须满足 isTrustedDomain(domain) — 读 config.trusted_domains   │
   │                                                                  │
   ├─② evaluate / osascript_eval 默认阻断门 ─────────────────────────┤
   │   所有调用强制走 SecurityConfirmationManager（45s 超时）         │
   │   - checkHighRiskExecution ~57 正则 → 风险预览升级提示（不 gate）│
   │   - security-policy.issueToken → HMAC + constant-time 校验       │
   │   - osascript_eval 因属宿主执行（任意 shell）                    │
   │     【不走域白名单】，只能由全局开关放行                          │
   │                                                                  │
   ├─③ navigate / create_tab / set_tab_url URL 门 ───────────────────┤
   │   非 http(s) scheme 直接阻断                                     │
   │   hostname 不在 trusted_domains ∪ auto_approved_domains → 确认   │
   │                                                                  │
   ├─④ 域白名单 + 全局自动批准 ──────────────────────────────────────┤
   │   auto_approved_domains: string[]  独立字段（≠ trusted_domains） │
   │     支持 * / 精确 / *.suffix 通配符（matchDomain 共享实现）      │
   │   security.auto_approve_dangerous: boolean  默认 false           │
   │     全局 kill-switch，绕过所有确认（仅供无人值守工作流）         │
   │                                                                  │
   └─⑤ 弹窗「添加到白名单」回路 ─────────────────────────────────────┘
       confirmation 携带 relevant_domains → 弹窗显示「精确 / *.domain」单选
       响应里的 add_to_whitelist 必须等于 relevant_domains[0] 或 *.prefix
       （服务端强制校验，防 WS 注入），且仅在 respondFrom 成功后持久化
```

**关键不变量**（implementation invariants，详见 [ADR-007](adr/007-domain-whitelist-auto-approve.md)）：

- `tabUrlCache` 在 `list_tabs` / `navigate` / `set_tab_url` / `create_tab` 后同步刷新——避免跨域自动批准
- `respondFrom` 必须先于 `saveConfig` 完成，且白名单持久化以 `responded === true` 为前提——防非权威响应污染
- `tabId` 在 tool executor 入口规范化为 number——防字符串 tabId 让 cache 更新静默跳过

**Extension 侧补充**：`page-sanitizer` 在内容进入 LLM context 前做 ~11 模式 prompt-injection 过滤。**HMAC `security_token` 颁发与校验在 Companion**（`security-policy.ts` + `SecurityConfirmationManager`），扩展只转发确认请求/响应，不本地发 token。

**残留风险**（已记录，待后续迭代）：

- Page-initiated 导航（`window.location`）需要 extension 端订阅 `chrome.tabs.onUpdated` 才能感知
- 多 label TLD 通配符（`*.co.uk`）启发式漏检，需完整 PSL 才能闭环

**关联 ADR**：[ADR-005](adr/005-cookie-trust-domain-security.md)（cookie 信任域）、[ADR-006](adr/006-layered-defense.md)（原设计 → 删除路径）、[ADR-007](adr/007-domain-whitelist-auto-approve.md)（域白名单 + 自动批准）。

---

## 2. 业务架构

### 2.1 核心业务域

```
┌─────────────────────────────────────────────────────┐
│              CMspark Browser Agent                   │
│                                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────┐│
│  │  对话管理     │  │  技能系统    │  │  浏览器控制 ││
│  │              │  │              │  │             ││
│  │ - 多线程隔离  │  │ - Prompt模板 │  │ - 标签页操作││
│  │ - 消息历史    │  │ - 工具链流程 │  │ - CDP 控制  ││
│  │ - Context窗口│  │ - 子 Agent   │  │ - Cookie管理││
│  │ - Tab定位    │  │ - 导入/导出  │  │ - JS 执行   ││
│  └──────┬───────┘  └──────┬───────┘  └──────┬──────┘│
│         │                 │                  │       │
│         └─────────┬───────┴──────────────────┘       │
│                   ▼                                   │
│  ┌──────────────────────────────────────────────┐    │
│  │            操作历史与审计                     │    │
│  │  - 全量 tool-call 记录   - 按线程分组        │    │
│  │  - 搜索/导出            - 可配置保留策略      │    │
│  └──────────────────────────────────────────────┘    │
│                                                      │
│  ┌──────────────────────────────────────────────┐    │
│  │            LLM 配置管理                       │    │
│  │  - base_url, api_key, model_name             │    │
│  │  - temperature, context_window               │    │
│  │  - 全局默认 + 线程级覆盖                      │    │
│  └──────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────┘
```

### 2.2 用户角色

| 角色 | 描述 | 核心场景 |
|------|------|---------|
| 单用户 | extension 的主要使用者 | 日常浏览器操作自动化 |
| 技能创建者 | 创建和分享 skills 的用户 | 录制操作流程 → 参数化 → 导出分享 |
| 技能使用者 | 导入他人 skills 的用户 | 导入 → 加载到线程 → 执行 |

### 2.3 核心业务流程

**流程 1: Agent 对话驱动任务**
```
1. 用户在 Side Panel 创建/选择 Thread
2. 用户在 Tabs 栏勾选 1-N 个标签页固定到线程
3. 用户输入自然语言任务
4. Agent 读取页面内容 → 分析 → 执行 tool calls
5. 每个 tool call 结果在聊天中展示、操作历史记录
6. 用户可随时中断、纠正、继续
```

**流程 2: SSO 统一认证自动复用**
```
1. 用户配置信任域列表 (*.company.com)
2. 用户在系统A扫码登录 → cookie 产生
3. 用户要求 agent 操作系统B（同一 SSO 平台）
4. Agent 自动检测 cookie、匹配已有 session
5. 系统B 免登录 → agent 执行业务操作
```

**流程 3: Skill 生命周期**
```
创建:
  用户对话 → agent 执行成功 → 用户 "保存为 skill"
  → agent (含 writing-skills) 分析操作序列
  → 识别参数、生成 markdown + frontmatter
  → 保存到 ~/.cmspark-agent/skills/

使用:
  用户在线程中输入 /<skill-name>
  → companion 加载 skill → 注入 system prompt
  → agent 按 skill 指导执行

分享:
  Side Panel Skills 面板 → 导出 .md 文件
  → Git/Gist/文件分享 → 同事导入 → 立即可用
```

---

## 3. 业务示例

### 示例 1: 跨系统数据提取

**场景**: 用户需要从 HR 系统提取员工列表，然后到财务系统比对报销数据。

```
用户: "@hr-tab 提取本月新入职员工名单，然后到 @finance-tab 查他们的报销记录"

Agent 执行:
  Thread "HR-财务交叉比对"
  │
  ├─ [14:32] Tab: hr.company.com
  │    ├─ get_page_text → 检测到登录页
  │    ├─ get_cookies → 发现已有 SSO session（2小时前在系统A登录）
  │    ├─ navigate(hr.company.com/dashboard) → 免登录进入
  │    ├─ click("员工管理") → navigate → get_page_text
  │    └─ evaluate("提取表格数据") → [{name, dept, joinDate}, ...]
  │
  ├─ [14:35] Tab: finance.company.com
  │    ├─ navigate → 同样免登录（共享 SSO cookie .company.com）
  │    ├─ type("#search", name) → click("搜索") × N
  │    └─ evaluate("提取报销汇总") → [{name, total, status}, ...]
  │
  └─ [14:40] 结果汇总:
        "新入职 12 人，其中 3 人有待审批报销。建议优先处理..."
```

### 示例 2: Skill 创建与复用

**场景**: 用户每周需要从同一报表系统导出数据。

```
Step 1 — 首次手动操作:
  用户: "打开报表系统，导出上周的销售数据"
  Agent 执行: navigate → 登录 → 点击"销售报表" → 选择日期 → 导出 CSV
  
Step 2 — 保存为 Skill:
  用户: "把刚才的操作保存为 skill"
  Agent (含 writing-skills): 
    → 分析操作序列
    → 识别参数: {system_url}, {report_type}, {date_range}
    → 生成 export-report.md:
        ---
        name: export-report
        type: tool_chain
        description: Use when exporting periodic reports from internal systems
        parameters:
          system_url: { type: string, required: true }
          report_type: { type: string, default: "销售报表" }
          date_range: { type: string, default: "上周" }
        ---
        # 导出报表
        1. 导航到 {{system_url}}
        2. 如果未登录，使用 SSO 自动登录
        3. 点击 "{{report_type}}"
        4. 选择日期范围: {{date_range}}
        5. 点击导出 → 下载 CSV
    → 保存到 ~/.cmspark-agent/skills/export-report.md

Step 3 — 复用:
  下周，用户: "/export-report system_url=https://bi.company.com report_type=库存报表"
  Agent 加载 skill → 按步骤执行 → 自动导出库存报表
```

### 示例 3: 多线程并行工作

```
Side Panel
├── Thread "HR数据提取"     [gpt-4o, trusted: *.hr.company.com]
│    固定: tab-142 (HR系统)
│    "提取本月考勤异常记录..."
│
├── Thread "竞品分析"       [deepseek, trusted: *.competitor.com]
│    固定: tab-143, tab-144, tab-145 (三个竞品页面)
│    "对比三个产品的定价策略，生成表格..."
│
└── Thread "通用助手"       [默认 model]
     未固定标签页 (fallback 到 active tab)
     "总结当前页面的要点..."
```

---

## 4. 目录结构

### 4.1 项目仓库

```
cmspark/
├── chrome-extension/                # Extension (Plasmo + React)
│   ├── plasmo.config.ts
│   ├── src/
│   │   ├── sidepanel/               # Side Panel 页面
│   │   │   ├── index.tsx            # 主入口
│   │   │   ├── App.tsx              # 根组件
│   │   │   ├── components/
│   │   │   │   ├── ChatView.tsx     # 聊天视图（含输入区）
│   │   │   │   ├── ThreadList.tsx   # 线程列表
│   │   │   │   ├── BottomBar.tsx    # 底部上下文栏
│   │   │   │   ├── SafetyStrip.tsx  # 安全/确认条
│   │   │   │   ├── MinimalConfirm.tsx
│   │   │   │   ├── ContextStrip.tsx
│   │   │   │   ├── FleetStrip.tsx   # 多 Agent 舰队条
│   │   │   │   ├── BoardPanel.tsx   # Mission Board（ADR-016）
│   │   │   │   ├── PacksPanel.tsx   # Mission Pack
│   │   │   │   ├── McpPanel.tsx / McpServerForm.tsx
│   │   │   │   ├── AppsPanel.tsx
│   │   │   │   ├── KnowledgeSubPanel.tsx
│   │   │   │   ├── SkillCraftPanel.tsx
│   │   │   │   ├── NotebooklmImporterPanel.tsx
│   │   │   │   ├── SlashCommandPopover.tsx
│   │   │   │   ├── SettingsSlideout.tsx
│   │   │   │   └── mermaid.ts       # Mermaid 渲染（ADR-009）
│   │   │   ├── hooks/
│   │   │   │   └── useWebSocket.ts  # WS 连接管理
│   │   │   ├── store/
│   │   │   │   └── agentStore.tsx   # 全局状态 (useReducer + Context)
│   │   │   ├── mode/
│   │   │   │   └── mode-controller.ts
│   │   │   └── types.ts
│   │   ├── background/
│   │   │   ├── index.ts             # Service Worker 入口
│   │   │   ├── ws-client.ts         # WebSocket 客户端（含 auth HMAC）
│   │   │   ├── browser-bridge.ts    # CDP/tabs/cookies 操作
│   │   │   ├── page-sanitizer.ts    # 页面内容清洗（prompt-injection）
│   │   │   ├── security-confirmation-payload.ts
│   │   │   ├── cockpit-window.ts    # Confirm Center / Cockpit 窗口
│   │   │   ├── notebooklm-handler.ts / notebooklm-import-orchestrator.ts
│   │   │   ├── keep-alive.ts
│   │   │   └── …
│   │   ├── cockpit/
│   │   │   └── CockpitApp.tsx       # 确认台 UI
│   │   ├── notebooklm/              # NotebookLM 导入（ADR-011–013）
│   │   ├── tabs/
│   │   │   └── cockpit.tsx
│   │   ├── popup/
│   │   │   └── index.tsx
│   │   └── utils/
│   │       ├── config.ts
│   │       └── permissions.ts
│   └── assets/
│
├── companion/                        # cmspark-agent (Node.js CLI)
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   │   ├── index.ts                 # CLI 入口 (start/stop/status/daemon/tray…)
│   │   ├── server.ts                # WebSocket 服务器 + tool 执行调度
│   │   ├── message-router.ts        # 消息路由（核心调度）
│   │   ├── llm/                     # adapter / llm-extract / vision / text-sanitize
│   │   ├── bridge/                  # tool-definitions / tool-schemas / tab-resolver
│   │   ├── skills/                  # skill-engine / skill-craft / semantic-match / site-matcher
│   │   ├── threads/                 # thread-manager + markdown/summary-export
│   │   ├── history/store.ts         # sql.js 操作历史
│   │   ├── security.ts              # 危险 API + matchDomain / trusted / auto_approved
│   │   ├── security-policy.ts       # HMAC security_token 颁发 + constant-time 校验
│   │   ├── security-confirmation.ts # L2 确认队列 (~45s + origin 绑定)
│   │   ├── ws-auth.ts               # WS 配对 / handshake
│   │   ├── mcp/                     # MCP client/manager/aggregator/transport
│   │   ├── outbound-mcp/            # Outbound MCP façade (ADR-022; Phase 0)
│   │   ├── computer/                # Computer Use（opt-in 桌面操控）
│   │   ├── host-use/                # Host 读写 / 平台 adapter（darwin/win/linux）
│   │   ├── apps/                    # 应用枚举 / 启动 / 生物识别门
│   │   ├── orchestrator/            # Multi-agent：spawn / tab-lease / fleet / L2
│   │   ├── board/                   # Mission Board（ADR-016）schema + mutate
│   │   ├── packs/                   # Mission Pack 引擎 + builtin appsec
│   │   ├── capability/              # enterprise modules / shell / workspace
│   │   ├── netsec/                  # 端口探测 scope + scan
│   │   ├── obsidian/                # vault 档案 / 索引 / 模板 / folder-picker
│   │   ├── hud/                     # HUD 协议 / shell-router（实验）
│   │   ├── tray/                    # Swift NSStatusBar / systray2 / readline + pairing
│   │   ├── daemon.ts / menu-bar-agent.ts / platform.ts / config.ts / logger.ts
│   │   └── …
│   ├── tests/                       # node:test 套件（见 docs/TESTING.md）
│   └── builtin-skills/
│       ├── writing-skills.md / grill-me.md / browse.md / dynamic-workflow.md
│       └── security/                # prompt-injection / jailbreak / instruction-hierarchy
│
└── docs/                             # 项目文档
    ├── architecture.md               # 本文档
    ├── GOAL.md                       # 项目目标与阶段规划
    ├── TESTING.md                    # 测试地图
    ├── mcp.md / mission-pack-usage.md / confirm-center-user-guide.md
    ├── computer-use-user-guide.md / host-and-apps.md
    ├── notebooklm-user-guide.md / multi-agent-user-guide.md
    ├── adr/                          # 架构决策记录（001–018+）
    └── …
```


> **注**：原设计中的 `risk-engine` / `privilege-manager` / `page-scanner` 与 extension 侧 `security-token.ts` **均不存在**于当前树；HMAC 令牌在 companion `security-policy.ts`。详见 §1.5 与 [ADR-006](adr/006-layered-defense.md)。

---

## 5. Obsidian 对话导出

> 详见 [ADR-008](adr/008-obsidian-export.md)。把对话导出成贴合用户 Obsidian vault 约定的 markdown 笔记，**UI 下载模式**（不写宿主文件、无路径沙箱）。

### 5.1 触发与数据流

```
Side Panel 📥(单条/整 thread) / 🧠(摘要)
        │  chrome.runtime.sendMessage({ type:"thread.export_obsidian", thread_id, scope, anchor_message_id? })
        ▼
background (forward) → Companion message-router.ts:
   case "thread.export_obsidian":
     1. 加载 messages + 缓存的 profile / vault-index / template（loadCached*，vault_path resolve 校验）
     2. (P2) queryRelatedNotes(index, body, 5) → footer [[wikilinks]]
     3. scope 分支:
        - single/qa_pair/thread → serializeThreadToMarkdown（纯函数）
        - summary              → summarizeThread(llmExtract 90s) → serializeSummaryToMarkdown
                                  (LLM 结构化摘要 + 折叠完整对话附录)
     4. return { type:"thread.exported_obsidian", content, filename, format }
        ▼
Side Panel useWebSocket → Blob 下载
```

### 5.2 模块（companion/src/）

| 模块 | 职责 |
|---|---|
| `threads/markdown-export.ts` | 纯序列化器：`serializeThreadToMarkdown`（tool 噪音折叠/截断/合法 JSON）+ `serializeSummaryToMarkdown`（摘要+折叠附录+footer+模板）；frontmatter 优先级 reserved > template > profile > default |
| `threads/summary-export.ts` | P3 摘要：`SUMMARY_SYSTEM_PROMPT`（固定结构 TL;DR/主题/结论/决策/待办）、`buildSummaryTranscript`（token 预算 head+tail，强制保留开篇提问）、`parseSummary`（鲁棒解析）、`summarizeThread`（llmExtract） |
| `obsidian/vault-profiler.ts` | P1 vault 档案：`scanVault`（递归采样 ~200 篇，safeSlice+stripLoneSurrogates）、`profileVault`（LLM 提取约定）、`parseVaultProfile`（fence-anywhere + 空值守卫）、缓存 |
| `obsidian/vault-index.ts` | P2 笔记索引：`buildVaultIndex`（semantic-match tokenize/tokensToVec）+ `queryRelatedNotes`（纯 TF 余弦 top-K，isSafeWikilinkName 过滤） |
| `obsidian/vault-templates.ts` | P2 模板：`detectTemplates`（frontmatterRaw **正则确定性提取**，非 gray-matter `.matter`）、`applyTemplate`（静态占位符替换）、realpath containment（防 symlink 逃逸/TOCTOU） |
| `obsidian/folder-picker.ts` | 原生文件夹选择器（macOS osascript / Linux zenity / Windows PowerShell）— 扩展无法读真实路径，故走 companion |
| `llm/llm-extract.ts` | 一次性非流式 LLM 调用（profileVault / summarizeThread 复用）；`stripLoneSurrogates` 在 boundary 防御 |

### 5.3 关键约束

- **隐私**：vault 档案只发笔记 basename + frontmatter(capped) + 正文前 200 字给 LLM；cache 文件 mode 0o600。
- **纯度边界**：`markdown-export.ts` 保持纯函数（无 IO/LLM）；LLM 调用集中在 `summary-export.ts` / `vault-profiler.ts`。
- **缓存失效**：profile/index/templates 按需刷新（Settings → 刷新 vault 档案），导出时不重扫。

---

## 6. Side Panel Mermaid 图表渲染

> 详见 [ADR-009](adr/009-mermaid-rendering.md)。把 ` ```mermaid ` 块在 Side Panel 渲染成 SVG 图，**客户端直跑**（MV3 strict CSP，无 sandbox/offscreen/server）。

### 6.1 触发与数据流

```
LLM 输出含 ```mermaid 块
   │  marked.parse → <pre><code class="language-mermaid">
   │  DOMPurify（markdown 白名单）→ dangerouslySetInnerHTML
   ▼
MarkdownRenderer useEffect（renderMermaid=true，仅落定消息）
   → renderMermaidBlocks(bodyRef)：
       ① ensureMermaid()（懒加载 + once-init：securityLevel:'strict' + htmlLabels:false）
       ② 取 code.textContent → mermaid.render(id, code) → { svg }
       ③ DOMPurify.sanitize(svg, USE_PROFILES svg+svgFilters)  ← 二次过
       ④ 套响应式样式 + click→Blob→chrome.tabs.create → 替换 <pre>
       ⑤ throw → 保留代码块 + "⚠️ 图表语法错误" 标签
```

### 6.2 模块（chrome-extension/src/sidepanel/）

| 模块 | 职责 |
|---|---|
| `components/mermaid.ts` | `ensureMermaid`（懒加载 + init，`securityLevel:'strict'`+`htmlLabels:false`）/ `prefetchMermaid`（once-flag）/ `renderMermaidBlocks`（找 `.language-mermaid` → render → DOMPurify SVG 二次过 → 响应式+点击放大 → 替换；`pending`/`isConnected` 守 React 竞态；try/catch 回退） |
| `components/ChatView.tsx` | `MarkdownRenderer` 加 `renderMermaid?:boolean` + `bodyRef` + `useEffect`；`MessageRow`/`CollapsibleMarkdown` 传 true、`StreamingMarkdown` 不传（流式不渲染）；`ChatView` idle 预取 + `StreamingMarkdown` 首 token 预取 |

### 6.3 关键约束

- **安全**：图源 = 不可信 LLM 输出（提示注入可达）；Side Panel 是特权页 → SVG 必须双层净化（mermaid strict + 我们的 DOMPurify SVG profile），绝不绕过。残留 `<style>`/`<image>` 资源外泄面与现有 markdown 渲染器同面，全局 `style-src` 硬化为独立议题。
- **打包坑**：`@mermaid-js/parser@1.2.0` 的 `exports` 只有 `import`（无 `default`），Plasmo/Parcel 解析失败 → `package.json` 加 `alias` 指向其 dist。
- **`htmlLabels:false` mandatory**：默认 `htmlLabels:true` 把节点标签渲成 `<foreignObject>`，被 DOMPurify SVG profile 剥掉 → 节点文字消失。
- **流式隔离**：mermaid 仅在落定消息渲染（plan A），流式期间 ` ```mermaid ` 当代码块。
- **加载**：各 diagram 类型为 Parcel 自动 code-split 的懒加载 chunk；core 经 idle/流式双预取，面板秒开。

---

## 7. Mission Pack（任务包）与企业能力模块

> 详见 [ADR-014](adr/014-mission-pack-enterprise-modules.md)。产品结论与完整设计见  
> `docs/decisions/v1.3/scenario-packs-product-conclusion-2026-07-26.md`、  
> `docs/superpowers/specs/2026-07-26-mission-pack-enterprise-design.md`。  
> 使用说明：`docs/mission-pack-usage.md`。

### 7.1 概念

```
Enterprise Module（config 级 opt-in）
  appsec | devsec-workspace | shell | netsec
        │  requires_modules
        ▼
Mission Pack（pack.yaml → pack.apply → Thread 字段）
  skills + knowledge + tool_whitelist + system_prompt_append + snapshot
```

- **Pack 非 runtime**：不新建执行引擎，只组合已有 SkillEngine / Thread / 工具策略。
- **双通道**：`capability_profile: community | enterprise`；shell/netsec 启用要求 enterprise。

### 7.2 数据流（apply）

```
UI「应用到当前线程」→ pack.apply { pack_id, thread_id }
  → validate installed pack + module gates
  → 内存从 pre-pack snapshot 计算 whitelist / skills / append
  → threadManager.applyPackPatch（单次原子写）
  → capability-audit.jsonl
```

### 7.3 模块与 Companion 工具

| 模块 | 工具 | 要点 |
|------|------|------|
| devsec-workspace | `workspace_list_dir` / `workspace_read_file` | `workspace_root` 仅原生 pick 绑定；路径 containment |
| shell | `shell_exec` | 单次命令；L2 **forceConfirm**；非交互 PTY |
| netsec | `netsec_port_scan` | 空 allowlist 拒绝；任务授权 + forceConfirm；TCP connect only |
| appsec | 内置 Pack `appsec-prd-review` | 威胁建模 + 页面 checklist（浏览器工具 allowlist） |

### 7.4 模块（代码路径）

| 路径 | 职责 |
|------|------|
| `companion/src/packs/` | `pack-engine` / `validator` / `audit-log` / builtin packs |
| `companion/src/capability/` | `modules` / `workspace` / `shell` |
| `companion/src/netsec/` | `scope`（CIDR/hostname）/ `scan`（TCP 探针） |
| `chrome-extension/.../PacksPanel.tsx` | 任务包 UI（L0/L1 底栏） |

### 7.5 关键约束

- **内置 / installed Pack 禁止**写入 `auto_approve_dangerous` / god-mode 等放宽键。
- **Trust B（用户场景）**：仅 `origin=user` 可带顶层 `trust`；`pack.apply` / save+apply 需 `user_gesture` 且 `allowTrust:true`；`spawn_worker` 与 zip/dir **install** 不得抬升 Trust（install 剥离 `origin:user`+`trust`）。
- **Trust 生命周期**：`unapply` / `uninstall` / 切换场景 / apply 失败路径恢复快照；进程级 **单 holder**（他对话占用则 `trust_holder_conflict` + `holders`；Side Panel 可 `force_takeover` 一键 unapply 占用方再 apply）；崩溃用 `mission-pack-trust-journal.json` + 启动 `reconcilePackTrustOnBoot`。
- `workspace_root not set` / `module_disabled` 为 **recoverable** 错误，引导用户 UI 操作。
- 审计日志：`logs/capability-audit.jsonl`（0o600、append、轮转）。Trust 相关事件含 `pack.trust_apply` / `pack.trust_restore` / `pack.trust_takeover`（一键解锁）/ `pack.trust_orphan_cookie_cleared` / `pack.trust_reconcile` / `pack.trust_release_on_thread_gone`。
- **L2 确认 / 确认台（Cockpit）**用户说明见 [confirm-center-user-guide.md](confirm-center-user-guide.md)（与 NetSec 任务授权分层；实现见 `security-confirmation.ts` + 扩展 `MinimalConfirm` / `CockpitApp`）。

---

## 8. MCP（Model Context Protocol）

> 用户配置与排错：[mcp.md](mcp.md)。

### 8.1 角色

Companion 作为 **MCP 客户端/聚合器**，把外部 server 的 tools（及按能力暴露的 resources/prompts）并入 LLM tool 面：

- 工具命名：`mcp__<server>__<tool>`
- 传输：stdio / HTTP（见 `companion/src/mcp/transport.ts`）
- 信任级别：`manual` / `first-use` / `trusted`（确认缓存 `confirm-cache.ts`）
- 每线程 server 选择：`auto` / `all` / `manual`

### 8.2 模块

| 路径 | 职责 |
|------|------|
| `companion/src/mcp/` | client · manager · aggregator · transport · types |
| `chrome-extension/.../McpPanel.tsx` · `McpServerForm.tsx` | Side Panel 配置 UI |
| `bridge/tool-definitions.ts` | `getMcpMetaToolDefinitions`（按 server 能力动态暴露） |

配置权威：`~/.cmspark-agent/config.json` 的 `mcp` 段。MCP **不**绕过 Companion 安全策略；危险 MCP 工具仍可走确认策略（见 mcp.md）。

### 8.3 Outbound MCP（编程 Agent 导出 · ADR-022）

> 决策 SoT：[ADR-022](adr/022-outbound-mcp-server.md)。**不是** inbound 客户端的逆操作而已：这是 **Composition 对 Surface L1 的策展导出**。

| 方向 | 角色 | 状态 |
|------|------|------|
| **Inbound**（§8.1） | Companion = MCP **client** | 0.3.0 已交付 |
| **Outbound** | Companion = MCP **server 门面** → 同一安全栈 → Extension/CDP | ADR Accepted；Phase 0 门控 |

- 工具命名：`cmspark__*`（默认 curated L1 子集；禁 cookies / evaluate / L2 / shell / netsec）
- 代码：`companion/src/outbound-mcp/`（profile · façade gate · audit）；stdio 真桥 / L8 托盘确认 / L9 tab lease / grant 见 ADR 分阶段
- 产品主叙事仍是 Side Panel；outbound **非** default-on；Skill 仅 adoption

### 8.4 ACP 编程接力 Client（本机写码助手 · ADR-025）

> 决策 SoT：[ADR-025](adr/025-acp-coding-agent-client.md) · 用户指南：[coding-handoff-user-guide.md](coding-handoff-user-guide.md)。  
> **方向与 Outbound 相反**：CMspark → 本机编程 Agent（stdio spawn / 任务包）；**不是** Side Panel IDE。

| 项 | 约定 |
|----|------|
| **Phase A** | 任务包 Markdown 复制（默认可用，无 spawn） |
| **Phase B** | `config.acp.enabled` 默认 **false**；审查 / 起草会话 + live FocusBand |
| **Trust** | start / apply_diff **强制 L2**；cruise / god-mode **不可**静默跳过 |
| **写盘** | 仅工作区 realpath 内 hunk apply；free shell NO-GO |
| **Autonomy** | workers **HARD_DENY** 全部 `acp_*` |
| **文案** | 审查/起草 = 任务意图，**不**声称 OS 沙箱只读 |

代码：`companion/src/acp/*` · Extension `coding-handoff/*` · Pack `coding-handoff`。

---

## 9. Computer Use · Host Use · Apps

> 用户指南：[computer-use-user-guide.md](computer-use-user-guide.md) · [host-and-apps.md](host-and-apps.md)  
> ADR：[017](adr/017-computer-use.md) · [018](adr/018-host-use.md)

### 9.1 分层

| 层 | 工具 / 配置 | 门 |
|----|-------------|-----|
| Apps 白名单 | `host_app` · `apps.enabled` · AppEntry | 每应用 policy；Apps 面板可切换全局坐标开关 |
| Host 语义 API | `host_read` · `host_write` | L2；写操作生物识别/nonce；opaque TargetId |
| Computer 坐标 | `host_computer` · `computer.coordinateEnabled` · `coordinateAllowed` | 双开关 + 任务级 L2：**god-mode / auto_approve 永不跳过**；session-trust 可抑 mid-task re-L2，且（显式 opt-in + corpus/预算/actions/thread key）可跳过同线程同 App 后续任务的 **initial L2**；danger / experimental / foreground_yielded **始终 prompt** |

桌面面由 Companion 调 OS 适配器（darwin Swift/AppleScript、win PowerShell/UIA 等），**不是** Extension CDP。

### 9.2 模块

| 路径 | 职责 |
|------|------|
| `companion/src/computer/` | policy · executor · session-trust · estop · evidence · adapters · **Qwen3-VL 实验定位**（TinyClick/Florence 已移除） |
| `companion/src/voice/` · `chrome-extension/.../voice/` | 本机 Whisper Path B（含 M2 渐进假设）· 听写+ / 会议工作台 |
| `companion/src/host-use/` | HostAdapter · 平台 adapter · blacklist · nonce |
| `companion/src/apps/` | 枚举 · 启动 · guards · biometric-gate |
| Extension Cockpit / AppsPanel / SafetyStrip | 确认台步骤轨 · 急停 · 坐标开关（`computer.set_enabled`） |

### 9.3 关键不变量

- 默认 deny：坐标与 Apps 总开关均为 false 时整类失败。  
- Vault/浏览器/终端等 **结构排除** 坐标。  
- Worker 默认 `WORKER_HARD_DENY` 含全部 `host_*`。  
- 过程设计稿在 `docs/decisions/`，**非**运行时唯一规范。

### 9.4 与纯视觉 GUI Agent / Operator 映射（吸收说明）

业界 SDK（如 UI-TARS Desktop）常把 **GUIAgent 循环** 与 **Operator**（screenshot / execute）拆开。CMspark **不**引入第二套 GUIAgent runtime，而是把等价端口落在 Companion CU 模块：

| UI-TARS 概念 | CMspark 对应 |
|--------------|--------------|
| `Operator.screenshot` | `ScreenCapturer` + 证据帧纪律（pendingRaws） |
| `Operator.execute` | `InputInjector` + policy / A1 像素新鲜度 / danger |
| `GUIAgent` 循环 | 主 LLM tool-loop 发 `host_computer` + executor 逐步执行 |
| Action DSL + Thought | 结构化 `actions[]`；实验层 raw → Thought 仅用于 re-L2 文案 |
| pause / CALL_USER / stop | 确认台 re-L2 · 急停 · 拒绝确认 |

研究 SoT：[research/ui-tars-absorption-2026-08-08.md](research/ui-tars-absorption-2026-08-08.md) · 路径锁定 Path C：[decisions/ui-tars-absorption-multipath-2026-08-08.md](decisions/ui-tars-absorption-multipath-2026-08-08.md)。

---

## 10. Multi-Agent Orchestrator 与 Mission Board

> 用户指南：[multi-agent-user-guide.md](multi-agent-user-guide.md)  
> ADR：[015](adr/015-multi-agent-orchestrator-tab-lock.md) · [016](adr/016-mission-board.md)

### 10.1 Orchestrator

- Worker = **子 Thread**（非独立 swarm runtime）。  
- Orchestrator **窄工具面**：`spawn_worker` / `wait_workers` / `collect_handback` / `list_*` / `ask_user` / `board_*`。  
- Spawn **仅** L2 HITL；`ORCHESTRATOR_CAPS`（默认 max 5 workers 等）见 `orchestrator/constants.ts`。  
- **Tab lease**：`tab-lease.ts` 进程级排他；TAB_LEASE_TOOLS 含读写页工具；扩展 per-tab 队列纵深防御。

### 10.2 Mission Board（P0）

- Thread 字段 `mission_board`：origin / goal / facts / intents / hints / status。  
- `board_read` · `board_complete`（L2 + canComplete）· intent claim/heartbeat。  
- board 模式下 `collect_handback` 结构化校验。  
- UI：`BoardPanel.tsx` · FleetStrip。

### 10.3 模块

| 路径 | 职责 |
|------|------|
| `companion/src/orchestrator/` | spawn · tab-lease · fleet · l2-admission · single-flight · constants |
| `companion/src/board/` | schema · service · intent-claim |
| Extension `FleetStrip` · `BoardPanel` · Cockpit | 舰队状态 · 板 · 确认身份 |

与 Skill `sub_agent` / `tool_chain` schema **正交**，勿混淆。

---

## 11. 工具分类速查（0.3.0）

| 类别 | 示例 | 执行位置 |
|------|------|----------|
| 浏览器 CDP | `list_tabs` · `click` · `evaluate` · cookies… | Extension background |
| Companion 本地 | `use_skill` · `record_experience` · `osascript_eval` | Companion |
| 企业 / Pack | `workspace_*` · `shell_exec` · `netsec_port_scan` | Companion |
| Host / Computer | `host_read` · `host_write` · `host_app` · `host_computer` | Companion + OS |
| 编排 / Board | `spawn_worker` · `board_read` · `list_tab_locks`… | Companion |
| MCP | `mcp__…` · meta resources/prompts | Companion → MCP server |

具体 schema：`bridge/tool-definitions.ts` · `tool-schemas.ts`。数量随 MCP/模块动态变化，**不以固定 N 计数**。

# CMspark Browser Agent — 架构文档

> 版本: 1.0.0 | 日期: 2026-05-24 | 状态: 已确认

---

## 1. 技术架构

### 1.1 系统拓扑

```
┌──────────────────────────────────────────┐
│               Chrome 浏览器               │
│  ┌─────────────────────────────────────┐ │
│  │        CMspark Browser Agent        │ │
│  │  ┌───────────┐  ┌────────────────┐  │ │
│  │  │ Side Panel │  │ Service Worker │  │ │
│  │  │ (Plasmo +  │  │ (background.js)│  │ │
│  │  │  React)    │  │                │  │ │
│  │  │            │  │ - WS client    │  │ │
│  │  │ - 聊天 UI  │  │ - CDP manager  │  │ │
│  │  │ - Thread管理│  │ - Tab manager  │  │ │
│  │  │ - Skill浏览 │  │ - Cookie ops   │  │ │
│  │  │ - 历史查看  │  │ - Keep-alive   │  │ │
│  │  └──────┬─────┘  └───────┬────────┘  │ │
│  │         │                │            │ │
│  │         └───┬────────────┘            │ │
│  │             │ chrome.runtime           │ │
│  │             │ + shared state          │ │
│  └─────────────┼─────────────────────────┘ │
│                │ WebSocket                  │
│                │ ws://127.0.0.1:23401      │
└────────────────┼──────────────────────────┘
                 │
    ┌────────────┼──────────────────────────┐
    │            ▼                           │
    │  ┌──────────────────────────────────┐ │
    │  │    cmspark-agent (Companion)     │ │
    │  │    Node.js / TypeScript          │ │
    │  │                                  │ │
    │  │  ┌──────────┐ ┌───────────────┐  │ │
    │  │  │ WS Server│ │ LLM Adapter   │  │ │
    │  │  │          │ │               │  │ │
    │  │  │ - 连接管理│ │ - OpenAI SDK  │  │ │
    │  │  │ - 消息路由│ │ - Streaming   │  │ │
    │  │  │ - Ping/Pong│ │ - Tool calling│  │ │
    │  │  └────┬─────┘ └───────┬───────┘  │ │
    │  │       │               │          │ │
    │  │  ┌────┴───────────────┴───────┐  │ │
    │  │  │       Core Engine          │  │ │
    │  │  │                            │  │ │
    │  │  │  ┌──────────────────────┐  │  │ │
    │  │  │  │   Thread Manager     │  │  │ │
    │  │  │  │   (消息历史, 隔离)    │  │  │ │
    │  │  │  └──────────────────────┘  │  │ │
    │  │  │  ┌──────────────────────┐  │  │ │
    │  │  │  │   Skill Engine       │  │  │ │
    │  │  │  │   (加载, 注入, 管理)  │  │  │ │
    │  │  │  └──────────────────────┘  │  │ │
    │  │  │  ┌──────────────────────┐  │  │ │
    │  │  │  │   Tool Dispatcher    │  │  │ │
    │  │  │  │   (路由, 执行, 错误)  │  │  │ │
    │  │  │  └──────────────────────┘  │  │ │
    │  │  │  ┌──────────────────────┐  │  │ │
    │  │  │  │   History Store      │  │  │ │
    │  │  │  │   (SQLite)           │  │  │ │
    │  │  │  └──────────────────────┘  │  │ │
    │  │  └────────────────────────────┘  │ │
    │  │                                    │ │
    │  │  Data: ~/.cmspark-agent/          │ │
    │  │  ├── config.json                  │ │
    │  │  ├── skills/          (用户技能)  │ │
    │  │  ├── builtin-skills/  (内置技能)  │ │
    │  │  ├── threads/         (线程数据)  │ │
    │  │  ├── history.db       (操作历史)  │ │
    │  │  └── logs/                        │ │
    │  └──────────────────────────────────┘ │
    └───────────────────────────────────────┘
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
| 数据库 | better-sqlite3 | SQLite，操作历史存储 |
| 文件格式 | Markdown + YAML frontmatter | skills 文件格式 |
| 配置存储 | chrome.storage.local + JSON 文件 | extension侧/companion侧分别持久化 |

### 1.3 通信协议

基于 WebSocket 的 OpenAI-compatible streaming 协议：

```
消息类型:
├── chat.create      → 创建新消息（streaming response）
├── chat.abort       ← 中断当前 streaming
├── tool.result      ← tool 执行结果（extension → companion）
├── tool.execute     → tool 执行指令（companion → extension）
├── config.get/set   → LLM 配置读写
├── skill.list/import/export → skill 管理
├── thread.list/create/delete → 线程管理
├── history.query    → 操作历史查询
└── system.ping/pong → 心跳保活
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
cmsspark/
├── chrome-extension/                # Extension (Plasmo + React)
│   ├── plasmo.config.ts
│   ├── src/
│   │   ├── sidepanel/               # Side Panel 页面
│   │   │   ├── index.tsx            # 主入口
│   │   │   ├── App.tsx              # 根组件
│   │   │   ├── components/
│   │   │   │   ├── ChatView.tsx     # 聊天视图
│   │   │   │   ├── ThreadList.tsx   # 线程列表（可折叠）
│   │   │   │   ├── MessageCard.tsx  # 消息卡片
│   │   │   │   ├── ToolCallCard.tsx # Tool call 卡片
│   │   │   │   ├── BottomBar.tsx    # 底部上下文栏
│   │   │   │   ├── TabPanel.tsx     # 标签页面板
│   │   │   │   ├── HistoryPanel.tsx # 操作历史面板
│   │   │   │   ├── SkillPanel.tsx   # 技能面板
│   │   │   │   └── SettingsSlideout.tsx # 设置滑出面板
│   │   │   ├── hooks/
│   │   │   │   ├── useWebSocket.ts  # WS 连接管理
│   │   │   │   ├── useThreads.ts    # 线程状态
│   │   │   │   └── useStreaming.ts  # Streaming 渲染
│   │   │   └── store/
│   │   │       └── agentStore.ts    # 全局状态
│   │   ├── background/
│   │   │   ├── index.ts             # Service Worker 入口
│   │   │   ├── ws-client.ts         # WebSocket 客户端
│   │   │   ├── browser-bridge.ts    # CDP/tabs/cookies 操作
│   │   │   └── keep-alive.ts        # Alarm keep-alive
│   │   ├── popup/
│   │   │   └── index.tsx            # Popup 页面（连接状态）
│   │   └── utils/
│   │       ├── config.ts            # 配置管理
│   │       └── permissions.ts       # 权限检查
│   └── assets/
│       └── icons/
│
├── companion/                        # cmspark-agent (Node.js CLI)
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   │   ├── index.ts                 # CLI 入口 (start/stop/status)
│   │   ├── server.ts                # WebSocket 服务器
│   │   ├── llm/
│   │   │   ├── adapter.ts           # LLM 适配器（OpenAI SDK）
│   │   │   ├── streaming.ts         # Streaming 处理
│   │   │   └── tool-calling.ts      # Tool calling 循环
│   │   ├── bridge/
│   │   │   ├── tool-dispatcher.ts   # 工具路由与调度
│   │   │   ├── tab-tools.ts         # 标签页工具定义
│   │   │   ├── page-tools.ts        # 页面操作工具定义
│   │   │   ├── cookie-tools.ts      # Cookie 工具定义
│   │   │   └── evaluate.ts          # JS evaluate 安全处理
│   │   ├── skills/
│   │   │   ├── skill-loader.ts      # Skill 文件加载/解析
│   │   │   ├── skill-engine.ts      # Skill 匹配与注入
│   │   │   └── skill-export.ts      # 导入/导出
│   │   ├── threads/
│   │   │   ├── thread-manager.ts    # 线程 CRUD
│   │   │   └── context-builder.ts   # LLM context 构建
│   │   ├── history/
│   │   │   ├── store.ts             # SQLite 操作
│   │   │   └── query.ts             # 历史查询
│   │   ├── config.ts                # 配置管理
│   │   └── security.ts              # 安全策略（信任域等）
│   └── builtin-skills/              # 内置 skills
│       ├── writing-skills.md
│       ├── grill-me.md
│       └── browse.md
│
└── docs/                             # 项目文档
    ├── architecture.md               # 本文档
    ├── requirements/
    │   ├── mvp-v0.1.md               # MVP 需求
    │   └── v2.md                     # v2 需求
    └── sprints/
        ├── sprint-01-mvp/
        │   └── tasks.md              # MVP 开发任务
        └── sprint-02-extensions/
            └── tasks.md              # v2 开发任务
```

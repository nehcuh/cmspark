# CMspark Browser Agent

> 对着**已经登录的 Chrome** 干活的本机手：热键召唤开口，危险走**确认台**，Codex / Claude Code / Grok 可**租同一只手**（Outbound MCP）。家是 **已登录 Chrome + 硬闸**，不是 Side Panel。  
> 能力叠加：**默认**网页问答与页内操控；**按需** Skills / Knowledge / MCP / 任务包；**opt-in** 桌面 Computer Use 与企业模块。产品句：[PRODUCT.md](PRODUCT.md)。

---

## 项目简介

CMspark 是本机 Companion + Chrome 扩展（Plasmo）的双层 Agent。人盯着页面时用 Side Panel 操作；人在别的窗口或编程助手里时，用热键 **Capture 卡** 开口、后台 CDP 干活，危险只在确认台出现。不是第二套 Codex，也不是给每家 AI 再装一只扩展。

四面（[PRODUCT.md](PRODUCT.md)）：

| 面 | 入口 | 做什么 |
|----|------|--------|
| **Capture** | 热键 / 工具栏 C / 侧栏「弹出对话框」 | HTML 卡 **360×420**（流式出字、📎、听写、会议）。**永不** Allow/Deny |
| **Operate** | Side Panel ~320px，或后台 CDP | 盯着页时聊+点；人不在侧栏时仍可动已登录 Chrome |
| **Confirm** | 确认台 / Mac 托盘 | 高危审批与急停。Win/Linux 必须开 Chrome 确认台 |
| **租手** | Outbound MCP + `cmg_` 钥匙 | 外部编程助手当 client，调 `cmspark__*`。实验、非 default-on |

Companion **从不**调用 `chrome.sidePanel.open`；打不开侧栏时 toast **请点工具栏 C**。

### 能力模型（三轴）

完整规范见 **[ADR-020](docs/adr/020-capability-model-three-axes.md)** · [architecture.md](docs/architecture.md)。工具面随模块与 MCP 动态扩展，**不以固定「N 种工具」计数**。

**定位：** 家 = 已登录 Chrome + 硬闸。默认浏览器内 Agent（对话 → 页内操控）→ 场景靠 **Mission Pack** 叠加（不是新 runtime）→ 桌面 / 企业能力 **opt-in**。

用户可记一条由表及里的故事线，并与架构轴对齐：

| 故事线 | 架构归属 | 含义 |
|--------|----------|------|
| **主体** | Surface **L0** 聊 | 网页问答、写作、规划；不发起浏览器 tool |
| **浅层** | Surface **L1** 网页 | 页签、导航、点击/填表、截图、cookie 信任域等 |
| **中层** | **组合面**（Composition）— *不是*「中层 Agent」 | Skill · Knowledge · MCP · Pack · user-env：装配到任意 Surface |
| **深层** | Surface **L2** 计算机 | Computer Use / Host / Apps / 企业 shell·netsec + 前述组合 |

```text
  Composition: Skill · Knowledge · MCP · Pack · user-env
        │              挂到任意作用面
   L0 聊 ──▶ L1 网页 ──▶ L2 宿主（opt-in）
        │
  Autonomy: 单线程 ──▶ multi-worker ──▶ Mission Board
  Trust: 随 Surface 变严；Pack 不得放宽全局 auto_approve / god-mode
```

**高级场景多为「组合复用」**：例如 AppSec/黑盒 checklist ≈ L1 + Pack；Datayes 类投研 ≈ L0 + Skill/MCP（仅在真正调浏览器 tool 时进入 L1）——不必默认上 L2。

### 已交付能力（按作用面）

| 归属 | 能力 | 说明 | 文档 |
|------|------|------|------|
| **Capture** | 召唤器 HTML 卡 | 360×420；流式出字；永不审批 | 本页 [召唤器](#召唤器capture) · [PRODUCT.md](PRODUCT.md) |
| **L0 · 主体** | 自然语言 · 多线程 · 历史 | Side Panel ChatShell（空态「要对这页做什么」/「弹出对话框」）；线程隔离；SQLite 操作史 | 本页 [使用指南](#使用指南) |
| **L0 产品特性** | Obsidian 导出 · Mermaid · NotebookLM | 导出/渲染/导入（**非**组合原语） | [ADR-008](docs/adr/008-obsidian-export.md) · [009](docs/adr/009-mermaid-rendering.md) · [notebooklm-user-guide](docs/notebooklm-user-guide.md) |
| **L0 输入** | 听写+ · 本机 STT · 会议记录 | classic/连续/按住热键；Whisper 渐进假设；场景「会议」工作台 | [meeting-and-dictation-user-guide](docs/meeting-and-dictation-user-guide.md) · [ADR-023](docs/adr/023-voice-local-stt-path-b.md) · [ADR-024](docs/adr/024-dictation-plus-asr-refiner-meeting.md) |
| **L1 · 浅层** | 浏览器 CDP 操控 | 标签页、页面读写、点击/填表、截图、导航等 | 本页 [浏览器操作示例](#浏览器操作示例) |
| **L1** | Cookie 信任域 | `trusted_domains` 门控 cookie；SSO 场景基础 | [Cookie 信任域](#cookie-信任域) · [ADR-005](docs/adr/005-cookie-trust-domain-security.md) |
| **组合面** | Skills · Knowledge | Markdown+YAML Skills；知识注入 System Prompt | [Skills](#技能系统skills) · [Knowledge](#知识库knowledge) |
| **组合面** | MCP（入站） | 外接 stdio/HTTP server，`mcp__<server>__<tool>` | [mcp.md](docs/mcp.md) |
| **租手** | Outbound MCP | 我们当 server：`cmspark__*` + `cmg_`（≠ `ws_secret`，≠ 编程接力） | [mcp.md 5 分钟租手](docs/mcp.md#outbound-mcp) · [ADR-022](docs/adr/022-outbound-mcp-server.md) |
| **组合面** | Mission Pack / 企业模块 | 任务包装配线程；appsec / workspace / shell / netsec | [mission-pack-usage](docs/mission-pack-usage.md) |
| **组合面** | 用户环境变量（Secrets） | shell/MCP 子进程密钥，不进聊天粘贴 | [user-env](docs/user-env.md) · [ADR-019](docs/adr/019-user-env-secrets.md) |
| **横切** | 安全确认 / Confirm Center | 高危确认、域白名单、Cockpit 审批/急停 | [confirm-center-user-guide](docs/confirm-center-user-guide.md) |
| **Autonomy** | Multi-Agent · Mission Board（P0） | Orchestrator + tab 锁；黑板 `board_*` | [multi-agent-user-guide](docs/multi-agent-user-guide.md) |
| **Autonomy** | 巡航档位 · plan_readonly · 无人值守 loop | 发送键旁四档芯片（#325）；线程级只读计划帽（#327）；L-1/L-3/L-5 loop（#386–#391，**默认关**；独立 ADR 待补） | [CHANGELOG `[0.6.0]`](CHANGELOG.md) |
| **组合面** | 专家团队（`kind: expert`） | 七个预置角色 Pack + 一张 L2 卡组队（#366–#371；persona ≠ 权限） | [CHANGELOG `[0.6.0]`](CHANGELOG.md) · [ADR-014](docs/adr/014-mission-pack-enterprise-modules.md)/[020](docs/adr/020-capability-model-three-axes.md) 修订段 |
| **L2 · 深层 / opt-in** | Computer Use · Host Use · Apps | 桌面操控、宿主读写/应用白名单；平台相关、默认关 | [computer-use-user-guide](docs/computer-use-user-guide.md) · [host-and-apps](docs/host-and-apps.md) |
| **运维** | Daemon · 托盘 · 配对 | 开机自启；macOS 托盘 + 配对码 | 本页 [后台常驻服务](#后台常驻服务跨平台) |

### 系统拓扑

```
┌──────────────────────────────────────────┐
│               Chrome 浏览器               │
│  ┌─────────────────────────────────────┐ │
│  │      CMspark Browser Agent          │ │
│  │  ┌───────────┐  ┌────────────────┐  │ │
│  │  │ Side Panel│  │ Service Worker │  │ │
│  │  │ (React)   │  │ (background)   │  │ │
│  │  │ - 聊天 UI │  │ - CDP 控制     │  │ │
│  │  │ - 线程管理│  │ - Tab/Cookie   │  │ │
│  │  │ - 技能浏览│  │ - WS 客户端    │  │ │
│  │  └─────┬─────┘  └───────┬────────┘  │ │
│  │        │                │           │ │
│  │        └───┬────────────┘           │ │
│  │            │ chrome.runtime          │ │
│  └────────────┼─────────────────────────┘ │
│               │ WebSocket                 │
│               │ ws://127.0.0.1:23401      │
└───────────────┼───────────────────────────┘
                │
    ┌───────────┴───────────────────────────┐
    │           cmspark-agent               │
    │       (Node.js + TypeScript)          │
    │                                       │
    │  - LLM 适配器 (OpenAI-compatible)     │
    │  - 线程管理器 (消息历史, Context)      │
    │  - 技能引擎 (加载, 注入, 管理)         │
    │  - 工具调度器 (路由, 执行)             │
    │  - 历史存储 (SQLite)                   │
    └───────────────────────────────────────┘
```

上图是扩展 ↔ Companion 双层拓扑。产品面上还有：**Capture HTML 卡**（独立 overlay 窗）、**确认台**（`tabs/cockpit.html`）、**租手**（Outbound MCP stdio）。图里没画不等于没有。

---

## 目录

- [项目简介](#项目简介)
  - [能力模型（三轴）](#能力模型三轴)
  - [已交付能力（按作用面）](#已交付能力按作用面)
  - [系统拓扑](#系统拓扑)
- [安装](#安装)
- [使用指南](#使用指南)
  - [快速开始](#快速开始)
  - [召唤器（Capture）](#召唤器capture)
  - [弹出对话框](#弹出对话框)
  - [浏览器操作示例](#浏览器操作示例)
  - [多线程使用](#多线程使用)
  - [技能系统（Skills）](#技能系统skills)
  - [知识库（Knowledge）](#知识库knowledge)
  - [安全与确认](#安全与确认)
  - [MCP 与租手](#mcp-与租手不要混)
  - [任务包与企业模块](#任务包与企业模块)
  - [导出与导入](#导出与导入)
  - [桌面与宿主操控](#桌面与宿主操控)
  - [多 Agent 与任务板](#多-agent-与任务板)
  - [文件上传](#文件上传)
- [配置说明](#配置说明)
- [后台常驻服务（跨平台）](#后台常驻服务跨平台)
- [开发](#开发)
- [项目结构](#项目结构)
- [常见问题](#常见问题)
- [技术栈](#技术栈)
- [相关文档](#相关文档)

---

## 安装

### 环境要求

- **Node.js** ≥ 22（推荐使用 `nvm` 管理；与 CONTRIBUTING / CI / `engines` / `package.sh` 对齐）
- **Chrome / Edge** 浏览器（支持 Manifest V3 扩展）
- **LLM API Key**（默认支持 DeepSeek，也可配置其他 OpenAI-compatible 服务）

### 1. 克隆仓库并安装依赖

```bash
# 安装所有依赖（extension + companion）
make install

# 或者分别安装
cd companion && npm install
cd chrome-extension && npm install
```

### 2. 构建 Companion（本地服务）

```bash
cd companion && npm run build
```

### 3. 构建 Chrome 扩展

```bash
cd chrome-extension && npm run build
```

构建产物位于 `chrome-extension/build/chrome-mv3-prod/`。

### 4. 加载扩展程序

1. 打开 Chrome，访问 `chrome://extensions/`
2. 开启右上角「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择 `chrome-extension/build/chrome-mv3-prod/` 目录

### 5. 启动 Companion

```bash
# 生产模式
cd companion && npm start

# 或开发模式（热重载）
cd companion && npm run dev
```

Companion 默认在 `ws://127.0.0.1:23401` 启动 WebSocket 服务。

### 6. 配置 LLM

首次使用时，点击 Side Panel 顶部的设置图标，配置：

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `api_key` | LLM API Key | 读取 `DEEPSEEK_API_KEY` 环境变量 |
| `base_url` | API 基础地址 | `https://api.deepseek.com/v1` |
| `model_name` | 模型名称 | `deepseek-v4-flash` |
| `temperature` | 温度参数 | `0.7` |
| `context_window` | 上下文窗口大小 | `512000` |

---

## 使用指南

### 快速开始

1. **装好 Companion + 扩展**（见上文 [安装](#安装)）。托盘起来后扩展要配对。
2. **开口（Capture）**：热键、工具栏 **C**，或侧栏顶栏 **弹出对话框**，打开同一张 HTML 卡（360×420，流式出字）。失败 toast：**请点工具栏 C**。
3. **盯着页面时（Operate）**：点工具栏 C 打开 Side Panel；空态是「要对这页做什么」+ 当前页 + 3 个芯片，不是空白聊天机器人。
4. **危险（Confirm）**：Allow/Deny **只**在确认台 / Mac 托盘。悬浮卡上没有批准按钮。
5. **租手**：Codex 等走 Outbound MCP（[5 分钟租手](docs/mcp.md#outbound-mcp)），钥匙 `cmg_`，**不要**把 `ws_secret` 当 grant。

### 召唤器（Capture）

完整步骤：[召唤器用户指南](docs/summoner-user-guide.md)。

Mac 菜单/热键与侧栏「弹出对话框」是**同一张卡**。卡上：问答、📎、听写、开始/结束会议、**打开浏览器并打开侧栏**。Companion 进程不调 `chrome.*`；扩展 SW 才开侧栏。

- 尺寸：**360×420**（代码 `OVERLAY_WINDOW_SIZE`）
- **永不** Allow/Deny；确认永远在确认台
- HTML 卡跟 `chat.token` **流式出字**（Swift 旧条本已流式）
- 不是 WorkBuddy 五轨工作台；禁止「去侧栏批准」文案

### 弹出对话框

Side Panel 顶栏 **弹出对话框** = 打开上面那张 Capture 卡，不是再开一个聊天产品。装配（技能/知识/MCP/任务包）留在侧栏壳外。

### 浏览器操作示例

```
用户: "打开 GitHub  trending 页面，提取前 10 个仓库的名称和 star 数"

Agent 执行:
  ├─ create_tab → https://github.com/trending
  ├─ get_page_text → 分析页面结构
  ├─ evaluate("提取仓库列表") → [{name, stars}, ...]
  └─ 结果汇总: "今日 Trending Top 10: 1. xxx (5.2k⭐) ..."
```

```
用户: "在当前页面找到登录按钮并点击"

Agent 执行:
  ├─ get_page_text → 定位登录元素
  ├─ click("登录按钮 selector")
  └─ 返回操作结果
```

### 多线程使用

Side Panel 支持多条对话线程并行：

- **线程 A**："从 HR 系统提取考勤数据" — 固定 HR 系统标签页
- **线程 B**："对比三个竞品的定价策略" — 固定三个竞品页面
- **线程 C**：通用助手 — 未固定标签页（自动 fallback 到当前激活标签）

每条线程拥有：
- 独立的消息历史
- 独立的 LLM 配置（可分别使用不同模型）
- 独立的标签页绑定

### 技能系统（Skills）

Skill 是**可复用的操作流程模板**，告诉 AI「如何完成某类任务」。格式为 Markdown + YAML frontmatter。

**内置技能（用 `/` 触发）**：

```
/browse https://example.com   → 读取页面并摘要
/screenshot                   → 截图并视觉分析
/extract                      → 提取页面结构化数据
```

**Skill 文件格式**：

```markdown
---
name: login-company-sso
description: 公司 SSO 系统登录流程
type: prompt_template
---
# 登录步骤
1. 导航到登录页
2. 找到「企业登录」入口，点击
3. 在 SSO 弹窗中输入工号和密码
4. 等待跳转完成后确认已进入主页
```

**Skill 类型**：
- `prompt_template`：操作步骤描述，LLM 按步骤执行（最常用、生产路径）
- `tool_chain`：**schema / 实验性** — 预定义工具调用序列；勿与 multi-agent **Orchestrator** 混淆
- `sub_agent`：**schema / 实验性** — Skill 嵌套子任务；真实多 worker 编排见 [ADR-015](docs/adr/015-multi-agent-orchestrator-tab-lock.md) 与下文 [多 Agent 与任务板](#多-agent-与任务板)

**注入机制**：
- 自动模式：根据用户输入语义匹配相关 Skill，低于 20 分相似度不触发
- 手动模式：在 Side Panel 的 Skills 面板手动勾选
- 直接调用：输入 `/skill名` 强制加载

Skill 只在被加载时才消耗 token（LLM 先看索引，决定是否调用 `use_skill(name)`）。

**创建自定义 Skill**：
1. 让 Agent 执行一次完整操作
2. 说「把刚才的操作保存为 skill」
3. Agent 自动分析操作序列、提取参数、生成 skill 文件
4. 在 Skills 面板中预览、编辑后保存

**导入/导出 Skill**：
- 导出：Skills 面板 → 选择 skill → 导出为 `.md` 文件
- 导入：Skills 面板 → 输入本地路径 → 导入文件夹或单个文件

Skill 文件存储于 `~/.cmspark-agent/skills/`。

---

### 知识库（Knowledge）

Knowledge 是**背景资料注入机制**，告诉 AI「需要了解什么」。内容在每次对话时直接插入 System Prompt，无需 LLM 主动调用。

**与 Skills 的核心区别**：

| | Skills | Knowledge |
|---|---|---|
| 本质 | 告诉 AI **怎么做** | 告诉 AI **知道什么** |
| 触发 | 按需调用 / 语义匹配 | 每次对话自动注入 |
| token 成本 | 低（只有索引） | 固定（每篇上限 ~500 tokens） |
| 适合内容 | 操作流程、步骤模板 | API 文档、背景说明、规范 |

**两种知识类型**：
- `domain_knowledge`：全局知识，不绑定网站（如 API 文档、编码规范）
- `site_knowledge`：绑定特定域名；在**自动**模式下，当前活动标签页域名匹配时自动注入

**知识文档格式**：

```markdown
---
name: internal-api-docs
description: 内部系统 REST API 参考
type: domain_knowledge
---
# 认证
所有接口使用 Bearer Token（请求头 Authorization: Bearer <token>）。

# 常用接口
- GET /api/users        获取用户列表
- POST /api/tasks       创建任务（需 title, assignee 字段）
```

```markdown
---
name: jira-guide
description: 公司 Jira 使用规范
type: site_knowledge
site: jira.company.com   # 或 *.company.com（含子域 + apex）
---
所有 Bug 任务需标 Priority: P1/P2。
Sprint 周期两周，每周一开始。
提交前需关联 Confluence 文档链接。
```

**三种注入模式**（在「知识」面板顶部切换，按线程保存）：
- **自动**（默认，推荐）：手动勾选的知识 ∪ **当前活动标签页 hostname 匹配的 `site_knowledge`**
- **全选**：所有知识文档全部注入（上下文大，适合文档研读）
- **按需**：只用手动勾选（✓）的文档

#### 站点知识如何自动匹配

1. **文档侧**：frontmatter 必须同时具备  
   - `type: site_knowledge`  
   - `site: example.com` 或 `site: *.example.com`  
2. **对话侧**：每次发消息 / 重新生成 / 上传文件时，扩展把**当前活动标签**的 hostname 一并带给 Companion（仅 hostname，不传完整 URL，避免 query/token 进协议）。  
3. **匹配规则**（`site-matcher`，大小写不敏感）：  
   - 精确：`site: github.com` ↔ 标签 `github.com`  
   - 通配：`site: *.github.com` ↔ `api.github.com`、`www.github.com`，以及 apex `github.com`  
   - 不会误匹配：`*.github.com` **不**匹配 `evilgithub.com`（按域名边界比较）  
4. **不会自动带上站点知识的情况**：  
   - 活动页不是 `http(s)`（如 `chrome://`、扩展页、`about:blank`）  
   - 知识模式为「按需」且未勾选该文档  
   - 文档缺少 `type: site_knowledge` 或 `site` 字段（例如 Obsidian vault 导入的 `goal`/`task` 笔记属于知识库，但不会按域名自动挂载）  
5. **安全边界**：hostname **只用于选哪篇知识注入 prompt**，不参与 cookie 信任域 / evaluate 白名单等安全门禁；cookie 工具仍要求目标域在 `trusted_domains` 中。

也可让 Agent 调用 `record_experience`（`target: "site"`, `domain: "…"`）把操作经验记成站点知识，下次打开同站时在自动模式下可再次注入。

**导入 / 查看 / 下载**（「知识」面板；注入用的背景资料）：
- 点一篇 → 阅读器看正文；可改标题 / 标签 / 说明 / 正文后确认保存  
- 「下载 .md」→ 浏览器下载（不写本机 vault）  
- 列表「相关」最多 3 条可点标题（有标签或说明重叠才会出现）  
- 「导入文件」→ 选择本地 `.md` 等文件  
- 「导入文件夹」→ Companion 原生选目录（适合 Obsidian vault，有数量/大小上限）  
- 「导入 URL」→ Markdown 网络地址（如 GitHub raw 链接）  

**存储路径**：

```
~/.cmspark-agent/knowledge/
├── global/     # 全局 / 未绑定 site 的文档（含多数 vault 导入）
└── sites/      # 带 site 字段导入时的站点知识
```

每篇过长内容会截断或按查询做片段检索，建议单篇只保留关键信息。

**与「技能」面板的边界**：Skills 列表只含流程类 skill（`prompt_template` 等）；`knowledge/` 下的笔记（含 vault 的 goal/task 等）只出现在「知识」面板，不会混进「技能」。

**典型使用场景**：
1. **内部系统操作**：把 URL 结构、登录方式写成 `site_knowledge`，绑定系统域名；打开该站再聊天即自动带上  
2. **研发助手**：团队规范、架构说明导入为 `domain_knowledge`  
3. **产品调研**：竞品资料按域名拆成多篇 `site_knowledge`，浏览对应站时自动对齐上下文  

---

### 安全与确认

高危工具（如 `evaluate`、`osascript_eval`、部分 navigate/create_tab、Computer Use / shell / netsec 等）**默认不静默执行**：

1. Companion 的 `SecurityConfirmationManager` 排队（约 **45s** 超时）  
2. Side Panel 红条 **或** **确认台（Confirm Center / Cockpit）** 人机审批（**不是**召唤器 HTML 卡）  
3. 批准后颁发 HMAC `security_token` 才真正执行  

| 机制 | 作用 |
|------|------|
| `trusted_domains` | Cookie 工具信任域（与自动批准无关） |
| `auto_approved_domains` | 跳过部分工具的重复确认（精确 / `*.suffix` / `*`） |
| `security.auto_approve_dangerous` | 全局 kill-switch（无人值守；默认关） |
| Cockpit | 宽屏审批、Computer Use 步骤轨与急停 |

**召唤器 / overlay 永不 Allow/Deny。** Win/Linux 没有原生托盘确认，必须打开 Chrome 确认台。

详见 [confirm-center-user-guide](docs/confirm-center-user-guide.md)、[ADR-007](docs/adr/007-domain-whitelist-auto-approve.md)。

---

### MCP 与租手（不要混）

三件不同的事：

| | 方向 | 名字 |
|--|------|------|
| **入站 MCP** | 外部工具 → 我们的 loop | `mcp__<server>__<tool>`（Side Panel MCP 面板） |
| **租手**（Outbound） | 他们 → 我们的已登录 Chrome | `cmspark__*` + 钥匙 `cmg_`（≠ `ws_secret`） |
| **编程接力** | 我们 → 本机编程 Agent | ACP client，[coding-handoff](docs/coding-handoff-user-guide.md)。**不是**租手 |

入站：Companion 接 stdio/HTTP MCP server。配置 `~/.cmspark-agent/config.json` 的 `mcp` 段。  
租手（实验、非 default-on、T1 已记分仍**禁扩** profile）：**[5 分钟租手](docs/mcp.md#outbound-mcp)** · [ADR-022](docs/adr/022-outbound-mcp-server.md)。

---

### 任务包与企业模块

**Mission Pack** 把 skills、knowledge、`tool_whitelist`、`system_prompt_append` 等装配到当前线程（不是新 runtime）。**Module** 是安装级 opt-in：`appsec`、`devsec-workspace`（community 可开）、`shell` / `netsec`（需 `capability_profile: "enterprise"`）。

Side Panel 底栏 → **任务包**：启用模块、选择工作区、NetSec 任务授权、应用 Pack。`workspace_*` 须先绑定本机目录；`shell_exec` / `netsec_port_scan` 另走 L2 确认与审计（`logs/capability-audit.jsonl`）。

完整步骤与排错：[mission-pack-usage](docs/mission-pack-usage.md) · 设计 [ADR-014](docs/adr/014-mission-pack-enterprise-modules.md)。

---

### 导出与导入

| 能力 | 做什么 | 文档 |
|------|--------|------|
| **Obsidian 导出** | 单条 📥 / 整 thread / 🧠 NotebookLM 风格摘要 → 浏览器 Blob 下载（不写宿主盘）；可选 vault 档案 + wikilinks/模板 | [ADR-008](docs/adr/008-obsidian-export.md) |
| **Mermaid** | 落定消息中 ` ```mermaid ` 块 → SVG（CSP-safe + DOMPurify） | [ADR-009](docs/adr/009-mermaid-rendering.md) |
| **NotebookLM 导入** | Side Panel 导入器（URL/链接/RSS/YouTube/线程）+ 离线当前页 MD；需已登录 NotebookLM | [notebooklm-user-guide](docs/notebooklm-user-guide.md) · [ADR-011–013](docs/adr/011-notebooklm-import.md) |
| **Vault → Knowledge** | 「知识」面板导入文件夹（Obsidian vault 等）→ `knowledge/global` 或 `sites/` | 本页 [知识库](#知识库knowledge) |

---

### 桌面与宿主操控

**进阶 / opt-in**，平台相关，默认关闭；高危步骤进 **确认台**（急停、session-trust 见用户指南）。

| 面 | 说明 | 文档 |
|----|------|------|
| **Computer Use** | `host_computer`：白名单窗口坐标键鼠；双开关 + 任务级 L2；Cockpit 急停 | [computer-use-user-guide](docs/computer-use-user-guide.md) · [ADR-017](docs/adr/017-computer-use.md) · [confirm-center](docs/confirm-center-user-guide.md) |
| **Host Use / Apps** | `host_read` / `host_write` / `host_app`：宿主读写、应用白名单 launch | [host-and-apps](docs/host-and-apps.md) · [ADR-018](docs/adr/018-host-use.md) |

商店默认不把无自由 shell / 全桌面操控做成静默能力；企业侧与模块门见任务包文档。

---

### 多 Agent 与任务板

- **Orchestrator + Worker**（[ADR-015](docs/adr/015-multi-agent-orchestrator-tab-lock.md)）：主线程编排、`spawn_worker`（必 L2）、**tab 排他锁**。与 Skill 类型 `sub_agent` **不是同一机制**。  
- **Mission Board（P0）**（[ADR-016](docs/adr/016-mission-board.md)）：结构化 Fact / Intent / Hint；`board_read` / `board_complete` + Side Panel `BoardPanel`。  
- 用户指南：[multi-agent-user-guide](docs/multi-agent-user-guide.md)；任务包交叉见 [mission-pack-usage §10](docs/mission-pack-usage.md#10-multi-agent编排-worker与任务包)。

---

### 文件上传

Agent 可通过浏览器工具向页面 **file input** 提交本地文件（CDP `DOM.setFileInputFiles` 路径），覆盖常见网页上传框。

- **聊天附件**：Side Panel 支持上传 PDF / Office / 文本等，解析后进入对话上下文（扫描件 PDF 依赖 `canvas` 原生模块，缺失时优雅降级提示）。  
- **页面上传**：指令如「把这份文件上传到表单」时，Agent 定位 input 并挂载路径。  
- **NotebookLM 等场景**：导入管线也会复用文件/下载路径，见 [ADR-011](docs/adr/011-notebooklm-import.md)。

路径与权限仍受本机沙箱与安全确认策略约束；勿对不可信站点自动上传敏感文件。

---

## 配置说明

### Companion 配置目录

Companion 的数据存储在用户主目录下的 `~/.cmspark-agent/`：

```
~/.cmspark-agent/
├── config.json              # LLM / MCP / modules / capability_profile 等
├── .paired                  # 扩展已配对标记（托盘停止自动弹配对码）
├── skills/                  # 用户自定义技能
├── builtin-skills/          # 内置技能（含 security/ 等）
├── knowledge/               # 知识文档（注入 System Prompt）
│   ├── global/              # 全局 / 未绑定域名
│   └── sites/               # 站点知识（site_knowledge）
├── packs/                   # 已安装 Mission Pack（若有）
├── threads/                 # 线程数据（消息历史 + workspace_root 等）
├── history.db               # 操作历史（SQLite）
├── obsidian/                # vault 档案 / 索引 / 模板缓存（mode 0o600）
├── cache/                   # 运行时缓存
└── logs/                    # 运行日志（含 capability-audit.jsonl）
```

### Cookie 信任域

在设置面板中配置信任域，Agent 才能安全读取对应域名的 Cookie：

```
*.company.com        # 匹配所有子域名
sso.example.com      # 精确匹配单域名
```

未配置信任域时，Agent 对 Cookie 的读取和操作会被安全策略阻断。

---

## 后台常驻服务（跨平台）

CMspark 支持将 Companion 注册为系统后台服务，实现开机自启、崩溃恢复和菜单栏/托盘管理。

| 平台 | 服务机制 | 菜单栏/托盘 | 安装命令 |
|------|----------|-------------|----------|
| **macOS** | `launchd` | **Swift NSStatusBar** 原生托盘 + 配对码窗口；通知走系统通知 | `make install-macos` |
| **Windows** | 任务计划程序 | 系统托盘 (systray2) | `make install-windows` |
| **Linux** | `systemd --user` | 系统托盘 (systray2，需 GTK)；systray2 启动抛错（如二进制缺失 ENOENT）时 menu-bar 的 tryOrder 自动降级 readline 终端菜单（用户无显式选择入口）；GTK 缺失/headless 崩溃则走 3s 自重启而非降级 | `make install-linux` |

### 特性

- **开机自启**：登录后自动启动 Companion 守护进程
- **崩溃恢复**：平台原生机制自动重启异常退出的进程
- **状态检测**：🟢/🔴 实时状态显示，一键启停 Companion
- **通知提醒**：Companion 状态变化时推送桌面通知
- **菜单栏快速操作**：右键托盘图标即可执行常用功能
- **托盘生命周期**：启动托盘时**自动拉起** Companion 守护进程（无需再点「启动 Companion」）；**退出托盘会停止 Companion**（不再留下后台孤儿进程）。菜单仍保留「停止 / 重启」供调试
  - ⚙️ **设置** — 交互式修改 LLM 配置（API Key、模型、温度等）
  - 📸 **截图并分析** — 截取当前页面并自动打开
  - 📖 **读取当前页面** — 获取页面文本内容摘要
  - 📝 **提取页面数据** — 提取主要内容区域（article/main）
  - 📋 **总结页面** — 通过 LLM 一句话总结页面内容
  - 💬 **新建对话** — 快速创建新线程
  - 🔑 **显示配对码** — 展示 WebSocket 配对密钥（macOS 原生窗口；扩展首次连接前可自动弹一次）
- **向后兼容**：仍可直接运行 `cmspark-agent start` 作为前台进程

---

### macOS

#### 安装

```bash
make install-macos
```

安装内容：
1. `launchd plist` → `~/Library/LaunchAgents/com.cmspark.companion.plist`
2. "CMspark Agent.app" → `~/Applications/`（隐藏 Dock 图标）
3. 数据目录 `~/.cmspark-agent/`（权限 `0700`）

#### 启动菜单栏代理

```bash
make menu-bar
# 或双击 ~/Applications/CMspark Agent.app
```

macOS 托盘为 **Swift NSStatusBar** 原生实现（`companion/src/tray/Tray.swift`，经 `swift-tray-bridge` 启动）：

- 状态色点 + 右键菜单（启停 Companion、设置、快捷操作）
- **配对码窗口**：扩展尚未配对时（`~/.cmspark-agent/.paired` 不存在）可自动弹一次；菜单项「🔑 显示配对码」可随时重显；支持复制密钥 / 复制并打开 Chrome 扩展页
- 密钥仅经 launcher → Swift stdin 管道传递，不落日志

#### 常用命令

```bash
launchctl start com.cmspark.companion    # 启动服务
launchctl stop com.cmspark.companion     # 停止服务
launchctl list | grep cmspark            # 查看状态
make daemon-status                       # 守护进程状态
make uninstall-macos                     # 卸载
```

---

### Windows

#### 编译（生成独立 exe）

在 Windows 上构建可分发的 `cmspark-agent.exe`（用户无需安装 Node.js）：

```bat
build-package.bat
```

或直接调用 PowerShell 脚本：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\build-windows-exe.ps1

# 依赖已安装时可跳过 npm install，加快构建
powershell -ExecutionPolicy Bypass -File scripts\build-windows-exe.ps1 -SkipInstall
```

构建产物：

```text
dist-package\cmspark-windows-x64\        ← 便携包（解压即用）
  cmspark-agent.exe                      ← 独立可执行文件（双击启动托盘）
  bin\cmspark-whisper-win-x64.exe        ← 本机听写组件（可选；见下）
  sql-wasm.wasm
  assets\                                ← 托盘图标 + whisper-models.manifest.json
  builtin-skills\
  host-scripts-win\
  node_modules\systray2\                 ← 系统托盘支持
  launch-hidden.vbs / launch.bat
dist-package\CMspark-v*-windows-x64.zip  ← SEA 便携压缩包（非 GitHub Release 默认）
```

官方安装向导 `CMspark-Setup-v*.exe` **不是**本脚本产物，见下方「打包分发」。

#### 本机听写组件（Path B / cmspark-whisper）

**不能**把 whisper 打进 Node SEA 的 `cmspark-agent.exe` 内部；设计是 **sidecar**：

| 位置 | 作用 |
|------|------|
| `cmspark-agent.exe` | Companion 主进程（JS SEA） |
| `bin\cmspark-whisper-win-x64.exe` | whisper.cpp CLI，子进程推理 |
| `~/.cmspark-agent/models/whisper/` | 用户下载的 ggml 权重（不进 zip） |

**自动拉取（推荐）**：`build-package.bat` / `build-windows-exe.ps1` 若未找到本地二进制，会按  
`companion/assets/whisper-binary.manifest.json`（HTTPS + sha256）自动下载 whisper.cpp 官方 zip，解压并命名为 `cmspark-whisper-win-x64.exe` + DLL。  
- 关闭：`set CMSPARK_WHISPER_AUTO_FETCH=0`  
- 手动：`node companion/scripts/fetch-whisper-binary.mjs --arch win-x64 --dest companion/dist/bin`

仍可手工放置：

```bat
mkdir companion\dist\bin 2>nul
copy /Y path\to\whisper-cli.exe companion\dist\bin\cmspark-whisper-win-x64.exe
:: 以及 whisper.dll / ggml*.dll 同目录
build-package.bat
```

运行时：设置页「本机组件：未找到」→ **下载本机听写组件**（写入 `%USERPROFILE%\.cmspark-agent\bin\whisper\win-x64\`）。

验证：包内 `dist-package\cmspark-windows-x64\bin\cmspark-whisper-win-x64.exe` 或设置页「本机组件：已就绪」。

> 本地 SEA 构建仅要求本机有 Node.js ≥ 22。官方 Setup.exe 由 `make package-windows` / CI `package.sh` 在安装 [NSIS](https://nsis.sourceforge.io/) 后生成。

#### 安装（注册后台服务）

```powershell
# 以普通用户身份在 PowerShell 中运行
make install-windows
```

或使用 PowerShell 直接运行：
```powershell
powershell -ExecutionPolicy Bypass -File scripts/install-daemon.ps1
```

安装内容：
1. 注册 Windows 任务计划程序（用户登录时启动）
2. 开始菜单快捷方式 → `CMspark Agent`
3. 数据目录 `%USERPROFILE%\.cmspark-agent\`

#### 常用命令

```powershell
Start-ScheduledTask -TaskName cmspark-companion    # 启动服务
Stop-ScheduledTask  -TaskName cmspark-companion    # 停止服务
Get-ScheduledTask   -TaskName cmspark-companion    # 查看状态
make uninstall-windows                             # 卸载
```

---

### Linux

#### 安装

```bash
make install-linux
```

安装内容：
1. `systemd user unit` → `~/.config/systemd/user/cmspark-companion.service`
2. 数据目录 `~/.cmspark-agent/`（权限 `0700`）

#### 启动菜单栏代理

```bash
cd companion && npm run menu-bar
```

#### 常用命令

```bash
systemctl --user start   cmspark-companion    # 启动服务
systemctl --user stop    cmspark-companion    # 停止服务
systemctl --user status  cmspark-companion    # 查看状态
journalctl --user -u     cmspark-companion    # 查看日志
make uninstall-linux                          # 卸载
```

#### Linux 功能缺口总表

Companion daemon 核心（systemd 服务、WebSocket、工具执行）在 Linux 上是完整实现且有 CI 全量测试背书；但桌面层存在以下已知缺口（依据 `.omx/artifacts/platform-audit-20260906/audit.md` §5）：

| 功能 | Linux 状态 | 说明 |
|------|-----------|------|
| 本机 Whisper STT | ❌ 不可用（fail-closed） | 无 linux-x64 pin、manifest 无下载条目，生产模式拒用未 pin 二进制；仅剩云端链路或 dev 逃生门 `CMSPARK_WHISPER_UNPINNED=1` |
| 系统语音引擎 | ❌ 不可用 | `voice.system.state` 返回 `not_win32`（仅 Windows SAPI） |
| host-use（host_read/host_write） | ❌ 不可用 | linux adapter 为 Phase 0 stub，直接抛 `NotImplementedOnPlatform` |
| computer-use（host_computer） | ❌ 硬门拒绝 | 返回 `host_computer requires macOS or Windows`（诚实报错，非静默失败） |
| 托盘原生确认 | ❌ 不可用 | systray2 `showConfirmDialog()` 永不 resolve；高危确认须开 Chrome 确认台（45s 超时兜底） |
| 召唤器（Summoner） | ⚠️ 仅 HTML shell | 无原生 overlay、无全局热键（热键仅 macOS Swift 侧实现），走托盘菜单触发 |
| 生物识别门 | ⚠️ 仅 manual-nonce | 无 TouchID/Windows Hello 等价物，persistent 授权每次手输 nonce |
| 分发形态 | ⚠️ 仅 zip | 无 AppImage/deb/snap；zip 内容断言见 release.yml（#379 起补齐 ORT napi / qwen worker / systray2 binary 检查） |

Diarize（会议说话人）依赖的 ORT napi 二进制会打入 linux zip，但代码无平台门且无任何 Linux 实测/CI 验证，状态为「未验证」。

---

### 跨平台通用命令

```bash
# 查看守护进程状态（全平台）
make daemon-status

# 查看 Companion 日志
cd companion && npm run daemon:logs

# 菜单栏代理
cd companion && npm run menu-bar

# LLM 设置（交互式 / 非交互式）
cmspark-agent settings
cmspark-agent settings --set api_key=sk-xxxxx --set model_name=gpt-4
```

### 安全说明

- **数据目录权限**：`~/.cmspark-agent/` 权限强制为 `0700`，防止其他用户读取配置和日志
- **进程锁**：
  - macOS/Linux：Unix Domain Socket 锁替代 PID 文件，消除 TOCTOU 竞态条件
  - Windows：命名管道（`\\?\pipe\cmspark-agent-lock`）
- **WebSocket 绑定**：始终绑定 `127.0.0.1:23401`，禁止远程访问
- **配置文件完整性**：安装时生成 SHA256 校验和
- **权限最小化**：守护进程以当前用户身份运行，不请求 root / 管理员权限
- **系统托盘二进制完整性（systray2）**：
  - systray2 npm 包包含预编译的 Go 二进制文件（macOS/Linux/Windows）
  - 项目通过 `scripts/verify-systray2.js` 对二进制进行 SHA256 校验
  - CI 构建时自动校验（`.github/workflows/ci.yml`）
  - `npm install` 后自动运行校验（`postinstall` 钩子）
  - 已知哈希值记录在 `scripts/systray2-sha256.json` 中，受 Git 版本控制保护
  - **升级 systray2 时**：必须更新 `scripts/systray2-sha256.json` 中的哈希值，详见 CONTRIBUTING.md

### 故障排查

| 问题 | 解决方案 |
|------|---------|
| 菜单栏代理显示 🔴 但 Companion 实际在运行 | 等待 3 秒轮询周期；检查 `make daemon-status` |
| 通知不显示 | 检查系统通知权限；尝试前台运行 `make menu-bar` |
| 开机自启未生效 | macOS: `launchctl list \| grep cmspark`；Windows: `Get-ScheduledTask`；Linux: `systemctl --user is-enabled` |
| 守护进程反复崩溃 | 查看平台日志（macOS: `logs/stderr.log`；Linux: `journalctl`；Windows: Event Viewer） |
| 端口 23401 被占用 | macOS/Linux: `pkill -f "dist/index.js"`；Windows: `taskkill /F /IM cmspark-agent.exe` 或托盘菜单“停止 Companion” |

---

## 开发

### 开发命令

```bash
# 一键启动开发环境（companion + extension 并行）
make dev

# 运行测试
make test

# 构建所有
make build

# 清理构建产物
make clean

# 打包分发版本
make package
```

### 打包分发

项目支持将 Companion、Chrome 扩展、Node.js 运行时和平台原生依赖打包为独立的可执行分发包，无需用户预先安装 Node.js。

| 平台 | 命令 | 产物 | 说明 |
|------|------|------|------|
| **macOS (ARM64)** | `make package-macos` | `dist-package/CMspark-v*-macOS.dmg` | 含 Swift 托盘 + 嵌入 Node 运行时 |
| **Windows (x64)** | `make package-windows` / CI `package.sh` | `dist-package/cmspark-v*-windows-x64.zip` + `CMspark-Setup-v*.exe` | **官方发布 SoT**：`scripts/package.sh` 打 zip（`node.exe` + `cmspark-agent.js` + 扩展）；NSIS 安装器包**同一份** staging。CI 缺 `makensis` 则失败，不静默只发 zip |
| **Windows SEA（可选）** | `scripts/build-windows-exe.ps1` / `build-package.bat` | `cmspark-agent.exe` + `CMspark-v*-windows-x64.zip` | 本地/进阶单 exe；**不**生成官方 `CMspark-Setup-v*.exe` |
| **Linux (x64)** | `make package-linux` | `dist-package/cmspark-v*-linux-x64.zip` | 嵌入 Node 运行时的压缩包 |
| **当前平台** | `make package` | `dist-package/cmspark-v*-<platform>.zip` | 自动检测平台 |

**Windows 产物 Source of Truth（2026-08 诊断对齐）**

| 路径 | 谁生产 | 是否 GitHub Release 默认 |
|------|--------|--------------------------|
| `scripts/package.sh windows-x64`（`make package-windows` / CI release） | zip `cmspark-v*-windows-x64.zip`（`node.exe` + `cmspark-agent.js`）+ `CMspark-Setup-v*.exe` | **是** — 官方发布物 |
| `scripts/build-windows-exe.ps1` / `build-package.bat`（可选 SEA 步骤） | 额外 `cmspark-agent.exe`（Node SEA）+ `CMspark-v*-windows-x64.zip` | **否** — 本地/进阶单 exe 形态 |

文档与脚本不得再暗示「Release 只发 SEA exe」；CI 以 `package.sh` 为准。SEA 适合本机免解压试用，但 Whisper 等 sidecar 仍须旁路放置。

**macOS DMG 示例**：

```bash
make package-macos
# 产出：
#   dist-package/CMspark-v0.6.0-macOS.dmg   ← 安装包
#   dist-package/cmspark-v0.6.0-macos-arm64.zip  ← 原始压缩包
```

Windows 打包流程（**官方 zip + Setup.exe / package.sh**）：
1. TypeScript 编译 → `esbuild` bundle 为 `cmspark-agent.js`（`systray2` 等运行时依赖保持 external）
2. 暂存 `node.exe` + bundle + Chrome 扩展 + 内置技能 + `sql-wasm.wasm` + 平台脚本
3. 压缩为 `cmspark-v*-windows-x64.zip`（CI / `make package-windows`）
4. `scripts/build-windows-installer.sh` 用 NSIS 包同一 staging → `CMspark-Setup-v*.exe`（CI `CMSPARK_REQUIRE_NSIS=1`）

Windows **可选 SEA**（`build-windows-exe.ps1`）：
1. 将 bundle 注入 `node.exe` 副本 → `cmspark-agent.exe`
2. 修改 PE 子系统（CONSOLE → WINDOWS GUI），避免双击时弹出 CMD 窗口
3. 可与 zip 并存；**不**替代官方 `package.sh` 产物

macOS 打包流程：
1. TypeScript 编译 + Swift 托盘编译
2. esbuild bundle + 复制 Node.js 运行时、原生依赖
3. 压缩为 zip，额外生成 DMG 安装包

**Windows 前提**：本机 Node.js ≥ 22。官方 Setup.exe 需要 [NSIS](https://nsis.sourceforge.io/)（CI 钉死 Chocolatey `nsis` 3.12.0）；本机未装则 `package.sh` 跳过安装器并警告，zip 仍可用。

### 分别启动

```bash
# Terminal 1: Companion 开发模式
cd companion && npm run dev

# Terminal 2: Extension 开发模式
cd chrome-extension && npm run dev
```

### 运行测试

```bash
# Companion 测试
npm --prefix companion test

# Extension 测试
npm --prefix chrome-extension test
```

---

## 项目结构

```
cmspark/
├── chrome-extension/          # Chrome 扩展 (Plasmo + React)
│   ├── src/
│   │   ├── sidepanel/         # Side Panel UI
│   │   │   ├── App.tsx        # 根组件
│   │   │   └── components/    # 聊天、线程、工具卡片等
│   │   ├── background/        # Service Worker
│   │   │   ├── browser-bridge.ts   # CDP/浏览器操作
│   │   │   └── ws-client.ts        # WebSocket 客户端
│   │   └── popup/             # 弹窗页面（连接状态）
│   ├── assets/                # 图标等资源
│   └── package.json
│
├── companion/                  # 本地 Agent 服务 (Node.js + TS)
│   ├── src/
│   │   ├── index.ts           # CLI 入口
│   │   ├── server.ts          # WebSocket 服务器
│   │   ├── llm/               # LLM 适配器、Streaming、Tool Calling
│   │   ├── bridge/            # 工具定义与调度
│   │   ├── skills/            # 技能引擎
│   │   ├── threads/           # 线程管理
│   │   ├── history/           # 操作历史存储
│   │   └── security.ts        # 安全策略
│   ├── builtin-skills/        # 内置技能
│   └── package.json
│
├── docs/                       # 项目文档（导航见 docs/README.md）
│   ├── README.md               # 文档索引：用户 / 架构 / ADR / 工程 / 进行中
│   ├── architecture.md         # 架构文档
│   ├── GOAL.md                 # 项目目标
│   ├── mcp.md · mission-pack-usage.md · confirm-center-user-guide.md
│   ├── adr/                    # 架构决策记录 001–018…
│   └── …                       # superpowers/、decisions/、audit/ 等（见 docs/README）
│
├── scripts/
│   ├── build-windows-exe.ps1   # Windows exe 构建脚本（Node.js SEA）
│   ├── installer.nsi           # NSIS 官方安装器（package.sh / CI）
│   ├── build-windows-installer.sh  # 官方 CMspark-Setup-v*.exe 生产者
│   └── ...                     # 其他平台脚本
├── Makefile                    # 常用命令
└── README.md                   # 本文件
```

---

## 常见问题

| 问题 | 解决方案 |
|------|---------|
| 扩展加载后 Side Panel 空白 | 确认已执行 `npm run build`，并检查 `chrome-extension/build/chrome-mv3-prod/` 存在 |
| Companion 连接失败 | 检查 `cmspark-agent` 是否已启动，端口 `23401` 是否被占用 |
| 端口被占用 | 执行 `pkill -f "dist/index.js"` 后重启 Companion |
| `config.json` 损坏 | 删除 `~/.cmspark-agent/config.json` 后重启 Companion |
| LLM 返回 "No tab with id" | LLM 幻觉了不存在的 tabId，属于可恢复错误，Agent 会自动调用 `list_tabs` 重试 |
| evaluate 等高危操作被阻断 | **已交付 L2 确认**：`evaluate` / `osascript_eval` 等强制走 `SecurityConfirmationManager`（约 45s 超时）→ Side Panel / **Confirm Center（Cockpit）** 人机确认；批准后颁发 HMAC `security_token` 才执行。可将域名加入 `auto_approved_domains` 跳过重复确认，或（无人值守）打开全局 `security.auto_approve_dangerous`。详见 [confirm-center-user-guide](docs/confirm-center-user-guide.md) |

---

## 技术栈

| 层 | 技术 |
|----|------|
| Extension 构建 | [Plasmo](https://www.plasmo.com/) |
| Side Panel UI | React 18 |
| Service Worker | TypeScript (Manifest V3) |
| Companion | Node.js + TypeScript |
| 通信协议 | WebSocket (`ws` 库) |
| LLM 适配 | OpenAI SDK (兼容任意 OpenAI-compatible 服务) |
| 数据库 | sql.js (SQLite) |
| Skill 格式 | Markdown + YAML frontmatter |

---

## 相关文档

完整分类导航见 **[`docs/README.md`](docs/README.md)**。常用入口：

| 类别 | 文档 |
|------|------|
| **用户** | [PRODUCT.md](PRODUCT.md) · [召唤器](docs/summoner-user-guide.md) · [confirm-center](docs/confirm-center-user-guide.md) · [mcp.md](docs/mcp.md) · [mission-pack-usage](docs/mission-pack-usage.md) · [meeting-and-dictation](docs/meeting-and-dictation-user-guide.md) · [computer-use](docs/computer-use-user-guide.md) · [host-and-apps](docs/host-and-apps.md) · [notebooklm](docs/notebooklm-user-guide.md) · [multi-agent](docs/multi-agent-user-guide.md) · [coding-handoff](docs/coding-handoff-user-guide.md) · [TROUBLESHOOTING](docs/TROUBLESHOOTING.md) |
| **架构 / 目标** | [architecture.md](docs/architecture.md) · [GOAL.md](docs/GOAL.md) · [DESIGN.md](docs/DESIGN.md) · **[ADR-020 能力三轴](docs/adr/020-capability-model-three-axes.md)** |
| **ADR** | [docs/adr/](docs/adr/)（至 **025**；语音 023–024，能力三轴 020，Outbound MCP 022，ACP 编程接力 025） |
| **工程** | [TESTING.md](docs/TESTING.md) · [supply-chain.md](docs/supply-chain.md) · [CONTRIBUTING.md](CONTRIBUTING.md) |
| **过程稿（非规范）** | [decisions/](docs/decisions/)（CU/host 长文等；现行见用户指南 + ADR-017/018） |
| **Agent 上下文** | [CLAUDE.md](CLAUDE.md) · [Agents.md](Agents.md) |

---

> **当前阶段（0.6.0）**：家 = **已登录 Chrome + 硬闸**（[PRODUCT.md](PRODUCT.md)）。召唤器 HTML **流式出字** · Whisper 自动激活/当次会话回退横幅/HF 镜像 · 会议说话人「自动」档。**听写+ / 会议 / 本机 Whisper** 已交付；**对话框可粘贴/点选/拖入图片**；**Windows 官方 NSIS Setup.exe**；**知识 CRUD 诚实**（AI 草稿 / 检索打分 / 分布视图 / 多级文件夹 / sha256 去重）；**侧栏 UI 重构 + 巡航档位/plan_readonly/无人值守 loop 三件套 + 专家团队 v1 + CU 完整性链**（0.6.0 主题，值守默认关）；**租手钥匙 CLI + L8**；ChatShell 空态 + **弹出对话框**；技能 TF-IDF + 当轮活计划（页面工具前必须 propose；成功后才挂卡；放弃/纯问答则无卡）。**不是**召唤器/租手完成切点——T1 已记分（CMspark 臂 Y / Playwright 打不开门户），**禁扩**默认 outbound profile（[#228](https://github.com/nehcuh/cmspark/issues/228) 已关）。CU 实验定位仅 **Qwen3-VL**。能力按 **[ADR-020](docs/adr/020-capability-model-three-axes.md)** 三轴组织。文档导航：[`docs/README.md`](docs/README.md) · [architecture.md](docs/architecture.md)。

# CMspark Browser Agent

> 浏览器内的 AI Agent — 用自然语言驱动浏览器，完成网页操作、数据提取、跨系统任务等自动化工作。

---

## 项目简介

CMspark Browser Agent 是一套浏览器自动化 Agent 系统，通过 Chrome 侧边栏（Side Panel）与用户交互，借助 Chrome DevTools Protocol (CDP) 操控浏览器，并通过本地 Companion 进程管理 LLM 调用、对话状态和技能系统。

### 核心能力

| 能力 | 说明 |
|------|------|
| 🌐 **浏览器操控** | 标签页管理、页面读取、元素交互、表单填写、截图、文件上传/下载等 23 种工具 |
| 💬 **自然语言驱动** | 输入指令即可让 Agent 自动分析页面、执行操作、汇总结果 |
| 🧵 **多线程隔离** | 多条对话线程并行，消息历史和 LLM 配置相互独立 |
| 🍪 **Cookie/SSO 管理** | 信任域配置下安全读取 Cookie，支持跨系统免登录操作 |
| 🛠️ **技能系统** | 将常用操作流程保存为可复用的 Skill（Markdown + YAML 格式） |
| 📝 **操作历史** | 全量 tool-call 记录，支持按线程分组、搜索和导出 |

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

---

## 目录

- [项目简介](#项目简介)
- [安装](#安装)
- [使用指南](#使用指南)
  - [快速开始](#快速开始)
  - [浏览器操作示例](#浏览器操作示例)
  - [多线程使用](#多线程使用)
  - [技能系统](#技能系统)
- [配置说明](#配置说明)
- [开发](#开发)
- [项目结构](#项目结构)
- [常见问题](#常见问题)
- [技术栈](#技术栈)

---

## 安装

### 环境要求

- **Node.js** ≥ 18（推荐使用 `nvm` 管理）
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
| `model_name` | 模型名称 | `deepseek-chat` |
| `temperature` | 温度参数 | `0.7` |
| `context_window` | 上下文窗口大小 | `64000` |

---

## 使用指南

### 快速开始

1. **打开 Side Panel**：点击浏览器工具栏上的 CMspark 图标，或从 Chrome 菜单 → 更多工具 → 打开 Side Panel
2. **创建线程**：在侧边栏中输入你的任务，Agent 会自动创建新线程
3. **固定标签页**（可选）：在底部 Tab 栏勾选你希望 Agent 操作的标签页
4. **输入指令**：用自然语言描述你想完成的任务
5. **查看结果**：Agent 会实时展示操作步骤和最终结果

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

### 技能系统

Skill 是可复用的操作流程模板，格式为 Markdown + YAML frontmatter。

**使用内置 Skill**：
```
输入: "/browse https://example.com"
→ 自动加载 browse skill，执行页面读取和摘要
```

**创建自定义 Skill**：
1. 让 Agent 执行一次完整操作
2. 说"把刚才的操作保存为 skill"
3. Agent 会自动分析操作序列，提取参数，生成 skill 文件
4. 在 Skills 面板中预览、编辑后保存

**导入/导出 Skill**：
- 导出：Skills 面板 → 选择 skill → 导出为 `.md` 文件
- 导入：Skills 面板 → 输入本地路径 → 导入文件夹或单个文件

---

## 配置说明

### Companion 配置目录

Companion 的数据存储在用户主目录下的 `~/.cmspark-agent/`：

```
~/.cmspark-agent/
├── config.json          # LLM 全局配置
├── skills/              # 用户自定义技能
├── builtin-skills/      # 内置技能
├── threads/             # 线程数据（消息历史）
├── history.db           # 操作历史（SQLite）
└── logs/                # 运行日志
```

### Cookie 信任域

在设置面板中配置信任域，Agent 才能安全读取对应域名的 Cookie：

```
*.company.com        # 匹配所有子域名
sso.example.com      # 精确匹配单域名
```

未配置信任域时，Agent 对 Cookie 的读取和操作会被安全策略阻断。

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
├── docs/                       # 项目文档
│   ├── architecture.md         # 架构文档
│   ├── GOAL.md                 # 项目目标
│   └── requirements/           # 需求文档
│
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
| evaluate 等高危操作被阻断 | 当前阶段安全策略默认阻断高危 JS 执行，等待用户确认机制完成后开放 |

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

- [`docs/architecture.md`](docs/architecture.md) — 完整架构文档
- [`docs/GOAL.md`](docs/GOAL.md) — 项目目标与阶段规划
- [`docs/DESIGN.md`](docs/DESIGN.md) — 设计系统规范
- [`CLAUDE.md`](CLAUDE.md) — 项目级上下文与快速参考
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — 贡献指南

---

> **当前阶段**：安全稳定化 MVP — Side Panel 可靠驱动 Companion 和浏览器，线程状态闭环持久化，tool 调用结果进入后续 LLM 上下文，高风险执行默认阻断。

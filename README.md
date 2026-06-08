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

## 后台常驻服务（跨平台）

CMspark 支持将 Companion 注册为系统后台服务，实现开机自启、崩溃恢复和菜单栏/托盘管理。

| 平台 | 服务机制 | 菜单栏/托盘 | 安装命令 |
|------|----------|-------------|----------|
| **macOS** | `launchd` | node-notifier 通知 + readline 菜单 | `make install-macos` |
| **Windows** | 任务计划程序 | 系统托盘（计划中） | `make install-windows` |
| **Linux** | `systemd --user` | node-notifier + readline 菜单 | `make install-linux` |

### 特性

- **开机自启**：登录后自动启动 Companion 守护进程
- **崩溃恢复**：平台原生机制自动重启异常退出的进程
- **状态检测**：🟢/🔴 实时状态显示，一键启停 Companion
- **通知提醒**：Companion 状态变化时推送桌面通知
- **菜单栏快速操作**：右键托盘图标即可执行常用功能
  - ⚙️ **设置** — 交互式修改 LLM 配置（API Key、模型、温度等）
  - 📸 **截图并分析** — 截取当前页面并自动打开
  - 📖 **读取当前页面** — 获取页面文本内容摘要
  - 📝 **提取页面数据** — 提取主要内容区域（article/main）
  - 📋 **总结页面** — 通过 LLM 一句话总结页面内容
  - 💬 **新建对话** — 快速创建新线程
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

#### 安装

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
| 端口 23401 被占用 | 执行 `pkill -f "dist/index.js"` 或对应平台的 stop 命令 |

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
| **Windows (x64)** | `make package-windows` | `dist-package/CMspark-Setup-v*.exe` | NSIS 安装包 |
| **Linux (x64)** | `make package-linux` | `dist-package/cmspark-v*-linux-x64.zip` | 嵌入 Node 运行时的压缩包 |
| **当前平台** | `make package` | `dist-package/cmspark-v*-<platform>.zip` | 自动检测平台 |

**macOS DMG 示例**：

```bash
make package-macos
# 产出：
#   dist-package/CMspark-v0.2.0-macOS.dmg   ← 安装包
#   dist-package/cmspark-v0.2.0-macos-arm64.zip  ← 原始压缩包
```

打包流程：
1. `esbuild` 将 Companion 源码 bundle 为单文件 `cmspark-agent.js`
2. 下载对应平台的官方 Node.js 运行时二进制（约 45MB → 105MB）
3. 复制 Chrome 扩展、内置技能、原生依赖（systray2 / node-notifier）
4. 平台定制：剥离非目标二进制、添加启动脚本
5. 压缩为 zip，macOS 额外生成 DMG 安装包

**Windows EXE 前提**：需要安装 `makensis`（`brew install makensis` 或 [NSIS 官网](https://nsis.sourceforge.io/)）。

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

# CMspark 后台常驻菜单栏服务 — 保守方案架构设计

> 版本: v1.0
> 日期: 2026-06-07
> 目标平台: macOS (darwin) 为主
> 核心原则: 最小改动、复用现有代码、不引入 Electron/Tauri/Swift 等新技术栈

---

## 1. 架构图（文字描述）

### 1.1 整体架构

```
+------------------------------------------------------------------+
|                          macOS 用户空间                           |
|                                                                  |
|  +-------------------+        +-----------------------------+    |
|  |  launchd (系统)    |        |  CMspark Menu Bar Agent      |    |
|  |  ├─ 开机自启加载   |        |  (Node.js + node-notifier)   |    |
|  |  ├─ 崩溃自动重启   |        |  ├─ 菜单栏图标 (🟢/🔴)        |    |
|  |  ├─ 日志轮转       |        |  ├─ 点击菜单: 启动/停止/状态   |    |
|  |  └─ 守护进程管理   |        |  ├─ 点击菜单: 打开 Side Panel  |    |
|  +--------+----------+        |  └─ 点击菜单: 打开日志目录     |    |
|           |                   +-------------+---------------+    |
|           | 启动/监控                       |  WebSocket 状态轮询 |
|           v                                 v                    |
|  +-------------------+        +-----------------------------+    |
|  |  cmspark-agent     |<---->|  Chrome Extension            |    |
|  |  (Node.js daemon)  |  WS  |  (Plasmo + React Side Panel) |    |
|  |  ├─ ws://127.0.0.1| ws://|  ├─ 320px Side Panel UI      |    |
|  |  |   :23401       |:23401|  ├─ CDP 操控浏览器            |    |
|  |  ├─ LLM streaming  |      |  └─ 工具执行结果回传          |    |
|  |  ├─ tool_call 桥接 |      +-----------------------------+    |
|  |  ├─ SQLite 历史    |                                         |
|  |  └─ skill 引擎     |                                         |
|  +-------------------+                                         |
|                                                                  |
|  数据目录: ~/.cmspark-agent/                                     |
|  ├─ config.json      (配置)                                      |
|  ├─ logs/            (日志)                                      |
|  ├─ threads/         (线程状态)                                   |
|  ├─ skills/          (用户技能)                                   |
|  └─ builtin-skills/  (内置技能)                                   |
|                                                                  |
+------------------------------------------------------------------+
```

### 1.2 启动流程

```
用户点击菜单栏图标
        │
        ▼
┌─────────────────┐
│ 显示下拉菜单     │
│ - 启动 Companion │
│ - 停止 Companion │
│ - 查看状态       │
│ - 打开 Side Panel│
│ - 打开日志目录   │
│ - 退出菜单栏代理 │
└────────┬────────┘
         │
    选择"启动"
         │
         ▼
┌──────────────────────────────┐
│ launchctl load ~/Library/    │
│   LaunchAgents/com.cmspark.  │
│   companion.plist            │
└────────┬─────────────────────┘
         │
         ▼
┌──────────────────────────────┐
│ launchd 启动 cmspark-agent   │
│ daemon start --daemonize     │
└────────┬─────────────────────┘
         │
         ▼
┌──────────────────────────────┐
│ cmspark-agent 进程启动        │
│ - 写入 PID 到 ~/.cmspark-    │
│   agent/daemon.pid           │
│ - 启动 WebSocket 服务器       │
│ - 等待 Chrome Extension 连接  │
└──────────────────────────────┘
```

### 1.3 数据流

```
Chrome Extension Side Panel
         │
         │ 1. 用户输入
         ▼
┌─────────────────┐
│ WebSocket Client │
└────────┬────────┘
         │ 2. WS message
         ▼
┌──────────────────────────────┐
│ cmspark-agent (daemon)       │
│ ├─ message-router.ts         │
│ ├─ llm/adapter.ts            │
│ │   └─ 3. LLM streaming      │
│ ├─ tool_call 生成             │
│ │   └─ 4. 发送 tool.execute  │
│ └─ 等待 tool.result          │
└────────┬─────────────────────┘
         │ 5. WS message (tool.execute)
         ▼
┌──────────────────────────────┐
│ Chrome Extension Background  │
│ ├─ CDP 执行浏览器操作         │
│ │   └─ 6. 浏览器 DOM/CDP     │
│ └─ 收集结果                  │
└────────┬─────────────────────┘
         │ 7. WS message (tool.result)
         ▼
┌──────────────────────────────┐
│ cmspark-agent (daemon)       │
│ ├─ 8. 结果注入 LLM 上下文     │
│ └─ 9. 继续 streaming         │
└────────┬─────────────────────┘
         │ 10. WS response
         ▼
┌──────────────────────────────┐
│ Chrome Extension Side Panel  │
│ └─ 11. 渲染回复               │
└──────────────────────────────┘
```

---

## 2. 涉及的模块和改动点

### 2.1 Companion (Node.js) 改动

| 文件/模块 | 改动类型 | 改动内容 |
|-----------|----------|----------|
| `companion/src/index.ts` | 修改 | 扩展 CLI 命令解析：新增 `daemon` 子命令（`daemon start/stop/status/logs`），支持 `--daemonize` 标志（fork 到后台、脱离终端、写入 PID 文件） |
| `companion/src/daemon.ts` | **新增** | 守护进程管理模块：PID 文件读写 (`~/.cmspark-agent/daemon.pid`)、进程存活检测（`process.kill(pid, 0)`）、优雅关闭（SIGTERM）、日志重定向到文件 |
| `companion/src/server.ts` | 修改 | 在 `startServer()` 中增加 daemon 模式支持：启动时写入 PID 文件，关闭时清理 PID 文件；支持通过 Unix socket 或文件锁检测端口占用时的"已有实例"情况 |
| `companion/src/config.ts` | 修改 | `initDataDir()` 中新增创建 `logs/` 目录（已存在，确认）；新增获取 daemon 日志路径的辅助函数 |
| `companion/package.json` | 修改 | 新增依赖：`node-notifier`（菜单栏通知）、`pidusage`（可选，进程资源监控）；新增 scripts：`daemon:start`、`daemon:stop`、`daemon:status` |
| `companion/src/menu-bar-agent.ts` | **新增** | 菜单栏代理进程：使用 `node-notifier` 创建菜单栏图标和右键菜单，轮询 WebSocket 连接状态，提供启动/停止/状态/打开日志等菜单项 |

### 2.2 macOS 系统集成（新增文件）

| 文件/模块 | 改动类型 | 改动内容 |
|-----------|----------|----------|
| `scripts/launchd/com.cmspark.companion.plist` | **新增** | launchd plist 模板：定义 `Label=com.cmspark.companion`，`ProgramArguments` 指向 `cmspark-agent daemon start --daemonize`，`RunAtLoad=true`（开机自启），`KeepAlive=true`（崩溃重启），`StandardOutPath/StandardErrorPath` 指向 `~/.cmspark-agent/logs/` |
| `scripts/install-daemon.sh` | **新增** | 安装脚本：复制 plist 到 `~/Library/LaunchAgents/`，加载 launchd 服务，创建 Applications 目录下的 "CMspark Agent" 启动器（AppleScript 封装），设置开机自启 |
| `scripts/uninstall-daemon.sh` | **新增** | 卸载脚本：卸载 launchd 服务，删除 plist，删除 Applications 启动器，清理 PID 文件 |
| `scripts/CMspark\ Agent.app/` | **新增** | AppleScript 应用包：双击启动菜单栏代理进程（`cmspark-agent menu-bar`），显示在 Dock 中（可选隐藏），用户可将其放入 Applications 文件夹 |

### 2.3 Chrome Extension 改动（最小化）

| 文件/模块 | 改动类型 | 改动内容 |
|-----------|----------|----------|
| `chrome-extension/src/background/index.ts` | 修改 | 增加连接状态检测：当 WebSocket 断开时，通过 Chrome `notifications` API 显示 "Companion 未运行，请点击菜单栏图标启动" 提示 |
| `chrome-extension/package.json` | 修改 | manifest 中 `permissions` 已包含 `"notifications"`，无需改动 |
| `chrome-extension/src/sidepanel/index.tsx` | 修改 | 在连接断开状态下显示友好提示："Companion 守护进程未运行，请通过菜单栏启动"，并提供 "重试连接" 按钮 |

### 2.4 构建与分发

| 文件/模块 | 改动类型 | 改动内容 |
|-----------|----------|----------|
| `companion/package.json` | 修改 | `bin` 字段已定义 `cmspark-agent`，保持不变；确保 `files` 字段包含 `dist/`、`scripts/` |
| `package.json` (根目录) | 修改 | 新增根级别脚本：`install:macos` -> `cd companion && npm run build && ./scripts/install-daemon.sh` |
| `README.md` | 修改 | 新增"macOS 后台常驻"章节，说明安装/卸载/自启配置方法 |

---

## 3. 预估开发人天

| 分类 | 任务项 | 预估人天 | 说明 |
|------|--------|----------|------|
| **后端** | `daemon.ts` 守护进程管理模块 | 1.0 | PID 文件、进程检测、信号处理、日志重定向 |
| **后端** | 扩展 CLI (`index.ts`) 支持 `daemon` 子命令 | 0.5 | 命令解析、帮助信息、参数校验 |
| **后端** | `server.ts` 集成 PID 文件和实例检测 | 0.5 | 启动时写 PID，关闭时清理，端口占用时检测是否同进程 |
| **后端** | `menu-bar-agent.ts` 菜单栏代理 | 1.0 | node-notifier 集成、状态轮询、菜单项回调 |
| **后端** | launchd plist 模板 | 0.3 | 标准 plist 配置，路径参数化 |
| **打包** | `install-daemon.sh` / `uninstall-daemon.sh` | 0.5 | 安装、卸载、权限处理、Applications 启动器创建 |
| **打包** | AppleScript 启动器封装 | 0.3 | 简单的 `osascript` 或 `.app` 包，调用 CLI |
| **前端** | Extension 断开连接提示优化 | 0.3 | 状态检测、通知、UI 提示 |
| **测试** | 守护进程启动/停止/重启测试 | 0.5 | 多场景：端口占用、崩溃恢复、权限不足 |
| **测试** | launchd 集成测试 | 0.5 | 开机自启、日志轮转、内存泄漏观察 |
| **测试** | 菜单栏代理交互测试 | 0.3 | 菜单点击、状态更新、通知显示 |
| **文档** | 安装文档、用户指南、故障排查 | 0.5 | README 更新、TROUBLESHOOTING 补充 |
| **合计** | | **~5.7 人天** | 按 6 人天估算，约 1 个开发周 |

---

## 4. 潜在风险

### 4.1 安全风险

| 风险 | 严重程度 | 说明 | 缓解措施 |
|------|----------|------|----------|
| PID 文件竞态条件 | 中 | 多进程同时读写 `daemon.pid` 可能导致状态混乱 | 使用 `fs.openSync` + `O_EXCL` 原子创建；或改用 Unix Domain Socket 锁 |
| launchd 权限提升 | 低 | plist 若被篡改可能导致恶意代码以用户权限自启 | plist 安装时校验签名（未来）；安装脚本设置 `chmod 644`；不请求 root 权限 |
| 日志文件泄露敏感信息 | 中 | 日志目录 `~/.cmspark-agent/logs/` 权限默认 755，其他用户可读 | 安装脚本设置 `chmod 700 ~/.cmspark-agent`；日志中已做 API key 脱敏（现有机制） |
| 菜单栏代理被注入 | 低 | `node-notifier` 依赖的 `terminal-notifier` 二进制若被替换 | 锁定依赖版本；CI 中校验二进制 checksum |

### 4.2 性能风险

| 风险 | 严重程度 | 说明 | 缓解措施 |
|------|----------|------|----------|
| 空转资源消耗 | 低 | 守护进程无连接时仍占用内存 (~50-100MB Node.js) | 这是 Node.js 常态；未来可考虑空闲时降低轮询频率 |
| 菜单栏轮询开销 | 低 | 每秒轮询 WebSocket 状态产生少量 CPU/网络开销 | 轮询间隔设为 5 秒；或改用文件系统事件（PID 文件 mtime） |
| launchd 频繁重启 | 中 | 若进程持续崩溃，launchd `KeepAlive` 可能导致高频重启 | 配置 `ThrottleInterval=10`（两次启动最小间隔 10 秒）；连续崩溃 5 次后暂停 |

### 4.3 维护性风险

| 风险 | 严重程度 | 说明 | 缓解措施 |
|------|----------|------|----------|
| node-notifier 跨平台差异 | 中 | `node-notifier` 在 macOS 依赖 `terminal-notifier`，Linux/Windows 行为不同 | 本方案目标 macOS 为主；未来跨平台时替换为平台抽象层 |
| launchd 与 npm 全局安装路径耦合 | 低 | plist 中硬编码 `cmspark-agent` 路径，若 npm 全局安装路径变化会失效 | 安装脚本动态检测 `which cmspark-agent` 并写入 plist；或使用 `npx cmspark-agent` |
| AppleScript 启动器维护 | 低 | AppleScript 语法陈旧，团队成员熟悉度低 | 保持极简（仅调用一行 shell）；文档中说明修改方法 |
| 双进程模型复杂度 | 中 | 守护进程 + 菜单栏代理两个 Node.js 进程增加调试难度 | 统一日志目录；菜单栏代理日志单独文件；文档说明进程关系 |

### 4.4 用户体验风险

| 风险 | 严重程度 | 说明 | 缓解措施 |
|------|----------|------|----------|
| 首次安装门槛 | 中 | 用户仍需运行 shell 脚本安装，对非技术用户不够友好 | 提供一键安装命令（复制粘贴到终端）；未来考虑 `.pkg` 安装包 |
| Chrome Extension 仍需手动加载 | 中 | 未解决 Chrome 扩展的"开发者模式 + 加载已解压"步骤 | 本方案保守，不改动扩展分发方式；可在菜单栏添加"打开 Chrome 扩展管理页"快捷方式 |
| 状态不同步 | 低 | 菜单栏显示"运行中"但 Extension 实际未连接（如端口被其他程序占用） | 菜单栏代理通过实际 WebSocket 握手检测，而非仅检测进程存在 |
| 通知噪音 | 低 | 频繁的状态变化通知可能打扰用户 | 仅状态变化时通知一次；提供"静默模式"菜单选项 |

---

## 5. 实施建议

### 5.1 分阶段实施

1. **Phase 1 (2 天)**: 实现 `daemon.ts` + CLI 扩展 + `server.ts` PID 集成。验证 `cmspark-agent daemon start/stop/status` 命令行可用。
2. **Phase 2 (2 天)**: 实现 `menu-bar-agent.ts` + `node-notifier` 集成。验证菜单栏图标、状态轮询、菜单交互。
3. **Phase 3 (1 天)**: 编写 launchd plist + 安装脚本。验证开机自启、崩溃重启。
4. **Phase 4 (1 天)**: Extension 断开提示优化 + 文档 + 测试。

### 5.2 关键决策点

- **是否使用 `node-notifier` 还是纯 AppleScript？**
  - 推荐 `node-notifier`：npm 生态一致、跨平台潜力、维护简单。
  - 备选：纯 `child_process.exec("osascript ...")` 实现，零新增依赖，但代码更冗长。

- **PID 文件 vs Unix Domain Socket 锁？**
  - 保守选 PID 文件：实现简单，与现有代码风格一致。
  - 若出现竞态问题，可迁移到 UDS 锁。

- **菜单栏代理是否常驻？**
  - 是：用户需要随时查看状态和控制服务。
  - 可由 launchd 同时管理，或作为独立用户级进程。

### 5.3 与现有架构的兼容性

- **零改动 WebSocket 协议**：Extension 和 Companion 的通信方式完全不变。
- **零改动数据目录**：继续使用 `~/.cmspark-agent/`。
- **零改动安全策略**：所有安全机制（Cookie 信任域、高危执行确认）保持原样。
- **向后兼容**：用户仍可直接运行 `cmspark-agent start` 作为前台进程，不受 daemon 模式影响。

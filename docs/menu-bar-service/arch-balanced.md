# CMspark 菜单栏服务 — 折中方案架构设计

> 目标：在用户体验和技术复杂度之间取得平衡，解决"每次使用都要手动启动 Companion"的痛点。
>
> 核心原则：只做菜单栏，不做主窗口；Companion 进程由菜单栏托管；Chrome Extension 仍独立运行。

---

## 1. 整体架构图

### 1.1 部署视图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              macOS 用户空间                                   │
│                                                                             │
│  ┌──────────────────────┐         ┌──────────────────────────────────────┐  │
│  │   CMspark Menu Bar   │         │           Google Chrome               │  │
│  │   (Electron App)     │         │                                       │  │
│  │                      │         │  ┌─────────────────────────────────┐  │  │
│  │  ┌────────────────┐  │         │  │  CMspark Extension              │  │  │
│  │  │  Tray Icon     │  │         │  │  (Plasmo + React, Side Panel)   │  │  │
│  │  │  [●] ON/OFF   │  │         │  │                                 │  │  │
│  │  └────────────────┘  │         │  │  • Side Panel UI (320px)        │  │  │
│  │                      │         │  │  • Background Service Worker    │  │  │
│  │  Menu Items:         │         │  │  • CDP / Tab / Cookie Ops       │  │  │
│  │  ─────────────────   │         │  │  • WS Client (auto-reconnect)   │  │  │
│  │  ▶ 打开 Side Panel   │         │  └─────────────────────────────────┘  │  │
│  │  ● Companion 运行中  │         │                                       │  │
│  │  ─ 启动 Companion    │         └──────────────────────────────────────┘  │
│  │  ─ 停止 Companion    │                                                   │
│  │  ─ 重启 Companion    │                                                   │
│  │  ─ 查看日志          │                                                   │
│  │  ─ 打开设置...       │                                                   │
│  │  ─ 开机自启 ✓        │                                                   │
│  │  ─ 关于 CMspark      │                                                   │
│  │  ─ 退出              │                                                   │
│  │                      │                                                   │
│  └──────────────────────┘                                                   │
│           │                                                                 │
│           │ spawns / manages                                                  │
│           ▼                                                                 │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │                     Companion Process (Node.js)                       │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │   │
│  │  │  WS Server  │  │  LLM Adapter│  │ Skill Engine│  │Thread Mgr   │  │   │
│  │  │  :23401     │  │  (OpenAI)   │  │             │  │             │  │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘  │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │   │
│  │  │ HistoryStore│  │  Security   │  │ Config Mgr  │  │  Logger     │  │   │
│  │  │  (SQLite)   │  │  (Policy)   │  │  (~/.cmspark-agent/)│         │  │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘  │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│           ▲                                                                 │
│           │ WebSocket  ws://127.0.0.1:23401                                  │
│           │ (auto-reconnect, heartbeat)                                      │
│  ┌────────┴─────────────────────────────────────────────────────────────┐    │
│  │                         Data Directory                                │    │
│  │              ~/.cmspark-agent/                                        │    │
│  │  config.json  skills/  builtin-skills/  threads/  history.db  logs/   │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 数据流

```
用户点击托盘图标
       │
       ▼
┌──────────────┐    spawn("node", ["dist/index.js", "start"])    ┌──────────────┐
│  Menu Bar    │ ───────────────────────────────────────────────▶ │  Companion   │
│  (Electron)  │                                                  │  (Node.js)   │
└──────────────┘                                                  └──────────────┘
       │                                                                  │
       │ IPC: status, logs, control                                       │ WS :23401
       │◀─────────────────────────────────────────────────────────────────┘
       │
       │ 用户点击"打开 Side Panel"
       ▼
┌──────────────┐    chrome.tabs.create({url: "chrome://extensions"})       ┌──────────────┐
│  Menu Bar    │ ───────────────────────────────────────────────────────▶ │   Chrome     │
│  (Electron)  │    (或引导用户手动打开)                                     │  (Extension) │
└──────────────┘                                                  └──────────────┘
                                                                         │
                                                                         │ WS
                                                                         ▼
                                                                  ┌──────────────┐
                                                                  │  Companion   │
                                                                  └──────────────┘
```

### 1.3 进程关系

```
CMspark Menu Bar.app
├── Electron Main Process (Node.js)
│   ├── Tray manager (nativeImage + Tray)
│   ├── Menu builder (native Menu)
│   ├── Process manager (spawn companion)
│   ├── IPC bridge (renderer ↔ main)
│   └── Auto-launch manager (node-auto-launch)
│
├── Electron Renderer Process (hidden window, optional)
│   └── Log viewer / Settings UI (if needed)
│
└── Child Process: cmspark-agent (Node.js)
    └── WebSocket server + all companion services
```

---

## 2. 技术选型

| 维度 | 方案 | 理由 |
|------|------|------|
| **框架** | Electron (主进程 only) | 成熟稳定、跨平台潜力、原生 Tray API 完善、Node 集成无缝 |
| **Tray 库** | Electron `Tray` + `Menu` (原生) | 无需额外依赖，macOS 菜单栏体验原生 |
| **进程管理** | Node.js `child_process.spawn` | 直接 spawn companion 的 Node 进程，stdout/stderr 管道捕获日志 |
| **开机自启** | `node-auto-launch` 或自定义 launchd plist | `node-auto-launch` 封装了 macOS Login Items 和 Windows Registry |
| **打包** | `electron-builder` | 支持 `.app`、`.dmg`、代码签名、自动更新；可打包为单个 `.app` |
| **扩展加载** | 不自动加载，提供快捷入口 | Chrome Extension 安全策略限制，引导用户手动加载（或开发模式脚本） |

> **为什么不选 menubar / tray 等纯 Node 库？**
> - `menubar` 基于 Electron，但封装了窗口管理，我们不需要窗口。
> - 纯 Node `tray` 库（如 `systray`）跨平台支持弱，macOS 上需要 CGO，复杂度高。
> - Electron 主进程方案 = 最简可行路径，未来如需设置窗口可直接扩展。

> **为什么不选 Tauri？**
> - Tauri 需要 Rust 工具链，增加团队学习成本。
> - Companion 已是 Node.js，Electron 可以复用 Node 生态。
> - Tauri 的打包和原生模块集成在 macOS 上并不比 Electron 更简单。

---

## 3. 模块与改动清单

### 3.1 新增模块

| 文件/目录 | 说明 |
|-----------|------|
| `menu-bar/` | 新增顶层目录，Electron 菜单栏应用源码 |
| `menu-bar/package.json` | Electron + electron-builder + node-auto-launch 依赖 |
| `menu-bar/src/main.ts` | Electron 主进程：Tray 创建、Menu 构建、Companion 进程管理 |
| `menu-bar/src/process-manager.ts` | Companion 进程生命周期管理（启动/停止/重启/日志捕获） |
| `menu-bar/src/tray-manager.ts` | Tray 图标状态管理（运行中/已停止/错误）、图标切换 |
| `menu-bar/src/auto-launch.ts` | 开机自启配置（封装 node-auto-launch） |
| `menu-bar/src/open-sidepanel.ts` | 通过 AppleScript / `open` 命令激活 Chrome Side Panel |
| `menu-bar/assets/icon-Template.png` | macOS 菜单栏图标（16x16, 18x18, 模板模式） |
| `menu-bar/assets/icon-active-Template.png` | Companion 运行中的高亮图标 |
| `menu-bar/assets/icon-error-Template.png` | Companion 异常状态的图标 |
| `menu-bar/electron-builder.yml` | 打包配置：appId、macOS 目标、dmg、签名 |
| `menu-bar/scripts/build.sh` | 构建脚本：编译 companion → 打包 menu-bar → 输出 .app |

### 3.2 修改现有模块

| 文件 | 改动内容 |
|------|----------|
| `companion/src/index.ts` | 增强 CLI：实现 `stop` 命令（通过 PID 文件或 IPC 信号）、`status` 命令（检查端口占用） |
| `companion/src/server.ts` | 增加优雅关闭逻辑：SIGTERM/SIGINT 时关闭 WebSocket、保存状态、释放端口；写入 PID 文件到 `~/.cmspark-agent/` |
| `companion/src/config.ts` | 新增 `getPidFilePath()`、`writePidFile()`、`readPidFile()` 辅助函数 |
| `companion/package.json` | 确认 `bin` 字段可用；可选：增加 `files` 字段确保 `dist/` 和 `builtin-skills/` 被打包 |
| `chrome-extension/src/background/index.ts` | 增加首次连接失败时的友好提示（如通知用户"Companion 未启动，请从菜单栏启动"） |
| `chrome-extension/src/background/ws-client.ts` | 增加连接状态广播到 Side Panel，支持"Companion 离线"UI 状态 |
| `chrome-extension/src/sidepanel/` | 新增"Companion 未运行"占位 UI，提供"打开菜单栏"按钮 |
| `chrome-extension/package.json` | manifest 中增加 `externally_connectable` 或保持现状（不影响） |
| `package.json` (root) | 新增 workspace 或 scripts：`build:menu-bar`、`package:all` |
| `README.md` | 更新安装说明：下载 .dmg → 安装 .app → 加载 Chrome Extension |

### 3.3 构建与发布流程

```
1. cd companion && npm run build          → 生成 companion/dist/
2. cd menu-bar && npm install
3. cd menu-bar && npm run build           → 编译 Electron 主进程 TS
4. cd menu-bar && npm run package         → electron-builder → CMspark Menu Bar.app
   (内部将 companion/dist/ 和 companion/builtin-skills/ 复制到 .app/Contents/Resources/)
5. cd menu-bar && npm run make:dmg        → 生成 CMspark-Menu-Bar-0.1.0.dmg
```

> Electron-builder 配置中通过 `extraResources` 将 companion 的构建产物打包进 `.app`，
> 运行时从 `process.resourcesPath` 找到 companion 入口并 spawn。

---

## 4. 预估开发人天

| 分类 | 任务 | 人天 | 说明 |
|------|------|------|------|
| **后端** | Companion 进程管理增强（PID 文件、优雅关闭、status/stop CLI） | 1 | 改动 `index.ts`、`server.ts`、`config.ts` |
| **后端** | 日志管道与状态查询接口 | 0.5 | Menu Bar 需要实时读取 companion stdout/stderr |
| **前端** | Electron 主进程骨架（Tray、Menu、IPC） | 1 | `main.ts`、`tray-manager.ts` |
| **前端** | Companion 进程管理器（spawn/kill/restart/log tail） | 1 | `process-manager.ts`，含错误处理 |
| **前端** | 开机自启集成 | 0.5 | `auto-launch.ts`，测试 Login Items |
| **前端** | 打开 Side Panel / Chrome 快捷操作 | 0.5 | AppleScript 或 `open -a "Google Chrome"` |
| **前端** | Chrome Extension 离线状态提示 | 0.5 | Side Panel 占位 UI + Background 通知 |
| **打包** | electron-builder 配置 + 资源打包 | 1 | `electron-builder.yml`、extraResources、图标 |
| **打包** | 构建脚本与 CI 集成 | 0.5 | `build.sh`、GitHub Actions workflow |
| **测试** | 手动测试矩阵（启动/停止/重启/自启/升级） | 1 | macOS 各场景验证 |
| **测试** | 异常场景测试（端口占用、Companion 崩溃、重复启动） | 0.5 | 边界 case |
| **文档** | 用户安装指南 + 故障排查 | 0.5 | 更新 README、TROUBLESHOOTING |
| **合计** | | **8.5 人天** | 约 **2 周**（含联调与缓冲） |

---

## 5. 潜在风险与缓解

### 5.1 安全风险

| 风险 | 等级 | 说明 | 缓解措施 |
|------|------|------|----------|
| Companion 以用户权限常驻后台 | 中 | 菜单栏应用持续运行，Companion 进程监听本地端口，攻击者若控制菜单栏可操控浏览器 | 1. 保持 WebSocket 仅绑定 `127.0.0.1`；2. 菜单栏不暴露远程接口；3. 考虑 Companion 启动时的安全密钥协商（已有 `security-token.ts`） |
| 代码签名缺失导致 Gatekeeper 拦截 | 低 | 未签名的 `.app` 在 macOS 上默认无法打开 | 1. 开发阶段用户手动"右键打开"；2. 正式版申请 Apple Developer ID 签名；3. electron-builder 已内置签名配置 |
| 自动更新被劫持 | 低 | electron-builder 的 auto-updater 若配置不当可能下载恶意更新 | 1. 启用签名验证；2. 更新包通过 HTTPS 分发；3. 初期可关闭自动更新，手动发布 |

### 5.2 性能风险

| 风险 | 等级 | 说明 | 缓解措施 |
|------|------|------|----------|
| Electron 主进程内存占用 | 低 | Electron 主进程本身约 50-100MB，对菜单栏应用略重 | 1. 不创建 Renderer Window（或仅按需创建）；2. 使用 `app.dock.hide()` 隐藏 Dock 图标；3. 若未来内存敏感，可迁移到 Tauri |
| Companion 进程泄漏 | 中 | 菜单栏崩溃时 Companion 可能成为孤儿进程 | 1. Process Manager 在退出时强制 `kill` Companion；2. 启动时检查并清理残留 PID 文件；3. 菜单栏启动时若发现端口占用，提示用户 |
| 开机自启拖慢登录 | 低 | 菜单栏应用随系统启动，可能增加登录时间 | 1. Companion 采用延迟启动（菜单栏启动后 3 秒再 spawn）；2. 提供"启动时不自动启动 Companion"选项 |

### 5.3 维护性风险

| 风险 | 等级 | 说明 | 缓解措施 |
|------|------|------|----------|
| 双 Node 版本冲突 | 低 | Electron 内置 Node 与 Companion 所需的 Node 版本不一致 | 1. Companion 作为独立进程 spawn，使用系统 Node 或打包的 Node 二进制；2. 通过 `extraResources` 打包 companion 源码 + Node 运行时 |
| Electron 升级成本 | 低 | Electron 版本迭代快，API 可能变更 | 1. 锁定 Electron 主版本（如 ^30.0.0）；2. 代码量小，升级成本低 |
| 跨平台扩展困难 | 中 | 当前方案针对 macOS，未来 Windows/Linux 需调整 | 1. Tray/Menu API 在 Electron 中跨平台一致；2. 开机自启和 Side Panel 打开方式需平台适配；3. 初期专注 macOS，后续迭代 |

### 5.4 用户体验风险

| 风险 | 等级 | 说明 | 缓解措施 |
|------|------|------|----------|
| Chrome Extension 仍需手动加载 | 中 | 用户期望"一键全装"，但 Chrome 安全策略不允许自动安装未上架扩展 | 1. 菜单栏提供"打开 Chrome 扩展管理页"快捷按钮；2. 提供详细的图文安装向导；3. 长期目标：上架 Chrome Web Store |
| 菜单栏图标状态与用户认知不一致 | 低 | Companion 崩溃但菜单栏显示"运行中" | 1. 增加健康检查轮询（每 5 秒 ping Companion WS）；2. 图标状态与 WS 连通性绑定 |
| 用户找不到菜单栏图标 | 低 | macOS 菜单栏图标过多时可能被隐藏 | 1. 首次启动时显示引导气泡；2. 提供"在菜单栏中显示 CMspark"的 Dock 菜单（若保留 Dock 图标） |

---

## 6. 方案对比（为何这是"折中"）

| 方案 | 复杂度 | 用户体验 | 维护成本 | 适用阶段 |
|------|--------|----------|----------|----------|
| **A. 纯 CLI + 手动启动**（现状） | 低 | 差 | 低 | MVP |
| **B. 本方案：Electron 菜单栏 + 托管 Companion** | **中** | **良** | **中** | **当前阶段** |
| C. 完整 Electron 应用（含内置浏览器） | 高 | 优 | 高 | 未来 |
| D. Tauri 菜单栏 | 中 | 良 | 中（需 Rust） | 未来 |
| E. 系统级 launchd 守护进程 + 无 UI | 低 | 中（无状态可视） | 低 | 不适用 |

**本方案的定位**：
- 比纯 CLI 大幅提升体验（一键启动、状态可视、开机自启）。
- 比完整 Electron 应用低得多的复杂度（无 Renderer UI、无浏览器内核、无 CDP 迁移）。
- 保留了 Chrome Extension 的独立性和未来上架 CWS 的可能性。
- 技术栈与团队现有能力（Node.js + TypeScript）完全对齐。

---

## 7. 关键决策记录

| 决策 | 选择 | 理由 |
|------|------|------|
| **Companion 是否内嵌到 Electron？** | 否，作为子进程 spawn | 保持 Companion 独立可测试、可单独升级；Electron 仅做"壳" |
| **是否提供设置窗口？** | 第一阶段不提供，用菜单项 + 打开 config.json | 减少复杂度；设置需求通过 Companion 的 config.json 已可满足 |
| **是否支持 Windows/Linux？** | 第一阶段仅 macOS；代码结构预留跨平台 | 目标用户以 macOS 为主；Electron Tray API 跨平台一致，后续适配成本低 |
| **Chrome Extension 是否打包进 .app？** | 否，单独提供 | Chrome 安全策略限制；扩展更新频率可能高于菜单栏 |
| **自动更新策略** | 第一阶段手动下载；第二阶段 electron-updater | 降低初期复杂度；签名证书就绪后可无缝升级 |

---

## 8. 下一步行动

1. **Day 1-2**：创建 `menu-bar/` 目录骨架，实现 Electron 主进程 + Tray + 基础 Menu。
2. **Day 3**：实现 Companion Process Manager（spawn / stdout 捕获 / 状态轮询）。
3. **Day 4**：Companion 侧增强（PID 文件、优雅关闭、status/stop CLI）。
4. **Day 5**：联调（菜单栏启动 Companion → Extension 连接 → 功能验证）。
5. **Day 6-7**：electron-builder 打包、图标、.dmg 生成、开机自启测试。
6. **Day 8-9**：异常场景测试、Chrome Extension 离线提示、文档更新。
7. **Day 10**：Code Review、发布测试版。

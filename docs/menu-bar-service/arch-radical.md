# CMspark 后台常驻菜单栏服务 —— 激进方案架构设计

## 方案概述

将 Companion 打包为一个**原生 macOS 菜单栏应用（SwiftUI + Swift）**，常驻系统菜单栏。菜单栏应用负责：

1. 管理 Companion Node.js 进程的生命周期（启动/停止/守护）
2. 自动检测 Chrome 扩展加载状态，一键引导用户完成加载
3. 提供开机自启、日志查看、配置编辑等系统级能力
4. 消除终端依赖，实现"点击图标即可使用"的极致体验

**核心激进点**：不选 Electron/Tauri（太重），不选纯 Node.js CLI（无法做菜单栏），而是采用 **SwiftUI 原生菜单栏应用 + 内嵌 Node.js 运行时** 的混合架构。Companion 代码零改动，通过 `pkg` 打包为独立二进制，由 Swift 应用作为子进程托管。

---

## 1. 架构图（文字描述）

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              macOS 用户空间                                   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    CMspark Menu Bar App (SwiftUI)                    │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌───────────┐  │   │
│  │  │ NSStatusBar │  │  Process    │  │  NSWorkspace│  │  SMAppService│  │   │
│  │  │   Icon      │  │  Manager    │  │  (Chrome)   │  │ (AutoStart) │  │   │
│  │  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └─────┬─────┘  │   │
│  │         │                │                │               │        │   │
│  │         ▼                ▼                ▼               ▼        │   │
│  │  ┌─────────────────────────────────────────────────────────────┐   │   │
│  │  │                    SwiftUI Dropdown Menu                     │   │   │
│  │  │  [CMspark Icon]                                              │   │   │
│  │  │  ├── Companion: ● Running (pid: 12345)                       │   │   │
│  │  │  ├── Chrome Ext: ● Connected / ○ Not Loaded                  │   │   │
│  │  │  ├── ─────────────────────────                               │   │   │
│  │  │  ├── ▶ Start Companion                                       │   │   │
│  │  │  ├── ⏹ Stop Companion                                        │   │   │
│  │  │  ├── 🔄 Reload Extension Guide...                            │   │   │
│  │  │  ├── ─────────────────────────                               │   │   │
│  │  │  ├── ⚙️  Open Settings...                                    │   │   │
│  │  │  ├── 📋 View Logs...                                        │   │   │
│  │  │  ├── ✅ Launch at Login                                     │   │   │
│  │  │  └── ❌ Quit CMspark                                        │   │   │
│  │  └─────────────────────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                              │                                              │
│                              │ spawn / kill / monitor                       │
│                              ▼                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │              Companion Binary (pkg-packed, standalone)               │   │
│  │  ┌─────────────────────────────────────────────────────────────┐   │   │
│  │  │  Node.js Runtime (embedded) + cmspark-agent dist bundle      │   │   │
│  │  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────────┐    │   │   │
│  │  │  │ server.ts│  │ llm/    │  │ skills/ │  │ threads/    │    │   │   │
│  │  │  │ (WS 23401)│  │adapter │  │engine   │  │manager      │    │   │   │
│  │  │  └────┬────┘  └─────────┘  └─────────┘  └─────────────┘    │   │   │
│  │  │       │                                                    │   │   │
│  │  │       │ WebSocket ws://127.0.0.1:23401                      │   │   │
│  │  │       │                                                    │   │   │
│  │  └───────┼────────────────────────────────────────────────────┘   │   │
│  └──────────┼────────────────────────────────────────────────────────┘   │
│             │                                                               │
│             │ WebSocket (localhost only)                                    │
│             ▼                                                               │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │              Chrome Extension (Plasmo + React, MV3)                  │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────────┐  │   │
│  │  │ Background  │  │ Side Panel  │  │  CDP (chrome.debugger)      │  │   │
│  │  │  Service    │  │  (React UI) │  │  Tab / Cookie / Script      │  │   │
│  │  │  Worker     │  │             │  │  Operations                 │  │   │
│  │  └─────────────┘  └─────────────┘  └─────────────────────────────┘  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                        Data Directory (~/.cmspark-agent)             │   │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────┐  │   │
│  │  │config.json│  │ skills/  │  │ threads/ │  │history.db│  │ logs/ │  │   │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘  └───────┘  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘

                              数据流

1. 用户点击菜单栏图标 → SwiftUI 下拉菜单
2. 点击 "Start Companion" → Swift ProcessManager spawn companion binary
3. Companion 监听 ws://127.0.0.1:23401
4. Chrome Extension (已加载) 自动连接 WebSocket
5. 用户打开 Side Panel → 正常交互（聊天、工具调用、技能管理）
6. Companion 输出 stdout/stderr → Swift 捕获 → 写入 ~/Library/Logs/CMspark/
7. 用户点击 "View Logs" → Swift 读取日志文件 → 内置日志查看器
8. 用户勾选 "Launch at Login" → SMAppService.register() → 系统级开机自启
```

---

## 2. 涉及的模块和改动点

### 2.1 新增模块

| 模块 | 文件/目录 | 说明 |
|------|----------|------|
| **Menu Bar App** | `native/macos/CMsparkMenuBar/` | SwiftUI 原生菜单栏应用，Xcode 项目 |
| | `native/macos/CMsparkMenuBar/CMsparkMenuBarApp.swift` | App 入口，NSStatusBar 初始化 |
| | `native/macos/CMsparkMenuBar/MenuBarView.swift` | SwiftUI 下拉菜单视图 |
| | `native/macos/CMsparkMenuBar/CompanionManager.swift` | Companion 进程管理（spawn/kill/health check） |
| | `native/macos/CMsparkMenuBar/ChromeExtensionChecker.swift` | 检测 Chrome 扩展是否已加载（通过 Chrome 扩展协议或文件锁） |
| | `native/macos/CMsparkMenuBar/LogViewer.swift` | 内置日志查看窗口 |
| | `native/macos/CMsparkMenuBar/SettingsWindow.swift` | 配置编辑窗口（直接编辑 ~/.cmspark-agent/config.json） |
| | `native/macos/CMsparkMenuBar/AutoStartManager.swift` | SMAppService 开机自启管理 |
| | `native/macos/CMsparkMenuBar/Resources/Assets.xcassets` | 菜单栏图标（亮色/暗色适配） |
| **Companion 打包** | `companion/scripts/build-standalone.sh` | 使用 `pkg` 将 companion 打包为独立可执行文件 |
| | `companion/scripts/build-macos-app.sh` | 将 companion binary + Swift app 打包为 `.app` bundle |
| **发布** | `.github/workflows/build-macos-app.yml` | GitHub Actions：编译 Swift app + 打包 companion + 签名 + 生成 `.dmg` |

### 2.2 改动模块

| 模块 | 文件 | 改动内容 |
|------|------|----------|
| **companion** | `companion/package.json` | 新增 `build:standalone` 脚本，配置 `pkg` 打包参数 |
| | `companion/src/index.ts` | 增强 CLI：支持 `cmspark-agent stop`（通过 PID 文件或 Unix socket 信号）、`cmspark-agent status`（检查端口占用） |
| | `companion/src/server.ts` | 启动时写入 PID 文件到 `~/.cmspark-agent/companion.pid`；支持优雅关闭时删除 PID 文件；stdout 增加结构化状态输出（便于 Swift 解析） |
| | `companion/src/config.ts` | 新增 `getLogDir()` 辅助函数；确保日志目录在 `initDataDir()` 中创建 |
| | `companion/src/logger.ts` | 支持同时输出到 stdout（便于 Swift 捕获）和文件；增加 `source: "companion"` 标记 |
| **chrome-extension** | `chrome-extension/src/background/ws-client.ts` | 增强重连逻辑：当连接断开时，在 Side Panel 显示 "Companion 未启动，请点击菜单栏图标启动" 的引导提示 |
| | `chrome-extension/src/background/index.ts` | 新增 `nativeMessaging` 备用通道（可选）：当 WebSocket 不可用时，尝试通过 Chrome Native Messaging 与菜单栏应用通信（用于扩展状态上报） |
| | `chrome-extension/src/sidepanel/App.tsx` | 新增 Companion 状态检测 UI：当 WS 断开时显示启动引导卡片 |
| | `chrome-extension/manifest.json` (Plasmo 生成) | 如启用 Native Messaging，需增加 `nativeMessaging` permission |
| **项目根** | `package.json` (root) | 新增 `build:macos` 脚本，一键构建完整 macOS 应用 |
| | `.gitignore` | 忽略 `native/macos/build/`、`*.app`、`*.dmg` |

---

## 3. 预估开发人天

按角色和阶段分类：

| 分类 | 任务 | 人天 | 说明 |
|------|------|------|------|
| **后端/Companion** | 增强 CLI（stop/status 命令） | 0.5 | PID 文件管理、端口检测 |
| | 结构化 stdout 输出 | 0.5 | 便于 Swift 进程管理器解析状态 |
| | `pkg` 打包配置与测试 | 1 | 处理原生模块（sqlite、ws）的打包兼容性 |
| **前端/Native** | SwiftUI 菜单栏应用骨架 | 1 | NSStatusBar、下拉菜单、图标管理 |
| | Companion 进程管理器 | 1.5 | spawn、health check、崩溃自动重启、日志捕获 |
| | Chrome 扩展状态检测 | 1 | 通过文件锁或 Native Messaging 检测扩展是否加载 |
| | 日志查看器 | 0.5 | 内置窗口，实时 tail 日志 |
| | 配置编辑窗口 | 0.5 | 表单编辑 config.json，API key 安全输入 |
| | 开机自启（SMAppService） | 0.5 | macOS 13+ 推荐方式 |
| | 图标与 UI  polish | 0.5 | 亮色/暗色模式、动画、菜单状态同步 |
| **打包/发布** | `.app` bundle 构建脚本 | 1 | 将 Swift app + companion binary 打包为 `.app` |
| | 代码签名与公证 | 1 | Apple Developer ID、notarization（首次配置较耗时） |
| | GitHub Actions CI | 0.5 | 自动化构建、签名、生成 `.dmg` |
| | `.dmg` 安装包制作 | 0.5 | 拖拽安装、背景图、应用链接 |
| **测试** | 进程生命周期测试 | 0.5 | 启动、停止、崩溃恢复、端口占用冲突 |
| | 扩展检测端到端测试 | 0.5 | 扩展未加载/已加载状态切换 |
| | 开机自启测试 | 0.5 | 登录项注册/注销、系统重启验证 |
| | 日志与配置测试 | 0.5 | 日志轮转、配置热重载 |
| **文档** | 用户安装指南 | 0.5 | 下载 `.dmg`、拖拽安装、加载扩展 |
| | 开发者构建文档 | 0.5 | Xcode 依赖、签名配置、本地构建步骤 |
| **合计** | | **13.5 人天** | 约 2.5~3 周（1 名全栈 + 1 名 iOS 开发者并行） |

---

## 4. 潜在风险

### 4.1 安全风险

| 风险 | 等级 | 说明 | 缓解措施 |
|------|------|------|----------|
| **Companion binary 被篡改** | 中 | `pkg` 打包后的二进制包含 Node.js 运行时和源码，若被替换可导致恶意代码执行 | 代码签名（Code Signing）+ Sparkle 或手动更新验证；发布时提供 SHA256 校验 |
| **API key 在进程内存中暴露** | 低 | Companion 进程内存中的 API key 可被同用户进程读取（如 `ps` 或内存 dump） | 此问题在现有 CLI 模式下已存在；菜单栏模式不加剧该风险；建议后续引入 Keychain 存储 |
| **Native Messaging 攻击面** | 低 | 若启用 Chrome Native Messaging，恶意扩展可能冒充 CMspark | 严格校验扩展 ID；Native Messaging host 配置限制为 CMspark 扩展 ID |
| **开机自启的权限滥用** | 低 | 用户可能 unaware 应用已开机自启 | 首次勾选时明确提示；菜单栏始终显示运行状态 |

### 4.2 性能风险

| 风险 | 等级 | 说明 | 缓解措施 |
|------|------|------|----------|
| **Swift app 内存占用** | 低 | 原生 SwiftUI 应用内存占用约 20-50MB，可忽略 | 选择 Swift 而非 Electron 的核心原因 |
| **Companion binary 体积** | 中 | `pkg` 打包后约 50-100MB（含 Node.js 运行时） | 使用 `pkg` 的 `--compress Brotli`；后续可调研 `sea` (Single Executable Apps, Node 20+) |
| **进程启动延迟** | 低 | 从点击到 Companion 就绪约 1-3 秒 | 预加载优化；显示启动进度指示器 |
| **日志文件膨胀** | 低 | 长期运行导致日志文件过大 |  companion 已有按天轮转；Swift 侧增加日志清理策略（保留 7 天） |

### 4.3 维护性风险

| 风险 | 等级 | 说明 | 缓解措施 |
|------|------|------|----------|
| **双技术栈（Swift + TypeScript）** | 中 | 团队需要同时维护 Swift 和 TS 代码，增加认知负担 | Swift 层保持极薄（仅进程管理和 UI），业务逻辑全部在 TS；文档明确边界 |
| **Node.js 版本升级** | 低 | `pkg` 打包依赖特定 Node.js 版本 | CI 中锁定 Node 版本；升级时重新测试打包 |
| **macOS 版本兼容性** | 低 | SMAppService 要求 macOS 13+；SwiftUI 要求 11+ | 目标用户以开发者为主，macOS 版本较新；文档注明最低版本要求 |
| **跨平台扩展困难** | 中 | 本方案为 macOS 专用，Windows/Linux 需另起方案 | 激进方案接受平台限定；后续 Windows 可用 Tauri/Linux 可用 tray 应用 |

### 4.4 用户体验风险

| 风险 | 等级 | 说明 | 缓解措施 |
|------|------|------|----------|
| **Chrome 扩展仍需手动加载** | 中 | 用户仍需打开 `chrome://extensions` 加载未打包扩展 | 提供一键打开 Chrome 扩展页面的按钮；未来可探索 Chrome 企业策略自动安装 |
| **首次启动的权限弹窗** | 中 | macOS 可能弹出"允许此应用控制其他应用"等权限请求 | 在引导流程中提前说明；权限请求文案优化 |
| **Companion 崩溃后用户无感知** | 低 | 菜单栏图标仍在，但 Companion 已崩溃 | Swift 进程管理器增加 health check（每 5 秒 ping WS），崩溃后自动重启并通知用户 |
| **端口冲突** | 低 | 23401 被其他应用占用 | 启动前检测端口占用；若被占用提示用户或自动尝试备用端口 |

---

## 5. 替代方案对比（为什么选 Swift）

| 方案 | 体积 | 内存 | 菜单栏原生感 | 打包复杂度 | 跨平台 | 结论 |
|------|------|------|------------|----------|--------|------|
| **SwiftUI (本方案)** | ~80MB | ~30MB | 极佳 | 中（需 Xcode + 签名） | 否 | **推荐** — 极致体验，团队可接受单平台 |
| Electron | ~150MB | ~150MB | 一般 | 低 | 是 | 否决 — 太重，与"激进追求体验"目标不符 |
| Tauri | ~15MB | ~50MB | 良好 | 中 | 是 | 备选 — 若后续要跨平台可迁移 |
| Node.js + menubar (npm) | ~0MB* | ~80MB | 差 | 低 | 是 | 否决 — 仍需用户安装 Node，未解决痛点 |
| Go/Rust + WebView | ~20MB | ~40MB | 良好 | 高 | 是 | 否决 — 引入新语言栈，维护成本高 |

> *注：Node.js + menubar 方案体积为 0 是因为依赖用户已安装 Node，但实际未解决"用户需自行安装 Node"的痛点。

---

## 6. 实施路线图

```
Phase 1: 基础设施（3 天）
  ├── companion CLI 增强（stop/status/PID 文件）
  ├── pkg 打包配置与验证
  └── Swift 项目骨架 + 菜单栏 UI

Phase 2: 核心功能（5 天）
  ├── Companion 进程管理（启动/停止/健康检查/自动重启）
  ├── 日志捕获与查看器
  ├── Chrome 扩展状态检测
  └── 配置编辑窗口

Phase 3:  polish 与发布（3 天）
  ├── 开机自启（SMAppService）
  ├── 图标、动画、UI 细节
  ├── 代码签名 + 公证
  └── .dmg 安装包

Phase 4: 集成与测试（2.5 天）
  ├── CI/CD 流水线
  ├── 端到端测试
  └── 用户文档
```

---

## 7. 关键决策记录

1. **为什么用 `pkg` 而不是 Node 20 SEA？**  
   Node 20 的 Single Executable Apps 尚为实验性，且对原生 addon 支持不完善。`pkg` 成熟稳定，社区验证充分。

2. **为什么不用 Tauri？**  
   Tauri 跨平台能力强，但本方案目标为"激进追求 macOS 极致体验"。SwiftUI 的原生菜单栏行为（NSStatusBar）、系统权限管理（SMAppService）、进程管理（NSTask）均比 Tauri 更自然。若未来需要 Windows 支持，可将 Swift 层替换为 Tauri 而不改动 Companion。

3. **为什么菜单栏应用要内嵌 companion binary 而不是依赖系统 Node？**  
   消除 Node.js 安装依赖是核心痛点之一。内嵌后用户下载 `.dmg` 拖拽即完成全部安装。

4. **Chrome 扩展自动加载是否可行？**  
   Chrome 安全策略禁止未打包扩展自动加载（除企业策略外）。因此本方案接受"引导用户手动加载"的现实，但通过菜单栏应用提供一键打开 `chrome://extensions` 的快捷方式，最大限度降低摩擦。

# CMspark 后台常驻菜单栏服务 — 最终设计文档

> 版本: v1.0
> 日期: 2026-06-07
> 状态: 最终选定方案 — 保守方案（增强版）
> 项目阶段: 安全稳定化 MVP

---

## 目录

1. [锦标赛比较过程](#1-锦标赛比较过程)
2. [最终选定方案](#2-最终选定方案)
3. [详细架构设计](#3-详细架构设计)
4. [模块与改动清单](#4-模块与改动清单)
5. [开发计划](#5-开发计划)
6. [安全加固清单](#6-安全加固清单)
7. [性能优化清单](#7-性能优化清单)
8. [风险与缓解](#8-风险与缓解)
9. [附录：其他方案归档](#9-附录其他方案归档)

---

## 1. 锦标赛比较过程

### 1.1 参赛方案

| 编号 | 方案名称 | 核心技术 | 预估人天 | 性能评分 | 安全评分 |
|------|----------|----------|----------|----------|----------|
| A | 激进方案 | SwiftUI + pkg 打包 | 13.5 天 | 8.5 / 10 | 6.0 / 10 |
| B | 折中方案 | Electron 主进程-only | 8.5 天 | 5.5 / 10 | 5.0 / 10 |
| C | 保守方案 | launchd + node-notifier | 6.0 天 | 7.0 / 10 | 7.0 / 10 |

### 1.2 Round 1: 激进方案 (A) vs 折中方案 (B)

**比较维度：**

| 维度 | 激进方案 (A) | 折中方案 (B) | 胜者 |
|------|-------------|-------------|------|
| 常驻内存 | 70-140MB | 130-250MB | A |
| 启动延迟 | 1-3s | 2-4s | A |
| CPU 空闲开销 | <1% | 1-3% | A |
| 磁盘占用 | ~80-100MB | ~150-200MB | A |
| 电池/能耗 | 最低 | 最高 | A |
| 进程隔离 | Swift 权限低 | Electron = 完整 Node.js | A |
| 供应链安全 | pkg 预编译运行时不可审计 | Electron TCB 巨大 + 双运行时 | A |
| 开发成本 | 13.5 天 | 8.5 天 | B |
| 跨平台潜力 | 无（macOS 专属） | 有（Electron 跨平台） | B |

**结果：激进方案 (A) 胜。**

Electron 主进程-only 是一个常见的性能陷阱：即使不创建 Renderer Window，Chromium 内核基线开销不可避免。130-250MB 常驻内存对于"仅显示一个菜单栏图标"的应用完全不合理。双 Node 运行时、庞大的供应链攻击面，使得折中方案在性能和安全上都垫底。

### 1.3 Round 2: 保守方案 (C) vs 折中方案 (B)

**比较维度：**

| 维度 | 保守方案 (C) | 折中方案 (B) | 胜者 |
|------|-------------|-------------|------|
| 常驻内存 | 90-180MB | 130-250MB | C |
| 启动延迟 | 0.5-1s（launchd 预加载） | 2-4s | C |
| CPU 空闲开销 | <1%-2% | 1-3% | C |
| 磁盘占用 | ~0MB | ~150-200MB | C |
| 系统启动影响 | 极低 | 高 | C |
| 进程隔离 | launchd 系统级管理 | Electron 主进程高权限 | C |
| 供应链安全 | 仅新增 node-notifier | Electron + auto-launch + updater | C |
| 崩溃恢复 | launchd KeepAlive | 孤儿进程风险 | C |
| 开发成本 | 6 天 | 8.5 天 | C |

**结果：保守方案 (C) 胜。**

保守方案在几乎所有维度上击败折中方案，且开发成本更低。唯一的弱点是 node-notifier 和 WS 轮询开销，但这些都有明确的优化路径。

### 1.4 Final Round: 激进方案 (A) vs 保守方案 (C)

**比较维度：**

| 维度 | 激进方案 (A) | 保守方案 (C) | 胜者 | 权重 |
|------|-------------|-------------|------|------|
| 常驻内存 | 70-140MB | 90-180MB | A | 20% |
| 启动延迟 | 1-3s | 0.5-1s | C | 15% |
| CPU 空闲开销 | <1% | <1%-2% | A | 15% |
| 磁盘占用 | ~80-100MB | ~0MB | C | 10% |
| 电池/能耗 | 最低 | 中等 | A | 15% |
| 进程隔离 | Swift 权限低 | launchd 系统级 | C | 10% |
| 代码完整性 | pkg 难以逐字节校验 | 无新增打包层 | C | 10% |
| 供应链安全 | 双栈 + pkg 预编译 | 最小改动 | C | 15% |
| 崩溃恢复 | Swift 进程管理器 | launchd KeepAlive | C | 10% |
| 开发成本 | 13.5 天 | 6 天 | C | 20% |
| 可维护性 | 双技术栈（Swift + TS） | 纯 Node.js | C | 15% |
| 审计透明度 | SMAppService 不透明 | plist 纯文本可审计 | C | 5% |
| **加权总分** | **-** | **-** | **C** | 100% |

**关键权衡分析：**

1. **性能 vs 安全**：激进方案性能领先（8.5 vs 7.0），但安全落后（6.0 vs 7.0）。项目当前阶段为"安全稳定化 MVP"，安全是第一优先级。

2. **开发成本**：保守方案仅需 6 天（约 1 周），激进方案需 13.5 天（约 3 周）。MVP 阶段应优先快速验证核心假设。

3. **技术栈风险**：激进方案引入 Swift 技术栈，团队需要 iOS 开发者参与。保守方案完全基于现有 Node.js 技术栈，团队可独立实施。

4. **最小可信计算基（MinTCB）**：保守方案没有引入任何新的重型运行时。Companion 保持为独立的 Node.js 进程，攻击面最小。

**结果：保守方案 (C) 胜。**

### 1.5 锦标赛冠军

**最终选定：保守方案（增强版）**

核心决策：以保守方案为基座，吸收 Review Agent 的全部缓解建议进行安全加固和性能优化，在 6 人天的基础上增加约 1 天实施关键缓解措施，总投入约 **7 人天**。

---

## 2. 最终选定方案

### 2.1 方案概述

利用 macOS 原生 `launchd` 将 Companion 注册为系统守护进程，配合轻量级 Node.js 菜单栏代理（`node-notifier`）提供状态可视化和常用操作入口。不引入 Electron、Tauri、Swift 等新技术栈，最大化复用现有代码。

### 2.2 架构原则

1. **最小改动**：Companion 核心逻辑零改动，仅扩展 CLI 命令
2. **原生集成**：使用 macOS 原生机制（launchd、osascript）而非第三方框架
3. **安全优先**：所有设计决策优先考虑安全，宁可牺牲部分用户体验
4. **向后兼容**：用户仍可直接运行 `cmspark-agent start` 作为前台进程

---

## 3. 详细架构设计

### 3.1 整体架构

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
|  数据目录: ~/.cmspark-agent/ (权限 0700)                         |
|  ├─ config.json      (配置)                                      |
|  ├─ logs/            (日志, 权限 0700)                           |
|  ├─ threads/         (线程状态)                                   |
|  ├─ skills/          (用户技能)                                   |
|  └─ builtin-skills/  (内置技能)                                   |
|                                                                  |
+------------------------------------------------------------------+
```

### 3.2 启动流程

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
│ - 使用 Unix Domain Socket 锁  │
│ - 启动 WebSocket 服务器       │
│ - 等待 Chrome Extension 连接  │
└──────────────────────────────┘
```

### 3.3 数据流

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

## 4. 模块与改动清单

### 4.1 Companion (Node.js) 改动

| 文件/模块 | 改动类型 | 改动内容 |
|-----------|----------|----------|
| `companion/src/index.ts` | 修改 | 扩展 CLI 命令解析：新增 `daemon` 子命令（`daemon start/stop/status/logs`），支持 `--daemonize` 标志（fork 到后台、脱离终端、写入 PID 文件） |
| `companion/src/daemon.ts` | **新增** | 守护进程管理模块：Unix Domain Socket 锁（替代 PID 文件）、进程存活检测（`process.kill(pid, 0)`）、优雅关闭（SIGTERM）、日志重定向到文件 |
| `companion/src/server.ts` | 修改 | 在 `startServer()` 中增加 daemon 模式支持：启动时写入 UDS 锁，关闭时清理；支持通过 UDS 检测端口占用时的"已有实例"情况 |
| `companion/src/config.ts` | 修改 | `initDataDir()` 中新增创建 `logs/` 目录并设置权限 `0o700`；新增获取 daemon 日志路径的辅助函数 |
| `companion/package.json` | 修改 | 新增依赖：`node-notifier`（菜单栏通知）；新增 scripts：`daemon:start`、`daemon:stop`、`daemon:status` |
| `companion/src/menu-bar-agent.ts` | **新增** | 菜单栏代理进程：使用 `node-notifier` 创建菜单栏图标和右键菜单，轮询 WebSocket 连接状态，提供启动/停止/状态/打开日志等菜单项 |

### 4.2 macOS 系统集成（新增文件）

| 文件/模块 | 改动类型 | 改动内容 |
|-----------|----------|----------|
| `scripts/launchd/com.cmspark.companion.plist` | **新增** | launchd plist 模板：定义 `Label=com.cmspark.companion`，`ProgramArguments` 指向 `cmspark-agent daemon start --daemonize`，`RunAtLoad=true`（开机自启），`KeepAlive=true`（崩溃重启），`ThrottleInterval=30`（防重启风暴），`StandardOutPath/StandardErrorPath` 指向 `~/.cmspark-agent/logs/` |
| `scripts/install-daemon.sh` | **新增** | 安装脚本：复制 plist 到 `~/Library/LaunchAgents/`，加载 launchd 服务，创建 Applications 目录下的 "CMspark Agent" 启动器（AppleScript 封装），设置开机自启，设置数据目录权限 `0700` |
| `scripts/uninstall-daemon.sh` | **新增** | 卸载脚本：卸载 launchd 服务，删除 plist，删除 Applications 启动器，清理 UDS 锁 |
| `scripts/CMspark\ Agent.app/` | **新增** | AppleScript 应用包：双击启动菜单栏代理进程（`cmspark-agent menu-bar`），不显示在 Dock 中 |

### 4.3 Chrome Extension 改动（最小化）

| 文件/模块 | 改动类型 | 改动内容 |
|-----------|----------|----------|
| `chrome-extension/src/background/index.ts` | 修改 | 增加连接状态检测：当 WebSocket 断开时，通过 Chrome `notifications` API 显示 "Companion 未运行，请点击菜单栏图标启动" 提示 |
| `chrome-extension/src/sidepanel/index.tsx` | 修改 | 在连接断开状态下显示友好提示："Companion 守护进程未运行，请通过菜单栏启动"，并提供 "重试连接" 按钮 |

### 4.4 构建与分发

| 文件/模块 | 改动类型 | 改动内容 |
|-----------|----------|----------|
| `companion/package.json` | 修改 | `bin` 字段已定义 `cmspark-agent`，保持不变；确保 `files` 字段包含 `dist/`、`scripts/` |
| `package.json` (根目录) | 修改 | 新增根级别脚本：`install:macos` -> `cd companion && npm run build && ./scripts/install-daemon.sh` |
| `README.md` | 修改 | 新增"macOS 后台常驻"章节，说明安装/卸载/自启配置方法 |

---

## 5. 开发计划

### 5.1 Phase 1: 守护进程基础设施（2 天）

| 任务 | 文件 | 说明 |
|------|------|------|
| Unix Domain Socket 锁 | `companion/src/daemon.ts` | 实现 UDS 锁替代 PID 文件，解决 TOCTOU 竞态 |
| CLI 扩展 | `companion/src/index.ts` | 新增 `daemon start/stop/status/logs` 子命令 |
| Server 集成 | `companion/src/server.ts` | 启动时写 UDS 锁，关闭时清理 |
| 配置增强 | `companion/src/config.ts` | 日志目录权限 `0o700` |

### 5.2 Phase 2: 菜单栏代理（2 天）

| 任务 | 文件 | 说明 |
|------|------|------|
| 菜单栏代理骨架 | `companion/src/menu-bar-agent.ts` | node-notifier 集成、菜单构建 |
| 状态检测优化 | `companion/src/menu-bar-agent.ts` | 轮询改事件驱动（监听 PID 文件 mtime 或 UDS 状态文件） |
| 菜单交互 | `companion/src/menu-bar-agent.ts` | 启动/停止/状态/打开日志/退出 |

### 5.3 Phase 3: macOS 系统集成（1.5 天）

| 任务 | 文件 | 说明 |
|------|------|------|
| launchd plist | `scripts/launchd/com.cmspark.companion.plist` | 标准 plist 配置，含 ThrottleInterval |
| 安装脚本 | `scripts/install-daemon.sh` | 安装、权限设置、Applications 启动器创建 |
| 卸载脚本 | `scripts/uninstall-daemon.sh` | 清理所有安装产物 |
| AppleScript 启动器 | `scripts/CMspark\ Agent.app/` | 双击启动菜单栏代理 |

### 5.4 Phase 4: Extension 优化与测试（1.5 天）

| 任务 | 文件 | 说明 |
|------|------|------|
| 断开连接提示 | `chrome-extension/src/background/index.ts` | Chrome notifications API |
| Side Panel 占位 UI | `chrome-extension/src/sidepanel/index.tsx` | 离线状态提示 |
| 守护进程测试 | `companion/tests/daemon.test.ts` | 启动/停止/重启/端口占用 |
| launchd 集成测试 | `companion/tests/launchd.test.ts` | 开机自启、日志轮转 |
| 文档更新 | `README.md` | 安装指南、故障排查 |

### 5.5 总投入

| Phase | 人天 | 里程碑 |
|-------|------|--------|
| Phase 1 | 2 | `cmspark-agent daemon start/stop/status` CLI 可用 |
| Phase 2 | 2 | 菜单栏图标显示，可一键启停 Companion |
| Phase 3 | 1.5 | launchd 安装/卸载脚本可用，支持开机自启 |
| Phase 4 | 1.5 | Extension 离线提示 + 测试 + 文档 |
| **合计** | **7** | **完整功能可用** |

---

## 6. 安全加固清单

基于 Security Review 的缓解建议，实施以下关键安全措施：

### 6.1 P0（必须实施）

- [ ] **Unix Domain Socket 锁替代 PID 文件**：`net.createServer().listen('/path/to/socket')`，利用文件系统原子性，消除 TOCTOU 竞态
- [ ] **数据目录权限强制 `0o700`**：`initDataDir()` 中设置 `~/.cmspark-agent/` 权限为 `0700`，日志目录同步设置
- [ ] **WebSocket 始终绑定 `127.0.0.1`**：禁止 `0.0.0.0`，确保仅本地可访问

### 6.2 P1（强烈建议）

- [ ] **terminal-notifier 完整性校验**：CI 构建时校验 `terminal-notifier` 的 SHA256；运行时校验 vendor 目录下二进制签名（`codesign -v`）
- [ ] **日志脱敏增强**：不仅脱敏 API key，还要对 URL、DOM 内容中的敏感信息进行模式匹配脱敏
- [ ] **launchd plist 完整性校验**：安装脚本生成 plist 后计算 SHA256，写入 `~/.cmspark-agent/.plist.sha256`，启动前校验
- [ ] **AppleScript 启动器校验**：AppleScript 文件作为静态资源打包，运行时校验其 SHA256

### 6.3 P2（建议实施）

- [ ] **开机自启明确告知**：首次勾选"开机自启"时弹窗告知用户
- [ ] **菜单栏始终可见运行状态**：提供"立即关闭自启"的一键入口
- [ ] **崩溃重启频率限制**：`ThrottleInterval=30`，连续崩溃 3 次后写入标记文件暂停重启

---

## 7. 性能优化清单

基于 Performance Review 的优化建议，实施以下关键性能措施：

### 7.1 高优先级

- [ ] **将菜单栏代理合并到 Companion 进程内**：Companion 启动时自行调用 `node-notifier` 创建菜单栏，消除双 Node 进程（内存降低 40-60MB）
- [ ] **轮询改事件驱动**：使用 `fsevents` 监听日志文件变化或 Companion 主动写入状态文件，菜单栏被动监听（CPU 空闲占用降至 ~0%）

### 7.2 中优先级

- [ ] **Companion 内存限制**：启动时添加 `--max-old-space-size=128 --max-semi-space-size=16`
- [ ] **日志自动轮转**：按天切割，保留 7 天，单文件上限 10MB
- [ ] **延迟加载非核心模块**：skill 引擎、history store 等按需初始化

### 7.3 低优先级

- [ ] **WebSocket 心跳优化**：空闲时心跳间隔从 5s 延长至 30s
- [ ] **开机自启延迟**：菜单栏/守护进程启动后延迟 5-10 秒再启动 Companion
- [ ] **进程优雅关闭**：SIGTERM 时先关闭 WS 连接、保存线程状态、再退出

---

## 8. 风险与缓解

### 8.1 安全风险

| 风险 | 严重程度 | 缓解措施 |
|------|----------|----------|
| UDS 锁残留 | 低 | 启动时检查并清理残留锁；设置锁文件权限 `0600` |
| launchd 高频重启 | 中 | `ThrottleInterval=30` + 连续崩溃 3 次后暂停 |
| node-notifier 预编译二进制 | 中 | CI 校验 SHA256；运行时 `codesign -v` 校验 |
| 日志文件泄露敏感信息 | 中 | 日志目录 `0o700`；脱敏增强 |
| AppleScript 注入 | 低 | 静态资源 SHA256 校验；不拼接用户输入 |

### 8.2 性能风险

| 风险 | 严重程度 | 缓解措施 |
|------|----------|----------|
| 双 Node 进程内存叠加 | 中 | **Phase 2 实施合并菜单栏代理到 Companion** |
| WS 轮询开销 | 中 | **Phase 2 实施事件驱动替代轮询** |
| 空转资源消耗 | 低 | 空闲时降低心跳频率；Companion 内存限制 |
| launchd 重启风暴 | 低 | `ThrottleInterval=30` + 崩溃暂停机制 |

### 8.3 用户体验风险

| 风险 | 严重程度 | 缓解措施 |
|------|----------|----------|
| Chrome Extension 仍需手动加载 | 中 | 菜单栏提供"打开 Chrome 扩展管理页"快捷方式；提供图文安装向导 |
| 首次安装门槛 | 中 | 提供一键安装命令（复制粘贴到终端）；未来考虑 `.pkg` 安装包 |
| 状态不同步 | 低 | 菜单栏通过实际 WebSocket 握手检测，而非仅检测进程存在 |
| 通知噪音 | 低 | 仅状态变化时通知一次；提供"静默模式"菜单选项 |

### 8.4 维护性风险

| 风险 | 严重程度 | 缓解措施 |
|------|----------|----------|
| node-notifier 跨平台差异 | 中 | 本方案目标 macOS 为主；未来跨平台时替换为平台抽象层 |
| launchd 与 npm 全局安装路径耦合 | 低 | 安装脚本动态检测 `which cmspark-agent` 并写入 plist |
| AppleScript 启动器维护 | 低 | 保持极简（仅调用一行 shell）；文档中说明修改方法 |

---

## 9. 附录：其他方案归档

### 9.1 激进方案（归档）

**技术栈：** SwiftUI 原生菜单栏 + `pkg` 打包独立 Companion 二进制
**预估人天：** 13.5 天
**性能评分：** 8.5 / 10
**安全评分：** 6.0 / 10

**未入选原因：**
1. 项目当前阶段为"安全稳定化 MVP"，13.5 天开发周期过长
2. 引入 Swift 技术栈，需要 iOS 开发者参与，团队当前不具备
3. `pkg` 预编译运行时不可审计，安全评分低于保守方案
4. macOS 专属，跨平台扩展困难

**未来适用条件：**
- 团队配备 iOS/macOS 开发者
- 已解决 `pkg` 完整性校验机制
- 产品进入成熟阶段，追求极致用户体验
- 有预算申请 Apple Developer ID 进行代码签名和公证

**参考文档：** `docs/menu-bar-service/arch-radical.md`

### 9.2 折中方案（归档）

**技术栈：** Electron 主进程-only + 托管 Companion 子进程
**预估人天：** 8.5 天
**性能评分：** 5.5 / 10
**安全评分：** 5.0 / 10

**未入选原因：**
1. 性能代价与收益严重不成正比：130-250MB 常驻内存对于"仅显示一个菜单栏图标"的应用完全不合理
2. Electron 主进程 = 完整高权限 Node.js，安全边界最弱
3. 双 Node 运行时（Electron 内置 Node + Companion Node）意味着双倍的供应链风险
4. `node-auto-launch` 维护状态堪忧（最后更新 2017 年）

**未来适用条件：**
- 团队已有 Electron 经验且时间极度紧张
- 需要跨平台支持（Windows/Linux）作为首要目标
- 愿意接受 Electron 的安全模型并投入额外资源进行主进程沙箱化

**参考文档：** `docs/menu-bar-service/arch-balanced.md`

### 9.3 审查报告归档

| 报告 | 路径 |
|------|------|
| 性能审查报告 | `docs/menu-bar-service/review-performance.md` |
| 安全审查报告 | `docs/menu-bar-service/review-security.md` |

---

*文档结束。本设计文档基于3个 Architecture Agent 的设计和2个 Review Agent 的审查，通过锦标赛模式两两比较后生成。*

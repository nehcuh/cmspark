# Project Context

> **Project-level CLAUDE.md** — highest priority in Claude Code

## Dynamic Workflow Routing

All non-trivial tasks are routed through the `workflows/` directory:

1.  **Analyze** the user request to determine the task type
2.  **Match** against available Workflow templates in `workflows/`
3.  **Execute** the matched Workflow following its phases

Available Workflow categories:
- `workflows/bridge-*.ts` — bridge/ module fixes and reviews
- `workflows/dev-router.ts` — development task routing (bug-fix / feature / refactor / review)

For custom workflows: create a new `.ts` file in `workflows/` following the `meta` + phase function pattern.

## Project-Specific Context

## Project Overview

CMspark — 浏览器内 AI Agent。通过 Chrome Side Panel 与用户交互，通过 Chrome DevTools Protocol 操控浏览器，通过本地 Companion 进程管理 LLM 调用。

双层拓扑：Chrome Extension (Plasmo + React) ↔ WebSocket ↔ Companion (Node.js + TypeScript)

当前阶段：安全稳定化 MVP → 功能扩展中。Side Panel 驱动 Companion/浏览器、线程持久化、tool 调用闭环、安全确认机制已基本完成；正在扩展 Knowledge 系统、Skill Crafting、Daemon 模式、System Tray 等功能。

## Quick Start

```bash
# Extension (Chrome plugin)
cd chrome-extension && npm run dev

# Companion (local agent server)
cd companion && npm start        # production
cd companion && npm run dev      # hot-reload

# Tests
npm --prefix companion test
npm --prefix chrome-extension test
```

Load extension: `chrome://extensions` → "加载已解压的扩展程序" → `chrome-extension/build/chrome-mv3-prod/`

## Architecture

```
Chrome Extension (Plasmo + React)  ←→  WebSocket (ws://127.0.0.1:23401)  ←→  Companion (Node.js + TypeScript)
│                                                                              │
├─ sidepanel/  (React UI, 320px)                                              ├─ server.ts (WS 服务器 + 连接管理)
│  ├─ components/ (ChatView, InputArea, ThreadList, ...)                     ├─ message-router.ts (消息路由 + tool 调度)
│  ├─ hooks/ (useWebSocket)                                                  ├─ llm/adapter.ts (OpenAI streaming + tool calling)
│  └─ store/ (agentStore)                                                    ├─ bridge/ (tool-definitions, tab-resolver)
├─ background/ (Service Worker, CDP, tabs)                                    ├─ skills/ (skill-engine, skill-craft, semantic-match, ...)
│  ├─ browser-bridge.ts (CDP/tabs/cookies)                                   ├─ threads/thread-manager.ts (多线程消息隔离)
│  ├─ page-sanitizer.ts, security-token.ts                                   ├─ history/store.ts (sql.js 操作记录)
│  └─ ws-client.ts, keep-alive.ts                                            ├─ security.ts + security-policy.ts + security-confirmation.ts
└─ popup/ (连接状态)                                                          ├─ security/ (risk-engine, privilege-manager, page-scanner)
                                                                              ├─ tray/ (Swift NSStatusBar / systray2 / readline 适配)
                                                                              ├─ daemon.ts (后台运行 + launchd/systemd)
                                                                              └─ config.ts, logger.ts, platform.ts
```

**消息流**：User Input → Companion → LLM streaming → tool_call → Extension (CDP) → tool_result → Companion → LLM (loop)

**数据目录**：~/.cmspark-agent/ (config.json, skills/, builtin-skills/, builtin-skills/security/, threads/, history.db, logs/, cache/, knowledge/global/, knowledge/sites/)

## Key Design Decisions

- **A1. 双层拓扑**：Extension 只做浏览器操作，LLM 推理和状态管理在 Companion
- **A2. 通信协议**：WebSocket + OpenAI-compatible streaming，异步 tool 回路 (Promise bridge)
- **A3. 数据目录**：~/.cmspark-agent/ 统一管理配置、技能、线程、历史
- **A4. 安全**：多层安全架构 — 信任域通配符 + 风险引擎 + 三级特权模式 (readonly/standard/advanced) + 安全确认队列 + evaluate/osascript 执行前阻断 + 越狱检测 + 错误三级分类
- **A5. Skill 格式**：Markdown + YAML frontmatter，支持内置技能、Skill Crafting、TF-IDF + 语义匹配

## Common Issues

- `config.json corrupted`: `rm ~/.cmspark-agent/config.json` 后重启
- `No tab with id`: LLM 幻觉 tabId，安全策略标记为可恢复，LLM 会自动调用 `list_tabs` 重试
- Companion 端口占用: `npx cmspark-agent daemon stop` 或 `pkill -f "dist/index.js"` 后重启
- Extension 加载失败: 确认 `chrome-extension/build/chrome-mv3-prod/` 存在（需先运行 `npm run build`）
- Tray 不显示: 检查 Swift 编译产物（macOS）或 systray2 安装（Linux）
- PDF 扫描件渲染不可用: `canvas` native 模块缺失时不影响文本 PDF 解析，扫描件会优雅降级输出提示。打包分发时需包含 `canvas` 二进制（macOS/Linux/Windows 均有预编译）

## Related Docs

- docs/GOAL.md — 项目目标与阶段规划
- docs/architecture.md — 完整架构文档
- docs/optimization-roadmap.md — 优化路线图
- docs/adr/ — 架构决策记录

### Tech Stack

### Architecture

### Coding Standards

### Testing

### Deployment

-->

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
└─ popup/ (连接状态)                                                          ├─ security/ (input-validation — see audit 2026-06-16 roadmap item 19)
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
- **A4. 安全**：双层安全架构（实际生效）— ① 信任域通配符门控 cookie 工具 (get_cookies/set_cookie/list_all_cookies 要求 domain 在 trusted_domains)；② `evaluate`/`osascript_eval` 通过 `checkHighRiskExecution` 正则黑名单 + `SecurityConfirmationManager` 交互确认队列阻断。配合 `security-policy.ts`（token 颁发 + HMAC 服务端校验，constant-time）、`security-confirmation.ts`（45s 超时的 Promise-based 确认队列）、`page-sanitizer`（extension 端 ~11 模式 prompt-injection 过滤）、错误三级分类、越狱检测。注：原设计的 risk-engine / privilege-manager / page-scanner 三层在 2026-06-16 审计后删除（dead code，runtime 零调用）；M2 roadmap 计划把 evaluate 改为 default-deny（item 2）+ 新增 navigate 信任门（item 12），届时 A4 会再次更新。
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

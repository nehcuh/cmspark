# Project Context

> **Project-level CLAUDE.md** — highest priority in Claude Code

## VibeSOP Routing

All non-trivial tasks must be routed:

```bash
vibe route "<user_request>"
```

Then read `skills/<matched-skill>/SKILL.md` and follow its steps.

For override protocol: read `docs/routing-protocol.md` in global config.

## Project-Specific Context

## Project Overview

CMspark — 浏览器内 AI Agent。通过 Chrome Side Panel 与用户交互，通过 Chrome DevTools Protocol 操控浏览器，通过本地 Companion 进程管理 LLM 调用。

双层拓扑：Chrome Extension (Plasmo + React) ↔ WebSocket ↔ Companion (Node.js + TypeScript)

当前阶段：安全稳定化 MVP。将 Side Panel 可靠驱动 Companion 和浏览器，线程状态闭环持久化，tool 调用结果进入后续 LLM 上下文，高风险执行在确认机制完成前默认阻断。

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
├─ sidepanel/  (React UI, 320px)                                              ├─ server.ts (WS 服务器 + tool 桥接)
├─ background/ (Service Worker, CDP, tabs)                                    ├─ llm/adapter.ts (OpenAI streaming + tool calling)
└─ store/      (全局状态)                                                     ├─ skills/skill-engine.ts (技能加载/激活/注入)
                                                                              ├─ threads/thread-manager.ts (多线程消息隔离)
                                                                              ├─ history/store.ts (SQLite 操作记录)
                                                                              └─ security.ts (信任域 + 危险 API 检测)
```

**消息流**：User Input → Companion → LLM streaming → tool_call → Extension (CDP) → tool_result → Companion → LLM (loop)

**数据目录**：~/.cmspark-agent/ (config.json, skills/, builtin-skills/, threads/, history.db, logs/)

## Key Design Decisions

- **A1. 双层拓扑**：Extension 只做浏览器操作，LLM 推理和状态管理在 Companion
- **A2. 通信协议**：WebSocket + OpenAI-compatible streaming，异步 tool 回路 (Promise bridge)
- **A3. 数据目录**：~/.cmspark-agent/ 统一管理配置、技能、线程、历史
- **A4. 安全**：Cookie 信任域通配符 + evaluate/osascript 执行前阻断 + 错误三级分类
- **A5. Skill 格式**：Markdown + YAML frontmatter（兼容 VibeSOP），支持内置技能

## Common Issues

- `config.json corrupted`: `rm ~/.cmspark-agent/config.json` 后重启
- `No tab with id`: LLM 幻觉 tabId，安全策略标记为可恢复，LLM 会自动调用 `list_tabs` 重试
- Companion 端口占用: `pkill -f "dist/index.js"` 后重启
- Extension 加载失败: 确认 `chrome-extension/build/chrome-mv3-prod/` 存在（需先运行 `npm run build`）

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

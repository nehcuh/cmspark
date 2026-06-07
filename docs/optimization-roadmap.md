# CMspark Browser Agent — 优化路线图

> 版本: 1.0.0 | 日期: 2026-05-29 | 基于: 全维度深度体检报告
> 状态: 待审批

---

## 总览

基于 2026-05-29 深度体检结果（综合评分 6.2/10），按优先级分四个阶段推进。

| 阶段 | 优先级 | 主题 | 估算工时 | 阻塞关系 |
|------|--------|------|----------|----------|
| Phase 1 | P0 | 核心链路测试补全 | 1 天 | 无 |
| Phase 2 | P1 | 文档补全 + CLAUDE.md 充实 | 0.5 天 | 无 |
| Phase 3 | P2 | 大文件拆分 + 安全加固 | 1.5 天 | 建议 P0 完成后进行 |
| Phase 4 | P3 | 一键启动 + 工程体验 | 0.5 天 | 无 |

---

## Phase 1: P0 — 核心链路测试补全

> **目标**: adapter、skill-engine、server 三个核心模块的 happy-path + 关键边界测试覆盖
> **深度**: Happy-path + 关键边界（约 40-50 用例）
> **验收**: `npm --prefix companion test` 全部通过，新增测试覆盖 adapter/ skill-engine/ server 三个文件

### 1.1 adapter.test.ts — LLM 适配器测试（约 15 用例）

**待测函数**: `createToolResultMessage`, `chatCreate`（context 构建逻辑）

| # | 用例 | 类型 | 说明 |
|---|------|------|------|
| 1 | `createToolResultMessage` 产生正确的 role="tool" 消息 | happy-path | 验证 tool_call link 字段完整 |
| 2 | tool result 的 content 为 JSON.stringify(result) | happy-path | |
| 3 | 空 result 对象的 tool result 不崩溃 | boundary | `result = {}` |
| 4 | toolCall 缺 `id` 字段时的降级行为 | boundary | |
| 5 | 大 tool result 超 8000 字符时被截断并标注原始长度 | boundary | 验证 P1 优化 #5 |
| 6 | `chatCreate` 将 user 消息正确追加到线程 | happy-path | 通过 mock ThreadManager |
| 7 | 历史消息中的 assistant tool_calls 与后续 tool 结果配对验证通过 | happy-path | 验证 compaction 修复 |
| 8 | 历史消息中 tool_calls 无对应 tool 结果时被正确剥离 | boundary | 防止 OpenAI schema 400 错误 |
| 9 | system prompt 包含 skill prompt（当有激活 skill 时） | happy-path | |
| 10 | system prompt 不包含 skill prompt（当无激活 skill 时） | boundary | |
| 11 | MAX_TOOL_CALL_ROUNDS 达到上限后停止 | boundary | 防止无限循环 |
| 12 | CONTINUOUS_FAILURE_LIMIT 达到后返回错误 | boundary | |
| 13 | API timeout 120s 后正确处理 | boundary | 验证 P0 优化 #3 |
| 14 | signal abort 时正确中断 | boundary | |
| 15 | 空消息历史时 context 构建不崩溃 | boundary | |

### 1.2 skill-engine.test.ts — 技能引擎测试（约 15 用例）

**待测函数**: `SkillEngine.loadFromDir`, `SkillEngine.activate`, `SkillEngine.deactivate`, `SkillEngine.buildSystemPrompt`, `SkillEngine.importFromPath`, `SkillEngine.exportSkill`

| # | 用例 | 类型 | 说明 |
|---|------|------|------|
| 1 | 从目录加载 .md skill 文件 | happy-path | 用临时目录 mock skills |
| 2 | 从目录加载 folder-based skill（含 SKILL.md） | happy-path | |
| 3 | 加载带 YAML frontmatter 的 skill，解析 name/description/type | happy-path | |
| 4 | 加载无 frontmatter 的 .md 文件（fallback 文件名） | boundary | |
| 5 | `activate` 后 skill 出现在 threadSkillMap | happy-path | |
| 6 | `deactivate` 后从 threadSkillMap 移除 | happy-path | |
| 7 | `buildSystemPrompt` 返回紧凑索引（非全文） | happy-path | 验证 P0 优化 #1 |
| 8 | `buildSystemPrompt` 无激活 skill 时返回空字符串 | boundary | |
| 9 | 同名 skill 的 builtin 与 user 版本去重（user 优先？builtin 优先？） | boundary | 明确覆盖策略 |
| 10 | `importFromPath` 目录导入（复制到 skills/ 目录） | happy-path | |
| 11 | `importFromPath` 单个 .md 文件导入 | happy-path | |
| 12 | `importFromPath` 路径不存在时的错误处理 | boundary | |
| 13 | `importFromPath` 非 .md 文件被忽略 | boundary | |
| 14 | `exportSkill` 输出正确的 YAML + markdown | happy-path | |
| 15 | 非法 frontmatter YAML 时 skill 被跳过不崩溃 | boundary | |

### 1.3 server.test.ts — 服务器核心逻辑测试（约 15 用例）

**待测函数**: `createToolExecutor`, `summarizeMessage`, `summarizeToolParams`, `initServices`

| # | 用例 | 类型 | 说明 |
|---|------|------|------|
| 1 | Cookie tool 在信任域内通过安全检查 | happy-path | mock isTrustedDomain → true |
| 2 | `get_cookies` 域名不在信任域时被阻断 | boundary | |
| 3 | `set_cookie` 直传 domain 参数时通过/阻断 | happy-path | |
| 4 | `set_cookie` 传 url 参数时自动提取 domain | boundary | |
| 5 | `list_all_cookies` 仅在 "*" 信任时放行 | boundary | |
| 6 | 高风险 execute 触发 security confirmation 请求 | happy-path | |
| 7 | tool 执行超时（TOOL_EXECUTION_TIMEOUT_MS）后返回错误 | boundary | |
| 8 | tool.start 事件在 execute 开始时发送 | happy-path | |
| 9 | tool.finish 日志在 execute 结束时记录 | happy-path | |
| 10 | `summarizeMessage` 处理各种消息类型不崩溃 | boundary | |
| 11 | `summarizeToolParams` 脱敏 code/expression 长度不暴露内容 | boundary | |
| 12 | `initServices` 创建 ThreadManager/SkillEngine/HistoryStore 实例 | happy-path | |
| 13 | WebSocket client 连接时初始化 services（仅首次） | boundary | |
| 14 | 未知消息类型返回错误不崩溃 | boundary | |
| 15 | 并发多个 tool call 时各自独立 resolve | boundary | |

### 1.4 补充现有测试（约 5 用例）

| # | 文件 | 用例 | 类型 |
|---|------|------|------|
| 1 | security-thread.test.ts | `classifyError("No tab with id 303")` → recoverable | boundary |
| 2 | security-thread.test.ts | `classifyError("unknown error")` → non_recoverable | boundary |
| 3 | security-thread.test.ts | `classifyError("permission denied: camera")` → non_recoverable | boundary |
| 4 | security-thread.test.ts | `classifyError("timeout waiting for selector")` → recoverable | boundary |
| 5 | sidepanel-state.test.ts | reducer 处理未知 action type 不崩溃 | boundary |

---

## Phase 2: P1 — 关键文档补全

> **目标**: 充实 CLAUDE.md、创建设计系统文档、记录核心 ADR

### 2.1 CLAUDE.md 充实

当前 CLAUDE.md 路由部分需持续更新：

```markdown
## Project Overview
CMspark — 浏览器内 AI Agent。通过 Chrome Side Panel 与用户交互，
通过 Chrome DevTools Protocol 操控浏览器，通过本地 Companion 进程管理 LLM 调用。

双层拓扑：Chrome Extension (Plasmo + React) ↔ WebSocket ↔ Companion (Node.js + TypeScript)

## Quick Start
- Extension: cd chrome-extension && npm run dev
- Companion: cd companion && npm start (or npm run dev for hot-reload)
- Tests: npm --prefix companion test

## Key Architecture Decisions
- A1. 双层拓扑：Extension 只管浏览器操作，LLM 推理在 Companion
- A2. 通信协议：WebSocket + OpenAI-compatible streaming
- A3. 数据目录：~/.cmspark-agent/ (config.json, skills/, threads/, history.db)
- A4. 安全：Cookie 信任域通配符 + evaluate/osascript 执行前阻断
```

### 2.2 DESIGN.md 创建

从现有 inline styles 中提取设计 token：

```markdown
# CMspark Design System

## Colors
- Primary: #4A90D9
- Error: #F44336
- Background: #fff / #f5f5f5
- Text: #333

## Typography
- Font: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif
- Size scale: 11px (code), 12px (button), 13px (body)

## Spacing
- Padding: 6px/12px/16px/20px
- Border radius: 6px

## Components
快速参考现有组件的视觉规范...
```

### 2.3 ADR 创建（Top 5 架构决策记录）

```
docs/adr/
├── 001-双层拓扑-extension-companion.md
├── 002-websocket-openai-streaming协议.md
├── 003-sqlite-history-store.md
├── 004-skill-markdown-yaml格式.md
└── 005-cookie-trust-domain-security.md
```

### 2.4 补充文档

| 文档 | 内容要点 |
|------|----------|
| TROUBLESHOOTING.md | "No tab with id" / config.json 损坏 / companion 端口占用 / extension 加载失败 |
| TESTING.md | 测试架构说明 / 如何运行 / 如何新增测试 |

---

## Phase 3: P2 — 大文件拆分 + 安全加固

> **建议在 P0 测试补全后进行**，确保重构有安全网

### 3.1 App.tsx 拆分（670 行 → ~150 行）

```
chrome-extension/src/sidepanel/
├── App.tsx              # ~150 行：ErrorBoundary + Provider + 布局骨架
├── components/
│   ├── layout/
│   │   ├── TopBar.tsx          # 连接状态 + 线程切换 + 新建线程按钮
│   │   ├── MainPanel.tsx       # 聊天区 + 底部输入区的容器
│   │   └── ConnectionStatus.tsx # 绿/黄/红圆点 + Badge
│   ├── chat/
│   │   ├── ChatView.tsx        # 已有
│   │   ├── MessageCard.tsx     # 已有
│   │   ├── ToolCallCard.tsx    # 已有
│   │   └── InputArea.tsx       # 从 App.tsx 提取输入框 + 发送逻辑
│   ├── panels/
│   │   ├── BottomBar.tsx       # 已有
│   │   ├── TabPanel.tsx        # 已有
│   │   ├── HistoryPanel.tsx    # 已有
│   │   └── SkillPanel.tsx      # 已有
│   └── settings/
│       ├── SettingsSlideout.tsx # 已有
│       └── SettingsForm.tsx     # 从 SettingsSlideout 提取表单逻辑
```

### 3.2 server.ts 职责拆分（471 行 → ~200 行）

```
companion/src/
├── server.ts                    # ~200 行：WS 服务器启动 + 生命周期
├── server/
│   ├── connection-manager.ts     # 连接建立/断开/心跳 + clients Set
│   ├── message-handler.ts        # 消息路由 + chat.create/tool.result 等处理
│   ├── tool-executor.ts          # createToolExecutor + 安全预检 + 超时
│   └── log-helpers.ts            # summarizeMessage/ToolParams/ToolResult + logToolFinish
```

### 3.3 安全加固

| # | 问题 | 修复 | 文件 |
|---|------|------|------|
| 1 | DANGEROUS_APIS 字符串匹配误报 | 改用正则 + 单词边界：`/\bfetch\s*\(/` | security.ts |
| 2 | `"*"` 全局信任域太危险 | 添加配置校验：设置 `"*"` 时弹出警告，或拆分为独立开关 | config.ts + security.ts |
| 3 | Companion WS 无连接数限制 | 加 `MAX_CLIENTS = 5` 连接数上限 | server.ts |
| 4 | Skill YAML 无注入校验 | 对 skill 的 name/description 字段做长度和字符集校验 | skill-engine.ts |
| 5 | 日志 level 不可动态调整 | 通过 config.get/set 消息动态切换 level | config.ts + logger.ts |

---

## Phase 4: P3 — 工程体验优化

| # | 任务 | 说明 |
|---|------|------|
| 1 | 创建 `Makefile` 或 `justfile` | 一键启动：`make dev` 同时启动 companion + extension |
| 2 | extension 加载脚本化 | 生成 `make load-extension` 自动打开 `chrome://extensions` 并指引加载 |
| 3 | `.gitignore` 清理 | 将 `tsconfig.tsbuildinfo` 加入 .gitignore |
| 4 | 开发环境文档 | 补充 CONTRIBUTING.md 开发环境搭建流程 |

---

## 执行顺序建议

```
Phase 1 (P0 测试) ────── 1 天 ──┐
                                  ├──▶ Phase 3 (P2 重构+安全) ── 1.5 天
Phase 2 (P1 文档) ──── 0.5 天 ──┘
                                  
Phase 4 (P3 工程) ──── 0.5 天 ── 随时可做，无阻塞
```

- Phase 1 和 Phase 2 可并行（无依赖）
- Phase 3 建议在 Phase 1 完成后进行（重构需要测试安全网）
- Phase 4 无阻塞，随时可做

---

## 预期成果

完成后综合评分从 **6.2/10** 提升到 **7.5/10**：

| 维度 | 当前 | 目标 | 提升 |
|------|------|------|------|
| 测试覆盖 | 4/10 | 6.5/10 | adapter/skill-engine/server 核心覆盖 |
| 文档完整 | 6/10 | 7.5/10 | CLAUDE.md + DESIGN.md + ADR + TROUBLESHOOTING |
| 代码实现 | 6/10 | 7/10 | App.tsx / server.ts 拆分 |
| 安全架构 | 6/10 | 7/10 | 正则匹配 + 连接限制 + 输入校验 |
| 综合 | 6.2/10 | 7.5/10 | +1.3 |

---

*路线图基于 2026-05-29 深度体检报告生成。审批通过后按阶段执行。*

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

当前阶段：安全稳定化 MVP → 功能扩展中。Side Panel 驱动 Companion/浏览器、线程持久化、tool 调用闭环、安全确认机制已基本完成；正在扩展 Knowledge 系统、Skill Crafting、Daemon 模式、System Tray 等功能。**Obsidian 对话导出已交付**（单条/整 thread 📥 + 🧠 NotebookLM 摘要；vault 档案 + wikilinks/模板，详见 [ADR-008](docs/adr/008-obsidian-export.md)，PR #5）。**Side Panel Mermaid 图表渲染已交付**（流程图/时序图/gantt 等全类型；CSP-safe 客户端直跑 + 纵深防御净化 + 响应式点击放大，详见 [ADR-009](docs/adr/009-mermaid-rendering.md)，PR #9）。

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
│  │   + 📥 per-message/header export, 🧠 summary                            ├─ llm/llm-extract.ts (one-shot structured extraction: profile/summary)
│  └─ store/ (agentStore)                                                    ├─ bridge/ (tool-definitions, tab-resolver)
├─ background/ (Service Worker, CDP, tabs)                                    ├─ skills/ (skill-engine, skill-craft, semantic-match, ...)
│  ├─ browser-bridge.ts (CDP/tabs/cookies)                                   ├─ threads/thread-manager.ts (多线程消息隔离)
│  ├─ page-sanitizer.ts, security-token.ts                                   ├─ history/store.ts (sql.js 操作记录)
│  └─ ws-client.ts, keep-alive.ts                                            ├─ security.ts + security-policy.ts + security-confirmation.ts
└─ popup/ (连接状态)                                                          ├─ security/ (input-validation — see audit 2026-06-16 roadmap item 19)
                                                                              ├─ tray/ (Swift NSStatusBar / systray2 / readline 适配)
                                                                              ├─ daemon.ts (后台运行 + launchd/systemd)
                                                                              ├─ obsidian/ (vault-profiler, vault-index, vault-templates, threads/summary-export, folder-picker)
                                                                              └─ config.ts, logger.ts, platform.ts
```

**消息流**：User Input → Companion → LLM streaming → tool_call → Extension (CDP) → tool_result → Companion → LLM (loop)

**导出流**（Obsidian）：UI 📥/🧠 → `thread.export_obsidian` → Companion 序列化（+ vault 档案/索引/模板套用 + 摘要 LLM 调用）→ `thread.exported_obsidian` → 浏览器 Blob 下载（不写宿主文件）

**数据目录**：~/.cmspark-agent/ (config.json, skills/, builtin-skills/, builtin-skills/security/, threads/, history.db, logs/, cache/, knowledge/global/, knowledge/sites/, **obsidian/ (profile.json + vault-index.json + templates.json — vault 档案/索引/模板缓存, mode 0o600)**)

## Key Design Decisions

- **A1. 双层拓扑**：Extension 只做浏览器操作，LLM 推理和状态管理在 Companion
- **A2. 通信协议**：WebSocket + OpenAI-compatible streaming，异步 tool 回路 (Promise bridge)
- **A3. 数据目录**：~/.cmspark-agent/ 统一管理配置、技能、线程、历史
- **A4. 安全**：双层安全架构（实际生效）—
  - ① **Cookie 信任域**：`trusted_domains` 通配符门控 cookie 工具（`get_cookies`/`set_cookie`/`delete_cookie`/`list_all_cookies`）。
  - ② **`evaluate`/`osascript_eval` 默认阻断**：所有调用强制走 `SecurityConfirmationManager` 交互确认；`checkHighRiskExecution` 正则黑名单（~57 模式）仅作为风险预览升级提示，不再 gate WHETHER to confirm。
  - ③ **`navigate`/`create_tab`/`set_tab_url` URL 门**：非 http(s) scheme 直接阻断；hostname 不在 `trusted_domains` ∪ `auto_approved_domains` 时强制确认。
  - ④ **域白名单 + 全局自动批准**（2026-06-24 新增，详见 [ADR-007](docs/adr/007-domain-whitelist-auto-approve.md)）：
    - `auto_approved_domains: string[]` — 独立于 `trusted_domains`，专管工具执行确认的跳过（evaluate/navigate 等），支持 `*` / 精确 / `*.suffix` 通配符。
    - `security.auto_approve_dangerous: boolean`（默认 false）— 全局 kill-switch，跳过所有危险工具确认；仅供无人值守工作流。
    - 确认弹窗支持「添加到白名单」单选（精确 / `*.domain` 通配符），由 extension 端构造 pattern；companion 端**强制校验** add_to_whitelist 必须等于 `relevant_domains[0]` 或其通配形式，防止 WS 注入。
  - ⑤ **关键实现要点**：`osascript_eval` 因属宿主执行（任意 shell）**不走域白名单**，只能由全局开关放行；`tabUrlCache` 在 `list_tabs`/`navigate`/`set_tab_url`/`create_tab` 后同步刷新，避免跨域自动批准；`respondFrom` 必须先于 `saveConfig` 完成，且白名单持久化以 `responded === true` 为前提。
  - 配合 `security-policy.ts`（token 颁发 + HMAC 服务端校验，constant-time）、`security-confirmation.ts`（45s 超时的 Promise-based 确认队列 + origin 绑定）、`page-sanitizer`（extension 端 ~11 模式 prompt-injection 过滤）、错误三级分类、越狱检测。
  - 注：原设计的 risk-engine / privilege-manager / page-scanner 三层在 2026-06-16 审计后删除（dead code，runtime 零调用）。
- **A5. Skill 格式**：Markdown + YAML frontmatter，支持内置技能、Skill Crafting、TF-IDF + 语义匹配
- **A6. Obsidian 对话导出**（2026-06-30，详见 [ADR-008](docs/adr/008-obsidian-export.md)）— 把对话导出成贴合 vault 约定的 markdown 笔记：
  - **UI 下载（v1）**：companion 生成 markdown → 浏览器 Blob 下载；**不写宿主文件、无路径沙箱**。
  - **四档导出**：单条 `single`（📥 per-message）/ 整 thread（📥 header）/ 🧠 NotebookLM 摘要（LLM 结构化 TL;DR·关键主题·结论·决策·待办 + 折叠完整对话附录）。
  - **vault 档案**：扫描 ~200 篇笔记，LLM 提取 frontmatter/命名/tag 约定（**隐私：仅 basename + frontmatter(capped) + 正文前 200 字**），缓存于 `~/.cmspark-agent/obsidian/`，导出套用；frontmatter 用**行解析器**（非 yaml.load，保 `{{}}`/冒号/URL）。
  - **wikilinks/模板**：纯 TF 余弦（复用 semantic-match，不加 IDF）top-K footer `[[wikilinks]]`；模板骨架**静态占位符替换**（`{{title}}`/`{{date}}`/常见 `<% tp.* %>`），**不执行 Templater JS**。
  - **健壮性/安全**：`resolveTemplatesDir` 在 **realpath** 上做 containment（防 symlink 逃逸/TOCTOU）；`stripLoneSurrogates` 防 emoji/CJK 切分产生的 lone surrogate 致 LLM 400；`folder-picker` 走 companion 原生对话框（扩展无法读真实路径）。
- **A7. Side Panel Mermaid 图表渲染**（2026-07-01，详见 [ADR-009](docs/adr/009-mermaid-rendering.md)）— 把 ` ```mermaid ` 块渲染成 SVG 图（流程图/时序图/gantt/类图/ER/状态机…全类型）：
  - **客户端直跑 + strict CSP**：spike 验证 mermaid 11.16 无 eval 类构造，MV3 默认 CSP 下直跑；**无需** sandbox/offscreen/server。
  - **纵深防御净化**：`securityLevel:'strict'` + `htmlLabels:false`（纯 SVG）→ DOMPurify SVG profile 二次过；特权页面下不可信 SVG 绝不绕过净化。
  - **仅落定消息渲染**（`renderMermaid` prop 分流，流式当代码块）；**响应式缩放 + 点击新标签页开全尺寸**（Blob URL）；懒加载 + idle/流式双预取；坏语法回退代码块 + 错误标签。
  - **关键坑**：`@mermaid-js/parser` 的 `exports` 缺 `default` 需 Parcel `alias`；`htmlLabels:false` 是 mandatory（DOMPurify SVG profile 剥 `foreignObject`，否则节点文字消失）；React 异步 effect 用 `pending`/`isConnected` 守竞态。
- **A8. Tray 配对码弹窗**（2026-07-13）— 既然做了 tray，配对（`ws_secret`）就不该逼用户开命令行：
  - **触发**：tray 启动后若扩展**从未配对**（`~/.cmspark-agent/.paired` 不存在）且 `ws_secret` 已生成，**自动弹一次**配对窗；常驻菜单项「🔑 显示配对码」可随时重显。Swift backend 弹原生可选窗口（📋 复制 / 🧩 复制并打开 Chrome）；systray2/readline 退化成「复制到剪贴板 + 系统通知」。
  - **密钥流向**：launcher（`menu-bar-agent.ts`）读 `ws_secret` → 经 stdin JSON `{cmd:"show-pairing-window",secret,paired}` 推给 Swift 二进制（`Tray.swift` PairingController）。**密钥只走这条 stdin 管道，从不落日志**。
  - **`.paired` 契约（跨进程，必须保持 lock-step）**：companion 在首次 `auth.ok` 时由 `ws-auth.markPaired()` 幂等写 `~/.cmspark-agent/.paired`（0o600，best-effort 不阻塞鉴权）；launcher 的 `tray/pairing.ts hasPaired()` 读它判断是否停止自动弹窗。两侧文件名/目录必须一致（皆基于 `DATA_DIR`/`getConfigDir()`）—— 任一方改名都会让自动弹窗永远停不下来。
  - **Swift 二进制完整性**：改 `Tray.swift` 后必须 `bash companion/src/tray/build-tray.sh` 重编译，并把输出的 SHA256 更新到 `swift-tray-bridge.ts` 的 `SWIFT_TRAY_SHA256`（launcher 启动时校验哈希，不匹配则自动重编）。

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

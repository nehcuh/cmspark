# CMspark Browser Agent — 项目目标

> 版本: 1.1.0 | 日期: 2026-05-26 | 当前阶段：安全稳定化 MVP

---

## 定位

一个**浏览器内的 AI Agent**，通过 Chrome Side Panel 与用户交互，通过 CDP/Chrome APIs 操作浏览器，通过本地 Companion 进程管理 LLM 调用、对话状态和技能系统。

---

## 当前真实目标：安全稳定化 MVP

当前阶段的目标不是一次性完成完整企业级自动化平台，而是先把可验证、可恢复、可安全中断的浏览器 Agent MVP 做稳定：Side Panel 能可靠驱动 Companion 和浏览器，线程状态能闭环持久化，工具调用结果能进入后续 LLM 上下文，高风险浏览器/系统执行在确认机制完成前默认阻断，并建立最小回归测试来保护这些核心路径。

本阶段完成后，CMspark 应该能安全地执行受控网页读取、标签页管理、常见页面交互、Type A Prompt Skill 和基本操作历史记录；复杂 SSO 自动发现、录制回放、Type B/C Skills、Daemon 化和跨系统长期任务编排属于稳定化后的扩展目标。

---

## 稳定化 MVP 目标

### G1. 浏览器操控能力

Agent 可以在用户授权下对任意标签页执行全部 23 种工具操作：

| 类别 | 工具 |
|------|------|
| 标签页管理 | `list_tabs`, `create_tab`, `close_tab`, `navigate`, `screenshot` |
| 页面读取 | `get_page_text`, `get_page_html`, `get_element_info` |
| 页面交互 | `click`, `dblclick`, `type`, `fill_form`, `scroll`, `press_key`, `hover`, `select_option`, `drag_and_drop` |
| 高级操作 | `wait_for`, `evaluate`, `upload_file`, `download` |
| Cookie 管理 | `get_cookies`, `set_cookie`, `delete_cookie`, `list_all_cookies` |

### G2. 受控认证上下文使用

当前阶段只要求在显式信任域配置下读取和操作 cookie，并对域外或全量 cookie 操作进行阻断/确认。自动发现企业 SSO 映射、跨系统免登录编排属于扩展目标。

### G3. LLM 灵活配置

- 支持 base_url, api_key, model_name, temperature, context_window
- 全局默认配置 + 每个线程可独立覆盖
- 默认 DeepSeek v4-pro，通过 `DEEPSEEK_API_KEY` 环境变量零配置启用
- Side Panel 滑出设置面板 + CLI 配置文件双入口

### G4. 多线程对话隔离

- 多条对话线程并行存在
- 消息历史独立隔离
- LLM 配置独立覆盖（Thread A 用 deepseek，Thread B 用 gpt-4o）
- 可选工具权限覆盖
- Thread ID: 6 位 short-id + 用户别名

### G5. Type A Skills（Prompt 模板）

- Markdown + YAML frontmatter 格式
- 激活后注入 system prompt 指导 Agent 行为
- 内置精选 skills: `writing-skills`（技能创建方法论）、`grill-me`（设计审查）、`browse`（浏览器操作指南）
- `browse` skill 每个新线程默认激活

### G6. Skill 导入导出

- 单个 skill 导出为 `.md` 文件
- 拖拽 `.md` 文件导入
- 从 URL 安装 skill
- 团队间通过 Git/文件分享复用

### G7. 操作历史与线程上下文可追溯

- Tool-call 级别记录（工具名、参数、结果、耗时、时间戳）
- Companion SQLite 存储（`~/.cmspark-agent/history.db`）
- 工具调用结果同步进入线程消息历史，后续 LLM turn 可以引用真实 tool result
- 按线程分组展示，时间线倒序
- 全文搜索（按工具名、关键词）
- JSON 导出
- 可配置保留天数（默认 30 天）

### G8. 安全护栏

- **evaluate/osascript 安全**: 高风险代码在确认队列完成前默认执行前阻断
- **Cookie 信任域**: 通配符域名匹配（`*.company.com`），域内自由操作，域外阻断或进入确认流程
- **错误分级**: 可恢复（自动重试上限3次）→ 不可恢复（暂停提示用户）→ 安全（硬阻断）
- **用户中断**: Stop 按钮随时终止 Agent 执行

### G9. Side Panel 原生体验

```
┌──────────────────────┐
│ ☰ Threads    [+新建]  │  顶部栏
│ [线程列表（可折叠）]   │
├──────────────────────┤
│ 消息列表（可滚动）     │  聊天区
│ - 用户消息            │  - Streaming token 渲染
│ - Agent 回复          │  - Tool call 卡片（状态+结果）
│ - 错误提示            │
├──────────────────────┤
│ 📎 [Tabs][Hist][Skills]│  底部上下文栏
├──────────────────────┤
│ [输入框]          [▶] │  输入区
└──────────────────────┘
```

- 持久化 Side Panel，320px 宽度可用
- 连接状态实时指示（绿/黄/红圆点 + Badge）
- Companion 断连时全屏友好提示 + 复制启动命令按钮

---

## 稳定化完成标准

- `npm --prefix companion test` 覆盖核心安全/线程/工具结果回归路径。
- `npm --prefix companion run build` 与 `npm --prefix chrome-extension run build` 均可通过。
- Pin Tab 等线程状态从 Side Panel 更新后能同步保存到 Companion thread metadata。
- Assistant tool call 与 tool result 均能被持久化，并能作为后续上下文恢复。
- `evaluate` / `osascript_eval` 高风险输入不会在用户确认机制缺失时被执行。

---

## 稳定化后的扩展目标

### G10. 统一认证 SSO 自动复用

企业内多个系统使用同一认证平台时，Agent 能自动发现已有 session，跨系统免登录操作。Agent 自动检测信任域内 cookie 并匹配 SSO 映射。

### G11. Type B Skills（工具链/流程）

参数化的操作序列，按步执行，条件分支，错误处理。用户可录制操作自动生成 skill，复用时填写参数即可重放。

### G12. Type C Skills（子 Agent）

独立上下文的子 Agent，并发上限 3，超时 120s。默认继承父线程权限可降级。结果摘要返回主 Agent。

### G13. "保存对话为 Skill"

从对话历史中提取可复用操作序列 → LLM 辅助参数化 → 生成 skill 文件 → 用户确认/调整 → 测试运行 → 保存。由 `writing-skills` 内置 skill 提供方法论支持。

### G14. 操作历史重放

从历史记录中选择操作点，从该点重新执行。

### G15. Daemon 模式

- `cmspark-agent start --daemon` 后台运行
- launchd/systemd 开机自启模板

---

## 架构约束

| 约束 | 说明 |
|------|------|
| **A1. 双层拓扑** | Extension (Plasmo + React) ↔ WebSocket ↔ Companion (Node.js + TypeScript) |
| **A2. 职责分离** | Extension 只做浏览器操作，LLM 推理和状态管理在 Companion |
| **A3. Manifest V3** | Service Worker 后台，Alarm keep-alive，全部权限预声明 |
| **A4. CLI 部署** | `cmspark-agent start/stop/status`，固定端口 23401 |
| **A5. 数据目录** | `~/.cmspark-agent/`（config.json, skills/, threads/, history.db, logs/） |
| **A6. 通信协议** | WebSocket + OpenAI-compatible streaming，异步 tool 回路（Promise bridge） |

---

## 技术栈

| 层 | 技术 |
|----|------|
| Extension 构建 | Plasmo + React + TypeScript |
| Extension 通信 | chrome.runtime.sendMessage + chrome.runtime.onMessage |
| Companion CLI | Node.js + TypeScript |
| WebSocket | `ws` 库 |
| LLM 适配 | OpenAI SDK（兼容自定义 base_url） |
| 数据库 | better-sqlite3（操作历史） |
| Skill 格式 | Markdown + YAML frontmatter |
| 配置存储 | chrome.storage.local (extension) + JSON 文件 (companion) |

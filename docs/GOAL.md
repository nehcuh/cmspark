# CMspark Browser Agent — 项目目标

> 版本: 1.0.0 | 日期: 2026-05-24 | 基于 30 项设计决策

---

## 定位

一个**浏览器内的 AI Agent**，通过 Chrome Side Panel 与用户交互，通过 CDP/Chrome APIs 操作浏览器，通过本地 Companion 进程管理 LLM 调用、对话状态和技能系统。

---

## 核心目标 (MVP v0.1)

### G1. 浏览器操控能力

Agent 可以在用户授权下对任意标签页执行全部 23 种工具操作：

| 类别 | 工具 |
|------|------|
| 标签页管理 | `list_tabs`, `create_tab`, `close_tab`, `navigate`, `screenshot` |
| 页面读取 | `get_page_text`, `get_page_html`, `get_element_info` |
| 页面交互 | `click`, `dblclick`, `type`, `fill_form`, `scroll`, `press_key`, `hover`, `select_option`, `drag_and_drop` |
| 高级操作 | `wait_for`, `evaluate`, `upload_file`, `download` |
| Cookie 管理 | `get_cookies`, `set_cookie`, `delete_cookie`, `list_all_cookies` |

### G2. 统一认证 SSO 自动复用

企业内多个系统使用同一认证平台时，Agent 能自动发现已有 session，跨系统免登录操作。Agent 自动检测信任域内 cookie 并匹配 SSO 映射。

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

- Markdown + YAML frontmatter 格式（兼容 VibeSOP）
- 激活后注入 system prompt 指导 Agent 行为
- 内置精选 skills: `writing-skills`（技能创建方法论）、`grill-me`（设计审查）、`browse`（浏览器操作指南）
- `browse` skill 每个新线程默认激活

### G6. Skill 导入导出

- 单个 skill 导出为 `.md` 文件
- 拖拽 `.md` 文件导入
- 从 URL 安装 skill
- 团队间通过 Git/文件分享复用

### G7. 操作历史全量记录

- Tool-call 级别记录（工具名、参数、结果、耗时、时间戳）
- Companion SQLite 存储（`~/.cmspark-agent/history.db`）
- 按线程分组展示，时间线倒序
- 全文搜索（按工具名、关键词）
- JSON 导出
- 可配置保留天数（默认 30 天）

### G8. 安全护栏

- **evaluate 安全**: 危险 API（fetch/cookie/localStorage）检测 + 执行前用户确认
- **Cookie 信任域**: 通配符域名匹配（`*.company.com`），域内自由操作，域外逐次确认
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

## 扩展目标 (v2)

### G10. Type B Skills（工具链/流程）

参数化的操作序列，按步执行，条件分支，错误处理。用户可录制操作自动生成 skill，复用时填写参数即可重放。

### G11. Type C Skills（子 Agent）

独立上下文的子 Agent，并发上限 3，超时 120s。默认继承父线程权限可降级。结果摘要返回主 Agent。

### G12. "保存对话为 Skill"

从对话历史中提取可复用操作序列 → LLM 辅助参数化 → 生成 skill 文件 → 用户确认/调整 → 测试运行 → 保存。由 `writing-skills` 内置 skill 提供方法论支持。

### G13. 操作历史重放

从历史记录中选择操作点，从该点重新执行。

### G14. Daemon 模式

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

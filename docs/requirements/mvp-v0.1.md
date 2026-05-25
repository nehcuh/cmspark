# CMspark Browser Agent — MVP v0.1 产品需求

> 版本: 1.0.0 | 日期: 2026-05-24 | 状态: 已确认

---

## R1 — Extension 基础框架

### R1.1 项目初始化
- Plasmo + React 项目脚手架
- TypeScript 配置
- Manifest V3 配置（含所有权限声明）
- 目录结构建立

### R1.2 Service Worker（background）
- WebSocket 客户端（连接 companion，自动重连）
- Alarm keep-alive 机制
- chrome.storage 配置同步

### R1.3 Side Panel 框架
- Side Panel 页面注册与入口
- React 根组件挂载
- WebSocket hook（连接状态管理）
- 全局状态 store

---

## R2 — Companion 基础框架

### R2.1 项目初始化
- TypeScript + Node.js 项目脚手架
- CLI 入口（`cmspark-agent start`）
- WebSocket 服务器
- 数据目录初始化（`~/.cmspark-agent/`）

### R2.2 连接管理
- WS 连接建立/断开/重连
- Ping/Pong 心跳
- 连接状态广播

---

## R3 — LLM 配置管理

### R3.1 配置项
- base_url（默认 https://api.openai.com/v1）
- api_key
- model_name
- temperature（0-2，步长 0.1）
- context_window（默认 128000）

### R3.2 配置存储
- 全局默认配置（companion config.json）
- 线程级覆盖配置
- Extension 通过 WS 读写

### R3.3 配置 UI
- Side Panel ⚙ 滑出设置面板
- API key 安全输入（masked，不落 extension storage）
- 模型选择（下拉/自由输入）
- 配置验证（连接测试按钮）

---

## R4 — 聊天对话核心

### R4.1 线程管理
- 创建/删除/重命名 Thread
- Thread 列表（可折叠浮层面板）
- Thread id：6 位 short-id + 用户别名
- 线程数据持久化（companion threads/ JSON 文件）

### R4.2 消息流
- 用户文本输入 + 发送
- Agent streaming 响应（逐 token 渲染）
- Tool call 卡片展示（执行中/成功/失败状态）
- Tool result 内联展示
- 消息历史加载

### R4.3 多线程隔离
- 消息历史隔离（每条 thread 独立消息列表）
- LLM 配置隔离（每条 thread 可独立配置 model/temperature）
- 可选：工具权限覆盖（thread 级工具白名单）

---

## R5 — LLM 调用与 Tool Calling

### R5.1 LLM 适配
- OpenAI SDK 集成（兼容自定义 base_url）
- Streaming 响应处理
- Tool calling 循环（tool_call → tool_result → 继续）

### R5.2 Tool Dispatcher
- Tool 路由与参数校验
- 异步执行（extension → companion 回传）
- 超时控制
- 错误处理与重试

---

## R6 — 工具集（全部）

### R6.1 标签页工具
| ID | 工具 | 说明 |
|----|------|------|
| R6.1.1 | list_tabs | 列出所有标签页（id, url, title, active, status） |
| R6.1.2 | create_tab | 打开新标签页 |
| R6.1.3 | close_tab | 关闭标签页 |
| R6.1.4 | navigate | 标签页导航到 URL |
| R6.1.5 | screenshot | 截取标签页截图（base64） |

### R6.2 页面读取工具
| ID | 工具 | 说明 |
|----|------|------|
| R6.2.1 | get_page_text | 提取页面可见文本 |
| R6.2.2 | get_page_html | 获取 HTML（可选选择器范围） |
| R6.2.3 | get_element_info | 查询元素位置、可见性、文本 |

### R6.3 页面操作工具
| ID | 工具 | 说明 |
|----|------|------|
| R6.3.1 | click / dblclick | 点击元素 |
| R6.3.2 | type | 输入文本 |
| R6.3.3 | fill_form | 批量填表 |
| R6.3.4 | scroll / scroll_to | 滚动 |
| R6.3.5 | press_key | 键盘按键 |
| R6.3.6 | hover | 悬停 |
| R6.3.7 | select_option | 下拉选择 |
| R6.3.8 | drag_and_drop | 拖拽 |

### R6.4 高级工具
| ID | 工具 | 说明 |
|----|------|------|
| R6.4.1 | wait_for | 等待选择器出现/消失或网络空闲 |
| R6.4.2 | evaluate | 执行任意 JavaScript |
| R6.4.3 | upload_file | 文件上传 |
| R6.4.4 | download | 文件下载 |

### R6.5 Cookie 工具
| ID | 工具 | 说明 |
|----|------|------|
| R6.5.1 | get_cookies | 读取指定域 cookie |
| R6.5.2 | set_cookie | 设置 cookie |
| R6.5.3 | delete_cookie | 删除 cookie |
| R6.5.4 | list_all_cookies | 列出所有 cookie（信任域内） |

---

## R7 — 安全策略

### R7.1 evaluate 安全
- 代码执行前在 UI 中展示（可折叠）
- 危险 API 检测（fetch, XHR, localStorage, sessionStorage, document.cookie, window.open）
- 危险操作标记 ⚠️ + 用户确认（允许/拒绝/仅本次）

### R7.2 Cookie 信任域
- 用户配置信任域列表（如 `*.company.com`）
- 信任域内自由读写 cookie
- 非信任域 cookie 访问需逐次确认
- Agent 自动发现 SSO session 映射

### R7.3 错误分级处理
- Level 1（可恢复）：超时、选择器未找到 → agent 自动重试（上限3次）
- Level 2（不可恢复）：权限不足、cookie 域不匹配 → 暂停提示用户
- Level 3（安全）：访问非信任域 → 硬阻断
- 连续失败上限 5 次 → 暂停，提示用户介入
- 用户可随时点 Stop 中断

---

## R8 — 标签页定位

### R8.1 Tab 固定
- 底部 Tabs 栏展示当前窗口标签页
- 勾选标签页固定到当前 Thread
- 可固定多个标签页

### R8.2 健壮性 fallback
- 未固定时默认使用 active tab
- 标签页内容与用户问题不匹配时，按打开顺序倒序查找匹配标签页

---

## R9 — Type A Skills（Prompt 模板）

### R9.1 Skill 加载
- Markdown + YAML frontmatter 解析
- Companion filesystem 加载（`skills/` + `builtin-skills/`）
- Skill 列表在 Side Panel Skills 面板展示

### R9.2 Skill 使用
- 用户在线程中选择/激活 skill
- Skill prompt 注入 system prompt
- Skill 可按名称搜索、预览

### R9.3 Builtin Skills（VibeSOP 精选）
- `writing-skills`: Skill 创建方法论（为"保存对话为 skill"提供能力基础）
- `grill-me`: 设计审查对话
- `browse`: 页面操作参考
- 其他精选 VibeSOP skills

### R9.4 Skill 导入导出
- 单个 skill 导出为 .md 文件
- 拖拽 .md 文件导入
- 从 URL 安装 skill
- Skills 面板：每个 skill 有 [导出] [删除] 菜单

---

## R10 — 操作历史

### R10.1 历史记录
- Tool-call 级别记录（工具名、参数、结果、时间戳、线程 ID）
- SQLite 存储（companion history.db）
- 摘要级呈现（用户可见）

### R10.2 UI 呈现
- 底部栏 Hist 面板
- 按线程分组展示
- 时间线倒序

### R10.3 查询与导出
- 全文搜索（按工具名、URL、关键词）
- 导出为 JSON
- 可配置保留天数（默认 30 天）

---

## R11 — UI/UX

### R11.1 Side Panel 布局
```
┌──────────────────────┐
│ ☰ Threads    [+新建]  │  ← 顶部栏
│ [线程列表（可折叠）]   │
├──────────────────────┤
│ 消息列表（可滚动）     │  ← 主体聊天区
│ - 用户消息            │
│ - Agent 回复（stream）│
│ - Tool call 卡片      │
├──────────────────────┤
│ 📎 [Tabs][Hist][Skills]│ ← 底部上下文栏
├──────────────────────┤
│ [输入框]          [▶] │  ← 输入区
└──────────────────────┘
```

### R11.2 连接状态
- 绿色圆点/ON badge → connected
- 黄色圆点/... badge → connecting
- 红色圆点/OFF badge → disconnected
- 断连时全屏友好提示："Companion 未运行，请执行 `cmspark-agent start`"（附复制按钮）

### R11.3 用户中断
- Agent 执行中显示 Stop 按钮
- 点击立即中断当前 LLM 请求和 tool call

---

## 需求矩阵

| 模块 | 需求数 | 对应 Sprint Task |
|------|--------|-----------------|
| R1 Extension 框架 | 3 | T1.1-T1.3 |
| R2 Companion 框架 | 2 | T2.1-T2.2 |
| R3 LLM 配置 | 3 | T3.1-T3.3 |
| R4 聊天核心 | 3 | T4.1-T4.3 |
| R5 LLM Tool Calling | 2 | T5.1-T5.2 |
| R6 工具集 | 5 | T6.1-T6.5 |
| R7 安全策略 | 3 | T7.1-T7.3 |
| R8 标签页定位 | 2 | T8.1-T8.2 |
| R9 Type A Skills | 4 | T9.1-T9.4 |
| R10 操作历史 | 3 | T10.1-T10.3 |
| R11 UI/UX | 3 | T11.1-T11.3 |
| **合计** | **33** | — |

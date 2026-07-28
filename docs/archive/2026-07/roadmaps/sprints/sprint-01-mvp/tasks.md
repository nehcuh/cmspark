# Sprint 01 — MVP v0.1 开发任务

> 阶段: MVP | 日期: 2026-05-24 | 关联需求: docs/requirements/mvp-v0.1.md

---

## Phase 1: 项目脚手架

### Task T1.1 — Extension 项目初始化
| 属性 | 值 |
|------|-----|
| **关联需求** | R1.1 |
| **依赖** | 无 |
| **估时** | 2h |
| **状态** | pending |

**描述**:
- 使用 Plasmo 脚手架创建 extension 项目
- 配置 TypeScript
- 建立目录结构（sidepanel/, background/, popup/, utils/）
- 配置 manifest.json: MV3 + 所有权限声明（debugger, tabs, activeTab, storage, alarms, sidePanel, cookies, scripting, notifications）
- 配置 host_permissions: `<all_urls>`, `http://127.0.0.1/*`, `http://localhost/*`

**验收标准**:
- [ ] `plasmo dev` 可启动开发模式
- [ ] Extension 能在 Chrome 中 unpacked 加载
- [ ] Manifest 权限声明完整

---

### Task T1.2 — Service Worker 实现
| 属性 | 值 |
|------|-----|
| **关联需求** | R1.2 |
| **依赖** | T1.1 |
| **估时** | 4h |
| **状态** | pending |

**描述**:
- WebSocket 客户端：连接 companion (`ws://127.0.0.1:23401`)
- 自动重连逻辑（exponential backoff, max 30s）
- Alarm keep-alive（25s 周期）
- 监听 `chrome.storage.onChanged`，配置变更时推送 companion
- Badge 状态管理（ON=绿/connecting=黄/disconnected=红）
- `chrome.runtime.onMessage` 监听 popup/sidepanel 的状态查询

**验收标准**:
- [ ] Extension 启动后自动连接 companion
- [ ] Badge 正确显示连接状态
- [ ] Companion 重启后 extension 自动重连

---

### Task T1.3 — Side Panel 框架
| 属性 | 值 |
|------|-----|
| **关联需求** | R1.3, R11.1 |
| **依赖** | T1.1 |
| **估时** | 4h |
| **状态** | pending |

**描述**:
- 注册 Side Panel 页面（`sidepanel/index.tsx`）
- React 根组件（App.tsx）
- 全局状态 store（agentStore）
- WebSocket hook（useWebSocket）：连接状态、消息收发
- 基础布局骨架：顶部栏 + 聊天区 + 底部栏 + 输入区
- 连接状态指示器

**验收标准**:
- [ ] Side Panel 可打开（右键 → Open Side Panel）
- [ ] WS 连接状态实时反映在 UI
- [ ] 布局骨架渲染正确（320px 宽度可用）

---

## Phase 2: Companion 基础

### Task T2.1 — Companion 项目初始化
| 属性 | 值 |
|------|-----|
| **关联需求** | R2.1 |
| **依赖** | 无 |
| **估时** | 3h |
| **状态** | pending |

**描述**:
- TypeScript + Node.js 项目脚手架
- package.json：bin 字段指向 CLI（`cmspark-agent`）
- CLI 入口：`cmspark-agent start` 命令
- WebSocket 服务器（`ws` 库，端口 23401）
- 数据目录初始化（`~/.cmspark-agent/` 含子目录）
- 默认 config.json 生成

**验收标准**:
- [ ] `npm run build && cmspark-agent start` 启动成功
- [ ] Companion 监听 `ws://127.0.0.1:23401`
- [ ] `~/.cmspark-agent/` 目录自动创建

---

### Task T2.2 — Connection Manager
| 属性 | 值 |
|------|-----|
| **关联需求** | R2.2 |
| **依赖** | T2.1 |
| **估时** | 2h |
| **状态** | pending |

**描述**:
- WS 连接生命周期管理（connect/disconnect/reconnect）
- Ping/Pong 心跳（20s 间隔，60s 超时断连）
- 连接状态事件广播
- 多客户端连接跟踪（允许多个 extension 实例）

**验收标准**:
- [ ] Ping/Pong 心跳正常
- [ ] 60s 无响应自动断连
- [ ] 连接/断连日志输出

---

## Phase 3: LLM 配置

### Task T3.1 — 配置存储与读写
| 属性 | 值 |
|------|-----|
| **关联需求** | R3.1, R3.2 |
| **依赖** | T2.1 |
| **估时** | 2h |
| **状态** | pending |

**描述**:
- Companion config.json schema：
  ```json
  {
    "llm": {
      "base_url": "https://api.openai.com/v1",
      "api_key": "",
      "model_name": "gpt-4o",
      "temperature": 0.7,
      "context_window": 128000
    },
    "port": 23401,
    "trusted_domains": []
  }
  ```
- WS 协议：`config.get` / `config.set` 消息类型
- 线程级配置覆盖存储（thread JSON 中的 `config_override` 字段）
- Extension 侧不持久化 api_key

**验收标准**:
- [ ] config.get 返回完整配置（api_key masked）
- [ ] config.set 更新配置并持久化到磁盘
- [ ] 线程级配置覆盖正确读写

---

### Task T3.2 — Settings Slideout UI
| 属性 | 值 |
|------|-----|
| **关联需求** | R3.3 |
| **依赖** | T1.3, T3.1 |
| **估时** | 3h |
| **状态** | pending |

**描述**:
- Side Panel ⚙ 齿轮图标 → 滑出设置面板
- 表单字段：base_url, api_key（masked + 显示/隐藏 toggle）, model_name（输入+下拉）, temperature（slider 0-2 步长0.1）, context_window（number input）
- 连接测试按钮（发送 test 消息到 companion → LLM ping）
- 全局默认 / 当前线程覆盖 模式切换
- 保存按钮 + 保存成功反馈

**验收标准**:
- [ ] ⚙ 按钮打开设置滑出面板
- [ ] api_key 默认 masked，可 toggle 显示
- [ ] 连接测试按钮反馈成功/失败
- [ ] 保存后配置实时生效

---

### Task T3.3 — LLM Adapter
| 属性 | 值 |
|------|-----|
| **关联需求** | R5.1 |
| **依赖** | T3.1 |
| **估时** | 3h |
| **状态** | pending |

**描述**:
- OpenAI SDK 集成（支持自定义 base_url）
- System prompt 构建（含加载的 skills）
- Tool definitions 构建（根据线程工具白名单）
- Streaming 响应处理（SSE → token 推送）
- 多模型支持（通过 OpenAI-compatible API）

**验收标准**:
- [ ] 支持 OpenAI / DeepSeek / 自定义 API 三种 base_url
- [ ] Streaming token 正确逐 token 推送到 extension
- [ ] Tool definitions 随请求正确发送

---

## Phase 4: 聊天核心

### Task T4.1 — Thread Manager
| 属性 | 值 |
|------|-----|
| **关联需求** | R4.1, R4.3 |
| **依赖** | T2.1 |
| **估时** | 3h |
| **状态** | pending |

**描述**:
- Thread CRUD（创建/读取/列表/删除/重命名）
- Thread 数据结构：
  ```json
  {
    "id": "xk4f2m",
    "alias": "HR数据提取",
    "created_at": "2026-05-24T14:30:00Z",
    "updated_at": "...",
    "config_override": {},
    "tool_whitelist": null,
    "pinned_tabs": [],
    "active_skill_ids": []
  }
  ```
- Thread 消息存储（独立 JSON 文件 `threads/<id>.json`）
- Thread 索引文件（`threads/index.json`）
- 软上限：每线程 1000 条消息后提示归档

**验收标准**:
- [ ] 创建/删除/重命名线程
- [ ] 线程列表正确排序（最近更新优先）
- [ ] 线程消息持久化到独立文件
- [ ] 配置隔离：Thread A 的 model 不影响 Thread B

---

### Task T4.2 — ChatView + MessageCard
| 属性 | 值 |
|------|-----|
| **关联需求** | R4.2 |
| **依赖** | T1.3, T4.1 |
| **估时** | 5h |
| **状态** | pending |

**描述**:
- ChatView 组件：消息列表渲染，自动滚动到最新
- MessageCard 组件：
  - 用户消息：右对齐，文字气泡
  - Agent 消息：左对齐，markdown 渲染 + streaming 增量更新
  - ToolCallCard：行内卡片，展示 tool 名+参数摘要+状态（pending/running/success/error）
  - Tool 结果可展开/折叠
- Streaming 渲染 hook（useStreaming）：逐 token 追加到当前 Agent 消息
- 错误消息红色边框标记

**验收标准**:
- [ ] 用户消息和 Agent 回复交替渲染
- [ ] Agent streaming 逐 token 更新（打字机效果）
- [ ] Tool call 卡片状态实时更新
- [ ] 消息列表自动滚到底部

---

### Task T4.3 — ThreadList 折叠面板
| 属性 | 值 |
|------|-----|
| **关联需求** | R4.1, R11.1 |
| **依赖** | T1.3, T4.1 |
| **估时** | 2h |
| **状态** | pending |

**描述**:
- 顶部栏 ☰ 汉堡按钮 + 当前线程名 + [+新建] 按钮
- 点击 ☰ 展开/收起线程列表浮层面板
- 每个线程项：ID 标签 + 别名 + 更新时间 + 激活指示器
- 点击线程项：切换当前线程 + 自动收起浮层
- 新建线程：弹出输入框（别名可选），自动生成 short-id

**验收标准**:
- [ ] ☰ 展开/收起线程列表
- [ ] 线程切换加载对应消息历史
- [ ] 选中线程后浮层自动收起
- [ ] 320px 宽度下不溢出

---

## Phase 5: Tool Calling

### Task T5.1 — Tool Calling Loop
| 属性 | 值 |
|------|-----|
| **关联需求** | R5.2 |
| **依赖** | T3.3 |
| **估时** | 4h |
| **状态** | pending |

**描述**:
- Tool calling 循环引擎：
  1. 构建 messages（system + history + 新 user message）
  2. 发送 LLM 请求（含 tool definitions）
  3. 接收 response → 如果是 tool_call → 执行 → 追加 tool_result → goto 2
  4. 如果是 text → 流式返回给 extension
  5. 如果是 finish → 标记完成
- 循环次数上限（防止死循环，默认 20 轮）
- Tool 超时控制（单 tool 15s）
- 用户中断支持（chat.abort 消息）

**验收标准**:
- [ ] Tool call 自动循环执行（不需用户干预）
- [ ] 超时 tool 返回 error，LLM 可自行恢复
- [ ] 用户点 Stop 立即中断
- [ ] 循环上限到达后友好提示

---

### Task T5.2 — Tool Dispatcher
| 属性 | 值 |
|------|-----|
| **关联需求** | R5.2 |
| **依赖** | T2.2, T1.2 |
| **估时** | 3h |
| **状态** | pending |

**描述**:
- Tool 注册表（tool name → handler mapping + 参数 schema）
- 参数校验（Zod schema）
- Companion → Extension tool 执行流程：
  1. Companion 发 `tool.execute {tool_name, params, tool_call_id}`
  2. Extension service worker 接收 → 调用 Chrome API/CDP
  3. Extension 回传 `tool.result {tool_call_id, result, error?}`
  4. Companion 将结果交给 Tool Calling Loop

**验收标准**:
- [ ] Tool 注册/分发机制工作正常
- [ ] 参数校验拒绝无效调用
- [ ] Extension 侧 tool 执行结果正确回传

---

## Phase 6: 工具集实现

### Task T6.1 — 标签页工具
| 属性 | 值 |
|------|-----|
| **关联需求** | R6.1.1-R6.1.5 |
| **依赖** | T5.2 |
| **估时** | 3h |
| **状态** | pending |

**描述**:
- `list_tabs`: `chrome.tabs.query({})` 格式化返回（id, url, title, active, windowId, index, status, pinnedTab）
- `create_tab`: `chrome.tabs.create({url, active})`
- `close_tab`: `chrome.tabs.remove(tabId)`
- `navigate`: `chrome.tabs.update(tabId, {url})`
- `screenshot`: CDP Page.captureScreenshot（jpeg, quality 80），返回 base64 + 尺寸

**验收标准**:
- [ ] 每个工具端到端可调用
- [ ] screenshot 对未 attach 的 tab 自动 attach
- [ ] 错误情况（tab 不存在等）正确返回 error

---

### Task T6.2 — 页面读取工具
| 属性 | 值 |
|------|-----|
| **关联需求** | R6.2.1-R6.2.3 |
| **依赖** | T5.2, T6.1 |
| **估时** | 2h |
| **状态** | pending |

**描述**:
- `get_page_text`: CDP Runtime.evaluate(`document.body.innerText`) 返回纯文本
- `get_page_html`: CDP Runtime.evaluate 获取完整或 selector 范围的 HTML（限制 500KB）
- `get_element_info`: CDP Runtime.evaluate 查询 selector → 返回 {x, y, width, height, visible, text}

**验收标准**:
- [ ] 页面文本提取正确（中文不乱码）
- [ ] HTML 大小限制生效（超限截断标记）
- [ ] 不存在元素返回明确 error

---

### Task T6.3 — 页面操作工具
| 属性 | 值 |
|------|-----|
| **关联需求** | R6.3.1-R6.3.8 |
| **依赖** | T5.2, T6.1 |
| **估时** | 4h |
| **状态** | pending |

**描述**:
- `click/dblclick`: CDP Input.dispatchMouseEvent（获取元素坐标 → 计算中心点 → 点击）
- `type`: CDP Input.dispatchKeyEvent（逐字符输入）+ Input.insertText（快路径）
- `fill_form`: 批量 type，按 `[{selector, value, clear_first}]` 格式
- `scroll/scroll_to`: CDP Input.dispatchMouseEvent (wheel) / Runtime.evaluate
- `press_key`: CDP Input.dispatchKeyEvent（支持组合键如 Ctrl+C）
- `hover`: CDP Input.dispatchMouseEvent (mouseMoved)
- `select_option`: CDP Runtime.evaluate（选择 option 元素）
- `drag_and_drop`: CDP Input.dispatchMouseEvent（mousePressed → mouseMoved → mouseReleased）

**验收标准**:
- [ ] 每种交互通过 CDP 正确执行
- [ ] 元素不存在或不可见时返回明确错误
- [ ] fill_form 支持批量填写

---

### Task T6.4 — 高级工具
| 属性 | 值 |
|------|-----|
| **关联需求** | R6.4.1-R6.4.4 |
| **依赖** | T5.2, T6.1 |
| **估时** | 3h |
| **状态** | pending |

**描述**:
- `wait_for`: 轮询 selector 直到出现/消失（timeout 15s，interval 500ms）+ CDP Network.idle 检测（2s 无请求）
- `evaluate`: CDP Runtime.evaluate 执行任意 JS → 返回结果 + 安全标记（见 T7.1）
- `upload_file`: CDP DOM.setFileInputFiles
- `download`: CDP Browser.setDownloadBehavior + Page.downloadProgress 监听

**验收标准**:
- [ ] wait_for 超时返回 error 而不是 hang
- [ ] evaluate 执行结果正确序列化返回
- [ ] upload 选择文件正常工作
- [ ] download 触发浏览器下载

---

### Task T6.5 — Cookie 工具
| 属性 | 值 |
|------|-----|
| **关联需求** | R6.5.1-R6.5.4, R7.2 |
| **依赖** | T5.2 |
| **估时** | 2h |
| **状态** | pending |

**描述**:
- `get_cookies`: `chrome.cookies.getAll({domain})` — 返回全部 cookie 元数据（name, domain, path, secure, httpOnly, session, expirationDate），敏感值可 masked
- `set_cookie`: `chrome.cookies.set({url, name, value, domain, ...})` — 信任域检查
- `delete_cookie`: `chrome.cookies.remove({url, name})` — 信任域检查
- `list_all_cookies`: `chrome.cookies.getAll({})` — 只在信任域范围内返回

**验收标准**:
- [ ] 信任域内 cookie 操作无确认
- [ ] 非信任域 set/delete 被拒绝或要求确认
- [ ] SSO cookie 跨子域自动发现

---

## Phase 7: 安全

### Task T7.1 — Evaluate 安全护栏
| 属性 | 值 |
|------|-----|
| **关联需求** | R7.1 |
| **依赖** | T6.4 |
| **估时** | 2h |
| **状态** | pending |

**描述**:
- 危险 API 检测正则集合：`fetch(`, `XMLHttpRequest`, `localStorage`, `sessionStorage`, `document.cookie`, `window.open`, `navigator.sendBeacon`
- evaluate 执行前：UI 展示代码（可折叠）+ 危险标记 ⚠️
- 用户选择：允许执行 / 拒绝 / 仅本次允许
- evaluate 结果完整展示在 chat + 记录到操作历史

**验收标准**:
- [ ] 危险代码检测并提示用户
- [ ] 安全代码直接执行
- [ ] 拒绝的代码不执行
- [ ] 所有 evaluate 记录到操作历史

---

### Task T7.2 — Cookie 信任域管理
| 属性 | 值 |
|------|-----|
| **关联需求** | R7.2 |
| **依赖** | T3.1, T6.5 |
| **估时** | 2h |
| **状态** | pending |

**描述**:
- 信任域配置存储（config.json trusted_domains 数组）
- 通配符支持（`*.company.com` 匹配 `hr.company.com`, `finance.company.com`）
- Cookie 操作前域匹配检查
- Agent 自动发现 SSO session：遍历信任域内所有 cookie → 识别相同 auth provider 签发的 session → 在 tool use 中自动建议"该域已有有效 SSO session"

**验收标准**:
- [ ] 信任域通配符正确匹配
- [ ] 非信任域 cookie 操作被拦截
- [ ] Agent 能自动检测和报告 SSO 状态

---

### Task T7.3 — 错误分级处理
| 属性 | 值 |
|------|-----|
| **关联需求** | R7.3 |
| **依赖** | T5.1 |
| **估时** | 2h |
| **状态** | pending |

**描述**:
- 错误分类器：
  - Level 1（可恢复）：ETIMEDOUT, ECONNREFUSED, "selector not found", "element not visible" → 返回 error 给 LLM 决定重试
  - Level 2（不可恢复）："permission denied", "cookie domain mismatch", "not in trusted domains" → 返回 error + 暂停 tool-call 循环
  - Level 3（安全）："accessing untrusted domain", "evaluate blocked by user" → 硬阻断
- 重试计数器（单个 tool 上限 3，连续失败上限 5）
- 连续失败达上限 → 暂停 + Side Panel 提示用户介入

**验收标准**:
- [ ] Level 1 错误 LLM 自动处理（如换选择器重试）
- [ ] Level 2 错误暂停并向用户展示
- [ ] Level 3 错误立即阻断
- [ ] 连续 5 次失败后暂停

---

## Phase 8: 标签页定位

### Task T8.1 — Tab 固定功能
| 属性 | 值 |
|------|-----|
| **关联需求** | R8.1 |
| **依赖** | T1.3, T6.1 |
| **估时** | 2h |
| **状态** | pending |

**描述**:
- 底部 Tabs 栏：展示当前窗口所有标签页（title, url 摘要, favicon）
- 每行一个 tab，左侧 checkbox
- 勾选 = 固定到当前线程（写入 thread pinned_tabs）
- 可固定多个标签页
- Agent tool call 中的 tabId 优先使用固定标签页

**验收标准**:
- [ ] Tabs 栏正确列出当前窗口标签页
- [ ] 勾选/取消固定持久化到线程
- [ ] 切换线程后固定列表切换
- [ ] Agent tool call 优先使用固定标签页

---

### Task T8.2 — 健壮性 Tab 匹配
| 属性 | 值 |
|------|-----|
| **关联需求** | R8.2 |
| **依赖** | T5.1, T8.1 |
| **估时** | 2h |
| **状态** | pending |

**描述**:
- 未固定标签页时，默认使用 active tab
- Tab 内容匹配检查：提取页面文本前 500 字符 → 简单关键词匹配用户问题
- 不匹配时：按打开顺序倒序遍历标签页（最近打开优先）→ 提取文本 → 关键词匹配 → 找到第一个匹配的 tab
- 如果全部不匹配 → 返回 active tab + 向用户提示

**验收标准**:
- [ ] 未固定时正确 fallback 到 active tab
- [ ] 不匹配时倒序查找匹配 tab
- [ ] 全不匹配时给出用户提示

---

## Phase 9: Type A Skills

### Task T9.1 — Skill Loader
| 属性 | 值 |
|------|-----|
| **关联需求** | R9.1 |
| **依赖** | T2.1 |
| **估时** | 2h |
| **状态** | pending |

**描述**:
- 解析 markdown + YAML frontmatter（使用 gray-matter 库）
- 扫描 `skills/` 和 `builtin-skills/` 目录
- Skill 元数据索引（name, description, type, parameters）
- Skill 列表 WS 协议：`skill.list` → 返回所有 skill 元数据
- Skill 内容按需加载（`skill.get {name}` → 返回完整 markdown body）

**验收标准**:
- [ ] skills 目录中所有 .md 文件正确解析
- [ ] frontmatter 字段校验（name/description 必填）
- [ ] skill.list 返回完整元数据列表

---

### Task T9.2 — Skill Engine
| 属性 | 值 |
|------|-----|
| **关联需求** | R9.2 |
| **依赖** | T9.1, T3.3 |
| **估时** | 2h |
| **状态** | pending |

**描述**:
- Skill 注入 system prompt：用户激活 skill → skill 的 markdown body 追加到 system prompt
- 多 skill 共存：按激活顺序排列
- Skill 搜索（按 name/description 关键词）
- Skill 预览（Side Panel 展示 skill 内容摘要）

**验收标准**:
- [ ] 激活 skill 后 system prompt 正确包含 skill 内容
- [ ] 多 skill 按序注入
- [ ] 取消激活后 system prompt 恢复

---

### Task T9.3 — Builtin Skills 集成
| 属性 | 值 |
|------|-----|
| **关联需求** | R9.3 |
| **依赖** | T9.1 |
| **估时** | 1h |
| **状态** | pending |

**描述**:
- 从 workflows/ 和现有 skill 模板中精选文件复制到 companion `builtin-skills/`
- 初始精选：
  - `writing-skills.md` — Skill 创建方法论
  - `grill-me.md` — 设计审查对话
  - `browse.md` — 页面操作参考
- Builtin skills 标记为只读（不可删除，可覆盖激活）

**验收标准**:
- [ ] 内置 skills 在 skill.list 中展示
- [ ] 内置 skills 标记为 builtin
- [ ] 用户可选择激活内置 skill

---

### Task T9.4 — Skill 导入导出
| 属性 | 值 |
|------|-----|
| **关联需求** | R9.4 |
| **依赖** | T9.1 |
| **估时** | 2h |
| **状态** | pending |

**描述**:
- Skills 面板 UI（Side Panel 底部栏 Skills 标签）
- 导出：单个 skill → 下载 .md 文件（`skill.export {name}` → 返回完整 markdown 内容 → extension 触发下载）
- 导入：拖拽 .md 文件到 Side Panel → 读取内容 → WS `skill.import {content}` → companion 写入 skills 目录
- URL 导入：输入 URL → companion fetch → 写入 skills 目录
- 每个 skill 的 [...] 菜单：导出 / 删除

**验收标准**:
- [ ] .md 文件导出内容完整（含 frontmatter）
- [ ] 拖拽 .md 文件导入成功
- [ ] URL 导入成功
- [ ] 删除需确认

---

## Phase 10: 操作历史

### Task T10.1 — SQLite History Store
| 属性 | 值 |
|------|-----|
| **关联需求** | R10.1 |
| **依赖** | T2.1 |
| **估时** | 2h |
| **状态** | pending |

**描述**:
- 使用 better-sqlite3（同步 API，适合 companion 单进程）
- Schema:
  ```sql
  CREATE TABLE operations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id TEXT NOT NULL,
    tool_name TEXT NOT NULL,
    params TEXT,           -- JSON
    result_summary TEXT,
    error TEXT,
    success INTEGER NOT NULL DEFAULT 1,
    duration_ms INTEGER,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX idx_operations_thread ON operations(thread_id);
  CREATE INDEX idx_operations_created ON operations(created_at);
  CREATE INDEX idx_operations_tool ON operations(tool_name);
  ```
- Tool call 完成后自动写入

**验收标准**:
- [ ] 每次 tool call 成功后自动写入 DB
- [ ] 失败 tool call 也写入（success=0）
- [ ] 索引加速查询

---

### Task T10.2 — 历史查询与导出
| 属性 | 值 |
|------|-----|
| **关联需求** | R10.2, R10.3 |
| **依赖** | T10.1 |
| **估时** | 2h |
| **状态** | pending |

**描述**:
- WS 协议 `history.query {thread_id?, tool_name?, keyword?, from?, to?, limit?, offset?}`
- 全文搜索：关键词匹配 tool_name + result_summary + params JSON
- 导出 JSON：`history.export {thread_id?, from?, to?}` → JSON 文件下载
- 保留策略：配置 `history_retention_days`（默认 30），companion 启动时清理过期记录

**验收标准**:
- [ ] 按线程/工具名/关键词组合查询
- [ ] JSON 导出完整可用
- [ ] 过期记录自动清理

---

### Task T10.3 — History Panel UI
| 属性 | 值 |
|------|-----|
| **关联需求** | R10.2 |
| **依赖** | T1.3, T10.2 |
| **估时** | 2h |
| **状态** | pending |

**描述**:
- 底部栏 Hist 标签面板
- 按线程分组展示操作历史（最近操作在上）
- 每条记录：时间 + tool 图标/名称 + 摘要（成功绿/失败红）
- 搜索框：关键词搜索
- 导出按钮：导出当前视图的 JSON

**验收标准**:
- [ ] 操作历史正确展示
- [ ] 按线程分组正确
- [ ] 搜索过滤正确
- [ ] 导出按钮下载 JSON

---

## Phase 11: UI 打磨与集成

### Task T11.1 — 完整 UI 集成
| 属性 | 值 |
|------|-----|
| **关联需求** | R11.1, R11.2, R11.3 |
| **依赖** | T4.2, T4.3, T8.1, T10.3, T9.4, T3.2 |
| **估时** | 3h |
| **状态** | pending |

**描述**:
- 集成所有组件到 App.tsx 完整布局
- 底部栏切换逻辑（Tabs / Hist / Skills）
- Stop 按钮状态管理（agent 执行中显示，空闲时隐藏）
- 断连全屏提示（companion 未运行时）：
  - 大图标 + "Companion 未连接"
  - 复制命令按钮：`cmspark-agent start`
  - 自动重试指示器

**验收标准**:
- [ ] 所有面板无缝切换
- [ ] Stop 按钮正确响应 agent 状态
- [ ] 断连提示友好可用

---

### Task T11.2 — Popup 页面
| 属性 | 值 |
|------|-----|
| **关联需求** | R1.3 |
| **依赖** | T1.2, T1.3 |
| **估时** | 1h |
| **状态** | pending |

**描述**:
- 点击 extension 图标弹出 popup
- 显示：连接状态（圆点+文字）+ Companion 地址 + 当前活跃线程
- "打开 Side Panel" 按钮
- "设置" 链接（打开 Settings Slideout 或 Options page）

**验收标准**:
- [ ] Popup 正确显示连接状态
- [ ] "打开 Side Panel" 按钮正确触发

---

### Task T11.3 — 端到端集成测试
| 属性 | 值 |
|------|-----|
| **关联需求** | 全部 R1-R11 |
| **依赖** | T11.1 |
| **估时** | 3h |
| **状态** | pending |

**描述**:
- 端到端测试场景：
  1. 启动 companion → 加载 extension → 连接成功绿色 badge
  2. 打开 Side Panel → 创建线程 → 发送消息 → Agent 回复
  3. Agent 截图当前页面 → 结果展示在 chat
  4. Agent 操作标签页（打开/导航/点击）
  5. 多线程隔离：Thread A 和 Thread B 独立上下文
  6. Skill 激活/停用
  7. 操作历史记录和查询
  8. Cookie 读取和信任域检查
  9. evaluate 危险代码检测和确认
  10. 断连重连

**验收标准**:
- [ ] 10 个核心场景通过
- [ ] 无 console error
- [ ] Side Panel 在 320px 宽度无溢出

---

## Sprint 任务总览

| Phase | Task | 依赖 | 估时 | 状态 |
|-------|------|------|------|------|
| 1 脚手架 | T1.1 Extension 初始化 | — | 2h | pending |
| | T1.2 Service Worker | T1.1 | 4h | pending |
| | T1.3 Side Panel 框架 | T1.1 | 4h | pending |
| 2 Companion | T2.1 Companion 初始化 | — | 3h | pending |
| | T2.2 Connection Manager | T2.1 | 2h | pending |
| 3 LLM 配置 | T3.1 配置存储 | T2.1 | 2h | pending |
| | T3.2 Settings UI | T1.3, T3.1 | 3h | pending |
| | T3.3 LLM Adapter | T3.1 | 3h | pending |
| 4 聊天核心 | T4.1 Thread Manager | T2.1 | 3h | pending |
| | T4.2 ChatView | T1.3, T4.1 | 5h | pending |
| | T4.3 ThreadList | T1.3, T4.1 | 2h | pending |
| 5 Tool Calling | T5.1 Tool Calling Loop | T3.3 | 4h | pending |
| | T5.2 Tool Dispatcher | T2.2, T1.2 | 3h | pending |
| 6 工具集 | T6.1 标签页工具 | T5.2 | 3h | pending |
| | T6.2 页面读取工具 | T5.2, T6.1 | 2h | pending |
| | T6.3 页面操作工具 | T5.2, T6.1 | 4h | pending |
| | T6.4 高级工具 | T5.2, T6.1 | 3h | pending |
| | T6.5 Cookie 工具 | T5.2 | 2h | pending |
| 7 安全 | T7.1 Evaluate 安全 | T6.4 | 2h | pending |
| | T7.2 Cookie 信任域 | T3.1, T6.5 | 2h | pending |
| | T7.3 错误分级 | T5.1 | 2h | pending |
| 8 Tab 定位 | T8.1 Tab 固定 | T1.3, T6.1 | 2h | pending |
| | T8.2 Tab 匹配 | T5.1, T8.1 | 2h | pending |
| 9 Type A Skills | T9.1 Skill Loader | T2.1 | 2h | pending |
| | T9.2 Skill Engine | T9.1, T3.3 | 2h | pending |
| | T9.3 Builtin Skills | T9.1 | 1h | pending |
| | T9.4 Skill 导入导出 | T9.1 | 2h | pending |
| 10 操作历史 | T10.1 SQLite Store | T2.1 | 2h | pending |
| | T10.2 历史查询导出 | T10.1 | 2h | pending |
| | T10.3 History Panel UI | T1.3, T10.2 | 2h | pending |
| 11 集成 | T11.1 完整 UI 集成 | T4.2, T4.3, T8.1, T10.3, T9.4, T3.2 | 3h | pending |
| | T11.2 Popup | T1.2, T1.3 | 1h | pending |
| | T11.3 集成测试 | T11.1 | 3h | pending |
| **合计** | **31 tasks** | — | **78h** | — |

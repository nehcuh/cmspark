# CMspark 代码库深度审计报告

> **审计日期**: 2026-06-05
> **审计范围**: companion/llm, companion/bridge, companion/skills, companion/threads, companion/history, chrome-extension/sidepanel, chrome-extension/background
> **审计方法**: 静态代码分析 + 架构审查 + 安全扫描

---

## 执行摘要

| 指标 | 数值 |
|------|------|
| **总问题数** | 68 |
| **P0 (严重)** | 18 |
| **P1 (重要)** | 28 |
| **P2 (一般)** | 22 |
| **整体测试覆盖率** | < 25% |
| **零测试模块** | 3/7 |

### 最紧急的5个问题

1. **[P0] XSS 漏洞**: `MarkdownRenderer` 直接使用 `dangerouslySetInnerHTML` 渲染未过滤的 LLM 输出 (sidepanel)
2. **[P0] 同步 I/O 阻塞事件循环**: `ThreadManager` 和 `SkillEngine` 全部使用 `fs.*Sync` API，在 WS 高频调用路径上阻塞 Node.js (threads, skills)
3. **[P0] 安全策略重复且可绕过**: `server.ts` 和 `tool-executor.ts` 安全逻辑不一致，`message-router.ts` 的 `osascript_eval` 可绕过确认机制 (bridge)
4. **[P0] 命令注入**: `osascript_eval` 通过字符串拼接构建 AppleScript，用户输入可逃逸上下文 (bridge)
5. **[P0] 竞态条件 + 数据丢失**: `ThreadManager.addMessage()` 无并发保护，消息文件并发写入导致损坏或丢失 (threads)

---

## 一、companion/llm 模块审计

**审计文件**: `companion/src/llm/adapter.ts` (499 行)

### P0 问题

#### 1. 同步 I/O 阻塞流式处理路径
- **位置**: adapter.ts:71, 97, 236, 309
- **描述**: `threadManager.addMessage()` 和 `threadManager.getMessages()` 内部是 `fs.writeFileSync`/`fs.readFileSync`。在 LLM 流式响应的每一轮 tool call 中多次调用，完全抵消了流式传输的低延迟优势。
- **影响**: 高并发场景下 WS 响应延迟剧烈抖动，用户体验卡顿。
- **建议**: 将 ThreadManager 迁移到异步 I/O；在 `chatCreate` 中使用内存缓冲批量写入。

#### 2. 上下文窗口压缩破坏 tool call 结构
- **位置**: adapter.ts:148-168
- **描述**: `while` 循环通过 `JSON.stringify(messages).length` 判断是否超窗并删除最旧消息。删除 `assistant` message 时检查了后续 `tool` messages，但如果 `assistant` 的 `tool_calls` 和实际消息数量不一致（如部分 tool result 已被删除），剩余结构仍然会破坏 OpenAI API 的交替约束。
- **影响**: 向 LLM 发送结构损坏的消息，触发 400 错误。
- **建议**: 压缩逻辑以"回合"为单位删除（assistant + 其对应的所有 tool results），而非逐条。

#### 3. 大量 catch 静默吞异常
- **位置**: adapter.ts:79, 275, 327, 496
- **描述**: 技能激活失败、tool 参数解析失败、stale detection 失败、auto-alias 失败均被静默忽略。
- **影响**: 系统以不一致状态运行，调试困难。
- **建议**: 至少记录 `logger.warn`，区分预期失败和意外错误。

#### 4. JSON 截断导致语法损坏
- **位置**: adapter.ts:351-357
- **描述**: 工具结果超过 8000 字符时直接 `substring` 截断 JSON 字符串，不保证截断后的内容仍是有效 JSON。
- **影响**: LLM 收到无法解析的 JSON，可能产生幻觉响应。
- **建议**: 截断前先 `JSON.stringify`，在对象层级截断（如只保留前 N 个键），并在末尾补全 JSON 结构。

### P1 问题

#### 5. `any` 类型泛滥
- **位置**: adapter.ts:24-25, 48, 109, 126-127, 137-143, 198-199, 201, 239, 272, 429
- **描述**: 核心接口（`sendToExtension`、`executeTool`、`toolCall`、消息数组）全部使用 `any`，编译期无保护。
- **建议**: 定义严格的 `ToolCall`、`WsMessage` 接口，用类型守卫收窄。

#### 6. tool_call_id 匹配验证缺失
- **位置**: adapter.ts:110-121
- **描述**: 验证 tool_calls 时只检查下一条消息 role 是否为 "tool"，不验证 `tool_call_id` 是否匹配。
- **影响**: 消息顺序错乱时无法检测。
- **建议**: 验证 `nextMsg.tool_call_id === tc.id`。

#### 7. executeTool 无超时控制
- **位置**: adapter.ts:280
- **描述**: `await executeTool(...)` 无超时，如果 extension 不响应会永久挂起。
- **建议**: 包装 `Promise.race([executeTool(...), timeout(30000)])`。

#### 8. 连续失败计数器在成功时不重置
- **位置**: adapter.ts:182, 418
- **描述**: `continuousFailures` 只在失败时递增，成功时未归零。偶发的网络抖动后，后续任何错误都可能触发连续失败上限。
- **建议**: 每次 `while` 循环开始时将 `continuousFailures` 置零（或仅在连续失败时重置）。

### P2 问题

#### 9. `extractKeyTerms` 正则重复编译
- **位置**: adapter.ts:35-41
- **描述**: 3 个正则表达式每次调用都重新创建。
- **建议**: 提取为模块级常量。

#### 10. `reasoning_content` 未发送到 extension
- **位置**: adapter.ts:243-245
- **描述**: DeepSeek thinking 内容被捕获并加入消息数组，但未通过 `sendToExtension` 发送到 UI。
- **建议**: 在流式处理阶段将 `reasoning_content` 增量发送到 extension。

### 测试缺口

| 测试类型 | 状态 | 缺口 |
|---------|------|------|
| 单元测试 | 极少 | 仅 2 个 ThreadManager 交互测试 |
| tool calling loop | 无 | 无多轮 tool call 测试 |
| 上下文压缩 | 无 | 无超窗场景测试 |
| 错误恢复 | 无 | 无连续失败、认证错误测试 |
| 流式响应 | 无 | 无 mock stream 测试 |
| 类型安全 | 无 | 无接口契约测试 |

---

## 二、companion/bridge 模块审计

**审计文件**: `server.ts`, `server/tool-executor.ts`, `server/log-helpers.ts`, `bridge/tab-resolver.ts`, `bridge/tool-definitions.ts`, `message-router.ts`, `security-confirmation.ts`

### P0 问题（4个）

#### 1. 安全策略重复且可绕过
- **位置**: server.ts:117-199, tool-executor.ts:31-50, message-router.ts:400-453
- **描述**: `server.ts` 实现了完整的安全确认流程（交互式确认），但 `tool-executor.ts` 直接拒绝无 `security_confirmed` 的请求；`message-router.ts` 的 `osascript_eval` case 独立使用 `execSync`，完全绕过了 `server.ts` 的安全策略。
- **影响**: 攻击者可通过 `osascript_eval` 入口执行未确认的高风险代码。
- **建议**: 统一 `SecurityPolicy` 类；`osascript_eval` 必须路由到统一执行器。

#### 2. osascript_eval 命令注入
- **位置**: server.ts:333-351, message-router.ts:424-441
- **描述**: `pageUrl` 和 `jsExpr` 通过字符串拼接注入 AppleScript，转义不完整（未处理单引号、AppleScript 特殊字符）。
- **影响**: 任意 AppleScript / shell 命令执行。
- **建议**: 使用 `execFile` + 参数传递；或改用 osascript 的 stdin 模式。

#### 3. evaluate 安全确认可被伪造
- **位置**: server.ts:154-199
- **描述**: `security_confirmed: true` 是客户端传来的布尔值，extension 端无二次验证（HMAC 签名等）。
- **影响**: 客户端伪造确认标志即可执行危险代码。
- **建议**: 服务器生成一次性令牌，extension 验证令牌有效性。

#### 4. WebSocket 消息缺少输入验证
- **位置**: server.ts:411-461
- **描述**: `JSON.parse(raw.toString())` 后直接使用，无大小限制、无深度限制、无 schema 验证。
- **影响**: DoS（超大消息）、畸形消息触发意外路径。
- **建议**: 添加 `raw.length > 10MB` 拒绝；使用 Zod 验证消息结构。

### P1 问题（8个）

#### 5. tab-resolver 语义匹配逻辑缺陷
- **位置**: bridge/tab-resolver.ts:39-55
- **描述**: 无活跃标签页时直接 fallback，跳过了语义匹配。

#### 6. pendingToolCalls 全局共享
- **位置**: server.ts:464-477
- **描述**: `pendingToolCalls` 是全局 Map，多客户端时一个断开会影响所有其他客户端。

#### 7. message-router chat.create/regenerate 代码重复
- **位置**: message-router.ts:84-141, 153-230
- **描述**: 大量复制粘贴逻辑，`chat.create` 中 `rest.skill_ids` 未做 undefined 保护。

#### 8. skill.import SSRF 风险
- **位置**: message-router.ts:307-321
- **描述**: `fetch(rest.url)` 无协议白名单、无内网过滤、无重定向限制。

#### 9. thread.fork 消息 ID 冲突
- **位置**: message-router.ts:242-266
- **描述**: 复制消息时保留原始 ID，新旧线程消息 ID 重复。

#### 10. security-confirmation.ts 闭包泄漏
- **位置**: security-confirmation.ts:37-58
- **描述**: `send` 回调被 `setTimeout` 持有，WebSocket 关闭后仍尝试发送。

#### 11. API key 短 key 泄露
- **位置**: server.ts:374-382
- **描述**: 掩码逻辑 `slice(0,5) + "***" + slice(-4)` 在 key 长度 < 9 时泄露全部。

#### 12. config.set 原型污染风险
- **位置**: message-router.ts:42-61
- **描述**: `deepMerge` 未过滤 `__proto__`/`constructor`/`prototype`。

### P2 问题（7个）

- tab-resolver extractKeywords 正则重复编译
- log-helpers summarizeMessage 缺少 null 保护
- server.ts initServices 被调用两次
- server.ts graceful shutdown 不等待连接关闭
- tool-definitions.ts 返回 `any[]`
- skill.craft 缺少错误边界
- security.ts classifyError 优先级不明确

### 测试缺口

| 模块 | 覆盖 | 缺口 |
|------|------|------|
| tab-resolver.ts | 0% | 语义匹配、关键词提取 |
| tool-definitions.ts | 0% | Schema 验证 |
| tool-executor.ts | 0% | 安全策略、超时 |
| server.ts | 部分 | 多客户端竞争、安全确认流程 |
| message-router.ts | 部分 | skill.import URL 获取、osascript_eval |
| security-confirmation.ts | 部分 | 并发请求、disconnect 场景 |

---

## 三、companion/skills 模块审计

**审计文件**: `skill-engine.ts` (610 行), `semantic-match.ts` (97 行), `skill-craft.ts` (267 行)

### P0 问题（4个）

#### 1. 同步 I/O 阻塞
- **位置**: skill-engine.ts 全文件
- **描述**: `refresh()`、`loadFromDir()`、`saveSkillFile()`、`importSkill()` 等全部使用 `fs.*Sync` API。技能激活路径上（`activate`→`getActiveForThread`→`new ThreadManager()`）也会触发文件 I/O。
- **影响**: 与 ThreadManager 相同的阻塞问题，在高频 chat 中加剧。
- **建议**: 全模块迁移异步 I/O；缓存技能内容避免重复读取。

#### 2. 路径遍历风险
- **位置**: skill-engine.ts:477-478
- **描述**: `importSkillFromPath(dirPath)` 未验证 `dirPath` 是否包含 `..`。
- **影响**: 可能读取任意目录下的 SKILL.md。
- **建议**: 对 `dirPath` 做 `path.resolve` 后验证是否在允许的基目录下。

#### 3. ZIP 路径遍历检查不完整
- **位置**: skill-engine.ts:460-462
- **描述**: `resolvedPath.startsWith(destDir)` 检查可能因缺少尾部斜杠被绕过。且 `relativePath.includes("/")` 允许创建任意子目录。
- **影响**: ZIP 中的恶意条目可能写入 skills 目录外。
- **建议**: 规范化路径后比较；限制 ZIP 中只包含一层子目录。

#### 4. YAML 注入 / 格式破坏
- **位置**: skill-engine.ts:306-336
- **描述**: `saveSkillFile` 直接将 `skill.name`、`skill.description`、`entry.content` 拼接到 YAML 字符串。如果这些字段包含 `"`、`\n`、`: ` 等字符，会破坏 YAML 结构。
- **影响**: 技能文件损坏，加载时解析失败。
- **建议**: 使用 YAML 库（如 `js-yaml.dump`）序列化 frontmatter，而非字符串拼接。

### P1 问题（5个）

#### 5. getActiveForThread 每次创建 ThreadManager
- **位置**: skill-engine.ts:186-199
- **描述**: 每次调用都 `new ThreadManager()`，触发文件 I/O 和索引加载。
- **建议**: 通过构造函数注入 ThreadManager 实例。

#### 6. threadSkillMap 内存泄漏
- **位置**: skill-engine.ts:45
- **描述**: 线程删除时未清理对应的技能映射。
- **建议**: 监听线程删除事件或提供 cleanup 方法。

#### 7. safeName 冲突
- **位置**: skill-engine.ts:408, 437, 516
- **描述**: 多个不同名称 sanitize 后可能相同（如 "skill-1" 和 "skill_1" 都变成 "skill-1"），导致覆盖。
- **建议**: 添加数字后缀处理冲突。

#### 8. skill-craft parseCraftedSkill 脆弱
- **位置**: skill-craft.ts:145-185
- **描述**: 依赖正则匹配 frontmatter，LLM 格式稍有偏差即失败。
- **建议**: 使用 `gray-matter` 解析（项目已有依赖）。

#### 9. skill-craft 无输出长度限制
- **位置**: skill-craft.ts:129-136
- **描述**: LLM 响应可能超长，消耗大量 token。
- **建议**: 设置 `max_tokens` 限制。

### P2 问题（4个）

- semantic-match STOP_WORDS 不可配置
- semantic-match 无 IDF 权重
- skill-craft salvageSkill 质量差
- CRAFT_SYSTEM_PROMPT 硬编码

### 测试缺口

| 模块 | 覆盖 | 缺口 |
|------|------|------|
| skill-engine.ts | 极低 | 仅 1 个默认 skill 测试 |
| semantic-match.ts | 0% | tokenize、cosineSimilarity |
| skill-craft.ts | 0% | parseCraftedSkill、salvageSkill |
| import/export | 0% | ZIP、folder、path 导入 |

---

## 四、companion/threads 模块审计

**审计文件**: `thread-manager.ts` (190 行)

### P0 问题（4个）

#### 1. 同步 I/O 阻塞事件循环
- **位置**: thread-manager.ts:45, 53, 88, 95, 119, 137, 151, 166, 170, 184
- **描述**: 全部文件操作使用 `fs.readFileSync`/`fs.writeFileSync`。
- **建议**: 迁移到 `fs.promises`；对 `saveIndex()` 和 `addMessage()` 引入写缓冲/批量刷新。

#### 2. 无并发写入保护（竞态条件）
- **位置**: thread-manager.ts:52-54, 84-88, 143-151, 169-170
- **描述**: 并发的 `addMessage()` 会并发读-改-写同一文件。
- **建议**: 每线程引入写入队列或文件锁。

#### 3. 消息容量截断导致数据丢失
- **位置**: thread-manager.ts:145-149
- **描述**: 超过 1100 条时直接截断保留最近 1000 条，无备份或归档。
- **建议**: 截断前归档到 `.archive.json`；使用原子写入。

#### 4. 错误处理静默吞异常
- **位置**: thread-manager.ts:47-49, 96, 122-124, 139-141, 171, 186-188
- **描述**: 大量使用 `catch { /* ignore */ }`。
- **建议**: 分级记录日志，区分"文件不存在"和"权限拒绝"。

### P1 问题（5个）

- `any` 类型滥用（config_override, tool_calls）
- ID 生成使用 `Math.random()`（非加密安全，无重试上限）
- `create()` 空值处理不一致（id="" 创建无效线程）
- `update()` 可修改不可变字段（id, created_at）
- 无输入验证（alias 长度、特殊字符未过滤）

### P2 问题（3个）

- 路径计算重复
- create() 两步操作非原子（先保存索引再创建消息文件）
- `deleteMessagesFrom` 不更新 `updated_at`

### 测试缺口

| 测试类型 | 状态 |
|---------|------|
| 单元测试 | 约 10 个间接测试，无 dedicated 测试文件 |
| 并发测试 | 无 |
| 错误处理测试 | 无 |
| 性能测试 | 无 |
| 持久化一致性测试 | 无 |

---

## 五、companion/history 模块审计

**审计文件**: `store.ts` (189 行)

### P0 问题（2个）

#### 1. 同步 I/O 阻塞
- **位置**: store.ts:84-95
- **描述**: `save()` 使用 `fs.writeFileSync`，在每次 `record()` 后调用。
- **建议**: 异步写入 + 批量刷新。

#### 2. 错误静默处理
- **位置**: store.ts:70, 76, 92-94
- **描述**: SQLite 初始化失败、保存失败均静默忽略。
- **建议**: 记录错误日志，初始化失败时向上传播。

### P1 问题（4个）

- 动态 require 反模式（第176行）
- 无并发写入保护（SQLite 锁竞争）
- LIKE 查询中 `%`/`_` 导致意外匹配
- `getAsObject() as unknown as OperationRecord` 无运行时验证

### P2 问题（3个）

- findSqlWasmPath 路径硬编码脆弱
- purgeOldRecords 每次启动执行，大表时慢
- 无数据备份机制

### 测试缺口

| 测试类型 | 状态 |
|---------|------|
| 单元测试 | 0% |
| 持久化测试 | 0% |
| 大容量查询测试 | 0% |

---

## 六、chrome-extension/sidepanel 模块审计

**审计文件**: `App.tsx`, `ChatView.tsx`, `useWebSocket.ts`, `agentStore.tsx`, `SettingsSlideout.tsx`, `SkillCraftPanel.tsx`, `ThreadList.tsx`, `BottomBar.tsx`, `InputArea.tsx` 等

### P0 问题（4个）

#### 1. XSS 漏洞
- **位置**: ChatView.tsx:183
- **描述**: `MarkdownRenderer` 使用 `marked.parse()` + `dangerouslySetInnerHTML`，未启用 sanitize。
- **建议**: 使用 DOMPurify 过滤；禁用 HTML 标签解析。

#### 2. API Key 明文存储与泄露
- **位置**: agentStore.tsx:62-63, SettingsSlideout.tsx:60-65
- **描述**: `api_key` 作为 Redux state 传递，通过 `sendMessage` 发送到 background，无加密。
- **建议**: 使用 Web Crypto API 加密存储；UI 永远掩码显示。

#### 3. 未清理的定时器导致内存泄漏
- **位置**: App.tsx:92-95
- **描述**: `setTimeout` 未保存 ID，组件卸载时无法清理。
- **建议**: 使用 `useRef` 保存 timeout ID。

#### 4. useWebSocket hook 重复注册监听器
- **位置**: useWebSocket.ts:320
- **描述**: `useEffect` 依赖数组不完整，dispatch 引用变化时重复注册。
- **建议**: 使用 `useRef` 包装 dispatch；或设空依赖数组。

### P1 问题（7个）

- chrome.runtime.lastError 未处理（多处）
- `confirm()`/`alert()` 阻塞主线程
- 核心逻辑大量使用 `any` 类型
- SecurityConfirmationDialog 缺少二次验证
- ErrorBoundary 不捕获异步错误
- 未验证外部数据直接用于状态更新
- AppContent 订阅整个 state 导致重复渲染

### P2 问题（8个）

- 魔法字符串与硬编码配置分散
- 键盘事件处理逻辑重复（App.tsx vs InputArea.tsx）
- 未使用的导入与死代码
- 内联 style 对象导致性能问题
- 输入验证缺失（URL、技能名称）
- 测试覆盖率 0%
- 日志处理缺乏限流
- 连接状态轮询无退避策略

### 测试缺口

| 测试类型 | 覆盖 |
|---------|------|
| 单元测试 | 0% |
| 组件测试 | 0% |
| 集成测试 | 0% |
| E2E 测试 | 0% |

---

## 七、chrome-extension/background 模块审计

**审计文件**: `index.ts` (191 行), `browser-bridge.ts` (735 行), `ws-client.ts` (121 行), `keep-alive.ts` (21 行)

### P0 问题（3个）

#### 1. evaluate 安全确认可被绕过
- **位置**: browser-bridge.ts:618-628
- **描述**: `security_confirmed` 是服务端传来的布尔值，无令牌签名验证。
- **建议**: 服务端生成 HMAC 签名令牌，extension 验证。

#### 2. 代码注入通过字符串拼接
- **位置**: browser-bridge.ts 多处（407-418, 444-446, 471-477, 547-555, 586-600, 719-721）
- **描述**: `getElementInfo`、`click fallback`、`typeText`、`selectOption`、`waitFor`、`getElementCenter` 均通过字符串拼接构建 JS 表达式注入页面。
- **影响**: `params.selector` 含单引号可逃逸字符串上下文。
- **建议**: 使用 `chrome.scripting.executeScript` 的 `func` + `args` 模式，避免字符串拼接。

#### 3. DANGEROUS_APIS 检测不完整
- **位置**: browser-bridge.ts:9-20
- **描述**: 硬编码列表，易绕过（如 `window["fetch"]`、`fetch.call`）。
- **建议**: 在 AST 层面分析代码；或限制 evaluate 只能返回简单值。

### P1 问题（5个）

- selector 未转义（单引号注入）
- waitFor 网络空闲检测未实现（有不可达代码）
- CDP 连接未在扩展卸载时清理
- ws-client.ts 消息类型无验证
- ws-client.ts 无限重连无上限

### P2 问题（2个）

- keep-alive.ts alarms 重复创建
- index.ts sendResponse 默认返回 false 可能错过响应

### 测试缺口

| 测试类型 | 覆盖 |
|---------|------|
| 单元测试 | 0% |
| CDP 操作测试 | 0% |
| WebSocket 重连测试 | 0% |

---

## 八、测试覆盖缺口汇总

| 模块 | 现有测试 | 覆盖率估计 | 最严重缺口 |
|------|----------|-----------|-----------|
| companion/llm | adapter.test.ts (2个) | < 10% | tool calling loop、流式响应、错误恢复 |
| companion/bridge | server.test.ts (5个), security-thread.test.ts (2个) | 35-40% | tab-resolver、tool-executor、安全确认流程 |
| companion/skills | skill-engine.test.ts (1个) | < 5% | semantic-match、skill-craft、import/export |
| companion/threads | 间接测试约 10 个 | < 15% | 并发写入、竞态条件、容量截断 |
| companion/history | 无 | 0% | 全部 |
| chrome-extension/sidepanel | 无 | 0% | 全部 |
| chrome-extension/background | 无 | 0% | 全部 |

### 优先级测试建议

1. **立即创建**: `thread-manager.test.ts`（并发写入、竞态条件、容量截断）
2. **立即创建**: `browser-bridge.test.ts`（evaluate 安全、selector 注入）
3. **立即创建**: `chat-view.test.tsx`（XSS 防护、Markdown 渲染）
4. **立即创建**: `history-store.test.ts`（SQLite 持久化、查询）
5. **高优先级**: `skill-engine.test.ts`（导入导出、YAML 安全）

---

## 九、综合优化路线图

### Phase 1: 安全修复（1-2 周）— P0 优先

| # | 任务 | 模块 | 工作量 |
|---|------|------|--------|
| 1.1 | 修复 MarkdownRenderer XSS（添加 DOMPurify） | sidepanel | 1d |
| 1.2 | 统一安全策略，消除 osascript_eval 绕过路径 | bridge | 2d |
| 1.3 | 修复 osascript_eval 命令注入（改用 execFile） | bridge | 1d |
| 1.4 | evaluate 安全确认改用 HMAC 令牌 | bridge + background | 2d |
| 1.5 | browser-bridge 代码注入改用 func+args 模式 | background | 2d |
| 1.6 | 修复 ThreadManager 竞态条件（引入写入队列） | threads | 2d |
| 1.7 | 修复 SkillEngine YAML 注入（使用 js-yaml） | skills | 1d |
| 1.8 | 修复 ZIP 路径遍历 | skills | 1d |
| 1.9 | 添加 WebSocket 消息大小限制和 Zod 验证 | bridge | 1d |

### Phase 2: 性能修复（1-2 周）— P0/P1

| # | 任务 | 模块 | 工作量 |
|---|------|------|--------|
| 2.1 | ThreadManager 迁移异步 I/O | threads | 2d |
| 2.2 | SkillEngine 迁移异步 I/O + 缓存 | skills | 2d |
| 2.3 | HistoryStore 异步写入 + 批量刷新 | history | 1d |
| 2.4 | adapter.ts 内存缓冲批量写入 | llm | 1d |
| 2.5 | 修复 sidepanel 重复渲染（拆分组件 + memo） | sidepanel | 2d |
| 2.6 | WSClient 指数退避重连 | background | 0.5d |

### Phase 3: 稳定性修复（1 周）— P1

| # | 任务 | 模块 | 工作量 |
|---|------|------|--------|
| 3.1 | 上下文窗口压缩以回合为单位删除 | llm | 1d |
| 3.2 | 修复 chat.create/regenerate 代码重复 | bridge | 1d |
| 3.3 | skill.import SSRF 防护 | bridge | 1d |
| 3.4 | config.set 原型污染防护 | bridge | 0.5d |
| 3.5 | pendingToolCalls 按连接隔离 | bridge | 1d |
| 3.6 | security-confirmation 闭包泄漏修复 | bridge | 0.5d |
| 3.7 | sidepanel 错误处理统一（lastError、ErrorBoundary） | sidepanel | 1d |
| 3.8 | 消息容量截断前归档 | threads | 0.5d |

### Phase 4: 类型安全与代码质量（1 周）— P1/P2

| # | 任务 | 模块 | 工作量 |
|---|------|------|--------|
| 4.1 | 移除 adapter.ts 中所有 `any` | llm | 1d |
| 4.2 | 定义 WebSocket 消息联合类型 | sidepanel + bridge | 1d |
| 4.3 | tool-definitions.ts 严格类型 | bridge | 0.5d |
| 4.4 | 清理死代码和未使用导入 | sidepanel | 0.5d |
| 4.5 | 统一默认配置到 utils/config.ts | sidepanel | 0.5d |
| 4.6 | 内联 style 迁移到 CSS Modules | sidepanel | 2d |

### Phase 5: 测试基础设施（2-3 周）— 测试缺口

| # | 任务 | 模块 | 工作量 |
|---|------|------|--------|
| 5.1 | 创建 thread-manager.test.ts（覆盖 P0 场景） | threads | 2d |
| 5.2 | 创建 browser-bridge.test.ts（mock Chrome API） | background | 2d |
| 5.3 | 创建 adapter.test.ts（mock stream、tool loop） | llm | 2d |
| 5.4 | 创建 skill-engine.test.ts（导入导出） | skills | 2d |
| 5.5 | 创建 history-store.test.ts | history | 1d |
| 5.6 | 创建 chat-view.test.tsx（XSS、渲染） | sidepanel | 2d |
| 5.7 | 创建 useWebSocket 测试 | sidepanel | 1d |
| 5.8 | E2E 测试（WebSocket 端到端） | 全栈 | 3d |
| 5.9 | 安全端到端测试（确认流程、evaluate 阻断） | 全栈 | 2d |

### 路线图总览

```
Week 1-2:  Phase 1 安全修复（9项，~13人天）
Week 2-3:  Phase 2 性能修复（6项，~8.5人天）
Week 4:    Phase 3 稳定性修复（8项，~6.5人天）
Week 5:    Phase 4 类型安全与代码质量（6项，~5.5人天）
Week 6-8:  Phase 5 测试基础设施（9项，~17人天）
─────────────────────────────────────────────
总计: ~50人天（约10周单人，或3-4周团队并行）
```

---

## 附录：问题严重程度分布

| 模块 | P0 | P1 | P2 | 合计 |
|------|----|----|----|------|
| companion/llm | 4 | 4 | 2 | 10 |
| companion/bridge | 4 | 8 | 7 | 19 |
| companion/skills | 4 | 5 | 4 | 13 |
| companion/threads | 4 | 5 | 3 | 12 |
| companion/history | 2 | 4 | 3 | 9 |
| chrome-extension/sidepanel | 4 | 7 | 8 | 19 |
| chrome-extension/background | 3 | 5 | 2 | 10 |
| **合计** | **18** | **28** | **22** | **68** |

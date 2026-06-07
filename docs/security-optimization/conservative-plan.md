# 方案二：保守方案 —— 多层纵深防御

## 核心理念
安全优先，宁可误报也不漏报，用户始终掌控最终决策权。所有危险操作必须经过用户确认，无例外。多层纵深防御，不依赖单一安全机制。完善的审计日志和可追溯性。特权模式有严格限制和明确边界。

## 架构图

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              用户层 (Chrome Extension)                               │
│  ┌──────────────────────────────────────────────────────────────────────────────┐  │
│  │                         Security Confirmation Dialog (强制弹窗)                 │  │
│  │  ┌────────────┐  ┌────────────┐  ┌────────────┐  ┌────────────────────────┐  │  │
│  │  │ 红色警告边框 │  │ 危险API标红 │  │ 代码高亮预览 │  │ 用户必须点击"确认执行"   │  │  │
│  │  │ (不可跳过)  │  │ (加粗+红色) │  │ (语法着色)  │  │ (无"总是允许"选项)      │  │  │
│  │  └────────────┘  └────────────┘  └────────────┘  └────────────────────────┘  │  │
│  └──────────────────────────────────────────────────────────────────────────────┘  │
│         ▲                                                                           │
│         │ 强制阻断所有危险操作，无自动执行路径                                         │
│  ┌──────┴─────────────────────────────────────────────────────────────────────────┐ │
│  │                              设置面板 (只读安全信息)                              │ │
│  │  ┌──────────────────────────────────────────────────────────────────────────┐  │ │
│  │  │ 特权模式 (只读显示): 当前线程安全状态                                      │  │ │
│  │  │ 安全审计日志查看器 (只读，不可修改)                                        │  │ │
│  │  │ 信任域管理 (需二次确认)                                                    │  │ │
│  │  └──────────────────────────────────────────────────────────────────────────┘  │ │
│  └────────────────────────────────────────────────────────────────────────────────┘ │
│         │                                                                            │
│  ┌──────▼──────────────────────────────────────────────────────────────────────────┐ │
│  │                    Extension Background (Service Worker) — 第一防线              │ │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │ │
│  │  │ Browser     │  │ Security    │  │ Dangerous   │  │ Page Content            │ │ │
│  │  │ Bridge      │  │ Token       │  │ API Blocker │  │ Sanitizer               │ │ │
│  │  │ (CDP/exec)  │  │ Validator   │  │ (硬阻断)     │  │ (DOM净化后返回)          │ │ │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────────────────┘ │ │
│  └──────────────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────────────┘
                                          │
                                          ▼ WebSocket
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              Companion (Node.js) — 核心安全层                        │
│                                                                                      │
│  ┌────────────────────────────────────────────────────────────────────────────────┐ │
│  │                    Defense-in-Depth Security Stack (多层防御栈)                   │ │
│  │                                                                                  │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌────────────────────┐  │ │
│  │  │ Layer 1:     │  │ Layer 2:     │  │ Layer 3:     │  │ Layer 4:           │  │ │
│  │  │ Static Rule  │  │ Pattern      │  │ Semantic     │  │ Anthropic Safety   │  │ │
│  │  │ Engine       │  │ Matching     │  │ Analysis     │  │ Skill (System      │  │ │
│  │  │ (DANGEROUS_  │  │ ( regex +    │  │ (AST解析+    │  │ Prompt注入)        │  │ │
│  │  │  API_PATTERNS│  │  heuristics) │  │  callgraph)  │  │                    │  │ │
│  │  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────────┬─────────┘  │ │
│  │         └─────────────────┴─────────────────┴─────────────────────┘              │ │
│  │                              │                                                   │ │
│  │                    ┌─────────▼─────────┐                                        │ │
│  │                    │ UNIFIED GATE:     │                                        │ │
│  │                    │ ALL must pass OR  │                                        │ │
│  │                    │ trigger confirmation│                                      │ │
│  │                    └─────────┬─────────┘                                        │ │
│  │                              │                                                   │ │
│  │                    ┌─────────▼─────────┐                                        │ │
│  │                    │ Security Audit    │                                        │ │
│  │                    │ Logger (SQLite)   │                                        │ │
│  │                    └─────────────────┘                                          │ │
│  └──────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                      │
│  ┌────────────────────────────────────────────────────────────────────────────────┐ │
│  │                         原有模块 (增强安全边界)                                   │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌────────────────────┐  │ │
│  │  │ Security     │  │ Security     │  │ Security     │  │ ThreadManager      │  │ │
│  │  │ Confirmation │  │ Policy       │  │ Policy       │  │ (新增审计字段)      │  │ │
│  │  │ Manager      │  │ (HMAC Token) │  │ (Token)      │  │                    │  │ │
│  │  │ (不可绕过)    │  │ (单次Token)   │  │ (强化)        │  │                    │  │ │
│  │  └──────────────┘  └──────────────┘  └──────────────┘  └────────────────────┘  │ │
│  │                                                                                  │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌────────────────────┐  │ │
│  │  │ Content      │  │ LLM Adapter  │  │ SkillEngine  │  │ builtin-skills/    │  │ │
│  │  │ Sanitizer    │  │ (安全指令硬化)│  │ (安全技能注入)│  │ safety-guard.md    │  │ │
│  │  │ (双层过滤)    │  │              │  │              │  │ (不可删除)         │  │ │
│  │  └──────────────┘  └──────────────┘  └──────────────┘  └────────────────────┘  │ │
│  └──────────────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

**数据流：**

1. **工具执行流（零信任）：**
   ```
   LLM → Tool Executor → Layer 1 静态规则检测
                             ↓
                        ANY match? → YES → 强制进入 SecurityConfirmationManager
                             ↓ NO
                        Layer 2 模式匹配检测
                             ↓
                        ANY match? → YES → 强制进入 SecurityConfirmationManager
                             ↓ NO
                        Layer 3 语义分析
                             ↓
                        ANY match? → YES → 强制进入 SecurityConfirmationManager
                             ↓ NO
                        记录审计日志 → 执行 (但仍需单次 HMAC Token)
   ```
   
   **关键：不存在"自动执行"路径。即使是低风险操作，仍需一次性 Token。**

2. **特权模式流（严格受限）：**
   ```
   用户请求特权模式 → Companion 拒绝 LLM/工具发起的模式切换
                             ↓
                        仅接受来自 Extension UI 的手动切换
                             ↓
                        切换时：二次确认弹窗 + 记录审计日志
                             ↓
                        特权模式效果：仅减少 UI 弹窗的展示细节（不隐藏危险信息）
                             ↓
                        不改变安全策略！所有危险操作仍需确认
   ```

3. **网页内容扫描流（不可绕过）：**
   ```
   get_page_text / get_page_html / evaluate
                             ↓
                        Extension 侧 Page Content Sanitizer
                             ↓
                        检测可疑脚本 → 净化后返回（去除/转义危险内容）
                             ↓
                        Companion 侧 Content Sanitizer 二次过滤
                             ↓
                        记录威胁日志 → 返回净化后的内容给 LLM
   ```
   
   **关键：即使特权模式，网页内容扫描也不跳过。**

## 涉及的模块和改动点

### 新增模块

| 文件路径 | 说明 |
|---------|------|
| `companion/src/security/layered-defense.ts` | 多层防御引擎核心。顺序执行 Layer1-4 安全检测，任何一层触发都进入强制确认。提供 `runDefenseStack(toolName, code, context)` 统一接口 |
| `companion/src/security/semantic-analyzer.ts` | Layer 3 语义分析器。基于 AST 解析 JavaScript 代码，分析调用链、数据流，检测隐式危险模式（如通过闭包间接调用 eval） |
| `companion/src/security/audit-logger.ts` | 安全审计日志器。将安全事件持久化到 SQLite（history.db 新增 `security_audit` 表），包含：时间戳、线程ID、工具名、代码摘要、决策结果、用户身份、风险等级 |
| `companion/src/security/page-sanitizer.ts` | 网页内容净化器。在 Extension 返回内容后、传给 LLM 之前，对 HTML/文本进行二次净化，去除隐藏的 prompt injection 脚本 |
| `companion/builtin-skills/safety-guard.md` | 内置 Anthropic 安全技能。作为 immutable 内置技能，system prompt 中强制注入。包含：prompt injection 防御指南、越狱检测策略、工具使用安全准则 |
| `chrome-extension/src/background/page-sanitizer.ts` | Extension 侧网页内容净化。在 `get_page_text`/`get_page_html` 返回前，去除 `<script>`、事件处理器、`javascript:` 伪协议等 |
| `chrome-extension/src/sidepanel/components/SecurityConfirmationV2.tsx` | 新版安全确认对话框（标红、更醒目）。红色边框警告、危险 API 列表加粗红色显示、代码预览语法高亮、无"总是允许"或"记住选择"选项 |
| `chrome-extension/src/sidepanel/components/AuditLogViewer.tsx` | 安全审计日志查看器。只读界面，展示历史安全事件的时间线 |

### 修改模块

| 文件路径 | 改动内容 |
|---------|---------|
| `companion/src/security.ts` | 1) 扩充 `DANGEROUS_API_PATTERNS`，新增 20+ 检测模式（包括更多混淆手法）；2) 所有检测函数不再返回 boolean，而是返回 `{ blocked: true, layer: number, reason: string }`；3) 删除任何"自动放行"逻辑 |
| `companion/src/security-policy.ts` | 1) HMAC Token TTL 从 5 分钟缩短至 2 分钟；2) Token 增加绑定：threadId + code hash + timestamp；3) 单次 Token 使用后立即标记失效；4) 新增 `auditLog` 接口，每次 Token 颁发/验证都记录日志 |
| `companion/src/security-confirmation.ts` | 1) 超时时间从 60 秒缩短至 45 秒；2) 删除 `batchApprove` 或任何批量批准机制；3) 确认请求增加 `defense_layer_triggered` 字段（显示哪层防御触发）；4) 队列改为 FIFO + 优先级（高风险优先） |
| `companion/src/server.ts` | 1) `createToolExecutor` 中：在原有安全检查之前插入 `runDefenseStack` 调用；2) 删除所有"自动执行"分支，所有路径都必须经过确认或审计；3) 新增 `security.audit.query` WS 消息处理 |
| `companion/src/message-router.ts` | 1) `osascript_eval` 路由同样接入 Layered Defense Stack；2) 新增 `security.audit.query` 路由；3) 拒绝任何来自 message 的 privilege mode 切换请求（只允许 UI 发起） |
| `companion/src/llm/adapter.ts` | 1) 在 system prompt 末尾强制注入 `safety-guard` 技能内容（不可关闭）；2) 如果检测到 LLM 输出包含越狱模式，终止对话并返回 security 错误；3) 错误分类增加 `security_audit` 级别 |
| `companion/src/config.ts` | 新增 `security` 字段：`{ audit_logging: boolean, defense_layers: number[], confirmation_timeout_seconds: number }`。默认所有防御层开启 |
| `companion/src/threads/thread-manager.ts` | Thread 结构新增字段：`security_audit_log: string[]`（关联审计记录ID）、`defense_config: DefenseConfig` |
| `companion/src/history/store.ts` | 新增 `security_audit` 表：`id, thread_id, timestamp, tool_name, code_hash, defense_layer, decision, user_ip, risk_level` |
| `companion/src/skills/skill-engine.ts` | 1) `buildSystemPrompt` 强制注入 `safety-guard` 技能（不可通过配置关闭）；2) 安全技能标记 `immutable: true, builtin: true` |
| `companion/src/skills/content-sanitizer.ts` | 1) 正则模式从 24 个扩充至 48 个；2) 新增 HTML-specific 注入模式检测（`<script>`, `onerror=`, `javascript:`）；3) 增加 `sanitizePageContent()` 函数 |
| `chrome-extension/src/background/browser-bridge.ts` | 1) `evaluate` 方法：Extension 侧危险 API 检测与 Companion 侧保持一致（消除重复代码通过共享配置文件）；2) 执行前调用 `PageSanitizer.sanitize()`；3) 任何危险 API 都必须有 Token，无 Token 直接阻断 |
| `chrome-extension/src/background/index.ts` | 1) 初始化 Page Sanitizer；2) 将安全审计事件转发到 Companion |
| `chrome-extension/src/sidepanel/App.tsx` | 1) `SecurityConfirmationDialog` 全面升级：红色边框、危险 API 加粗红色、代码预览语法高亮、无"总是允许"选项、显示触发防御层信息；2) 集成 `AuditLogViewer`（只读） |
| `chrome-extension/src/sidepanel/store/agentStore.tsx` | 新增 state: `securityAuditLog`（只读，从 Companion 拉取）、`currentDefenseLayer` |
| `chrome-extension/src/sidepanel/components/SettingsSlideout.tsx` | 安全设置区域改为只读展示：当前防御层状态、审计日志入口、信任域管理（需二次确认） |

## 预估开发人天

| 分类 | 模块 | 人天 | 说明 |
|-----|------|------|------|
| **后端** | Layered Defense Stack (layered-defense.ts) | 4 | 设计四层防御架构，统一接口，层间通信机制 |
| **后端** | Semantic Analyzer (semantic-analyzer.ts) | 3 | AST 解析集成（acorn/espree），调用链分析，隐式危险检测 |
| **后端** | Audit Logger (audit-logger.ts) | 2 | SQLite 表设计，审计事件格式，查询接口，历史归档 |
| **后端** | Page Sanitizer (page-sanitizer.ts) | 1.5 | HTML/DOM 净化逻辑，script 标签移除，事件处理器过滤 |
| **后端** | Security 模块强化 | 2.5 | security.ts 扩充模式、security-policy.ts Token 强化、security-confirmation.ts 移除批量批准 |
| **后端** | Server/MessageRouter 集成 | 2 | 插入 Defense Stack 到所有执行路径，删除自动执行分支 |
| **后端** | LLM Adapter 安全硬化 | 1.5 | system prompt 强制注入、越狱检测、终止对话逻辑 |
| **后端** | History Store 扩展 | 1 | security_audit 表设计，迁移脚本 |
| **后端 小计** | | **17.5** | |
| **前端** | SecurityConfirmationV2 (标红UI) | 2.5 | 红色边框、危险API标红、代码高亮、防御层信息显示 |
| **前端** | AuditLogViewer | 1.5 | 只读审计日志时间线，搜索/过滤 |
| **前端** | SettingsSlideout 安全设置 | 1 | 只读展示防御状态、审计入口 |
| **前端** | App.tsx / Store 集成 | 1.5 | 状态管理、事件处理、无"总是允许"逻辑 |
| **前端** | Page Sanitizer (Extension) | 1.5 | DOM 净化实现、script 标签移除 |
| **前端** | BrowserBridge 集成 | 1 | 执行前净化、Token 严格验证 |
| **前端 小计** | | **9** | |
| **测试** | 单元测试 | 4 | Layered Defense、Semantic Analyzer、Audit Logger 全覆盖 |
| **测试** | 集成测试 | 2.5 | 端到端安全流、四层防御触发测试 |
| **测试** | 安全渗透测试 | 3 | 模拟绕过攻击、混淆代码测试、Token 重用测试 |
| **测试** | 审计日志测试 | 1 | 持久化、查询、归档测试 |
| **测试 小计** | | **10.5** | |
| **文档** | 安全架构文档 | 1.5 | 更新 docs/architecture.md、docs/adr/006-layered-defense.md |
| **文档** | 安全操作手册 | 1 | 用户安全指南、管理员配置手册 |
| **文档** | 威胁模型文档 | 1 | STRIDE 分析、攻击面梳理、缓解措施矩阵 |
| **文档 小计** | | **3.5** | |
| **总计** | | **40.5** | 约 **6 周**（1人全职）或 **3 周**（2人并行）|

## 潜在风险

### 安全风险

| 风险 | 严重程度 | 说明 | 缓解措施 |
|-----|---------|------|---------|
| 多层防御性能损耗 | 中 | 四层防御顺序执行，每次工具调用增加 AST 解析开销 | 1) AST 解析结果缓存（code hash → AST）；2) 轻量规则先过滤，只有通过才进入重层；3) 异步执行不阻塞主线程 |
| 语义分析误报率高 | 高 | AST 分析可能将正常代码误判为危险（如合法的 JSON.parse） | 1) 维护白名单模式（如 `JSON.parse` 参数为字面量时放行）；2) 用户可提交误报反馈；3) 渐进式启用语义层（默认关闭，用户手动开启） |
| 审计日志数据膨胀 | 中 | 所有安全事件持久化到 SQLite，长期使用可能达 GB 级 | 1) 自动归档策略（30 天自动压缩到 history.db.archive）；2) 定期清理脚本；3) 审计日志按线程分区 |
| Token TTL 缩短影响体验 | 低 | 2 分钟 TTL 可能导致用户思考时 Token 过期 | 1) UI 显示剩余时间倒计时；2) 过期前 30 秒发送提醒；3) 用户可一键刷新 Token |
| 安全技能强制注入的误伤 | 低 | Anthropic safety skill 注入 system prompt 可能改变 LLM 行为，影响正常任务执行 | 1) 精细设计 safety skill 内容，只包含防御性指令；2) A/B 测试验证任务成功率；3) 提供降级开关（需管理员密码） |

### 性能风险

| 风险 | 严重程度 | 说明 | 缓解措施 |
|-----|---------|------|---------|
| AST 解析延迟 | 中 | 每次 evaluate 都解析 AST 可能增加 50-200ms | 缓存 AST 结果；对短代码（<100 字符）跳过语义层 |
| SQLite 审计写入压力 | 低 | 高频 tool 调用时审计写入可能成为瓶颈 | 批量写入（100ms 缓冲）；使用 WAL 模式 |
| Extension 侧 DOM 净化开销 | 中 | 大页面 DOM 遍历可能耗时 | 限制净化深度（最大 DOM 节点数）；超时 fallback |

### 用户体验风险

| 风险 | 严重程度 | 说明 | 缓解措施 |
|-----|---------|------|---------|
| 确认频率过高导致疲劳 | 高 | 保守方案所有危险操作都需确认，用户可能产生"确认疲劳" | 1) 优化 UI 减少认知负荷（清晰的风险摘要、一键操作）；2) 提供"最近确认"快捷查看；3) 教育用户什么是真正的危险 |
| 误阻断正常操作 | 高 | 过于保守的规则可能频繁阻断合法操作 | 1) 用户可一键申诉（发送误报报告）；2) 每周 review 误报数据优化规则；3) 白名单机制（用户手动标记安全模式） |
| 无"总是允许"选项的不便 | 中 | 用户无法减少重复确认的打扰 | 1) 这是设计意图，不提供此选项；2) 通过优化确认 UI 的流畅度补偿；3) 在文档中明确解释此设计决策 |
| 安全审计日志的隐私顾虑 | 低 | 用户可能担心操作被记录 | 1) 本地存储不上传；2) 提供清除日志选项；3) 隐私政策说明 |

### 架构债务风险

| 风险 | 严重程度 | 说明 | 缓解措施 |
|-----|---------|------|---------|
| 四层防御的维护复杂度 | 中 | 每层独立维护，规则更新需要同步 | 1) 统一的规则配置文件；2) 自动化测试覆盖每层；3) 版本化规则集 |
| 防御层间的一致性 | 中 | Companion 和 Extension 的检测规则可能不同步 | 1) 共享配置文件（JSON/YAML）；2) CI 检查规则一致性；3) 单源真理（Companion 为权威） |

## 核心设计决策

1. **零信任执行模型**：不存在"自动执行"路径。即使是读取操作，如果触及危险 API，也必须经过确认。这是保守方案的核心原则。

2. **四层纵深防御**：
   - **Layer 1 (静态规则)**：快速正则匹配，覆盖已知危险 API
   - **Layer 2 (模式匹配)**：启发式规则，检测混淆和编码绕过
   - **Layer 3 (语义分析)**：AST 解析，检测隐式危险和数据流
   - **Layer 4 (AI 安全技能)**：System prompt 中注入 Anthropic 安全准则，让 LLM 自我约束

3. **强制审计**：所有安全事件（包括通过和阻断）都持久化到 SQLite，不可篡改，支持事后追溯。

4. **特权模式不降低安全**：特权模式仅影响 UI 展示（如隐藏部分次要警告），不改变安全策略本身。所有危险操作仍需确认。

5. **不可绕过的网页净化**：Extension 侧和 Companion 侧双重净化网页内容，特权模式不跳过此步骤。

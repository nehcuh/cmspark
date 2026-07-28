# 方案三：折中方案 —— 智能分层风险治理

## 核心理念
智能分层，低风险自动执行，高风险用户确认 + 特权模式。基于风险评分的动态策略，不是一刀切。用户可控的特权级别（只读/标准/高级），上下文感知的安全决策，在自动化和安全性之间找到最佳平衡点。

## 架构图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              用户层 (Side Panel)                              │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────────────────────────────┐ │
│  │ 安全确认弹窗   │  │ 设置面板      │  │  特权模式指示器 (Header 状态灯)        │ │
│  │ - 标红危险API │  │ - 特权级别选择 │  │  🟢只读 / 🟡标准 / 🔴高级           │ │
│  │ - 代码高亮    │  │ - 信任域管理  │  │                                     │ │
│  │ - 一键拒绝    │  │ - 安全技能开关 │  │                                     │ │
│  └──────┬───────┘  └──────┬───────┘  └─────────────────────────────────────┘ │
│         │                  │                                                  │
│         └──────────────────┼──────────────────────────────────────────────────┘
│                            ▼                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │                    Extension Background (Service Worker)                  │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────────┐   │ │
│  │  │ BrowserBridge │  │ SecurityToken │  │  Page Content Scanner        │   │ │
│  │  │ - 工具执行    │  │ - HMAC验证   │  │  - 网页DOM注入检测            │   │ │
│  │  │ - 危险API检测 │  │              │  │  - 特权模式下仍扫描           │   │ │
│  │  └──────┬───────┘  └──────────────┘  └──────────────────────────────┘   │ │
│  │         │                                                                  │ │
│  └─────────┼──────────────────────────────────────────────────────────────────┘ │
│            │ WebSocket (ws://127.0.0.1:23401)                                  │
│            ▼                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │                         Companion (Node.js)                               │ │
│  │  ┌─────────────────────────────────────────────────────────────────────┐  │ │
│  │  │                      Risk Assessment Engine                          │  │ │
│  │  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │  │ │
│  │  │  │ Risk Scorer  │  │ Privilege    │  │  Context Analyzer        │  │  │ │
│  │  │  │ - 静态分析    │  │   Manager    │  │  - 工具历史行为           │  │  │ │
│  │  │  │ - 动态评分    │  │ - 三级模式   │  │  - 同线程连续操作         │  │  │ │
│  │  │  │ - 规则引擎    │  │ - 降级策略   │  │  - 域名上下文             │  │  │ │
│  │  │  └──────┬───────┘  └──────┬───────┘  └────────────┬─────────────┘  │  │ │
│  │  │         └─────────────────┼───────────────────────┘                │  │ │
│  │  │                           ▼                                        │  │ │
│  │  │              ┌────────────────────────────┐                        │  │ │
│  │  │              │   Decision Router           │                        │  │ │
│  │  │              │  ┌────────┬────────┬─────┐ │                        │  │ │
│  │  │              │  │ 自动执行│ 需确认 │ 阻断 │ │                        │  │ │
│  │  │              │  │ score<3│ 3-7   │ >7  │ │                        │  │ │
│  │  │              │  └────────┴────────┴─────┘ │                        │  │ │
│  │  │              └────────────────────────────┘                        │  │ │
│  │  └────────────────────────────────────────────────────────────────────┘  │ │
│  │                                                                           │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────────┐   │ │
│  │  │ SecurityPolicy│  │ SecurityConf  │  │  Anthropic Safety Skills      │   │ │
│  │  │ - HMAC Token  │  │ irmationMgr  │  │  (builtin-skills/security/)   │   │ │
│  │  │ - 长度限制    │  │ - 60s超时队列 │  │  - prompt-injection-defense   │   │ │
│  │  │              │  │              │  │  - jailbreak-detection        │   │ │
│  │  └──────────────┘  └──────────────┘  │  - instruction-hierarchy      │   │ │
│  │                                       └──────────────────────────────┘   │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────────┐   │ │
│  │  │ ContentSanitizer│ │ ThreadManager │  │  SkillEngine (existing)      │   │ │
│  │  │ - 24正则规则  │  │ - 线程级配置  │  │                              │   │ │
│  │  │ - 知识文档净化 │  │ - tool_whitelist│ │                              │   │ │
│  │  └──────────────┘  └──────────────┘  └──────────────────────────────┘   │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
```

**数据流：**
1. LLM 发起 tool_call → Companion Risk Scorer 评分
   - score 0-2 (低风险): 自动执行 → BrowserBridge → 结果返回 LLM
   - score 3-7 (中风险): 检查 Privilege Manager
     - 特权模式=高级 + 同线程已确认过同类操作 → 自动执行 (带审计日志)
     - 否则 → SecurityConfirmationManager → UI弹窗 → 用户确认 → HMAC Token → 执行
   - score 8-10 (高风险): 强制确认，特权模式无效

2. 网页内容获取 → Page Content Scanner 扫描返回内容
   - 检测到可疑脚本/注入模式 → 标记 sanitized，日志记录
   - 特权模式不跳过此扫描

3. 知识文档注入 → ContentSanitizer (现有) + Anthropic Safety Skill 双重过滤

## 涉及的模块和改动点

### 后端 (companion/src)

| 文件 | 改动内容 |
|------|---------|
| `companion/src/config.ts` | 新增 `security` 字段：`{ privilege_mode: "readonly" | "standard" | "advanced", auto_confirm_same_thread: boolean, safety_skills_enabled: string[] }` |
| `companion/src/security.ts` | 新增 `RiskCategory` 枚举；新增 `calculateRiskScore(toolName, code, context)` (0-10分)；保留 `DANGEROUS_API_PATTERNS`，增加权重映射；新增 `getRiskDecision(score, privilegeMode, threadContext)` |
| `companion/src/security-policy.ts` | 新增 `issueSessionToken(threadId, privilegeMode)` 方法，颁发线程级特权 token |
| `companion/src/security-confirmation.ts` | 新增 `risk_score`, `risk_category`, `auto_confirm_eligible` 字段；请求消息中增加 `risk_level` 字段供 UI 渲染不同颜色 |
| `companion/src/server.ts` | `createToolExecutor` 中集成 Risk Assessment Engine；新增 `sessionPrivilegeMap` 管理会话特权状态 |
| `companion/src/llm/adapter.ts` | 在 system prompt 中注入 Anthropic Safety Skill 内容 |
| `companion/src/skills/content-sanitizer.ts` | 增加网页内容扫描模式；新增 `sanitizePageContent(html)` 函数 |
| **新增** `companion/src/security/risk-engine.ts` | 核心风险评分引擎：整合静态分析、上下文分析、历史行为分析 |
| **新增** `companion/src/security/privilege-manager.ts` | 特权模式管理：三级模式定义、降级策略、会话状态维护 |
| **新增** `companion/src/security/page-scanner.ts` | 网页内容威胁扫描：DOM 脚本检测、prompt injection 模式匹配 |
| **新增** `companion/builtin-skills/security/prompt-injection-defense.md` | Anthropic 安全技能：prompt injection 防御策略 |
| **新增** `companion/builtin-skills/security/jailbreak-detection.md` | Anthropic 安全技能：越狱检测策略 |
| **新增** `companion/builtin-skills/security/instruction-hierarchy.md` | Anthropic 安全技能：指令层级保护 |

### 前端 (chrome-extension/src)

| 文件 | 改动内容 |
|------|---------|
| `chrome-extension/src/sidepanel/types.ts` | `SecurityConfirmationRequest` 新增 `risk_score`, `risk_category`, `risk_level` 字段；`LLMConfig` 新增 `privilege_mode` |
| `chrome-extension/src/sidepanel/store/agentStore.tsx` | 新增 `privilegeMode`, `securityAuditLog`；新增 action：`SET_PRIVILEGE_MODE`, `ADD_SECURITY_AUDIT` |
| `chrome-extension/src/sidepanel/App.tsx` | `SecurityConfirmationDialog` 重构：根据 risk_level 渲染不同颜色、危险 API 标红加粗、代码预览语法高亮、新增「记住此线程的选择」复选框；Header 增加特权模式状态指示灯 |
| `chrome-extension/src/sidepanel/components/SettingsSlideout.tsx` | 新增「安全设置」分组：特权模式选择器、安全技能开关、自动确认同线程操作开关、安全审计日志查看入口 |
| `chrome-extension/src/background/browser-bridge.ts` | `evaluate` 方法增加 `scanPageContent` 调用 |

## 预估开发人天

| 分类 | 人天 | 说明 |
|------|------|------|
| 后端开发 | 4 | Risk Engine (1d) + Privilege Manager (0.5d) + Page Scanner (0.5d) + 集成到现有安全流程 (1d) + 内置安全技能 (0.5d) + HMAC session token (0.5d) |
| 前端开发 | 2.5 | 安全确认弹窗重构 (1d) + 设置面板安全分组 (0.5d) + Header 特权指示灯 (0.25d) + Page Scanner 集成到 BrowserBridge (0.5d) + 状态管理扩展 (0.25d) |
| 测试 | 2 | 后端单元测试 (1d) + 前端测试 (0.5d) + 集成测试 (0.5d) |
| 文档 | 0.5 | 更新架构文档、安全策略说明、用户手册 |
| **合计** | **9** | |

## 潜在风险

### 安全风险
| 风险 | 严重程度 | 说明 | 缓解措施 |
|------|---------|------|---------|
| 特权模式被恶意利用 | 高 | 用户开启「高级」模式后，若 LLM 被诱导执行恶意代码 | 高级模式仍强制确认 score>8 的操作；所有自动执行操作记录审计日志；每次启动时重置为「标准」模式 |
| Risk Scorer 误评分 | 中 | 动态评分规则不完善 | 保守策略：不确定时升级至「需确认」；持续收集用户反馈优化权重 |
| HMAC Session Token 被盗 | 中 | 若 extension 被其他扩展注入 | Session token 绑定 threadId + 时间窗口；使用 chrome.storage.local |
| Page Scanner 绕过 | 低 | 攻击者使用编码/混淆脚本 | 特权模式下仍强制扫描；结合 CSP 报告；定期更新检测模式 |

### 性能风险
| 风险 | 严重程度 | 说明 | 缓解措施 |
|------|---------|------|---------|
| 风险评分增加延迟 | 低 | 每次 tool_call 增加评分计算，可能增加 10-50ms | 纯本地计算，无 I/O；缓存同代码评分结果；异步执行不阻塞 WebSocket |
| 网页内容扫描开销 | 中 | 大页面 HTML 扫描可能耗时 | 截断扫描长度（最大 50KB）；使用 Worker 线程（未来优化） |

### 用户体验风险
| 风险 | 严重程度 | 说明 | 缓解措施 |
|------|---------|------|---------|
| 确认弹窗疲劳 | 中 | 即使标准模式，频繁确认可能降低用户注意力 | 同线程同类操作自动记忆（可选）；清晰的 risk_level 视觉区分；一键拒绝 + 记住选择 |
| 特权模式理解成本 | 低 | 用户不理解三级模式的区别 | 设置面板增加详细说明和示例；首次使用时引导式说明 |
| 误阻断正常操作 | 中 | 过于保守的评分可能频繁阻断正常浏览 | 只读模式几乎不阻断；可恢复错误反馈给 LLM 重试；用户可手动添加 tool_whitelist |

## 核心设计决策

1. **Risk Score 0-10 分级**：基于 API 类型权重、代码复杂度、目标域信任度、历史行为的多维评分
2. **特权模式三级设计**：
   - **只读 (readonly)**：只允许读操作，所有写操作强制确认
   - **标准 (standard)**：低风险自动执行，中风险确认，高风险阻断（默认）
   - **高级 (advanced)**：中风险以下自动执行（同线程记忆），高风险仍需确认
3. **Anthropic 安全技能内置化**：将防御策略作为 system prompt 的一部分注入
4. **网页内容扫描不随特权降级**：即使高级模式，从网页获取的内容仍经过 page-scanner 检测

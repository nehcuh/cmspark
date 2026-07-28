# 方案一：激进方案 —— AI 驱动的智能自动化

## 核心理念
信任 LLM 的判断能力，最小化用户干预，追求极致的自动化体验。大幅减少对用户的确认打扰，依赖 AI 驱动的动态风险评估替代静态规则，快速响应，最小化执行延迟。

## 架构图

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              用户层 (Chrome Extension)                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐ │
│  │ Side Panel   │  │ Security     │  │ Privilege    │  │ Settings Slideout        │ │
│  │   UI         │◄─┤ Confirmation │◄─┤ Mode Toggle  │◄─┤ (新增: 安全等级/特权模式) │ │
│  │              │  │   Dialog     │  │   (标红)     │  │                          │ │
│  └──────┬───────┘  └──────────────┘  └──────────────┘  └──────────────────────────┘ │
│         │                                                                            │
│  ┌──────▼──────────────────────────────────────────────────────────────────────────┐ │
│  │                      Background Service Worker                                   │ │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │ │
│  │  │ Browser     │  │ Security    │  │ Page Content│  │ WebSocket Client        │ │ │
│  │  │ Bridge      │  │ Token       │  │ Scanner     │  │ (ws://127.0.0.1:23401)  │ │ │
│  │  │ (CDP/exec)  │  │ Validator   │  │ (DOM注入检测)│  │                         │ │ │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────────────────┘ │ │
│  └──────────────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────────────┘
                                          │
                                          ▼ WebSocket
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              Companion (Node.js)                                     │
│                                                                                      │
│  ┌────────────────────────────────────────────────────────────────────────────────┐ │
│  │                         AI Security Engine (新增核心模块)                        │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌────────────────────┐  │ │
│  │  │ LLM-based    │  │ Dynamic Risk │  │ Prompt Inj.  │  │ Jailbreak          │  │ │
│  │  │ Risk Judge   │  │   Scorer     │  │   Detector   │  │   Detector         │  │ │
│  │  │ (轻量模型)    │  │  (0-100分)   │  │  (语义级)     │  │  (语义级)          │  │ │
│  │  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────────┬─────────┘  │ │
│  │         └─────────────────┴─────────────────┴─────────────────────┘              │ │
│  │                              │                                                   │ │
│  │                         ┌────▼────┐                                              │ │
│  │                         │ Decision│ ◄── privilege_mode (global/thread-level)     │ │
│  │                         │ Engine  │                                              │ │
│  │                         └────┬────┘                                              │ │
│  └──────────────────────────────┼──────────────────────────────────────────────────┘ │
│                                 │                                                    │
│  ┌──────────────────────────────┼──────────────────────────────────────────────────┐ │
│  │                         原有模块 (增强)                                           │ │
│  │  ┌──────────────┐  ┌───────▼────────┐  ┌──────────────┐  ┌────────────────────┐ │ │
│  │  │ Security     │  │ SecurityPolicy │  │  Tool        │  │   ThreadManager    │ │ │
│  │  │ Confirmation │◄─┤   (HMAC Token) │  │  Executor    │  │   (privilege字段)  │ │ │
│  │  │   Manager    │  │                │  │              │  │                    │ │ │
│  │  └──────────────┘  └────────────────┘  └──────────────┘  └────────────────────┘ │ │
│  │                                                                                  │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌────────────────────┐   │ │
│  │  │ SkillEngine   │  │ LLM Adapter  │  │  Config      │  │  builtin-skills/   │   │ │
│  │  │ (安全技能注入) │  │ (安全指令注入)│  │  (新增字段)   │  │  safety-guard.md   │   │ │
│  │  └──────────────┘  └──────────────┘  └──────────────┘  └────────────────────┘   │ │
│  └──────────────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

**数据流：**
1. 工具执行流: LLM → Tool Executor → AI Security Engine (风险评分) → 低风险(0-30)直接执行 / 中风险(31-70)快速确认(3秒) / 高风险(71-100)强制确认(60秒)
2. 网页内容扫描流: get_page_text / get_page_html → Page Content Scanner → 检测隐藏prompt注入脚本 → 发现威胁立即阻断 + 告警LLM
3. 特权模式流: 用户设置 privilege_mode = "aggressive" → AI Security Engine 阈值调整 → 仅高风险(>=80)触发确认

## 涉及的模块和改动点

### 新增模块

| 文件路径 | 说明 |
|---------|------|
| `companion/src/security/ai-risk-engine.ts` | AI 动态风险评估引擎核心。接收 toolName + code + context，输出 riskScore(0-100) + riskLevel + reasoning |
| `companion/src/security/prompt-injection-detector.ts` | 语义级 prompt 注入检测器。基于 embedding 相似度 + 轻量分类模型，替代现有24个正则 |
| `companion/src/security/jailbreak-detector.ts` | 越狱检测器。检测对话中的越狱尝试 |
| `companion/src/security/page-content-scanner.ts` | 网页内容危险脚本扫描器。在 get_page_text/get_page_html 返回前扫描 DOM 中的可疑注入脚本 |
| `companion/src/security/privilege-manager.ts` | 特权模式管理器。管理全局/线程级别的特权配置，动态调整风险阈值 |
| `companion/builtin-skills/safety-guard.md` | 内置 Anthropic 安全技能。包含 prompt injection 防御、越狱检测、工具使用安全准则 |
| `chrome-extension/src/background/page-scanner.ts` | Extension 侧网页内容实时扫描。通过 MutationObserver 监控 DOM 变化 |
| `chrome-extension/src/sidepanel/components/PrivilegeModeToggle.tsx` | 特权模式切换 UI 组件 |
| `chrome-extension/src/sidepanel/components/SecurityConfirmationV2.tsx` | 新版安全确认对话框（标红、更醒目、一键允许） |

### 修改模块

| 文件路径 | 改动内容 |
|---------|---------|
| `companion/src/security.ts` | 保留 DANGEROUS_API_PATTERNS 作为基线规则；新增 assessRiskWithAI() 函数；checkHighRiskExecution() 改为返回风险评分 |
| `companion/src/security-confirmation.ts` | 支持分级确认（快速确认3秒/标准确认60秒）；特权模式下中风险自动批准；新增 batchApprove 批量批准机制 |
| `companion/src/security-policy.ts` | 扩展 Token 系统支持"特权会话 Token"（1小时 TTL） |
| `companion/src/server.ts` | 集成 AI Risk Engine；新增 security.privilege.set/get WS 消息处理；网页内容返回时调用 Page Content Scanner |
| `companion/src/llm/adapter.ts` | 在 system prompt 中注入 safety-guard 技能内容；检测到越狱尝试时自动终止对话 |
| `companion/src/config.ts` | 新增 privilege_mode: "normal" | "aggressive" | "paranoid"，security_ai_model |
| `companion/src/threads/thread-manager.ts` | Thread 结构新增 privilege_mode_override 字段 |
| `companion/src/skills/skill-engine.ts` | buildSystemPrompt 自动注入 safety-guard 内置技能；安全技能标记为 builtin: true, immutable: true |
| `chrome-extension/src/background/browser-bridge.ts` | evaluate 执行前调用 Page Scanner 扫描当前页面 |
| `chrome-extension/src/sidepanel/App.tsx` | SecurityConfirmationDialog 升级：标红危险 API、显示风险评分、新增"总是允许此类操作"复选框 |
| `chrome-extension/src/sidepanel/store/agentStore.tsx` | 新增 state: privilegeMode, securityRiskScore, autoApprovePatterns |
| `chrome-extension/src/sidepanel/components/SettingsSlideout.tsx` | 新增安全设置区域：特权模式选择、风险阈值调节、安全技能开关 |

## 预估开发人天

| 分类 | 人天 | 说明 |
|-----|------|------|
| 后端 | 15.5 | AI Risk Engine (3d) + Prompt Injection Detector (2d) + Jailbreak Detector (1.5d) + Page Content Scanner (2d) + Privilege Manager (1.5d) + Security 模块改造 (2d) + Server/ToolExecutor 集成 (1.5d) + LLM Adapter 安全注入 (1d) + Config/Thread 扩展 (0.5d) |
| 前端 | 9 | SecurityConfirmationV2 (2d) + PrivilegeModeToggle (1d) + SettingsSlideout 安全设置 (1.5d) + App.tsx/Store 集成 (1.5d) + Page Scanner Extension (2d) + BrowserBridge 集成 (1d) |
| 测试 | 7 | 单元测试 (3d) + 集成测试 (2d) + 安全渗透测试 (2d) |
| 文档 | 2 | 架构文档更新 (1d) + 安全白皮书 (1d) |
| **总计** | **33.5** | 约 5 周（1人全职）或 2.5 周（2人并行）|

## 潜在风险

### 安全风险
| 风险 | 严重程度 | 说明 |
|-----|---------|------|
| AI 风险评估误判 | 高 | 激进方案核心依赖 AI 判断，可能出现低风险误判为高风险或高风险误判为低风险 |
| 特权模式被恶意激活 | 高 | 攻击者通过 prompt injection 诱导系统进入特权模式 |
| 轻量模型被绕过 | 中 | 本地/轻量风险判断模型可能被针对性对抗样本绕过 |
| HMAC Token 在特权模式下长期有效 | 中 | 特权会话 Token 1 小时 TTL 可能被利用 |

### 性能风险
| 风险 | 严重程度 | 说明 |
|-----|---------|------|
| AI 风险评估延迟 | 高 | 每次工具调用前调用 LLM 做风险评估可能增加 500ms-2s 延迟 |
| Embedding 计算开销 | 中 | Prompt injection 检测需要计算 embedding，高频调用时 CPU 占用高 |
| Extension 侧 DOM 扫描开销 | 中 | MutationObserver 持续监控所有页面可能影响浏览器性能 |

### 用户体验风险
| 风险 | 严重程度 | 说明 |
|-----|---------|------|
| "总是允许"误操作 | 高 | 用户勾选后后续同类高风险操作自动通过 |
| 特权模式认知偏差 | 中 | 用户可能不理解特权模式的风险 |
| 确认频率 still 过高 | 中 | 某些场景仍可能频繁弹确认 |

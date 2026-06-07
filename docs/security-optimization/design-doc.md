# CMspark 安全管理能力优化 — 详细设计文档

> **版本**: v1.0  
> **日期**: 2026-06-07  
> **状态**: 设计评审通过  
> **作者**: Dynamic Workflow (3 Architecture Agents + 2 Review Agents + Tournament)

---

## 1. 项目背景与目标

### 1.1 现有安全架构

CMspark 当前安全机制：

| 组件 | 现状 | 风险等级 |
|------|------|---------|
| Cookie 信任域白名单 | `isTrustedDomain()` 支持通配符 | 中 |
| 危险 API 检测 | 24 个正则模式，无 AST 级分析 | 中 |
| HMAC Token | SHA-256, 5 分钟 TTL, 单次使用 | 良 |
| 用户确认流 | 60 秒超时，无批量批准 | 良 |
| 错误分类 | security / non_recoverable / recoverable | 良 |
| 内容净化器 | 24 个正则检测 prompt 注入 | 中 |
| tool_whitelist | Thread 结构已定义但**未使用** | **高** |
| HMAC Secret 传输 | 通过 WS `security.config` 明文传输 | **高** |

### 1.2 关键漏洞（需立即修复）

1. **HMAC Secret 明文传输** (`server.ts:661`)：任何能连接 Companion 的客户端都能获取密钥
2. **tool_whitelist 未使用**：已定义但未在安全检查中引用
3. **ContentSanitizer 仅替换为 `[FILTERED]`**：未拒绝整个注入文档

### 1.3 用户新需求

1. 用户确认 UI 标红提示危险操作
2. 支持用户通过设置进入特权模式
3. 内置 Anthropic 安全技能防止 prompt 注入
4. 特权模式下仍需识别网页中的危险脚本

---

## 2. 方案演进过程

### 2.1 三种架构方案

| 方案 | 核心理念 | 开发人天 | 安全评分 | 性能评分 |
|------|---------|---------|---------|---------|
| **激进方案** | AI 驱动自动化，最小化用户干预 | 33.5 | 5.5/10 | 4.5/10 |
| **保守方案** | 零信任多层纵深防御 | 40.5 | 8/10 | 5.5/10 |
| **折中方案** | 智能分层，低风险自动执行 | 9 | 7/10 | 8/10 |

### 2.2 评审结果

**Security Reviewer** 评分：保守(8) > 折中(7) > 激进(5.5)
**Performance Reviewer** 评分：折中(8) > 保守(5.5) > 激进(4.5)

### 2.3 锦标赛结果

| Round | 对阵 | 胜出 |
|-------|------|------|
| Round 1 | 激进 vs 保守 | **保守** (安全+性能双重优势) |
| Round 2 | 保守 vs 折中 | **折中** (性能、成本、体验大胜) |
| Round 3 | 激进 vs 折中 | **折中** (安全+性能双重优势) |

**最终排名**：🥇 折中方案 > 🥈 保守方案 > 🥉 激进方案

### 2.4 最终决策

**以折中方案为基础，吸收保守方案的核心安全原则。**

---

## 3. 最终架构设计

### 3.1 架构图

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
│  │  │ BrowserBridge │  │ SecurityToken │  │  Page Content Sanitizer      │   │ │
│  │  │ - 工具执行    │  │ - HMAC验证   │  │  - DOM净化后返回              │   │ │
│  │  │ - 危险API检测 │  │ - 绑定code   │  │  - 特权模式下仍执行           │   │ │
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
│  │  │              │  │ score≤2│ 3-7   │ ≥8  │ │                        │  │ │
│  │  │              │  └────────┴────────┴─────┘ │                        │  │ │
│  │  │              └────────────────────────────┘                        │  │ │
│  │  └────────────────────────────────────────────────────────────────────┘  │ │
│  │                                                                           │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────────┐   │ │
│  │  │ SecurityPolicy│  │ SecurityConf  │  │  Anthropic Safety Skills      │   │ │
│  │  │ - HMAC Token  │  │ irmationMgr  │  │  (builtin-skills/security/)   │   │ │
│  │  │ - 绑定code    │  │ - 45s超时队列 │  │  - prompt-injection-defense   │   │ │
│  │  │ - 2min TTL    │  │ - 无批量批准  │  │  - jailbreak-detection        │   │ │
│  │  └──────────────┘  └──────────────┘  │  - instruction-hierarchy      │   │ │
│  │                                       └──────────────────────────────┘   │ │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────────┐   │ │
│  │  │ ContentSanitizer│ │ ThreadManager │  │  SkillEngine (existing)      │   │ │
│  │  │ - 48正则规则  │  │ - 线程级配置  │  │  - safety-guard强制注入       │   │ │
│  │  │ - 网页内容净化 │  │ - tool_whitelist│ │  - immutable builtin          │   │ │
│  │  └──────────────┘  └──────────────┘  └──────────────────────────────┘   │ │
│  └─────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 核心数据流

**工具执行流：**
```
LLM → tool_call → Risk Scorer (0-10分, <10ms)
                    │
        score 0-2   │   score 3-7          │   score 8-10
           ↓        │      ↓               │      ↓
      自动执行      │  检查PrivilegeManager  │   强制确认
      (记录审计)    │   ├─ 高级+同代码记忆→自动  │   (特权无效)
                    │   └─ 其他 → UI确认 → HMAC  │
                    │      Token → 执行          │
```

**关键原则：**
- **score ≥ 8 的操作：特权模式无效，强制确认**
- **同线程记忆：绑定 code hash，非"同类操作"**
- **HMAC Token：绑定 code hash + threadId，2 分钟 TTL，单次使用**

---

## 4. 模块设计

### 4.1 新增模块

| 模块 | 文件路径 | 职责 |
|------|---------|------|
| Risk Engine | `companion/src/security/risk-engine.ts` | 核心风险评分引擎 (0-10)，整合静态分析、上下文分析 |
| Privilege Manager | `companion/src/security/privilege-manager.ts` | 三级模式管理、降级策略、会话状态 |
| Page Scanner | `companion/src/security/page-scanner.ts` | 网页内容威胁扫描、DOM 脚本检测 |
| Safety Skill | `companion/builtin-skills/security/*.md` | Anthropic 安全技能：prompt-injection-defense, jailbreak-detection, instruction-hierarchy |
| Page Sanitizer (Ext) | `chrome-extension/src/background/page-sanitizer.ts` | Extension 侧 DOM 净化 |

### 4.2 修改模块

| 模块 | 关键改动 |
|------|---------|
| `companion/src/security.ts` | 扩充 DANGEROUS_API_PATTERNS 至 48 个；增加 API 权重映射；`checkHighRiskExecution()` 改为返回 `RiskScore` |
| `companion/src/security-policy.ts` | Token 绑定 code hash + threadId；TTL 缩短至 2 分钟；单次使用后立即失效 |
| `companion/src/security-confirmation.ts` | 超时缩短至 45 秒；删除 batchApprove；增加 `risk_level` / `defense_layer` 字段 |
| `companion/src/server.ts` | 集成 Risk Scorer；删除自动执行分支；新增 `security.privilege.set/get` WS 消息 |
| `companion/src/llm/adapter.ts` | system prompt 强制注入 safety-guard 技能；越狱检测终止对话 |
| `companion/src/message-router.ts` | `osascript_eval` 接入 Risk Scorer；拒绝 WS 发起的特权模式切换 |
| `companion/src/config.ts` | 新增 `security.privilege_mode`, `security.safety_skills_enabled` |
| `companion/src/threads/thread-manager.ts` | 启用 `tool_whitelist` 检查；新增 `privilege_mode_override` |
| `companion/src/skills/skill-engine.ts` | `buildSystemPrompt` 强制注入 safety-guard (immutable) |
| `companion/src/skills/content-sanitizer.ts` | 扩充至 48 个正则；新增 HTML 注入模式；增加 `sanitizePageContent()` |
| `chrome-extension/src/background/browser-bridge.ts` | evaluate 前调用 Page Sanitizer；Token 严格验证 |
| `chrome-extension/src/sidepanel/App.tsx` | 安全确认弹窗标红；代码语法高亮；无"总是允许"选项 |
| `chrome-extension/src/sidepanel/store/agentStore.tsx` | 新增 `privilegeMode`, `securityAuditLog` |
| `chrome-extension/src/sidepanel/components/SettingsSlideout.tsx` | 安全设置分组：特权模式、安全技能开关、审计日志入口 |

---

## 5. Risk Scorer 详细设计

### 5.1 评分维度 (0-10)

```typescript
interface RiskScore {
  total: number;        // 0-10, 整数
  breakdown: {
    apiRisk: number;     // 危险API权重 (0-4)
    codeComplexity: number; // 代码复杂度 (0-2)
    domainTrust: number; // 目标域信任度 (0-2)
    historyPattern: number; // 历史行为模式 (0-2)
  };
  matchedPatterns: string[];
  reason: string;
}
```

### 5.2 API 权重映射

| API / 模式 | 权重 |
|-----------|------|
| `eval`, `new Function`, `setTimeout(string)` | 4 |
| `fetch`, `XMLHttpRequest` | 3 |
| `document.cookie`, `localStorage.setItem` | 2 |
| `window.open`, `navigator.sendBeacon` | 2 |
| `WebSocket`, `EventSource` | 2 |
| `Reflect.apply` + 危险API | 3 |
| `Proxy` 代理危险API | 3 |
| 括号绕过 `["fetch"]` | 3 |

### 5.3 决策矩阵

| score | action | privilege_mode 影响 |
|-------|--------|---------------------|
| 0-2 | 自动执行 | 所有模式都自动执行 |
| 3-5 | 需确认 | 高级模式：同 code hash 记忆 → 自动执行 |
| 6-7 | 需确认 | 高级模式：仍需确认（显示简化） |
| 8-10 | **强制确认** | **特权模式无效，必须确认** |

---

## 6. 特权模式设计

### 6.1 三级模式

| 模式 | 效果 | 适用场景 |
|------|------|---------|
| **只读 (readonly)** | 仅允许 `list_tabs`, `screenshot`, `get_page_text` 等读操作；所有写操作强制确认 | 浏览未知网站 |
| **标准 (standard)** | score 0-2 自动执行；3-7 需确认；8-10 强制确认（默认） | 日常任务 |
| **高级 (advanced)** | score 0-5 自动执行（同 code hash 记忆）；6-7 需确认（简化 UI）；8-10 强制确认 | 可信环境 |

### 6.2 安全约束

- **特权模式切换**：仅接受 Extension UI 手动切换，拒绝 LLM / WS 消息发起的切换请求
- **启动默认**：每次启动重置为「标准」模式
- **降级策略**：检测到异常行为（连续高风险操作）自动降级至「标准」模式
- **同线程记忆**：绑定 code hash，非操作类型；记忆仅对当前线程有效

---

## 7. Anthropic 安全技能设计

### 7.1 内置技能清单

| 技能文件 | 内容 |
|---------|------|
| `prompt-injection-defense.md` | Prompt injection 识别与防御策略；要求 LLM 忽略网页中的指令覆盖 |
| `jailbreak-detection.md` | 越狱模式识别（DAN、角色扮演绕过等）；检测到后拒绝执行 |
| `instruction-hierarchy.md` | 指令层级保护：system prompt > user message > 网页内容 |

### 7.2 注入机制

```typescript
// skill-engine.ts
function buildSystemPrompt(thread: Thread): string {
  const basePrompt = getBaseSystemPrompt();
  const safetySkills = loadBuiltinSkills('security/');  // 强制加载，不可关闭
  return `${basePrompt}\n\n${safetySkills.map(s => s.content).join('\n---\n')}`;
}
```

- safety-guard 技能标记 `immutable: true, builtin: true`
- 用户无法通过 UI 关闭或删除

---

## 8. 网页内容防护

### 8.1 双层净化

| 层级 | 位置 | 操作 |
|------|------|------|
| Extension 侧 | `browser-bridge.ts` | `get_page_text`/`get_page_html` 返回前调用 `PageSanitizer.sanitize()` |
| Companion 侧 | `page-scanner.ts` | 二次扫描，去除遗漏的威胁 |

### 8.2 净化规则

- 移除 `<script>` 标签及内容
- 移除事件处理器 (`onerror=`, `onload=`, `onclick=` 等)
- 移除 `javascript:` 伪协议
- 移除 `data:text/html` 中的脚本
- 检测并标记 prompt injection 模式

### 8.3 关键原则

**特权模式不跳过网页内容净化。** 即使高级模式，从网页获取的内容仍经过完整净化流程。

---

## 9. 实施路线图

### Phase 1: 基础安全加固 (1 周)

| 任务 | 文件 | 人天 |
|------|------|------|
| 修复 HMAC Secret 明文传输 | `server.ts` | 0.5 |
| 启用 tool_whitelist 检查 | `server.ts`, `thread-manager.ts` | 0.5 |
| 扩充 ContentSanitizer 至 48 正则 | `content-sanitizer.ts` | 0.5 |
| HMAC Token 绑定 code hash | `security-policy.ts` | 0.5 |
| 安全确认弹窗标红 | `App.tsx` | 0.5 |
| **Phase 1 合计** | | **2.5** |

### Phase 2: Risk Scorer + 特权模式 (1 周)

| 任务 | 文件 | 人天 |
|------|------|------|
| Risk Engine 实现 | `risk-engine.ts` | 1 |
| Privilege Manager 实现 | `privilege-manager.ts` | 0.5 |
| Server 集成 Risk Scorer | `server.ts` | 0.5 |
| 设置面板安全分组 | `SettingsSlideout.tsx` | 0.5 |
| Header 特权指示灯 | `App.tsx` | 0.25 |
| Store 状态扩展 | `agentStore.tsx` | 0.25 |
| **Phase 2 合计** | | **3** |

### Phase 3: 安全技能 + 网页净化 (0.5 周)

| 任务 | 文件 | 人天 |
|------|------|------|
| Anthropic Safety Skills 内置 | `builtin-skills/security/*.md` | 0.5 |
| LLM Adapter 强制注入 | `llm/adapter.ts` | 0.25 |
| Page Scanner 实现 | `page-scanner.ts` | 0.5 |
| Extension Page Sanitizer | `page-sanitizer.ts` | 0.5 |
| BrowserBridge 集成 | `browser-bridge.ts` | 0.25 |
| **Phase 3 合计** | | **2** |

### Phase 4: 测试 + 文档 (0.5 周)

| 任务 | 人天 |
|------|------|
| 单元测试 (Risk Engine, Privilege Manager) | 1 |
| 集成测试 (端到端安全流) | 0.5 |
| 安全渗透测试 | 0.5 |
| 架构文档更新 | 0.5 |
| **Phase 4 合计** | **2.5** |

### 总计

| 阶段 | 人天 | 周期 |
|------|------|------|
| Phase 1 | 2.5 | 3 天 |
| Phase 2 | 3 | 3 天 |
| Phase 3 | 2 | 2 天 |
| Phase 4 | 2.5 | 2 天 |
| **总计** | **10** | **10 工作日 (~2 周)** |

---

## 10. 风险评估与缓解

### 10.1 安全风险

| 风险 | 严重程度 | 缓解措施 |
|------|---------|---------|
| 特权模式被恶意利用 | 高 | 高级模式仍强制确认 score≥8；启动默认标准模式；拒绝 WS 切换请求 |
| Risk Scorer 误评分 | 中 | 保守策略：不确定时升级至「需确认」；持续收集反馈优化权重 |
| HMAC Token 被盗 | 中 | Token 绑定 code hash + threadId；2 分钟 TTL；单次使用 |
| Page Scanner 绕过 | 低 | 双层净化；特权模式不跳过；定期更新检测模式 |

### 10.2 性能风险

| 风险 | 严重程度 | 缓解措施 |
|------|---------|---------|
| 风险评分增加延迟 | 低 | 纯本地计算 <10ms；缓存 code hash → score |
| 网页内容扫描开销 | 中 | 截断 50KB；异步执行；超时 fallback |
| 确认弹窗疲劳 | 中 | 同 code hash 记忆；清晰的 risk_level 视觉区分 |

---

## 11. 附录

### A. 参考文档

- 激进方案详细设计: `aggressive-plan.md`
- 保守方案详细设计: `conservative-plan.md`
- 折中方案详细设计: `balanced-plan.md`
- 锦标赛结果: `tournament-results.md`

### B. 评审记录

- Security Review: 安全强度评分 + 盲点分析 + 实施风险
- Performance Review: 延迟/吞吐量/资源/可扩展性/复杂度评估

### C. 相关 ADR

- ADR-005: Cookie Trust Domain Security
- ADR-006: Layered Defense Stack (新增)

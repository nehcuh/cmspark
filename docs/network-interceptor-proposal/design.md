# CMspark 网络拦截器扩展 — 概念设计

> **版本**: v0.1（概念稿）  
> **日期**: 2026-06-11  
> **状态**: 设计提案 / 待评审  
> **范围**: Chrome Extension 网络数据流拦截能力的架构设计，支撑后续高阶网络攻防/安全测试类 Skill

---

## 目录

1. [背景与动机](#1-背景与动机)
2. [设计目标](#2-设计目标)
3. [核心概念](#3-核心概念)
4. [总体架构](#4-总体架构)
5. [Extension 侧设计](#5-extension-侧设计)
6. [Companion 侧设计](#6-companion-侧设计)
7. [WebSocket 协议扩展](#7-websocket-协议扩展)
8. [安全模型](#8-安全模型)
9. [Skill 封装示例](#9-skill-封装示例)
10. [模块改动清单](#10-模块改动清单)
11. [实施路线图](#11-实施路线图)
12. [风险与限制](#12-风险与限制)

---

## 1. 背景与动机

当前 CMspark Browser Agent 已具备较强的浏览器操控能力：

- 通过 `chrome.debugger` + CDP 实现页面读取、截图、元素操作、JS 执行
- 通过 `chrome.cookies` API 管理 Cookie
- 通过双层安全架构（Extension + Companion Risk Engine）控制危险操作

但现有能力仍停留在**页面层**：Agent 能看到的是页面最终渲染结果，无法感知页面背后的网络行为。如果要支撑以下场景，必须引入网络数据流拦截能力：

| 场景 | 为什么需要网络拦截 |
|------|-------------------|
| 安全测试 | 观察请求参数、响应体、Headers，发现注入点、敏感信息泄露 |
| API 探索 | 自动逆向 SPA 的前后端接口，生成 OpenAPI 文档 |
| 漏洞验证 | 重放/篡改请求以验证 CSRF、IDOR、越权等漏洞 |
| 数据提取 | 从 XHR/Fetch 响应中提取结构化 JSON 数据（比解析 DOM 更稳定） |
| Mock/沙盒 | 将第三方 API 响应替换为本地构造数据，做隔离测试 |
| 性能分析 | 采集资源加载时间线，识别慢请求 |

项目 Manifest 中已声明 `"debugger"` 权限，这意味着我们可以通过 CDP 的 `Fetch` 和 `Network` domain 实现底层网络拦截，而无需依赖已被 MV3 大幅削弱 `webRequest` API。

---

## 2. 设计目标

### 2.1 必须目标（P0）

1. **只读监听**：捕获指定 tab 的所有 HTTP/HTTPS/XHR/Fetch/WebSocket 请求和响应，包括 headers 和 body。
2. **事件上送**：通过网络事件流实时上送 Companion，供 LLM 分析和 Skill 消费。
3. **安全基线**：所有拦截行为必须经过现有 Risk Assessment Engine，默认只读自动执行，任何篡改/阻断/伪造响应必须强制确认。

### 2.2 期望目标（P1）

4. **请求篡改**：支持修改请求的 URL、method、headers、body 后放行。
5. **响应伪造**：支持将特定请求返回构造的本地响应（`Fetch.fulfillRequest`）。
6. **请求重放**：支持将已捕获的请求按原样或修改后重新发送。
7. **WebSocket 帧捕获**：监听 WebSocket 发送和接收的帧内容。

### 2.3 远期目标（P2）

8. **规则引擎**：Companion 侧可配置拦截规则（URL pattern、condition、action）。
9. **流量录制/回放**：将完整网络会话保存为 HAR-like 格式，后续可回放。
10. **被动扫描**：基于规则自动标记可疑请求/响应（如明文传输密码、CORS 配置宽松）。

---

## 3. 核心概念

### 3.1 能力分层

我们将网络拦截能力分为三个层级，每一层对应不同的风险等级和用户授权要求：

| 层级 | 名称 | 能力 | 风险等级 | 默认行为 |
|------|------|------|----------|----------|
| L1 | **Observer（观察者）** | 监听请求/响应元数据（URL、status、headers、timing） | 低 | 自动执行 |
| L2 | **Inspector（检查者）** | 读取请求/响应 body（可能包含敏感数据） | 中 | 需确认（首次/跨域） |
| L3 | **Interceptor（拦截者）** | 修改请求、伪造响应、阻断请求、重放请求 | 高 | 强制确认 |

### 3.2 关键术语

- **Session**：一次网络拦截会话，绑定到一个 `tabId`，包含多个 NetworkEvent。
- **NetworkEvent**：单个网络事件，如 `requestWillBeSent`、`responseReceived`、`loadingFinished`、`webSocketFrameReceived`。
- **InterceptRule**：Companion 下发的拦截规则，描述匹配条件和动作。
- **PausedRequest**：被 CDP `Fetch.requestPaused` 暂停的请求，等待 Extension 决定继续/修改/伪造/失败。

---

## 4. 总体架构

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Chrome Extension (MV3)                              │
│  ┌──────────────────────┐        ┌─────────────────────────────────────┐   │
│  │ BrowserBridge        │        │ NetworkInterceptor                  │   │
│  │ (existing)           │        │ (new)                               │   │
│  │ - tabs/cookies/click │        │ - Fetch.enable / Network.enable     │   │
│  │ - CDP Page/DOM/Input │        │ - Fetch.requestPaused handler       │   │
│  └──────────┬───────────┘        │ - response body retrieval           │   │
│             │                    │ - PausedRequest decision queue      │   │
│             │                    └──────────────┬──────────────────────┘   │
│             │                                   │                          │
│             └───────────────┬───────────────────┘                          │
│                             │                                               │
│                             ▼ WebSocket (ws://127.0.0.1:23401)              │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                      Message Router (existing)                        │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐   │  │
│  │  │ tool.execute │  │ network.*    │  │ security.*               │   │  │
│  │  └──────────────┘  └──────────────┘  └──────────────────────────┘   │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
                                          │
                                          ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Companion (Node.js)                               │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                     Network Skill Engine (new)                        │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐   │  │
│  │  │ Event Parser │  │ Rule Engine  │  │ Replay / Mock Builder    │   │  │
│  │  │ - normalize  │  │ - match      │  │ - reconstruct request    │   │  │
│  │  │ - classify   │  │ - score      │  │ - fulfill response       │   │  │
│  │  └──────┬───────┘  └──────┬───────┘  └────────────┬─────────────┘   │  │
│  │         └─────────────────┼───────────────────────┘                 │  │
│  │                           ▼                                         │  │
│  │              ┌────────────────────────────┐                         │  │
│  │              │   LLM Context Builder       │                         │  │
│  │              │  (inject network events     │                         │  │
│  │              │   into system prompt)       │                         │  │
│  │              └────────────────────────────┘                         │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                     Risk Assessment Engine (existing)                 │  │
│  │  - network interception actions score ≥ 6 时强制确认                  │  │
│  │  - body inspection on cross-origin domains score ≥ 4                  │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Extension 侧设计

### 5.1 新增模块：`NetworkInterceptor`

文件位置建议：`chrome-extension/src/background/network-interceptor.ts`

核心职责：

1. 管理 CDP `Fetch` / `Network` domain 的生命周期（attach → enable → disable → detach）。
2. 接收 `Fetch.requestPaused` 事件，根据 Companion 下发的决策处理请求。
3. 将 `Network.*` 事件序列化后通过 WebSocket 发送给 Companion。
4. 维护每个 tab 的拦截会话状态。

```typescript
// 概念接口
interface InterceptSession {
  tabId: number
  level: "observer" | "inspector" | "interceptor"
  rules: InterceptRule[]
  pausedRequests: Map<string, PausedRequest>
}

interface NetworkEvent {
  type: "request" | "response" | "websocket" | "finished"
  tabId: number
  requestId: string
  timestamp: number
  payload: Record<string, any>
  // 敏感字段在 Extension 侧先做粗粒度脱敏
}
```

### 5.2 CDP Domain 选择

| CDP Domain | 用途 | 是否需要 debugger 权限 |
|------------|------|----------------------|
| `Network.enable` | 监听请求/响应元数据和 WebSocket 事件 | 是 |
| `Network.getResponseBody` | 获取响应 body | 是 |
| `Fetch.enable` | 拦截并暂停请求，支持修改/伪造 | 是 |
| `Fetch.continueRequest` | 继续被暂停的请求（可附带修改） | 是 |
| `Fetch.fulfillRequest` | 用本地构造的响应满足请求 | 是 |
| `Fetch.failRequest` | 使请求失败 | 是 |

### 5.3 与 BrowserBridge 的关系

`NetworkInterceptor` 与 `BrowserBridge` 是并列关系，都依赖 `chrome.debugger`：

```
Background Service Worker
├── BrowserBridge    (CDP Page/DOM/Input/Runtime)
├── NetworkInterceptor (CDP Fetch/Network)
└── WSClient         (与 Companion 通信)
```

关键约束：一个 tab 同时只能被一个 debugger 客户端 attach。由于两者都在同一个 extension 的 service worker 内运行，可以共享 attach 状态。

建议改动：`BrowserBridge` 中 `attachedTabs` 提升为共享模块，或在 `NetworkInterceptor` 中通过 `BrowserBridge.ensureAttached(tabId)` 复用已有连接。

### 5.4 事件流示例

```
用户说："帮我分析这个页面的 API 调用"
        │
        ▼
Companion 发送 network.subscribe { tabId, level: "inspector" }
        │
        ▼
Extension: chrome.debugger.attach(tabId) → Network.enable → Fetch.enable
        │
        ▼
页面发起 XHR
        │
        ▼
CDP 事件 Fetch.requestPaused / Network.requestWillBeSent
        │
        ▼
Extension 打包为 NetworkEvent → WebSocket → Companion
        │
        ▼
Companion 注入到 LLM context
        │
        ▼
LLM 分析后生成结论："发现 /api/login 以明文传输 password"
```

---

## 6. Companion 侧设计

### 6.1 新增模块：`NetworkSkillEngine`

文件位置建议：`companion/src/network/network-skill-engine.ts`

核心职责：

1. 接收 Extension 上送的 NetworkEvent，做归一化解析。
2. 根据当前激活的 Skill 构建 LLM 提示词片段（将网络事件注入 system prompt 或 user message）。
3. 管理 InterceptRule 生命周期。
4. 将 LLM 生成的网络操作意图转换为 Extension 可执行的命令。

### 6.2 规则引擎（远期）

```typescript
interface InterceptRule {
  id: string
  priority: number
  condition: {
    urlPattern?: string          // 通配符或正则
    methods?: string[]           // ["GET", "POST"]
    resourceType?: string[]      // ["XHR", "Fetch", "Document"]
    hasHeader?: string           // "authorization"
    requestBodyContains?: string
  }
  action: {
    type: "log" | "block" | "modify" | "mock" | "delay"
    // 仅对 modify/mock 有效
    modifications?: RequestModifications | ResponseMock
  }
}
```

### 6.3 LLM 上下文注入格式

Companion 将最近 N 个网络事件格式化为 Markdown 表格或 JSON 块，注入 LLM：

```markdown
## 当前页面网络活动（最近 20 条）

| 时间 | 方法 | URL | 状态 | 类型 | 备注 |
|------|------|-----|------|------|------|
| 12:34:01 | POST | https://example.com/api/login | 200 | xhr | 请求体含 password |
| 12:34:02 | GET  | https://example.com/api/user  | 200 | fetch | 返回 JSON 含 email |
```

注意：LLM 上下文中的网络事件需要脱敏（移除 password、token、cookie 值），只在 Skill 明确要求且用户确认后才提供完整 body。

---

## 7. WebSocket 协议扩展

在现有消息类型基础上新增 `network.*` 命名空间：

### 7.1 Companion → Extension

| 消息类型 | 说明 | 参数 |
|----------|------|------|
| `network.subscribe` | 开始监听指定 tab | `tabId`, `level`, `filters?` |
| `network.unsubscribe` | 停止监听 | `tabId` |
| `network.rule.add` | 添加拦截规则 | `rule: InterceptRule` |
| `network.rule.remove` | 移除规则 | `ruleId` |
| `network.paused.decide` | 对被暂停请求做决策 | `requestId`, `decision`, `modifications?` |

### 7.2 Extension → Companion

| 消息类型 | 说明 | 参数 |
|----------|------|------|
| `network.event` | 网络事件流 | `event: NetworkEvent` |
| `network.paused` | 请求被暂停等待决策 | `requestId`, `request`, `resourceType` |
| `network.error` | 拦截过程中出错 | `tabId`, `error` |
| `network.session.started` | 会话启动成功 | `tabId`, `level` |
| `network.session.ended` | 会话结束 | `tabId`, `reason` |

### 7.3 消息示例

```json
// Companion → Extension: 订阅 Inspector 级别
{
  "type": "network.subscribe",
  "payload": {
    "tabId": 123,
    "level": "inspector",
    "filters": {
      "resourceTypes": ["XHR", "Fetch"],
      "urlExcludes": ["*.google-analytics.com*"]
    }
  }
}

// Extension → Companion: 请求事件
{
  "type": "network.event",
  "payload": {
    "event": {
      "type": "request",
      "tabId": 123,
      "requestId": "12345.67",
      "timestamp": 1718085601234,
      "payload": {
        "url": "https://example.com/api/login",
        "method": "POST",
        "headers": { "content-type": "application/json" },
        "hasPostData": true
      }
    }
  }
}
```

---

## 8. 安全模型

网络拦截是高敏感能力，必须严格接入现有分层防御体系。

### 8.1 风险评分映射

| 操作 | Risk Score | 说明 |
|------|-----------|------|
| L1 Observer（只读元数据） | 0-2 | 类似 `list_tabs`，自动执行 |
| L2 Inspector（读取 body） | 3-5 | 涉及敏感数据，需确认（或同 code hash 记忆） |
| L3 修改请求头（非 body） | 5-6 | 可能影响业务逻辑，需确认 |
| L3 修改请求 body | 6-8 | 属于主动攻击行为，高级模式也需确认 |
| L3 伪造响应 / 阻断请求 | 8-10 | **特权模式无效，强制确认** |
| L3 请求重放到外部域名 | 7-10 | 可能产生非预期副作用 |

### 8.2 关键安全约束

1. **默认不开启**：网络拦截不是默认能力，必须由用户通过 Skill 或设置显式开启。
2. **Tab 级作用域**：一次订阅只影响一个 tab，不能全局监听所有 tab。
3. **同源偏好**：读取跨域响应 body 需要额外确认（浏览器同源策略下部分 body 本来也无法读取，但 CDP 可以）。
4. **数据脱敏**：Extension 侧先移除常见敏感字段（password、token、authorization cookie），完整 body 需要 Skill 显式申请 + 用户确认。
5. **审计日志**：所有拦截操作（订阅、body 读取、请求篡改、响应伪造）记录审计日志。
6. **时间上限**：单次订阅会话最长 30 分钟，超时自动降级为 Observer 并通知用户。

### 8.3 与现有安全组件的集成

```
LLM 生成 network.subscribe / network.paused.decide
        │
        ▼
┌─────────────────┐
│ Risk Scorer     │  ← 复用 ADR-006 的 Risk Assessment Engine
│ (score 0-10)    │
└────────┬────────┘
         │
    score ≤ 2    score 3-7    score ≥ 8
       │            │             │
       ▼            ▼             ▼
   自动执行      检查 Privilege    强制确认
                Manager          （特权无效）
```

---

## 9. Skill 封装示例

网络拦截能力的最终形态是 Skill。以下是几个早期可落地的 Skill 模板。

### 9.1 Skill: `api-explorer`（API 探索者）

用途：分析当前 SPA 的所有 XHR/Fetch 调用，生成接口文档。

```markdown
---
name: api-explorer
description: 分析页面网络请求，提取 API 端点并生成接口清单
type: tool_chain
parameters:
  include_static:
    type: boolean
    default: false
    description: 是否包含图片/CSS/JS 等静态资源
---

# API 探索者

1. 对当前激活 tab 开启 L1 Observer 级别的网络监听（持续 60 秒）。
2. 引导用户正常操作页面（或自动执行一些点击/滚动）。
3. 收集所有 XHR/Fetch 请求的 URL、Method、Status、Request/Response Content-Type。
4. 按域名和路径分组，去重后生成接口清单。
5. 对每个接口给出用途推测和可能的安全测试建议。
```

### 9.2 Skill: `csrf-probe`（CSRF 探测）

用途：检测页面中是否存在 CSRF 防护缺失的请求。

```markdown
---
name: csrf-probe
description: 检测目标站点的写操作是否缺少 CSRF 防护
type: tool_chain
parameters:
  target_origin:
    type: string
    required: true
    description: 要检测的域名
---

# CSRF 探测

1. 对目标 tab 开启 L2 Inspector 级别监听，过滤出 POST/PUT/DELETE/PATCH 请求。
2. 检查请求头中是否缺少 `origin`、`referer`、`x-csrf-token`、`x-xsrf-token` 等防护字段。
3. 对可疑请求构造一个跨域 HTML form  POC。
4. 在本地打开 POC 页面验证（不实际触发副作用）。
5. 输出风险报告。
```

### 9.3 Skill: `response-mocker`（响应模拟器）

用途：将特定 API 响应替换为 mock 数据，用于前端调试。

```markdown
---
name: response-mocker
description: 将指定 URL 的 API 响应替换为用户提供的 mock 数据
type: tool_chain
parameters:
  url_pattern:
    type: string
    required: true
    description: 要匹配的 URL 通配符
  mock_response:
    type: object
    required: true
    description: 伪造的响应对象（status, headers, body）
---

# 响应模拟器

1. 对当前 tab 开启 L3 Interceptor 级别监听。
2. 添加一条 declarative 拦截规则：URL 匹配 `{{url_pattern}}` 时伪造响应。
3. 使用 `Fetch.fulfillRequest` 返回 `{{mock_response}}`。
4. 持续监听直到用户说"停止模拟"。

注意：这是一个高风险操作，必须获得用户确认。
```

### 9.4 Skill: `jwt-inspector`（JWT 检查）

用途：从请求中提取 JWT，解析 header/payload，检查是否过期、是否使用弱算法。

```markdown
---
name: jwt-inspector
description: 从网络请求中提取并分析 JWT token
type: tool_chain
---

# JWT 检查

1. 对当前 tab 开启 L2 Inspector 级别监听。
2. 扫描所有请求头的 `authorization` 和 cookie 中的 token 状字段。
3. 对疑似 JWT 的字符串进行 base64 解码。
4. 输出每个 JWT 的 header、payload、签名算法、过期时间、是否使用 HS256/None 等弱算法。
```

---

## 10. 模块改动清单

### 10.1 新增文件

| 文件 | 职责 |
|------|------|
| `chrome-extension/src/background/network-interceptor.ts` | CDP 网络拦截核心模块 |
| `chrome-extension/src/background/network-types.ts` | NetworkEvent、InterceptRule、PausedRequest 类型 |
| `companion/src/network/network-skill-engine.ts` | Companion 侧网络 Skill 引擎 |
| `companion/src/network/network-router.ts` | 处理 `network.*` WebSocket 消息路由 |
| `companion/src/network/intercept-rules.ts` | 规则匹配和评分逻辑 |
| `companion/builtin-skills/network/api-explorer.md` | API 探索 Skill |
| `companion/builtin-skills/network/csrf-probe.md` | CSRF 探测 Skill |
| `companion/builtin-skills/network/response-mocker.md` | 响应模拟 Skill |
| `companion/builtin-skills/network/jwt-inspector.md` | JWT 检查 Skill |

### 10.2 修改文件

| 文件 | 改动 |
|------|------|
| `chrome-extension/src/background/browser-bridge.ts` | 共享 debugger attach 状态给 NetworkInterceptor；新增 `network_*` tool 路由 |
| `chrome-extension/src/background/index.ts` | 初始化 NetworkInterceptor；注册网络相关 WS 消息处理器 |
| `chrome-extension/src/background/ws-client.ts` | 保持现状，网络消息复用已有 send/onMessage |
| `companion/src/server.ts` | 新增 `network.*` 消息类型分发 |
| `companion/src/message-router.ts` | 将网络操作工具调用路由到 NetworkSkillEngine |
| `companion/src/security/risk-engine.ts` | 增加网络拦截相关评分维度 |
| `companion/src/skills/skill-engine.ts` | 允许网络 Skill 的 system prompt 注入网络事件上下文 |

### 10.3 Manifest 改动

当前 Manifest 已有 `debugger` 和 `<all_urls>`，这是最强有力的基础。MV3 下如需静态规则可补充：

```json
{
  "permissions": [
    "debugger",
    "declarativeNetRequest",
    "declarativeNetRequestWithHostAccess"
  ],
  "host_permissions": ["<all_urls>"]
}
```

> 注：`webRequest` 在 MV3 中已被大幅削弱，本设计不依赖它。`declarativeNetRequest` 仅作为 L3 响应伪造的辅助（可选）。

---

## 11. 实施路线图

### Phase 0：基础能力验证（3-4 天）

目标：证明 CDP Fetch/Network 在项目中可用。

| 任务 | 说明 |
|------|------|
| 原型脚本 | 在 `test-bridge.mjs` 或新测试文件中，用 CDP 对一个 tab 实现 `Fetch.enable` + `Network.enable` |
| 事件捕获 | 验证能收到 `requestWillBeSent`、`responseReceived`、`requestPaused` |
| body 读取 | 验证 `Network.getResponseBody` 能拿到 JSON/HTML 响应体 |
| 请求篡改 | 验证 `Fetch.continueRequest` 能修改 headers/body |
| 响应伪造 | 验证 `Fetch.fulfillRequest` 能返回本地构造响应 |

### Phase 1：Extension 核心模块（5-7 天）

| 任务 | 文件 | 说明 |
|------|------|------|
| NetworkInterceptor 骨架 | `network-interceptor.ts` | attach / enable / disable / detach 生命周期 |
| 事件归一化 | `network-types.ts` | 统一 CDP 事件格式为 NetworkEvent |
| WS 消息接入 | `index.ts` | 处理 `network.subscribe` / `network.unsubscribe` |
| 共享 attach 状态 | `browser-bridge.ts` | 避免重复 attach/detach |
| PausedRequest 队列 | `network-interceptor.ts` | 处理请求暂停和超时默认 continue |
| 敏感字段脱敏 | `network-interceptor.ts` | 默认移除 password、authorization 值 |

### Phase 2：Companion 网络引擎（5-7 天）

| 任务 | 文件 | 说明 |
|------|------|------|
| 消息路由 | `network-router.ts` | `network.*` 命名空间处理 |
| Event Parser | `network-skill-engine.ts` | 归一化和分类 |
| LLM Context Builder | `network-skill-engine.ts` | 将网络事件注入 prompt |
| Risk Engine 扩展 | `risk-engine.ts` | 增加网络操作评分 |
| 审计日志 | 已有审计模块 | 记录所有拦截行为 |

### Phase 3：Skill 与 UI（4-5 天）

| 任务 | 说明 |
|------|------|
| 内置 4 个网络 Skill | api-explorer / csrf-probe / response-mocker / jwt-inspector |
| Side Panel 网络状态面板 | 显示当前监听的 tab、事件数、最近请求 |
| 确认弹窗扩展 | 网络 L3 操作需要专门的确认 UI |
| Skill 测试 | 端到端测试每个 Skill |

### Phase 4：规则引擎与优化（远期）

| 任务 | 说明 |
|------|------|
| InterceptRule 持久化 | 保存用户自定义规则 |
| 流量录制/回放 | HAR-like 格式 |
| 被动扫描规则库 | 常见安全问题的自动标记 |

### 总投入估算

| Phase | 人天 | 产出 |
|-------|------|------|
| Phase 0 | 1-2 | 技术验证报告 |
| Phase 1 | 5-7 | Extension 网络拦截可用 |
| Phase 2 | 5-7 | Companion 网络引擎可用 |
| Phase 3 | 4-5 | 4 个内置 Skill + UI |
| Phase 4 | 5-8 | 规则引擎、录制回放（远期） |
| **合计** | **16-29** | 完整 MLP（Minimum Lovable Product） |

---

## 12. 风险与限制

### 12.1 技术限制

| 限制 | 说明 |
|------|------|
| MV3 Service Worker 生命周期 | Service Worker 可能在 30 秒后休眠。长时间网络监听需要 `chrome.alarms` 或保持激活机制配合。 |
| 同时只能 attach 一个 debugger | 如果用户同时打开 DevTools，Extension 的 debugger 会被踢出，需要优雅降级。 |
| CDP body 大小限制 | `Network.getResponseBody` 对大文件（视频、大 JSON）可能截断或失败。 |
| 跨域响应体 | CDP 可以读取跨域响应体，但某些二进制/流式内容仍受限。 |
| 性能开销 | Inspector/Interceptor 级别会增加每个请求的延迟（~5-20ms）。 |

### 12.2 安全风险

| 风险 | 严重程度 | 缓解措施 |
|------|----------|----------|
| 敏感信息泄露 | 高 | 默认脱敏；L2/L3 操作强制确认；审计日志 |
| LLM 指令冲突 | 中 | 网络 Skill 的 system prompt 明确限制只能作用于当前 tab |
| 恶意 Skill 伪造响应钓鱼 | 高 | L3 操作 score ≥ 8 强制确认；特权模式无效 |
| 请求重放造成业务损害 | 高 | 重放前必须用户确认；默认禁止重放写操作 |
| 长期监听导致隐私侵犯 | 中 | 单次会话 30 分钟上限；结束后自动降级 |

### 12.3 法律与合规风险

| 风险 | 说明 |
|------|------|
| CWS 审核 | Chrome Web Store 对高权限扩展审核严格，上架时需要详细说明用途和隐私政策。 |
| 授权边界 | 网络拦截能力应仅限用户授权的范围，不能用于未经授权的第三方站点测试。 |
| 数据跨境 | 如果网络 body 上传到 LLM 云端 API，可能涉及敏感数据出境，需明确告知用户。 |

### 12.4 推荐的使用边界

本能力建议仅用于以下场景：

1. 用户拥有完全控制权的目标系统。
2. 已获得书面/合同授权的渗透测试或安全审计。
3. 公开的漏洞赏金计划（Bug Bounty）范围内。
4. 本地开发/测试环境。

**不应**用于：

- 对未经授权的第三方网站进行攻击或侦察。
- 窃取用户凭证、Cookie、个人数据。
- 自动化发送垃圾信息或滥用外部 API。

---

## 附录：CDP 关键命令速查

```javascript
// 启用网络监听
chrome.debugger.sendCommand({ tabId }, "Network.enable")

// 启用请求拦截（所有 URL，请求和响应阶段都暂停）
chrome.debugger.sendCommand({ tabId }, "Fetch.enable", {
  patterns: [{ urlPattern: "*", requestStage: "Request" }, { urlPattern: "*", requestStage: "Response" }]
})

// 继续请求（可修改）
chrome.debugger.sendCommand({ tabId }, "Fetch.continueRequest", {
  requestId,
  url, method, headers, postData
})

// 伪造响应
chrome.debugger.sendCommand({ tabId }, "Fetch.fulfillRequest", {
  requestId,
  responseCode: 200,
  responseHeaders: [{ name: "content-type", value: "application/json" }],
  body: Buffer.from(JSON.stringify({ mocked: true })).toString("base64")
})

// 获取响应体
chrome.debugger.sendCommand({ tabId }, "Network.getResponseBody", { requestId })
```

---

*文档结束。本设计为概念提案，具体实现前建议先完成 Phase 0 技术验证，确认 CDP 网络拦截在目标 Chrome 版本中的实际表现。*

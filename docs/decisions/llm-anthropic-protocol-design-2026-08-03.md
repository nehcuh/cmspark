# Brief: Anthropic Messages 协议 + Coding-Plan 网关兼容头

| Field | Value |
|-------|--------|
| Date | 2026-08-03 |
| Status | **DIRECTION LOCKED** — Pi+Claude dual-review **APPROVE_WITH_NITS**；**P0 landed**；**P1 UI + protocol-aware connection test + skill-craft/engine createProvider** in progress / landed on main |
| Authors | Grok（PATH-A/B/C 多路对抗）+ Claude/Pi dual-review |
| Related | `companion/src/llm/adapter.ts` · `config.ts` · `settings-web.ts` · ADR-020 |
| Process | 三路 plan 对抗 → brief → [dual-review synthesis](llm-anthropic-protocol-dual-review-synthesis-2026-08-03.md) · artifacts `docs/audit/reviews/llm-anthropic-protocol-*20260803-163315*` |
| Non-goals (v1) | cc-switch 式多 Agent 配置切换器；Anthropic Max/OAuth 订阅劫持；Vision 双协议；per-thread protocol；`@anthropic-ai/sdk` 强依赖；vendor 中继广告目录；system 首行注入「You are Claude Code」 |

---

## 0. Why

CMspark 当前 LLM 栈**仅** OpenAI-compatible Chat Completions（`openai` SDK）。用户需要：

1. **原生 Anthropic Messages**（`/v1/messages`），以便直连 Anthropic 或大量「Anthropic 兼容」中继。
2. **可选** 发出类似 Claude Code 的 HTTP 客户端头：部分第三方 **Coding Plan** 中继只放行 Claude Code 客户端指纹（`user-agent: claude-cli/…`、`x-app: cli` 等）。

市场参考（学习姿态，**不**复制产品形态）：

| 项目 | 我们学什么 | 我们不学什么 |
|------|------------|--------------|
| **cc-switch** | 协议双栈（Anthropic / OpenAI）、profile 切换心智、`ANTHROPIC_*` 环境约定 | 多 CLI 全家桶桌面管理器、赞助商中继目录 |
| **claude-adapter / claude-code-proxy / anthropic-proxy-rs** | 协议翻译边界（wire vs 内部）、SSE 映射 | 把 CMspark 做成反向代理子进程 |
| **opencode-anthropic-console / pi claude-code-headers** | 网关侧实际检查的 header 集合 | 对 `api.anthropic.com` 做身份伪装、版本猫鼠自动同步 |

行业约束：Anthropic 已对**冒充 Claude Code 以使用 Max 订阅**的三方 harness 加强拦截。产品必须把：

- **(A) 合法 Messages 协议** 与  
- **(B) 第三方中继客户端门控兼容** 与  
- **(C) 官方订阅身份欺诈**  

三者切开。**(C) 永不做。**

---

## 1. One-sentence positioning

> 给 Companion 加 **协议适配层**（OpenAI 兼容 / Anthropic Messages 二选一）；内部消息与 tool 循环保持 OpenAI 形。  
> 「Coding Plan 网关兼容头」是 **第三方中继客户端门控的可选开关**（实现上可注入类似 Claude Code 的 UA/`x-app`），默认关，且 **禁止** 打向 Anthropic 官方主机。

---

## 2. Locked decisions (L1–L10)

| ID | Lock | Source |
|----|------|--------|
| **L1** | 内部 canonical 模型 = **现有 OpenAI chat/tool 形**；线程持久化 schema **不**迁 Anthropic。Anthropic 只在 **wire** 转换。 | PATH-A |
| **L2** | 新抽象 `LlmProvider`：`streamChat` / `complete`；adapter 只消费 `CanonicalStreamEvent`。 | PATH-A |
| **L3** | `llm.protocol`: `"openai" \| "anthropic"`，**显式用户选择**，默认 `"openai"`。禁止 v1 靠 base_url 静默猜协议。 | A+B+C |
| **L4** | Anthropic 实现 P0 用 **`fetch` + SSE**（非 `@anthropic-ai/sdk`），以便完整控制 headers 与 auth。 | PATH-A |
| **L5** | 两轴独立：`protocol` × `client_header_profile`（见 §3）。禁止合成一个「Claude 模式」开关。 | PATH-B |
| **L6** | `client_header_profile` 默认 `"none"`；开启为**显式 opt-in**。UI 文案禁止「白嫖 Max / 伪装官方」。 | B+C |
| **L7** | **Hard deny** on first-party hosts: **any** non-clean client identity injection — `client_header_profile ≠ none` **or** `extra_headers` that set UA/`x-app`/spoof-class keys → **拒发请求**（非仅警告）。 | PATH-C + Pi M1 |
| **L8** | 不实现 OAuth / Claude.ai cookie / Max 会话导入。 | PATH-C 红线 |
| **L9** | 兼容头版本号 **钉在配置/预设**（version pin only，Q3=A），不自动抓 Claude Code 最新版；完整自定义 UA 仅 P2 `extra_headers` 且仍受 L7 约束。 | PATH-C + dual-review |
| **L10** | Vision（`config.vision`）v1 **仍仅 OpenAI-compatible**；chat/title/extract 走 Provider。settings test 协议感知在 **P1 UI** 落地（P0 可用 CLI/单测验证 anthropic probe）。 | PATH-A + Q2=B |
| **L11** | P0 验收 = **fixture SSE + multi-turn mock + L7 unit tests**；真实中继 smoke **不**作 merge gate（P1 可选）。 | Q4=B |
| **L12** | UI 主标签 = **「Coding Plan 网关兼容头」**；helper 文案点名类似 Claude Code 的 UA/`x-app`（发现性）。config enum 仍可用 `claude_code_compat`。 | Q1 合成 |

---

## 3. Config schema

```ts
// companion config.llm 扩展（省略 = 旧行为）
llm: {
  base_url: string
  api_key: string
  model_name: string
  temperature: number
  context_window: number

  /** wire protocol; default "openai" */
  protocol: "openai" | "anthropic"

  /**
   * auth: "auto" (default) → openai: Bearer, anthropic: x-api-key
   * override only if a gateway documents otherwise
   */
  auth_style?: "auto" | "bearer" | "x-api-key"

  /**
   * default "none"
   * "claude_code_compat" = inject documented gateway-compat headers
   * (UA / x-app / optional anthropic-beta). NEVER on first-party Anthropic hosts.
   */
  client_header_profile?: "none" | "claude_code_compat"

  /** pin for UA string; default e.g. "2.1.220" — user/gateway may override */
  claude_code_compat_version?: string

  /** allowlisted extra headers only; values never logged */
  extra_headers?: Record<string, string>

  /** Anthropic API version header; default "2023-06-01" */
  anthropic_version?: string
}
```

### First-party host denylist（L7）

**Hosts（至少）：**

- exact: `api.anthropic.com`, `claude.ai`
- suffix: hostname `=== "anthropic.com"` **or** ends with **`.anthropic.com`**（leading-dot 语义）
- 同理：`=== "claude.ai"` or ends with `.claude.ai`

**禁止** 裸 `endsWith("anthropic.com")`（会误伤 `evilanthropic.com`）。

**触发条件（union，Pi M1）：** host ∈ first-party **且** 以下任一：

- `client_header_profile !== "none"`
- `extra_headers` 含 `user-agent` / `x-app` / 其他白名单外或伪装类键（实现：first-party 上 **禁止任何** extra header 覆盖；仅允许 clean `User-Agent: cmspark-companion/<version>`）

→ **拒发请求**（pre-flight，settings probe 同样适用）。错误文案：「官方 Anthropic 主机不允许 Coding Plan 兼容头；请关闭兼容头或改用中继 Base URL」。

### Header profile 内容（gateway-compat）

在 `protocol=anthropic` 且 profile=`claude_code_compat` 且通过 L7 时注入（可配置 pin）：

| Header | 典型值 | 说明 |
|--------|--------|------|
| `user-agent` | `claude-cli/{ver} (external, cli)` | 多数 coding-plan 门控点 |
| `x-app` | `cli` | 常见配套 |
| `anthropic-version` | `2023-06-01` 或 config | 协议必需，非伪装独有 |
| `anthropic-beta` | 预设短列表（可空） | 仅当网关文档需要；不做「全量 CC beta 同步」 |

**不**默认注入：Cookie、OAuth token、伪造 billing system prompt「You are Claude Code…」。  
（后者会改模型行为与计费语义，超出「客户端门控」范围；若未来需要另开 ADR。）

### Auth

| protocol | default |
|----------|---------|
| openai | `Authorization: Bearer {key}` |
| anthropic | `x-api-key: {key}`；若 `auth_style=bearer` 则部分中继用 Bearer |

---

## 4. Runtime architecture

```
adapter / llm-extract / title / settings test
              │
              ▼
     createProvider(llmConfig)
              │
     ┌────────┴────────┐
 OpenAIProvider    AnthropicProvider
 (openai SDK)      (fetch /v1/messages + SSE)
              │
     CanonicalStreamEvent
     { token | tool_call_delta | reasoning | usage | done }
              │
              ▼
     adapter 工具环 / 越狱扫描 / WS 推送（不变）
```

### Anthropic 转换要点

| OpenAI 内部 | Anthropic wire |
|-------------|----------------|
| `role:system` messages | 顶层 `system` |
| `tools[].function` | `tools[]` + `input_schema` |
| `assistant.tool_calls[]` | `content: [{type:tool_use,id,name,input}]` |
| `role:tool` | `role:user` + `tool_result`（连续合并） |
| stream chunks | SSE: `content_block_delta` / `message_delta` → Canonical |
| `tool_call.id` | 发出前规范化为 `^[a-zA-Z0-9_-]+$`，回写一致 id 供下一轮 `tool_result` |

**`max_tokens`（确定性，Pi M4）：**  
`max_tokens = min(8192, max(256, Math.floor(context_window / 8)))`  
文档注明：openai 路径当前可不送 `max_tokens`，anthropic 路径有输出上限，长代码生成截断行为可能不同。后续可加独立 config 字段。

**`thinking` 块（Claude M6）：** Anthropic SSE 若出现 `thinking` / thinking delta → 映射为 Canonical **`reasoning`**（与 DeepSeek `reasoning_content` 同槽）；无则忽略。不阻断 chat。

**`tool_call.id`：** 出站规范化 `^[a-zA-Z0-9_-]+$`；OpenAI 路径透传（`call_…` 已合规，不过度规范化）。

**`reasoning_content`：** 重建 Anthropic wire 时 **丢弃** 非标准字段（Pi M7）；内部线程可仍存。

**base_url 规范化**：用户常填 `https://host` 或 `https://host/v1`；Anthropic client 统一拼到 `{base}/messages`（去掉多余斜杠；禁止误拼成 `/v1/v1/messages`）。

**跨协议 resume 测试（Pi M7）：** openai 下写入的 `tool_calls` + `role:tool` 线程，切换 `protocol=anthropic` 后必须能正确 rebuild `tool_use`/`tool_result` 且 id 对齐（双向 fixture）。

---

## 5. Product / UX

### 用户心智

| 概念 | 展示名 | 说明 |
|------|--------|------|
| 协议 | **API 协议** | OpenAI-compatible（默认） / Anthropic Messages |
| 兼容头 | **Coding Plan 网关兼容头**（L12） | 可选；仅 Anthropic 协议下显示；helper 点名 Claude Code UA |
| 预设 | **快速配置** | 只填协议+提示 URL，**不**绑具体厂商 |

### 设置 UI（settings-web + Side Panel 对齐）— **P1**（Q2=B）

**始终可见：** API Key · Base URL · Model · Protocol  

**Protocol = Anthropic 时展开：**

- Base URL 提示：走 `/messages`，勿混 `/chat/completions`
- Checkbox：**Coding Plan 网关兼容头**（默认关）
- Helper 文案（诚实）：

> 部分第三方「Coding Plan」中继只接受类似 Claude Code 的 User-Agent / 应用头。开启后，CMspark 会在 **Anthropic 协议** 请求上附加这些兼容头。  
> **不会**登录或盗用 Anthropic 官方订阅；请只用于你有权使用的 API / 中继。若使用官方 Anthropic 或无需门控的端点，请保持关闭。

**快速配置 chips（无厂商 logo）：**

1. OpenAI 兼容（默认）→ protocol=openai, profile=none  
2. Anthropic Messages → protocol=anthropic, profile=none，placeholder `https://api.anthropic.com`  
3. Coding Plan 中继 → protocol=anthropic, profile=claude_code_compat，Base URL 留空聚焦粘贴  

### 测试连接

与 Save 使用**同一** protocol + profile + auth：

| Protocol | Probe |
|----------|-------|
| openai | `POST …/chat/completions` mini body |
| anthropic | `POST …/messages` mini body + x-api-key + anthropic-version + profile headers |

失败**不**自动切换协议。错误文案区分 404 路径错 / 401 鉴权 / 400 格式（见 PATH-B §5）。

### 迁移

- 旧 config 缺字段 → `protocol=openai`, `client_header_profile=none`  
- 默认 DeepSeek 行为零变化  

---

## 6. Security / compliance

| 规则 | 行为 |
|------|------|
| 默认干净身份 | `User-Agent: cmspark-companion/<version>`（openai 与 anthropic 均适用，profile=none 时） |
| 官方站 + 任何伪装类头 | **硬拒绝**（L7 union：profile **与** extra_headers） |
| 日志 | **永不**记 header **值**；只记 `header_names[]` + `profile` + `base_host`；`x-api-key` 已由现有 regex 覆盖，P0 仍加「values never logged」断言 |
| extra_headers | 名称白名单；拒绝 `Host`/`Cookie`/hop-by-hop/CRLF；**first-party 上禁止覆盖** |
| Agent 可写性 | profile / extra_headers **不可**被 LLM tool 或未授权 WS 静默改写（与 api_key 同信任级：仅 settings/CLI） |
| 文档红线 | 禁止「如何骗过 Anthropic 订阅校验」教程 |

---

## 7. Call-site migration matrix

| 站点 | v1 |
|------|----|
| `llm/adapter.ts` 主循环 | → `provider.streamChat` |
| `generateThreadTitle` | → `provider.complete` |
| `llm/llm-extract.ts` | → `provider.complete` |
| `settings-web` test | **P1** 协议感知；P0 可先 CLI/单测 probe |
| `server.ts` model probe | openai: GET /models（已存在 ~5298）；anthropic: soft-skip 或 GET /v1/models + 正确头 |
| `vision-pipeline` | **仍 OpenAI only** |
| skill-craft / skill-engine | 统一经 llm-extract |

### 新文件（建议）

```
companion/src/llm/provider.ts
companion/src/llm/providers/openai.ts
companion/src/llm/providers/anthropic.ts
companion/src/llm/providers/anthropic-convert.ts
companion/src/llm/providers/headers.ts          # clean vs compat + first-party deny
companion/tests/llm-provider-anthropic.test.ts
companion/tests/llm-headers-policy.test.ts
```

---

## 8. Phased delivery

| Phase | 范围 | 验收 |
|-------|------|------|
| **P0** | Provider + Anthropic stream/tools + adapter/title/extract + config 默认 + **fixture/contract 单测**（转换/SSE/id/L7 union 拒发/跨协议 resume） | DeepSeek 回归绿；fixture 多轮 tool mock 绿；无真实中继依赖 |
| **P1** | UI 协议选择 + 兼容头 checkbox（L12 文案）+ Side Panel 对齐 + settings test 协议感知 + model probe + 可选用户自备中继 smoke | Coding-plan 中继 opt-in 通；官方 host + 兼容头被拒 |
| **P2** | extra_headers 白名单 UI、可选 SDK、能力探测 | 不阻塞主路径 |

---

## 9. Acceptance criteria

### P0（merge gate — L11）

1. 现有 DeepSeek 用户：零改配置，聊天仍成功（回归）。  
2. Anthropic provider：fixture SSE + multi-turn tool mock 通过。  
3. L7：first-party host + profile/extra_headers → 拒发。  
4. 跨协议 thread resume fixture 通过。  
5. 日志断言：header **值**不落盘。  

### P1+（用户视角）

6. 设 `protocol=anthropic` + 合法 key/URL：测试连接成功，带 tool 对话可完成。  
7. Coding Plan 中继：仅开启兼容头后可用。  
8. UI/文档无「Claude Max 白嫖 / 官方客户端伪装」表述。

---

## 10. Explicit rejections

| 拒绝 | 原因 |
|------|------|
| 默认开启兼容头 | 暗模式；合规风险 |
| 官方 Anthropic 上发 CC UA / extra_headers 绕过 | ToS + L7 union |
| OAuth / 会话 cookie 登录 Claude | 红线 |
| system 首行注入「You are Claude Code」 | 改模型行为；v1 不做；需另 ADR |
| 做成 cc-switch | 范围爆炸 |
| 静默协议探测改行为 | 不可调试 |
| Vision 同步双协议 | P0 不挡 chat |
| P0 强依赖真实第三方中继账号 | Q4=B |

---

## 11. Open questions — **LOCKED by dual-review**

| # | Decision | Claude | Pi | Final |
|---|----------|--------|-----|-------|
| **Q1** UI label | Primary **Coding Plan 网关兼容头**；helper 点名 Claude Code UA | A | B | **B+helper** |
| **Q2** P0 scope | config/CLI + tests first；UI → P1 | B | B | **B** |
| **Q3** UA customization | version pin only；full UA → P2 | A | A | **A** |
| **Q4** P0 acceptance | fixture/contract tests；real gateway optional P1 | B | B | **B** |

详见 [dual-review synthesis](llm-anthropic-protocol-dual-review-synthesis-2026-08-03.md)。

---

## 12. Adversary + dual-review summary

| Path | Verdict |
|------|---------|
| **A Protocol** | Ship provider layer；内部 OpenAI 形；Anthropic = transport |
| **B Product** | 协议 + 可选兼容头两轴；诚实文案；默认 openai/none |
| **C Security** | Messages 必做；CC 身份对官方站禁止；网关兼容 opt-in + 日志 redaction |
| **Claude + Pi** | **APPROVE_WITH_NITS** · both_ok · must-fix 已并入 L7/L11/L12 与 §4 |

**合成结论：** 做协议适配 + **受约束的**网关兼容头；**不做** Claude Code 克隆与 Max 订阅伪装。

---

*DIRECTION LOCKED · P0 implementation landed（见 ship note）· P1 UI 待办。*

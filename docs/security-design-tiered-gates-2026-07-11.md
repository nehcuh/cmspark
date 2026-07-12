# 安全确认门产品需求与开发计划（分层门 / Tiered Gates）v2

> 2026-07-11 · 状态：**v1 经 kimi 复审 → NEEDS-CHANGE；本 v2 已纳入 kimi 反馈 + 主会话代码核对修正，待 kimi 二审** · 触发：用户开启 `auto_approve_dangerous` 后 `create_tab about:` 仍被 Layer 1 拦截，提出三层产品设计与「全局硬性不拦截开关」诉求。

---

## 0. 背景与触发

用户开启「自动批准所有危险操作」(`security.auto_approve_dangerous=true`) 后，`create_tab` 到 `about:blank` 仍被拦截（Layer 1 协议硬阻断不绕过）。用户心智「auto-approve = 允许一切」与设计有摩擦，随后提出三层产品设计 + 要求「全局硬性不拦截开关」。

**威胁模型（整篇前提）**：agent 在不可信页面内容上跑 LLM，网页可注入指令。确认动作必须来自**带外、不可被注入**的信道（屏幕前的人）。

---

## 1. 现状基线（代码事实，已逐条核对 file:line）

| 门 | 位置 | 行为 | 可被 `auto_approve_dangerous` 绕过？ |
|---|---|---|---|
| **Layer 1 — 协议白名单硬阻断** | `server.ts:377-385` | `navigate`/`create_tab`/`set_tab_url` 到非 http(s) → 无条件 block | **否** |
| **Layer 2 — URL 确认门** | `server.ts:388-390` | `skipUrlConfirmation = isTrustedDomain \|\| isAutoApprovedDomain \|\| auto_approve_dangerous` | 是 |
| **evaluate / osascript_eval 确认门** | `server.ts:276-341` | `skipConfirmation = auto_approve_dangerous \|\| (relevantDomain && isAutoApprovedDomain)`。**osascript_eval 故意不走域名白名单**（`server.ts:267-275` 已注释：它执行宿主 AppleScript=任意 shell，URL 不是信任锚） | 是（仅全局 toggle） |

- `SecurityConfig.auto_approve_dangerous: boolean`（`config.ts:18-29`，默认 false）；`saveConfig` 开启时 warn（`config.ts:360-362`）。
- UI：`auto_approve_dangerous` 单 checkbox + 静态警告（`SettingsSlideout.tsx:247-262`），**无二次确认**；白名单有「二次确认」样板（`:234-239`）。
- Tier 1 allowlist 已实现且测过（`security-gates.test.ts:357-434`，含 anti-injection 校验）。

**三个关键发现（v2 新增/核对）：**

1. **`config.set` 不是 agent 工具**（已核对 `companion/src/bridge/tool-definitions.ts`）。LLM 可调工具全集：`list_tabs / create_tab / close_tab / navigate / screenshot / analyze_image / get_page_text/html/element_info / click / dblclick / type / fill_form / scroll / press_key / hover / select_option / drag_and_drop / wait_for / evaluate / get·set·delete·list_cookies / use_skill / osascript_eval / record_experience / mcp_list_resources / mcp_read_resource / mcp_get_prompt`。**无任何 config/privilege/security 工具**。结论：**纯 prompt-injection 经 LLM 无法翻转安全开关**（LLM 只能发其函数表里的 tool call，无 config.set，也无裸 WS 发送路径）。

2. **C1 WS 鉴权仅 Origin，且代码自认不足**。`isAllowedWsOrigin`（`server.ts:39-40`）只校验 `chrome-extension://` Origin；`server.ts:36` 注释明写：**「A local process can still spoof the Origin header (curl -H); that needs the P2 shared-secret」**——即 Origin 欺骗缺口已知、P2 延后。**这是真正能经 WS 改 `security.*` 的向量：本地恶意进程伪造 Origin → 发 `config.set` 翻任意开关**。不是 agent/LLM。

3. **孤儿 `security.setPrivilege`**：扩展 `background/index.ts:432-439` 转发，companion 无 handler（grep 零匹配）；UI 有 `PrivilegeMode` + `handlePrivilegeChange`。半成品，应**删除**（不复用，避免误导）。

---

## 2. 三层设计评估

- **Tier 1（默认弹窗+允许列表）**：✅ 基本已实现。
- **Tier 2（LLM 判「真实意图」自动放行）**：✗ 安全反模式（裁判 LLM 在带内可被注入、代价不对称、不可审计）。**窄安全版**（LLM 仅生成风险说明、绝不参与放行决策）→ 列为**显式 non-goal，推迟 P3+ 单独 RFC**。kimi 与主会话一致。
- **Tier 3（强制管理员 god-mode）**：✓ 同意带硬约束。

---

## 3. Spec — 权限阶梯三档

| 档 | L1 scheme 硬阻断 | L2 确认门 | 启用 |
|---|---|---|---|
| Default | 激活 | 激活 | 默认 |
| Auto-approve（现有 `auto_approve_dangerous`） | 仍激活 | 绕过 | settings UI（依赖 PR-0 后的鉴权信道） |
| **God-mode（新增 `allow_all_schemes`）** | **也绕过** | **也绕过** | **config.json 手动编辑** 或 **UI 输入确认短语 + 经 PR-0 鉴权** |

**实现语义（显式 OR，god-mode ⊇ auto-approve）：**
```ts
skipL1 = allow_all_schemes                              // Layer 1
skipL2 = auto_approve_dangerous || allow_all_schemes    // Layer 2（含 evaluate/osascript_eval 的 skipConfirmation）
```

**命名**：选 **(B) 独立布尔 `security.allow_all_schemes`**（kimi 推荐 + 主会话同意）。L1/L2 是两个独立维度，三值枚举会伪造线性阶梯、扩大回归面。孤儿 `PrivilegeMode` 删除不复用。字段名 `allow_all_schemes` 描述 L1 效果，代码注释须明示其同时关闭 L2。

**God-mode 硬约束：**
- (C1) 默认 false，旧配置无键按 false（deepMerge 兼容）。
- (C2) **Out-of-band 启用**——成立的前提是 PR-0（WS 共享密钥）已落地。在此之前 god-mode 仅可经 **config.json 手动编辑** 启用；PR-0 后方可加 UI「确认短语」路径。
- (C3) UI 二次确认 + 硬核风险文案（镜像白名单二次确认），文案明示「关闭协议保护 → prompt 注入可执行 `data:` 脚本 / 开 `chrome://` 特权页 / 读 `file:` 本地文件；仅在你完全信任的机器上为你完全信任的工作流启用」。
- (C4) **前置、不可篡改审计**：每次 god-mode 放行在动作执行**前**写 `security.godmode_bypassed`（warn，含 tool/scheme/host/timestamp，**不含**敏感参数）；对 `javascript:` scheme 特别标注。归入既有审计日志 UI。
- (C5) 幂等原子走 `saveConfig`（0o600）。

---

## 4. 开发计划（每个 PR 走 kimi-gated-fix：worktree→kimi 改动前复审→tsc/build/定向测试→kimi 终审→PR→merge）

| 序 | 内容 | 范围 | 依赖 | 优先级 |
|---|---|---|---|---|
| **PR-0（前置，v2 新增）** | **WS 共享密钥鉴权**——关闭 C1 自认的 Origin 欺骗缺口。扩展与 companion 首次握手交换/校验共享密钥（token），`isAllowedWsOrigin` 之外加 token 校验；未通过则拒绝。**这是所有安全开关「不可被远程/本地恶意进程翻转」的根基**，不止 god-mode。 | kimi 定方案（握手协议/密钥派生/存储 0o600） | — | **P2 最高（阻塞 god-mode）** |
| **PR-A** | God-mode companion 核心：`config.ts` 加 `allow_all_schemes`(B)+default+saveConfig warn；`server.ts` L1&L2 显式 OR 绕过；前置 `security.godmode_bypassed` 日志（`javascript:` 特标）；schema+门测试（on→`create_tab about:`/`data:` 成功且打日志 / off→仍阻断回归 / god-mode⊇auto-approve）。 | PR-0 | **P2 高** |
| **PR-B** | God-mode UI：`SettingsSlideout` 二次确认+风险文案+确认短语（PR-0 后）；审计日志展示 godmode 条目；config.json 启用说明入文档。 | PR-A + PR-0 | **P2 高** |
| **PR-C** | 删除孤儿 `security.setPrivilege`/`PrivilegeMode`/`handlePrivilegeChange` 死代码（grep 验证零引用）。 | PR-A/B | **P2 中** |
| **PR-D** | Tier 1 查漏（大概率无改动）。 | — | **P3 低** |
| **PR-E** | Tier 2（推迟 P3+，仅辅助人类，单独 RFC）。 | Tier 3 闭环后 | **P3+** |

**优先级链**：PR-0 → PR-A → PR-B → PR-C → 后续 P2（M2 注入标记 / M3 osascript 范围 / M4 analyze_image 门 / M5 cookie trust）。

---

## 5. kimi v1 反馈 + 主会话核对修正（v2 解决）

| kimi v1 | 主会话核对结论 | v2 处置 |
|---|---|---|
| **#3「agent 经注入发 config.set 关所有门」** | **机制不成立**：config.set 非 agent 工具（见发现 1）。**但更广担忧成立**：本地恶意进程伪造 Origin 可发 config.set（发现 2，代码自认 P2 延后）。 | 不采纳「整体禁止 WS 写 security.*」（会破坏用户当前依赖的 settings UI 保存路径）。**改为 PR-0 共享密钥鉴权**——以最小代价关闭真缺口、保留合法 UI 路径。god-mode 在 PR-0 前仅 config.json 启用。 |
| #1 命名 | 一致 | 采 (B) `allow_all_schemes`，删孤儿。 |
| #2 god-mode⊇auto-approve | 一致 | 显式 OR 实现（§3）。 |
| #4 启用强度 | 一致 | PR-0 前 config.json-only；PR-0 后 UI+确认短语。 |
| #5 Tier 2 | 一致 | 显式 non-goal。 |
| #6 工具危险面遗漏 | 成立 | 见 §6 工具分级。 |
| osascript_eval 不一致 | 非不一致，已有注释 | 保持「仅全局 toggle」，文档化（§1）。 |
| MCP/javascript:/审计前置/孤儿删除/回归 | 一致 | 并入 §3/§4/§6。 |

---

## 6. 工具危险面分级（kimi #6 补漏）

| 类 | 工具 | 当前门 | 归属阶梯 |
|---|---|---|---|
| 浏览器导航 | navigate/create_tab/set_tab_url | L1+L2 | 已在阶梯 |
| 脚本执行 | evaluate | L2（per-domain 白名单） | 已在 |
| 宿主脚本 | osascript_eval | L2（仅全局 toggle） | 已在（保持） |
| **任意 URL 读取** | **analyze_image**（读任意 URL，可打内网/泄露） | **§6.1 IMAGE_FETCH_GATE** | **独立门（L2 确认家族，god-mode 不绕过）** |
| Cookie | get/set/delete/list_cookies | trusted_domains 门 | 已在（cookie 门） |
| MCP | mcp_list_resources/read_resource/get_prompt | 无门（实际工具调用走 MCP server） | **待定：MCP 工具调用是否入 L2** |

→ PR-A 不扩范围处理 analyze_image/MCP（避免 scope creep，META 2.2），但在 PR-A 的 kimi 终审里确认「god-mode 是否也应放行这些」，并立 follow-up（M4 analyze_image 门、MCP 门）单列。

---

## 6.1 `analyze_image` 确认门（IMAGE_FETCH_GATE）— M4

> **代码基线（main b877461，已逐条核对 file:line）**：工具定义 `companion/src/bridge/tool-definitions.ts:159-174`；companion 派发 `companion/src/server.ts:528-597`（默认转发分支）+ `companion/src/llm/adapter.ts:503-548`（`VISION_TOOLS` 后处理）；扩展实现 `chrome-extension/src/background/browser-bridge.ts:370-534`；图片 fetch `chrome-extension/src/background/image-extract-utils.ts:56-78`。扩展 `host_permissions:["<all_urls>"]`，SW 跨源读权限。

### 6.1.1 风险模型 — 两条提取路径

`analyze_image` 解析 `<img>` 后分叉，风险本质不同：

| 路径 | 触发 | 当前行为 | 风险 |
|---|---|---|---|
| **A — canvas 同源** | `<img>` 与页面同源，canvas 未污染（`browser-bridge.ts:402`） | 页面内 `canvas.toDataURL()` 直接得 base64 | **零新增外泄能力**——字节在渲染时已被浏览器 fetch，`screenshot` 工具已捕获相同像素喂 LLM；`get_page_text/html` 本就读同源页面。路径 A 严格被 `screenshot` 覆盖 |
| **B — 跨源 fetch** | 跨源 `<img>` 污染 canvas（`browser-bridge.ts:414,496-498`） | 页面内只解出 `fetchSrc`=`el.currentSrc\|\|el.src`，扩展 SW 执行 `fetchImageAsBase64(fetchSrc)` | **高风险 SSRF**——`fetchSrc` 完全由页面可控，可指 `169.254.169.254`/RFC1918/`127.0.0.1:23401`；base64 喂视觉模型 = 经 LLM 外泄通道 |

当前零门：路径 B 的 `fetch()` 在 companion 不知情下发生，审计日志无候选 URL，无法在 fetch 前拦截。

### 6.1.2 设计原则

1. **门留在 companion**（现有不变量：所有门/法证审计/配置保护在 companion 侧；扩展 config 副本可能 stale）。
2. **必须 fetch 前拦截**：路径 B SSRF 在扩展 `fetchImageAsBase64` 内，故拆 **resolve → gate → fetch** 两阶段。
3. **路径 A 不门**（偏离早期草案「路径 A 过 scheme+私网检查」，见 6.1.7 偏离说明）：A 不新增外泄能力，任何门都是纯摩擦。
4. **god-mode / auto_approve_dangerous 均不覆盖此门**（见 6.1.5）。

### 6.1.3 两阶段协议

**阶段 1 — `analyze_image`（selector）**：扩展经 CDP `Runtime.evaluate`（**background SW 注入，无 content-script**）解析元素，**不立即 fetch**，返回：

```ts
type ImageResolveResult =
  | { type: "canvas"; image_base64: string; width: number; height: number;
      url?: string; title: string; alt_text?: string; selector: string }   // 路径 A
  | { type: "fetch_required"; candidate_url: string; width: number; height: number;
      alt_text?: string; selector: string }                                 // 路径 B
  | { type: "error"; reason: string }                                        // 解析失败/blob 不可解
```

companion 专用 `analyze_image` 分支（`createToolExecutor` 内，**不进** `URL_GATE_TOOLS`）：
- `canvas` → 直接返回（adapter `VISION_TOOLS` 后处理照常跑）。**不门。**
- `fetch_required` → 跑 IMAGE_FETCH_GATE（6.1.4）→ 放行则发**阶段 2**；阻断/拒绝则返回错误 tool result。
- `error` → 直接返回错误。

**阶段 2 — `analyze_image_fetch`（candidate_url）**：companion gate 放行后，发新工具调用 `analyze_image_fetch` 给扩展，扩展执行 `fetchImageAsBase64(candidate_url)`，返回 `{image_base64,...}`（与今日同 shape），adapter 跑 vision。

**时序不变量**：扩展在收到 `analyze_image_fetch` 前，路径 B **绝不调用 `fetchImageAsBase64`**。复用 `pendingToolCalls` 基础设施做两次往返。

### 6.1.4 Gate 判定规则（IMAGE_FETCH_GATE）

candidate_url 判定顺序：

1. **Scheme 硬阻断**：允许 `http:`/`https:`（路径 B 候选几乎总是 http(s)；`data:` 不会污染 canvas 故走路径 A）。阻断 `file:`/`ftp:`/`javascript:`/`about:`/`chrome:`/`chrome-extension:`/`blob:` 及一切非 http(s)。→ `security.image_fetch_blocked`。
2. **私网/元数据 IP**（`isPrivateOrMetadataIp(host)`，范围 `127/8`、`10/8`、`172.16/12`、`192.168/16`、`169.254/16`、`::1`、`fc00::/7`、`fe80::/10`）：
   - `169.254.169.254`（AWS IMDS）→ **硬阻断** → `security.image_fetch_blocked`（绝无合法 analyze 场景）。
   - 其余私网 → **触发确认**。
3. **信任域**：复用 `isTrustedDomain(host)`/`isAutoApprovedDomain(host)` → 命中则 `security.image_fetch_auto_approved`，跳过确认。
4. **人机确认**：其余（非信任域公网图、私网图）→ `securityConfirmations.request`（复用既有确认框架）。确认 → `security.image_fetch_confirmed` + 发阶段 2；拒绝 → `security.image_fetch_denied`。

### 6.1.5 god-mode / auto-approve 显式排除（Non-goal）

- **`security.allow_all_schemes`（god-mode）对 `analyze_image` 无效**：god-mode 是为「调试内嵌 `data:`/`chrome:` 页」放行**导航**；analyze_image 是把任意 URL 字节喂 LLM，属**数据外泄**而非页面访问。IMAGE_FETCH_GATE **不被 god-mode 绕过**。
- **`security.auto_approve_dangerous` 对 `analyze_image` 无效**：现有全局危险开关不应无感扩大为「允许 LLM 读任意图片 URL」。未来若需自动批准图片读取，引入独立 `auto_approve_image_fetch`，不在本 RFC 范围。
- 仅 **trusted_domain / auto_approved_domain** 跳过此门。`godmode_bypassed` 审计**不**适用 analyze_image。

### 6.1.6 确认 prompt 与审计事件

**确认请求**（复用 `securityConfirmations.request`）：`tool_name="analyze_image_fetch"`、`defense_layer=2`（**L2 确认家族**；现有字段类型为 `number`）、`resource_url/scheme/host/is_private_ip`、`reason="image_source_not_trusted"`、`relevantDomains:[host]`。UI 文案：「Image source requires confirmation」+ 完整 URL + 风险原因。

**companion 审计事件**（`logger.*` 法证日志，含 `candidate_url/scheme/host/is_private_ip`）：

| 事件 | action | level | risk_level | 触发 |
|---|---|---|---|---|
| `security.image_fetch_blocked` | `blocked` | `warn` | `high` | scheme 硬阻断或 `169.254.169.254` |
| `security.image_fetch_confirmed` | `confirmed` | `warn` | `high` | 用户确认放行 |
| `security.image_fetch_denied` | `denied` | `info` | `high` | 用户拒绝 |
| `security.image_fetch_auto_approved` | `auto_approved` | `info` | `medium` | candidate_url 命中 trusted/auto-approved 域 |

### 6.1.7 复用 vs 新建 + 路径 A 偏离说明

**复用**：`isTrustedDomain`/`isAutoApprovedDomain`、`securityConfirmations.request`、`pendingToolCalls` 往返、URL 解析、adapter `VISION_TOOLS` 后处理。
**新建**：`isPrivateOrMetadataIp(host)`、`createToolExecutor` 内 `analyze_image` 专用分支（**不进** `URL_GATE_TOOLS`）、`analyze_image_fetch` 工具 + 扩展 handler、`security.image_fetch_*` 事件名、UI 文案。

> **路径 A 偏离说明**（相对 kimi §6.1 初稿「路径 A 过 scheme+私网硬阻断但不确认」）：路径 A 同源、字节已在页面、`screenshot` 已覆盖相同像素 → **零新增外泄能力**，故**完全不门**。初稿对路径 A 的私网检查会误杀「内网 dashboard 分析同源图表」这类零风险合法用法，且初稿自身存在矛盾（路径 A「不确认」与私网「触发确认」冲突）。本设计以「路径 A 不门」消解矛盾并收紧过度防护（META 2.5 比例原则）。

> **Residual risk — DNS rebinding**：IMAGE_FETCH_GATE 只检查 URL **字符串**（scheme + host 字面量），不在 fetch 前解析 DNS。因此一个公网域名（如 `attacker.example.com`）若解析到 `169.254.169.254`，可绕过 metadata 硬阻断的**字符串**判定。但该域名不在 trusted/auto-approved 列表 → 仍触发**人工确认**（用户在环），不会静默放行；最坏情况是用户批准一次「分析 attacker.example.com 的图片」却实际命中元数据端点。可接受的残留（proportionate），不做 fetch 前 DNS 解析（引入解析时序/TOCTOU 与延迟）。

### 6.1.8 测试矩阵

| 用例 | 期望 |
|---|---|
| 同源 `<img>` canvas 成功 | 路径 A，**不门**，返回 vision 结果 |
| 跨源 `<img>` trusted domain | `image_fetch_auto_approved`，不弹确认，阶段 2 fetch 成功 |
| 跨源 `<img>` 非信任公网 | 弹确认；确认→`image_fetch_confirmed`+fetch；拒绝→`image_fetch_denied` |
| `http://169.254.169.254/...` | 硬阻断 `image_fetch_blocked`，**扩展未 fetch** |
| `http://192.168.x.x/...` | 私网确认（非硬阻断） |
| `data:image/png;base64,...` | 路径 A（不污染 canvas），不 fetch |
| `blob:`/`file://`/`javascript:` | 路径 B 候选则硬阻断 |
| `allow_all_schemes=true` | 对 analyze_image **仍**按 gate 规则（god-mode 无效） |
| `auto_approve_dangerous=true` | 对 analyze_image **仍**按 gate 规则（无效） |
| 时序不变量 | gate 放行前扩展绝不 fetch；路径 B base64 在 gate 前不存在 |

### 6.1.9 实现

单 PR（**不拆 D1/D2**）：§6.1 本节 + companion IMAGE_FETCH_GATE + 两阶段协议 + 扩展两阶段接线 + UI 文案 + 测试。协议变更触及 companion/扩展两端，**必须原子合并**（拆 PR 会有「companion 已两阶段、扩展仍旧」的破损窗口）。

---

## 7. 明确不做（Non-goals）

- ❌ Tier 2「LLM 自动放行」（反模式）；窄版推迟 P3+。
- ❌ 非 http(s) 协议开 per-domain allowlist。
- ❌ 改 `auto_approve_dangerous` 现有语义。
- ❌ god-mode 默认开或引导普通用户开。
- ❌ 在 PR-0 落地前开放 god-mode 的 UI/WS 启用路径。

---

## 8. v2.1 — kimi 二审 GO 后采纳的细化（2026-07-11）

kimi 二审 **裁决 GO**，并独立复核代码确认：`config.set` 非 agent 工具（`tool-definitions.ts:94-517`）；Origin 欺骗缺口真实（`server.ts:1418-1420`）。采纳的细化：

- **(A) `security.godmode_bypassed` 必须是 `logger.warn` 日志事件，绝不写 `config.json`**（否则用户/攻击者可编辑删除，失去不可篡改性）。`javascript:` scheme 特标。可选：同时落独立审计文件。
- **(B) 新增 `security.godmode_enabled_changed` 审计**：god-mode 开/关本身（含来源 `config.json_manual` / `ui_phrase_confirmed` / `ws_authenticated`）。
- **(C) PR-A 补「config.json-only 启用路径」测试**：PR-0 前，手写 `security.allow_all_schemes:true` 到 config.json → 重启 → `create_tab("about:blank")` 成功且留 `godmode_bypassed` 日志。防止 PR-A 误开 UI/WS 路径。
- **(D) analyze_image / MCP 工具**：PR-A 不扩范围；各开独立 follow-up issue（M4 analyze_image 门、MCP 门），PR-A 的 kimi 终审显式确认这点。
- **(E) 默认值**：`config.ts:102-107` `defaultConfig.security` 加 `allow_all_schemes:false`，`deepMerge` 自动兼容旧配置。
- **(F) PR-C 孤儿清理**：`security.setPrivilege`/`PrivilegeMode` 在 **扩展侧**（`background/index.ts:432-439` + UI `PrivilegeMode`/`handlePrivilegeChange`），companion 无 handler（grep `companion/src` 零匹配）——删扩展侧发送方 + UI 死代码。

**对 kimi 一处建议的修正（主会话代码核对）**：kimi 建议复用 `server.ts:1657-1659` 的 token scaffolding。**该注释是化石**——来自已被移除的 HMAC-token 迭代（扩展不再做 HMAC，`background/index.ts:279-283`），**无活代码可复用**。PR-0 共享密钥握手需从零构建（= 既已延后的 `P0-2B`）。设计要点：companion 首启 `crypto.randomBytes(32)` 生成、0o600 独立文件存储；扩展侧获取密钥的机制（native messaging / 安装时注入 / 首次复制粘贴）待定；握手用 nonce+HMAC 防重放（非「连时发一次」）；提供「重置密钥」轮换；`verifyClient` 保留 Origin 为第一层，连接建立后 N 秒内未完成握手则 `ws.terminate()`。**密钥交付机制是 PR-0 的核心设计 fork，需用户定。**

**PR-0 同步保护的其他 WS 写向量**（不止 god-mode）：`config.set` 写 `auto_approve_dangerous`/`auto_approved_domains`（≈ L2 自动放行 / 软 L1 绕过）、`mcp.add`/`mcp.update`/`mcp.toggle_server`（注册恶意 MCP server，`message-router.ts`）。`add_to_whitelist` 已有 anti-injection 校验（`server.ts` relevantDomains），已封。

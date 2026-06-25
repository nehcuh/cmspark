# ADR-007: 域白名单 + 危险操作自动批准

**日期**: 2026-06-24 | **状态**: 已确认

## 背景

CMspark 的 `evaluate` / `osascript_eval` / `navigate` / `create_tab` / `set_tab_url` 等高危工具在 [ADR-006](006-layered-defense.md) 与 2026-06-16 审计后已统一改为 **default-deny**（每次执行都需用户确认）。这堵住了 prompt-injection 直接执行任意 JS 的口子，但也带来了：

- **确认疲劳**：在同一可信站点上反复执行脚本，每次都要点确认
- **无人值守场景被锁死**：长跑 agent 无法自动连续工作

需求是给用户两条「合法的快捷通道」：

1. **域白名单** — 用户主动声明「在这个域上跑工具不用再问我」
2. **全局自动批准开关** — 「我承担风险，全部放行」（默认关闭）

同时要求：当用户在某次确认时发现某个域是可信的，可以**当场把它加入白名单**，避免下次重复确认。

## 决策

### 1. 独立字段 `auto_approved_domains`，不复用 `trusted_domains`

`trusted_domains` 自 [ADR-005](005-cookie-trust-domain-security.md) 起就承担 cookie 数据访问的门控。新功能与之**分离**：

| 字段 | gate 范围 | 语义 |
|---|---|---|
| `trusted_domains` | cookie 工具 + navigate URL 门 | 「我愿意把 cookie 数据暴露给这个域」 |
| `auto_approved_domains` | evaluate / osascript_eval / navigate / create_tab / set_tab_url | 「我愿意让 agent 在这个域上跳过确认」 |

**为什么不合并**：「信任读取 cookie」≠「信任执行任意 JS」。一个用户可能愿意让 agent 读某站 cookie 做认证态保持，但不想让它在同一站点跑任意脚本。两个字段共享同一个 `matchDomain()` 实现，但写入路径完全独立。

### 2. `security.auto_approve_dangerous` 作为全局 kill-switch（默认 false）

设计上故意把门槛设得极高：

- 单个 checkbox，UI 上标注 ⚠ 警告
- `saveConfig` 触发 console.warn
- **不提供任何模式下的隐式开启**（不存在「特权模式 = 自动批准」的快捷路径）

理由：这个开关一开，就**绕过整个 human-in-the-loop 防线**，包括 prompt-injection 防护。仅用于用户明确承担风险的可信无人值守工作流。

### 3. 确认弹窗支持「添加到白名单」

弹窗拿到 companion 推下来的 `relevant_domains[0]` 后，渲染 3 选 1：

- 不添加
- 添加 `example.com`（仅此主机名）
- 添加 `*.example.com`（含所有子域名）

用户选择 + 批准后，extension 在 `security.confirmation.response` 里附带 `add_to_whitelist: string[]`。companion 端**强制服务端校验**（见下文 C2 修复）。

## 安全审查轨迹（4 轮 kimi）

此设计经历了 4 轮 kimi code review。每轮发现的关键漏洞与修复如下：

### Critical 修复

| ID | 问题 | 修复 |
|---|---|---|
| **C1** | `tabUrlCache` 只在 `list_tabs` 时刷新；恶意页面注入 prompt → agent 在已白名单 tab 上 `navigate` 到 evil.com → 立刻 `evaluate`，companion 看缓存还是白名单域 → 自动放行 | `navigate` / `set_tab_url` / `create_tab` 执行成功后同步刷新缓存；残留风险（page-initiated `window.location`）需要 extension 端订阅 `chrome.tabs.onUpdated`，列为后续工作 |
| **C2** | `add_to_whitelist` 数组直接被持久化，无校验 | `SecurityConfirmationManager` 在 `PendingConfirmation` 上记住本次推给用户的 `relevantDomains`；响应处理用 `getRelevantDomains(id)` 取出，只接受等于 `{domain}` 或 `*.{domain}` 的 pattern，其余丢弃 + log |

### High 修复

| ID | 问题 | 修复 |
|---|---|---|
| **H1** | `auto_approved_domains` 里的 `*` / `*.com` 等危险通配符无任何警告 | `saveConfig` 对 `*` 输出独立警告（比 trusted_domains 的 `*` 更危险）；启发式正则 `/^\s*\*\.[^.]+\s*$/` 检测单 label TLD 通配符（`*.co.uk` 等多 label 漏检，已注释说明） |
| **H3** | `saveConfig` 在 `respondFrom` 之前，写盘抛错会让确认永久挂起 | 顺序改为先 `respondFrom` 再 `saveConfig`，且 `saveConfig` 套 `try/catch`，失败仅 log |
| **H4** | `osascript_eval` 用 `params.url` 做域白名单匹配，但 url 只是 tab 定位器，与 AppleScript payload 无关；攻击者可 `osascript_eval({url: "https://example.com", expression: "do shell script '...'"})` 在白名单域下逃过确认执行任意系统命令 | `relevantDomain` 计算时 `osascript_eval` 强制为 `""`，永远走确认（除非全局开关） |

### 回归修复（后续轮发现）

| ID | 问题 | 修复 |
|---|---|---|
| **N1** | LLM 偶尔把 `tabId` 传成字符串 `"123"`，`typeof !== "number"` 让 cache 更新静默跳过 → C1 失效 | tool executor 入口对 `finalParams.tabId` 做 `Number()` 规范化，非有限数置 `undefined` |
| **R1** | 白名单持久化路径未 gate 在 `respondFrom` 返回值上；攻击者猜对 confirmation_id 就能污染白名单 | 持久化条件改为 `responded && approved && validPatterns.length > 0`；非权威响应额外 log `add_ignored_non_authoritative` |

## 权衡

### 优势

- **可用性大幅回升**：可信站点上不再有确认疲劳；无人值守工作流可解锁。
- **白名单粒度可控**：精确主机名 vs `*.domain` 通配符，用户自选；服务端校验杜绝注入。
- **可审计**：所有自动批准都走 logger（`security.auto_approved` / `security.url_auto_approved` / `security.whitelist.added`），bypass reason（`global_toggle` vs `domain_whitelist`）记录在案。
- **关键漏洞被 4 轮 kimi 审查逼出来再修**：C1/C2/H3/H4 + N1/R1 都是真实可利用漏洞，不是过度保守。

### 劣势 / 已知残留风险

- **Page-initiated 导航**（`window.location.href = ...`）：companion 端无法感知，缓存会陈旧；需要 extension 订阅 `chrome.tabs.onUpdated` 并主动推送。代码注释里有标记。
- **多 label TLD 通配符**（`*.co.uk` / `*.com.cn`）：启发式漏检，需要完整 Public Suffix List 才能闭环。
- **测试覆盖不足**：MVP 未补 `matchDomain` / cache 行为 / 校验逻辑的单测，作为单独 PR 跟进。
- **全局开关无 modal 二次确认**：单 checkbox 启用，存在误点风险（kimi 标记为 medium，可后续 UX 迭代）。

## 关联

- [ADR-005: Cookie 信任域安全模型](005-cookie-trust-domain-security.md)
- [ADR-006: Layered Defense Stack](006-layered-defense.md)
- 实现 PR：本 commit（companion/src/{config,security,security-confirmation,server,message-router}.ts + chrome-extension/src/sidepanel/{types,App,SettingsSlideout,store/agentStore,hooks/useWebSocket}.{ts,tsx}）
- kimi 审查 artifacts：4 轮 session 沉淀在审查过程内（C1/C2/H1/H3/H4/N1/N3/R1）

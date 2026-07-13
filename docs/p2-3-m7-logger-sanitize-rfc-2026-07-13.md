# RFC · P2-3 M7 — Logger 脱敏（secret-bearing URL + 防御性 key 扩展）

> **日期**: 2026-07-13 · **Finding**: M7 (`docs/remediation-plan-2026-07-09.md:245`)
> **状态**: ✅ 已闭环（PR #53）— kimi 裁决 + 终审 GO

## 0. 裁决与终审结果（kimi）

**设计裁决**：采纳 **Option B**（B.1 URL 净化保审计 + B.2 防御性 key 扩展）。四问裁决：

1. `URL_KEY_RE`：维持提案 `/(^|_)(url|href|link|endpoint|origin)$/i`（不引入 `callback`/`redirect`/`target` 等易误伤键）。
2. `SECRET_QS_KEY_RE`：**移除 `auth`**（`authorization` 已覆盖标准场景，避免 `?auth=basic` 误伤），保留 `code`（OAuth 授权码关键）。
3. B.2：加入 `code`/`params`，**跳过 `selector`**。
4. `url` 走**净化**（保 host/path/非 secret 参数），非整值 `[REDACTED]`。

**实现**（`companion/src/logger.ts`）：新增导出 `redactUrl()`（剥 userinfo + 脱敏 secret query param + 非绝对 URL 回退 truncate）；`redactLogData` 三分支（敏感 key→`[REDACTED]` / URL-ish key 含数组→`redactUrl` / 其余递归）。

**终审 NEEDS-FIX（2 项，已独立复现 + 修复）**：
- **FN：`id_token`/`idToken`**（OIDC JWT）不在 `SECRET_QS_KEY_RE` → 加 `id[_-]?token`。
- **FP：`params` 子串**误匹配 `query_params`/`paramString`/`myparams` → 改 `\bparams\b`（保 `params`=true，余 false）。

**验证**（独立复跑，非 kimi 沙箱）：tsc clean；focused 13/13；全量 `npm test` **842 测 / 841 pass / 1 skip / 0 fail** + settings-web 15/15。

---



## 1. M7 原文

审计/补救计划对 M7 的描述（两行）：

| 子项 | 描述 | 现状 |
|---|---|---|
| logger 0o600 | "顺手把 `logger.ts:91`（M7 的一部分）也加 0o600" | **✅ 已做**（H1/PR #11-#28 阶段）：`logger.ts:91` `appendFileSync(filePath, line, { mode: 0o600 })` + `:82` `mkdirSync(dir, { recursive: true, mode: 0o700 })`。 |
| logger 脱敏 | "复用 history `redactForStorage`；扩 SENSITIVE_KEY_RE 含 url/selector/code/params" | ❌ **未做**——本 RFC 主题。 |

即 M7 的 0o600 部分已闭环；剩余仅为**脱敏**部分。

## 2. Grounding（实际数据流）

### 2.1 logger 的脱敏模型（现状）

`companion/src/logger.ts:32 redactLogData()`：**纯 key 正则** + 深度遍历。

```ts
const SENSITIVE_KEY_RE = /(api[_-]?key|authorization|auth[_-]?token|access[_-]?token|refresh[_-]?token|password|passwd|secret|cookie|set-cookie|session|bearer)/i
// 对象键命中 → 整值替换 [REDACTED]；否则递归。
```

- `redactLogData` **仅 logger.ts:88 内部调用**（`logEvent` 包 `data`），不导出给调用方。
- 字符串/数字/数组/循环/深度截断/Error 都有处理，机制健全。

### 2.2 logger 实际记录什么？（关键）

全量扫描 141 处 `logger.*` / `logEvent` 调用（`companion/src/`）：

- **记录的是结构化安全事件**，字段可控：`tool_call_id`、`tool_name`、`url`、`host`、`target_domain`、`scheme`、`error`（仅 message）、`server` 名等。
- **从不记录**原始 `params` / `arguments` / `code`（evaluate 源码）/ `result_summary` / `messages` / LLM `content`。grep `params|arguments|\.code|result_summary` 在 logger 调用中**零命中**。
- `selector` 作为 key **从不出现**。

→ **`code` / `params` / `selector` 三个 key 今天不会被 logger 记录**；把它们加进正则**当前是 no-op**（仅防御性）。

### 2.3 `url` 是真实且审计关键的字段

`url` 在多个安全审计事件中**原样落盘**：

```
server.ts:491  security.url_confirmation.requested  { ..., url: rawUrl, host }
server.ts:516  security.url_confirmation.denied     { ..., url: rawUrl, reason }
server.ts:524  security.url_confirmation.approved   { ..., url: rawUrl }
server.ts:529  security.url_auto_approved           { ..., url: rawUrl }
server.ts:501  securityConfirmations.request        { ..., code: `navigate(${rawUrl})`, ... }  // 经请求体，非 logger
tab-resolver.ts:150  tab_resolved                   { ..., url: tab.url?.slice(0,100) }
```

**真实风险**：URL 可携带
- **userinfo 凭证**：`https://USER:PASS@internal-host/path`
- **secret 查询参数**：`https://host/cb?token=…&api_key=…&code=<oauth-auth-code>&access_token=…`

这些会**原样写入** `~/.cmspark-agent/logs/companion-YYYY-MM-DD.log`（虽 0o600，仍落盘）。当前 `SENSITIVE_KEY_RE` 不命中 `url` key → **不脱敏**。

## 3. 设计分叉

### Option A — 字面执行（"扩 SENSITIVE_KEY_RE 含 url/selector/code/params"）

把 `url|selector|code|params` 加进 key 正则，命中即整值 `[REDACTED]`。

| | |
|---|---|
| ✅ | 改动最小（一行正则）；字面贴合审计措辞。 |
| ❌ | **`url` 整值脱敏 = 有害**：`security.url_confirmation.*` / `url_auto_approved` / `tab_resolved` 等**审计事件的核心价值就是"记录哪个 URL 被确认/绕过/导航"**，整值脱敏后日志变成"某 URL 被批准"——审计能力退化，与 M7"可观测"目标相悖。 |
| ❌ | **`selector`/`code`/`params` 是 no-op**：今天无任何 logger 调用以这些 key 记录（§2.2），加了也不脱敏任何东西。 |
| ❌ | **真风险未解**：userinfo / secret query param 仍原样落盘（因为 key 是 `url`，整值脱敏才有用——但又破坏审计）。自相矛盾。 |

**结论**：字面方案既破坏审计（url）又无效（其余三个），**不可取**。

### Option B — URL 净化（保审计价值）+ 防御性 key 扩展（推荐）

**B.1 真修复：`redactUrl(raw)`**

新增 URL 净化函数，在 `redactLogData` 中对 **URL-ish key**（`url` / `*_url` / `href` / `link` / `endpoint` / `origin`）的字符串值应用：

```ts
const URL_KEY_RE = /(^|_)(url|href|link|endpoint|origin)$/i
const SECRET_QS_KEY_RE = /^(token|access[_-]?token|refresh[_-]?token|api[_-]?key|apikey|secret|password|passwd|code|authorization|auth|session|bearer|client[_-]?secret)$/i

function redactUrl(raw: string): string {
  if (typeof raw !== "string" || raw.length === 0) return raw
  let u: URL
  try { u = new URL(raw) }          // 仅绝对 URL；相对路径/非 URL → 抛 → 走普通 truncate
  catch { return truncateString(raw) }
  u.username = ""; u.password = ""  // 剥 userinfo
  const sp = u.searchParams
  for (const k of [...sp.keys()]) if (SECRET_QS_KEY_RE.test(k)) sp.set(k, REDACTED)
  return u.toString()
}
```

`redactLogData` 对象键循环改为三分支：
```ts
for (const [key, item] of Object.entries(value)) {
  if (SENSITIVE_KEY_RE.test(key)) output[key] = REDACTED
  else if (typeof item === "string" && URL_KEY_RE.test(key)) output[key] = redactUrl(item)
  else output[key] = redactLogData(item, depth + 1, seen)
}
```

| | |
|---|---|
| ✅ | **保审计价值**：`https://user:pass@host/p?token=SECRET&keep=1` → `https://host/p?token=[REDACTED]&keep=1`（host+path+非 secret 参数保留，审计可读）。 |
| ✅ | **真风险闭环**：userinfo + OAuth `code` / `token` / `api_key` 等查询参数全部脱敏。 |
| ✅ | **`new URL()` 仅解析绝对 URL**：相对路径/普通字符串走 catch → 普通 truncate，无误伤、无性能问题（只在 URL-ish key 上跑，非全字符串扫描）。 |
| ⚠️ | 残留：`data:`/`javascript:` URL 的 secret 在 path 非查询（罕见，logger 几乎不记）；非标准 scheme 的 `new URL` 解析边界——可接受。 |

**B.2 防御性 key 扩展**

把 `code` / `params` 加入 `SENSITIVE_KEY_RE`（廉价 future-proof，对齐审计意图）：

```ts
const SENSITIVE_KEY_RE = /(api[_-]?key|authorization|auth[_-]?token|access[_-]?token|refresh[_-]?token|password|passwd|secret|cookie|set-cookie|session|bearer|\bcode\b|params)/i
```

- `code`：OAuth 授权码 / eval 源码——若未来以 key 记录则整值脱敏（合理，比 URL 净化更保守因为 code 无审计价值）。
- `params`：tool 参数对象——若未来记录则整值脱敏（保守但安全优先）。
- **`selector` 不加**：CSS 选择器非敏感，加了只增噪声无收益（与 §2.2 一致）。

### Option C — 镜像 history `redactForStorage`（per-tool）

把 history 的 per-tool 脱敏（`SENSITIVE_COOKIE_TOOLS`/`SENSITIVE_CODE_TOOLS`/MCP namespaced）搬进 logger。

| | |
|---|---|
| ❌ | logger 绝大多数事件**无 toolName 上下文**（security/confirm/tab-resolved/config/ws 事件），需把 toolName 线程化穿过所有 call site。 |
| ❌ | 超出 2-3h 工时；history 脱敏为 `result_summary`/params 而设计，logger 不记这些（§2.2）。 |
| ❌ | 比例失衡（META 2.5）。 |

## 4. 推荐与裁决请求

**推荐 Option B**：B.1（`redactUrl` 保审计价值，闭环真风险）+ B.2（防御性加 `code`/`params`，跳过 `selector`）。

理由：字面方案（A）对 `url` 有害、对其余 no-op；真风险是 secret-bearing URL，B 用净化而非整值脱敏既闭环风险又保审计能力（与 P2-3 "可观测" 目标一致）；C 比例失衡。

**请 kimi 裁决**：
1. **B.1 URL 净化的 key 集合**：`URL_KEY_RE = /(^|_)(url|href|link|endpoint|origin)$/i` 是否合适？是否要加/去某项（如 `callback`/`redirect`/`target`）？
2. **B.1 `SECRET_QS_KEY_RE`**：当前含 `token|access_token|refresh_token|api_key|apikey|secret|password|passwd|code|authorization|auth|session|bearer|client_secret`——是否过宽（`auth`/`code` 会误伤如 `?auth=basic`、`?code=200` 状态码）或过窄？
3. **B.2**：`code`/`params` 防御性加入 key 正则、`selector` 跳过——是否同意？或全部加 / 全不加？
4. **整值脱敏 vs 净化**：是否同意 `url` 走净化（保审计）而非整值 `[REDACTED]`？

## 5. 测试计划（Option B 落地后）

新增 `companion/tests/logger-redact.test.ts`（仿现有 redactLogData 导出）：
- `redactUrl` unit：userinfo 剥离 / secret query param 脱敏 / 非 secret 参数保留 / 非 URL 字符串走 truncate / 空/无效输入。
- `redactLogData` 集成：`{url: "https://u:p@h/x?token=S&keep=1"}` → 净化后 host+path+keep 保留 token=REDACTED；`{api_key: "x"}` → [REDACTED]（回归）；`{code: "eval(...)"}` → [REDACTED]（B.2）；嵌套对象 URL key 净化；数组 URL 净化。
- 全量 `npm test` 绿（baseline 829）。

## 6. 非目标

- 不改 history store 脱敏（已健壮，§2.1 的 SENSITIVE_COOKIE/CODE/MCP per-tool 模型保留）。
- 不线程化 toolName 到 logger（Option C）。
- 不处理 `data:`/`javascript:` URL path 内 secret（残留，罕见）。

# follow-up C Phase 2-E — classifyMcpCall arg-scan NITs（实现 RFC）

> kimi 已裁 (A)：先 P2-E。本 RFC 过设计后再动手。
> 范围：**companion-only**，仅 `security.ts` `classifyMcpCall` 及其常量 + 测试。无跨层改动。

## 0. 当前实现（security.ts:344-392）

```ts
const MCP_ARG_EXTERNAL_URL = /https?:\/\/(?!(?:127\.0\.0\.1(?![.\d])|localhost(?![a-z0-9.-])|\[::1\](?![a-z0-9.-])))/i
const MCP_ARG_SHELL = /(?:^|[^a-z0-9_])(?:bash|\/bin\/sh|zsh|cmd\.exe|powershell)\b|\brm\s+-rf\b|\bsudo\b|\bsh\s+-c\b/i
const MCP_ARG_WRITE_PAIR = /\b(?:content|body|payload|data|text|bytes)\b/i

export function classifyMcpCall(toolName, params): McpCapability[] {
  const caps = new Set<McpCapability>()
  const name = String(toolName || "")
  let args = ""
  try { args = JSON.stringify(params ?? {}).slice(0, 4000) } catch { args = "" }
  // ... name + arg heuristics ...
}
```

## 1. 三处缺口与修法

### NIT-1：非 http(s) scheme 的 egress 漏检

**现状**：`MCP_ARG_EXTERNAL_URL` 只匹配 `https?://`。`ftp://`/`ftps://`/`ws://`/`wss://` 的出网目标不触发 network-egress。

**修法**：把 scheme 前缀从 `https?` 泛化为网络出网 scheme集，复用现有 loopback 负向 anchor（loopback = 本机，不算 egress；**私网/RFC1918 仍算 egress** —— 那正是 SSRF pivot，必须抓）。

```ts
const MCP_ARG_EXTERNAL_URL = /(?:https?|ftps?|wss?):\/\/(?!(?:127\.0\.0\.1(?![.\d])|localhost(?![a-z0-9.-])|\[::1\](?![a-z0-9.-])))/i
```

**scheme 取舍**：`http/https/ftp/ftps/ws/wss` —— 都是"对远端主机发起网络连接"的 scheme。**不**收 `file://`（本地文件，属 file-* 能力而非 egress）、`data://`/`mailto:`/`tel:`（无 `://` 主机语义或非出网）。over-match → 多一次强制确认（fail-safe，可接受）；under-match → 漏 egress（fail-dangerous）。故 scheme 集宁可稍宽，但 `file`/`data` 这类明确非出网的绝不收。

### NIT-2：裸 host（无 scheme）漏检

**现状**：`{"target":"evil.attacker.com:443/exfil"}` 这类无 `://` 前缀的出网目标不触发任何 egress 信号。

**风险**：纯裸域名匹配会**大量误报**（描述串里的 `docs.example.com`、错误消息里的域名等都会被当 egress），噪声化能力门、消解用户对强制确认的严肃性。

**修法（高精度信号）**：只匹配 **`host:port`** 结构 —— `:port` 是网络 socket 的强信号，远比裸域名精确。host 为"域名+TLD"或 IPv4，port 2-5 位数字；同样排除 loopback。

```ts
const MCP_ARG_HOST_PORT = /(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}|\d{1,3}(?:\.\d{1,3}){3})(?::\d{2,5})\b/i
```

（域名段 + 2+ 字符 TLD，或 IPv4，冒号 + 2-5 位端口。loopback 的 `127.0.0.1:port` 会被 IPv4 分支匹配 —— 需在 `classifyMcpCall` 里用 `isPrivateOrLoopbackIp` 复检剔除，见下。）

**取舍**：`host:port` 是高精度、低误报的信号。裸 `host/path`（无端口）太模糊（doc 引用、`api.github.com/users` 这种结构），**不**单独作为 egress 信号 —— 那些场景由 name heuristic（curl/fetch/http/request）+ arg 共同覆盖已足够。

### NIT-3：>4000 字符 arg 尾截断

**现状**：`args.slice(0, 4000)` 在正则扫描**之前**截断。攻击者控制 >4000 字符的 blob 并把 URL/shell 标记放在 4000 之后 → 逃逸扫描。

**修法（head + tail 双扫）**：

```ts
let args = ""
try {
  const full = JSON.stringify(params ?? {})
  args = full.length > 6000 ? full.slice(0, 4000) + full.slice(-2000) : full
} catch { args = "" }
```

- 总长 ≤ 6000：整串扫（覆盖常见小 payload）。
- 总长 > 6000：扫头 4000 + 尾 2000（有界，防 10MB blob 拖慢正则；同时堵住"标记藏在尾部"的逃逸）。
- 中间 gap：可接受 —— 藏在 10MB+ blob 深处的标记不太可能是工具实际读取的 operative target（工具读特定字段，通常靠前），且超大 args 本身是 smell（可 log）。

## 2. classifyMcpCall 改动汇总

```ts
export function classifyMcpCall(toolName: string, params: unknown): McpCapability[] {
  const caps = new Set<McpCapability>()
  const name = String(toolName || "")
  let args = ""
  try {
    const full = JSON.stringify(params ?? {})
    args = full.length > 6000 ? full.slice(0, 4000) + full.slice(-2000) : full
  } catch { args = "" }

  if (MCP_NAME_FILE_WRITE.test(name)) caps.add("file-write")
  if (MCP_NAME_DB_MUTATE.test(name)) caps.add("db-mutate")
  if (MCP_NAME_EXEC.test(name)) caps.add("exec")
  if (MCP_NAME_EGRESS.test(name)) caps.add("network-egress")
  if (MCP_NAME_READ.test(name)) caps.add("read-only")

  if (MCP_ARG_EXTERNAL_URL.test(args)) caps.add("network-egress")
  if (MCP_ARG_HOST_PORT.test(args)) {
    // host:port 命中后复检是否 loopback —— 私网(RFC1918)仍算 egress(SSRF pivot)
    if (!/((?:127\.0\.0\.1|localhost|\[::1\]):\d{2,5})\b/i.test(args)) caps.add("network-egress")
  }
  if (MCP_ARG_SHELL.test(args)) caps.add("exec")
  if (MCP_ARG_WRITE_PAIR.test(args) && /\b(?:path|file|filename|dest|destination|output|to)\b/i.test(args)) {
    caps.add("file-write")
  }

  if (caps.size === 0) caps.add("unknown")
  return Array.from(caps)
}
```

> 注：NIT-2 的 loopback 复检，用与 URL regex 一致的 loopback 字面量（127.0.0.1/localhost/[::1]）。私网段（192.168/10./172.16-31）**故意不剔除** —— SSRF 探测内网正是 network-egress 要抓的。

## 3. 不做的事（scope 约束）

- 不改 name heuristics（`MCP_NAME_*`）—— 仅 arg-scan 收紧。
- 不改 `mergeCapabilities` / `CRITICAL_MCP_CAPABILITIES` / force-confirm 逻辑。
- 不动扩展端、不动 server.ts executeMcpTool。
- 不引入 `isPrivateOrLoopbackIp` 到 arg 复检（保持与 URL regex 一致的字面量风格；私网算 egress）。

## 4. 测试计划（`tests/integration/mcp-capability-gate.test.ts`）

新增 `classifyMcpCall` 单测（纯函数，无需 MCP infra）：

| 用例 | 期望 |
|---|---|
| `{url:"http://evil.com/x"}` | network-egress（回归） |
| `{url:"https://127.0.0.1/x"}` | 不含 network-egress（loopback，回归） |
| `{url:"ftp://evil.com/x"}` | **network-egress（NIT-1 新）** |
| `{url:"wss://evil.com/ws"}` | **network-egress（NIT-1 新）** |
| `{url:"file:///etc/passwd"}` | 不含 network-egress（非出网，NIT-1 负例） |
| `{target:"evil.attacker.com:443/exfil"}` | **network-egress（NIT-2 新）** |
| `{ip:"1.2.3.4:8080"}` | **network-egress（NIT-2 新）** |
| `{ip:"127.0.0.1:8080"}` | 不含 network-egress（NIT-2 loopback） |
| `{ip:"192.168.1.5:80"}` | **network-egress（私网=SSRF，故意抓）** |
| `{desc:"see docs.example.com for help"}` | 不含 network-egress（NIT-2 裸域名误报防护） |
| 大 payload：前 4000 填充 + 尾部 `{"url":"https://evil.com/x"}` | **network-egress（NIT-3 尾扫新）** |
| 大 payload：标记在中间 6000-8000 区间 | 可能漏（已知 gap，accept；可补 log） |

加 1 个集成层断言：尾部 URL 的 MCP 调用走 force-confirm（端到端覆盖）。

## 5. 风险

- **NIT-2 误报**：`host:port` 结构在正常 args 里不常见（端口是强信号），误报率应很低。若 kimi 认为仍偏激进，可降级为"仅当 name 命中 EGRESS 词时才查 host:port"。
- **NIT-3 中间 gap**：明确 accept，超长 args 可加 warn log。
- 全部为加法（只增 network-egress 命中），不改既有能力门语义 → 无回归风险。

## 6. 请 kimi 过设计

- scheme 集 `http/https/ftp/ftps/ws/wss` 是否合适？（尤其 `file`/`data` 的排除）
- NIT-2 的 `host:port` 精度取舍 —— 接受独立信号，还是要求"name 命中 EGRESS 时才查"？
- NIT-3 的 head4000+tail2000 vs 直接放大 cap（如 64KB 整扫）？

裁决后我实现 + tsc + 全量 `npm test`，再 push 开 PR。

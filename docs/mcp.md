# CMspark MCP 支持指南

CMspark 通过本地 Companion 接入 [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server，把外部工具（filesystem、brave-search、pentest-ai 等）暴露给 LLM。

### 能力坐标

| 轴 | 本指南位置 |
|----|------------|
| **Surface** | **不单独构成** L0/L1/L2；MCP 工具挂在当前线程的 tool 面，实际 blast radius 取决于工具本身（读文件 / 调 API / 其它） |
| **Composition** | **组合面原语** — 外部工具总线（`mcp__<server>__<tool>`），可与 Skill / Pack / user-env 一起装配到任意对话 |
| **Autonomy** | 仍在同一 LLM tool-loop；多 worker 场景下 MCP 是否可用受 worker 白名单约束 |
| **规范** | [ADR-020](adr/020-capability-model-three-axes.md) · 密钥注入见 [user-env](user-env.md) · 场景配方见 [任务包](mission-pack-usage.md) |

> MCP **不是**「中层 Agent」或新 runtime，只是把外部能力**组合**进现有 Agent。高级投研类 skill 常与 MCP/API + [user-env Secrets](user-env.md) 一起用，多数时间停在 **L0 聊**，只有真的调用浏览器 tool 时才进入 **L1 网页**。

## 支持能力

| 能力 | 状态 | 说明 |
|------|------|------|
| stdio MCP server | ✅ 支持 | 通过 `command` + `args` 启动本地子进程 |
| HTTP MCP server | ✅ 支持 | 通过 `url` + `headers` 连接远程端点 |
| 工具调用 | ✅ 支持 | 暴露为 `mcp__<server>__<tool>` 形式 |
| Resources | ✅ 支持 | 仅当 server 声明 `resources` 能力时动态暴露 `mcp_list_resources` / `mcp_read_resource` |
| Prompts | ✅ 支持 | 仅当 server 声明 `prompts` 能力时动态暴露 `mcp_get_prompt` |
| 每线程 server 选择 | ✅ 支持 | `auto` / `all` / `manual` 三种模式 |
| 信任级别 | ✅ 支持 | `manual` / `first-use` / `trusted` |

## 配置文件位置

所有 MCP server 配置最终保存在：

```
~/.cmspark-agent/config.json
```

插件里的 MCP 面板只是这个文件的 UI；两者**完全同步**。

## stdio server 配置示例

### filesystem（官方文件系统 server）

**开箱默认**（`companion/src/config.ts` `defaultConfig`）：新安装 / 无 `mcp` 块时，companion **默认启用**官方 filesystem，且 **allow-dir = 用户主目录**：

| 项 | 默认值 |
|----|--------|
| `mcp.enabled` | `true` |
| `mcp.servers.filesystem` | `npx -y @modelcontextprotocol/server-filesystem <home>` |
| `trust_level` | `trusted` |
| allow-dir / `roots` / `cwd` | 当前用户主目录（`os.homedir()`，Windows 正斜杠） |

| 平台 | 主目录示例（写入 args） | roots URI 示例 |
|------|-------------------------|----------------|
| Windows | `C:/Users/HuChen`（正斜杠） | `file:///C:/Users/HuChen` |
| macOS / Linux | `/Users/you` | `file:///Users/you` |

**手改补全**：若你只写了 package 名、没有允许目录且未配 `roots`，`ensureFilesystemAllowlist` 仍会在启动时注入主目录。

**已有 `~/.cmspark-agent/config.json`**：磁盘上的 `mcp.servers` 整图优先。  
- 删掉 filesystem 但保留其它 server → **不会**被默认配置复活。  
- 显式 `servers: {}`（清空全部 MCP）→ **保持空**，不会每次启动再塞回 filesystem。  
- 仅**新装**（`initDataDir` 写 defaultConfig）或磁盘**完全没有 `mcp` 块**时，才带上默认 filesystem@home。  
- 旧配置若仍是 `enabled: false` + 空 servers，可在 Side Panel → MCP 添加 filesystem，或把下面示例写入 config 后重启。

推荐完整配置（可多目录）：

```json
"mcp": {
  "enabled": true,
  "servers": {
    "filesystem": {
      "transport": "stdio",
      "command": "npx",
      "args": [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "C:/Users/you"
      ],
      "enabled": true,
      "trust_level": "trusted",
      "cwd": "C:/Users/you",
      "roots": [{ "uri": "file:///C:/Users/you", "name": "home" }]
    }
  }
}
```

macOS 示例：`args` 末尾用 `"/Users/you"`，`cwd` 同理。

关键点：
- `args` 里的路径才是 filesystem server **真正允许访问的目录**；`cwd` 只是 npx 进程启动目录。
- **默认主目录**：未配置任何 allow-dir / roots 时，companion 会注入用户 home（见 `ensureFilesystemAllowlist`）。你当前若已写 `/Users/you` 或 `C:/Users/you`，即已覆盖主目录。
- 所有 **作为 allow-dir 的路径必须真实存在**，否则 server 会启动失败；**其下的子目录**可在运行时 `create_directory` 逐级创建（父目录不存在时会报 `Parent directory does not exist`，属可恢复错误，应先建父级）。
- 想放开多个目录，就在 `args` 里加多个路径参数（或 MCP 面板编辑）。
- Windows 路径建议正斜杠（`C:/Users/...`），与 companion `normalizeArgsForPlatform` 一致。
- **God-mode 不会扩大 MCP allow-dir**；越界路径需改 MCP 配置，不是再开确认开关。
- **确认门（Autonomy）**：
  - 默认：`file-write` / `exec` / `network-egress` 等 critical 能力会 **强制 L2 确认**（即使 `trust_level=trusted`；`write_file` 等破坏性名称还会按次确认）。
  - **单独** god-mode、`auto_approve_dangerous`、或 **仅** `auto_approve_enterprise_tools` **都不会**免 MCP critical 确认。
  - **全自动巡航（三旗全开）**：`auto_approve_dangerous` + `auto_approve_enterprise_tools` + `allow_all_schemes` 时，与 `shell_exec` 一致，**免 MCP 写/critical 确认**（含 `mcp_read_resource` 等 meta force 路径；审计日志 `mcp.confirm.waived` / `mcp.meta.confirm.waived` · `reason=full_autonomy_cruise`）。未开三旗时行为不变。
- **动态加目录（P2）**：当 `mcp__filesystem__*` 因 **Access denied / outside allowed directories** 失败时：
  - **会弹 L2**：路径（**home 内或之外**）当前 allowlist **尚未覆盖** → 确认「是否允许该目录」→ 写入 config、热重载、**自动重试一次**。典型场景：默认只开了 home，LLM 要读 `D:/data/report` 或 `/opt/apps/x`。
  - **不会弹窗 / 不能动态加**（硬拒绝，无确认窗）：
    - **整盘 / 卷根**（`C:\`、`/`）— 必须指定具体项目目录；
    - **多用户配置根**（`C:\Users`、`/Users`、`/home`）— 必须指定具体用户/项目目录；
    - **系统敏感树**（Windows：`Windows` / `Program Files` / `ProgramData` 等；POSIX：`/etc` `/usr` `/bin` `/System` 等）；
    - **凭据类路径名**（任意位置的 `.ssh` / `.gnupg` / `.aws` / `.kube` / Keychains 等路径分量）— 阻止「再单独加宽」到这些目录；
    - **整个 home** 再加一遍（默认已覆盖时无意义）；
    - 目录尚不存在（须先存在再扩展；home 内仅上溯有限层，home 外只接受路径本身或其**直接父目录**）。
  - **默认 allow = 整个 home 的残余风险**：`server-filesystem` 一旦以 home 为 root，**home 下的 `.ssh` / 浏览器配置等已在 allow 范围内**；上面「凭据硬拒绝」只拦 **动态扩展** 再加一层，**不能**从默认 home root 里抠掉这些子树。收紧请改 `args` 为更窄目录（如 `~/Projects`）。
  - 默认 allow 已是 **整个 home** 时：home 内路径通常直接可用，**不会**为每个子目录再弹窗。
- **会话项目目录（P1）**：工具 `ensure_project_dir` 在工作区或 `~/CMspark-projects/<name>/` 下创建文件夹，供写报告前使用。

### brave-search

```json
"brave-search": {
  "transport": "stdio",
  "command": "npx",
  "args": [
    "-y",
    "@brave/brave-search-mcp-server"
  ],
  "enabled": true,
  "trust_level": "first-use",
  "cwd": "/Users/you/Projects",
  "env": {
    "BRAVE_API_KEY": "BSAxxx"
  }
}
```

### pentest-ai

```json
"pentest-ai": {
  "transport": "stdio",
  "command": "/Users/you/.local/bin/ptai",
  "args": ["mcp"],
  "enabled": true,
  "trust_level": "manual",
  "cwd": "/Users/you/Projects",
  "env": {
    "PENTEST_AI_AUP_ACCEPTED": "1"
  }
}
```

注意：
- pentest-ai 是攻击性安全工具，建议 `trust_level` 设为 `manual`，每次调用都弹确认。
- 如果 `ptai` 不在 daemon PATH 里，用完整路径作为 `command`。
- `PENTEST_AI_AUP_ACCEPTED=1` 是为了让 daemon 非交互运行；使用前请确认你已阅读并接受其 AUP。

## HTTP server 配置示例

```json
"my-http-server": {
  "transport": "http",
  "url": "http://127.0.0.1:8080/mcp",
  "enabled": true,
  "trust_level": "first-use",
  "headers": {
    "Authorization": "Bearer token"
  }
}
```

## 信任级别说明

| 级别 | 行为 |
|------|------|
| `manual` | 每次调用该 server 的工具都弹安全确认 |
| `first-use` | 首次调用确认，同 session 后续调用跳过（推荐） |
| `trusted` | 完全不确认，仅用于你完全信任的本地 server（如 filesystem） |

## 每线程 server 选择

在插件 MCP 面板可以切换：

- **auto**：默认暴露所有已连接 server 的工具
- **all**：显式暴露所有已连接 server 的工具
- **manual**：只暴露你勾选的 server 的工具给当前线程的 LLM

## 常见误区

1. **把 `cwd` 当成允许目录**  
   filesystem server 的访问控制看 `args` 里的路径，`cwd` 只是进程启动目录。

2. **路径不存在导致 ENOENT**  
   `cwd` 或 `args` 里的目录如果不存在，server 会启动失败，报错类似 `spawn npx ENOENT` 或 `Connection closed`。

3. **LLM 误用 `mcp_list_resources`**  
   只有声明了 `resources` 能力的 server 才支持 `mcp_list_resources`。对于 filesystem / brave-search 这类 tools-only server，LLM 会直接用 `mcp__filesystem__read_text_file` 等 namespaced 工具。

4. **命令找不到**  
   daemon 启动时的 PATH 可能被 macOS launchd 剥离。Companion 会自动补充 nvm、homebrew、~/.local/bin 等常见路径；如果还找不到，就在 `command` 里写完整路径。

## 修改配置后如何生效

通过插件 UI 保存会自动生效；如果直接改 `config.json`，需要重启 daemon：

```bash
pkill -f "cmspark-agent.js daemon"
/Applications/CMspark.app/Contents/Resources/node /Applications/CMspark.app/Contents/Resources/cmspark-agent.js daemon start --daemonize
```

## 排查问题

查看 Companion 日志：

```bash
tail -f ~/.cmspark-agent/logs/companion-$(date +%Y-%m-%d).log | grep -i mcp
```

常见错误对照见 [`docs/TROUBLESHOOTING.md`](./TROUBLESHOOTING.md#mcp-相关)。

---

## Outbound MCP（编程 Agent 调用 CMspark 浏览器 · ADR-022）

<a id="outbound-mcp"></a>

> **方向**：Companion 作为 **MCP server**，把 curated **L1** 工具以 `cmspark__*` 导出给 Claude Code / Cursor / **Grok Build** 等。  
> **规范**：[ADR-022](adr/022-outbound-mcp-server.md) · 场景 [Daily Content Loop](decisions/daily-content-loop-brief-2026-08-04.md)  
> **P0d 手测**：[Outbound MCP P0d bake-off checklist](superpowers/plans/2026-08-04-outbound-mcp-p0d-bakeoff-checklist.md)（T1–T3 vs Playwright）  
> **排错**：[TROUBLESHOOTING.md · Outbound MCP](./TROUBLESHOOTING.md#outbound-mcp)

这与上文 **Inbound MCP**（`~/.cmspark-agent/config.json` 里配置 *外部* server 给 Side Panel 用）方向相反：Outbound 是 **CMspark 导出浏览器面** 给 *外部* 编程 Agent。

### 前置条件（所有编程 Agent 共用）

1. **Companion 在跑**：tray / `cmspark-agent daemon start` / 打开 CMspark.app  
2. **Chrome 扩展已配对**（Side Panel 绿 / 已连接），否则 `list_tabs` 等会 `EXTENSION_UNAVAILABLE` 或超时  
3. 编程 Agent 侧 **显式配置** `mcp-outbound`（**非** default-on：`daemon start` **不会**自动拉起 stdio MCP）

### 启动（显式 opt-in）

```bash
# 开发树：需已 build companion；PATH 上有 cmspark-agent 时：
cmspark-agent mcp-outbound

# DMG /Applications 安装（推荐写绝对路径，避免 IDE 找不到 PATH）：
/Applications/CMspark.app/Contents/Resources/cmspark-agent mcp-outbound
```

stdio 进程会连本机 Companion：`POST http://127.0.0.1:<port>/outbound-mcp/v1/invoke`，`Authorization: Bearer …`：

| 模式 | Bearer | 说明 |
|------|--------|------|
| **P0 默认**（`outbound_mcp.require_grant=false`） | `ws_secret` 或 `CMSPARK_OUTBOUND_GRANT`（`cmg_…`） | 兼容 bake-off；仍建议最终迁到 grant |
| **P1 require_grant** | **仅** `CMSPARK_OUTBOUND_GRANT` | 拒绝 Extension `ws_secret`（L4+）；见 [grant design](decisions/outbound-mcp-l4-grant-design-2026-08-04.md) |

签发 grant：

1. **Side Panel → 设置 → Outbound MCP 调用方授权**（推荐）：填 label / caller_id / TTL →「签发 grant」→ 复制 token 或 env 片段  
2. 或 Companion API：`issueOutboundGrant({ label, caller_id })`  

写入 IDE：`CMSPARK_OUTBOUND_GRANT=cmg_…` 与 `CMSPARK_OUTBOUND_CALLER_ID=<caller_id>`。

### 通用编程 Agent 配置示例（JSON / Claude Code 风格）

```json
{
  "mcpServers": {
    "cmspark": {
      "command": "/Applications/CMspark.app/Contents/Resources/cmspark-agent",
      "args": ["mcp-outbound"],
      "env": {
        "CMSPARK_OUTBOUND_CALLER_ID": "my-coding-agent",
        "CMSPARK_OUTBOUND_PORT": "23401"
      }
    }
  }
}
```

开发机也可把 `command` 换成 `cmspark-agent` 或 `node …/companion/dist/index.js`（需本机 PATH / node_modules 可用）。

### Grok Build 配置（`config.toml`）

Grok 读 **TOML**，不是 JSON。用户级与项目级均可：

| 范围 | 路径 |
|------|------|
| 用户级 | `~/.grok/config.toml` |
| 项目级 | 仓库内 `.grok/config.toml`（需 folder trust） |

推荐（DMG 安装后）：

```toml
# CMspark Outbound MCP — L1 浏览器面（ADR-022）
# 前置：CMspark.app / daemon 运行 + Chrome 扩展 Side Panel 已配对
[mcp_servers.cmspark]
command = "/Applications/CMspark.app/Contents/Resources/cmspark-agent"
args = ["mcp-outbound"]
enabled = true
startup_timeout_sec = 45
tool_timeout_sec = 120
env = { CMSPARK_OUTBOUND_CALLER_ID = "grok-build", CMSPARK_OUTBOUND_PORT = "23401" }
```

验证：

```bash
grok mcp list
grok mcp doctor cmspark
# 期望：command found · handshake OK · 10 tools discovered · healthy
```

**配置 vs 会话（重要）：**

| 层 | 含义 |
|----|------|
| 配置 | 磁盘上已写 `[mcp_servers.cmspark]`；`doctor` 可单独拉起进程并握手 |
| 会话 | **当前这一次** Grok 对话是否已把 `cmspark__*` 注册进工具表 |

`doctor` 绿 **≠** 当前会话一定已挂载。改 config / 修好 Companion 后若工具仍只有 `tasks`/`voice` 等，请：

1. **退出并新开 Grok 会话**（最稳），或  
2. 使用 TUI 的 MCP reconnect / reload（若有）

成功时会话内应能发现 `cmspark__list_tabs` 等；调用外泄类工具前须先：

```text
cmspark__accept_data_disclosure  arguments: { "acknowledge": true }
```

未带 `acknowledge: true` 会返回 `ACK_REQUIRED`。

### 关键工具（默认 outbound L1 profile）

| 工具 | 说明 |
|------|------|
| `cmspark__accept_data_disclosure` | **先调用**（**必须** `acknowledge: true`）— Companion **服务端** disclosure 会话；`get_page_text` / `screenshot` 依赖它。**注意**：当前为编程 Agent 自确认（无人类 HITL），不表示终端用户已同意云端外泄；P1 grant 前勿用「用户已同意」话术 |
| `cmspark__list_outbound_profile` | 列出当前策展 L1 工具名 |
| `cmspark__list_tabs` | 列标签（建议其它工具前先调） |
| `cmspark__navigate` / `click` / `type` / `wait_for` / `downloads_find` | 策展 L1 交互 / 只读 Downloads |
| `cmspark__get_page_text` / `screenshot` | 外泄类；无服务端 disclosure 则拒 |

**不在默认 L1（调用会 `PROFILE_FORBIDDEN`）：**  
`scroll`、`evaluate`、cookies、host/CU、shell、netsec 等。  
长页翻读：用 `navigate` 到目标 URL + `get_page_text`，或在 Side Panel 内用完整工具面；不要假设 Outbound 有 `cmspark__scroll`。

### 现状（P0c 进度）

- 门禁 / disclosure / audit / synthetic origin：**已实现**  
- **真桥**：`mcp-outbound` → `POST http://127.0.0.1:<port>/outbound-mcp/v1/invoke`（`Authorization: Bearer <ws_secret>`）→ Companion `createToolExecutor` → Extension CDP  
- 先 `cmspark-agent start`（或 tray/daemon）并打开扩展配对；再由编程 Agent **按需 spawn** `mcp-outbound`  
- 无扩展连接时：`EXTENSION_UNAVAILABLE`（**仅** Chrome 扩展 peer 可做 CDP runner；tray 不会再被绑成 runner）  
- **L8 确认**：Outbound L2 / URL-gate 确认 **fan-out** 到所有已鉴权 Side Panel；**macOS Swift tray** 可弹原生确认窗；**Windows/Linux** 无原生 tray 确认（仅 Side Panel + 通知），超时 `OUTBOUND_CONFIRM_REQUIRED`（勿只盯 IDE）  
- **L9 tab lease**：交互工具须显式 `tabId`；holder=`outbound_mcp:<caller>`；与 Side Panel 冲突时 **Side Panel 赢**，MCP 得 `TAB_LOCKED` + `queue_disclosure_zh`  
- **租约上限**：同一 caller 默认最多 **2** 个 tab lease（与 multi-agent worker 同 cap）

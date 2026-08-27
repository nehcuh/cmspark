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
- **失效路径自愈**：`args` / `roots` 里**已不存在**的目录会在 sanitize 时剔除；若剔除后为空则**重新注入 home**（避免测试/动态 expand 留下的 `/tmp/cmspark-allow-dir-*` 永久打死 server）。
- **线程 `tool_whitelist`**：真实工具名为 `mcp__filesystem__…`（server id = config 键名）。历史短写 `mcp__fs__*` 会与 `filesystem` 双向别名匹配。
- **三旗全自动巡航（产品）**：`auto_approve_dangerous` + `auto_approve_enterprise_tools` + `allow_all_schemes` 同时开启时，**普通线程**的 `tool_whitelist` **立即视为全开**（不必新建对话；worker 仍 HARD_DENY）。未开三旗时，收窄白名单仍硬挡工具；全工具请设 `tool_whitelist: null`。`thread.update` 改白名单对内存中当前线程即时生效（勿只改磁盘 index）。
- 所有 **作为 allow-dir 的路径必须真实存在**，否则 server 会启动失败；**其下的子目录**可在运行时 `create_directory` 逐级创建（父目录不存在时会报 `Parent directory does not exist`，属可恢复错误，应先建父级）。
- 想放开多个目录，就在 `args` 里加多个路径参数（或 MCP 面板编辑）。
- Windows 路径建议正斜杠（`C:/Users/...`），与 companion `normalizeArgsForPlatform` 一致。
- **路径笼子 vs 三旗风险自担（2026-08）**：
  - 默认：越界路径走 L2「是否加入 allow-dir」；God-mode **单独**不扩 allow-dir。
  - **三旗全开**：越界且 `canOffer` 通过时 **自动加入 allow-dir（无 L2）**；仍拒绝整盘根、`/Users` 多用户根、系统敏感树（`/etc` 等）。
  - 行为型危险（云元数据 SSRF 等）仍硬拦，与路径笼子无关。
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

## 5 分钟租手（Outbound MCP · 实验）

<a id="outbound-mcp"></a>

> CMspark **租手（Outbound MCP）目前是实验能力**：非 default-on、**非产品 ship**（ADR-022）。T1 真人 bake-off（2026-08-27）：CMspark 臂在已登录 OA 读到邮件 widget；干净 Playwright/Chrome **打不开**同一门户（`ERR_EMPTY_RESPONSE`），**不是** SSO 登录墙对照。配置成功、工具列表出现 `cmspark__*`，只说明桥通了，**不**证明这个任务只能用我们。**仍禁止**扩默认 outbound profile。记分：[outbound-mcp-p0d-t1-20260827.md](audit/reviews/outbound-mcp-p0d-t1-20260827.md)。

**规范**：[ADR-022](adr/022-outbound-mcp-server.md) · **P0d 手测**：[bake-off checklist](superpowers/plans/2026-08-04-outbound-mcp-p0d-bakeoff-checklist.md) · **排错**：[TROUBLESHOOTING.md](./TROUBLESHOOTING.md#outbound-mcp)

这与上文 **Inbound MCP**（把外部 server 配进 Side Panel）方向相反：租手是 **CMspark 当 MCP server**，把策展 L1 以 `cmspark__*` 租给外部编程助手。

### 两扇门（不要混）

| 门 | 方向 | 说明 |
|----|------|------|
| **租手**（本页） | 他们 → 我们的已登录 Chrome | 编程助手当 MCP client，调 `cmspark__*`。钥匙 `cmg_`。 |
| **编程接力** | 我们 → 本机编程 Agent | CMspark 当 ACP client，外派写码。见 [编程接力用户指南](coding-handoff-user-guide.md)。不是租手。 |

入站 MCP（Jira / filesystem 接进侧栏）是第三件事，不要画进这两扇门。

### 什么时候用我们

已登录 / SSO / 已经打开的页 → **CMspark**。CI / 干净浏览器 / 无头 → **Playwright**。看网络面板 / 性能 → **Chrome DevTools MCP**。

### 诚实前提

1. Companion 在跑（托盘 / CMspark.app / `cmspark-agent daemon start`）。**`daemon start` 不会拉起 `mcp-outbound`。**
2. Chrome 扩展曾经配对（`.paired`）。要用页时 Chrome 得在（可最小化）。
3. 一把 **`cmg_…` 租手钥匙**（不是扩展配对码 `ws_secret`）。`require_grant` 默认 true。
4. 人能批确认：**macOS** 可用 Swift 托盘；**Windows / Linux 没有原生托盘确认**，必须 **打开 Chrome 确认台**。超时 `OUTBOUND_CONFIRM_REQUIRED`，不会自动过。

### 1. 拿钥匙（主路 = CLI）

```bash
cmspark-agent outbound-grant issue --caller-id codex --label Codex
```

stdout 只印一次 `cmg_…`，以及 `CMSPARK_OUTBOUND_GRANT` / `CMSPARK_OUTBOUND_CALLER_ID` / `CMSPARK_OUTBOUND_PORT` 和本机 `command` / `args`。这把钥匙不是扩展配对码。

可选：`--allow-page-export` 把「允许该 caller 把页文/截图发给其云模型」写在钥匙上（可撤销）。**这不跳过确认台**：首次外泄仍须操作者 HITL。编程助手自己 `acknowledge` **不够**。

**备用与撤销**：Side Panel → 设置 → Outbound MCP 调用方授权。钥匙丢了来这里撤销。

### 2. 接到编程助手（每份片段都必须带 grant）

**macOS（DMG）**

```json
{
  "mcpServers": {
    "cmspark": {
      "command": "/Applications/CMspark.app/Contents/Resources/cmspark-agent",
      "args": ["mcp-outbound"],
      "env": {
        "CMSPARK_OUTBOUND_GRANT": "cmg_粘贴刚才那把钥匙",
        "CMSPARK_OUTBOUND_CALLER_ID": "codex",
        "CMSPARK_OUTBOUND_PORT": "23401"
      }
    }
  }
}
```

**Windows（NSIS）** — `%LOCALAPPDATA%\CMspark\node.exe` + `cmspark-agent.js`：

```json
{
  "mcpServers": {
    "cmspark": {
      "command": "%LOCALAPPDATA%\\CMspark\\node.exe",
      "args": [
        "%LOCALAPPDATA%\\CMspark\\cmspark-agent.js",
        "mcp-outbound"
      ],
      "env": {
        "CMSPARK_OUTBOUND_GRANT": "cmg_粘贴刚才那把钥匙",
        "CMSPARK_OUTBOUND_CALLER_ID": "codex",
        "CMSPARK_OUTBOUND_PORT": "23401"
      }
    }
  }
}
```

**Linux**（PATH 上有 `cmspark-agent`）：

```json
{
  "mcpServers": {
    "cmspark": {
      "command": "cmspark-agent",
      "args": ["mcp-outbound"],
      "env": {
        "CMSPARK_OUTBOUND_GRANT": "cmg_粘贴刚才那把钥匙",
        "CMSPARK_OUTBOUND_CALLER_ID": "codex",
        "CMSPARK_OUTBOUND_PORT": "23401"
      }
    }
  }
}
```

开发树可把 `command` 换成 `node …/companion/dist/index.js`，`args` 仍以 `mcp-outbound` 结尾，**env 仍须含 GRANT**。

#### Grok Build（`config.toml`）

Grok 读 **TOML**。用户级 `~/.grok/config.toml`；项目级仓库内 `.grok/config.toml`（需 folder trust）。

```toml
# CMspark 租手 — L1 浏览器面（ADR-022 · 实验）
# 前置：Companion 在跑 + 扩展曾配对 + 已签发 cmg_ 钥匙
[mcp_servers.cmspark]
command = "/Applications/CMspark.app/Contents/Resources/cmspark-agent"
args = ["mcp-outbound"]
enabled = true
startup_timeout_sec = 45
tool_timeout_sec = 120
env = { CMSPARK_OUTBOUND_GRANT = "cmg_粘贴刚才那把钥匙", CMSPARK_OUTBOUND_CALLER_ID = "grok-build", CMSPARK_OUTBOUND_PORT = "23401" }
```

Windows 把 `command` / `args` 换成上面 NSIS 的 `node.exe` + `cmspark-agent.js`，**不要漏 GRANT**。

验证：

```bash
grok mcp list
grok mcp doctor cmspark
# 期望：command found · handshake OK · 工具 discovered · healthy
```

**配置 ≠ 会话。** `doctor` 绿 **≠** 当前这轮已挂上 `cmspark__*`。改 config 后请退出并**新开一轮**。

#### Claude Code

```bash
claude mcp add --env CMSPARK_OUTBOUND_GRANT=cmg_粘贴刚才那把钥匙 \
  --env CMSPARK_OUTBOUND_CALLER_ID=claude-code \
  --env CMSPARK_OUTBOUND_PORT=23401 \
  --transport stdio cmspark \
  -- /Applications/CMspark.app/Contents/Resources/cmspark-agent mcp-outbound
```

`--env` 解析因 CLI 版本而异。失败时把上面同一份 JSON（仍须含 `CMSPARK_OUTBOUND_GRANT`）写入 Claude 的 MCP 配置。

### 3. 用起来

新开一轮，问「用 cmspark 列出我的 Chrome 标签」。要动未批准的站：看 **确认台**（macOS 也可看托盘），不要盯 IDE。Windows / Linux：**打开 Chrome 确认台**。超时则失败并停，不会跳过。

页文 / 截图交给第三方云模型前：

1. 签发钥匙时勾过「允许该 caller 把页文/截图发给其云模型」（否则 `DISCLOSURE_NOT_GRANTED`）。
2. **首次外泄仍走确认台**（`DISCLOSURE_HITL_REQUIRED`）。调用方 `cmspark__accept_data_disclosure` / HTTP `acknowledge` **不是**操作者同意，也不表示「用户已同意云端外泄」。

`cmspark-agent daemon start` **不会** spawn `mcp-outbound`。stdio 由编程助手按需拉起，且必须带 grant env。

### 关键工具（默认 outbound L1 profile）

| 工具 | 说明 |
|------|------|
| `cmspark__list_outbound_profile` | 列出当前策展 L1 工具名 |
| `cmspark__list_tabs` | 列标签（建议其它工具前先调） |
| `cmspark__navigate` / `click` / `type` / `wait_for` / `downloads_find` | 策展 L1 交互 / 只读 Downloads |
| `cmspark__get_page_text` / `screenshot` | 外泄类。无 `allow_page_export` → `DISCLOSURE_NOT_GRANTED`；有旗无操作者会话 → `DISCLOSURE_HITL_REQUIRED`（确认台）。调用方自签不够 |
| `cmspark__accept_data_disclosure` | **不是**人类同意。不能代替钥匙上的 `allow_page_export`，也不能跳过确认台 HITL |

**不在默认 L1（调用会 `PROFILE_FORBIDDEN`）：**  
`scroll`、`evaluate`、cookies、host/CU、shell、netsec 等。  
长页翻读：用 `navigate` 到目标 URL + `get_page_text`，或在 Side Panel 内用完整工具面；不要假设租手有 `cmspark__scroll`。

### 桥与限制

- **真桥**：编程助手 spawn `mcp-outbound` → `POST http://127.0.0.1:<port>/outbound-mcp/v1/invoke`，Bearer = `CMSPARK_OUTBOUND_GRANT`（`cmg_…`）。默认 `require_grant=true`，勿用 `ws_secret`。
- 无扩展连接：`EXTENSION_UNAVAILABLE`（**仅** Chrome 扩展 peer 可做 CDP runner）。
- **L8 确认**：fan-out 到已鉴权 Side Panel；**macOS Swift 托盘**可弹原生确认；**Windows/Linux 须打开 Chrome 确认台**，没有原生 tray 确认。超时 `OUTBOUND_CONFIRM_REQUIRED`。
- **L9 tab lease**：交互工具须显式 `tabId`；holder=`outbound_mcp:<caller>`；与 Side Panel 冲突时 **Side Panel 赢**，MCP 得 `TAB_LOCKED`。
- **租约上限**：同一 caller 默认最多 **2** 个 tab lease。

# CMspark MCP 支持指南

CMspark 通过本地 Companion 接入 [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server，把外部工具（filesystem、brave-search、pentest-ai 等）暴露给 LLM。

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
        "/Users/you",
        "/Users/you/Downloads",
        "/private/tmp"
      ],
      "enabled": true,
      "trust_level": "trusted",
      "cwd": "/Users/you"
    }
  }
}
```

关键点：
- `args` 里的路径才是 filesystem server **真正允许访问的目录**；`cwd` 只是 npx 进程启动目录。
- 所有路径**必须真实存在**，否则 server 会启动失败。
- 想放开多个目录，就在 `args` 里加多个路径参数。

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

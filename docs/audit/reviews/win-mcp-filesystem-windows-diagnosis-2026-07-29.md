# Diagnosis — Windows default filesystem MCP 无法列出工具

**Date:** 2026-07-29  
**Evidence:** `~/.cmspark-agent/config.json` mcp.servers.filesystem + local `npx` repro + `docs/mcp.md` + companion MCP client code.

## Root causes (ordered)

### 1. **配置缺「允许目录」参数（主因）**

当前用户配置类似：

```json
"filesystem": {
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-filesystem"],
  "enabled": true
}
```

官方 server **要求**至少一个 allowed directory，通过以下**之一**提供：

1. CLI 参数：`args` 末尾追加路径  
2. MCP roots 协议：client 声明 roots capability 并响应 `listRoots`

**本地复现（无路径）：**

```
Usage: mcp-server-filesystem [allowed-directory] ...
At least one directory must be provided by EITHER method
Started without allowed directories - waiting for client to provide roots via MCP protocol
```

**CMspark 侧：** 仅当 `config.roots` 非空时才：

- 在 client capabilities 里声明 `roots`
- 注册 `ListRootsRequestSchema` handler  

（见 `companion/src/mcp/client.ts`）

因此：**args 无路径 + 未配 roots** → server 空允许集 → **工具列表为空 / 不可用**，面板显示 0 工具。

### 2. **历史上全局 MCP 常处于 disabled**

`companion-2026-07-*.log` 多次：

```
mcp.manager.disabled
```

即 `mcp.enabled=false` 时 McpManager **不启动任何 client**，UI 全是「未连接」。  
用户现在 config 里 `enabled: true`，但若 companion 未重启 / 未热更新，仍可能看到旧状态。

### 3. **不是「工具列表 UI 坏了」**

`McpPanel` 用 `server.tools.length` 展示；数据来自 companion 聚合。  
`server-filesystem` **不** advertise resources，正确路径是 `mcp__filesystem__read_text_file` 等 **tools**，不是 `mcp_list_resources`。

### 4. **Windows 路径注意**

- 路径必须**真实存在**  
- 推荐正斜杠或经 transport 的 normalize：`C:/Users/You`  
- `cwd` 不是 allowlist；allowlist 只在 **args 路径** 或 **roots**

## 推荐修复（用户配置）

```json
"filesystem": {
  "transport": "stdio",
  "command": "npx",
  "args": [
    "-y",
    "@modelcontextprotocol/server-filesystem",
    "C:/Users/HuChen",
    "C:/Users/HuChen/Downloads",
    "C:/Users/HuChen/Projects"
  ],
  "enabled": true,
  "trust_level": "trusted",
  "cwd": "C:/Users/HuChen"
}
```

或等价：`args` 保持 package 名，另加：

```json
"roots": [
  { "uri": "file:///C:/Users/HuChen", "name": "home" }
]
```

（需 companion 已支持 roots 字段并重启。）

然后：**重启 companion** 或 MCP 面板开关一次 server，点 ↻ 刷新；展开 server 应看到 `read_text_file` / `list_directory` 等。

## 产品改进建议（后续 PR，非本批）

1. 表单校验：选 filesystem 预设时强制至少一个目录  
2. 连接后若 tools=0 且 stderr 含 `allowed-directory`，UI 显示中文指引  
3. Windows 预设默认填入 `%USERPROFILE%` 与 Downloads

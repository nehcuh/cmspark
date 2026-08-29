# TROUBLESHOOTING

常见问题速查。

> **文档地图**：[docs/README.md](README.md) · 能力分层见 [ADR-020](adr/020-capability-model-three-axes.md)（L0 聊 / L1 网页 / 组合面 Pack·MCP / L2 桌面）。  
> 按场景查指南：确认台 · MCP · 任务包 · Computer Use · Host/Apps · Multi-Agent · user-env — 均在文档导航「用户指南」表。

## Companion 相关

### "config.json corrupted"

```bash
rm ~/.cmspark-agent/config.json
# 重启 companion，会自动生成默认配置
```

### 端口 23401 被占用

```bash
# 查找并杀掉占用进程
lsof -i :23401
kill -9 <PID>

# 或直接杀 companion
pkill -f "dist/index.js"
```

### "No API key configured" 警告

设置环境变量或在 Extension 设置面板配置：
```bash
export DEEPSEEK_API_KEY=sk-xxx
```

### 首条消息返回 400 / "model not found"

配置里的 `model_name` 不是 provider 当前提供的模型 id。**DeepSeek 的旧名 `deepseek-chat` / `deepseek-reasoner` 将于 2026-07-24 15:59 UTC 停用**，取代为 `deepseek-v4-pro`（更强）与 `deepseek-v4-flash`（轻量快速，**默认**）。两者在过渡期都已指向 `deepseek-v4-flash` 的两种模式（chat=非思考 / reasoner=思考）。

**companion 启动时会自动迁移旧名**：若 `~/.cmspark-agent/config.json` 的 `llm.model_name` 仍是 `deepseek-chat` 或 `deepseek-reasoner`，启动时自动改写为 `deepseek-v4-flash`（原子写入，保留 api_key / 域白名单等其余配置），并打 `config.model_migrated` 警告日志。想要更强模型可手动改成 `deepseek-v4-pro`（设置面板的 Model 预设里选）。

启动时若配置了 API key，companion 还会探测 `/v1/models`，当配置的模型不在 provider 当前列表时打 `startup.model_probe.model_not_listed` 警告。

### 启动后 Side Panel 连不上

1. 确认 companion 正常：`curl http://127.0.0.1:23401`（应返回 WebSocket 升级响应）
2. 确认 Extension 已加载：`chrome://extensions` 中 CMspark 状态为"已启用"
3. 如果 Side Panel 显示断连提示，点击"重试"按钮

## MCP 相关

### "spawn npx ENOENT" / "spawn <command> ENOENT"

daemon 启动时 PATH 被系统剥离，找不到命令。

**解决：**
1. 优先在 `command` 里写完整路径，例如 `"/Users/you/.local/bin/ptai"`。
2. 确认 `cwd` 指向的目录真实存在。
3. 对于 `npx` 等 Node 工具，确保已安装在 nvm/npm 全局目录；Companion 会自动补充 nvm、homebrew、~/.local/bin 等路径。

### "MCP error -32000: Connection closed" / "Crashed N times; giving up"

通常是 stdio server 启动后立刻崩溃。

**排查：**
```bash
tail -f ~/.cmspark-agent/logs/companion-$(date +%Y-%m-%d).log | grep -i "mcp.client.start_failed"
```

常见原因：
- `args` 里的允许目录不存在（filesystem server 会因此崩溃）。
- server 需要交互式确认（如 pentest-ai 的 AUP），但 daemon 是非交互的 —— 加对应 env var，如 `PENTEST_AI_AUP_ACCEPTED=1`。
- command/args 写错，或依赖的命令未安装。
- **打包版 `.app` + `npx`：** 安装包只带 `Contents/Resources/node`、不带 npm。若 PATH 把该目录排在 nvm 的 `npx` 前面，npm 会去 `lstat /Applications/CMspark.app/Contents/lib` 并立刻退出。**已发布的旧包没有这层修复**——立刻可用的办法是在该 server 的 `env.PATH` 写 nvm 的 `bin`（不要包含 `CMspark.app/Contents/Resources`），或把 `npm_config_prefix` 指到 `~/.cmspark-agent/npm-prefix`。新版本 Companion 会把「带 npx 的 node 目录」排在打包 node 之前，并默认 pin 这个 prefix。

### "此 server 未声明 tools 能力"

server 没连上或没声明 `tools` capability。先解决上面的连接问题；连接成功后这个提示会消失。

### filesystem server 提示 "Access denied - path outside allowed directories"

`args` 里列出的路径才是允许访问的范围，`cwd` 不影响访问控制。

**解决：** 在 `args` 里加上你想访问的目录，并确保目录存在。详细配置见 [`docs/mcp.md`](./mcp.md)。

### LLM 反复调用 `mcp_list_resources` 失败

只有声明了 `resources` 能力的 server 才支持 `mcp_list_resources`。filesystem / brave-search 等 tools-only server 应该使用 `mcp__<server>__<tool>` 形式的 namespaced 工具。如果 LLM 仍反复误用，检查 server 是否已正常连接；连接正常时 meta tools 会按 capability 动态暴露。

## Outbound MCP（编程 Agent · ADR-022）

<a id="outbound-mcp"></a>

> 完整配置见 [`docs/mcp.md` · 5 分钟租手](./mcp.md#outbound-mcp)（含 **Grok `config.toml`**）。  
> 与上文 **Inbound** MCP（Companion 拉外部 server）方向相反。租手钥匙是 `CMSPARK_OUTBOUND_GRANT`，不是 `ws_secret`。

### `grok mcp doctor` 绿，但对话里没有 `cmspark__*` 工具

**配置 ≠ 当前会话挂载。** `doctor` 会单独 spawn `mcp-outbound` 测握手；已打开的 Grok 会话未必已注册该 server。

**解决：** 退出并 **新开 Grok 会话**（或 TUI MCP reload）；确认 `~/.grok/config.toml` 或项目 `.grok/config.toml` 有 `[mcp_servers.cmspark]` 且 `enabled = true`。

### `MODULE_NOT_FOUND: @modelcontextprotocol/sdk`

打包/hot-swap 的 `cmspark-agent.js` 若把 MCP SDK 标成 external 且 Resources 未带 `node_modules`，`mcp-outbound` 会秒崩。

**解决：** 使用 `make package-macos` 正规产物（esbuild **内联** SDK），或开发树 `node companion/dist/index.js mcp-outbound`。Grok 的 `command` 指向  
`/Applications/CMspark.app/Contents/Resources/cmspark-agent`。

### `DISCLOSURE_NOT_GRANTED` / `DISCLOSURE_HITL_REQUIRED`

读页面正文/截图（外泄给调用方云模型）不是编程助手自己 `acknowledge` 就能过：

- **`DISCLOSURE_NOT_GRANTED`**：这把 `cmg_` 钥匙没有 `allow_page_export`。重新签发并勾选「允许该 caller 把页文/截图发给其云模型」，或 CLI `--allow-page-export`。
  （HTTP 路径按这把钥匙本身判定；stdio / `mcp-outbound` 路径无钥匙凭证、按 caller 判定——同一 caller 若有另一把带旗钥匙会放行。）
- **`DISCLOSURE_HITL_REQUIRED`**：钥匙已允许外泄，但**首次仍须人批**。**打开 Chrome 确认台**（macOS 也可托盘）。调用方 `cmspark__accept_data_disclosure` **不够**，也不表示用户已同意云端外泄。

Windows / Linux 没有原生 tray 确认。

### `PROFILE_FORBIDDEN`（如 `cmspark__scroll`）

默认 outbound L1 **不含** `scroll` / `evaluate` / cookies / shell 等。  
长文：用 `navigate` 到具体 URL + `get_page_text`，不要依赖 Outbound 翻页工具。

### `EXTENSION_UNAVAILABLE` / `list_tabs` 超时

Companion 在跑但 **没有已鉴权的 Chrome 扩展**（Side Panel 未开或未配对）。

**解决：** 打开 Side Panel 至「已连接」；`curl` 检查  
`GET http://127.0.0.1:23401/outbound-mcp/v1/health` 应返回 `"runner":"wired"`（需 Bearer `CMSPARK_OUTBOUND_GRANT`，不是 `ws_secret`）。

### `OUTBOUND_CONFIRM_REQUIRED`

危险工具等 L2 确认超时或未在确认台处理。Outbound 确认会 fan-out 到 Side Panel / 确认台；macOS 还可 Swift 托盘。Windows / Linux **没有原生 tray 确认** — **打开 Chrome 确认台**，不要只盯编程 Agent 窗口。

### command not found / doctor 找不到 `cmspark-agent`

IDE 启动时 PATH 往往没有 dev 的 `cmspark-agent`。

**解决：** `command` 写绝对路径  
`/Applications/CMspark.app/Contents/Resources/cmspark-agent`，`args = ["mcp-outbound"]`。

## 确认台 / L2 安全确认

> 完整说明见 [confirm-center-user-guide.md](./confirm-center-user-guide.md)。

### 点了「确认台」却是空的 / 不知道干什么

确认台（Cockpit）是**高危操作审批 + Computer Use 操控**的宽窗，不是配置页。  
没有待确认、也没有桌面任务时，空窗是正常的。配置 IP / 开模块请去 **任务包**，不要找确认台。

### 已经做了 NetSec 任务授权，扫描仍要再确认

**预期行为。** 任务授权 = 本线程声明有权测这些目标；真正 `netsec_port_scan` 时仍走 **L2 确认台/红条**（执行闸）。两层都过才能扫。

### 侧栏显示「请在操控台输入确认码」

该确认带 nonce，侧栏不能点「允许」。打开 **确认台 / 操控台**，**手动输入**确认码（不可粘贴）。

### 关掉确认台后 Computer Use 还在跑

**预期行为。** 关窗 ≠ 停任务。要用侧栏或宽窗上的 **急停**，或确认时的「拒绝并停止」。

### 确认弹一下就失败 / 超时

未在约 45s 内处理会过期并拒绝 tool。有红条或 FleetStrip 待确认数字时优先处理。

## Extension 相关

### "No tab with id 303" 错误

LLM 产生了幻觉 tabId。这是**可恢复错误**，Agent 会自动调用 `list_tabs` 获取真实 tabId 后重试。如持续出现，手动提示 Agent "请先调用 list_tabs"。

### Extension 加载失败

1. 确认已运行 build：`cd chrome-extension && npm run build`
2. 确认 `chrome-extension/build/chrome-mv3-prod/` 目录存在
3. `chrome://extensions` → "加载已解压的扩展程序" → 选择上述目录

### Extension 开发时热更新不生效

`npm run dev` 启动 plasmo dev server，然后在 `chrome://extensions` 点击刷新按钮。

### svgo 警告（非阻塞）

`npm run build` 时可能看到 svgo 相关警告，这是可选依赖缺失，**不影响功能**。

## Skill 相关

### 导入 Skill 失败

- 确认文件是 `.md` 格式且包含 YAML frontmatter（`---` 包裹）
- frontmatter 必须包含 `name` 字段
- 如果是 zip 导入，确认 zip 内包含 `SKILL.md` 文件

### Skill 激活后不生效

- 检查 Side Panel 的 Skills 面板，确认 skill 已勾选
- 检查 companion 日志（`~/.cmspark-agent/logs/`）中 skill 加载是否成功

## 日志位置

| 类型 | 路径 |
|------|------|
| Companion 日志 | `~/.cmspark-agent/logs/`（JSONL 格式，按日切分） |
| Extension 日志 | Chrome DevTools → Console（Side Panel 上下文） |

## 重置

完全重置 CMspark（清除所有数据）：

```bash
rm -rf ~/.cmspark-agent/
# 重启 companion
```

---

*持续更新，有新问题请补充。*

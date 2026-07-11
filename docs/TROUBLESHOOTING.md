# TROUBLESHOOTING

常见问题速查。

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

### "此 server 未声明 tools 能力"

server 没连上或没声明 `tools` capability。先解决上面的连接问题；连接成功后这个提示会消失。

### filesystem server 提示 "Access denied - path outside allowed directories"

`args` 里列出的路径才是允许访问的范围，`cwd` 不影响访问控制。

**解决：** 在 `args` 里加上你想访问的目录，并确保目录存在。详细配置见 [`docs/mcp.md`](./mcp.md)。

### LLM 反复调用 `mcp_list_resources` 失败

只有声明了 `resources` 能力的 server 才支持 `mcp_list_resources`。filesystem / brave-search 等 tools-only server 应该使用 `mcp__<server>__<tool>` 形式的 namespaced 工具。如果 LLM 仍反复误用，检查 server 是否已正常连接；连接正常时 meta tools 会按 capability 动态暴露。

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

# 环境变量（Secrets）使用说明

> ADR：[019-user-env-secrets](adr/019-user-env-secrets.md)

供 skill / `shell_exec` / MCP stdio 子进程使用的本机密钥。**不会**进入大模型上下文。

## 何时需要

第三方 skill（如 Datayes）要求 `DATAYES_TOKEN` 等环境变量，而 Companion 由 daemon/tray 启动时通常拿不到终端里的 `export`。

## 配置步骤

1. 启动 Companion，打开 Chrome Side Panel 并完成配对  
2. **设置 → 环境变量（Secrets）**  
3. 点快捷 chip（如 `DATAYES_TOKEN`）或手填变量名  
4. 粘贴密钥值 → **添加并保存**（行内写入，不是底部全局 Save）  
5. 列表只显示「● 已配置 / ***」，明文永不回显  

存储路径：`~/.cmspark-agent/user-env.json`（权限 0o600）。

## 安全说明

- 出站 WebSocket 只传 key 名与 mask，不传明文  
- 不替代 `shell_exec` 的 L2 确认：agent 仍可能在批准后通过 `printenv` 等命令读到变量  
- 禁止设置 `PATH`、`CMSPARK_*` 等系统保留名  

## 相关实现

| 组件 | 路径 |
|------|------|
| Companion 核心 | `companion/src/user-env.ts` |
| shell 注入 | `companion/src/capability/shell.ts` |
| MCP 注入 | `companion/src/mcp/transport.ts` |
| 设置 UI | `chrome-extension/src/sidepanel/components/UserEnvSection.tsx` |

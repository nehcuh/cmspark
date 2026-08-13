# 编程接力（Coding Handoff）用户指南

> **产品版本**：随 `feat/coding-handoff` / PR #185 起  
> **决策**： [ADR-025](adr/025-acp-coding-agent-client.md) · [产品设计](decisions/acp-coding-handoff-product-design-2026-08-13.md)  
> **定位**：浏览器证据 → 本机编程 Agent；**不是** Side Panel IDE。

---

## 和 Outbound MCP 的区别

| | 编程接力 | Outbound MCP |
|--|----------|--------------|
| 方向 | CMspark → 本机写码助手 | 本机写码助手 → CMspark 浏览器 |
| 典型场景 | staging 复现后改仓库 | Claude Code 要操作已登录页 |

---

## 快速开始

### A. 只复制任务包（默认可用，无需开 ACP）

1. 绑定工作区（场景面板）  
2. Side Panel 输入 `/code` 或 `/编程`，或点消息旁编程入口  
3. 编辑任务摘要 → **复制编程任务包** → 粘贴到 Claude Code / 终端  

### B. 本机 Agent 审查 / 起草（需开启 ACP）

1. **设置 → 编程助手** → 勾选「启用 ACP 会话」  
2. 可选：**重新检测** / **将检测结果写入 config**  
3. 绑定真实工作区  
4. `/code` → 选 Agent → **审查** 或 **起草修改** → 勾选云模型披露 → **启动**  
5. 确认台同意后，FocusBand 显示进度 tail（chip 带模式徽章：审查/起草）  
6. 可 **停止编程会话**（≠ 桌面急停）  
7. 结束后聊天出现 handback；起草模式可 **应用 diff**（再次确认）  
8. 可 **追问**（新一轮 + 上文 + 再确认）  

> **文案**：产品用「审查 / 起草」表示**任务意图**，**不**表示 OS 沙箱只读（外部 Agent 仍是独立进程）。

---

## 安全边界

- 启动 / 应用 diff **必须**确认；三旗巡航 / god-mode **不能**静默跳过  
- 写盘仅限线程工作区 realpath 内；路径逃逸拒绝  
- 外部输出为 **不可信 DATA**，不是系统指令  
- 会话模式 ≠ OS 沙箱保证（外部进程仍可能写盘）  
- Worker 线程禁止 ACP  

---

## 配置提示

```json
"acp": {
  "enabled": true,
  "servers": {}
}
```

`enabled: true` 且 `servers` 为空时，仍会探测 PATH 上的 `claude` / `gemini` / `codex` / `pi`（临时，不写盘）。  
「将检测结果写入 config」会把绝对路径持久化到 `~/.cmspark-agent/config.json`。  
列表 UI 只显示可执行文件名（basename），完整路径仅保存在 Companion 侧。

---

## 故障排查

| 现象 | 处理 |
|------|------|
| 没有 Agent 可选 | 开 ACP；装 CLI；点重新检测 |
| 启动无反应 | 看确认台是否超时；Companion 是否在线 |
| 应用 diff 跳过文件 | hunk 上下文不匹配 → 在 IDE 手改；或让 Agent 出完整 diff |
| 进度看不到 | 确认 `acp.enabled` 且已点启动通过确认 |

---

## 非目标

- Side Panel 完整 IDE / 无确认写盘 / free shell  
- 默认打开 ACP  

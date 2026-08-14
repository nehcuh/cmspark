# 编程接力 · 模式 C：侧栏桥 + 本机终端双开

> **日期**: 2026-08-14  
> **状态**: Product lock · 用户选定 **C**  
> **上游**: [acp-shell-direction-dual-synthesis-2026-08-14.md](acp-shell-direction-dual-synthesis-2026-08-14.md)

---

## 0. 用户选择

**C · 侧栏桥 + 本机终端双开**

| 面 | 角色 |
|----|------|
| **侧栏** | Client 壳：任务、L2 确认、stdout/时间线监视、停止、handback |
| **本机终端** | 完整 Agent 交互 / TUI / 本机权限弹窗 |

两进程、两入口；**必须诚实文案，禁止暗示「同一会话」**（v1）。

---

## 1. 产品规则

| 规则 | 说明 |
|------|------|
| **默认关** | `coding_handoff.open_local_terminal: false` |
| **同一 L2** | 启动确认须写明「将额外打开本机终端」 |
| **仅绑定工作区** | 无 `workspace_root` 不弹终端 |
| **仅白名单 agent 命令** | `resolveServer().command` 绝对路径；禁任意 shell |
| **失败降级** | 终端打不开 → 侧栏仍跑桥；toast/时间线说明 |
| **平台** | macOS Terminal 优先；其它 OS 复制命令 / 尽力 |

### 双进程诚实文案（必须）

> 侧栏：监视 / 桥接输出  
> 终端：完整交互（权限与 TUI 在此）  
> 二者 **不是** 同一 ACP 会话（v1）

---

## 2. 实现档位

| 档 | 行为 | v1 |
|----|------|-----|
| **L0** | 开终端 + `cd` + 打印说明；命令已复制 | 必做降级 |
| **L1** | 开终端并执行交互式 agent（如 `claude`，**非** `-p` 桥） | **默认交付** |
| **L2** | 与侧栏同一会话 | **DEFER**（需真 ACP 会话复用） |

侧栏桥仍用现有 `claude -p` / ACP；终端 L1 用 **交互式** 启动（用户可在 TUI 里继续）。

---

## 3. 配置

```json
"coding_handoff": {
  "auto_suggest": true,
  "open_local_terminal": false
}
```

`config.set` 仅允许 boolean。

---

## 4. 非目标

- 不嵌 TUI 进侧栏  
- 不 PTY 进扩展  
- 不静默弹终端（须开关 + L2）  
- 不自由 `exec` 任意 path  

---

## 5. 验收

1. 开关默认关 → 启动不弹终端  
2. 开关开 + L2 允许 → 终端打开且 cwd=工作区；侧栏仍有 CLI/ACP 监视  
3. 时间线/提示可见「双进程」说明  
4. 终端失败时侧栏会话不因此失败  

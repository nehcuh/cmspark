# #au4dch 三优化点 · 产品规划（可落地）

> **日期**: 2026-08-01  
> **状态**: Active / Implementing on `feat/au4dch-ux-wave123`  
> **证据**: 会话 `au4dch` · 子轨 [optimization-plan-au4dch-ux-shell-download.md](../../optimization-plan-au4dch-ux-shell-download.md)  
> **能力声明**: Surface L1（下载）· UI 运行态 · Surface L2 enterprise（shell one-shot 止血）；**不含** 新一级常驻入口、auto-spawn、Side Panel 全量 PTY

---

## 0. 优先级（已锁定）

| 序 | 点 | 理由 | 本迭代交付 |
|----|-----|------|------------|
| **P0** | **ST 运行态 + SH-A 黑窗/进度** | #au4dch 用户连问「卡住了」；黑窗零信息；改动不触 L2 语义 | 完成 |
| **P1** | **DL 下载去重** | 装 skill 重复下；依赖 chrome.downloads 已有权限 | 完成 |
| **P2** | **ST-5 舰队主线程指示** | 会话内 0× spawn；预防性增强 | 轻量完成 |
| **P3 / epic** | **SH-B 网页 PTY** | 规格已有；工期大；**本迭代只出产品边界与 backlog，不实现 PTY** | 规划 only |

**原则**：三「大点」用户痛点以 **P0+P1 交付为完成标准**；PTY 不假装已完成。

---

## 1. 产品规划 A — 下载去重（DL）

### 用户故事
作为用户，当我已把 release 包下到 Downloads 时，Agent 应先发现该文件并直接用于安装，而不是再次点击下载。

### 方案
1. **`downloads.find`**（只读工具）：`filenameHint` / `urlContains` / `limit` → `chrome.downloads.search`（`state=complete`, `exists=true`）。  
2. **`browser_download.prefer_existing`**（默认 true）：有 `filenameHint`（或 url 提示）时先 find；命中返回 `source:"cache"`；`force_redownload:true` 强制走点击路径。  
3. **无 selector/text 且 cache 命中**：允许成功返回；cache 未命中再要求 selector/text。

### 非目标
全盘扫描、自动执行下载文件、改 Downloads 根沙箱。

### 验收
- 已有 `foo.tar.gz` + `filenameHint=foo.tar.gz` → 无新 download id。  
- `force_redownload` 仍走 click+waiter。

### 坐标
Surface **L1** · Trust 只读 Downloads API。

---

## 2. 产品规划 B — 运行态可见（ST）

### 用户故事
作为用户，在 30s+ 的 `shell_exec` 或 tool 循环中，侧栏应明确「还在跑什么、多久了、输出尾」，而不是像对话已结束。

### 方案
1. **ST-1**：`processingLabel` 扫描最近消息中 `status===running` 的 tool（含 `role:tool`）。  
2. **ST-2**：WS `tool.progress`：`tool_call_id`, `elapsed_ms`, `stdout_tail`, `stderr_tail`。  
3. **ST-3**：ToolCallCard 显示 progress tail + 秒数。  
4. **ST-5（轻）**：有 fleet workers 时 label 附加「舰队 N worker」。

### 非目标
blocking `wait_workers`、新 Agent runtime、progress 全量审计落盘。

### 验收
- running shell 时文案含工具名与秒数。  
- progress 帧可被忽略（旧客户端兼容）。

### 坐标
UI 横切 · 协议扩展兼容。

---

## 3. 产品规划 C — Shell 止血 vs 网页 Shell（SH）

### 用户故事（止血）
作为 Windows 用户，批准 `shell_exec` 后不应弹空黑窗；输出应在侧栏 tool 卡可见。

### 方案 A（本迭代）
1. **`windowsHide: true`** on spawn（win32）。  
2. **onProgress** 与 ST-2 共用。  
3. Tool 卡展示 exit_code / duration / stdout 预览（沿用/加强）。

### 方案 B（epic，本迭代不交付代码）
- Companion node-pty + Cockpit xterm（enterprise design §C.shell）。  
- 默认 `confirm_per_command`；session 绑 thread。  
- **禁止** Side Panel 半成品终端。

### 非目标（本迭代）
交互 PTY、放宽 shell L2、god-mode 跳过 shell。

### 验收 A
- Win 真机无黑窗（或 CI 断言 spawn 选项）。  
- 长命令有 progress tail。

### 坐标
Surface **L2 enterprise** · Trust 单调不降。

---

## 4. 开发流程（确认）

```text
worktree feat/au4dch-ux-wave123
  → 实现 P0 ST+SH-A + P1 DL + 轻量 ST-5
  → 单测 + companion/extension 目标测
  → 内部对抗（security / UX / 兼容）
  → Pi 评审（用户指定；Claude 可选）
  → 文档回写 plan 状态
  → 总结报告（不直接 merge main，由人工/后续 PR）
```

中途分歧：对抗 subagent → Pi 二次确认 → 再改。

---

## 5. 变更日志

| 日期 | 变更 |
|------|------|
| 2026-08-01 | 初版锁定优先级 P0 ST+SH-A → P1 DL → P2 ST-5 → P3 PTY epic only |

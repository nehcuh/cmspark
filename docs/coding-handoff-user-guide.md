# 编程接力 — 用户指南

> **产品主名**：编程接力（Coding Handoff）  
> **决策 SoT**：[模式 C 双开](decisions/acp-dual-open-terminal-mode-c-2026-08-14.md) · [产品设计](decisions/acp-coding-handoff-product-design-2026-08-13.md) · [壳方向](decisions/acp-shell-direction-dual-synthesis-2026-08-14.md)  
> **对照**：[Outbound MCP（ADR-022）](adr/022-outbound-mcp-server.md) · [MCP 指南](mcp.md) · [确认台](confirm-center-user-guide.md)

---

## 1. 是什么

**编程接力**：把浏览器里已有的真相（staging 复现、PR 页、AppSec 发现等）打成任务，**外派**给本机编程助手（Claude Code / Gemini CLI / Codex / Pi 等），再把摘要/发现 **handback** 回对话。

| 一句话 | |
|--------|--|
| **做** | 页上证据 → 本机写码助手 → 摘要回侧栏 |
| **不做** | Side Panel 版 IDE / 嵌 TUI / 静默自动写盘 |

入口：`/code` · `/编程` · 消息旁「打开编程接力」· 设置 → **编程助手**。

---

## 2. 侧栏壳 vs 本机 Agent

两层角色，**不要当成同一个窗口**：

| 面 | 角色 | 你在这里做什么 |
|----|------|----------------|
| **侧栏（Client 壳）** | 监视 / 桥接 | 启动确认、L2、stdout/时间线、停止监视、handback、（ACP 时）侧栏续话 |
| **本机 Agent** | 真正的编程引擎 | 完整 TUI、权限弹窗、仓库读写习惯——配置与智能都在本机 CLI |

- 浏览器侧 = **ACP Client 壳**（或 CLI 一次性桥），**不是** Agent 本体。  
- 审查 / 起草 = **任务意图**，≠ OS 沙箱「只读」保证；外部进程仍可能写盘。  
- CLI 桥为**一次性**：侧栏不可多轮时，请用本机终端继续。

### 工作区与任务如何进入本机 Agent

- **工作区**：绑定一次即可（场景面板或编程接力条「选择…」）。线程会记住 `workspace_root`；启动时若尚未绑定，会弹出选择器并在选完后**自动继续启动**（无需再点一次「启动」）。  
- **模式 C 终端任务**：打开本机终端时会把与侧栏桥相同的任务正文（目标 + 模式说明 + 页面上下文）写入临时文件并作为 Agent 的**首条消息**传入（如 `claude "<task>"` / `pi "<task>"`），而不是只 echo 横幅。侧栏桥与终端仍是**双进程、非同一会话**。

### 环境变量（与终端一致）

侧栏启动的编程 Agent（ACP / CLI 桥）继承：

1. Companion 进程环境  
2. **登录 shell 快照**（`SHELL -lic env`，加载 `~/.zprofile` / `~/.zshrc` 等，与你在 Terminal 里直接跑 `pi` 一致）  
3. 设置 → **环境变量（Secrets）**（`user-env.json`）  
4. `acp.servers.<id>.env` 覆盖  

因此 `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` 等只要在终端可用，桥接进程也应可用。  
若仍缺 key：在本机终端 `echo $ANTHROPIC_API_KEY` 自检，或写入 **设置 → 环境变量**。  
调试可设 `CMSPARK_SKIP_LOGIN_ENV=1` 跳过登录 shell 探测。

---

## 3. 模式 C：侧栏桥 + 本机终端双开

产品锁定 **C**：侧栏监视桥 **与** 本机终端 **可同时开**（两进程、两入口）。  
细则见 [模式 C 决策](decisions/acp-dual-open-terminal-mode-c-2026-08-14.md)。

### 怎么开

1. **绑定工作区**（场景面板 → 选择工作区）。无 `workspace_root` **不会**弹终端。  
2. **设置 → 编程助手**（或编程接力面板内同名开关）：  
   - 勾选 **启用 ACP 会话**（默认关）  
   - 勾选 **启动时同时打开本机终端（模式 C · 默认关）**  
3. `/code` → 选 Agent · 审查/起草 · 勾选云披露 → **启动**  
4. 确认台 L2 会写明：**将额外打开本机终端**；侧栏保留监视桥  

### 行为要点

| 项 | 说明 |
|----|------|
| 默认 | `coding_handoff.open_local_terminal: false`（不弹终端） |
| 终端应用 | `local_terminal_app`：`auto`（默认）/ `Terminal` / `iTerm` / `Warp` / `Alacritty` / `Kitty` / `Ghostty` 或绝对路径 |
| 同一 L2 | 开关状态在**启动/propose 时**快照；确认后改开关不影响当次 |
| 终端失败 | 侧栏桥**继续**；时间线提示可手动粘贴命令 |
| 平台 | macOS 默认 Terminal.app；Linux `$TERMINAL` 或常见模拟器；Windows 复制命令 |
| v1 诚实 | 侧栏与终端 **不是** 同一 ACP 会话 |

配置示例：

```json
"coding_handoff": {
  "auto_suggest": true,
  "open_local_terminal": false,
  "local_terminal_app": "auto"
},
"acp": {
  "enabled": false,
  "servers": {}
}
```

**换终端**：设置 → 编程助手 → 开启模式 C 后选「本机终端应用」（如 iTerm2 / Ghostty）。**不会**静默回退到系统 Terminal：未安装或打开失败时侧栏报错并给出可粘贴命令。Warp 等无稳定脚本 API 的应用会打开窗口并提示粘贴任务。

---

## 4. Stop：只杀桥

| 操作 | 效果 |
|------|------|
| 侧栏 **停止编程会话 / 停止监视会话** | 结束 **Companion 侧 ACP/CLI 桥**（监视进程、侧栏时间线） |
| 本机 **Terminal 里的交互 Agent** | **不会**被侧栏 Stop 关掉；须在终端自行退出 |

模式 C 开启时侧栏会提示：

> 侧栏停止仅结束监视桥；本机 Terminal 内 Agent 需在终端自行退出。

**≠** 桌面急停（Computer Use）、**≠** 关掉本机 Claude Code 窗口。

---

## 5. 与 Outbound MCP 对照

对称双门面，**方向相反**，勿混用：

| | **编程接力** | **Outbound MCP** |
|--|--------------|------------------|
| 方向 | CMspark → 本机写码助手 | 本机写码助手 → CMspark 浏览器 |
| 典型 | staging 复现后改仓库 / PR 深读 | Claude Code 要操作**已登录**页 |
| 用户说法 | 「帮我改仓库」 | 「让编程 Agent 开我的登录页」 |
| 文档 | 本页 | [ADR-022](adr/022-outbound-mcp-server.md) · [mcp.md](mcp.md) |

他们租我们的浏览器 ↔ 我们外派他们的写码。

---

## 6. 三种用法（由薄到厚）

### A. 只复制任务包（默认可用，无需 ACP）

1. 绑定工作区  
2. `/code` → 编辑摘要 → **复制编程任务包**  
3. 粘贴到本机终端助手  

### B. 仅侧栏桥（ACP/CLI · 模式 C 关）

1. 设置开启 ACP → `/code` → 启动  
2. 侧栏看时间线；ACP 可侧栏续话；CLI 则多为一次性桥  

### C. 双进程（模式 C 开）

同 §3：侧栏监视 + 本机终端完整交互。

---

## 7. 不做什么（非 IDE）

| 不做 | 原因 |
|------|------|
| Side Panel 完整 IDE / Monaco / 文件树当编辑器 | 320px 不是 IDE |
| 嵌 TUI / PTY 进扩展 | 协议与信任边界 |
| 静默自动写盘 / 无确认 apply | Trust 永久 NO-GO |
| 默认开启 ACP 或模式 C | 均 opt-in |
| 「编程工作台」产品名 | 主名固定为 **编程接力** |
| 与 Outbound 合成「统一 Agent 平台」叙事 | 方向相反 |
| Worker / Board 内跑 ACP | Autonomy 语义污染 |

写码细改请在 **IDE / 本机终端 Agent**；侧栏负责 **采证、确认、监视、回验页面**。

---

## 8. 安全速记

- 启动（及 apply diff，若启用）**必须**确认；巡航三旗 / god-mode **不能**静默跳过编程启动  
- 外部输出为 **不可信 DATA**，主对话不执行 handback 内指令  
- Worker 线程禁止 ACP  
- 页面摘要与仓库片段可能进入该 Agent 的云模型——启动前勾选披露  

---

## 9. 故障排查

| 现象 | 处理 |
|------|------|
| 没有 Agent 可选 | 安装 CLI；设置里 **重新检测**；必要时「写入 config」 |
| 模式 C 不弹终端 | 确认开关已开、已绑定工作区、L2 已允许；看时间线是否「未打开」 |
| 停了侧栏终端还在 | 预期行为；在 Terminal 里退出 Agent |
| 启动无反应 | 确认台是否超时；Companion 是否在线 |
| 想操作已登录网页 | 用 **Outbound MCP**，不是编程接力 |

---

## 相关链接

- [模式 C：侧栏桥 + 本机终端双开](decisions/acp-dual-open-terminal-mode-c-2026-08-14.md)  
- [编程接力产品设计](decisions/acp-coding-handoff-product-design-2026-08-13.md)  
- [任务包 / 工作区](mission-pack-usage.md) · [确认台](confirm-center-user-guide.md)  

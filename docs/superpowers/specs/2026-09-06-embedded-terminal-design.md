# 插件内嵌终端（对标 Zed Terminal Threads）— 设计

> GitHub: #432
> 日期：2026-09-06
> 状态：设计定案（三路独立对抗综合：grok 主责 / claude 第二意见 / pi 可行性对账；
> 提案原文 `.tmp/lane-status/design-432-433-*.md`；外部基准见 §0）
> 修订对象：ADR-025（见 §2 显式对账，不是绕过）

## 0. 外部基准（调研结论）

- **Zed 自己的答案就是终端**：[Terminal Threads](https://zed.dev/blog/terminal-threads) 把
  claude/codex 等 CLI 跑在编辑器内嵌 PTY 里；社区甚至提案 [drop ACP, embrace terminal
  presets](https://github.com/zed-industries/zed/discussions/55099)。结论：对标 Zed =
  嵌真 PTY 终端，ACP headless 通道保持不变。
- **VS Code 架构**：node-pty（独立 Pty Host 进程）+ xterm.js。我们不拆 Pty Host
  （companion 已与 Chrome 渲染隔离，P0 进程内 + 杀树即可）。
- **Web 终端先例**：xterm.js + PTY over WebSocket 是成熟模式（Hermes agent web 终端等）。
- **MV3/CSP**：xterm.js core 无 eval，直跑无碍；用 **canvas 渲染器**（避开 webgl addon
  的 wasm CSP 争议）；全部打包进扩展，禁 CDN；OSC 8 链接 P0 当纯文本。

## 1. 产品句与形态裁决

全页 tab（图谱同款 `tabs/embedded-terminal.html`）内嵌 xterm.js，companion 用 node-pty
托管真 PTY，I/O 复用既有 WS。用户能滚、能看颜色、能敲。**不是只读日志框。**

**形态裁决（pi 提出的 A/B 分叉，定案）**：本票 = **形态 A（raw 内嵌终端，TUI 交互语义与
Terminal.app parity——无逐命令 L2；但起始 cwd/env 约束仍走 workspace 门，不是文件系统放飞）**。安全合同：默认关、只 extension 页面可开、user_gesture +
L2 确认开门、会话 TTL + 同时最多 1 个 + spawn/exit 审计；**不做逐命令 L2**（与 TUI
不兼容）。形态 B（CMspark 受管 shell、逐命令过门）是另一个产品，另票。
巡航档位联动落点：`plan_readonly` 档服务端拒绝 `terminal.open`；无人值守/巡航旗
**不得**跳过开门确认（ADR-020 信任单调）。

## 2. ADR-025 显式对账

| ADR-025 锁 | 本票处理 |
|---|---|
| 不是 Side Panel IDE | 守：侧栏只放入口/状态条；终端是全页 tab 新 Surface |
| free shell NO-GO | 守语义改载体：用户可见 PTY + L2 开门 + 默认关 ≠ free shell |
| 自动 spawn NO-GO | 守：`terminal.open` 强制 user_gesture；ACP 启动不自动弹 PTY |
| 无新 BottomBar Tab | 守：新 Surface 是图谱同款全页 tab，不是 BottomBar |
| Mode C = Terminal.app | 并存：外跳仍是默认；「内嵌终端」是显式选项（P1） |

`shell_exec`（one-shot 工具，enterprise 模块）与本票 PTY 是**两个开关**，不并合。

## 3. 三面架构

- **渲染面**：extension 全页 tab（`chrome.runtime.getURL`，图谱/ContextPanel 先例）。
  sidepanel 只放「打开终端」入口 + 状态条——320px 跑不了 TUI，且 sidepanel 关闭无
  close 事件（W3C #517 / chromium #403765214），长会话宿主不成立。禁 content-script。
- **控制面 + 数据面**：companion `pty/session.ts`（新——不放 `acp/`：P0 是裸 login shell 不是 ACP client，防被接到 launch-presets 自动 spawn）：会话表、L2、cwd 约束、
  TTL、杀进程树、反压。extension SW 只转发不解析 ANSI。
- **Swift**：不经手字节流；最多 tray 菜单加「打开内嵌终端」动词。

## 4. wire（复用既有 WS，JSON 语义，10MB 闸不动）

```
terminal.open    { id, cols, rows, cwd?, argv?, thread_id?, user_gesture:true }  → L2 确认后 spawn
terminal.opened  { id, pid, platform:"darwin" }
terminal.data    { id, seq, b64 }      // ≤16KiB 净荷/帧
terminal.input   { id, seq, b64 }
terminal.resize  { id, cols, rows }
terminal.ack     { id, seq }           // xterm write 回调 = 已解析信号
terminal.ping    { id }                // 客户端 keepalive：静默会话不被心跳误杀（评审 MAJOR-1）
terminal.pause/resume { id }           // 反压（xterm flowcontrol 指南同构：高水位 pause）
terminal.close   { id } / terminal.closed { id, code, signal }
```

- 校验进 `ws/validate.ts`；summoner/overlay surface 一律拒（panel/tab only）。
- 不拆 binary WS（拆鉴权另开 ADR）。
- 非 darwin → `terminal.closed { code: "unsupported" }` + 诚实文案（不承诺 Win/Linux 首发）。

## 5. 权限与安全门（常量表）

| 门 | 规则 |
|---|---|
| 默认关 | `embedded_terminal.enabled !== true`（设置里显式拨） |
| 开门 | `terminal.open`：user_gesture + SecurityConfirmationManager（每会话一次；input/resize 不再确认——键盘=用户本人） |
| 档位 | `thread_id` 绑定到 plan_readonly 线程 → 服务端拒 `terminal.open`（plan-readonly 闸只覆盖 catalog 工具名，router 须对 terminal.open 另判——写进实现清单）；未绑定线程（全局 shell）只走 L2 开门门；巡航/无人值守旗不豁免开门 |
| agent 写 | **P0 不做**（无 terminal.agent_write）；P2 另议，默认关、每条 L2 |
| cwd | **起始** cwd = thread.workspace_root 否则 `~/CMspark-projects`；禁 `/`、禁 symlink 逃逸起始路径（复用 workspace containment）——这是起始路径约束，**非沙箱承诺**（parity：shell 里用户可自由 cd） |
| env | 只注入 `getUserEnvVars()`；剥离 `CMSPARK_*`/api_key/ws_secret；`TERM=xterm-256color` |
| 进程 | 同时最多 **1** 个 PTY；孤儿回收主序：tab Port 断开 → terminal.close；WS 关闭钩子 → 杀该 peer 会话；companion 退出 → 杀树。45s 心跳只是最后防线（客户端每 25s `terminal.ping` 保活——「用户静默阅读」不是孤儿） |
| 审计 | open/close/cwd/pid/exit 记 capability-audit.jsonl；**完整击键流不落盘**（密钥回显） |

## 6. PTY 选型与打包（pi 的 SEA 约束已入案）

- **node-pty**（优先评估 `@lydell/node-pty` prebuilt-only 变体，免 node-gyp）。
- **Slice 0（打包验证先行）**：SEA extraNatives 链把 node-pty 打进 darwin 单文件——
  有 onnxruntime-in-SEA spike 先例（scripts/spike/s2-onnxruntime-sea/REPORT.md）。
  打包不过则 P0 不进入 UI 开发，先解打包（script(1) 免原生方案是已知备选但语义残缺，
  不作为交付形态）。**时限决策点**：打包 spike 超过 5 个工作日未过 → 单列打包票跟踪，
  P0 等待，不无限阻塞。
- `child_process` pipe 不是 TTY（isatty 失败、claude/vim 拒跑）——这正是今天 Mode C
  外跳的原因，不作为方案。

## 7. 分阶段切片

- **Slice 0**：SEA + node-pty 打包 spike（DMG 内 PTY 可 spawn）。
- **P0（本票最小可用）**：darwin + 默认关；设置项 + L2 开门；全页 tab xterm；
  双向 I/O + resize + ack 反压 + 关 tab 杀树；裸 login shell（不接 agent）。
  侧栏只显示「终端运行中 · 打开」。
- **P1**：Mode C `openLocalTerminalForAgent` 加 `embed` 分支——同一 argv 的 stdio 挂到
  我们的 PTY 而不是 Terminal.app（agent CLI 的 TUI 可见可操作）。ACP timeline/handback
  通道不变。
- **P2**：agent_write 门（默认关）；断线重连 = **同进程 PTY 仍活、WS 重连接回**（companion
  重启 → 诚实 `terminal.closed`，不复活假会话）；主题/滚动缓冲。
- **P3**：Linux/Windows 评估另票。

## 8. 验收

- AC-1：默认关时无入口；开启后侧栏「打开终端」→ L2 确认 → 全页 tab 真终端可敲可用
  （zsh 里跑 `ls`、vim、ctrl-c 正常）。
- AC-2：无 user_gesture / plan_readonly 档 / summoner surface → 服务端拒。
- AC-3：tab 关闭后 `ps` 无残留进程；高水位无 ack → `pty.pause()` 且 companion 内存不涨（反压）。
- AC-3b：起始 cwd 越界（`cwd=/`、symlink 逃逸）→ 服务端拒。
- AC-4：非 darwin 诚实拒；审计有 open/close 记录且无字节流。
- AC-5（红线回归）：不加新监听口；ws-auth/10MB 闸不变；shell_exec 语义不变；
  ADR-025 其他条款不破。

## 9. NEVER（沿用票面）

不做只读假终端；不 content-script 注入；不加新监听口；不自动 spawn；agent 写不豁免
确认；ws_secret 不当 grant；不承诺 Win/Linux 首发。

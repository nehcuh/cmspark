# 502 E/C 对抗复审清单（Kimi）

> 日期：2026-09-18 · 评审人：Kimi（READ-ONLY）
> 对象：worktree `/tmp/cmspark-502/e` 与 `/tmp/cmspark-502/c`，diff vs `c61285c6`
> 依据：plans `2026-09-18-502-e-fleet-inspect.md` / `2026-09-18-502-c-pty-embed.md`；spec §4 §6
> 状态：**计划级风险已钉；两个 worktree 均无 feat commit，代码复审待 diff。**

## E 红线（brief 点名）

- [ ] **主对话 SET_STREAMING 不得被 worker token 污染**：`chat.token` 仅在 `msg.thread_id === inspectedWorkerId` 时 `SET_INSPECT_TAIL`；Inspect 路径源码锁不含 `SET_STREAMING`。附带：`chat.assistant`/`chat.done`/`chat.reasoning`/`tool.result` 对 inspected worker 也不得 `ADD_MESSAGE` 进主流
- [ ] **无 system prompt 全文**：Inspect 简报 = worker 首条 `role=user` 消息（≤160 字）或 `worker_role_label` 兜底；确认 `system_prompt_append` / composed prompt 不出现在任何 UI 字段
- [ ] **无新 BottomBar**：`CONTEXT_PANEL_TABS`/`ContextPanelId` 零新增；Inspect 复用 `FleetWorkerListPortal`

## E 计划级风险

1. **`tool.start` 单播陷阱**：plan Task 3 说「`tool.start` 可更新 inspect 的 latest 名」——但 `tool.start` 只发源 socket（`server.ts:571-579`）。在非发起方面板打开 Inspect，tool.start 永远不到，latest 只能靠 4s 轮询的 `latest_tool` 字段。实现若假装实时 = 撒谎；若静默退化 = 可接受但要在 review 里钉明。
2. **`latest_tool` 快照成本**：`buildFleetSnapshot` 每 4s 被轮询，若对每只 worker 全量倒扫 `tm.get(id).messages`，N worker × 长线程 = 每拍 O(总消息数)。应早退（找到即停）且确认不深拷贝消息。
3. **inspect buffer 生命周期**：`inspectedWorkerId`/`inspectTokenTail` 在 worker 完成、线程删除、portal 关闭、切线程时是否清理？800 字截断是否真有 trim（否则 token 流把 reducer 撑爆）。
4. **简报数据来源**：`state.threads` 里 worker 线程是否带 messages？侧栏通常只在 select 后拉消息。若简报永远落兜底 `worker_role_label`，「任务简报」就是空卖点——diff 里看是否新增消息拉取或接受兜底。
5. **FocusBand 预算**：Glance 追加最近工具名后一行仍 ≤80px（`FOCUS_BAND_MAX_PX=80`），不得换行溢出；无 `latest_tool` 时完全现状。
6. **worker 帧权限**：Inspect 让任意已认证面板看到 worker token 流——多面板场景下这是广播面扩大，确认不夹带 `tool.progress` stdout_tail（可能含密钥，dispatch 注释已警告）。
7. **测试纪律**：现有 stream-thread-gate 测试必须绿；`shouldUpdateInspectBuffer` 纯函数有测试；源码锁 SET_STREAMING。

## C 红线（brief 点名）

- [ ] **无 Alacritty 嵌入**：diff grep Alacritty 嵌入路径；Mode C 外跳仍走既有 `open-local-terminal.ts`
- [ ] **无自动 spawn**：`acp.ui_start` / session start 不得自动 embed；入口只在用户点击（`user_gesture:true`）
- [ ] **无新监听口**：diff 不得新增 listen/server/port；PTY tab 复用既有 WS
- [ ] **embed 失败不外跳撒谎**：`terminal_busy`/`unsupported`/`embedded_terminal_disabled` 返回 `ok:false`，**不静默 fallback 到 osascript 外跳**

## C 计划级风险

1. **L2 闸位置**：embed 分支必须先过 `terminal.open` L2 再 `spawnPtySession`；cruise/trust 不得跳过。diff 钉调用顺序。
2. **argv 注入面**：agent 请求的 file/args 进 node-pty spawn = 任意命令执行。闸门是 L2 确认——确认帧里用户能看到什么（完整 argv？）？plan 没写，review 时看确认载荷是否够用户判断。
3. **terminal_busy 语义**：已有裸 shell 占用时不得杀用户进程；返回诚实失败。看实现是否 detect busy 还是直接复用/杀掉。
4. **PTY 生命周期归属**：embed 的 agent 进程谁杀——tab 关闭、ACP session end、companion 退出？泄漏的 node-pty 子进程是资源风险。
5. **环境变量泄漏**：agent argv 的 env 是否继承 companion 全量 env（`ws_secret`、MCP 密钥、API key 会进 agent 子进程 + 可能被 PTY 回显）。
6. **默认关与非 darwin**：`embedded_terminal.enabled` 默认 false 不变；按钮仅 darwin+enabled 显示；非 darwin 诚实 `unsupported`。
7. **权限不走 ANSI**：ACP permission/apply_diff 仍走 JSON-RPC + L2，不得解析终端输出猜确认（spec §4.2）。

## 复核方法（diff 出现后）

1. `git -C /tmp/cmspark-502/{e,c} diff c61285c6..HEAD` 全 diff + `--stat`
2. E grep 红线串：`SET_STREAMING`、`SET_INSPECT_TAIL`、`system_prompt`、`CONTEXT_PANEL_TABS`、`tool.progress`
3. C grep 红线串：`Alacritty`、`listen(`、`createServer`、`osascript`、`user_gesture`、`spawnPtySession`
4. 跑相关测试（companion: fleet-latest-tool / pty-session；extension: fleet-strip / stream-thread-gate）
5. findings 分级 BLOCK/MAJOR/NIT，落 `docs/audit/reviews/502-e-kimi.md` / `502-c-kimi.md`

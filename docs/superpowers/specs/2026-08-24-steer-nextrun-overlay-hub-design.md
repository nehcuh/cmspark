# steer/nextRun UI + 悬浮窗 L0 工作台

> **日期**: 2026-08-24  
> **状态**: Design r2 (folded 3-lane REJECT)  
> **分支**: `feat/steer-nextrun-overlay-hub`  
> **对抗**: security REJECT · product REJECT · correctness REJECT → 本文吸收 BLOCK；产品「反转 Enter=steer」**不吸收**（grill 已锁，异议记 §8）  
> **相关**: #218 · ADR-014 · ADR-020 · S20 lease · S21 ACL · S46 trust cookie  

```text
Surface:      L0
L2-classes:   none — overlay never Allow/Deny
Compose:      overlay pack.apply allowTrust FORCED false by surface, not client
Autonomy:     existing steer/nextRun
Trust:        monotonic — overlay cannot write Trust B; refuse apply if thread holds trust cookie
Channel:      summoner ACL +pack.list +pack.apply; mcp.add denied
```

---

## 0. 问题陈述

Companion 已有 `chat.steer` / `enqueue` nextRun，但：

- Side Panel **忙时锁输入**（Stop 换发送），并不是 supersede。
- 悬浮窗 `summoner.submit` → 永远 `sendChatCreate` → **会 supersede**。
- `chat.create` 在 occupied 且无 `enqueue` 时服务端仍 abort 前任。

目标：忙时能纠偏/排队；服务端 occupied 无 enqueue **拒绝而非 abort**；悬浮窗能管对话 / 已连接 MCP / L0 场景且 **不能升 Trust**。

---

## 1. 非目标

- Continue/Abandon、persist running=true、confirm 快照、Allow/Deny 进 overlay
- overlay `mcp.add/remove`、`config.set`、`pack.install`
- 渗透/AppSec/L1/L2 Pack 一键套用
- WKWebView 跨平台壳；Windows/Linux overlay 工作台（PR1 的 **Side Panel** 两边都有）
- 会议 **工作台 UI**（录音/发言人）——overlay apply 只套 composition，完整工作台仍在侧栏
- 恢复 occupied `chat.create` supersede

---

## 2. PR1 — 发送语义 + 服务端禁 supersede（T2）

### 2.1 服务端（BLOCK 折叠，必先于 UI）

| 条件 | 行为 |
|------|------|
| occupied 且 `enqueue !== true` | **reject** `{error:"run_active"}`，**不 abort** |
| occupied 且 `enqueue:true` + 非空 | `enqueueNextRun`；满 → `queue_full`；空 → `empty_enqueue` |
| idle 且 `enqueue:true` | reject `idle_enqueue`（闲时没有排队按钮） |
| `chat.steer` | 现逻辑（需 active run；lease/conductor） |
| `chat.abort` | 现逻辑（dropSteer；nextRun 保留；CAS） |

`file.upload` / `chat.regenerate` occupied：本 PR **保持今日 supersede**（非 composer 文本路径）；spec 不把它们改成 steer。

### 2.2 Busy SoT

- **权威**：`abortControllers.has(threadId)`（含 nextRun drain 已 claim 的新 generation）。
- `chat.done` **不得**在 drain 前把 UI 标 idle。router 在 drain 递归 `chat.create` **完成 claim** 之后，若仍 occupied 则发 `run_status: llm`；队列空且 loop 结束才 `idle`。
- **Summoner `thread.select` 恢复带 `run_status: idle|llm`**（#218 对 summoner 省略的决定在本 PR 撤回）。`pending_tools` 仍省略。overlay 用它映射 submit，不是猜事件。
- Panel `SET_THREAD_BUSY` 继续听 `run_status` + 流式事件；Stop 后保持 busy 直到 `chat.aborted` / `idle`。

### 2.3 Side Panel

- **忙时解开 textarea**（今日 disabled 必须改）。附件按钮仍可关。
- 忙：主按钮「纠偏」= `chat.steer`；「排队」+ **Shift+Enter** = enqueue。Enter = steer。
- 闲：隐藏纠偏/排队；Enter = `chat.create`；Shift+Enter = **换行**（与现设置一致）。
- 若用户设置发送键为 Cmd/Ctrl+Enter：忙时该组合 = 纠偏；Shift+Enter 仍 = 排队；闲时行为不变。
- hint 忙：`回车纠偏 · Shift+Enter 排队`。
- 队列深度：`chat.enqueued` 带 `depth`（router 用 `peekNextRunCount`）。

### 2.4 悬浮窗

- `SummonerSubmitEvt` 加可选 `enqueue?: boolean`。Swift：忙时 Return → enqueue false；⇧Return → true。
- Node **禁止**再走 `sendChatCreate` 当 composer。映射进 router：`steer` | `enqueue` | `create`。
- submit **不** `claimLease`。无 overlay lease → `OVERLAY_STANDBY`（「侧栏占用了输入」）。
- `chat.enqueued` / `queue_full` / `steer_queue_full` / `run_active` / `idle_enqueue` 必须进 `summoner.error` 或专用 cmd（今日 mapper 只认 `chat.error`）。
- 左栏 / pack / submit **只走 handshake `surface:summoner` 的 WS**，禁止 overlay 用 tray client 调 `pack.apply`（tray 仍是旧的 panel 级 Trust 路径）。
- `summoner.continue`：闲 = 今日 `chat.create` CTA；忙 = no-op（不 create、不 supersede）。
- TOCTOU：busy 判断与发送同在 router 一拍，不在 Swift 先看一眼再发。
- enqueue 成功不要乐观插入 `你:`（那会像已发送）；steer 用已有 `chat.user` echo，overlay 行可标 `纠偏:`。

---

## 3. PR2 — macOS 左栏（T2）

窗口 **加宽**：默认宽 ≥ 640pt（左栏 200 + 捕获 ≥ 420）。不挤死 composer。

左栏常驻：

1. 对话：`thread.list` + `#` 标题搜 + 新建。
2. MCP：**已连接**只读芯片（不是「管理」）。无 add。
3. 场景：见 §4。非 eligible 灰 +「去侧栏确认」。

文案诚实：套 Pack =「技能/提示套到当前对话」；不声称打开会议工作台或 Windows 也有本窗。

---

## 4. Pack apply（服务端强制，不靠 UI 灰）

Router `stampedSurface === "summoner"` 时：

- `allowTrust` **恒 false**（`allowTrust = surface !== "summoner"`）。无视 `rest.allowTrust` / 仅靠 `user_gesture`。
- 拒绝：`workspace_path`、`force_takeover`、`confirmation_phrase` 非空。
- **`isOverlayEligiblePack(manifest)` 失败 → 404/error `pack_not_overlay_eligible`**（不是只灰按钮）。
- 线程已有 `mission_pack_trust_snapshot` → refuse `pack_trust_cookie_present`（避免 S46 cookie 孤儿：allowTrust false 会清 snapshot 而不 restore globals）。
- 直播 LLM loop 期间：只允许改 skills/prompt/knowledge；**禁止改 `tool_whitelist`**（否则 live `isToolAllowed` 与 offer 快照分叉）。whitelist 变更留给 idle apply 或下一轮。

Eligible 当且仅当：

- 无 `trust:` 块
- 无 `min_capability: enterprise`、无 `mcp_servers` 要求、无 `board_mode: true`
- whitelist 空或仅 L0/companion 安全工具（无 navigate/evaluate/click/host/computer/shell/netsec/acp_*/workspace_*）
- pack id 不以 `appsec`/`netsec`/`shell`/`coding-handoff` 为前缀

`pack.list` 给每条加 `overlay_eligible: boolean`（overlay 用来灰按钮；**拒绝仍以 router 为准**）。

ACL 只加 `pack.list`、`pack.apply`。`user_gesture: true` 仍要（防 LLM 自 apply）。

---

## 5. 测试

PR1：occupied `chat.create` 无 enqueue → `run_active` 且 controller 仍在；enqueue/steer 测保持；idle enqueue → `idle_enqueue`；InputArea 忙时可输入；Shift+Enter 忙=enqueue 闲=换行；overlay submit enqueue 位。

PR2：summoner `allowTrust:true` 仍不写 Trust；eligible 函数单测（meeting ok，appsec/coding-handoff/navigate 否）；cookie 线程 refuse；ACL mcp.add deny。

闸门 T2，不 auto-merge。对抗查：supersede 洞、Trust 单调、eligible 服务端拒绝。

---

## 6. 决策（grill + 对抗吸收）

1. 两 PR 连做；骨架各表面自绘。
2. **忙时默认 steer**（用户锁）。产品对抗要求改 enqueue——**不改**；改为解开输入 + 服务端禁 supersede。
3. Shift+Enter：忙=排队，闲=换行。
4. 左栏 200pt，窗口加宽，不压缩捕获区。
5. Trust：surface 强制 false；eligible 服务端拒绝；有 trust cookie 则拒绝 overlay apply。
6. MCP 只读「已连接」。会议工作台 ≠ pack composition。
7. occupied 无 enqueue 的 `chat.create` **reject**。

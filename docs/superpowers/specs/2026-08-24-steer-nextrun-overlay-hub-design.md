# steer/nextRun UI + 悬浮窗 L0 工作台

> **日期**: 2026-08-24  
> **状态**: Design (awaiting user spec review)  
> **分支**: `feat/steer-nextrun-overlay-hub`  
> **触发**: harness-v2 remainder 已合 main（#218）；Companion 有 `chat.steer` / `enqueue`，UI 仍把第二次发送当 supersede；召唤器捕获窗只有明文转录。  
> **相关**: #218 · ADR-014 Pack · ADR-020 · summoner ACL（S21）· composer.lease（S20）  
> **能力坐标**:
>
> ```text
> Surface:      L0 (composer send semantics + overlay chrome)
> L2-classes:   (none) — overlay still not an Allow/Deny surface
> Compose:      pack.apply from overlay with allowTrust:false only
> Autonomy:     single-thread steer / nextRun (already in companion)
> Trust:        monotonic — overlay MUST NOT write Trust B
> Channel:      summoner ACL expand pack.list + pack.apply; mcp.add stays denied
> ```

---

## 0. 问题陈述

| 用户感受 | 系统实际 |
|----------|----------|
| 进行中再说话 = 打断重来 | `chat.create` 在忙时 **supersede**（换 AbortController） |
| 想说「别点那个 / 先测再改」 | Companion 已有 `chat.steer`，没有任何表面发送 |
| 想把下一句排到这轮结束 | Companion 已有 `enqueue:true` nextRun，UI 没有 |
| 悬浮窗太简陋 | Swift 捕获窗：明文 `你:`/`助手:`、`#` 搜标题、MCP 名字条；对话/场景/MCP 管理都在 Side Panel |
| 会议纪要不必开 Chrome | Pack apply 被锁成 Side Panel `user_gesture` + 默认可 `allowTrust` |

**目标一句话**：忙时说话是**纠偏**而不是杀掉当前轮；悬浮窗能管**对话 / 已连接 MCP / L0 场景**，且**不能**在捕获窗里升 Trust 或点 Allow/Deny。

---

## 1. 非目标

- Continue / Abandon 按钮、persist `running=true`、confirm 快照、originWs 重绑
- 渗透测试 / AppSec / 任何以 L1 网页或 L2 宿主为主的 Pack 在 overlay 一键套用
- overlay 渲染 Allow/Deny（现锁不变）
- overlay `mcp.add` / `mcp.remove` / `config.set`
- Windows/Linux 召唤器壳（systray2 overlay 仍 no-op）；PR1 的 Side Panel 行为两边都有
- 把 overlay 改成 WKWebView / 共享 React 壳（可另开第三刀）
- 恢复「忙时第二次发送 = supersede」。Stop 后再发才是新一轮 `chat.create`

---

## 2. 切分（两个 PR，连做）

### PR1 — 发送语义（T2）

Busy + 有正文：

| 动作 | 协议 |
|------|------|
| Enter / 主按钮「纠偏」 | `chat.steer` |
| 「排队」按钮 / Shift+Enter | `chat.create` + `enqueue: true` |
| Stop | `chat.abort`（丢未消费 steer；nextRun 保留） |
| 空闲 Enter | 现有 `chat.create`（不 enqueue） |

文案（Side Panel + 悬浮窗 hint 对齐）：

- 忙：`回车纠偏 · Shift+Enter 排队`
- 主按钮忙时改称「纠偏」
- 旁一颗「排队」
- 成功排队：可见条数（cap 8）；`empty_steer` / `empty_enqueue` / `queue_full` / `OVERLAY_STANDBY` 用现有 error 字符串，UI 可读化
- steer 已由 companion `chat.user` echo 进转录，UI 不必再插假气泡

**Side Panel**：`InputArea` / composer 用 `threadBusy`（已有 `SET_THREAD_BUSY` ← `run_status`）。禁止再走 supersede `chat.create`。

**悬浮窗**：`summoner.submit` 在 companion 侧看该 thread 是否 LLM-busy（`abortControllers` / 与 panel 同一 SoT）。忙 → steer 或 enqueue（modifier）；闲 → `chat.create`。lease/conductor 失败原样返回，Swift 用 `summoner.error`。

### PR2 — macOS 悬浮窗左栏 L0 工作台（T2）

在现有捕获窗左侧加约 **200pt** 栏：

1. **对话** — `thread.list` 最近序；保留 `#` 只搜标题；新建 `thread.create` + lease.claim。
2. **MCP** — `mcp.list` 只读芯片（可复用已有 `summoner.mcp` 名字条，放进栏内）。无 add/删。
3. **场景** — `pack.list`；**overlay-eligible** 可一键 `pack.apply`（`user_gesture: true`，**服务端强制 `allowTrust: false`**，忽略客户端乱传）。非 eligible：灰、文案「去侧栏确认」。

Windows/Linux：本 PR 不画 overlay 壳。

---

## 3. Overlay-eligible Pack

列表仍展示全部已安装 Pack，但 **可点 apply 的**必须同时：

- pack.yaml **没有** `trust:` 块（有则「去侧栏」——写 Trust 只能 Side Panel `allowTrust: true`）
- `tool_whitelist`（若有）不含 L1 浏览器工具、host/computer、`shell_exec`、`netsec_*`
- 不把「渗透 / AppSec / 网页审查」类内置 Pack 标 eligible（即使 whitelist 空，只要 id/前缀约定是 appsec/netsec/shell 也灰掉）

会议纪要 Pack（L0 技能+提示）应 eligible。套用效果：当前线程 composition（skills / prompt append / knowledge），**不**改全局 Trust。

engine 已有 `allowTrust: false` → `pack.trust_skipped` 审计；overlay 路径必须走这条，且 router 在 `stampedSurface === "summoner"` 时 **无视** `allowTrust: true`。

---

## 4. ACL / 协议

Summoner allowlist **只加**：

- `pack.list`
- `pack.apply`（validate 仍要 `user_gesture: true`；router：summoner ⇒ `allowTrust` 强制 false）

**不加**：`mcp.add`、`pack.install`、`pack.unapply`（第一版不需要卸）、`config.*`、`security.confirmation.response`。

Swift stdin 增量（示意，实现时可合并）：

- out: `summoner.threads` / `summoner.packs` / 现有 `summoner.mcp`
- in: `summoner.pack.apply` `{ pack_id }`；submit 已有，busy 映射在 Node 不在 Swift

`pack.apply` 文案从「Side Panel only」改为「UI gesture only」——overlay 也是人点的，但 Trust 仍仅 panel。

---

## 5. 错误与边界

| 情况 | 行为 |
|------|------|
| 无正文 steer/enqueue | 不发送；validate/router `empty_steer` / `empty_enqueue` |
| nextRun 已 8 条 | `queue_full`，UI 提示稍后再排 |
| 闲时点排队 | **闲时隐藏**「纠偏」「排队」，只留发送。Shift+Enter 闲时 = 换行（Side Panel 现有）或忽略（悬浮窗单行） |
| overlay 无 lease | `OVERLAY_STANDBY`；提示「侧栏占用了输入」 |
| 跑着套 Pack | 允许 composition-only apply；不 abort 当前轮 |
| Stop | 与今日 abort 相同；nextRun 不在 abort 时自动开跑（#218 CAS） |

---

## 6. 测试与闸门

**PR1 MACHINE**

- companion：busy submit → `chat.steer`；Shift 路径 → `enqueue`；idle → `chat.create`；不调用 supersede
- extension：busy Enter 不 `chat.create`；点排队才 enqueue
- 现有 `empty_steer` / `queue_full` / lease 单测保持绿

**PR2 MACHINE**

- summoner-acl：`pack.list`/`pack.apply` ok；`mcp.add` 仍 deny
- router：summoner `pack.apply` 即使 `allowTrust: true` 也不写 Trust（审计 `allowTrust_false` / 无 trust snapshot）
- overlay-eligible 纯函数单测（有 trust 块 / 含 navigate → 不可 apply）

**对抗**

- PR1：二次发送不得 abort 当前轮；abort 丢 steer；nextRun 仍 generation-CAS
- PR2：Trust 单调；overlay 无 confirm 方言；非 eligible Pack 不能 apply

都不 auto-merge。T2：对抗 + Pi `APPROVE*` 后需人点 Merge。

---

## 7. 实现锚点（[inspected]）

- `companion/src/message-router.ts` — `chat.steer` / enqueue / `pack.apply` allowTrust
- `companion/src/ws/summoner-acl.ts` — allowlist
- `companion/src/summoner/client.ts` + tray `CompanionClient.sendChatCreate`
- `companion/src/tray/SummonerOverlay.swift` — 捕获窗 + 将加左栏
- `chrome-extension/src/sidepanel/` InputArea / App `canSend` / `SET_THREAD_BUSY`
- `companion/src/packs/pack-engine.ts` `allowTrust` 分支（已有 skip）

---

## 8. 决策记录（grill）

1. 两片都要，**两个 PR 连做**（先发送语义，再左栏）。
2. 忙时默认 **steer**；排队 = 按钮 + Shift+Enter。
3. 骨架 = **协议扩展 + 各表面自绘**（不改 WKWebView）。
4. 左栏常驻 ~200pt：对话 / MCP 只读 / 场景。
5. 场景 apply **不写全局 Trust**；需 Trust 的 Pack → 「去侧栏确认」。
6. 闸门 PR1/PR2 均为 **T2**（因 overlay apply 强制 `allowTrust: false`）。

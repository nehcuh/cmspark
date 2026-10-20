# ADR-025: ACP Coding Agent Client（编程接力 · Composition）

**日期**: 2026-08-13 | **状态**: Accepted（Phase A 交付 + Phase B 默认关；**静默写盘 / free shell** 仍 NO-GO；**gated apply** GO）  
**相关**: [ADR-020](020-capability-model-three-axes.md) · [ADR-022](022-outbound-mcp-server.md) · [产品设计](../decisions/acp-coding-handoff-product-design-2026-08-13.md) · [双审](../decisions/acp-coding-handoff-dual-review-synthesis-2026-08-13.md)

---

## 决策

### 1. 一句话

> CMspark Companion 作为 **ACP / 本机编程 Agent 的 Client（Composition）**：先交付 **任务包导出（Phase A）**；可选 **审查 / 起草会话（Phase B，`acp.enabled` 默认 false）**。  
> **不是** Side Panel IDE，**不是**第三 runtime，**不是** Outbound MCP 的反写。

### 2. 能力坐标

```text
Surface:      L0/L1 采证；写码不在 CMspark Surface 叙事内
L2-classes:   (none default); session start / apply_diff 走 L2 Confirm
Compose:      coding_handoff pack + acp client + task package export
Autonomy:     single-thread handoff; workers HARD_DENY acp_*
Trust:        HITL start+apply; originWs; untrusted handback + Q5-like taint; never auto_approve skip
Channel:      community Phase A default; Phase B opt-in; gated apply GO; free shell NO-GO
```

### 3. 锁定

| ID | 锁 |
|----|-----|
| **L1** | Phase A（复制任务包）可 default 可用；无 spawn |
| **L2** | Phase B `config.acp.enabled` 默认 **false** |
| **L3** | 默认模式 `review_readonly`（任务意图=审查）；`propose_diff` 需显选；`allow_exec` 永不 true |
| **L4** | `acp_propose_session` / `acp_start_session` / `acp_apply_diff` 强制 L2；cruise/god-mode **不可**静默跳过 |
| **L5** | Handback `<<<UNTRUSTED_ACP_HANDBACK>>>` + taint 至下一条用户消息 |
| **L6** | Worker / orchestrator 子线程 **禁止** 全部 `acp_*` |
| **L7** | 与 Outbound：子进程不注入 `CMSPARK_*` outbound tokens；无 `cmspark__acp_*` 导出 |
| **L8** | UI 会话模式 = 审查/起草，**不**声称 OS 沙箱只读 |
| **L9** | 无新 BottomBar Tab；设置「编程助手」+ `/code` |

### 4. 非目标

- 侧栏 multi-file apply / Zed 克隆  
- shell-in-agent / git push 经 ACP  
- 自动 spawn  
- 用 Computer Use 操作 TUI  

### 5. 实现落点

- `companion/src/acp/*`  
- tools: `acp_list_agents` · `acp_propose_session` · `acp_start_session` · `acp_collect_result` · `acp_cancel_session` · `acp_get_status` · `acp_apply_diff`  

- Extension: `coding-handoff/*` · `CodingTaskPackageModal` · meta slash  
- Pack: `coding-handoff`  

### 6. 后续 / 修订（2026-08-13 S72）

已在 `feat/coding-handoff` 落地增量（仍默认 `acp.enabled=false`）：

| 项 | 状态 |
|----|------|
| 路径探测 + adopt 持久化 | ✅ |
| 启动 argv presets（claude -p 等） | ✅ |
| 多轮 follow-up（新 session + 上文） | ✅ |
| Live FocusBand + handback 注入 | ✅ |
| **propose_diff** + **gated apply**（工作区 containment、L2 永不 cruise 跳过） | ✅ |
| 完整 Zed IDE / free shell / 静默写盘 | ❌ 仍 NO-GO |

Apply 路径：`acp.apply_diff` / tool `acp_apply_diff` — 仅应用会话内解析出的 pending_diffs，禁止路径逃逸。

### 7. 终端观测口径（#724，2026-10-19）

PTY 是用户本人交互的终端，不是自动 Agent 输出宿主。编程会话的内容面仍是 ACP JSON-RPC / CLI 桥的 `progress_tail` 与带 untrusted framing/taint 的 handback；Mode C 内嵌终端内容不会因终端打开或诊断计数自动进入主对话/模型。既有显式、绑定原任务且经人类确认的审阅报告导入是独立路径，不等于采集终端字节。

`terminal.opened.launch_kind` 只记录本机 shell 或 consumed embed descriptor 的启动来源；它不证明 Agent 登录、健康、就绪或任务完成。旧版本缺字段与失败时保持未知，不能从标签 URL、线程绑定或 CLI 名猜测。Mode C 的 Agent 由用户在终端驱动；停止侧栏监视与关闭终端进程沿用原边界。

诊断只记录首个有效输出帧的序号/字节数以及原 heartbeat 的有限计数、流控状态和单调输出年龄。不记录终端文本/base64/键击/粘贴、路径、Agent 名或环境，不新增 PTY→模型内容渠道、计时器、多 PTY 或授权能力。

### 8. bounded-N 与输出面修订（2026-10-19，GitHub #728）

本节是设计决策，**不表示运行时已支持并行**。当前实现仍以单一运行槽为基线；下列容量、映射和 UI 变化必须在后续实现票交付后才可对用户宣称。既有 #722 串行修复和 #724 输出观测可独立交付。

#### 8.1 Composition 容量，而非新增 Autonomy

ACP 是 ADR-020 的 Composition client。多个经逐次确认启动的外部会话不等于 worker 自动派发：L2、L4、L6、L7 全部不变，仍无第三 runtime、auto-spawn 或隐式 workspace 继承。worker/orchestrator 子线程仍禁止全部 `acp_*`；只能由获准的主线程逐会话提案、确认、启动。

未来配置 `acp.max_concurrent_sessions` 默认 **1**，允许整数 **1..4**；非法值拒绝，不自动夹取或提高。全安装活跃计数包含启动准备、运行和尚未真实退出的取消/关闭过程。每次新启动准入须使准入后的全安装活跃数与同线程活跃数均 ≤ 当前 N；同 agent 全安装始终 ≤ 1。调整配置不会终止现存会话；降额时允许已占用槽位的存量暂时超过新 N，但不忘记或释放这些占位，直到存量自然退出、活跃数低于新 N 才能再次准入。稳态及每次成功的新准入均满足上限，降额过渡不被误报为新准入成功。不增加独立每线程/每 agent 配置旋钮。

`offered` 和待人类确认不代表进程运行，也不占用执行计数。提案按 `(thread_id, agent_id)` 去重：同组合仅一个非终态提案/会话；一线程最多 **4** 个未终态提案，全安装最多 **16** 个未终态提案。超限返回有限 typed recoverable 拒绝，不删旧提案、不制造成功。旧提案的超时/取消回收必须受测试约束；持久化或重启恢复不得凭旧提案自动启动。

执行槽在实际 spawn 前同步保留，不得在检查与占位之间 await。正常完成、取消、准备失败和关闭都必须按同一占位归属释放；发送取消或收到 UI ACK 不代表进程已退出。不可为了并行删掉 #607 防重叠控制：应将其发展为每次新准入后 `active <= 当前 N`、降额过渡无新准入、默认 N=1 不重叠、同 agent 不重叠及真实退出后才复用的断言。

#### 8.2 逐会话 HITL 与失败隔离

每次 propose/start/apply 仍分别强制 L2，cruise/god-mode/场景三旗都不豁免。容量不足要在呈现启动确认前明确显示 holder/已占槽位和可用动作；跨线程 holder 只给固定摘要，不披露 workspace、goal、终端内容或凭据。若确认期间容量变化，最终启动仍重新核验，不执行、不丢掉已确认会话，返回明确带码失败并保留可见状态；用户必须重新发起启动，不自动排队或重试。批准是一次请求的同意，不能变成未来自动启动许可。

本次设计**不采用批量 propose/start API 或后台队列**。未来如需批量，须另建实现/设计票且确认台逐项展示 agent/mode/workspace/goal；不可复用一张确认替多个 agent 授权。一路失败/取消仅影响该会话及其占位，不中止其它已获准会话或整轮 tool loop。AUTH/OWNER/security 硬拒绝不因本节被降级。

每个 handback 保留原 session/agent/thread 归属及 `<<<UNTRUSTED_ACP_HANDBACK>>>` 包裹。多路材料分别保留来源、失败/缺失状态和原 taint；不得拼接成无来源的可信指令，也不得用一路成功清除另一份 taint。沿用原“至下一条用户消息”的清除边界，不添加自动 apply/push。

#### 8.3 PTY 是人机面，Agent 观测由协议提供

bridge 模式的 agent 输出来自 ACP JSON-RPC 或 CLI bridge 的有限 `progress_tail`/`collect_result`，不从 PTY 的屏幕字节推断工作进度。PTY 仍仅是人机交互面；本机 shell、embed agent 和未知来源必须诚实区分，打开终端不代表 agent 已启动或健康。

**多 PTY、多 embed、多终端 relay 不进入本次范围**。保留现有全局 PTY 单槽与单 relay；并行执行只适用于明确支持的 bridge 会话。任一 embed/本机 shell 占用必须沿原终端互斥拒绝，不自动抢占、关闭或复用别人的终端。#724 元数据观测和 #725 尾部内容安全评审分别承接相关缺口；本 ADR 不批准将终端正文注入模型。

#### 8.4 UI 承载与迁移

未来以 thread→session-id 有序集合替代单值 `codingSessionIdByThread`，并独立保存一个“当前查看的会话”选择。它是 UI 选择，不是运行或授权事实；后端会话状态仍权威。旧单值只迁移为一元素集合；切线程、迟到回执和 A→B→A 均不得偷换当前会话。

FocusBand 保留一个 coding chip，显示待启动/运行数量与当前选中会话；不按 agent 新增常驻入口。点击 chip 或既有“更多”进入同一面板，会话列表使用现有区域和滚动，`offered`/待批准/准备中/运行中/完成/失败/已中断分别诚实呈现。320px、输入区、顶栏、BottomBar、ThreadBar、FocusBand 密度预算按现有 S96 账验收，不扩大组件高度掩盖问题。#727 可先交付当前单会话入口可发现性。

#### 8.5 后续实现与未交付清单

- #722：当前默认单槽的忙碌反馈、诚实入口与提案生命周期；多 offered 的实现须引用 §8.1/7.2，不能借此声称 N>1 已可用。
- #724/#725：分别为元数据观测与终端内容安全边界，引用 §8.3；未通过 #725 安全评审不实现 terminal_tail_read。
- #732：历史会话只读恢复/已中断标记，引用 §8.1/7.4；不得复活进程或授权。
- 真正 bounded-N bridge 执行与多会话 UI 另建实现 Issue，逐项引用 §8.1–7.4，先有限失败反例和并发/归属/迟到回执控制，再实现；不把本 ADR 的合入当作运行时交付。

本节不改变 Surface、坐标注入 L2、app/enterprise 白名单、shell 权限或主模型配置。版本保持开发版0.6.14；不发布版本、不新增默认权限。

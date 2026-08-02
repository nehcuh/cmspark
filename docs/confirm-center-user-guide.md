# 确认台（Confirm Center）使用说明

> **面向使用者**：解释 Side Panel 上的「确认台 / 操控台」是什么、何时用、与其它确认层有何区别。  
> **设计依据**：[UI 三模式 redesign](superpowers/specs/2026-07-26-ui-three-mode-redesign.md) · [ADR-015](adr/015-multi-agent-orchestrator-tab-lock.md) · [安全分层](security-design-tiered-gates-2026-07-11.md)  
> **相关能力**：[任务包 / NetSec](mission-pack-usage.md) · [Computer Use](computer-use-user-guide.md) · [Multi-Agent](multi-agent-user-guide.md)

### 能力坐标

| 轴 | 本指南位置 |
|----|------------|
| **Surface** | **横切全部作用面**的信任 UI：L0 基本不碰；**L1** 高危浏览器 tool / 导航域确认；**L2** 桌面 CU、host、shell/netsec 等强制人机审批 |
| **Composition** | 不装配能力；Pack **不能**用确认台绕过或关闭全局门禁 |
| **Autonomy** | 多 worker 时 FleetStrip 汇总待确认；spawn 等仍走同一确认台 |
| **规范** | [ADR-020 能力三轴](adr/020-capability-model-three-axes.md) · 模式徽章 L0/L1/L2 = UI `聊` / `网页` / `计算机` |

---

## 1. 一句话

**确认台不是日常聊天窗口**，而是：

1. **高危操作的人机审批台**（Agent 要执行危险 tool 之前，必须你点允许）；  
2. **Computer Use（桌面 L2）的宽屏操控台**（步骤轨、急停、完整预览）。

普通 **L0 聊**（问答、写文案、不触发高危工具）时，**不必**打开确认台。侧栏模式徽章升到 **网页 / 计算机** 且出现红条或 FleetStrip 提示时，再打开即可。

---

## 2. 术语对照（UI 上名字不统一时看这里）

| 你在界面上看到的 | 文档 / 代码里常写 | 是什么 |
|------------------|-------------------|--------|
| **确认台** | Confirm Center / Cockpit 入口 | FleetStrip、红条、SafetyStrip 上的按钮，**打开**宽窗 |
| **操控台** | 旧文案 / 同义 | 与「确认台」同一扇窗（`tabs/cockpit.html`，约 720×560） |
| 空确认台说明 | Cockpit emptyGuide | 无待确认且无进行中 CU 时显示用途说明 + 文档路径 |
| **L2 安全确认 / L2** | L2 confirm gate | Companion 在执行前挂起的那条「等人批准」队列项 |
| 侧栏红色确认条 | MinimalConfirm / SafetyStrip | **窄栏**上的快速允许 / 拒绝 |
| 宽窗顶部「确认抬升」 | ConfirmElevated | **完整**预览、确认码、白名单等 |

**约定：** 下文统一用 **确认台** 指「这套确认 + Cockpit 体验」；按钮文案可能是「确认台」或「操控台」，打开的是同一扇窗。

---

## 3. 两层界面怎么配合

```
Agent 要跑高危 tool
        │
        ▼
Companion 发出 security.confirmation.request（约 45s 超时）
        │
        ├─► Side Panel：红色精简条
        │     · 允许 / 拒绝 / 拒绝并停止
        │     · 需要确认码时：侧栏不能批，提示去确认台
        │
        └─► 确认台（Cockpit 宽窗）
              · 完整预览 / 确认码 / 加白名单
              · Computer Use 步骤轨 + 急停
              · 多 Agent 时显示 worker / tab / run
```

| 操作 | 侧栏精简条 | 确认台宽窗 |
|------|------------|------------|
| 看工具名与风险色 | ✅ | ✅ |
| 允许 / 拒绝 / 拒绝并停止 | ✅ | ✅ |
| 完整命令 / 代码 / 长预览 | ❌（引导去宽窗） | ✅ |
| 输入确认码（nonce，不可粘贴） | ❌ 必须去宽窗 | ✅ |
| 加域名白名单等 | ❌ | ✅（适用时） |
| Computer Use 步骤与急停 | 部分（Chip + 急停） | ✅ 主界面 |

---

## 4. 什么时候会出现确认？

Companion 在下列工具**真正执行前**会排队确认（列表以代码 `L2_GATE_TOOLS` 等为准，随版本可能扩展）：

| 场景 | 工具示例 | 你在确认里大致看到 |
|------|----------|-------------------|
| 页内执行任意 JS | `evaluate` | 代码片段 + 风险 |
| 本机 Shell | `shell_exec` | 命令预览 |
| 端口扫描 | `netsec_port_scan` | 目标列表 |
| 桌面 / 应用操控 | `host_computer`、`host_app` | 任务与步骤（常自动聚焦确认台） |
| 本机读/写文件 | `host_read`、`host_write` | 路径与操作 |
| AppleScript | `osascript_eval` | 表达式 |
| 拉起多 Agent Worker | `spawn_worker` | role / pack / allow 摘要 |
| 编排者是非题 | `ask_user` | 问题；允许≈是，拒绝≈否 |
| MissionBoard 收工 | `board_complete` | 目标摘要 / 风险 / empty_complete |

**设计原则：** 模型参数里的 `user_confirmed` **不被信任**；必须你在 UI 上点（或超时自动拒绝）。

---

## 5. 和「配置类授权」不是同一件事

很多人会觉得「已经开了能力 / 加了 IP，为什么还要确认」——因为闸门是**分层**的：

| 层级 | 例子 | 含义 | 在哪里做 |
|------|------|------|----------|
| **能力 opt-in** | `capability_profile=enterprise`、启用 `netsec` / `shell` | 本机**允许这类能力** | 配置 / 任务包面板 |
| **范围 / 归属** | NetSec `target_allowlist`、**任务授权**（按线程） | **允许扫谁** + **本线程声明有权测** | 任务包 · NetSec 卡片（或 config） |
| **本次执行 L2** | 确认台 / 侧栏红条 | **这一枪真的执行** | 确认台 / 精简条 |
| **L2 如何跳过（可选）** | **Plan A** 本线程企业信任；**Plan B** `auto_approve_enterprise_tools` | 范围内自动批准 shell/netsec L2（审计） | 红条勾选 / 设置→安全 |

- 配置与任务授权：**偏「我允许这类事 / 这些目标」**。  
- 确认台 L2：**偏「这一次我同意 Agent 现在就做」**（防 prompt 注入静默扩权）。  
- **A/B 不是** allowlist 的替代；空名单仍全拒。**协议解锁**（原 God-mode）/「自动批准危险操作」**单独**仍不会跳过 shell/netsec。长程少确认请用设置 → **运行自主度**（全自动巡航可合成企业 Plan B）。

NetSec 完整路径示例见 [mission-pack-usage.md §5](mission-pack-usage.md#5-开启-netsec端口探测)。

---

## 6. 推荐使用方式

### 6.1 有待确认时

1. 看侧栏红条：工具名、风险、是否来自某 **worker**。  
2. 内容清楚 → 直接 **允许** 或 **拒绝**。  
3. 要看全预览、要输确认码、或 Computer Use 进行中 → 点 **确认台 / 详情 / 操控台**。  
4. 危险且想立刻停住该 worker/线程 → **拒绝并停止**。

### 6.2 没有待确认时

- 确认台可以**不打开**；若打开了，空窗表示「当前无待确认 / 无进行中的桌面任务」。  
- **不要**为了「配置 IP / 开模块」去确认台——那是 **任务包** / 设置。

### 6.3 Computer Use（桌面）

- 任务开始或 `host_*` 确认时，扩展往往会 **自动打开/聚焦** 确认台。  
- 侧栏保留 **急停**；宽窗是主指挥面（步骤 + 指令输入）。  
- **关闭确认台 ≠ 停止任务**；任务继续跑，侧栏 Chip 可再打开宽窗。要停请用 **急停** 或 **拒绝并停止**。

### 6.4 多 Agent（舰队）

- FleetStrip 上的 **确认台** 同样打开 Cockpit。  
- Spawn worker **必须**过确认（无 auto-spawn）。  
- 看清条上的 `worker` / `tab` / `run`，避免批错人。  
- **全停**（stop-all）与单次确认互补：全停清舰队；确认管单次高危动作。

---

## 7. 超时与失败时你会看到什么

| 现象 | 含义 | 建议 |
|------|------|------|
| 确认消失且 tool 失败 / 超时 | 约 45s 未处理（或未聚焦策略下的自动拒绝） | 重试操作；待确认时优先处理红条 |
| 侧栏「请在操控台输入确认码」 | 该条带 nonce，**侧栏无法允许** | 打开确认台，**手动输入**确认码（不可粘贴） |
| 已任务授权仍扫不了 | 缺 L2 批准，或目标不在授权/allowlist | 先批 L2；核对 [mission-pack-usage](mission-pack-usage.md) |
| 关了确认台任务还在跑 | 设计如此（关窗不停任务） | 用急停 / 拒绝并停止 |

更多排错见 [TROUBLESHOOTING.md](TROUBLESHOOTING.md#确认台--l2-安全确认)。

---

## 8. 明确非目标（避免误解）

确认台 **不是**：

- 日常聊天主界面（主对话仍在 Side Panel）  
- NetSec IP 配置页（任务包）  
- 模块开关 / enterprise 档位设置  
- 关闭即「全部安全」（后台任务与队列规则以 Companion 为准）

---

## 9. 给实现者 / 评审的指针（用户可跳过）

| 主题 | 文档 |
|------|------|
| 能力三轴 / Trust 横切 | [ADR-020](adr/020-capability-model-three-axes.md) |
| Panel vs Cockpit 内容切分 | [ui-three-mode-redesign §5](superpowers/specs/2026-07-26-ui-three-mode-redesign.md) |
| 多 Agent Confirm Center 契约 | [ADR-015](adr/015-multi-agent-orchestrator-tab-lock.md) |
| board_complete 与确认 | [ADR-016](adr/016-mission-board.md) |
| 确认队列实现 | `companion/src/security-confirmation.ts` |
| 侧栏 / 宽窗 UI | `MinimalConfirm.tsx` · `CockpitApp.tsx` · `FleetStrip.tsx` |

---

*文档版本：2026-07-29 · 对齐 ADR-020 · 与 UI 文案「确认台 / 操控台」混用现状一致；后续若统一按钮文案，请同步改 §2。*

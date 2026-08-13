# 编程接力（ACP / 本机编程 Agent）产品设计合成

> **日期**: 2026-08-13  
> **状态**: Design synthesis · **Pi+Claude dual-review APPROVE_WITH_NITS**（`20260813-084345`）· nits 已并入 · **§5.7 UX Consistency Contract** 为实现/PR 硬附件  
> **触发**: 讨论「效仿 Zed ACP 连接本机编程 Agent，在代码场景委派评审/编写」  
> **方法**: 5 路独立 plan agent（JTBD / Trust 对抗 / 反膨胀 / UX / 架构）→ 主编综合 → 双路外部复审  
> **双审合成**: [acp-coding-handoff-dual-review-synthesis-2026-08-13.md](acp-coding-handoff-dual-review-synthesis-2026-08-13.md)  
> **相关**: [ADR-020](../adr/020-capability-model-three-axes.md) · [ADR-022](../adr/022-outbound-mcp-server.md) · [host-and-apps.md](../host-and-apps.md) · [mission-pack-usage.md](../mission-pack-usage.md)

---

## 0. 一句话结论

| 问题 | 结论 |
|------|------|
| 方向对不对？ | **对**：浏览器证据 → 本机写码的 **接力（handoff）** 是真 JTBD |
| 要不要做「Side Panel 版 Zed」？ | **不要**（320px 不是 IDE；Zed envy 必半残） |
| 要不要一上来上全量 ACP Client？ | **不要**；先 **薄接力**，再 **只读 ACP**，写盘最后且强门 |
| 和 Outbound MCP 什么关系？ | **对称双门面**，主叙事勿混：他们租我们的浏览器 ↔ 我们外派他们的写码 |
| 产品默认票 | **SHIP_THIN 优先；全量 ACP = 条件解锁；静默自动写盘 = 永久 NO-GO**；**gated apply（HITL + 工作区 containment）= GO（S72 / ADR-025）** |

**产品主名（中文）**：**编程接力**  
**按钮**：「派给终端助手」/「交给编程助手」  
**禁止对外说**：中层 Agent、第二 runtime、ACP 面板、内置 Claude Code

---

## 1. 五路对抗摘要

| 路 | 核心立场 | 关键交付 |
|----|----------|----------|
| **JTBD** | 只做「页上已有真相 → 本地代码动作」；冷启动写 monorepo 直接 kill | Hero: staging/SSO bug；次: PR 页审查；再次: AppSec 发现落地 |
| **Trust** | 审查/起草 + **gated apply** = GO-WITH-GATES；**静默**写盘 / free shell / auto-spawn = NO-GO | 输出不可信 + Q5 taint；禁 Outbound↔ACP 循环；审计全表 |
| **反膨胀** | 默认 **DEFER** 全协议 Client；优先 Outbound + 导出式 Prompt Chain | 命名「编程接力」；禁底栏新 Tab；4 周薄切片标准 |
| **UX** | Hybrid：意图 Offer + 永远人工 Confirm；Chip 不刷屏；diff 外开 | `/code` · FocusBand CodingSessionChip · Handback 卡 |
| **架构** | `companion/src/acp/` 作 Composition client；镜像 MCP 配置 + spawn_worker 确认 | Phase 0 单 Agent 只读 review；非 default-on |

**冲突与仲裁**（本合成采用）：

1. **反膨胀 DEFER vs 架构 Phase 0** → 仲裁为 **两阶段门**：先无协议薄切片证伪需求；过线再开 ACP 只读 spike。  
2. **JTBD 要「修」vs Trust 禁写** → v1 对外能力叫 **审查 / 起草修改（propose）**；真正落盘默认在 **外部 Agent 进程内由用户既有习惯完成**，或后期 Companion apply + 生物识别。  
3. **UX 可写模式 vs Trust Never apply** → UI 可展示 Agent「已写盘」状态，但 CMspark **不**提供静默 apply；「接受」= 标记采纳，「拒绝」= 回滚指引 / git。

---

## 2. 用户从哪来、要什么（只保留会天天用的）

### 2.1 唯一 Hero（Force rank #1）

> **已登录预览 / staging / 内网页上的缺陷 → 打包证据 → 外派本机编程助手处理仓库 → 摘要回对话 →（可选）L1 再点一次验收。**

### 2.2 Keep / Kill

| Keep | 为什么是 CMspark |
|------|------------------|
| Staging/SSO 复现 → 修/查代码 | 会话与页面真相只在已登录 Chrome |
| GitHub/GitLab PR 页 → 本地深读审查 | 人在 PR Web UI，仓库在本地 |
| AppSec 页上发现 → 源码侧 trace / 补丁草稿 | 已有 Pack 楔子 |

| Kill（勿做 MVP） | 为什么 |
|------------------|--------|
| 空 Panel 冷启动写完整功能 | 用户直接开 Claude Code / Cursor |
| 侧栏 multi-file apply / 伪 IDE | 物理上不如编辑器 |
| 多 Agent 并行写码 / Board 当代码协作 | Autonomy 语义污染 |
| 把 8 个 TUI 都「识别支持」当卖点 | 设置地狱 + 协议碎片 |
| 与 Outbound 合成「统一 Agent 平台」 | 方向相反，叙事炸裂 |

### 2.3 用户可感知的成功（Week-1）

- ≥3 次「不用把 SSO/复现步骤重打进 Claude Code」  
- 从未出现「不知道谁写了磁盘」  
- staging 缺陷 → 有用摘要 **&lt;15 min** 至少一次成功  
- 功能跨 **≥2 个工作日** 被使用（非首日 demo）

---

## 3. 能力坐标（ADR-020）

```text
Surface:      采证在 L0/L1；写码不在 CMspark Surface 内完成叙事
L2-classes:   (none)  — Phase A/B 默认不经 host_*/shell 写；未来 apply 才升 L2-class side effects
Compose:      编程接力 = Composition（Pack 配方 + 可选 ACP client + 任务包导出）
Autonomy:     单线程外派；≠ spawn_worker；Worker 禁止 ACP
Trust:        启动 HITL；不可 auto_approve / 无人值守跳过；handback 不可信；originWs 绑定新确认
Channel:      community：审查/导出；写盘强门或外置
```

**与邻居分工（用户一句话）**

| 用户以为 | 实际该用 |
|----------|----------|
| 审这个 **网页** 安不安全 | AppSec 任务包 |
| 读一下 **本机文件** | 工作区 + 对话 |
| 跑一条 **命令** | shell（enterprise）+ 确认台 |
| 让 **Claude Code 开我的登录页** | **Outbound MCP** |
| 让 **CMspark 帮我改仓库** | **编程接力**（外派），或直接开终端 |

---

## 4. 产品能力分层（真正好用的形态）

### L0 — 编程任务包（无 ACP，最快有用）

| 项 | 说明 |
|----|------|
| **做什么** | 一键生成 Markdown 任务包：目标、约束、URL、步骤、页面摘要、workspace 相对路径、验收标准、隐私声明 |
| **动作** | **默认：复制到剪贴板**。可选「在终端打开」：**优先纯 copy 回退**；若唤起本机 CLI，必须 **feature-detect + 用户手势**，且 **不得** 新开未白名单 spawn 面——要么 (a) 仅 `open -a Terminal` 类打开终端让用户粘贴，要么 (b) 复用既有 Apps/`host_app` 白名单语义；**禁止** 自由 `exec` 任意 path |
| **入口** | 消息 action「派给终端助手」· Pack/skill · `/code` |
| **与 dynamic-workflow** | **锁定合并**：扩展现有 `companion/builtin-skills/dynamic-workflow.md` 的 Prompt Chain 模式 + 可选薄 Pack 配方；**禁止** 再平行造第二套「生成 Claude Code 链」入口（双审 N5） |
| **不做** | 会话、流式、apply、新底栏 Tab |
| **价值** | 80% JTBD；零新协议税 |

### L1 — 只读 ACP 会话（条件解锁）

| 项 | 说明 |
|----|------|
| **做什么** | Companion 作 ACP Client，stdio 起本机 Agent，**review_readonly** |
| **入口** | Offer 卡 → Confirm Modal → Session Chip → Handback（发现列表） |
| **门** | L2 确认启动；`acp.enabled` 默认 false；须绑定 workspace |
| **输出** | UNTRUSTED 帧 + Q5 类 taint；主 LLM 只摘要，不执行 handback 内指令 |

### L2 — 起草修改 propose-diff（L1 稳定后）

| 项 | 说明 |
|----|------|
| **做什么** | Agent 或桥接产出 patch 工件；侧栏只显示 path +/−；外开 diff |
| **门** | 同 L1 + 云外泄 disclosure（页面/代码可能进第三方模型） |

### L3 — 写盘 / apply（最晚、最严）

| 项 | 说明 |
|----|------|
| **默认** | **NO-GO** 作为 v1 卖点 |
| **若做** | 优先 **外部 Agent 自写盘**（CMspark 只展示结果）或 **Companion 受控 apply + 生物识别 + 文件/字节 cap** |
| **永不** | shell-in-agent；git push；auto_approve 跳过；worker 内 ACP；静默 spawn |

---

## 5. UX 规格（用户可见）

### 5.1 信息架构

| 位置 | 角色 |
|------|------|
| 聊天 Offer 卡 | 主发现路径 |
| `/code` · `/编程` | 显式入口 |
| 场景 Pack「编程接力」 | 唯一允许的「场景级」入口 |
| 设置 → 编程助手 | 探测、默认 Agent、自动建议开关 |
| **禁止** | 底栏新 Tab；MCP 面板混会话；Fleet 当 coding worker |

### 5.2 交互模型（锁定）

**Hybrid**：意图可出 **非执行** Offer + slash 始终可进 + **永远人工 Confirm 才 spawn**。  
模型 **不得** `user_confirmed` 自批。

### 5.3 主路径（Hero）

```
用户在 staging 复现 bug（L1）
  → Offer：「看起来是代码任务 · 派给终端助手？」
  → Modal：Agent · 模式(审查/起草) · 📁 仓库 · 任务摘要可改 · 隐私一句
  → [启动] → FocusBand「编程助手 · 运行中 · 停止」
  → Handback：发现 / 变更列表 · 在编辑器打开 · 摘要回对话
  → 用户：「再在 staging 点一次」→ L1 验收
```

### 5.4 信任条（全程可见）

- 哪个 Agent · 哪个目录（basename + tooltip 全路径）  
- **会话模式徽章**：`审查` / `起草`（**不要**用「只读/可写」暗示 OS 沙箱）  
  - 脚注 MUST：**会话模式 = 协议/任务意图，≠ 外部进程权限担保**；外部 Agent 作为独立进程仍可能写盘；CMspark v1 不承诺沙箱隔离  
  - Week-1 成功标准「不知道谁写了磁盘」依赖此诚实文案，而非假保证  
- 「本机进程 · 可能调用该 Agent 的云模型」  
- 停止文案用 **停止编程会话**（≠ 桌面急停）

### 5.5 Anti-spam

不显示 Offer：纯网页操作、用户刚拒绝 cooldown、mute 本对话、已有 live session、CU 运行中、负向意图「不要外部」。

### 5.6 关键微文案

| 时刻 | 中文 |
|------|------|
| Offer | 这类改代码任务更适合本机 Agent |
| CTA | 交给编程助手 / 派给终端助手 |
| 模式 | 仅审查 · 起草修改 |
| 隐私 | 页面摘要与仓库片段将交给本机编程 Agent（可能再上云） |
| 完成 | 完成 · 请在 IDE 继续细改 · 可用侧栏复验页面 |

完整 microcopy / 错误表见对抗 UX 路输出（实现时落 `coding-gate-copy.ts`）。

### 5.7 UX Consistency Contract（实现 / PR 硬附件）

> **目的**：保证「编程接力」挂在现有 **Precision Instrument Desk** 脊柱上，而不是外挂第二套 Agent UI。  
> **视觉 SoT**：[docs/DESIGN.md](../DESIGN.md) · `chrome-extension/src/sidepanel/ui/tokens.ts`  
> **确认 SoT**：[confirm-center-user-guide.md](../confirm-center-user-guide.md)  
> **本契约效力**：Phase A/B 实现 PR 与 dual-review 均须勾选本节 checklist；违反 **禁止项** → review **REJECT**（非 nit）。

#### 5.7.1 八条一致性宪法（门禁）

| # | 规则 | 违反时 |
|---|------|--------|
| C1 | **无**新 BottomBar 主 Tab（编程 / ACP / Agents） | REJECT |
| C2 | **无**独立「ACP 面板」；设置最多一节「编程助手」 | REJECT |
| C3 | 启动确认 = 既有 L2 / `SecurityConfirmationManager` 语法 + **`originWs`**（Phase B）；**禁止**第三套确认方言 | REJECT |
| C4 | 运行态 = FocusBand **单槽** + 流内 **一张** session/handback 卡；禁止全文 token 流灌气泡 | REJECT |
| C5 | 模式文案 = **审查 / 起草**；禁止用「只读」暗示 OS 沙箱 | REJECT |
| C6 | 主 CTA 禁用「允许」；停止 = **停止编程会话**（≠ 桌面 **急停**） | REJECT |
| C7 | Phase A **扩展** `dynamic-workflow` Prompt Chain；禁止第二套「生成 Claude 链」入口 | REJECT |
| C8 | Outbound MCP 与 编程接力 **帮助/设置文案分表**；禁止合成「统一 Agent 平台」 | REJECT |

#### 5.7.2 设计系统挂载（视觉一致）

| 维度 | 必须 | 禁止 |
|------|------|------|
| 颜色 | 仅 `tokens.*` / semantic roles（`surface.*` `text.*` `accent.*` `status.*`） | Material / 随意 hex（`#4A90D9` `#2563eb` `#F44336`…） |
| 字号 | 11 / 12 / 13 / 15（chrome） | 自造 14/16 体标题抢 StatusRail |
| 圆角 | `radiusSm/Md/Lg`；卡 md；FocusBand/elevated lg | 自造 10/20 圆角 |
| 图标 | SVG 工具栏 | emoji 作 chrome 图标 |
| 空状态 | `PanelBanner` + Chat empty 标尺；引导用 `textSecondary` | `alert()` / 仅英文 console |
| 主按钮 | `tokens.accent` 实心；危险用 `danger` | 紫蓝渐变 send 复刻 |
| 面板主题 | Side Panel **浅色** v2；深色仅 Cockpit / L2 Safety | 为接力单独做暗色主题 |

#### 5.7.3 组件对标表（禁止平行发明）

| 编程接力表面 | 对标现有 | 建议组件名（实现时） |
|--------------|----------|---------------------|
| 流内 Offer / 任务包卡 | ChatView tool/info 卡密度与左边线 | `CodingOfferCard` / `CodingTaskPackageCard` |
| 启动参数（Phase B） | `useModalDialog`；deny-first / Escape=取消 | `CodingSpawnModal` |
| 运行 Chip | `SafetyStrip` TaskChip / `RunBusyChip`；FocusBand 槽 | `CodingSessionChip` |
| 进度 / Handback 卡 | shell / computer tool card 单卡替换 | `CodingSessionCard` |
| 空 / 错 | `PanelBanner` + `gate-error-copy.ts` 风格 | `coding-gate-copy.ts` |
| Slash | `meta-slash.ts` 与 `/packs` `/mcp` 同级 | `/code` · `/编程` |
| 设置段 | UserEnv / MCP 列表探测布局 | Settings → 编程助手 |
| Diff（Phase B+） | **外开** Cockpit 宽窗或编辑器；侧栏仅 path +/− | `CodingDiffExternal` |

**FocusBand 优先级（扩展 `resolveFocusBandSlot`，不新开 band）：**

```text
Confirm (L2 队列 / MinimalConfirm)
  > CodingSession live（含「停止」）≈ L2 Safety 同级
  > Fleet
  > 其它长跑 tool
  > L1 context
```

- 急停 **永不** 被编程 Chip 埋住（CU 运行时编程 Offer 不显示，见 §5.5）。  
- FleetStrip **不**承载 coding worker；busy 仅 thread 列表小点 + 切入后显示。

#### 5.7.4 交互语义映射（用户零学习）

| 用户心智 | 已有产品行为 | 编程接力 |
|----------|--------------|----------|
| 外派前点头 | `spawn_worker` / `shell_exec` L2 | 启动 Modal / L2；模型不可 `user_confirmed` |
| 长跑可停 | shell / CU Chip | **停止编程会话** |
| 结果不可信 | host_cli Q5 · Board UNTRUSTED | Handback 帧 + taint |
| 场景边界 | Pack + 工作区条 | 未绑仓库先绑；真修仓库不静默默认沙箱 |
| 装配入口 | Composer 芯片 / `/` | `/code` · 装配 chip「编程」 |
| 危险「允许」 | evaluate / host 高危 | **不**用于接力主 CTA |

#### 5.7.5 信息架构锁定

| 允许入口 | 角色 |
|----------|------|
| 流内 Offer / 任务包卡 | 发现 + 主路径 |
| `/code` · `/编程` | 显式、可发现 |
| 消息 action「派给终端助手」 | 一键 |
| Pack / **扩展后的** dynamic-workflow | 场景级唯一心智 |
| 设置 → 编程助手 | 探测、默认、自动**建议**开关（非自动启动） |

| 禁止入口 | 原因 |
|----------|------|
| 底栏新 Tab | 稀释精密仪器台 hierarchy |
| MCP 面板混会话 | MCP = 工具组合；接力 ≠ server 列表 |
| Fleet / Board 当 coding 协作板 | Autonomy 语义污染 |
| Computer Use 点 VS Code/TUI 当主路径 | 错误 Surface |
| 设置「总是自动启动」 | 违反 HITL |

#### 5.7.6 文案锁（与 §5.4 / §5.6 一致）

| 键 | 标准中文 | 禁用 |
|----|----------|------|
| 产品名 | 编程接力 | 中层 Agent、第二 runtime、ACP 面板、内置 Claude Code |
| 主 CTA | 交给编程助手 / 派给终端助手 / 复制编程任务包 / 启动 | 允许、执行、批准全部 |
| 模式 | 审查 · 起草 | 只读（作沙箱义）、全自动写盘 |
| 模式脚注 | 会话模式 ≠ 外部进程权限担保；可能调用该 Agent 云模型 | 安全隔离写码、本地保证不外传（若实际上云） |
| 停止 | 停止编程会话 | 急停 |
| 完成 | 完成 · 请在 IDE 继续 · 可用侧栏复验 | 已在侧栏合并全部 diff |
| Outbound 对照 | 让本机编程 Agent 使用浏览器 → 见 Outbound MCP | 与接力混为一键 |

实现：所有用户可见句进 **`coding-gate-copy.ts`**（或 Phase A 的 `coding-handoff-copy.ts`），组件内禁止分叉硬编码。

#### 5.7.7 Phase A 线框清单（现在可实现）

**A0 — 入口（任选触发，结果同一卡）**

- [ ] 消息 action：派给终端助手  
- [ ] `/code` · `/编程`（无 Agent 探测时仍可打开任务包预览）  
- [ ] dynamic-workflow / Pack 路径产出**同一**任务包结构（禁止第二 UI）

**A1 — 任务包预览卡 / 轻量抽屉（~320px）**

```
┌─ 编程接力 · 任务包 ─────────────────┐
│ 📁 {workspace basename}  [更换工作区] │
│ 来源页 {title 截断} · {url 截断}      │
│                                      │
│ 任务摘要（可编辑 textarea）           │
│ ┌──────────────────────────────────┐ │
│ │ …                                │ │
│ └──────────────────────────────────┘ │
│ 附带 ☑ 对话摘要  ☑ URL  ☐ 页面摘录   │
│                                      │
│ ⚠ 将复制到剪贴板；写码在外部助手完成  │
│                                      │
│ [ 复制编程任务包 ]  [ 在终端打开? ]   │
│              次要：取消 / 关闭         │
└──────────────────────────────────────┘
```

- [ ] 主 CTA = **复制**（成功 toast：已复制，可粘贴到 Claude Code / …）  
- [ ] 「在终端打开」可选：失败 **静默降级为已复制** + 一句说明；scope 见 §4 L0  
- [ ] 无 workspace：主 CTA 变为 **选择工作区**（对标 SceneStatusBar）  
- [ ] 无运行 Chip、无 L2、无 session 状态机  

**A2 — 空状态**

| 条件 | 标题 | 主 CTA |
|------|------|--------|
| 未绑工作区 | 先绑定代码工作区 | 选择工作区 |
| 复制失败 | 无法写入剪贴板 | 重试 / 显示可全选文本 |
| CLI 唤起失败 | 已复制任务包 | 关闭（非错误恐吓） |

**A3 — Handback 粘贴（可选薄）**

- [ ] 折叠区：「贴回外部助手摘要 / PR 链接」→ 写入 thread 一条 user/system 注记  
- [ ] **不**解析 ACP stream  

**A4 — 设置（Phase A 最小）**

- [ ] 一节说明：编程接力是什么 + 链到 Outbound 对照表  
- [ ] 可选：默认是否展示消息 action  
- [ ] **无**「自动启动 Agent」开关  

**A5 — Phase A 走查（合并前人工 3 分钟）**

1. 已登录页对话 → 派给终端助手 → 复制 → 外部粘贴可懂  
2. 未绑工作区 → 被引导绑定，不写错盘叙事  
3. `/code` 与消息 action 同一预览结构  
4. 与侧栏 L2 evaluate 同时出现时：确认台仍优先（Phase A 无 Chip 冲突）  
5. 用户能口述：「写码的是外部助手，不是 CMspark」

#### 5.7.8 Phase B 线框清单（ADR 前冻结交互，禁止实现时发明）

**B0 状态机（与 §7 一致，UI 可见）**

```text
idle → offer_visible → confirm_pending → running → handback_ready
         → cancelled | failed | timeout | auth_expired | path_denied
```

同 thread **最多 1** live coding session。

**B1 — Offer 卡**

- [ ] 标题：编程助手  
- [ ] 建议 Agent · 会话模式(审查/起草) · 📁 folder  
- [ ] 主：交给编程助手 · 次：继续在侧栏 · 链：不再提示本对话  
- [ ] anti-spam §5.5；**不**倒计时自动启动  

**B2 — Spawn Modal（强制字段不可折叠掉）**

- [ ] Agent 名与可用性（不可用则禁用启动）  
- [ ] 模式：审查 / 起草（Phase B 默认可仅开放审查）  
- [ ] 工作区全路径 tooltip + basename  
- [ ] 任务摘要可编辑  
- [ ] 隐私 / 云模型一句 + disclosure（会话状态强制，§9 Q6）  
- [ ] 模式脚注：≠ 外部进程权限担保  
- [ ] 取消 / 启动；Escape = 取消；初始焦点 deny-first 友好  

**B3 — Running**

- [ ] FocusBand Chip：● 编程助手 · {agent} · 时长 · 📁 · 模式 · [停止] [详情]  
- [ ] 流内单卡：最近一行节流 ≥2s；禁止全文流  
- [ ] 停止 ≠ 急停文案  

**B4 — Handback**

- [ ] 替换运行卡；发现列表为主（审查模式）  
- [ ] 变更仅 path +/−；点行外开  
- [ ] 无侧栏 Monaco / 无静默 apply  

**B5 — 错误主文案键**（实现落 `coding-gate-copy.ts`）

`agent_not_found` · `agent_not_logged_in` · `auth_expired` · `workspace_unbound` · `path_denied` · `agent_crash` · `timeout` · `spawn_failed` · `session_busy` · `disclosure_required`

#### 5.7.9 PR Checklist（实现者自检 + dual-review）

**所有 Phase 的 PR**

- [ ] 未新增 BottomBar 主 Tab / MCP 会话混排 / Fleet coding worker  
- [ ] 颜色/字号/圆角仅 tokens  
- [ ] 用户可见文案在 copy 模块，符合 §5.7.6  
- [ ] 帮助或设置中有 Outbound vs 编程接力 **一行对照**  
- [ ] 能力声明含 Surface / Compose / Autonomy / Trust（ADR-020 checklist）

**Phase A PR 额外**

- [ ] §5.7.7 A0–A5 全部勾选或书面 defer（附理由）  
- [ ] dynamic-workflow **扩展**路径可指到代码/skill，无平行第二入口  
- [ ] CLI 唤起符合 §4 L0（copy 优先）  
- [ ] 无 `companion/src/acp` 生产路径  

**Phase B PR 额外**

- [ ] Accepted ACP ADR 链接  
- [ ] §5.7.8 B0–B5 + originWs + disclosure 会话强制  
- [ ] FocusBand 优先级测试或手工走查记录  
- [ ] Handback untrusted + taint  
- [ ] 数字需求门证据（§8 Phase B）  

**自动/半自动可检（建议 CI 或 review 脚本）**

```bash
# 示例：禁止新底栏 tab id（实现后按实际路径调整）
rg -n "id:\\s*['\"]coding|id:\\s*['\"]acp|编程助手" chrome-extension/src/sidepanel --glob '*BottomBar*' || true
# 禁止组件内旁路 hex（抽样）
rg -n "#[0-9A-Fa-f]{6}" chrome-extension/src/sidepanel/components/Coding*.tsx 2>/dev/null || true
```

#### 5.7.10 UX Ship slices（与实现分期对齐）

| Slice | 范围 | 对应能力 |
|-------|------|----------|
| **S0** | 文案模块 + `/code` + 任务包预览 + 复制 + 空状态 | Phase A |
| **S1** | 消息 action + dynamic-workflow 合并入口 + 设置说明 | Phase A |
| **S2** | （可选）终端打开 + handback 粘贴口 | Phase A |
| **S3** | Spawn Modal + Session Chip + 停止 | Phase B |
| **S4** | Handback 发现列表 + 外开 + Offer anti-spam | Phase B |
| **S5** | disclosure 会话 UX + 错误表打磨 | Phase B |

**顺序纪律：** 未完成 S0–S1 不得开 S3+。S3+ 不得早于 Accepted ADR。

#### 5.7.11 一致性验收（产品感）

合并后产品负责人或 reviewer 应能在 **5 分钟**内确认：

1. 窄栏里编程接力 **看起来像** shell 卡 / Pack 动作，而不像新 App。  
2. 用户不会把「急停」和「停止编程会话」搞混。  
3. 用户不会以为 CMspark **保证**了外部 Agent 只读。  
4. 用户能区分：Outbound = Agent 用浏览器；接力 = 浏览器外派写码。  
5. 确认台队列里 L2 evaluate 与（Phase B）编程启动 **不抢两套 UI 语言**。

---

## 6. 信任与对抗（必须写进实现）

### 6.1 策略矩阵（v1）

| 能力 | 判定 |
|------|------|
| UI 建议 Offer | GO（不执行） |
| 用户启动审查会话 | GO-WITH-GATES |
| propose-diff | GO-WITH-GATES |
| **gated apply**（pending_diffs + L2 + workspace realpath） | **GO**（ADR-025 S72；非静默） |
| 静默写盘 / free shell / shell-in-agent | **NO-GO** |
| 分类器自动 spawn | **NO-GO** |
| auto_approve / 无人值守跳过 ACP | **Never** |
| Worker / orchestrator 子线程 ACP | **Never** |

### 6.2 双通道循环（Outbound × 接力）

- ACP 子进程 **不**注入 Outbound / `CMSPARK_*` 令牌  
- Outbound profile **无** `cmspark__acp_*`  
- `handoff_depth ≤ 1`；审计 `acp.loop_blocked`  
- 确认 **不可** 合成「允许所有 Agent」一键

### 6.3 输出

- Handback 必须 `<<<UNTRUSTED_ACP_HANDBACK>>>` 类帧  
- 注入后 taint：下一条用户消息前，高危 tool 强制 L2（对齐 host_cli Q5）

### 6.4 审计最低集（v1 / Phase B）

`offer_shown` · `spawn_requested/confirmed/denied` · `session_started/ended` · `disclosure_accepted` · `diff_proposed` · `loop_blocked` · `stdout_ingested` · `policy_violation`

- **`apply_*`**：gated apply 已交付时记 `diff_applied` / `apply_denied`；**静默 apply** 仍记 `policy_violation`  
- 审计文件权限与谁可读：对齐 `capability-audit.jsonl`（0o600 级）

### 6.5 确认与 originWs（双审 MUST）

- `acp_propose_session` / session start **复用**既有 `SecurityConfirmationManager` 确认家族（新 `toolName` 值即可，**禁止**第三套确认方言）  
- 凡有请求 socket：`request(...)` **必须**绑定 `{ originWs: ws }`（P1-2；对齐 `l2-admission` 非 outbound 路径）  
- `autoConfirmEligible: false` 对 ACP spawn / apply 恒成立

---

## 7. 架构落点（实现时）

| 项 | 决策 |
|----|------|
| 模块 | `companion/src/acp/`（并列 mcp / outbound-mcp / apps） |
| 配置 | `config.acp.enabled` 默认 false；`servers` map 同 MCP 消毒 |
| 工具 | `acp_list_agents` · `acp_propose_session`(L2+originWs) · `acp_collect_result` · `acp_cancel_session`；**禁** free-fire run |
| 生命周期 | idle → offered → confirmed → running → handback → closed |
| 工作区 | realpath 含于 `workspace_root`；禁止绑 `~/.cmspark-agent` |
| 适配器 | 绝对路径 + hash pin（tray / mcp stdio 先例） |
| **协议代码门槛** | **无 Accepted ACP ADR → 禁止合入 `companion/src/acp` 生产路径**（双审 N7） |

Phase 0 spike 成功/杀死标准见架构路；**杀线示例**：无稳定 ACP Agent、无法强制只读、handback 可越权指挥主 Agent。

---

## 8. 分期落地（可执行路线图）

### Phase A — 编程任务包（建议 1–2 周，**先做**）

1. **扩展** `dynamic-workflow` Prompt Chain + 可选薄 Pack 配方（勿平行第二入口）  
2. UI：消息 action + `/code` + **复制**；CLI 唤起按 §4 L0 约束  
3. Handback 粘贴口：用户贴回摘要/PR 链接  
4. 设置：可选「默认终端助手」文档链 / 路径探测（非自动 spawn）  
5. **成功标准**：≤3 次点击从问题页到外部 Agent 开工；用户能说清「写码的是外部助手」

### Phase B — ACP 审查会话（**已交付** · 默认 `acp.enabled=false`）

1. **Accepted** [ADR-025](../adr/025-acp-coding-agent-client.md)  
2. `companion/src/acp` + Confirm + Session Chip + 不可信 Handback + discover/adopt  
3. 云披露：UI 勾选 + L2 确认文案（Companion 确认路径强制 HITL）  
4. **成功标准**：绑定仓库完成一次真实审查；cancel 无孤儿进程

### Phase C — propose-diff + live FocusBand（**已交付**）

### Phase D — gated apply（**已交付** · HITL + containment；**非**静默写盘）

- shell-in-agent / free shell / 静默写盘：**仍 NO-GO**  
- 可选后续：生物识别二次门、外开 multi-file diff 浏览器

### 与 Outbound 并行纪律

- **P0 产品叙事**：编程 Agent 要浏览器 → 继续打磨 Outbound MCP  
- **P1 叙事**：浏览器要写码 → 编程接力  
- 文档必须表格写清「何时请直接用 Claude Code」

---

## 9. 开工前必须书面回答的问题

**未答 Q1/Q3/Q6/Q8 + 无 Accepted ACP ADR → 禁止写 ACP 协议代码。**  
Phase A 实现前至少锁定 **Q5（dynamic-workflow 合并）与 CLI 唤起范围（§4 L0）**。

1. **主叙事 6 个月**：Outbound 与 编程接力 是否双轨且文案不合并？  
2. **指标**：周活接力次数 / 接力后 24h 是否回 IDE / Offer 接受率？  
3. **谁拥有 write**：**静默** apply 永不；**gated** `acp_apply_diff`（L2 + 工作区 containment）已 GO — 见 ADR-025  
4. **workspace**：强制与 Agent cwd 同 realpath？monorepo？  
5. **账单/登录**：是否零承接（只链外文档）？  
6. **L3+ 外泄（硬要求）**：页摘要/仓库片段进云编码模型的 disclosure 必须与 ADR-022 L3+ **同级**——由 **Companion 会话状态强制**（`disclosure_accepted`），**不得**仅信任 Agent/调用方参数自报；未 disclosure 不得启动会外泄代码/页内容的会话  
7. **Trust**：接力是否强制不继承 auto_approve / Pack Trust？  
8. **协议必要性**：Phase A 是否禁止 ACP，只做导出？ACP 最小不可替代能力是什么？  
9. **与 dynamic-workflow（已默认）**：**扩展合并**，禁止双轨入口；若反对须书面 override  
10. **失败 UX**：未安装 / 半写坏仓库 / 谁 `git` 恢复？  
11. **中文命名**过非开发者测试？  
12. **诚实页**：文档写清何时别用本功能？  
13. **originWs / 确认家族**：ACP L2 是否复用 `SecurityConfirmationManager` 且绑定 originWs？（默认 **是**）

---

## 10. 最终产品决策（合成票）

| 选项 | 票 |
|------|-----|
| 全量 ACP + 侧栏 IDE | **KILL** |
| 仅概念、永不做接力 | **否**（Hero JTBD 真实） |
| **Phase A 薄接力 + 条件 Phase B 只读 ACP** | **通过（推荐）** |
| v1 可写盘 / shell-in-agent / 自动 spawn | **NO-GO** |

### 给用户的最终故事

> CMspark 擅长 **已登录网页上的真相与验收**。  
> 本机 Claude Code / Gemini / Codex 等擅长 **改仓库**。  
> **编程接力** 把两边接起来：你确认后，把证据打包交给本机助手；结果摘要回来，你仍可在侧栏点页面复验。  
> 我们不做第二个 Cursor，也不用坐标去点 TUI。

---

## 11. 对抗路与双审索引

本会话 5 路 subagent 结论已内嵌综合；完整长文保留在会话 transcript。  
**Pi + Claude 双路复审**：[`acp-coding-handoff-dual-review-synthesis-2026-08-13.md`](acp-coding-handoff-dual-review-synthesis-2026-08-13.md) · verdict `20260813-084345`。

实现 PR：Phase A 以本文件为产品 SoT；**§5.7 UX Consistency Contract 为 UI 硬门禁**；**ACP 协议细节以未来 Accepted ADR 为准，且不得跳过双审门槛。**

| 路 | 焦点 |
|----|------|
| JTBD | Personas、Keep/Kill、MVP-A/B/C、Week-1 信号 |
| Trust | 10 abuse、policy matrix、loop R1–R8、审计表、GO-WITH-GATES |
| 反膨胀 | Steelman、Zed envy、DEFER、4 周薄切片、命名 |
| UX | IA、wireframe、Hybrid、empty/error、ship slices S0–S4 |
| 架构 | `acp/` 模块、配置、状态机、工具契约、Phase 0 spike |
| Claude dual | APPROVE_WITH_NITS · originWs · dynamic-workflow · 数字门 · 徽章诚实 |
| Pi dual | APPROVE_WITH_NITS · 只读诚实 · disclosure 强制 · CLI open 范围 |

---

*合成作者: Grok Build · multi-agent adversarial fan-out + dual-external-review · 2026-08-13*

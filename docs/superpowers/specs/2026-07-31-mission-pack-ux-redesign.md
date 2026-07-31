# 任务包 / 场景模式 — 产品逻辑重审与 UX 方案

| Field | Value |
|-------|--------|
| Status | **APPROVE_WITH_NITS**（Claude + Pi 双重复审 2026-07-31；实现另 PR） |
| Date | 2026-07-31 |
| Type | Product / UX redesign of Side Panel「任务包」surface |
| Baseline | ADR-014 Mission Pack + Modules；ADR-020 三轴；`PacksPanel.tsx` 现状 |
| Trigger | 用户装技能时误 apply AppSec → `tool_not_allowed`；面板「NetSec / AppSec」认知混乱；无取消路径 |
| Dual-review | `docs/audit/reviews/mission-pack-ux-redesign-{claude,pi,verdict}-20260731-150125.*` |
| Non-goals | 不重开 Pack 引擎 / enterprise 双通道 / L2 确认栈；不新造 Agent runtime |

---

## 0. 一句话

**把「任务包」从工程调试台改成用户可理解的「本对话场景」：模块是电源、工作区是场地、场景模板是角色；永远能看见当前状态，永远能一键退出，错误用人话说话。**

技术对象（Module / Pack / whitelist / snapshot）保留；**展示层换用户语言，并补齐退出与分流。**

---

## 1. 问题诊断（用户视角）

### 1.1 用户真正要做的事（Jobs）

| Job | 频次 | 今天用户路径 |
|-----|------|----------------|
| J1 普通聊网页 / 让 Agent 操作标签 | 高 | 直接聊（正确） |
| J2 **安装/导入技能**（GitHub zip、本机文件夹） | 中 | 误进「任务包」→ 工作区 + 可能点 AppSec |
| J3 做一次 **网页安全审查**（AppSec） | 中低 | 应用「应用安全审查」Pack |
| J4 读本机代码目录（DevSec workspace） | 中低 | 选工作区 + 需模块开启 |
| J5 企业：扫端口 / 跑一条命令 | 低 | NetSec 配置 + L2；shell 模块 |
| J6 开高危确认（god mode） | 运维 | 设置 → 安全（与 Pack **正交**） |

**核心冲突：** J2 与 J3 共用同一入口「任务包」，且 **J3 会永久改线程能力面** 却几乎不可见、不可逆（UI 层）。

### 1.2 现状面板实际混装了什么

```text
「任务包」页 = 
  A. 模块电源开关（appsec / workspace / shell / netsec）
  B. 本线程工作区绑定
  C. NetSec 全局 allowlist + 本线程扫描授权
  D. Mission Pack 列表 + 仅「应用」、无「退出」
```

用户脑中往往只有两个开关：「NetSec / AppSec」——因为 **视觉上最抢眼的是 NetSec 卡片 + 唯一的 Pack 卡片**，而不是信息架构。

### 1.3 已验证的故障链（#r21pj2）

1. 用户目标：**装 Black-cat 技能**  
2. Agent 提示去任务包 **选工作区**（合理）  
3. 用户打开任务包 → 同页可见 **应用安全审查 · 应用到当前线程**  
4. **06:43 `pack.apply` AppSec**（误触或「启用模块」与「应用场景」混淆）  
5. 线程 `tool_whitelist` 收窄；system 变成安全审查助手  
6. `workspace_list_dir` → `tool_not_allowed`（**不可恢复**话术）  
7. God mode 全开也无效（**正交门禁**，用户无法理解）

### 1.4 根因（产品，非工程）

| # | 根因 | 严重度 |
|---|------|--------|
| R1 | **名词错位**：页名「任务包」承载 4 种职责 | P0 |
| R2 | **状态不可见**：对话主表面几乎不显示「当前场景」 | P0 |
| R3 | **无退出路径**：无 `unapply` UI；只能新开线程或卸载 Pack | P0 |
| R4 | **错误不教学**：`tool_whitelist` 开发者串 + non_recoverable | P0 |
| R5 | **装技能主路径未产品化**：Skills 导入存在但与任务包抢戏 | P1 |
| R6 | **模块启用 ≠ 场景应用** 未讲清 | P1 |
| R7 | God mode / 白名单 / 模块 三门禁用户混为一谈 | P1 |

---

## 2. 对抗审视（多角色 · 击杀与保留）

### 2.1 角色矩阵

| 角色 | 会说什么 | 对方案的要求 |
|------|----------|----------------|
| **困惑用户** | 「我怎么两个都勾了？怎么取消？」 | 默认无场景；一键退出；零 jargon |
| **装技能用户** | 「我只想 import skill」 | 主路径不经过 AppSec；任务包页分流 CTA |
| **安全审查用户** | 「我要 STRIDE」 | 应用场景仍清晰；工具收窄是**特性**不是 bug |
| **企业安全官** | 「不能静默放开扫描」 | 不削弱 allowlist / L2 / enterprise 通道 |
| **攻击性 Agent** | 「骗用户 apply 宽松 Pack」 | apply 必须用户手势 + 后果说明；不让 LLM 静默 apply |
| **对抗产品** | 「加一层就更复杂」 | **减面**：拆页或强分区，而不是再加设置 |
| **实现成本** | 「只改文案？」 | 文案不够；**unapply + 状态条 + 错误映射** 是最小工程集 |

### 2.2 击杀候选方案

| 候选 | 判定 | 理由 |
|------|------|------|
| A. 删掉任务包，只留 Skills | **Kill** | 丢掉 ADR-014 组合价值与企业模块入口 |
| B. 仅改文案，不加 unapply | **Kill** | 不能解 #r21pj2 类卡死 |
| C. God mode 绕过 whitelist | **Kill** | 破坏 Pack 安全合同与审计 |
| D. 应用 Pack 时静默保留全部工具 | **Kill** | AppSec 名存实亡；双通道无意义 |
| E. 装技能自动 apply「全开 Pack」 | **Kill** | 假需求；全开本就是 `null` whitelist |
| F. 把 NetSec 从任务包挪到「设置」 | **Keep（P1）** | 降低页面噪音；授权仍可本线程 |
| G. 场景模式 = 显式 apply + 显式 exit | **Keep（P0）** | 对症 R2/R3 |
| H. 工具拒绝 → 可恢复 + 引导退出场景 | **Keep（P0）** | 对症 R4 |

### 2.3 必须守住的底线（不可谈判）

1. **ADR-020**：Pack = Composition，不是新 runtime / 「中层 Agent」  
2. **ADR-014**：Module 安装级；Pack 线程级；enterprise 不可由扩展伪造  
3. **Apply 仅用户手势**（扩展点击）；Agent **不得** `pack.apply` 自己  
4. **Unapply 恢复 snapshot**，不丢对话历史  
5. Shell/netsec 默认 deny + L2；god mode **不**等于白名单全开  

---

## 3. 目标用户心智模型（重写）

用三句话教用户（产品文案 SoT）：

1. **能力开关（模块）**：本机是否允许某类能力（像电源）。  
2. **本对话场景（任务包 / 场景模板）**：这次对话扮演什么角色、允许用哪些工具。  
3. **工作区**：这次对话可以读本机哪个文件夹（场地，不是场景）。

**默认态：** 无场景 = 通用助手 = 工具全开（在全局安全策略内）。  
**有场景：** 名称可见 + 随时「退出场景，回到通用」。

**Never say to end users（默认）：** `tool_whitelist` · `allowlist`（可改为「允许扫描的目标」）· `pack.apply` · `module_disabled` 裸码。

---

## 4. 信息架构方案

### 4.1 推荐 IA（P0：同入口强分区；P1：可拆页）

**方案 S（Ship P0）：单入口「场景与能力」，三区垂直分区 + 视觉权重**

```text
┌─────────────────────────────────────────┐
│ 场景与能力                          刷新 │  ← 改名或副标题澄清
├─────────────────────────────────────────┤
│ ■ 本对话状态（永远置顶）                 │
│   当前：通用助手  |  场景：应用安全审查   │
│   工作区：未选择 / path…                 │
│   [退出场景]  [更换工作区]  [清除工作区]  │
├─────────────────────────────────────────┤
│ ■ 开始一个场景（任务模板）               │
│   卡片：应用安全审查                     │
│   适合 / 不适合 · 将限制的能力摘要       │
│   [用于本对话]  （二次确认）             │
├─────────────────────────────────────────┤
│ ■ 本机能力（模块）— 折叠默认收起         │
│   工作区读写 · 应用安全包 · Shell · 扫描 │
│   未开则引导；enterprise 不足则说明      │
├─────────────────────────────────────────┤
│ ■ 网络扫描设置（仅 netsec 已开）— 折叠   │
│   允许的目标 · 本对话授权                │
└─────────────────────────────────────────┘
```

**装技能不进此页主路径：** Skills 面板保持/加强「导入」；任务包页顶可放次要链接：  
「要安装技能？→ 打开 Skills」  

**方案 T（已实现）：** NetSec 配置迁「设置 → 网络扫描」；场景页只留本对话状态 + 场景列表 + 本机能力电源 + 链到设置。

### 4.2 命名对照表（UI 文案）

| 工程名 | 用户文案 | 备注 |
|--------|----------|------|
| Mission Pack | **场景模板** / **对话场景** | 页内主词 |
| Apply pack | **用于本对话** | 非「启用」 |
| Unapply | **退出场景，回到通用助手** | 主按钮 |
| Module enable | **开启本机能力：…** | 与 apply 区分 |
| workspace_root | **工作区文件夹** | |
| tool_whitelist 收窄 | **本场景仅允许：网页阅读类工具…** | 列表可读化 |
| tool_not_allowed | **当前场景不允许使用「列出工作区文件」** | + CTA 退出 |
| NetSec allowlist | **允许扫描的目标** | |
| netsec authorize | **授权本对话扫描这些目标** | |
| god mode | **跳过危险操作确认**（设置里） | 注明：不放开场景限制 |

---

## 5. 关键用户流程

### 5.1 F1 — 装技能（幸福路径）

```text
用户：把 GitHub 技能装进插件
  → 引导 / 空态 / Agent 回复指向 **Skills → 导入**
  → 或：下载 zip → 解压 → 导入文件夹
  → 不经过「用于本对话」AppSec
  → 若需本机目录：仅「选择工作区」，状态条显示工作区，场景仍为「通用」
```

**成功标准：** 全程 `mission_pack_id == null`。

### 5.2 F2 — 网页 AppSec（幸福路径）

```text
用户：审查当前页安全
  → 打开场景与能力 → 读「适合/不适合」
  → 确认弹窗：将切换角色 + 限制工具列表 + 可随时退出
  → 用于本对话 → 主表面状态条「场景：应用安全审查 [退出]」
  → 完成后点退出 → snapshot 恢复
```

### 5.3 F3 — 误点 AppSec 后要 list 目录（恢复路径）

```text
Agent 调 workspace_list_dir
  → 错误分级：recoverable
  → UI/回复：「当前是「应用安全审查」场景，不能读本机文件夹。
       [退出场景并重试]  [保持场景，改用网页工具]」
  → 一点退出 → whitelist 恢复 → 可继续装技能
```

### 5.4 F4 — 模块未开

```text
需要工作区但 module off
  → 「请先开启本机能力：工作区读写」+ 按钮
  → 不与「用于本对话」混淆
```

---

## 6. 界面规格（P0）

### 6.1 全局：对话状态条（Chat 主表面）

当 `mission_pack_id != null` **或** `workspace_root` 时显示紧凑条（FocusBand 之下或 Composer 之上，≤28px）：

- 有场景：`场景：{name}` · `[退出]`  
- 有工作区：`工作区：{basename}` · 可选清除  
- 点击场景名 → 打开场景与能力面板  

**空场景 + 无工作区：** 不占位（保持 Gemini breath 干净）。

### 6.2 应用场景：二次确认 Modal

Title: `将「{pack.name}」用于本对话？`  

Body（固定结构）：

- **适合：** pack 描述 + 1–3 条  
- **不适合：** 硬编码/元数据：`installing skills` · `local code browsing without review` · `unrestricted tools`  
- **将会发生：** 角色提示变更；工具变为：{human list}；可随时退出  

Buttons: `取消` | `用于本对话`（primary）

### 6.3 退出场景

- 按钮文案：`退出场景，回到通用助手`  
- 行为：`pack.unapply` → `restoreSnapshot`  
- Toast：`已恢复为通用助手`  
- **不**删消息、**不**卸模块、**不**清工作区（工作区独立；可选二次确认是否保留）

### 6.4 Packs 列表卡片

每张卡：

- 名称 · 版本 · 渠道  
- 描述  
- **适合 / 不适合**（AppSec 内置文案，见 §8）  
- 状态：`未使用` | `本对话使用中`  
- 主按钮：未使用 → `用于本对话`；使用中 → `退出场景`（或禁用应用 + 旁路退出）

### 6.5 错误映射表（Companion → 用户）

| 内部 error | 用户可见 | 动作 | 级别 |
|------------|----------|------|------|
| `tool_not_allowed:X — not in thread tool_whitelist` | 当前场景不允许「{tool 中文名}」 | 退出场景；查看场景说明 | **recoverable** |
| `workspace_root not set` | 还没选择工作区文件夹 | 选择工作区 | recoverable |
| `module_disabled:devsec-workspace` | 未开启本机「工作区读写」能力 | 开启能力 | recoverable |
| god-mode 相关 | （不改变上表） | 链到设置说明：确认开关 ≠ 场景限制 | — |

### 6.6 Agent / 系统提示增量

- 当线程有场景：system 已有 pack append；另注入短规则：  
  `若工具因场景被拒，向用户解释场景名并建议退出场景；勿要求用户改 god mode。`  
- **禁止**引导用户「开启 god mode 以绕过白名单」。

---

## 7. 协议与工程增量（实现边界）

| 项 | 说明 |
|----|------|
| `pack.unapply` | `{ thread_id }` → restoreSnapshot；审计 `pack.unapply` |
| `pack.apply` | 保持；UI 强制 confirm；校验 active thread |
| 错误分类 | `tool_not_allowed` → recoverable + `error_code` + `mission_pack_id` + `suggested_action: unapply_pack` |
| 扩展 | PacksPanel 分区；状态条；确认 Modal；Skills 入口交叉链 |
| 文案 | 中文主；tool 名映射表 |
| 测试 | unapply 恢复 whitelist；错误分级；UI 有退出按钮 |

**不做（本方案）：** 新 Pack 市场、自动 apply、LLM apply、改 capability_profile 模型。

---

## 8. 内置 AppSec 场景文案（SoT）

| 字段 | 文案 |
|------|------|
| 名称 | 应用安全审查 |
| 适合 | 对当前网页/PRD 做威胁建模与安全 checklist；只读浏览与截图 |
| 不适合 | **安装技能**、读写任意本机项目、自由执行脚本、需要全部浏览器工具 |
| 工具摘要 | 列出标签、打开页面、读取页面文字/HTML、截图、使用技能 |
| 退出后 | 恢复你应用场景前的工具与提示设置 |

---

## 9. 分阶段交付

### P0 — 止血（建议 1 个 PR 或紧耦合 2 个）

1. `pack.unapply` + 面板「退出场景」  
2. 应用前二次确认（适合/不适合）  
3. 主表面场景状态条  
4. `tool_not_allowed` → recoverable + 人话 + suggested unapply  
5. 任务包页顶部分流：「安装技能请用 Skills」  
6. 分区标题：本对话状态 / 场景模板 / 本机能力 / 扫描设置  

### P1 — 清晰化

1. 页改名「场景与能力」或副标题  
2. NetSec 折叠或迁设置  
3. 清除工作区  
4. Skills 导入引导强化（zip / 文件夹）  
5. 设置页一页纸：「场景限制 vs 确认开关 vs 本机能力」  

### P2 — 扩展

1. 更多场景模板（若产品需要）  
2. Pack 元数据字段 `suitable_for` / `unsuitable_for` / `tool_summary_zh` 进 pack.yaml  

---

## 10. 成功指标

| 指标 | 基线（定性） | 目标 |
|------|----------------|------|
| 装技能流程是否需 apply Pack | 常误触 | **0 次**需要 apply |
| 误 apply 后自助恢复率 | 近 0（无按钮） | **>80%** 点退出成功 |
| `tool_not_allowed` 标 non_recoverable | 是 | **否** |
| 用户能否说出「当前场景」 | 否 | 状态条可见 |
| 安全回归 | — | unapply 不抬权；apply 仍收窄；L2 不弱 |

---

## 11. 开放问题（双重复审可答）

| # | 问题 | 默认建议 |
|---|------|----------|
| Q1 | 退出场景时是否同时清除工作区？ | **否**（独立维度）；提供可选勾选 |
| Q2 | 页名「任务包」是否立刻改掉？ | **已锁定：用户主文案「场景」**；panel id 仍可 `packs` |
| Q3 | Agent 是否允许调用 unapply 工具？ | **否**；仅 UI；Agent 只建议用户点 |
| Q4 | 多 Pack 切换是否要「替换确认」？ | 是；基于现有 snapshot 逻辑 |
| Q5 | community 用户看到 shell/netsec 横幅？ | 保留但文案说明需企业版配置 |

---

## 12. 能力声明（ADR-020）

```text
Surface:      n/a 变更（不抬 L0/L1/L2 拓扑）；workspace 仍 L1+ 本机
L2-classes:   (none new)
Compose:      pack unapply + UX；Pack 仍为 composition
Autonomy:     n/a
Trust:        不削弱 L2；god mode 不绕 whitelist；apply 用户手势
Channel:      community/enterprise 不变
```

---

## 13. 对抗总结（作者自检）

| 攻击 | 回应 |
|------|------|
| 「又加概念」 | 概念早已存在；是**揭开**并**可逆**，不是新增轴 |
| 「用户不在乎场景」 | 默认通用；有状态才显示；零场景用户无负担 |
| 「退出会丢安全」 | 退出 = 恢复 apply 前 snapshot，不是抬到 god |
| 「装技能该走 workspace」 | 主路径 Skills 导入；workspace 仅辅助解压目录 |
| 「企业要默认 AppSec」 | 可用企业策略预装 Pack，仍须 per-thread apply 或显式默认策略（另议） |

---

## 14. 双重复审结论（2026-07-31）

| Reviewer | Verdict |
|----------|---------|
| Claude | **APPROVE_WITH_NITS** |
| Pi | **APPROVE_WITH_NITS** |
| both_ok | **true** |

双方共识：**用户 Job 诊断正确；ADR-014/020 不破坏；P0 可交付**（`restoreSnapshot` 已存在）。无 Blocking。

### 14.1 必须并入 P0 的修订（双审 nits → 规范）

1. **`pack.apply` / `pack.unapply` 协议硬化**  
   - `pack.apply` 校验 **`user_gesture: true`**（对齐 `netsec.authorize_task`），禁止仅靠 UI 约定挡 LLM 自 apply。  
   - `pack.unapply` 仅为 **Companion RPC / 扩展消息**，**禁止**注册进 `getToolDefinitions()` / LLM tool 列表。  
   - 审计：`pack.unapply` 写 `capability-audit.jsonl`。

2. **错误 envelope 形状（固定）**  
   tool_result 使用：
   ```json
   {
     "success": false,
     "error": "<人话一句>",
     "data": {
       "error_code": "tool_not_allowed",
       "error_level": "recoverable",
       "tool_name": "workspace_list_dir",
       "mission_pack_id": "appsec-prd-review",
       "suggested_action": "unapply_pack"
     }
   }
   ```
   与现有 `TAB_ID_REQUIRED` 的 `data.error_code` 模式一致；adapter 据此停止标 `non_recoverable`。

3. **工具中文名映射表（P0 内置最小集）**

   | tool_name | 用户文案 |
   |-----------|----------|
   | `workspace_list_dir` | 列出工作区文件 |
   | `workspace_read_file` | 读取工作区文件 |
   | `evaluate` | 在页面执行脚本 |
   | `shell_exec` | 执行本机命令 |
   | `netsec_port_scan` | 端口扫描 |
   | `host_computer` | 电脑操控 |
   | （其它） | 使用工具「{tool_name}」 |

4. **AppSec「不适合」文案**  
   P0 仅对 `pack_id === "appsec-prd-review"` 使用 §8 硬编码；其它 Pack 无元数据时只显示描述，**不**套用 AppSec 的「不适合装技能」文案。

5. **F3 恢复语义**  
   用户点「保持场景」→ **不**自动重试原工具；Agent 按 §6.6 改用场景内允许的工具重新规划。  
   用户点「退出场景并重试」→ UI unapply 后用户可再发「继续」；Agent 可再调原工具。

6. **退出场景与工作区**  
   默认 **不**清 `workspace_root`；Pack 切换/退出均不隐式清工作区。P0 退出按钮无「同时清除工作区」勾选（避免范围膨胀）；清除工作区 P1。

7. **P0 页标题（命名锁定）**  
   用户主文案：**「场景」**（BottomBar / Host / slash / empty chip 可见串）。  
   副标题：`为本对话选用模板（可限制可用工具）`。  
   panel id 保持 `packs`。tooltip：`与开启本机能力不同 — 场景会限制本对话可用的工具`。

8. **活动卡按钮互斥**  
   `isActive` 时主按钮仅为「退出场景」；隐藏/禁用「用于本对话」。

### 14.2 仍属 P1 的 nits

- 页主名改为「场景与能力」/「场景与模块」  
- NetSec 迁设置；清除工作区 RPC  
- pack.yaml `suitable_for` / `unsuitable_for`  
- 状态条 320px 截断策略（basename + ellipsis）

---

## 15. 下一步

实现 PR 以 **§9 P0 + §14.1** 为验收清单；先 `pack.unapply` + 错误 recoverable + 状态条 + 确认 Modal。

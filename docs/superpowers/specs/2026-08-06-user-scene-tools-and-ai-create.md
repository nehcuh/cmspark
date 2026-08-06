# 用户场景：工具策略 + AI 创建/优化（产品设计 · 多路对抗合成）

> **日期**: 2026-08-06  
> **状态**: **ACCEPTED**（Pi+Claude APPROVE_WITH_NITS 20260806-071815）· 实现中  
> **触发**: #pl5bud 场景限制；默认场景不可编辑；用户场景无法配置 tools；创建体验缺口  
> **轴**: ADR-020 **Composition**（Pack/场景）· Trust 仍由 module + L2 + profile 持有  
> **对抗输入**: Security-lane plan agent · Impl-lane plan agent · 会话产品讨论（UX agent 传输失败，由主会话补全）

---

## 0. 问题陈述

| ID | 问题 | 用户感知 |
|----|------|----------|
| G1 | 内置场景（网络巡检等）只读 | 无「编辑」，只有「另存为我的」——**正确**，保持 |
| G2 | 用户场景 `tools.mode` 写死 `unchanged` | **无法配置** shell_exec / evaluate / host_computer / osascript_eval |
| G3 | 另存为我的不保留模板 allowlist | 从网络巡检另存后「工具全开」，与模板意图脱节 |
| G4 | 创建场景要手写长 prompt | 缺 brief-first 生成、缺「勾完技能再优化 prompt」 |

**不是问题（需写清）**: `unchanged` 下基线 `tool_whitelist=null` 时用户场景**已经**能调用 shell（若 module+L2 允许）。缺口是 **不能声明配方**，不是「永远禁 shell」。

---

## 1. 多路对抗结论摘要

### 1.1 Security lane（条件 Go）

- Pack **默认只做 Composition**；**Trust B 例外**：仅用户场景 `trust` 块可写全局 auto_approve / 开 module（见 D4 修订 + ADR-020）。
- 高危工具出现在 allow 时：server **强制** `requires_modules` 推导 + apply 时 module/profile **fail-closed**。
- `allowlist` 语义是 **整表替换**（可相对当前线程 **扩大** 面）——UI 必须明示；默认勿「全选危险工具」。
- AI **不得**默认勾选 shell_exec 等高危；仅建议、用户手勾。
- Clone 保留 tools 时必须 **整组保留** mode+allow+deny+requires_modules+channel，或 **sanitize 高危**；禁止 community + netsec 工具且无 requires。

### 1.2 Impl lane

- 引擎已有 `computeWhitelist` / validator；主改 `saveUserPack` + UI + suggest mode。
- **MCP 坑**: 非 null whitelist 会挡 `mcp__*` —— 与 allowlist 同发时必须 **MCP 与 native 白名单正交**。
- Update 时 `tools` **省略 = 保留** 磁盘策略，防「只改名字」冲掉 tools。
- 建议顺序: MCP 正交 → save tools → UI → clone preserve → AI modes。

### 1.3 Product / UX（主会话补全）

- 内置只读 + 另存；用户场景可配 tools + AI。
- 默认 tools = **不限制（unchanged）**；可选 **仅允许勾选**。
- 创建入口: **从描述生成 | 从模板另存 | 空白**。
- AI: **生成场景** / **推荐技能 MCP** / **优化 Prompt** 三分法。

---

## 2. 产品决策（锁定）

| ID | 决策 |
|----|------|
| D1 | 内置/installed **不可**直接编辑；仅 **另存为我的** 或 **新建** |
| D2 | 用户场景可配 `tools.mode`: `unchanged` \| `allowlist`（P0）；`intersect` 作高级可选 P1 |
| D3 | 高危工具分组展示、默认不勾选；勾选二次确认文案（仍需模块+每次 L2） |
| D4 | **修订 2026-08-06（Trust B）**：内置/installed 仍 **不能** 开 module / 跳 L2 / 写 auto_approve。**仅 origin=user** 可在 `trust` 块声明；apply 写全局；unapply/uninstall/切换/失败回滚；单对话 holder；install/spawn 不抬升 |
| D5 | shell/netsec 在 allow 中 → server 写入 `requires_modules`；apply 时 profile/module 不足则 blocked |
| D6 | 另存：「保留原场景工具限制」**默认关**；开启则复制 tools（+ requires/channel 字段若有） |
| D7 | AI 三模式: `recommend` / `generate` / `optimize`；工具列表 **P0 不做 AI 自动勾选高危** |
| D8 | allowlist + 已勾 MCP：native 白名单与 MCP **正交**（修 footgun） |
| D9 | 有 skill_ids 时 allowlist **自动包含 `use_skill`**（与内置包一致） |

---

## 3. 用户旅程

### J1 红队 / root 确认（#pl5bud 类）

1. 新建 → **从描述生成**：「授权渗透、确认 root、用 shell 与 pentest 技能」  
2. AI 勾选技能 + 草稿 prompt；用户手勾 `shell_exec`（高危区）  
3. 保存前见提示：需 enterprise + shell 模块；每次命令 L2  
4. 保存并用于本对话  

### J2 只读端口巡检

1. 用内置 **网络巡检** 或 另存并 **勾选保留工具限制**  
2. 不挂 shell；可选加解读类技能  

### J3 从模板加技能

1. 网络巡检 → 另存为我的  
2. 不勾保留工具 → 全开；或勾保留 → 仍仅扫端口  
3. 勾选技能 → **优化 Prompt**  

---

## 4. UI 草图（任务包 · 场景编辑器）

```
┌─ 新建 / 编辑场景 ─────────────────────────┐
│ [从描述生成] [从模板另存*] [空白]            │  *另存从列表入口
│ 场景描述 [________________]  [AI 生成场景]  │
│ 名称 [____]  简介 [____]                    │
│ System prompt [________] [优化 Prompt]      │
│ 技能 … [推荐技能/MCP]  勾选…                 │
│ MCP …                                       │
│ 工具策略                                      │
│  ○ 不额外限制（默认）                         │
│  ○ 仅允许勾选的工具                           │
│     常规: list_tabs get_page_text …           │
│     高危: □ shell_exec □ evaluate …          │
│     （高危: 需本机模块；每次仍确认）            │
│ [取消] [保存] [保存并用于本对话]               │
└───────────────────────────────────────────┘
```

另存弹层: `□ 保留原场景的工具限制（推荐从专业模板另存时勾选）`

---

## 5. 数据与 API

### 5.1 `UserPackSaveInput.tools?`

```ts
tools?: { mode: "allowlist"|"intersect"|"unchanged"; allow?: string[]; deny?: string[] }
```

- create 省略 → unchanged  
- update 省略 → **保留** 原 pack tools  
- allowlist 且 allow 空 → 拒绝保存  

### 5.2 Server 规范化

- 未知 tool 名拒绝  
- allow 含 `shell_exec` → `requires_modules` 含 `shell`，channel 处理与 apply_blocked 对齐  
- allow 含 `netsec_port_scan` → `requires_modules` 含 `netsec`  
- 禁止 FORBIDDEN_PACK_KEYS  

### 5.3 `pack.suggest_config`

```ts
mode?: "recommend" | "generate" | "optimize"  // default recommend
```

| mode | 技能/MCP | prompt |
|------|----------|--------|
| recommend | 合并勾选 | 仅当空时填草稿 |
| generate | 合并勾选 | 总是生成草稿（非空则 UI 确认覆盖） |
| optimize | 不改列表 | 重写现有 prompt（必填已有） |

---

## 6. 实现次序（全部完成）

| 序 | 项 | 验收 |
|----|-----|------|
| 0 | MCP ↔ whitelist 正交 | allowlist 场景仍可调已选 MCP |
| 1 | saveUserPack tools + omit-preserve + requires 推导 + 测试 | 用户包可 allowlist shell；module 关则 apply blocked |
| 2 | PacksPanel 工具策略 UI + tools.catalog 或静态分组 | 可见勾选、保存回读 |
| 3 | 另存「保留工具限制」 | 从网络巡检另存后 apply 仍 deny shell |
| 4 | AI generate / optimize / recommend UI | 描述生成；优化 prompt；推荐技能 |
| 5 | 文档 mission-pack-usage + mcp/场景说明 | 用户可知路径 |
| 6 | 审计 audit 含 tools.mode / 高危标记 | capability-audit |

---

## 7. 非目标

- 场景内跳过 L2 / 自动开启 module  
- AI 静默勾选 shell_exec  
- 直接编辑 builtin yaml  
- Pack 市场远程安装（已有 backlog）  
- 交互式 PTY  

---

## 8. ADR-020 声明（实现 PR 用）

```
Surface:      n/a（不新增 L0/L1/L2 类；复用 shell/netsec/host 既有执行面）
L2-classes:   shell | netsec | host_computer | evaluate（仅声明配方，不旁路 L2）
Compose:      pack | skill | mcp-server
Autonomy:     single
Trust:        module + profile + L2 默认不变；origin=user trust 块可写全局（Trust B + lifecycle）
Channel:      community 用户场景可声明 enterprise 工具，apply 仍 enterprise 门
```

---

## 9. 验收剧本（合成 Security §8 + 产品）

1. 默认新建 unchanged，apply 不改 whitelist  
2. allowlist + shell 且 module 关 → apply blocked  
3. allowlist + shell 且 enterprise+module 开 → apply 后可见 shell_exec，调用仍 L2  
4. 只改名字保存 → tools 策略保留  
5. 另存保留工具 → 与模板等价收窄  
6. 另存不保留 → unchanged 全开  
7. AI generate 填 prompt+技能，不自动保存  
8. AI optimize 不改技能勾选  
9. allowlist + MCP 勾选 → mcp 工具仍可用  
10. unapply 恢复 snapshot whitelist  

---

## 10. 变更日志

| 日期 | 变更 |
|------|------|
| 2026-08-06 | 多路对抗合成初稿；待 Pi/Claude dual-review |

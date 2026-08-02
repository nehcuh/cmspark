# 信任设置 IA + 长程自治 — 产品设计 SoT

> **日期**: 2026-08-02  
> **状态**: **IMPLEMENTING / P0+P1 landed in tree** — dual-review 2026-08-02 Claude+Pi **APPROVE_WITH_NITS**（nits 已折叠）；实现见 SettingsSlideout / StatusRail / autopilot-tier  
> **触发**: 权限入口过多；God-mode 名实不符；用户需要「长程自行运行」入口  
> **对抗合成**: [trust-autopilot-ia-adversary-synthesis-20260802.md](../../audit/reviews/trust-autopilot-ia-adversary-synthesis-20260802.md)  
> **实现计划**: [../plans/2026-08-02-trust-ia-autopilot-impl.md](../plans/2026-08-02-trust-ia-autopilot-impl.md)  
> **关联**: ADR-007 · ADR-010 · ADR-014 · ADR-017 · ADR-020 · enterprise Plan A/B · confirm-center-user-guide §5

---

## 0. 一句话

**把「正交安全闸门」从用户旅程里藏进「信任范围 / 运行自主度 / 高级闸门」三层叙事；God-mode 降为「协议解锁」；长程无人值守用「运行自主度」一条主路径武装（合成现有 bool，不扩 CU/spawn 静默跳过）。**

---

## 1. 问题（用户与代码）

### 1.1 用户感知

- 设置里 Cookie 信任域 / 自动批准域名 / 自动批准危险 / 企业自动批准 / God-mode 像**平行权限**，不知开哪一个才能「少打断」。  
- **God-mode** 听起来像最高自治，实际只是 **L1 协议 + 部分网页 L2**；开了仍被 shell / CU / spawn 打断 → 不信任产品。  
- 长程 agent 需要叠 2–4 个勾 + 短语 + 任务授权，**没有一条 JTBD 入口**。

### 1.2 代码真相（不得用文案掩盖）

| 键 / 机制 | 实际效果 |
|-----------|----------|
| `trusted_domains` | Cookie 门 |
| `auto_approved_domains` | 域内网页类 L2 跳过 |
| `auto_approve_dangerous` | 全局网页类 L2 跳过；**不**跳 L1、shell/netsec forceConfirm |
| `allow_all_schemes`（God） | 跳 L1 + 网页类 L2；**不**跳 shell/netsec/CU 任务 L2/spawn |
| `auto_approve_enterprise_tools` | 范围内 shell/netsec L2 跳过 |
| Plan A session trust | 本线程 family TTL |
| 确认台 L2 | 单次执行 HITL |

正交拆分在**实现与审计**上正确；在**用户地图**上失败。

---

## 2. 目标与非目标

### 2.1 目标

1. **一条主故事**：「我信任这台机器和这条工作流 → 武装长程自治 → agent 少确认跑数小时 → 随时解除 / 急停」。  
2. **名实相符**：协议风险 ≠ 企业 shell ≠ 桌面 CU ≠ Cookie。  
3. **默认安全不变**：community / 新鲜安装仍 default-deny + 每枪确认。  
4. **不破坏 ADR**：Trust 单调；Pack 不抬 trust；wire keys 稳定。  
5. **武装态可见**：不进设置也能看到「巡航中」并一键解除。

### 2.2 非目标

- ❌ 把 `allow_all_schemes` 扩成跳过 shell/CU/spawn/MCP critical（Scheme C）。  
- ❌ 用新 enum **替换** 三个 bool 为唯一 config SoT（P2 以前不做）。  
- ❌ 合并 `trusted_domains` 与 `auto_approved_domains`。  
- ❌ Pack / Skill 自动武装。  
- ❌ 新增第四能力轴或「中层 Agent」。  
- ❌ P0 改 `mustInteract` / `forceConfirm` 代数。

---

## 3. 方案对抗结论（摘要）

| 方案 | 结论 |
|------|------|
| A 仅改名+IA | **P0 必做**，不能单独交付 JTBD |
| B 不透明一键多 flag | **否决纯形态**；仅作 D 的向导壳 |
| C God 吞一切 L2 | **永久否决**（升级静默提权 + 注入 RCE 产品化） |
| D 协议解锁 + 运行自主度档位 | **产品形态胜出** |

完整矩阵见 adversary synthesis。

---

## 4. 产品锁（D 系列 — 实现不得违反）

| ID | 锁 | 验收 |
|----|-----|------|
| **D1** | 产品名词 **禁用「God-mode」作主标签**；UI 用 **协议解锁**；副文案写清仅 L1+网页 L2 | Settings `rg` 无主标题 God-mode；可保留代码注释 / 审计 reason `god_mode` |
| **D2** | **运行自主度** 为多 flag 武装的**唯一主路径**；旧三开关降到 **高级 · 独立闸门** | 主分区 CTA 可完成网页±企业武装而无需先找三个勾 |
| **D3** | 武装前 **强制展示后果矩阵**（工具族 × 跳过/仍确认） | 未展示矩阵不可提交短语 |
| **D4** | **Hard floors v1**：默认 Autopilot 档 **不得**静默跳过 `host_computer` 任务级 L2、`spawn_worker`、`ask_user`、`board_complete`、MCP critical、evaluate critical_api、cookie 信任域、workspace 绑定、pack whitelist、netsec 空名单。**例外**：[ADR-021](../../adr/021-unattended-desktop-session.md) / 无人值守档的进程内 grant 可跳过 **initial** L2（仅 coordinateAllowed；危险 re-L2 仍确认） | 单测 + 矩阵文案一致 |
| **D5** | Enterprise 跳过 **永远** 在 scope ∩ 之后；武装不写 allowlist、不 enable module | 与 Plan A/B 一致 |
| **D6** | Wire keys 冻结：`auto_approve_dangerous` / `allow_all_schemes` / `auto_approve_enterprise_tools`；Autopilot **双写**这些 bool，不新增 superseding config key（P0/P1） | config schema 无新必填 trust enum |
| **D7** | false→true 仍走 companion phrase step-up（`SECURITY_ARM_FLAGS`）；一次武装多 flag 时 **逐 flag 审计** `security.flag_armed` | 审计含 flags[] |
| **D8** | 武装态 **Side Panel chrome**（SafetyStrip 或 FocusBand）：`巡航中` + 解除；不得仅设置内可见 | 武装后 10s 内可见徽章 |
| **D9** | Pack / craft / import **禁止** 写任何 arm 键（含未来 autonomy 键） | `FORBIDDEN_PACK_KEYS` 回归 |
| **D10** | 升级：既有 `allow_all_schemes:true` **不得**因本变更自动获得 shell/CU skip | 行为 diff 仅 UI/合成写已有路径 |
| **D11** | Autopilot 在 ADR-020 语言中是 **Trust packaging**，不是 Autonomy 新 runtime / 新 Surface | 文档声明 |
| **D12** | 文档锁步：Settings + confirm-center §5 + mission-pack-usage 相关句 + TROUBLESHOOTING 同 PR | 链接与矩阵一致 |

### 4.1 安全锁（S 系列 — 双审 REJECT 门）

| ID | 锁 |
|----|-----|
| **S1** | `allow_all_schemes` 永不单独清除 shell/netsec/CU/spawn/host_cli forceConfirm |
| **S2** | Host 类无人值守只经 enterprise 机制（Plan B / Plan A）+ scope |
| **S3** | 审计 reason 链保持可区分：`god_mode` \| `global_toggle` \| `domain_whitelist` \| `enterprise_*` … |
| **S4** | 急停 / Confirm Center flight 不因武装削弱 |
| **S5** | Community 不得被 UI 承诺「shell/netsec 已跳过」（无 enterprise 时灰显或说明不可用） |

---

## 5. 产品形态（用户可见）

### 5.1 设置 IA

```text
设置
├── … 连接 / 模型 …
├── 运行自主度                          ← 主分区（P1 完整；P0 可先放导航说明）
│   ├── 档位（单选）
│   │   ○ 每次确认（默认）
│   │   ○ 网页巡航          → auto_approve_dangerous
│   │   ○ 全自动巡航        → dangerous + enterprise_tools（若 enterprise）
│   │   ○ 全自动巡航（含协议解锁）→ 上者 + allow_all_schemes  [危险样式]
│   ├── 作用域（P1：仅展示「全局·持久 config」说明；会话作用域 P2）
│   │   · P1：武装 = 写 config bool（与今日开关相同持久性）
│   │   · P2：本会话 / 本线程
│   ├── 后果矩阵（只读表）
│   ├── [武装…] 短语「我了解风险」 / [解除武装]
│   └── 状态：未武装 | 已武装 · 档位名
│
├── 场景 · 本机能力说明（既有精简）
├── 网络扫描
├── 安全设置
│   ├── 安全技能
│   ├── Cookie 信任域
│   ├── 自动批准域名白名单
│   ├── ▼ 高级 · 独立闸门（默认折叠）
│   │   ├── 自动批准所有危险操作（网页 L2）
│   │   ├── 全局自动批准企业高危工具
│   │   └── 协议解锁（原 God-mode）
│   └── 安全审计日志
```

### 5.2 档位 ↔ flag 映射（权威）

| UI 档位 | `auto_approve_dangerous` | `auto_approve_enterprise_tools` | `allow_all_schemes` |
|---------|--------------------------|--------------------------------|---------------------|
| 每次确认 | false* | false* | false* |
| 网页巡航 | **true** | **不触碰**（保持用户既有值） | **false**（若武装路径曾打开则关） |
| 全自动巡航 | **true** | **true**（仅 enterprise 通道可选；否则灰显） | **false** |
| 全自动巡航（含协议解锁） | **true** | **true**（同上） | **true** |
| 自定义 | 高级区手动改 flag 后与上表不一致时显示 | — | — |

\* **P1-A 解除武装**：三 flag 全 `false`（简单可测；文案警告 power user）。P1+ 可加 session 内存 `armed_by_autopilot: string[]` 做精细解除——**禁止**把该数组写入 config 作 superseding SoT（D6/R2）。  
\* **网页巡航武装**：只 **打开** `auto_approve_dangerous`；不自动关 enterprise；强制把 `allow_all_schemes` 置 false（协议解锁不随网页巡航）。若 enterprise 仍为 true → 档位显示 **自定义**。

### 5.3 后果矩阵（武装前必显，文案锁）

| 工具族 | 网页巡航 | 全自动巡航 | +协议解锁 |
|--------|----------|------------|-----------|
| evaluate / navigate 等网页 L2 | 跳过 | 跳过 | 跳过 |
| 非 http(s) scheme | **仍阻断** | **仍阻断** | **跳过（高风险）** |
| shell / netsec（范围内） | 仍确认 | 跳过* | 跳过* |
| shell / netsec（模块关/无范围） | 不可用 | 不可用 | 不可用 |
| host_cli / host_app（企业路径） | 仍确认† | 仍确认† | 仍确认† |
| host_computer 任务 L2 | 仍确认 | 仍确认 | 仍确认 |
| spawn_worker | 仍确认 | 仍确认 | 仍确认 |
| Cookie / 工作区绑定 | 不涉及 | 不涉及 | 不涉及 |

† P1 不经 Autopilot 跳过；与 enterpriseSkip 族一致性以 companion 为准；矩阵明示「仍确认」避免误读。

\*需 `capability_profile=enterprise` 且模块启用。

### 5.4 中文标签

| 用途 | 文案 |
|------|------|
| 主分区 | 运行自主度 |
| 档位 | 每次确认 / 网页巡航 / 全自动巡航 / 全自动巡航（含协议解锁） |
| CTA | 武装 / 确认武装 / 解除武装 |
| 短语 | 我了解风险（不变） |
| 徽章 | 巡航中 · 网页 / 巡航中 · 全自动 / 巡航中 · 全自动+协议 |
| 原 God | 协议解锁（允许非 http(s) 协议） |
| 后果句 | 你将承担 prompt 注入驱动已放权操作的后果；急停与硬性拒绝仍然有效。 |

### 5.5 Status chrome

- **Chip host（锁）**：优先 **SafetyStrip**（与「企业信任中」同级）；无 SafetyStrip 时回退 FocusBand。  
- 文案：`巡航中` + 短档位；点击 popover（档位、解除）。  
- 与「企业信任中」并列时优先显示巡航 chip。  
- 急停位置与 D10′ 不变。

---

## 6. 能力声明（ADR-020）

```text
Surface:      n/a（不新增 Surface；不加深 L2 默认语义）
L2-classes:   (none new)
Compose:      none
Autonomy:     single（多 worker 行为不变；spawn 仍 L2）
Trust:        packaging of existing auto_approve / allow_all_schemes / enterprise flags
Channel:      community | enterprise（企业档位仅 enterprise 可完整武装）
```

---

## 7. 分阶段交付

### P0 — IA + 名实（无代数变更）

1. God-mode → **协议解锁** 全文案。  
2. 三开关收入 **高级 · 独立闸门**（折叠）。  
3. 顶部增加 **运行自主度** 说明块：链到「将在 P1 提供一键武装」**或** 若同 PR 含 P1 则直接是控件。  
4. 真理矩阵（浏览器 vs shell/netsec vs CU）升为可读表格，非 monospace 附录。  
5. 文档锁步 D12。  

**P0 可独立 merge**（若 P1 未就绪）：至少消除 God 误解 + 降低扫描成本。

### P1 — 运行自主度武装（JTBD）

1. 档位单选 + 后果矩阵 + 短语武装 / 解除。  
2. 双写既有 bool；徽章 `巡航中`；审计 package + per-flag。  
3. Community 灰显企业相关档位承诺。  
4. 验收：§8 P0-2 类标准（命名为 P1 DoD）。

### P2 — 会话作用域 / TTL / spawn 预算 / 含桌面巡航

- 需单独 ADR 补丁；**不在本 SoT 实现门内**。  
- 仅记录意图，防止实现者 scope creep。

---

## 8. 验收（DoD）

### P0 DoD

| # | 标准 |
|---|------|
| P0-1 | 设置主标签无「God-mode」；协议解锁文案含「不含 shell/CU/spawn」 |
| P0-2 | 高级闸门默认折叠；打开后三开关仍可用且 phrase arm 行为与现网一致 |
| P0-3 | 可读矩阵展示网页 / 企业 / 协议三列差异 |
| P0-4 | 相关用户文档同步；`rg 'God-mode'` 用户可见路径仅历史 ADR 或明确「旧称」 |

### P1 DoD

| # | 标准 |
|---|------|
| P1-1 | 仅用运行自主度武装「网页巡航」后，连续 ≥5 次 evaluate 零 L2（同今日 auto_approve） |
| P1-2 | 全自动巡航在 enterprise+shell 模块下 shell_exec 零 L2；community 不能被文案骗过 |
| P1-3 | 含协议解锁后非 http(s) 可过 L1；默认全自动巡航仍挡 L1 |
| P1-4 | host_computer / spawn 仍 L2 |
| P1-5 | 徽章可见 + 解除后恢复确认 |
| P1-6 | Pack 不能武装；无 phrase 拒绝 |
| P1-7 | 既有 god-only 用户升级后 **不会** 自动 enterprise skip |

---

## 9. 风险与迁移

| 风险 | 缓解 |
|------|------|
| 用户仍找「God」 | 高级区副标题「旧称 God-mode」一版后删除 |
| 解除武装误关 power user 手动开关 | P1-A：文案警告「解除将关闭网页/企业/协议三类自动批准」 |
| 一次 phrase 武装 enterprise | 矩阵强制展示 shell 风险；enterprise 通道门 |
| 双源 UI（档位 vs 高级勾） | 高级勾变更时档位显示「自定义」；徽章由 bool 推导 |

---

## 10. 明确否决记录

**Scheme C（扩展 God 跳过全部 forceConfirm）**：  
安全（注入 RCE 产品化）、Compat（既有 god-on 静默提权）、ADR-010/014/017/020 合同破坏。  
用户「自负后果」通过 **Autopilot 档位 + 矩阵 + 短语** 承接，**不**通过污染 `allow_all_schemes` 语义。

---

*内部对抗：Product/UX · Security · Compat · Autonomy · 2026-08-02*  
*下一步：Pi + Claude dual-review → 通过后按 impl plan 执行 P0→P1*

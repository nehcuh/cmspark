# ADR-020: Capability Model — Three Orthogonal Axes

**日期**: 2026-07-29 | **状态**: Accepted  
**相关**: UI 三模式 L0/L1/L2；[ADR-014](014-mission-pack-enterprise-modules.md) Pack；[ADR-015](015-multi-agent-orchestrator-tab-lock.md)/[016](016-mission-board.md) 编排·Board；[ADR-017](017-computer-use.md)/[018](018-host-use.md) CU/Host；[ADR-019](019-user-env-secrets.md) user-env  
**过程**: [brief](../decisions/capability-model-three-axes-brief-2026-07-29.md) · [synthesis](../decisions/capability-model-three-axes-synthesis-2026-07-29.md) · dual-review Claude+Pi **APPROVE_WITH_NITS** (`docs/audit/reviews/capability-model-ontology-*-20260729-162716.*`)

---

## 背景

0.3.0 交付面已覆盖 CDP 工具、Skills、Knowledge、MCP、Packs、企业模块、Computer/Host/Apps、Multi-Agent、Board、导出/NotebookLM、user-env 等。产品叙事容易写成「主体 → 浅层 Agent → 中层 Agent → 深层 Agent」，其中 **「中层 Agent」会把组合能力误读成第三种 runtime**，导致新场景平行膨胀（新面板、新确认方言、新 Agent 类型），加重「功能杂」感。

需要一页 **正交、可检查、可叠加** 的能力本体，约束后续开发与文档，而不改 Extension↔Companion 双层拓扑或 LLM tool-loop 核心。

---

## 决策

### 1. 一句话定位

> **默认**：浏览器内 Agent（对话 → 页内操控）。  
> **更深作用面**：桌面 Host / 企业模块（opt-in）。  
> **场景叠加**：Mission Pack（+ Skill / Knowledge / MCP）——**不是**新 runtime。

### 2. 用户叙事（四层）↔ 架构映射

| 用户叙事 | 架构归属 | 说明 |
|----------|----------|------|
| **主体** — 浏览器内 AI / 网页问答 | **Surface L0** | 入口 UX；低 blast radius |
| **浅层** — 截图、页签、浏览、页内操作 | **Surface L1** | 浏览器沙箱内 |
| **中层** — MCP / Skill / Know / 外部 API | **Composition 组合面**（**不是**更深 Agent） | 可挂到任意 Surface |
| **深层** — Computer Use + 前述能力 | **Surface L2** × Composition | 同一 tool-loop；更严信任 |

**规范用语**：架构文档与代码评审中 **禁止** 裸用「中层 Agent」。应写 **组合面 / Composition** 或「Skill·Knowledge·MCP·Pack 装配」。README 若保留「主体→浅→中→深」，「中层」必须 **行内限定**（见上），不得仅靠脚注。

### 3. 三轴本体（规范）

#### Axis A — Surface（作用面）

物理/信任边界。更深 ⇒ 更大 blast radius ⇒ 更严门禁。

| 级别 | 产品标签 | 能触达 | 默认 UI |
|------|----------|--------|---------|
| **L0** | 聊 | 对话、附件；页面正文可作为 **用户附带文本数据** 进入上下文，但 **不发起 CDP/浏览器 tool 调用** | Side Panel |
| **L1** | 网页 | Tab / DOM / 导航 / 截图 / cookie 信任域 / 受门禁的 evaluate | Side Panel；用户可展开 Cockpit 工作区 |
| **L2** | 计算机 | `host_computer`、host_read/write、host_app、shell/netsec（enterprise） | 进行中的 CU：**Cockpit**（+ 可选 native HUD） |

**与代码别名**：产品 L0/L1/L2 **等价于** UI `CapabilityLevel`: `chat` | `browser` | `computer`（`mode-controller.ts` / UI 三模式 spec）。重命名枚举时必须同步本 ADR。

规则：

1. **单一 tool-loop runtime**（Companion LLM + tools）。L2 不是第二套 Agent 框架。  
2. **信任单调**：L2 不得继承 L0 宽松语义；`god-mode` / `auto_approve` **不得**静默跳过 CU 任务级 L2（[ADR-017](017-computer-use.md)）。**例外**：[ADR-021](021-unattended-desktop-session.md) 进程内「无人值守」grant 可跳过 **initial** L2（仅坐标白名单 App；非全局 bool 继承；危险 re-L2 仍强制确认）——属 Trust packaging，不是 Surface 降级。  
3. Linux / 不完整 Host 路径保持文档诚实：见 [ADR-018](018-host-use.md) Decision 6（写路径/nonce 等受限），不得假装全平台对等。

#### Axis B — Composition（组合面）

装配，不是深度。

| 原语 | 作用 |
|------|------|
| **Skill**（Type A） | 方法论 / prompt 模板 |
| **Knowledge** | 站点/全局/技能记忆 |
| **MCP**（inbound） | 外部工具服务器（`mcp__…`）— Companion 作 **client** |
| **Outbound MCP**（export） | 把 curated **Surface L1** 子集导出给外部编程 Agent（`cmspark__*`）— **门面，非新 runtime**（[ADR-022](022-outbound-mcp-server.md)；Phase 0 门控） |
| **user-env secrets** | shell/MCP 子进程密钥（[ADR-019](019-user-env-secrets.md)） |
| **Mission Pack** | 场景配方：skills + knowledge + tool_whitelist + system_prompt_append + modules — **非 runtime**（[ADR-014](014-mission-pack-enterprise-modules.md)） |
| **Capability modules** | 安装级开关（appsec / workspace / shell / netsec）+ `capability_profile` |

**明确不在组合原语内**（产品特性）：Obsidian 导出、NotebookLM 导入、Mermaid 渲染等 — 属聊天面导出/渲染，不参与「装配到线程」模型。

规则：

1. **新场景默认交付物** = Pack（+ 可选 1 skill 和/或 1 MCP server）。  
2. Pack **禁止**写入 `auto_approve_dangerous` / god-mode 等全局放宽键。  
   **例外（2026-08-06 Trust B / S46 lifecycle）**：仅 `origin=user` 用户场景可在顶层 `trust` 块声明，且仅 `pack.apply` / `pack.save_user`+apply 在 **`user_gesture` + `allowTrust:true`** 时写入全局；`spawn_worker` / install 路径 **不得**抬升 Trust。  
   **生命周期**：`unapply` / `uninstall` / 切换到无 trust 场景 / apply 失败路径必须 `restoreTrustSnapshot`；install 强制剥离 `origin:user`+`trust`（仅 `saveUserPack` 可持久化）。详见 [ADR-014](014-mission-pack-enterprise-modules.md) 修订注与 `docs/audit/reviews/multi-adversarial-review-20260806-main-s46.md`。  
3. 组合面可挂到 **任意** Surface（例：投研 ≈ L0 + 组合；AppSec 黑盒 ≈ L1 + Pack；桌面填单 ≈ L2 + skill）。

#### Axis C — Autonomy（自主度）

| 级别 | 含义 | 状态 |
|------|------|------|
| 单线程 tool loop | 默认 | 核心 |
| Multi-worker + tab lease | 编排、tab 排他 | P0 已交付（ADR-015） |
| Mission Board | Fact / Intent / Hint 共享板 | P0 已交付（ADR-016） |
| 推迟 | shared-observer、auto-spawn、真 `wait_workers` barrier、自由文本 `ask_user` | 明确 defer |

规则：

1. **高自主度 ≠ 深作用面**（多 worker 爬页仍可只在 L1）。  
2. **Spawn 仅 L2 HITL**，禁止静默 fan-out。  
3. **Board 仅归属 Autonomy**（协调状态，不是 Skill/MCP 式组合原语）。

#### 横切 — Trust / Channel（标签，非第四轴）

| 维度 | 取值示例 |
|------|----------|
| Trust | none · domain confirm · L2 · session-trust（ADR-017）· biometric/nonce（ADR-018）· enterprise session trust |
| Channel | `community` · `enterprise` |

不升为第四轴：Trust 大体随 Surface 单调；Channel 为安装级二元门。

### 4. 心智图

```text
                    ┌─────────────────────────────────┐
                    │      Composition plane          │
                    │  Skill · Knowledge · MCP        │
                    │  Pack · user-env                │
                    └───────────────┬─────────────────┘
                                    │ attaches to any surface
          ┌─────────────────────────┼─────────────────────────┐
          ▼                         ▼                         ▼
     ┌─────────┐              ┌─────────┐              ┌──────────┐
     │ L0 聊   │─────────────▶│ L1 网页 │─────────────▶│ L2 宿主  │
     │ Q&A     │   when needed│ CDP/Tab │    opt-in    │ CU/Host  │
     └─────────┘              └─────────┘              └──────────┘
          │                         │                         │
          └─────────────────────────┴─────────────────────────┘
                                    │
              Autonomy: single loop → multi-worker → Mission Board
              Trust:    strictness rises with Surface; Pack cannot relax globals
```

### 5. 场景坐标（示例）

| 场景 | Surface | Composition | Autonomy |
|------|---------|-------------|----------|
| 网页问答 / 写作 | L0 | optional skill | single |
| 填表、抓取、多 tab | L1 | skill/knowledge | single 或 multi-worker |
| AppSec / 黑盒 checklist | L1 | **Pack** + skills | single（或 workers） |
| Datayes 高级投研 | **L0 基线**；仅当 Skill/MCP **实际发起浏览器 tool** 时进入 L1 | Skill + MCP/API + knowledge | single |
| 读 Mail / 白名单 App | L2 host | optional | single |
| 自绘桌面坐标点击 | L2 computer | optional | single（实验定位器不得作写路径成功依赖） |
| 并行多站调研 | L1 | pack/skills | multi-worker + board |

**规范断言**：「高级」常常等于 **组合质量**（配方、数据契约、checklist），不等于必须 L2。

### 6. 能力声明清单（新 PR / Pack / 模块）

```text
Surface:      L0 | L1 | L2
L2-classes:   host_computer | host_read | host_write | host_app | shell | netsec | (none)
Compose:      skill | knowledge | mcp-server | pack | user-env | none
Autonomy:     single | multi-worker | board
Trust:        <gate>
Channel:      community | enterprise
```

**评审反模式：**

1. 无 Pack 替代方案却新增 Side Panel **一级常驻入口**（先问：能否 Pack + 底栏「更多」？）。  
2. 已有 L2 / 域门 / CU 门足够时，再发明确认方言。  
3. tool_whitelist + skill + pack 足够时，再发明「Agent 类型」runtime。  
4. 将实验定位器（如 TinyClick）当作写路径成功依赖。

### 7. 治理指标（止血「杂」）

| 指标 | 意图 | 基线种子 |
|------|------|----------|
| 一级 UI 入口数 | 优先「更多」/Pack | 以 Side Panel Header/BottomBar 常驻控件为准（发版时盘点） |
| 独立确认语义族 | 复用 SecurityConfirmationManager families | 以 companion 确认 `family` / tool 门分支为准 |
| 新 WS 消息族 / 新 runtime | 优先 Pack+tools | architecture §1.3 列出的主消息族（`chat.*` / `tool.*` / `config.*` / `skill.*` / `thread.*` / `history.*` / `security.confirmation.*` / `system.ping|pong` 等）为对照基线；新增族需 ADR 或本清单声明 |
| 文档：场景指南 vs 轴文档 | 用户按场景；架构按轴 | `docs/README.md` 导航分层 |

### 8. 与既有产物关系

| 产物 | 关系 |
|------|------|
| UI 三模式 | Axis A 产品标签 |
| ADR-014 | 组合叠加主路径 |
| ADR-015/016 | Axis C |
| ADR-017/018 | Axis A L2 + trust（含 session-trust） |
| ADR-019 | Composition 密钥 |
| GOAL 未交付扩展 | **G10** SSO → L1 + composition；**G11** Type B → composition + autonomy；**G12** Type C skill 形态 ≠ 已交付 worker 编排（需单独设计）；**G14** 历史重放 → autonomy；**G13** 已实现（skill-craft），不在 deferred 表 |

---

## 后果

### 正面

- 新能力有固定挂点，降低平行概念。  
- 用户叙事与架构轴可对齐且可检查。  
- Pack-first 与已交付 ADR-014 一致，加速场景叠加（投研、黑盒等）。

### 负面 / 成本

- README 与贡献 checklist 需维护轴语言。  
- 贡献者需在 PR 填声明字段（轻量）。  
- 不得把所有导出/渲染硬塞进 Composition。

### 不做

- 不改双层拓扑、不换 tool-loop、不强制 UI 大改。  
- 不在本 ADR 实现 G10–G12/G14。

---

## 文档落点

| 文档 | 要求 |
|------|------|
| 本 ADR | 规范源 |
| README | 短 ontology + 按 Surface 重组的能力矩阵 |
| architecture.md | 文首链到本 ADR 并摘要三轴 |
| GOAL.md | 本体段 + deferred 目标轴标注 |
| DESIGN.md | Mode badge = Surface |
| CONTRIBUTING | 声明清单 |
| docs/README.md | ADR-020 导航；修正过时「拟议 019 UI」 |
| [optimization-plan-post-adr-020.md](../optimization-plan-post-adr-020.md) | 后续工作排序权威（A–E） |
| PR template / dual-review checklist | `.github/pull_request_template.md` · `docs/audit/reviews/_templates/dual-review-capability-checklist.md` |

---

*Accepted 2026-07-29 after Claude + Pi dual review (both APPROVE_WITH_NITS); nits folded above.*

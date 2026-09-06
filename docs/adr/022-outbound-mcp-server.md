# ADR-022: Outbound MCP Server（对外编程 Agent 的 L1 浏览器面）

**日期**: 2026-08-04 | **状态**: **Accepted**（已交付：实验、非 default-on；禁扩默认 outbound profile，[#228](https://github.com/nehcuh/cmspark/issues/228) 已关）  
**相关**: [ADR-020](020-capability-model-three-axes.md) · [ADR-015](015-multi-agent-orchestrator-tab-lock.md) tab lease · [ADR-014](014-mission-pack-enterprise-modules.md) Pack · 用户 MCP 客户端指南 [mcp.md](../mcp.md)  
**过程 SoT（历史）**: [brief](../decisions/cmspark-as-mcp-server-brief-2026-08-03.md) · [adversary](../decisions/cmspark-as-mcp-server-adversary-synthesis-2026-08-03.md) · [dual-review](../decisions/cmspark-as-mcp-server-dual-review-synthesis-2026-08-03.md) · spike plan [2026-08-03-outbound-mcp-phase0-spike.md](../superpowers/plans/2026-08-03-outbound-mcp-phase0-spike.md)  
**双审**: Claude + Pi **APPROVE_WITH_NITS**（`docs/audit/reviews/cmspark-mcp-server-strategy-*-20260803-150011*`）；nits 已并入本 ADR 决策 L1–L9

> **规范优先级**：本 ADR 为 Outbound MCP **决策 SoT**。brief 保留为过程件；实现细节与白名单以代码 `companion/src/outbound-mcp/` + spike plan 为准，冲突时以本 ADR 的锁与非目标为准。

---

## 背景

CMspark 已有稳定 **L1 浏览器 Agent**（Extension + Companion + 域确认 / L2 / 配对 / 审计）与 **MCP 客户端**（`companion/src/mcp/`：连外部 server，工具名 `mcp__…`）。自然产品问题：

> 能否把同一浏览器作用面暴露给 **外部编程 Agent**（Claude Code、Cursor、Grok Build、Kimi 等）——通过 MCP 和/或 Skill？

市场已有：

| 原型 | 代表 | 与我们的关系 |
|------|------|----------------|
| A 无状态自动化 | Playwright MCP | **不竞争** CI/headless |
| B 官方调试面 | Chrome DevTools MCP | **互补**（perf / network / inspect） |
| C 真实日常 Chrome + 扩展 | Browser MCP、mcp-chrome、AgentDesk 等 | 红海；仅 **Trust + HITL + Pack + 审计** 可差异化 |
| D 云隐身浏览器 | 商业 stealth | 范围外 |

**Repo 事实（决策时）**：

- Companion 仅为 MCP **client**，无 outbound server 产品面  
- `ws_secret` 鉴权 **Extension↔Companion**，**不等于** MCP caller 鉴权  
- 确认台偏 Side Panel / Cockpit；IDE 驱动时 Side Panel–only 确认不足  
- Tab lease（ADR-015）可复用，勿另造锁  

需要一页 **可检查、可门控** 的决策：对外导出什么、禁止什么、Phase 0 如何证伪、与 ADR-020 如何贴合——**不是**「再做一个通用 Browser MCP」。

---

## 决策

### 1. 一句话定位

> **不要**交付通用「更好的 Browser MCP」。  
> 若对外导出：为编程 Agent 提供 **可租用、可拒绝、可审计的 L1 浏览器面**——补 Playwright（无状态自动化）与 DevTools MCP（调试环）——且 **仅在 Phase 0 证明「已登录会话不可替代」之后才扩面**。

**产品主叙事是已登录 Chrome + 硬闸**（2026-08-26 形态深化：Side Panel 是 Operate 面，不是家；用户面称 Outbound 为 **租手**，勿与 ACP「编程接力 / Coding Handoff」混名）。Outbound MCP 仍是 **Composition 对 Surface L1 的导出门面**，不是第二产品身份，不是新 runtime，禁止写成「中层 Agent」。L3–L9 物理不因叙事句改写而放宽。

### 2. ADR-020 坐标（能力声明模板）

```text
Surface:      L1（outbound 默认导出）；L2 永不进 default outbound profile
L2-classes:   （默认无）host_* / shell / netsec 禁止进入默认集合
Compose:      mcp-server（outbound 门面）+ 可选 skill（adoption）+ 可选 pack（场景）
Autonomy:     outbound 单调用方；multi-worker / Board 保持内部，除非另案设计
Trust:        域确认 + L2 确认 + 配对；产品 ship 前必须有 MCP-caller grant
Channel:      community 默认；enterprise 模块不进 default outbound set
```

| 轴 | 放置 |
|----|------|
| **Composition** | Outbound MCP = 在 profile 下导出既有工具（门面，非新 loop） |
| **Surface** | 默认仅 curated L1 子集（比内部 L1 更窄） |
| **Autonomy** | 非新编排器；无静默 fan-out |
| **禁用语言** | 「中层 Agent」/「第二 runtime」 |

### 3. 锁定决策 L1–L9

| ID | 锁 |
|----|-----|
| **L1** | 无 Phase 0 对「已登录不可替代」的证伪，**不做** all-in 通用 Browser MCP。 |
| **L2** | 主叙事 = 已登录 Chrome + 硬闸（Side Panel = Operate；Outbound = 租手 / Composition 导出 only）。**不是**第二产品身份。 |
| **L3** | 默认 outbound profile = **策展 L1 子集**。默认禁止：cookies、evaluate、L2（host/CU）、shell、netsec。 |
| **L3+** | 返回 **页面正文 / 截图 / DOM 快照** 给第三方 LLM 的工具属 **数据外泄类**。默认拒绝或要求 **按会话/任务 disclosure** 后才启用。隐私文案不得在此类工具向云模型流式传输时宣称「仅本地」。 |
| **L4** | **MCP caller 不可信。** 门禁按 **操作风险**，从不按「来自 MCP 即放行」。 |
| **L4+** | **Loopback / stdio / parent PID ≠ 鉴权。** Grant 模型（per-caller token、签名 grant、或用户粘贴 client secret — 设计阶段选定）是 **P1 发货门**。Phase 0 **不得**实现 confirm-skip。 |
| **L5** | **Skill = 仅 adoption**（何时/如何/哪些工具）。能力本体 = MCP（或等价 tool 协议）。Outbound 工具命名空间优先 **`cmspark__*`**，避免与 Playwright MCP 撞名。 |
| **L6** | CI / headless 是 Playwright 地盘 — 不把 CMspark 定位到那里。 |
| **L7** | Phase 0 成功标准：在 **已登录 / SSO** 任务上 CMspark 为唯一可行或明显更优；公网/localhost 干净任务可输给 Playwright。 |
| **L8** | 确认 UX 是产品。凡 outbound **可写/需确认** 路径：每次需确认的调用 **必须** 在不要求 Side Panel 聚焦时暴露 allow/deny（托盘通知、全局入口、或强制聚焦）。**仅 Side Panel 确认对 IDE Agent 不足。** |
| **L9** | 交互型 outbound profile **强制双入口 tab lease**：复用 [ADR-015](015-multi-agent-orchestrator-tab-lock.md)；Side Panel 与 MCP 不得互抢同一 tab。冲突默认：**Side Panel 赢**，MCP 排队并披露。交互 Phase 0 任务前必须具备，否则 bake-off 指标无效。 |

> **L4+ 实现期细化（2026-08-31，commit `123eaf2b`）——exfil grant 双轨语义**：外泄类工具（L3+）的 grant 旗标按 transport 分轨判定。**HTTP 轨**（`companion-http.ts`）：调用方持已认证的 `grant_id`，**按钥匙本身**判定——只有该 grant 自己的 `allow_page_export` 授权外泄，与 grant-cli 对操作员承诺的「这把钥匙」一致。**stdio 轨**（`bridge.ts`/`facade.ts`）：无 grant 凭证可用，**按 caller** 判定——caller 名下任一存活带旗 grant 即放行。操作员 HITL 会话（`hasOutboundDisclosure`）在两条轨上**仍按 caller_id** 键控（有意的不对称：旗 per-key、HITL per-caller）——一次操作员批准武装该 caller 的会话，而持久外泄同意在 HTTP 轨上保持 per-key。caller 自报 `disclosure_accepted` 与 HTTP/stdio acknowledge **均不**满足此外泄门。`grant_id` 只来自认证通过的 Bearer grant，永不读请求 body；`caller_id` 与 grant 绑定（`GRANT_CALLER_MISMATCH`）。

> **L5 实现期细化（2026-09-06）——stdio `tools/list` 短名**：L5 的 `cmspark__*` 仍是 **canonical / HTTP / 文档名**。MCP stdio `tools/list` 只暴露后缀（`list_tabs`），让把工具写成 `server__tool` 且只允许一个 `__` 的客户端（Grok）得到 `cmspark__list_tabs`。旧版把 canonical 名直接放进 `tools/list` 时，Grok 会变成 `cmspark__cmspark__list_tabs` 并 **丢掉全部工具**（会话 `tool_count: 0`；`grok mcp doctor` 仍数 10）。`CallTool` 短名与 `cmspark__*` 都收。不扩 default outbound profile。

### 4. 默认工具面（Phase 0 profile）

实现权威：`companion/src/outbound-mcp/profile.ts`。概念白名单（6–8 个，可微调但不得默默塞入禁类）：

| 工具（MCP 名） | 说明 |
|----------------|------|
| `cmspark__list_tabs` | 定向，无 DOM dump |
| `cmspark__navigate` | L1 导航（域策略需确认时确认） |
| `cmspark__click` / `cmspark__type` | 交互 L1 |
| `cmspark__wait_for` | 稳定 |
| `cmspark__downloads_find` | Downloads 只读检索（无路径逃逸） |
| `cmspark__get_page_text` / `cmspark__screenshot` | **外泄类** — L3+ disclosure |

**硬禁（default profile）**：`cookies*`、`evaluate`、`host_*`、`shell_*`、`netsec_*`、`osascript_*`、内部-only 工具、把 inbound MCP 再透传出去。

### 5. 安全接线（代码 DoD，门面存在时）

1. 凡 outbound 触发的 `securityConfirmations.request` **必须**绑定 `{ originWs: <mcp-bound 或 synthetic origin> }`（与 P1-2 originWs 纪律一致）。  
2. **审计**：每次 outbound tool 调用一条结构化记录（caller id、tool、domain、confirm outcome）；建议落 `logs/` 或既有 capability-audit 族，mode 0o600。  
3. Phase 0 transport：**stdio only**；任何安装路径 **非 default-on**。  
4. 外泄类工具：`disclosure_accepted` **须由 Companion 会话状态强制**，不得仅信任 MCP 参数自报。  
5. 单一工具注册表生成 internal + MCP schema，**禁止**双写漂移（中期目标；Phase 0 可显式 map `cmspark__X` → 内部名）。

### 6. Phase 0 实验协议（证伪门）

| ID | 任务 | 期望 |
|----|------|------|
| **T1** | 用户 Chrome **已登录** 内网/SSO 页 | CMspark 应赢或唯一可行 |
| **T2** | localhost PR 预览（干净环境可） | Playwright 赢可接受 |
| **T3** | 公网页 | Playwright 赢可接受 |

**T1 主指标（草案，spike plan 可微调阈值）**：

| 指标 | 门槛 |
|------|------|
| 完成率 | 时限内 ≥ 80%，无人工改浏览器手术 |
| 确认超时 | 可操作的 MCP error，不挂死 |
| 无 Side Panel 聚焦的确认 | 有 tray/全局路径时 ≥ 90% 在 &lt;45s 内解决；**无路径则仅测 fail-closed**，确认负担指标作废 |
| 审计完整率 | 100% |
| Profile 违规 | **0** 次禁工具成功调用 |

**Fail →** 枢轴 Option B（只读观测 MCP）或 C（垂直 Pack 形 API）；**禁止**在 T1 失败时扩通用自动化面。  
Bake-off 默认非敏感页；敏感页须显式 disclosure（L3+）。

### 7. 分阶段路线图（实现门控）

| 阶段 | 交付 | 门 |
|------|------|-----|
| **P0a** | 决策文档（brief → **本 ADR**） | dual-review 已过 |
| **P0b** | Spike plan：白名单、指标、disclosure 文案 | L1–L9 |
| **P0c** | stdio 门面 + 真桥；L8 tray/全局确认；L9 lease；originWs；L3+ 会话 disclosure | DoD checklist 全绿 |
| **P0d** | T1–T3 vs Playwright MCP bake-off | L7 指标 |
| **P1** | Grant 模型（L4+）；interact profile；安装文档；仍非 default-on | 另 dual-review |
| **P2+** | Pack 场景；可选观测扩面；CWS/分发仅在 trust 故事站得住之后 | 另 dual-review |

**安装 / CWS：v0 明确非目标** — Phase 0 不假设 sideload 摩擦已解决。

### 8. 选项冻结

| 选项 | 含义 | 状态 |
|------|------|------|
| **A** | 本 ADR + Phase 0 bake-off；无产品 ship | **SELECTED** |
| **B** | 仅观测 MCP（console/network/DOM/截图读路径） | Phase 0 **fail → pivot** |
| **C** | 仅垂直 API（如 AppSec Pack 形） | Phase 0 fail 备选 pivot |
| **D** | 暂不对外 MCP | 仅当 T1 失败或 trust DoD 不可达 |

### 9. 明确非目标（v0）

1. 经 MCP 导出 **完整** 内部工具目录  
2. 默认导出 Computer Use / Host / shell / netsec / cookies / evaluate  
3. 用 outbound 取代 Side Panel 作为主产品  
4. 云多租户「浏览器 SaaS」  
5. 在截图/页面向第三方 LLM 无限制流式传输时宣称本地隐私  
6. 仅 Skill、无 MCP 本体充当「给外部 Agent 的浏览器服务」  
7. 在 CI/headless E2E 上与 Playwright 抢定位  

### 10. 设计评审必查盲点

1. 恶意 / 多 MCP 客户端；确认疲劳 → 一键全开  
2. 云上下文外泄（页文、截图）  
3. 无 L9 的双 Agent 抢 tab  
4. Companion 重启 / Extension SW 休眠 / stdio 父进程死亡  
5. 商店分发 vs sideload 摩擦  
6. 品牌稀释（「又一个 browser MCP」）  
7. 企业合规（OA / 邮件自动化）  
8. 工具命名碰撞 — `cmspark__*`  
9. 注册表双写债务  

---

## 后果

**正面**

- 编程 Agent 可租用 **用户已登录 Chrome**（SSO / cookie / 打开页签），与 Playwright 干净 profile 形成互补 JTBD。  
- 差异化落在 **拒绝权、确认台、审计、Pack**，而非工具数量军备。  
- 与 ADR-020 一致：导出 = Composition，不发明 runtime。  
- Phase 0 证伪失败有明确 pivot，避免沉没成本做成 C 类克隆。

**代价 / 风险**

- 安装链（Companion + 扩展配对 + MCP JSON）重于 `npx` 轻量 MCP。  
- IDE 场景下 L8 确认 UX 是 **新产品工作**，非接线副产品。  
- 双入口（Side Panel + MCP）争用 tab，必须 L9 否则 bake-off 失真。  
- 外泄类工具与「本地隐私」叙事张力，须披露诚实。  
- `ws_secret` 不能误用为 MCP 鉴权（L4+）。

**维护**

- 改默认 allowlist / 禁类 / grant 语义：同步本 ADR + spike plan + `outbound-mcp/profile.ts` + 用户文档（发货时）。  
- brief / adversary 过程件 **不得**单独改锁而不改本 ADR。

---

## 拒绝的方案

| 方案 | 原因 |
|------|------|
| 全量工具目录 MCP 化 | 商品化 + 外泄面爆炸；违反 L1/L3 |
| Skill-only「浏览器服务」 | 外部 Agent 无法可靠驱动 CDP；违反 L5 |
| 默认导出 L2 / shell / cookies | Trust 单调与企业模块边界 |
| stdio/loopback 即信任 | 违反 L4+；多客户端/劫持面 |
| 与 Playwright 抢 CI/E2E 定位 | 违反 L6；必输红海 |
| Phase 0 跳过 L8/L9 却宣称交互 bake-off 有效 | 指标无效；违反 L8/L9 |

---

## 实现地图（截至 ADR 落地）

| 路径 | 职责 | 状态 |
|------|------|------|
| `companion/src/outbound-mcp/profile.ts` | 默认 allowlist / 外泄类 / `cmspark__*` map | skeleton |
| `companion/src/outbound-mcp/facade.ts` | gate + disclosure 门 + tools list | skeleton（**无** live WS 桥） |
| `companion/src/outbound-mcp/audit.ts` | outbound 审计行 | skeleton |
| `companion/tests/outbound-mcp-facade.test.ts` | 门禁单测 | 有 |
| stdio MCP entry / CLI | `tools/list` + `tools/call` 接 façade | skeleton ✅ |
| Live bridge → 内部 tool 调度 | loopback HTTP + createToolExecutor | ✅ P0c |
| Tray/全局确认（L8） | 托盘优先 + 全面板 fan-out + OS notify；超时 `OUTBOUND_CONFIRM_REQUIRED` | ✅ 代码路径 |
| Tab lease 双入口（L9） | `outbound_mcp:<caller>` lease；Side Panel 赢 | ✅ 代码路径 |
| Grant 模型（L4+） | per-key grant（`outbound-grants.ts`：32B 随机 token、sha256 存储、revoke/expiry）+ exfil 双轨判定（见 L4+ 修订注） | ✅ 代码路径（2026-08-31） |

**Inbound** MCP 客户端栈（`companion/src/mcp/`）保持不变：用户仍可把外部 server 接到 Side Panel Agent。

---

## 变更日志

| 日期 | 变更 |
|------|------|
| 2026-08-03 | 方向：多路对抗 + dual-review APPROVE_WITH_NITS；brief DIRECTION LOCKED |
| 2026-08-03 | P0b spike plan + P0c façade skeleton（profile/gate/audit） |
| 2026-08-04 | **本 ADR Accepted**：brief 升格为决策 SoT；实现仍按 Phase 0→P1 门控 |
| 2026-08-04 | 实现闸门：Eval Engineering skill + [P0c eval gates](../superpowers/plans/2026-08-04-outbound-mcp-p0c-eval-gates.md)（M1–M9 · T3 dual） |
| 2026-08-04 | 场景应用（非本 ADR 规范）：[Daily Content Loop brief](../decisions/daily-content-loop-brief-2026-08-04.md) — 定时情报环用 L1 采集，非 L2/值守 |
| 2026-08-31 | L4+ grant 语义修订：exfil 判定双轨化（HTTP per-key / stdio per-caller；HITL 会话仍 per-caller），commit `123eaf2b`；补 L4+ 修订注 + 实现地图 Grant 行 |

---

*Accepted · Outbound MCP = Composition export of curated L1 · not a second product runtime.*

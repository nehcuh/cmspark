# CMspark Deep Diagnosis Fanout Report (2026-07-28)

**Project:** CMspark — 浏览器内 AI Agent（Chrome Extension + 本地 Companion）  
**Mode:** Multi-dimensional fanout re-audit + documentation health  
**Versions:** companion / chrome-extension **0.3.0**  
**Prior audits:** 2026-06-16 · 2026-06-23 · 2026-07-09 (4.4/C) · **2026-07-25 (5.8/C+)**  
**Method:** 5 parallel explore agents (docs inventory · architecture/security · tests/CI/release · feature↔docs drift · proposal/RFC decay) + host spot-checks  
**Companion plan:** [docs-reorg-plan-2026-07-28.md](../docs-reorg-plan-2026-07-28.md)

---

## Executive Summary

相对 **2026-07-25**，代码与发布面显著变强：P0-A–D 批次关闭了选择器注入、`config.updated` 预鉴权泄露、computer-use session-trust 旁路、聊天 orphan / stream 错线程、Stop≠abort、打包 soft-missing host 等 **High 簇**。CI 仍硬门禁 companion/extension tests + supply-chain + package gates。整体建议从 **5.8 / C+ 上调至约 6.9 / B-**。

但 **文档与产品真实表面严重脱节**：

1. **README** 仍停留在「MVP + Skills + Knowledge + Daemon」，对 MCP / Confirm Center / Mission Pack / Computer·Host Use / Multi-agent·Board / NotebookLM / Obsidian 导出 / Mermaid 等已交付能力 **几乎沉默**，且 FAQ 仍写 evaluate「等待确认机制完成后开放」（**事实错误**）。
2. **`docs/TESTING.md`** 仍描述 4 个测试文件；实际 companion **~125+**、extension **25**。
3. **`docs/GOAL.md` G8** 仍把已删除的 risk-engine / privilege-manager 写成现役安全层。
4. **`docs/adr/016`** 状态写「尚未实现产品代码」，而 `companion/src/board/` + tools + UI 已落地。
5. **`docs/` 约 300+ markdown 产物**，其中 **decisions + audit/reviews ≈ 体量主体** 为过程考古，淹没了少数仍准确的用户指南（`mcp.md`、`mission-pack-usage.md`、`confirm-center-user-guide.md`、`TROUBLESHOOTING.md`）。

**一句话**：代码与 CI 已进入 B- 区间；**文档层仍是 C- 的信息架构债务**，是下一阶段「可维护 / 可上手 / 可审计」的主瓶颈。文档重梳计划见配套文档。

---

## Score Dashboard

```
Security         ███████░░░  7.0  B
Stability        ██████░░░░  6.0  C+
Performance      ███████░░░  7.2  B   (继承 07-25；未重测)
Testing          ███████░░░  7.5  B
Maintainability  █████░░░░░  5.5  C+
Design           ██████░░░░  6.0  C+
Release          ████████░░  8.0  B+
Documentation    ███░░░░░░░  3.5  D+   ← 本次主扣分
Computer-Use     ██████░░░░  6.5  C+   (相对 07-25 的 5.0 上调)
─────────────────────────────────────
Overall          ███████░░░  6.9  B-
```

| Dimension | 2026-07-09 | 2026-07-25 | **2026-07-28** | Δ vs 07-25 |
|-----------|------------|------------|----------------|------------|
| Security | 3.5 | 6.0 | **7.0** | +1.0 |
| Stability | 3.5 | 5.2 | **6.0** | +0.8 |
| Testing | 3.5 | 5.2 | **7.5** | +2.3 |
| Maintainability | 6.0 | 4.8 | **5.5** | +0.7 |
| Design | 5.5 | 5.5 | **6.0** | +0.5 |
| Release | 3.0 | 4.5 | **8.0** | +3.5 |
| Computer-Use | n/a | 5.0 | **6.5** | +1.5 |
| **Documentation** | n/a | n/a | **3.5** | NEW |
| **Overall** | **4.4 / C** | **5.8 / C+** | **~6.9 / B-** | **+1.1** |

### Finding Statistics（开放项，去重）

| Severity | Count | 备注 |
|----------|------:|------|
| **Critical** | **0** | 同 07-25 |
| **High** | **~3–4** | 主要为 god-mode 无 companion step-up；文档层「错误事实」单列 |
| Medium | ~15–20 | evaluate 完整性、MCP originWs、shell 结构、无浏览器 e2e 等 |
| Low | ~15 | Node 20 vs 22、lint 缺、版本号混乱 |
| **Docs debt (separate)** | **P0 事实错误 + 大面积 underclaim + 过程噪音** | 见 reorg plan |

---

## Architecture Map（代码真实，非文档）

### Companion `companion/src/`

| 区域 | 路径 | 角色 |
|------|------|------|
| 控制面 | `server.ts` (~5.3k), `message-router.ts` (~2.1k), `ws-auth.ts` | WS 鉴权、工具调度、L2、广播 |
| 安全 | `security.ts`, `security-policy.ts`, `security-confirmation.ts` | 域匹配、确认队列、HMAC |
| 浏览器工具 | `bridge/` | schema / tab resolver |
| LLM | `llm/` | streaming + tool loop |
| 桌面 | `computer/*`, `host-use/*` | 坐标注入、TinyClick、宿主 COM/AX |
| 企业 / Pack | `capability/*`, `packs/*`, `netsec/*` | modules、shell、workspace |
| 多 Agent | `orchestrator/*`, `board/*` | tab lease、fleet、mission board |
| Apps / HUD | `apps/*`, `hud/*` (spike), `tray/*` | 应用白名单、托盘、HUD 试验 |
| MCP / 其它 | `mcp/*`, `skills/*`, `obsidian/*`, `threads/*`, `history/` | |

### Extension `chrome-extension/src/`

| 区域 | 路径 |
|------|------|
| Service Worker / CDP | `background/*` |
| Side Panel | `sidepanel/*`（Chat、Packs、Board、Apps、MCP、Knowledge…） |
| Cockpit | `cockpit/`, `tabs/cockpit.tsx` |
| NotebookLM | `notebooklm/*` |

拓扑：`Extension ↔ WS 127.0.0.1:23401 ↔ Companion`；桌面能力走 **host 二进制 / 脚本**，非 CDP。

---

## 07-25 High 复检（代码）

| ID | 标题 | 07-28 状态 |
|----|------|------------|
| SEC-1 | 选择器注入 → page RCE | **FIXED**（`selectorJsLiteral` / `JSON.stringify`） |
| SRV-1 | `config.updated` 预鉴权泄露 | **FIXED**（仅 authenticated + redact） |
| COMP-1 | macOS 客户端坐标当屏幕坐标 | **FIXED** |
| COMP-2 | session-trust 跳过 danger/TinyClick 再确认 | **FIXED**（re-L2 / force-interactive） |
| EXT-1 | stream 忽略 `thread_id` | **FIXED** |
| XC-Int-1 | 剥 nonce / thread-whitelist | **FIXED** |
| XC-Cor-4 | Stop ≠ computer abort | **FIXED** |
| XC-Cor-1/2/3 | tool orphan / partial done | **FIXED** |
| OPS-2 | soft-missing `cmspark-host` | **FIXED**（package hard-fail） |
| H11 | god-mode 无 companion step-up | **仍开放** |
| H14/15 | docs / originWs 不一致 | **部分**（MCP 仍常不绑 originWs） |

---

## 跨切面发现（摘要）

### Security — 仍开放 High/Med

1. **[H] God-mode / auto-approve 可被已鉴权 `config.set` 布尔武装**（UI 短语多为剧场；companion 无二次 step-up）。`message-router.ts`。
2. **[M] MCP L2 常省略 `originWs`** — 多 peer 卫生债务。
3. **[M] evaluate 批准后仍 `sanitizeText` 改写 JS** — 完整性/静默破坏。
4. **[M] `shell_exec` + `shell: true` + 前缀 allowlist** — 结构上弱于完整 shell 策略（已 enterprise + L2 缓解）。
5. **[M] Darwin occlusion 检查参数未真正门控注入体**。
6. **[M] 无 Developer ID / 公证 / Authenticode**。

### Testing / CI / Release

- **Testing 7.5**：suite 强（安全 / computer / packs / board / MCP / real-WS integration），**文档严重滞后**。
- **CI 硬门**：tests、systray2/TinyClick verify、package gates、prod audit。
- **Release 8.0**：fail-closed host/tray/Windows ORT；release matrix 三平台；**不 codesign**。
- **缺口**：**无浏览器 e2e**；无 coverage 门槛；release job 不重跑 unit tests；CI Node 20 vs 打包 Node 22。

### Maintainability / Design

- 叶子模块（computer、board、orchestrator、packs）边界清晰。
- **`server.ts` 仍是 god-object**；L2 策略分散编码（evaluate / host_computer / shell / MCP / board 各自判断）。
- 多控制面：Side Panel Stop / SafetyStrip / Cockpit / tray L2 — 正确性已改善，认知负担高。

### Documentation — 主风险面

| 问题 | 证据 |
|------|------|
| README underclaim | 无 MCP / Pack / CU / multi-agent / NLM / Mermaid / Obsidian 导出 / Cockpit |
| README 事实错误 | FAQ evaluate「等待确认完成后开放」；阶段仅写 MVP；包示例 v0.2.0 |
| GOAL 过时 | G8 risk-engine / privilege-manager |
| ADR-016 状态错 | 「尚未实现」vs `board/` 已存在 |
| architecture §4 | phantom 路径 + 省略 computer/host/orchestrator/mcp/packs/apps/board |
| TESTING.md | 4 files vs 150+ |
| 过程噪音 | `docs/decisions` ~180 + `docs/audit/reviews` ~142 淹没用户入口 |
| 缺失用户指南 | computer-use、host/apps、notebooklm 仅有 ADR/decisions |

---

## 能力矩阵（产品 vs 文档）

| 能力 | 代码 | README | 其它文档 | Gap |
|------|------|--------|----------|-----|
| 浏览器 CDP 工具 | ✅ | ✅ | GOAL / arch | 工具数量过时 |
| 多线程 | ✅ | ✅ | | 对齐 |
| Skills / craft | ✅ | ✅ | ADR-004 | `sub_agent` 易误解 |
| Knowledge / site | ✅ | ✅ 强 | | 对齐 |
| Cookie 信任域 | ✅ | 部分 | ADR-005/007 | 缺 auto_approve 说明 |
| Confirm / Cockpit | ✅ | ❌ 且 FAQ 错 | confirm-center 指南 | **P0** |
| MCP | ✅ | ❌ | `mcp.md` | **P0 link** |
| Mission Pack + enterprise | ✅ | ❌ | mission-pack-usage + ADR-014 | **P0 link** |
| Computer / Host Use | ✅ | ❌ | decisions 海量 | **缺用户指南** |
| Multi-agent / Board | ✅ | ❌ | ADR-015/016 + pack §10 | **underclaim + ADR 状态** |
| Obsidian 导出 | ✅ | 仅 vault 导入 | ADR-008 | underclaim |
| Mermaid | ✅ | ❌ | ADR-009 | underclaim |
| NotebookLM 导入 | ✅ | ❌ | ADR-011–013 | 缺用户指南 |
| Apps / 白名单 | ✅ | ❌ | decisions | underclaim |
| Daemon / Tray / 配对 | ✅ | 部分 | CLAUDE A8 | 配对与 Swift tray 描述滞后 |
| PDF / 文件上传 | ✅ | ❌ | 零星 | underclaim |
| HUD | spike | — | superpowers plan | 勿当已交付 |

---

## Prioritized Action Plan

### P0 — 立即（文档事实 + 导航）

1. 修正 README FAQ / 阶段表述 / 版本示例；补能力矩阵 + 链到已有指南。
2. 修正 GOAL G8、ADR-016 状态、architecture 目录树中的 phantom / 缺模块。
3. 重写 TESTING.md 测试地图。
4. 建立 `docs/README.md` 文档导航（用户 / 架构 / ADR / 工程 / 归档）。

详见 → [docs-reorg-plan-2026-07-28.md](../docs-reorg-plan-2026-07-28.md)。

### P1 — 代码安全残余（非本次文档任务默认范围）

1. companion 侧 god-mode / 危险 flag 的 step-up 或 re-auth。
2. MCP confirm 统一 `originWs` 绑定。
3. evaluate 批准后路径的完整性（避免再改写已批准源）。
4. shell_exec 策略收紧（避免仅靠 `shell:true` + 前缀）。

### P2 — 工程卫生

1. 浏览器级 smoke e2e（至少：连 Companion → 一发消息 → 一工具 → 确认弹窗）。
2. coverage 报告（先观测，后设门槛）。
3. CI Node 与打包 Node 对齐或文档明示差异。
4. ADR-017 computer-use / ADR-018 host-use / UI modes ADR。

### P3 — 归档浪潮

1. `git mv` decisions scrap、closed RFCs、tournament losers、sprints → `docs/archive/`。
2. 禁止主导航链到 process dump。

---

## Method Notes & Confidence

| 区域 | 证据级别 |
|------|----------|
| 模块树 / 版本 / 测试计数 | `[inspected]` 目录与 package.json |
| 07-25 High 关闭 | `[inspected]` 代码路径 + 审计 artifact；**未**重放攻击 PoC |
| 分数 | 相对 07-25 的 **合成判断**，非独立评分委员会 |
| RFC 实现完整度 | 多数靠 test 文件名 + 源码 spot-check；个别可能仍有 open nits |

---

## Bottom Line

- **代码安全与发布：显著改善，进入 B-。**
- **文档：仍是 D+，是当前最拖后腿、且 ROI 最高的系统性工作。**
- **下一动作：** 执行配套文档重梳计划（先修错误事实与 README，再补缺失用户指南，再归档过程噪音），勿在未归档前继续在 `docs/decisions` 堆积新的「主文档」。

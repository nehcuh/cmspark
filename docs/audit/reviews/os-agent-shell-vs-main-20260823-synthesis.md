# OS Agent Shell vs `origin/main` — 五路独立对抗合成

| Field | Value |
|-------|--------|
| Base | `origin/main` `fc187257` |
| Head | `feat/os-agent-shell` `659bbce` **+ dirty tree** |
| Lanes | ARCHITECTURE · SECURITY · CORRECTNESS · PRODUCT-UX · CODE-QUALITY |
| 五路 VERDICT | 全部 **REJECT** |
| Machine | Correctness `[executed]`: companion tsc 0, 156 tests 0 fail; extension overlay-standby 18/18 |
| Prior 20260823 reviews | 五路均未读取（独立） |

原文：

- Architecture: `os-agent-shell-vs-main-20260823-architecture.md`
- Security: `os-agent-shell-vs-main-20260823-security.md`
- Correctness: `os-agent-shell-vs-main-20260823-correctness.md`
- Product-UX: `os-agent-shell-vs-main-20260823-product-ux.md`
- Code-quality: `os-agent-shell-vs-main-20260823-code-quality.md`

---

## vs main 实际多出来的能力

相对 main（只有 Side Panel + tray 确认/配对，**没有** OS 捕获 overlay）：

| 能力 | 状态 |
|------|------|
| 关 Chrome 对同一 thread 发 L0 | **有**（idle 默认不再 `thread.create`） |
| L1 不打回 tray/summoner socket（S19） | **有**，相对 main 是真修复 |
| Overlay 不渲染 Allow/Deny | **有** |
| `#` 标题检索 + select hydrate | **有**（1-hit 会偷偷改 `summonerThreadId`） |
| 双 composer lease | **半真**：会 claim/release/broadcast，**换 thread 泄漏** |
| 全局热键 | **opt-in**（托盘「召唤器快捷键…」/ 窗内「快捷键」） |
| S23 窗坐标硬拒 | **半真**：click/scroll/drag 有 hit-test；config 默认仍把 `cmspark-tray` 当 self-UI continue |
| `L2_CONDUCTOR_ELSEWHERE` | **有**（host_computer LIVE） |

规模：相对 main ~+10k 提交行 + 未提交 ~+900。`Tray.swift` main **1229** → 工作区 **~2708**。

---

## 交叉共识（≥2 路独立出现 · 编排者核验）

| ID | 共识 | 路 | 核验 |
|----|------|----|------|
| **X1** | **S19 相对 main 成立**。`forwardL1OrUnavailable` + `pickAuthenticatedClientWs`。 | A, S | `[inspected]` |
| **X2** | **Lease 换 thread 泄漏**。`hydrateSummonerThread` 对**新** id claim，不 release **旧** id。关闭只放当前 `summonerThreadId`。`#` 选中/新对话后，旧 thread 的 Side Panel 可永久 `OVERLAY_STANDBY`。 | A, C | `menu-bar-agent.ts:627-638,678-683,754-758` |
| **X3** | **S21 仍是客户端自报 `surface`**。省略 → 全权 tray。stdin `saveConfig` 绕过 `config.set` 拒绝。 | A, S | `[inspected]` |
| **X4** | **S23 未关**。`isCompanionUiOwner` 不再硬编码 tray，但 `config.ts:447` 默认 `companion_ui_exe_basenames` **含 `cmspark-tray`** → executor 仍 continue。测试用的 allow-list 不含该名。 | S（主），A 附和 | `config.ts:444-447` + `executor.ts:1614` |
| **X5** | **Tray.swift 神文件**。main 1229 → ~2708。TS protocol 不驱动 Swift。Overlay 测试大量 grep。 | A, Q, C | `[executed]` wc / grep tests |
| **X6** | **未连接 CTA 被焊死**。`ctaBox.isHidden = true`。用户手势拉 Chrome 的门从 overlay 消失（产品选择 vs S13 门）。 | A, P | `Tray.swift:2226` |
| **X7** | **入口/文案不诚实**。占位「按住说话」但麦强制隐藏；热键非默认，入口只在托盘。 | P | `[inspected]` |

---

## MERGE

**NO。** MACHINE 绿 ≠ 身份 2 的 SoT（lease）正确。T3 S23 配置仍 continue。五路均 REJECT。实现会话不得自评放行。

**相对 main 值得保留**：S19 执行器拆分、ACL 形状、`hydrate.ts`、lease 数据结构、S23 rect 模块、L2 conductor 模块。

**合 main 前最小 BLOCK**：

1. 换 thread / 关窗：release **所有** overlay-held leases，或 claim 前 release 旧 id。
2. 生产默认 `companion_ui_exe_basenames` 去掉 `cmspark-tray`，或 FG yield 到 tray 时 **禁止** continue（必须 re-L2 或硬拒）。
3. 占位符与隐藏麦对齐；空场可发送（detached 不要藏「发送」若仍宣称 L0 可用）。

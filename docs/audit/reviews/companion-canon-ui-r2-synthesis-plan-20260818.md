# Companion-canon UI R2 — 对抗 + Claude/Kimi/Pi 选择 · UI/UX 优化计划

**Batch**: `companion-canon-ui-r2`  
**Date**: 2026-08-18  
**Blast**: T2  
**Machine**: `tsc` 0 · `npm --prefix chrome-extension test` **703 pass**

## Capability

```text
Surface:      L0 Panel chrome
L2-classes:   none
Compose:      装配 entry chrome only
Autonomy:     none
Trust:        settings 可发现；急停未埋
Channel:      unchanged
```

## 闸门结果

### 内部 R2 对抗（互不见）

| 路 | VERDICT | 主因 |
|----|---------|------|
| Product | **REJECT** | D″：L0 第一行仍是「总结当前打开的页面」 |
| Presentation | **REJECT** | C″：320 栏与居中 CMspark 碰撞；D″ 同上 |
| Safety | **APPROVE_WITH_NITS** | Trust 毒默认已清；急停未埋 |

### 外部三路（用户点名）

| 判官 | VERDICT | 路径 |
|------|---------|------|
| **Claude** | **APPROVE_WITH_NITS** | `companion-canon-ui-r2-claude-20260818-154102.md` |
| **Kimi** | **APPROVE_WITH_NITS** | `companion-canon-ui-r2-kimi-20260818.md` |
| **Pi** | **APPROVE_WITH_NITS** | `companion-canon-ui-r2-pi-20260818-154102.md` |

`scripts/dual-external-review.sh`：`both_ok=true`  
`companion-canon-ui-r2-verdict-20260818-154102.json`

## 选择（selection）

三路外部 **一致 AWN**。内部 Product/Presentation 把 L0 第一行升成 D″ 违约（REJECT）；Claude/Kimi/Pi 把同一事实标成 **P2 模糊、不挡 D″ 字面**。

**本轮选择：采外部三路多数 — 本切面可进优化计划，不挡继续打磨；不宣称 merge-ready。**

理由：
- C″ 一条栏三路外部 + Safety 确认成立
- Trust `createBlankThread {}` 全员确认毒已清
- 急停全员确认未埋
- L0 第一行是 **产品诚实残留**，进计划 P0，不当成「C″/D″ 整单作废」

实现会话 **不得** 把本文件当成 APPROVE 合 main。合 main 前仍要：机核新鲜 + 对抗对优化切片再跑 + Pi。

---

## UI/UX 优化计划（按切片）

### Slice 0 — 本周必做（P0，对齐 D″ 精神 + 320 栏）

| ID | 做什么 | 验收 | 文件 |
|----|--------|------|------|
| **S0.1** | L0 空态去掉「总结当前打开的页面」；只留 起草 + 装配 gloss。页任务只在 L1 | `empty-state-chat` 不含「当前打开的页面」；L1 仍有 | `empty-state-copy.ts` + test **DONE** |
| **S0.2** | 320 栏：Mode whisper；CMspark 左贴齿轮；cruise/断连时藏字标 | 320：标题不压右侧 | `StatusRail.tsx` `ModeBadge.tsx` **DONE** |

### Slice 1 — 跟手（P1）

| ID | 做什么 | 验收 |
|----|--------|------|
| **S1.1** | L1 空态：无消息时不挂 FocusBand 网页条（confirm/急停优先级不变） | 空 L1：rail → 角色；有确认仍先出 FocusBand · **DONE** |
| **S1.2** | 空态输入：左侧只留装配；附件/听写进第一字之后或 ⋯ | 空态胶囊 = 装配 + 场 + 发送 · **DONE** |
| **S1.3** | ⋯「设置」与齿轮同路由（断连 → connection） | 两处行为一致 · **DONE** |
| **S1.4** | 删 `ComposeDrawer` `⋯「编排」`；只留 `/board` | 无死链 · **DONE** |

### Slice 2 — 工艺（P2，可跟 PR 或下一刀）

| ID | 做什么 |
|----|--------|
| **S2.1** | `createBlankThread` + EmptyState 文案单测 · **DONE** |
| **S2.2** | DESIGN.md / App THESIS 与现网文案对齐（删「畅所欲问」） · **DONE** |
| **S2.3** | 清 StatusRail 死样式、`IconPlus` · **DONE** |
| **S2.4** | legal 用 `textMuted` ≥11px 或删 · **DONE** |
| **S2.5** | 连接态 conn 用 `role="status"`，仅断连为 button · **DONE** |
| **S2.6** | InvitationRows hover + focus-visible · **DONE**（inline color 已删，CSS 管 hover） |
| **S2.7** | Send 改为圆内上箭头（看山） · **DONE** |
| **S2.8** | CompanionMark 填色存在感（非描边猫） · **DONE** |

### 不做（本计划外）

- 新 L2 工具、换确认方言、Cockpit 换皮（下一表面）
- 复制看山狐狸
- 再藏 Mode/⋯（已裁 C″）

## 执行序

```
S0.1 + S0.2  → 机核 → 小切片对抗（1 路 Product 即可）
S1.*         → 机核
S2.*         → 可并一 PR
然后 dual-external-review.sh + kimi  → 才谈 merge
```

## Eval gate card（S1+S2 完成后 · 2026-08-18）

| Gate | Result |
|------|--------|
| MACHINE | PASS — 生产 `tsc --noEmit` 0 + `tsconfig.test.json` **715 pass** |
| ADVERSARY S12 | Product AWN · Presentation AWN · Safety AWN |
| STOP | Claude+Pi+Kimi 两轮 REJECT（TS1117 → inline inherit）→ 修完重审 |
| CLAUDE r2 | APPROVE_WITH_NITS (`companion-canon-ui-s12r2-claude-20260818-164257.md`) |
| KIMI r2 | APPROVE (`companion-canon-ui-s12-kimi-rereview2-20260818.md`) |
| PI r2 | APPROVE_WITH_NITS (`companion-canon-ui-s12r2-pi-20260818-164257.md`) |
| MERGE | **NO** — 实现者不得自放行。外部三路均为 APPROVE*；合 main 需用户点头 |

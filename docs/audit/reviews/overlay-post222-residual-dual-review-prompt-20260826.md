# Dual / multi-lane review: post-#222 residual issues on latest main

**Batch:** `overlay-post222-residual`  
**HEAD:** `a58b78f` (`origin/main` as of 2026-08-26)  
**Range:** `ac0a3be..HEAD` (#222 squash + post-#222 P1 fold `03de168` + Windows tray `c8d0984` + C-thin scroll `dfab3eb`)  
**Diff:** `docs/audit/reviews/overlay-post222-residual-20260826.diff`  
**Spec:** `docs/superpowers/specs/2026-08-25-overlay-hud-expand-design.md`  
**Prior dual (on pre-fold worktree):** `overlay-hud-expand-b1b4-r2` both APPROVE_WITH_NITS

```text
Surface:      L0 overlay HUD workbench + C-thin HTML
L2-classes:   none on HUD; mcp.add / stdio enable uses tray L2
Compose:      threads / pack.apply / mcp.toggle / skill / knowledge USE+import
Autonomy:     n/a
Trust:        overlay ACL overlay-safe; mcp.add/knowledge.import off summoner WS
Channel:      community
```

**Blast:** T2 residual UX + T3 stdin import/add paths.

## 刻意边界（已裁决，不要再挑战）

- 网页 CDP 仍要 Chrome 扩展。不要把「MCP 工具执行走 Side Panel」判成 BLOCK。
- Overlay 不做 Allow/Deny 方言。托盘 `showConfirmDialog` 是 L2。
- Win/Linux C-thin 不是 Mac HUD 视觉克隆。
- 不要要求 `knowledge.import` 上 overlay WS。

## 发现的问题（评审必须逐条给 CLOSED / OPEN / WONTFIX）

来自 #222 dual r2 nits + 合入后观察。**先在 HEAD 上核验是否仍存在**（`03de168` / `dfab3eb` 声称折过一部分）。

| ID | 问题 | 合入时状态 |
|----|------|------------|
| I1 | C-thin 技能 tab `on:true` 只激活不关闭 | `summoner-web.ts` ~924 |
| I2 | C-thin 知识 tab `ids:[id]` 整表替换、不能卸 | `summoner-web.ts` ~939 |
| I3 | Swift 知识导入非 UTF-8 走 `base64EncodedString()` 当正文 | `SummonerOverlay.swift` ~719 |
| I4 | C-thin 对已禁用 **stdio** MCP 点开 → overlay WS 无法答 L2，约 45s 超时 | HTML `/api/mcp/toggle` |
| I5 | Mac 列表 `prefix(12)` / `hitsFromTitleSearch().slice(0,8)`，无独立滚动 | Overlay + menu-bar |
| I6 | `knowledge.set_active` 未知 id 静默丢掉，无单测 | `message-router.ts` |
| I7 | `dfab3eb` 声称 C-thin flexbox 滚动修好 — 是否真可滚、header/composer 是否被挤 |
| I8 | `03de168` 声称 F-I-5 冲突后缀 / PEM END / F-S-1 untrusted wrap — 是否真闭合 |

再扫：**新引入**的回归（#222 之后的 fold 是否弄坏 ACL / pin / confirm）。

## 四路对抗（已完成 · 彼此独立 · 本 dual 须确认或驳回）

读全文，不要只看摘要：

- `docs/audit/reviews/overlay-post222-residual-adversary-security-20260826.md` — AWN  
- `docs/audit/reviews/overlay-post222-residual-adversary-product-20260826.md` — REJECT  
- `docs/audit/reviews/overlay-post222-residual-adversary-impl-20260826.md` — REJECT  
- `docs/audit/reviews/overlay-post222-residual-adversary-external-20260826.md` — REJECT  

核心指控：merge `a58b78f` 的 `summoner-web.ts` blob 等于 `dfab3eb`（#222 旧 HTML），**不是** `03de168` 已折 I1/I2 的 HUD HTML；测试仍锁 `on:!on`。

### Machine this session `[executed]`

- HEAD `a58b78f`
- pin == `companion/dist/cmspark-tray` == `ed4dbfa0e0eae5490bb0b18f477b416039c13e722a7e3f2750797b7e659a5fda`
- `summoner-web.test.ts` fails asserting `/skill_name:s\.name,on:!on/` against live HTML `on:true`

## REJECT / BLOCK if

R1 overlay WS 能 `mcp.add` / `knowledge.import` / `config.set`  
R2 overlay `thread.update` 能写 `tool_whitelist`  
R3 HUD 出现 Allow/Deny / `summoner.confirm.*`  
R4 `SWIFT_TRAY_SHA256` ≠ `companion/dist/cmspark-tray`（若二进制存在）  
R5 声称已折的 I1–I8 实际未折却标 CLOSED  
R6 新 fold 破坏 overlay-safe ACL

## 三层

outcome / trajectory / component。file:line。机核优先（grep、shasum、单测文件）。

**禁止**跑 `npm test` / `scripts/run-tests.mjs` / 全量 companion suite（会挂死）。只跑：
`npx --offline tsx --test tests/summoner-web.test.ts` 或 `git rev-parse` / `shasum` / `rg`。

最终一行必须是：

`VERDICT: APPROVE` | `VERDICT: APPROVE_WITH_NITS` | `VERDICT: REJECT`

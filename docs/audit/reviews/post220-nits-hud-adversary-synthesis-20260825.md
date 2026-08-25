# 四路独立对抗合成 — nits fold + Windows HUD restyle (`d4cbbfae..8f5c94c6`)

> **日期**: 2026-08-25  
> **对象**: `7ec76d78` residual nits + `8f5c94c6` C-thin paper HUD  
> **Base**: `d4cbbfae`（P1 r2 已 AWN，本轮不重开除非回归）  
> **HEAD**: `8f5c94c6`  
> **Frozen**: `docs/audit/reviews/post220-nits-hud-diff-20260825.patch`  
> **SHA256**: `AB1D1A1285F558BE52A86D5A1F5A6B8EDB5BC671F565348337B7240F6EFE6825`  
> **方法**: 四路独立；文件互斥；本会话编排，不实现

---

## 参与路与裁决

| 路 | 范围 | 裁决 |
|----|------|------|
| **A** | Overlay / C-thin HUD / ACL | **APPROVE_WITH_NITS** |
| **B** | identity / distill / install | **APPROVE_WITH_NITS** |
| **C** | Side Panel nits | **APPROVE_WITH_NITS** |
| **D** | history / router | **APPROVE_WITH_NITS** |

报告：`post220-nits-hud-lane-{a-overlay,b-knowledge,c-sidepanel,d-loop}-20260825.md`

### 合成裁决

**APPROVE_WITH_NITS.** 无 P0/P1。声称 nits 均被独立重放关闭；P1（F-I-5 / PEM 4200 / F-S-1 wrap）未回归。

---

## 已确认 HOLD

| ID | 结果 |
|----|------|
| Paper HUD tokens / rail-btn SVG；非 #12141c | HOLD A |
| Overlay 无 Allow/Deny/确认 chrome | HOLD A |
| pack.apply 剥 Trust extras + user_gesture | HOLD A |
| HTML mcp.toggle → tray companionClient | HOLD A |
| skills `on:!on` / knowledge `ids:next` | HOLD A |
| R1 mcp.add / knowledge.import / config.set 仍 DENY | HOLD A |
| COM0/LPT0 hash；junction skip load + budget | HOLD B |
| DSA PEM + 4200 RSA 不回归 | HOLD B |
| F-I-5 dual Notes → notes + notes-2 | HOLD B |
| open-knowledge 打开知识面板 | HOLD C |
| 文件夹导入 confirm + user_gesture | HOLD C（仍无逐篇预览，Wave 0b 切口） |
| 确认钮禁用解析中/失败；error 不 wipe payload | HOLD C |
| CHAT_MARKED_OPTIONS 单点；剥 import 测红 | HOLD C |
| evaluate result_summary 短秘密折叠 | HOLD D |
| pin cap 32；summoner import ACL deny | HOLD D |
| drain peek/take 未动 | HOLD D |

---

## 残留 nits（非阻断，不挡 dual）

- A: `pack.apply` 命名 delete vs 全量 rewrite；`companionClient` 空则回落 overlay 超时
- B: decoy first-END；ECDSA PEM；fingerprint 与 junction skip 不完全锁步
- C: 关面板时 chip 的 focus-knowledge 可能早于 KnowledgeSubPanel mount
- D: history `error` 列未折叠；pin 已满时保留旧集仍翻 manual

---

## Eval gate card — `post220-nits-hud`

**Blast**: T2  
**Capability**: L0 HUD restyle + overlay-safe compose；无新 L2 / 无 overlay Allow/Deny

| Gate | Result |
|------|--------|
| MACHINE | **PASS**（A 45；B 58；C 2 markdown；D 138） |
| ADVERSARY | **A/B/C/D AWN** |
| PI_REREVIEW | pending dual |
| MERGE | **NO** until Pi/Claude dual AWN |

`scripts/dual-external-review.sh post220-nits-hud docs/audit/reviews/_prompts/post220-nits-hud-dual-20260825.md d4cbbfae`

# 四路独立对抗合成 — post-#220 residual nits (`9deff00`)

> **日期**: 2026-08-25  
> **对象**: `1d16b0e..9deff00`（`fix/post220-residual-nits`）  
> **Frozen patch**: `docs/audit/reviews/post220-nits-diff-20260825-092457.patch`  
> **SHA256**: `2625238075ef8720b4dc8ca73124742b068b54c8b7d721b1dfd2d4c793274b51`（四路各自 `[executed]`）  
> **方法**: 四路独立 worktree agent；读 frozen patch + 活码 + 定向执行 + 变异杀死；本会话只编排/合成，不实现、不自评放行  
> **说明**: 合前/合后 #220 对抗不得当本轮证据。本轮只验 nits 切片。

---

## 参与路与裁决

| 路 | 范围 | 裁决 |
|----|------|------|
| **A** | LLM loop / nextRun / heal skip | **APPROVE_WITH_NITS** |
| **B** | drain pause / regen / conductor / upload ack | **APPROVE_WITH_NITS** |
| **C** | overlay bind / reclaim / setSummonerThreadId | **APPROVE_WITH_NITS** |
| **D** | persistence redaction + history.db | **APPROVE_WITH_NITS** |

报告：`docs/audit/reviews/post220-nits-lane-{a-llm,b-drain,c-lease,d-redact}-20260825.md`

### 合成裁决

**APPROVE_WITH_NITS.** 无 P0/P1。声称 11 条 fold 在 live `9deff00` 上均被独立重放关闭（多数带变异杀死）。

---

## 已确认 HOLD

| ID | 结果 | 证据 |
|----|------|------|
| Frozen SHA | HOLD | A/B/C/D `[executed]` |
| S-A1 nextRun `{text,cId}` leftover+enqueue | HOLD | A leftover-omit 变异红；B enqueue/follow-up 双杀红 |
| S-A2 persist skip 限定 assistant 块 | HOLD | A 全局 `now.some` 变异 → n=0 红 |
| S-A3 leftover 不 wipe steer | HOLD 生产 | adapter 无 `\bdropSteer\b`；helper 无调用。单元测仍钉不住 take→drop 窗（nit） |
| S-B1 pause 先于 take | HOLD | B 删 pause 门 → queue 0≠1 红。trash 生产有、套件未钉 |
| S-B2 regen overlay + conductor | HOLD | B 跳过对应 pre-check → queue 红 |
| S-B3 upload 恒 file.uploaded | HOLD | B 无 `return drainedAfterUpload`；无条件 return 变异红 |
| S-C1 setSummonerThreadId 删除 | HOLD | C `*.ts` 零定义；MUT2 恢复 → 测红 |
| S-C2 submit-ok live-gate | HOLD | C `overlaySessionIsLive(token)` 合取 |
| S-C2 reclaim → claimOverlayIfLive | HOLD | C MUT1 剥 post-await → helper 测红 |
| S-D1 passwd；value 不全局 | HOLD | D 剥 passwd 正则 → 2 红 |
| S-D2 数组/数值敏感 key | HOLD | D 恢复 `typeof===string` → 2 红 |
| S-D3 history 正则+leaf | HOLD | D 剥 history passwd → hunter2 落盘 |
| Overlay 非 Allow/Deny | HOLD | C Swift 零确认词；无 confirm skip |

---

## 残留 nits（非阻断）

| ID | 路 | 摘要 |
|----|----|------|
| N-A3 | A | S-A3 单元测在 helper **返回后** 才 enqueue concurrent；`dropSteer` 塞进 full 路径仍绿 |
| N-B1 | B | trash 预检无 in-tree 测（私探 HOLD） |
| N-B2 | B | overlay-reject upload 测钉不住「永不 `return drained`」相对旧 gate-push 分支 |
| N-C1 | C | menu-bar S-C 仍是 grep；`bindSummonerThread` 默认 current generation；reclaim 省略 `onStaleClaim` |
| N-D1 | D | history cookie params / 通用工具仍不扫 key；object 袋装 secret 两边都漏 |
| 既有 | — | 裸 `value` 全局、M3/N1/N9 — 本轮不 REJECT |

---

## 机器（对抗路自行跑）

- A：run-queues + heal + adapter-steer-overflow **37/37**
- B：nextrun-drain **15/15** + 多条变异红
- C：summoner-overlay + overlay-session + summoner-client **82/82**
- D：redact **17** + history **48** = **65/65** + 三变异红

---

## Eval gate card — `post220-nits`

**Blast tier**: T2  
**Capability**: Surface L0 · L2 none · Autonomy nextRun plumbing · Trust 更紧 redact · Channel overlay live-gate

| Gate | Result |
|------|--------|
| MACHINE | **PASS** |
| ADVERSARY | **A/B/C/D AWN** |
| PI_REREVIEW | **APPROVE_WITH_NITS** (`post220-nits-pi-20260825-093814.md`；自跑 tsc 0 + 167/167) |
| CLAUDE_REREVIEW | **APPROVE_WITH_NITS** (`post220-nits-claude-20260825-093814.md`；自跑 tsc 0 + 167/167) |
| MERGE | **YES_ON_BRANCH** — MACHINE + 四路对抗 AWN + Claude/Pi AWN。未合 main；实现会话不开 PR 除非用户点头。 |

`scripts/dual-external-review.sh post220-nits … origin/main` → `both_ok=true`（`post220-nits-verdict-20260825-093814.json`）。

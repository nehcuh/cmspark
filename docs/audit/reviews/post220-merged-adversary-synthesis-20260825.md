# 四路独立对抗合成 — post-merge PR #220 (`1d16b0e`)

> **日期**: 2026-08-25  
> **对象**: 拉取 `c5b4242..1d16b0e`（PR #220 squash MERGED：fold post-#219 kimi nits）  
> **Frozen patch**: `docs/audit/reviews/post220-merged-diff-20260825-085108.patch`  
> **SHA256**: `b5e936cbf1dc66afc3fc7aef5898fb417692ed63325b9a4ed8bb11caf5c86021`（四路各自 `[executed]` 校验）  
> **方法**: 四路独立 worktree agent；读 frozen patch + 活码 + 定向执行 + 变异杀死；本会话只编排/合成，不实现、不自评放行  
> **说明**: 合前 r2（HEAD `c5b4242` 未提交 WIP）已 AWN+Pi AWN。本轮是 **合入 main 后的独立复验**，不引用 r2 当证据。

---

## 参与路与裁决

| 路 | 范围 | 裁决 |
|----|------|------|
| **A** | LLM loop（adapter / run-queues / heal / overflow） | **APPROVE_WITH_NITS** |
| **B** | nextRun drain / occupancy（message-router） | **APPROVE_WITH_NITS** |
| **C** | overlay lease / summoner session | **APPROVE_WITH_NITS** |
| **D** | persistence redaction + test honesty | **APPROVE_WITH_NITS** |

报告：

- `docs/audit/reviews/post220-merged-lane-a-llm-20260825.md`
- `docs/audit/reviews/post220-merged-lane-b-drain-20260825.md`
- `docs/audit/reviews/post220-merged-lane-c-lease-20260825.md`
- `docs/audit/reviews/post220-merged-lane-d-redact-20260825.md`
- Prompt: `docs/audit/reviews/_prompts/post220-merged-adversary-20260825.md`

### 合成裁决

**APPROVE_WITH_NITS.** 无 P0/P1。r1 六条 BLOCK/High 在 live `1d16b0e` 上均被独立重放关闭，且至少一条有变异杀死。

---

## 已确认 HOLD（四路重放，不引用合前 r2）

| 声称 | 结果 | 证据 |
|------|------|------|
| Frozen patch SHA 与 `git diff c5b4242..HEAD -- ':!docs/audit/reviews'` 一致 | HOLD | A/B/C/D `[executed]` |
| A-BLOCK 测缝打到 `OpenAIProvider.prototype.streamChat` | HOLD | A 13/13 + Completions 变异 0/13；D 13/13 诚实复核 |
| A-High leftover 不再 `dropSteer` | HOLD | A：`dropSteer` 未 import；finally 只 `enqueueNextRun` + warn |
| A-High filler 限定 in-flight assistant 连续 tool 块 | HOLD | A 变异去掉 `assistantId` → scope 测红 |
| B-High gate drain 不替换 `file.uploaded` / create ack | HOLD | B 11/11 + 还原 r1 `return drained` 变异 → 测红 |
| Overlay 成功 drain 有实测 | HOLD | B summoner `streamCalls===2` |
| C-High `beginOverlaySession` 后滞后 id 不能 reclaim 偷租 | HOLD | C 删 `overlaySessionIsLive` 门 → lagged-id 测红 |
| 生产 `summonerThreadId` 只经 bind/clear | HOLD | C grep 恰两处赋值 |
| D-High Authorization/Bearer/apiKey（含嵌套 headers） | HOLD | D 探针 + 剥 regex 变异 0/2 |
| D-High `plainErrorResult` 重建无 extras；INTERRUPTED 走此枝 | HOLD | D 身份 `!== orig`；stdout/stack 消失 |
| D-High code-tool `data` 恒折叠（无 ≤200 明文） | HOLD | D evaluate/shell/host_* 探针 |
| Overlay 不是 Allow/Deny | HOLD | C Swift 零确认词 + pack/MCP 改道侧栏 |
| ADR-020：无新 L2 / confirm skip | HOLD | 四路 checklist |

---

## 残留 nits（非阻断，合并四路）

| ID | 路 | Sev | 摘要 |
|----|----|-----|------|
| S-A1 | A | P2 | leftover→nextRun 丢掉 `clientMessageId`（`nextRun` 是 `string[]`）；中途 steer 仍保留 |
| S-A2 | A | P2 | `persistHealedToolRows` skip 仍按全局 tool id（与 scoped replace 不对称）；常见 unique `call_*` 下罕见 |
| S-A3 | A | nit | queue-full 测钉不住「take 之后又 dropSteer」；生产无该调用 |
| S-B1 | B | P2 | pause/trash **take 之后**才闸 → nextRun 被丢（有 `thread_paused` 推送，非静默、非 ack 替换） |
| S-B2 | B | nit | regen overlay-gate 无集成测；conductor drain 仅私探 |
| S-B3 | B | nit | upload 非 gate 的 `return drainedAfterUpload` 潜伏；当前 successor 合同关掉它 |
| S-C1 | C | nit | `setSummonerThreadId` 用 `currentOverlaySession()` 绑滞后 id；**零生产调用方** |
| S-C2 | C | nit | submit-ok bind 无 live-gate（hydrate callback 有）；reclaim RPC 未二次核 generation |
| S-D1 | D | nit | 非 cookie 工具 `passwd` / 裸 `value` 仍落盘；cookie `value` 已 hash |
| S-D2 | D | nit | 非 string 的 `Authorization` 数组 / 数值 `apiKey` 跳过 key 扫描 |
| S-D3 | D | nit | `history/store.ts` 正则未跟上（并行 history.db，不在本 slice） |
| 既有 | — | out | M3 pack.apply 路由测、N1 idle flash、N9 length budget — 本轮不 REJECT |

跨路无新收敛成 BLOCK 的独立撞车。A 的 persist-skip 与 filler-scope 是**同类 id 问题的反面**，不重开 A-High。

---

## 机器（对抗路自行跑，非本会话自评）

- A：`tsc --noEmit` 0；adapter-steer-overflow **13/13**；tool-batch-heal **12/12**；run-queues **7/7**（合计 32/32）
- B：message-router-nextrun-drain **11/11** + keep-`file.uploaded` 变异红
- C：overlay-session + composer-lease + summoner-* **117/117**（worktree 无 node_modules 时 1 条 `js-yaml` 环境失败；`NODE_PATH` 主仓 modules 后全绿；C-High 测在无 NODE_PATH 时已过）
- D：tool-persistence-redact **14** + threads-history **58** = **72/72**；adapter-steer-overflow **13/13**；composer-lease **36/36**；Authorization 变异 0/2

---

## Eval gate card — `post220-merged`

**Blast tier**: T2  
**Capability**: Surface L0 · L2 none · Autonomy steer/nextRun · Trust 红acted 持久化 · Channel composer lease / overlay token

| Gate | Result |
|------|--------|
| MACHINE | **PASS**（四路定向套件绿 + 变异杀死） |
| ADVERSARY | **A AWN · B AWN · C AWN · D AWN** |
| PI_REREVIEW | **N/A this round** — 合前 r2 Pi 已 AWN；本轮无 BLOCK，未重跑 Pi |
| MERGE | **already on main** (`1d16b0e`) — 本轮不建议 revert；残留按 nits 排队 |

**本会话不得把合成当 merge-ready 自评。** 代码已在 main；本文件只记录事后闸门。

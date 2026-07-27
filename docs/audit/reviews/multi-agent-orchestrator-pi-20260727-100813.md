Review written to `docs/audit/reviews/multi-agent-orchestrator-pi-2026-07-27.md` (~19KB).

## Summary

**Verdict: APPROVE_WITH_CHANGES (72% confidence)**

### 4 Must-Fix before P0 code (按严重度排序):

| # | 问题 | 违反哪条规则 |
|---|------|-------------|
| **M1** | SOFT_RESERVED 非互斥 → 两个 worker 先后拿用户 confirm，后 confirm 的拿不到锁，**用户白点 approve** | Locked conclusion #6, H3 |
| **M2** | lease 到期不 cancel in-flight CDP 命令 → **锁释放了但工具还在跑**，两个 agent 同时操作同一 tab | User hard rule |
| **M3** | `screenshot`/`analyze_image` 的 active-tab fallback → 不传 tabId 就能绕锁 | Locked conclusion #5, #6 |
| **M4** | `isToolAllowed` 全仓库零调用点 → 所有 worker downgrade（WORKER_HARD_DENY）是**演戏** | Locked conclusion #4, H6 |

### What synthesis got right:
Worker-as-Thread 复用、Companion-side multi-tool episode lease（非 Extension-only）、SOFT_RESERVED 不横跨 L2 45s、host_computer 与 tab lock 正交、L2 confirm storm bounding、isToolAllowed 差距的正确识别、audit 的 Companion-stamped 设计、4 个 killed proposals 的 kill 理由全部过硬。

### 5 个需人工拍板的问题:
P0 pure-read 排他 vs shared-observer、osascript_eval 的命运（禁止/降级/改实现）、默认并发上限数值、HITL enter 是 read-only 还是可注入、host_computer 与 tab lease 共存策略。

---

Most critical issue is **M2** — lease expiry without CDP abort means the lock is released but the worker's mouse/keyboard events still fire in the tab. This is a direct violation of your hard rule. The synthesis acknowledges the abort gap (`chat.abort` doesn't stop in-flight browser tools) but doesn't connect it to lease expiry.

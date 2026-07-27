# Multi-Agent GATE 2 — Pi Adversarial Review (Final)

**Date**: 2026-07-27  
**Reviewer**: Pi-style adversarial GATE 2 (post-GATE1 fix commit `48a84c4`)  
**Worktree**: `/Users/huchen/Projects/cmspark/.claude/worktrees/multi-agent-p0`  
**Branch**: `feat/multi-agent-p0`  
**Scope (mandated)**: **false exclusivity** · **cancel / lease drain** · **L2 admission leaks**  
**Method**: static call-site verification against live sources after GATE1 must_fix; companion unit suite re-run; `pi -p --mode text --no-session` started but killed on wall-clock timeout (analysis completed from direct inspection)  
**Primary artifacts**: ADR-015 · `companion/src/orchestrator/*` · `server.ts` L2 / stop / cancel · `message-router.ts` fleet/abort · `security-confirmation.ts`  

---

## Verdict: **BLOCK** (confidence 86%)

GATE1 must_fix **landed and hold** on the kernel paths they named (admission→SOFT→confirm order, multi-admit dequeue, pending-aware sweeps, FORCE_RELEASING GC, Confirm Center `stop_thread` drain, gate fail-closed, pin fallback, owner-checked flight). Companion tests: **`1902 pass / 0 fail`** `[executed]`.

GATE 2 **still blocks ship** because cancel/stop_all is **not authoritative for open L2 dialogs**. That single class re-opens:

1. **False exclusivity** (tab FREE while Confirm Center still live → peer takes tab; zombie approve may re-HARD),  
2. **Incomplete lease drain** (leases dropped without denying the confirmation that owns SOFT intent),  
3. **L2 admission slot leak** (slot held until confirm timeout ≤45s after “stop”).

Until cancel paths **deny worker-stamped pending confirmations** (and tests cover it), multi-agent stop is a UX lie and a capacity/exclusivity bug.

---

## Executive summary

| Focus | Status | Worst residual failure |
|-------|--------|-------------------------|
| False exclusivity (Q1 / hard rule) | **BLOCK** | `fleet.stop_all` / `chat.abort` / `worker_cancel` free leases **without** resolving open L2; peer can HARD the tab; user can still approve orphan dialog → re-HARD or white-click TAB_LOCKED |
| Cancel / lease drain | **BLOCK** | Drain is pending-tool + lease only; **no confirm reject-by-worker**; no extension `tool.abort`; CDP may continue after companion FREE |
| L2 admission leaks | **BLOCK** | Admission released only in L2 `finally` after `request()` resolves — cancel does not resolve → **slot + shell flight stuck ≤45s** |
| GATE1 kernel (order, sweep hooks, stop_thread, multi-admit) | **HOLD** | See §“GATE1 regressions checked” |

---

## GATE1 regressions checked (must not reopen)

| GATE1 must_fix | Post-`48a84c4` status | Evidence |
|-----------------|----------------------|----------|
| L2 order admission → SOFT → confirm | **HOLD** | `server.ts:1062–1150` comment + code |
| softDeadline = confirm timeout | **HOLD** | `tab-lease.ts:47` `SOFT_LEASE_MS = DEFAULT_SECURITY_CONFIRMATION_TIMEOUT_MS` |
| `tryDequeue` multi-admit scan-skip | **HOLD** | `l2-admission.ts:45–59`; test multi-admit |
| Every sweep pending-aware | **HOLD** | `registerTabLeasePendingHooks` + `resolveHasPending`; drain on TTL |
| FORCE_RELEASING GC + TTL drain | **HOLD** | `FORCE_RELEASING_GC_MS=30s`; `drainPendingAndFree` |
| `stop_thread` + `stop_thread_id` authoritative | **HOLD** | payload forward; `server.ts:2143–2211` deny + abort + reject + leases |
| Gate fail-closed | **HOLD** | `server.ts:573–582` `ORCHESTRATOR_GATE_ERROR` |
| Disable pin fallback multi/lease | **HOLD** | `adapter.ts:663–677` |
| Owner-checked / re-entrant flight | **HOLD** | `single-flight.ts`; shell/netsec reserve before L2 |
| Soft finally + hard-fail release | **HOLD** | `server.ts:1462–1492` |
| Unit suite green | **HOLD** | `[executed]` 1902 pass / 0 fail |

---

## Attack findings (GATE 2)

### F1 — P0: Cancel / stop_all does **not** deny open L2 confirmations (zombie approve + false exclusivity)

**Anchors**:
- `message-router.ts:636–647` — `chat.abort`: abort LLM + `rejectPendingForThread` + `releaseAllLeasesForThread` — **no** `securityConfirmations` touch  
- `message-router.ts:1396–1416` — `fleet.stop_all`: same pattern per worker  
- `server.ts:2510–2528` — `worker_cancel`: same pattern  
- Contrast (correct): `server.ts:2143–2211` — `stop_thread` → `respondFrom(deny)` **then** reject+leases+abort  
- `security-confirmation.ts:419–434` — `rejectAll` exists only for disconnect / all-or-by-ws — **no reject-by-workerId**  
- `server.ts:1358–1384` — post-approve `hardReacquireAfterConfirm`; if lease already freed, `tab-lease.ts:342–347` **re-acquires HARD on free tab**

**Trace (fleet.stop_all while evaluate L2 open)**:
1. Worker-A: admission held · SOFT tab=5 · Confirm Center dialog open.  
2. User: FleetStrip **Stop all** → leases deleted, LLM aborted, extension pending rejected.  
3. SOFT gone → tab FREE. Worker-B (or later spawn) takes HARD on tab=5 and mutates.  
4. Dialog for A still open (UI not closed; companion pending still in map).  
5a. User **Approve** A → `hardReacquireAfterConfirm` finds FREE → **new HARD for A** while B may still be finishing CDP → **two agents / false exclusivity**.  
5b. Or B still holds → A gets TAB_LOCKED after white-click (Q1 failure mode GATE1 was meant to kill).  
6. Until 5a/5b/timeout: **L2 admission slot still counted** for A (`releaseL2Admission` only in confirm `finally` after `request()` settles).

**Required fix**:
1. Add `SecurityConfirmationManager.rejectForWorker(workerId, reason)` (or reject where `pending.workerId === target`).  
2. Call it from `chat.abort`, `fleet.stop_all`, `worker_cancel` **before or with** lease release (prefer: deny confirm first → free admission/flight via existing L2 finally → then reject pending + release any residual leases).  
3. Emit `security.confirmation.resolved` denied so UI closes.  
4. On approve path: if thread paused / cancelled / no longer expected holder, refuse hard promote (`POST_CONFIRM_CANCELLED`) even if tab FREE.  
5. Tests: stop_all mid-confirm → admission snapshot back to 0; approve after stop is no-op or denied.

---

### F2 — P0: L2 admission (+ shell/netsec flight) leak for full confirm TTL after cancel

**Anchors**:
- `server.ts:1097–1116` acquire admission  
- `server.ts:1322–1324` `finally { releaseL2Admission(l2AdmitKey) }` only after `decision = await request(...)`  
- `server.ts:1071–1086` flight reserved **before** admission for shell/netsec  
- `server.ts:1325–1329` / outer `finally:1485–1491` flight release only when decision path runs  

**Trace**: cancel (F1) leaves `request()` pending → admission `activeGlobal` stays +1 and shell flight stays busy until timeout (45s) or zombie resolve. Process cap `max_active_l2_process=2` → **one stop_all can pin both slots** if two workers were confirming.

**Required fix**: same as F1 deny-by-worker; optionally also `releaseL2Admission` is then automatic via finally. Add test that after synthetic reject, `l2AdmissionSnapshot().active_global` and `flightSnapshot()` clear without waiting 45s.

---

### F3 — P1: SOFT TTL skew vs confirm timer (residual mid-dialog exclusivity hole)

**Anchors**:
- `tab-lease.ts:141–144` — SOFT expire **deletes** lease (no pending/confirm coupling)  
- `server.ts:1125–1150` SOFT taken **before** `securityConfirmations.request` starts its 45s timer  
- Both durations = `DEFAULT_SECURITY_CONFIRMATION_TIMEOUT_MS` (45s)

**Trace**: SOFT clock starts tens of ms earlier than confirm timer. Near T+45s, `sweepExpired` (e.g. peer `list_tabs` / other acquire) can drop SOFT while dialog still valid → peer SOFT → **two confirms on one tab** (Q1 break via TTL, not concurrent admit). Approve races → white-click TAB_LOCKED or dual hard reacquire window.

**Required fix** (pick one):
- Soft TTL = confirm timeout + skew (e.g. +2s) **or** set/refresh `softDeadline` when `request()` is registered;  
- Soft expire must not FREE while matching `confirmId` still pending in `SecurityConfirmationManager` (module hook).

---

### F4 — P1: `releaseAllLeasesForThread` is not a true CDP drain

**Anchors**:
- `tab-lease.ts:421–430` — delete leases immediately, no FORCE_RELEASING  
- `server.ts:149–164` — `rejectPendingForThread` resolves **companion** promises only  
- No extension `tool.abort` / mid-CDP cancel (ADR residual)

**Trace**: stop_all rejects pending map entry → LLM sees failure, but extension may still finish `click`/`type` sequence. Lease already FREE → peer HARD → **hard-rule dual operators** until CDP completes.

**Mitigation today**: TTL path with hooks uses `drainPendingAndFree` (still no extension abort). Cancel path is worse (no FORCE_RELEASING).

**Required fix (P0-adjacent if dual-op must be impossible)**:
- On cancel: for each held tab with `hasPendingForTab`, `forceReleaseTab(..., {hasPending:true})` → reject → `completeForceRelease` (same as user force_release).  
- P1 product: extension `tool.abort` + await short drain before FREE.

---

### F5 — P1: `HELD_PENDING_L2` does not cover confirm against idle/hard expiry

**Anchors**:
- `tab-lease.ts:306–314` — promote HARD→HELD_PENDING_L2; **does not advance idle**; no softDeadline  
- `tab-lease.ts:146–174` — HARD/HELD_PENDING_L2 expire on idle/hard  

If idle is already near end when a second L2 opens, mid-confirm expire can FREE (no CDP pending yet) while dialog open → same white-click class as F3. Rare under 120s idle vs 45s confirm, but state machine claims HELD_PENDING_L2 “keeps exclusivity for L2” without time cover.

**Required fix**: while `HELD_PENDING_L2`, freeze expiry (`idleDeadline = max(idle, now+confirmBudget)`) or skip idle expire until confirm resolves / soft-style deadline.

---

### F6 — P2: Pending hooks registration race / test null

**Anchors**:
- `server.ts:184–193` async `registerTabLeasePendingHooks`  
- `tab-lease.ts:90–91` — if no `hasPendingForTab` fn → **`return false`** (fail-**open** silent FREE)  
- Fail-closed only on thrown predicate (`:95–97`)

Cold start / `_resetTabLeasesForTests` without re-register: internal bare `sweepExpired()` can silent-FREE under in-flight CDP. Production window is short; tests must re-hook.

**Required fix**: default `hasPendingForTab` fail-closed when hooks null (`return true`) **or** block lease ops until registered; document test re-register invariant.

---

### F7 — P2: Approve after pause (not stop) still executes

**Anchor**: `message-router.ts:1418–1423` — `worker.pause` aborts LLM only; **keeps** leases + open confirm + pending tools (ADR §3.4 intentional for pause).

Not a stop bug; document that pause ≠ cancel. If product wants “pause freezes tools”, re-check `th.paused` after L2 approve before hard promote / dispatch.

---

## What is solid (do not regress)

| Item | Evidence |
|------|----------|
| Admission→SOFT→confirm order | `server.ts:1062–1150` |
| Multi-admit scan-skip FIFO | `l2-admission.ts` + unit test |
| Double-release admission guard | `releaseL2Admission` n≤0 return |
| SOFT mutual exclusion when live | `tab-lease.ts:277–286` + unit test |
| stop_thread server-stamp preferred | `server.ts:2175–2180` |
| Payload `stop_thread_id` forward | `security-confirmation-payload.ts` |
| Owner-checked flight + L2 reserve | `single-flight.ts` + shell/netsec paths |
| Early TAB_ID_REQUIRED + `__require_tab_id` | `server.ts:510–521`; bridge `getTabId` throws |
| Gate fail-closed | `ORCHESTRATOR_GATE_ERROR` |
| chat.abort / stop_all **intent** to drain tools+leases | present; incomplete vs confirm (F1) |

---

## must_fix (ordered, ≤8)

1. **Deny worker-stamped L2 confirmations on cancel paths** (`chat.abort`, `fleet.stop_all`, `worker_cancel`) via new `rejectForWorker` / equivalent; close UI; let L2 `finally` free admission+flight. *(F1, F2)*  
2. **Refuse post-approve hard promote / dispatch if worker was cancelled** (or lease was released by cancel) — dedicated error, not silent re-HARD on FREE. *(F1)*  
3. **Unit/integration tests**: stop_all mid-confirm → `active_global==0`, flight clear, approve no-op/denied, peer cannot be raced by zombie. *(F1, F2)*  
4. **SOFT deadline ≥ confirm remaining + skew**, or bind soft expire to pending confirmation id. *(F3)*  
5. **Cancel lease release pending-aware** (FORCE_RELEASING → reject → complete) per held tab with in-flight CDP. *(F4)*  
6. **HELD_PENDING_L2 time cover** for confirm duration (idle freeze or soft-style deadline). *(F5)*  
7. **Hooks fail-closed when unregistered** (or assert registered before lease ops). *(F6)*  
8. *(Optional doc)* pause vs cancel semantics in ADR-015 / Fleet UI copy. *(F7)*

---

## Residual (non-blocking for GATE 2 code-fix set once F1–F3 land)

- Extension `tool.abort` / mid-sequence CDP cancel still open ADR item — companion-side reject is best-effort exclusivity only.  
- `wait_workers` poll-only (by design).  
- host_computer Chrome detection still string-blob heuristic.  
- No WS E2E multi-worker lease+stop_all in CI (unit kernels only).  
- `pi -p` full auto-pass timed out this session; findings are `[inspected]`+`[executed tests]`, not live dual-worker WS repro.

---

## Evidence levels

| Claim | Level |
|-------|--------|
| GATE1 order/sweep/stop_thread hold | `[inspected]` sources + commit `48a84c4` |
| Cancel paths omit confirm deny | `[inspected]` message-router / worker_cancel vs stop_thread |
| hardReacquire re-HARD on missing lease | `[inspected]` `tab-lease.ts:342–347` |
| Admission held until request resolves | `[inspected]` server L2 try/finally structure |
| Soft/confirm same 45s with start skew | `[inspected]` constants + call order |
| Unit suite green | `[executed]` `npm test` → 1902 pass / 0 fail |
| Live multi-worker stop_all repro | **not executed** this session |

---

## Confidence: 86%

Downside: no live dual-worker WS repro of zombie approve. Upside: cancel vs stop_thread asymmetry is line-level obvious; admission leak follows directly from `await request` finally structure; hard re-acquire-on-free is explicit code.

---

## GATE decision

| Result | Meaning |
|--------|---------|
| **BLOCK** | Do not declare multi-agent P0/P1 **complete** or merge as “cancel-safe” until must_fix **1–3** land with tests |
| Soft / HELD_PENDING time cover (4–6) | Required before claiming Q1 exclusivity under long-lived confirms / TTL edges |
| Re-review trigger | GATE 2 re-pass after cancel→rejectForWorker + admission/flight tests + soft skew fix |

**Artifact path**: `/Users/huchen/Projects/cmspark/.claude/worktrees/multi-agent-p0/docs/audit/reviews/multi-agent-gate2-pi.md`

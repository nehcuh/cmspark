# Multi-Agent GATE 1 — Pi Adversarial Review (Implementation)

**Date**: 2026-07-27  
**Reviewer**: Pi-style adversarial GATE 1 (implementation code, not design-only)  
**Worktree**: `/Users/huchen/Projects/cmspark/.claude/worktrees/multi-agent-p0`  
**Scope**: L2 admission deadlocks · single-flight leaks · `TAB_LOCKED` races · Confirm Center stop targets  
**Method**: `pi -p --mode text --no-session` + static call-site verification against live sources  
**Primary artifacts**: ADR-015 · `companion/src/orchestrator/*` · `server.ts` · Confirm UI / payload path  

---

## Verdict: **BLOCK** (confidence 84%)

P0 multi-agent kernel is directionally correct (SOFT mutual exclusion, `HELD_PENDING_L2`, `isToolAllowed` hard gate, `pendingToolCalls.thread_id`, shell/netsec flight, LLM loop cap).  
It is **not shippable** until four correctness holes are closed — three of which re-create the original “false exclusivity / user white-click approve” classes of failure that design reviews already flagged.

---

## Executive summary

| Focus | Status | Worst failure |
|-------|--------|----------------|
| L2 admission | **BLOCK** | SOFT taken *before* admission FIFO; `softDeadline=45s` < `ADMISSION_TIMEOUT=60s` → soft can expire while still queued; post-approve `TAB_LOCKED` / lost exclusivity |
| single-flight | **CONDITIONAL OK** | Current `try/finally` paths do not leak under normal exit; no owner check (P1); hang bounded by tool timeouts |
| `TAB_LOCKED` / lease | **BLOCK** | Internal `sweepExpired()` calls omit `hasPendingForTab` → HARD lease deleted while CDP in-flight; FORCE_RELEASING can stick forever |
| Confirm Center stop | **BLOCK** | Companion explicitly does **not** consume `stop_thread`; `stop_thread_id` dropped in WS payload; stop is best-effort dual-message UI only |

---

## Attack findings

### F1 — P0: SOFT_RESERVED before L2 admission + soft 45s vs admission 60s (L2 deadlock / white-click)

**Anchors**:
- `companion/src/server.ts:1033–1088` — SOFT acquired, *then* `acquireL2Admission`
- `companion/src/orchestrator/tab-lease.ts:163` — `softDeadline: t + 45_000`
- `companion/src/orchestrator/l2-admission.ts:16` — `ADMISSION_TIMEOUT_MS = 60_000`
- `companion/src/security-confirmation.ts:6` — confirm timeout 45s (after admission)

**Trace**:
1. T0: worker-A `evaluate` → `SOFT_RESERVED(tab=5)`, `softDeadline=T0+45s`
2. T0: A waits on L2 FIFO (process cap=2 already full) — **no confirm UI yet**
3. T0+45s: any subsequent `sweepExpired()` (including bare internal sweeps) deletes A’s SOFT
4. T0+50s: worker-B may SOFT the same tab and enter confirm
5. T0+55s: A finally admits, still has local `tabL2SoftHeld=true`, shows confirm
6. User approves A → `hardReacquireAfterConfirm` → **`TAB_LOCKED` / post-confirm failure** (or A steals free tab while B also holds)

Even without the expiry race: holding exclusive SOFT for up to 60s **without a dialog** starves peers with `TAB_BUSY_CONFIRMING` while the holder is only in admission queue — false “busy confirming”.

**Required fix**:
1. **Acquire L2 admission first**, then SOFT, then confirm (release admission in `finally` after decision).
2. On soft fail after admission: `releaseL2Admission` immediately.
3. Bind `softDeadline ≥ admission_wait_remaining + confirm_timeout` **or** set `ADMISSION_TIMEOUT_MS ≤ softDeadline` and refresh soft deadline when admission is granted.
4. Before hard re-acquire after approve: if holder/state mismatch, return a dedicated `POST_CONFIRM_LEASE_LOST` (not opaque TAB_LOCKED).

---

### F2 — P0: `tryDequeue` admits only one waiter per call (capacity under-use → artificial timeouts)

**Anchor**: `companion/src/orchestrator/l2-admission.ts:31–42`

```ts
function tryDequeue(): void {
  for (let i = 0; i < queue.length; i++) {
    ...
    w.resolve(true)
    return  // ← stops even if process cap still has free slots
  }
}
```

With `max_active_l2_process=2`, when `activeGlobal` goes `1→0` and two waiters for different runs are queued, **both** are eligible. Only the first is admitted; the second sits until another release (or its own 60s timeout). Amplifies F1 (longer SOFT hold / more timeouts).

**Required fix**: loop `tryDequeue` until no further waiter can admit (or while-loop inside).

---

### F3 — P0: Internal `sweepExpired()` drops HARD while CDP in-flight (`TAB_LOCKED` false free)

**Anchors**:
- Safe path only: `companion/src/server.ts:462` — `sweepExpired({ hasPendingForTab })`
- Unsafe internal: `tab-lease.ts:127` (`acquireOrRenewTabLease`), `:247` (`hardReacquireAfterConfirm`), `:389` (`getTabLease`), `:402` (`listTabLocks`), `:419` (`anyTabLeaseHeld`)

When `hasPendingForTab` is **omitted**, expired `HARD_HELD` / `HELD_PENDING_L2` is **deleted** (`tab-lease.ts:80`) even if extension tools still run.

**Trace**:
1. A holds HARD on tab 5; `click` pending in `pendingToolCalls`
2. idle/hard deadline passes
3. B (or fleet snapshot / host_computer gate) calls `listTabLocks` / `anyTabLeaseHeld` / `acquireOrRenewTabLease`
4. Internal bare `sweepExpired()` **frees** tab 5
5. B acquires HARD; A’s CDP still finishes → **two agents on one tab** — direct hard-rule break

**Required fix**:
- Module-level pending predicate registered once (or always pass `hasPendingForTab` from server into every sweep).
- On expire-with-pending: enter `FORCE_RELEASING`, **reject** that holder’s pending for the tab, then `completeForceRelease` (or schedule drain). Do not leave silent FREE.

---

### F4 — P0: TTL expire → `FORCE_RELEASING` without drain; no GC (permanent tab lockout)

**Anchors**:
- `tab-lease.ts:70–78` — pending → `FORCE_RELEASING` + audit, **no reject**
- `tab-lease.ts:61` — `FORCE_RELEASING` skipped forever in sweep
- Drain only via `message-router.ts:1431–1455` (`tab.force_release`) or cancel paths

If the *only* sweep that sees pending is `createToolExecutor`’s safe sweep: lease sticks in `FORCE_RELEASING` until a human force-releases. Peers get `TAB_FORCE_RELEASING` indefinitely. If pending later completes, **nothing** auto-calls `completeForceRelease`.

**Required fix**:
- On transition to `FORCE_RELEASING` from TTL: call `rejectPendingForTab` + `completeForceRelease` (or short drain timer).
- Add max age for `FORCE_RELEASING` (e.g. 30s) with audit + free.

---

### F5 — P0: Confirm Center stop is non-authoritative (wrong / missed stop targets)

**Anchors**:
- UI: `MinimalConfirm.tsx:34–53`, `App.tsx:274–297`, `CockpitApp.tsx:298–322`  
  `stopTargetId = request.worker_id || activeThreadId` → `chat.abort` + `stop_thread` flag
- Payload: `security-confirmation-payload.ts:38–40` — forwards **`stop_thread` only**, **drops `stop_thread_id`**
- Companion: `server.ts:1966–1968` — *“stop_thread: … No consumer here yet”*

**Failures**:
1. Stop depends on a **second** client message (`chat.abort`). WS blip / ordering → deny without stop; worker keeps LLM + leases until something else cancels.
2. `stop_thread_id` never reaches companion — cannot server-side target abort from the confirmation response alone.
3. Fallback `activeThreadId`: if user switched Side Panel to orchestrator while worker confirm is open and `worker_id` missing/stale, **stop aborts the wrong thread**.
4. `chat.abort` does drain pending+leases (`message-router.ts:636–643`) when it fires — good — but only when the client targets correctly.

**Required fix**:
1. Forward `stop_thread_id` (string) in `buildSecurityConfirmationWsPayload`.
2. In `handleSecurityConfirmationResponse`: if `stop_thread === true`, resolve confirm as deny, then **authoritatively** `abortThreadChat(stop_thread_id || pending.workerId)` + `rejectPendingForThread` + `releaseAllLeasesForThread` (same as worker_cancel).
3. Prefer stamped `worker_id` from pending confirmation metadata server-side; do not trust client-only targeting.
4. Keep UI `chat.abort` as redundant best-effort.

---

### F6 — P1: Orchestrator gate fail-**open**

**Anchor**: `server.ts:552–554`

```ts
} catch (gateErr) {
  logger.warn("orchestrator.gate_error", ...)
  // continues into cookie/L2/dispatch with NO lease / whitelist gates
}
```

Import/throw in ADR-015 block silently disables multi-agent exclusivity for that call.

**Required fix**: fail closed — return `{ success:false, error_code:'ORCHESTRATOR_GATE_ERROR' }`.

---

### F7 — P1: Adapter silent `pinned_tabs[0]` defeats `TAB_ID_REQUIRED`

**Anchor**: `companion/src/llm/adapter.ts:665–667`

```ts
tabId: params.tabId ?? threadManager.get(threadId)?.pinned_tabs?.[0],
```

Multi-agent gate (`server.ts:489–496`) only sees post-injection `tabId`. LLM can omit tabId; pin becomes exclusive target without explicit intent. Contradicts spawn system prompt and ADR-015 “ban silent active-tab / require explicit tabId”.

**Required fix**: skip pin fallback when `isMultiAgentThread` / when tool ∈ `TAB_LEASE_TOOLS`.

---

### F8 — P1: single-flight — no owner check (latent leak / steal)

**Anchors**:
- `single-flight.ts:9–24` — `releaseFlight` deletes without owner match
- `server.ts:2405–2419`, `2433–2449` — acquire + `try/finally` release (correct for happy path)
- shell timeout 60s (`capability/shell.ts`); netsec connect timeouts — hangs bounded

**Current leak risk**: low if only these callers. **Future** cancel/abort calling bare `releaseFlight` can free another worker’s flight mid-exec.

**Required fix**: `releaseFlight(tool, owner)` only if `busy.get(tool)===owner`; warn on mismatch/double-release. Optional: cancel path should not release unless it owns.

---

### F9 — P2: L2 double-release under-counts (theoretical)

**Anchor**: `l2-admission.ts:76–81` — double `releaseL2Admission` can decrement `activeGlobal` and `tryDequeue` extra admits. Single `finally` today; still add re-entrancy guard (`if !held return`).

---

## What is already solid (do not regress)

| Item | Evidence |
|------|----------|
| SOFT mutual exclusion (Q1) | `tab-lease.ts:185–194` → `TAB_BUSY_CONFIRMING`; unit test |
| Same-holder `HELD_PENDING_L2` | `tab-lease.ts:212–220` |
| `isToolAllowed` before L2 | `server.ts:473–486` |
| `pendingToolCalls.thread_id` + tabId | `server.ts:1855–1861`; `rejectPendingForThread` |
| shell/netsec single-flight in `finally` | `server.ts:2405–2449` |
| multi-agent LLM loop cap + finally release | `llm-loop-gate.ts`; `message-router.ts:367–441` |
| Confirm identity fields on wire | `security-confirmation.ts:231–246` → `worker_id` / `tab_id` / run |
| `chat.abort` / `fleet.stop_all` lease+pending drain | `message-router.ts:636–643`, `1396–1416` |
| force_release pending-aware path (when user acts) | `message-router.ts:1431–1455` |

---

## must_fix (ordered)

1. **Reorder L2 path**: `acquireL2Admission` → SOFT → confirm → hard re-acquire; release admission in `finally`; align soft deadline with admission+confirm. *(F1)*  
2. **Every `sweepExpired` must respect in-flight pending** (module-level `hasPendingForTab`); never silent FREE while CDP pending. *(F3)*  
3. **TTL / FORCE_RELEASING auto-drain**: reject pending + `completeForceRelease` (or bounded GC). *(F4)*  
4. **Confirm stop authoritative in companion**: forward `stop_thread_id`; consume `stop_thread` to abort+drain the stamped worker. *(F5)*  
5. **`tryDequeue` multi-admit loop** until no eligible waiter. *(F2)*  
6. **Orchestrator gate fail-closed** on exception. *(F6)*  
7. **Disable adapter `pinned_tabs` tabId fallback** for multi-agent / tab-lease tools. *(F7)*  
8. **Owner-checked `releaseFlight`**. *(F8)*

---

## Residual (non-blocking for GATE 1 code fix set)

- Extension `tool.abort` / CDP mid-sequence cancel still incomplete (ADR open item) — mitigated only if lease never frees under pending.  
- `wait_workers` still poll-only.  
- SOFT queue (vs reject) still P1 optional.  
- No WS E2E for lease+stop-all yet — unit tests cover kernels only.  
- host_computer×Chrome heuristic is string-blob based (bypass via non-chrome labels) — product residual.

---

## Evidence levels

| Claim | Level |
|-------|--------|
| SOFT-before-admission order | `[inspected]` server.ts L2 block |
| soft 45s vs admission 60s | `[inspected]` constants |
| bare sweepExpired call sites | `[inspected]` rg + read |
| stop_thread no companion consumer | `[inspected]` server.ts comment + handler body |
| stop_thread_id dropped | `[inspected]` security-confirmation-payload.ts |
| single-flight finally correct | `[inspected]` |
| pi concurrent analysis | `[executed]` `pi -p --mode text --no-session` |

---

## Confidence: 84%

Downsides: no live multi-worker WS repro in this review session; FORCE_RELEASING drain interaction with extension-side queue not runtime-traced. Upsides: all four focus areas have concrete file:line attack traces and unit-testable fixes.

---

## GATE decision

| Result | Meaning |
|--------|---------|
| **BLOCK** | Do not merge / do not declare multi-agent P0 complete until must_fix 1–5 land with tests |
| Re-review trigger | New GATE 1 pass after patches + unit tests for: admission-before-soft, multi-admit dequeue, sweep+pending, FORCE_RELEASING auto-drain, companion stop_thread |

**Artifact path**: `/Users/huchen/Projects/cmspark/.claude/worktrees/multi-agent-p0/docs/audit/reviews/multi-agent-gate1-pi.md`

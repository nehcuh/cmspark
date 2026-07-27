# GATE 2 Final Ship Review — Multi-Agent ADR-015 (P0 + P1 + P2-lite)

| Field | Value |
|-------|--------|
| **Reviewer** | Claude dual pass (independent code audit + `claude -p` attempted; CLI wall-clock timeout — verdict from direct inspection + executed tests) |
| **Date** | 2026-07-27 |
| **Worktree** | `/Users/huchen/Projects/cmspark/.claude/worktrees/multi-agent-p0` |
| **Branch / HEAD** | `feat/multi-agent-p0` @ `13b6822` (GATE1 fix `48a84c4` + P2 polish) |
| **Scope** | FINAL ship gate for P0 kernel + P1 (L2 FIFO, single-flight, FleetStrip) + P2-lite (TabQueue, deferred markers) |
| **ADR** | [ADR-015](../../adr/015-multi-agent-orchestrator-tab-lock.md) locked Q1–Q5 + §3–§6 progress |
| **Prior gate** | [GATE 1 Claude](./multi-agent-gate1-claude.md) · [GATE 1 Pi](./multi-agent-gate1-pi.md) · [GATE 2 Pi](./multi-agent-gate2-pi.md) |
| **Verdict** | **no-ship** |

---

## 1. Executive verdict

**no-ship.** Confidence **88%**.

GATE1 must_fix **landed and hold** on the named kernel paths (admission → SOFT → confirm; soft `finally`; flight reserve before L2; `TAB_L2_TOOLS.has`; fleet `holding_tabs` over paused; scan-skip FIFO docs; list_tabs lock metadata; suite green). Companion **`1902 pass / 0 fail`**, extension **`245 pass / 0 fail`** `[executed]`.

GATE 2 still **blocks ship** on load-bearing product/correctness holes that make multi-agent **not usable as designed** and/or **re-open false exclusivity**:

1. **Worker `tool_whitelist` is wrong after orchestrator promotion** — first `spawn_worker` from a normal thread promotes parent to `ORCHESTRATOR_TOOL_ALLOWLIST` *before* computing the worker allowlist; workers get `list_tabs` only (with `tool_allow`) or pure orchestrator tools (without). **Browser workers cannot evaluate/click/navigate.** `[executed]` via `spawnWorkerThread` on a real `ThreadManager`.
2. **Cancel / stop_all does not deny open L2 confirmations** — leases free while Confirm Center stays live; zombie approve can **re-HARD a FREE tab** (`hardReacquireAfterConfirm` free-path) or white-click into `TAB_LOCKED`. Same class as GATE1 “doomed approve”, via cancel instead of TTL. `[inspected]`
3. **`evaluate` auto-approve skips lease entirely** — `willEnterL2` skips early HARD; `skipConfirmation` skips SOFT → concurrent evaluate under domain whitelist / god-mode violates exclusive-holder invariant. `[inspected]`

Locked Q1–Q5 checklist: **Q2/Q3/Q5 mostly met in isolation; Q1 broken under cancel + auto-approve evaluate; spawn breaks effective Q2 for real workers.**

---

## 2. Evidence base

### Read / inspected

| Artifact | Notes |
|----------|--------|
| `docs/adr/015-multi-agent-orchestrator-tab-lock.md` | Q1 SOFT 互斥, Q2 evaluate allowed, Q3 max 5, Q4 host×Chrome×lease, Q5 HITL inject no auto-steal; P0/P1/P2 progress; Deferred shared-observer / auto-spawn |
| `companion/src/orchestrator/{tab-lease,l2-admission,single-flight,spawn,fleet,constants,llm-loop-gate}.ts` | Kernel |
| `companion/src/server.ts` | Multi-agent early gates, L2 order, spawn/ask_user HITL, host Chrome gate, stop_thread |
| `companion/src/message-router.ts` | chat.abort, fleet.*, force_release |
| `companion/src/llm/adapter.ts` | `__thread_id` inject; pin fallback disabled for multi/lease tools |
| `chrome-extension/.../FleetStrip.tsx`, `tab-queue.ts`, Confirm payload forward | HITL enter + P2-lite queue |
| GATE1 + GATE2-Pi reviews | Regression bar |

### Executed

```text
npm test (companion)  → 1902 pass, 0 fail, 18 skipped
npm test (extension)  → 245 pass, 0 fail
tsx spawnWorkerThread harness:
  parent tool_whitelist=null + roleAllow=[evaluate,click,navigate,screenshot,list_tabs,type]
  → worker.tool_whitelist = ['list_tabs'] only
  second spawn without tool_allow → worker gets full ORCHESTRATOR_TOOL_ALLOWLIST (no browser mutate)
claude -p --permission-mode bypassPermissions → killed on wall-clock timeout (not used as authority)
```

---

## 3. GATE1 must_fix regression check

| # | GATE1 must_fix | Status @ HEAD | Evidence |
|---|-----------------|---------------|----------|
| 1 | Admission **before** SOFT; softDeadline = confirm timeout | **HOLD** | `server.ts:1062–1150`; `tab-lease.ts:47` `SOFT_LEASE_MS = DEFAULT_SECURITY_CONFIRMATION_TIMEOUT_MS` |
| 2 | Release SOFT on hard-reacquire fail | **HOLD** | outer `finally` + `!tabL2HardPromoted` → `releaseSoftOrPendingL2` (`server.ts:1462–1482`) |
| 3 | Soft release on any non-success L2 exit | **HOLD** | same `finally` |
| 4 | shell/netsec flight **before** L2 | **HOLD** | `server.ts:1071–1088`; re-entrant owner (`single-flight.ts`) |
| 5 | list_tabs lock metadata tests green | **HOLD** | suite green |
| 6 | `TAB_L2_TOOLS.has(toolName)` | **HOLD** | early gate + L2 soft path |
| 7 | Fleet prefer `holding_tabs` when paused+locks | **HOLD** | `fleet.ts:51–55` |
| 8 | Document scan-skip FIFO | **HOLD** | `l2-admission.ts` header + ADR §4 |

Do not regress these.

---

## 4. Locked decisions (Q1–Q5)

| # | Locked decision | Status | Notes |
|---|-----------------|--------|-------|
| **Q1** | `SOFT_RESERVED` 互斥 (no parallel L2 / no doomed white-click) | **Partial / FAIL under cancel & auto-approve** | Live SOFT path exclusive (`TAB_BUSY_CONFIRMING`). Cancel frees lease without denying confirm → zombie re-HARD. Auto-approve evaluate has **no** lease. Soft TTL vs confirm timer residual skew (Pi F3) is secondary. |
| **Q2** | Worker 不禁 `evaluate`; not in `WORKER_HARD_DENY` | **Code intent OK; spawn path FAIL** | `WORKER_HARD_DENY` excludes `evaluate`; unit test keeps evaluate when `parentWhitelist=null`. **Production spawn promotes parent first** so workers rarely retain `evaluate`. |
| **Q3** | 最多 5 workers / 5 LLM loops | **Met** | `ORCHESTRATOR_CAPS.max_workers_per_orchestrator_run=5`, `max_concurrent_multi_agent_llm_loops=5`; spawn count + `llm-loop-gate.ts` |
| **Q4** | Any tab lease → block `host_computer` on Chrome/Chromium | **Met (heuristic)** | `server.ts:554–571` blob includes chrome/chromium. Residual: pure coordinate ops without chrome string. Accept residual, not GATE2 blocker. |
| **Q5** | HITL enter: inject messages/follow-up; **no** auto lease steal | **Met** | `FleetStrip.enterWorker` → `SET_ACTIVE_THREAD` + `thread.select` only; mutate still needs holder / force-release. |

---

## 5. Attack findings (ship blockers)

### F1 · P0 — Worker whitelist destroyed by orchestrator promotion order (product dead)

**Where:** `companion/src/orchestrator/spawn.ts:88–114`

```ts
// Promote parent FIRST (null → ORCHESTRATOR_TOOL_ALLOWLIST)
if (parent.agent_role !== "orchestrator") {
  tm.update(..., { tool_whitelist: parent.tool_whitelist === null
    ? [...ORCHESTRATOR_TOOL_ALLOWLIST] : parent.tool_whitelist })
}
// THEN compute worker from *refreshed* parent
const whitelist = computeWorkerWhitelist({
  parentWhitelist: refreshedParent?.tool_whitelist ?? null, // already orch list
  roleAllow: opts.roleAllow ?? null,
})
```

**ADR formula:** `effective = (parent ∩ role.allow) \ HARD_DENY` with **parent null → use role.allow**.

**Observed** `[executed]`:

| Spawn | Resulting worker whitelist |
|-------|----------------------------|
| `parent.tool_whitelist=null`, `tool_allow=[evaluate,click,navigate,screenshot,list_tabs,type]` | **`['list_tabs']` only** |
| same parent, no `tool_allow` | Full **orchestrator** tools (spawn/wait/collect/…); **no** browser mutate |
| `computeWorkerWhitelist({parentWhitelist:null, roleAllow:[evaluate,click]})` | `evaluate, click` (correct — but spawn never passes null after promote) |

**Impact:** Multi-agent browser orchestration is **non-functional** without a pack that later rewrites whitelist (and even pack apply is optional). Max-5, tab lease, evaluate L2 — all moot if workers cannot hold tools.

**Fix:**

1. Capture `parentCapabilityWhitelist = parent.tool_whitelist` **before** promote.  
2. `computeWorkerWhitelist({ parentWhitelist: parentCapabilityWhitelist, ... })`.  
3. When parent was unrestricted (`null`), do **not** intersect roleAllow with orchestrator allowlist.  
4. Unit test: first spawn from null-parent + `tool_allow` browser set → worker retains evaluate/click (minus HARD_DENY).  
5. Optional: still set parent to `ORCHESTRATOR_TOOL_ALLOWLIST` for the orchestrator thread only.

---

### F2 · P0 — Cancel / stop_all leaves zombie L2 (false exclusivity + admission leak)

**Where:**

- `message-router.ts:636–647` `chat.abort` — reject pending tools + `releaseAllLeasesForThread`; **no** confirm deny  
- `message-router.ts:1396–1416` `fleet.stop_all` — same  
- `server.ts` `worker_cancel` — same pattern  
- Contrast (correct): `server.ts` `stop_thread` → `respondFrom(deny)` then abort + reject + leases  
- `hardReacquireAfterConfirm` when lease missing: **`acquireOrRenewTabLease(needsL2:false)` → new HARD on FREE** (`tab-lease.ts:342–347`)

**Trace:**

1. Worker-A: L2 admission held · SOFT(tab=5) · Confirm Center open.  
2. User **全停** / abort → leases deleted; SOFT gone; admission still held until `request()` settles.  
3. Peer takes HARD on tab=5.  
4. User still sees A’s dialog → **Approve** → free-path hard reacquire **steals** tab **or** TAB_LOCKED after white-click.  
5. Admission / shell flight stuck ≤ confirm timeout (process L2 cap=2 poisoned).

**Fix (minimal authoritative):**

1. `SecurityConfirmationManager.rejectForWorker(workerId, reason)` (pending stamped with `workerId`).  
2. Call from `chat.abort` / `fleet.stop_all` / `worker_cancel` **before** lease release (mirror `stop_thread`).  
3. On approve: if worker paused-by-cancel **or** confirm already rejected **or** soft no longer held by this worker without intentional HARD → refuse promote (`POST_CONFIRM_CANCELLED`); **never** re-HARD FREE after cancel.  
4. Tests: mid-confirm stop_all → `l2AdmissionSnapshot().active_global===0`, approve no-op, peer exclusivity holds.

Agrees with GATE2-Pi F1/F2; elevates to hard ship bar.

---

### F3 · P0 — `evaluate` auto-approve path takes **no** tab lease

**Where:** `server.ts:529–531` + `988–1019`

```ts
const willEnterL2 = TAB_L2_TOOLS.has(toolName) && !finalParams.security_token
if (!willEnterL2) { /* HARD now */ }
// later:
if ((!skipConfirmation || forceConfirm) && !hostComputerTrustSkip) {
  // admission → SOFT → confirm
} else {
  // auto-approved — no SOFT, and early HARD was skipped
}
```

**Failure:** `auto_approved_domains` / `auto_approve_dangerous` / god-mode on evaluate → two workers can concurrent-evaluate same `tabId` with **zero** exclusive holder. Breaks ADR §3.1 invariant for the only default `TAB_L2_TOOLS` member (and Q2-critical tool).

**Fix (pick one):**

- **A (preferred):** Always early HARD for `TAB_LEASE_TOOLS` including evaluate; L2 path uses same-holder `HELD_PENDING_L2` (already supported).  
- **B:** On auto-approve branch after token issue, if `TAB_L2_TOOLS` + tabId + threadId → `acquireOrRenewTabLease({needsL2:false})` or fail closed.

Add unit/integration covering auto-approve evaluate still exclusive.

---

## 6. What is solid (do not regress)

1. **L2 order GATE1:** flight reserve → admission → SOFT (`TAB_L2_TOOLS`) → confirm; admission `finally`; soft `finally` on non-promote.  
2. **SOFT exclusivity when held:** second worker `TAB_BUSY_CONFIRMING` / `TAB_LOCKED` (unit covered).  
3. **Caps §3.5:** workers 5, LLM loops 5, tabs/worker 2, process tabs 10, L2 1/run 2/process, idle 120s, hard 600s.  
4. **`isToolAllowed` before L2/dispatch**; fail-closed `ORCHESTRATOR_GATE_ERROR`.  
5. **`pendingToolCalls.thread_id` + `tabId`**; `rejectPendingForThread`; stop_thread server-stamped drain.  
6. **Multi-agent `TAB_ID_REQUIRED` + extension `__require_tab_id` / TabQueue** (P2-lite).  
7. **spawn HITL:** L2 `security_token` only; LLM `user_confirmed` not trusted.  
8. **shell/netsec:** forceConfirm + pre-L2 flight reserve + re-entrant execute.  
9. **HITL enter (Q5):** active thread switch only; no lease transfer.  
10. **Deferred explicit:** shared-observer, auto-spawn (ADR progress table).  
11. **host_computer × Chrome × any lease (Q4):** present (string heuristic residual OK).  
12. **Tests green** for lease / L2 / flight / llm-loop / force-release / TabQueue / confirmation payload.

---

## 7. Non-blockers / residual debt (not must_fix)

| Item | Why not blocking GATE2 if F1–F3 fixed |
|------|--------------------------------------|
| Soft deadline start skew vs confirm timer (~ms–tens ms) | Secondary; fix with +2s skew or confirmId-bound expire after F2 |
| `HELD_PENDING_L2` idle near expiry mid-confirm | Rare under 120s idle vs 45s confirm |
| host Chrome string heuristic | Q4 intent met; full window identity is later |
| Extension mid-CDP `tool.abort` | ADR residual; companion reject best-effort |
| Full Dashboard grid / WS multi-worker E2E | Deferred P2 / open table — not P0+P1+P2-lite bar |
| `wait_workers` poll-only | By design |
| Dual fleet poll | UX nit |
| Pending hooks fail-open if unregistered | Short cold-start window; prefer fail-closed as polish |
| pause keeps leases + open confirm | ADR §3.4 intentional |

---

## 8. Ordered must_fix (blockers only)

1. **Compute worker `tool_whitelist` from pre-promotion parent capability** (`null` → roleAllow fully, minus HARD_DENY); never intersect with freshly written `ORCHESTRATOR_TOOL_ALLOWLIST`. Cover with unit test that first spawn retains evaluate/click. *(F1 — dead product without this)*  
2. **Deny worker-stamped L2 confirmations on `chat.abort` / `fleet.stop_all` / `worker_cancel`** before lease release; free admission/flight via existing L2 finally. *(F2)*  
3. **Refuse post-approve hard promote that re-HARDs a FREE tab after cancel** (`POST_CONFIRM_CANCELLED` / no free-path steal). *(F2)*  
4. **`evaluate` / `TAB_L2_TOOLS` always exclusive-lease even on auto-approve** (early HARD or post-skip acquire). *(F3)*  
5. **Tests for (2)+(3)+(4):** stop_all mid-confirm clears admission; zombie approve no-op; auto-approve evaluate second worker gets `TAB_LOCKED`.

Nits may ride the same PR; they are **not** ship gates.

---

## 9. Recommended merge bar

| Flip condition | Requirement |
|----------------|-------------|
| **no-ship → ship** | must_fix **1–5** implemented + green unit suite |
| GATE1 hold | Do not reopen admission order / soft finally / pre-L2 flight |
| Evidence | Re-run companion + extension tests; include spawn whitelist + cancel-confirm tests |

---

## 10. Dual-pass notes

- **Independent audit (this doc):** **no-ship** — F1 spawn whitelist is a hard product break (`[executed]`); F2 cancel exclusivity agrees with GATE2-Pi; F3 evaluate auto-approve lease hole is additional exclusivity invariant break.  
- **Claude CLI (`claude -p`):** started; **timed out** — not authoritative for this artifact.  
- **Consensus with GATE2-Pi:** cancel/zombie L2 is ship-blocking. **Delta:** this review elevates **spawn whitelist order** as the highest-severity must_fix (Pi GATE2 did not list it; product cannot ship without workers that can act).

---

*Artifact path: `docs/audit/reviews/multi-agent-gate2-claude.md`*
)
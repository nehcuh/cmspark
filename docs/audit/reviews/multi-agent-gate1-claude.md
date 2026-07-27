# GATE 1 Dual Review — Multi-Agent P1 Remaining (L2 FIFO · Single-Flight · Fleet UI)

| Field | Value |
|-------|--------|
| **Reviewer** | Claude dual pass (Claude Code CLI `claude -p` + independent code audit) |
| **Date** | 2026-07-27 |
| **Worktree** | `/Users/huchen/Projects/cmspark/.claude/worktrees/multi-agent-p0` |
| **Scope (P1 remaining)** | L2 FIFO admission, process single-flight for shell/netsec, FleetStrip + Cockpit fleet surface |
| **ADR** | [ADR-015](../../adr/015-multi-agent-orchestrator-tab-lock.md) §3.5 / §4 / §5 + 实现进度表 |
| **Verdict** | **APPROVE_WITH_CHANGES** |

---

## 1. Executive verdict

**APPROVE_WITH_CHANGES.** Confidence **76%**.

The P1 kernel is real and largely matches ADR-015:

- L2 admission (`l2-admission.ts`) enforces `max_active_l2_per_run=1` and `max_active_l2_process=2`, with `finally { releaseL2Admission }` in `createToolExecutor` (`server.ts` ~1090–1262). `[executed]` unit tests for process cap / per-run cap pass as part of `orchestrator-l2-flight.test.ts` (suite green for those cases; full suite 1894 pass / 1 fail — see must_fix #7).
- Single-flight (`single-flight.ts`) process-wide check-and-set + `finally { releaseFlight }` on `shell_exec` / `netsec_port_scan` companion cases is correct for mutual exclusion after token validation. `[executed]` unit tests for busy + independent tools pass.
- FleetStrip + message-router `fleet.*` / `worker.*` / `tab.force_release` + Cockpit fleet counts + Confirm Center multi-agent identity fields are wired end-to-end (companion → WS → agentStore → UI).

It is **not merge-clean for GATE 1** until the ordered **must_fix** list below is closed. The load-bearing issues are: (a) SOFT tab exclusivity can die before/during confirm because soft deadline does not cover L2 admission wait, (b) SOFT lease leak on post-approve hard re-acquire failure, (c) shell/netsec flight acquired **after** user L2 approve (doomed approve), and (d) one integration test still asserts pre-lease `list_tabs` shape (CI red).

---

## 2. Evidence base

### Read / inspected

| Artifact | Notes |
|----------|--------|
| `docs/adr/015-multi-agent-orchestrator-tab-lock.md` | Q1 SOFT 互斥, §3.5 caps, §4 L2/single-flight, §5 FleetStrip, P1 progress |
| `companion/src/orchestrator/l2-admission.ts` | FIFO queue + caps |
| `companion/src/orchestrator/single-flight.ts` | shell/netsec Map |
| `companion/src/orchestrator/fleet.ts` | snapshot for UI |
| `companion/src/orchestrator/constants.ts` | caps + `TAB_L2_TOOLS` |
| `companion/src/orchestrator/tab-lease.ts` | SOFT 45s deadline, hard re-acquire, release soft |
| `companion/src/server.ts` | L2 gate ~621–1318, shell/netsec ~2397–2449, multi-agent early gates ~446–520 |
| `companion/src/message-router.ts` | `fleet.status/stop_all`, pause/resume, force_release, chat.abort drain |
| `chrome-extension/.../FleetStrip.tsx` | Side Panel strip |
| `chrome-extension/.../CockpitApp.tsx` | Confirm Center + fleet counts |
| `chrome-extension/.../useWebSocket.ts` | fleet + confirm hydration |
| `companion/tests/orchestrator-l2-flight.test.ts` | unit coverage |

### Executed

```text
npm test  (companion) → 1894 pass, 1 fail
  fail: integration/ws-roundtrip list_tabs deepEqual (extra lock metadata fields)
L2 admission / single-flight / llm-loop / forceRelease cases: pass within suite
claude -p --permission-mode bypassPermissions  (adversarial dual pass) → same overall verdict
```

---

## 3. What is solid (do not regress)

1. **Admission accounting is balanced.** Immediate path and dequeue path both increment; `releaseL2Admission` decrements and `tryDequeue`s. Timeout path returns `{ok:false}` **without** having taken a slot (waiter removed from queue only). ADR invariant #2 honored on the happy path via `try/finally`.

2. **SOFT exclusivity is intended for Q1.** evaluate without token takes SOFT/HELD_PENDING_L2 before the user is asked; non-holder gets `TAB_BUSY_CONFIRMING` / `TAB_LOCKED` and does not enter a second confirm. That is the correct product shape for “never approve a doomed tab op.”

3. **Confirm Center identity** stamps `worker_id` / `parent_thread_id` / `orchestrator_run_id` / `worker_role_label` / `tab_id` into `security.confirmation.request` (`security-confirmation.ts` ~231–246); Cockpit `ConfirmElevated` surfaces worker label + tab id; Side Panel store types include the fields.

4. **Single-flight finally is correct** for the execute path once the flight is held: throw from `shellExec` / `netsecPortScan` still releases. Shell has its own 60s timeout (`capability/shell.ts`).

5. **Fleet control plane** matches ADR pause/cancel semantics at the companion layer:
   - `chat.abort` → reject pending + release all leases for thread
   - `fleet.stop_all` → abort + reject + release + pause all workers
   - `worker.pause` → abort LLM, keep leases (ADR §3.4)
   - `tab.force_release` → pending-aware FORCE_RELEASING → reject → complete

6. **Caps match §3.5** (`ORCHESTRATOR_CAPS`): workers 5, llm loops 5, tabs/worker 2, tabs/process 10, L2/run 1, L2/process 2, idle 120s, hard 600s.

7. **UI placement** matches ADR §5: Side Panel ~320px FleetStrip; Cockpit remains Confirm Center shell with fleet counts (full dashboard deferred to P2 — acceptable).

---

## 4. Attack findings (P1 focus)

### 4.1 L2 FIFO + SOFT ordering — correctness

#### F1 · SOFT deadline shorter than admission wait + confirm (bug · Q1)

**Where:** `tab-lease.ts:163` `softDeadline: t + 45_000` vs `l2-admission.ts:16` `ADMISSION_TIMEOUT_MS = 60_000` vs confirm default `DEFAULT_SECURITY_CONFIRMATION_TIMEOUT_MS = 45000`.

**Path today** (`server.ts` ~1033–1090):

1. `acquireOrRenewTabLease({ needsL2: true })` → SOFT, softDeadline = now+45s  
2. `await acquireL2Admission(...)` → may block **up to 60s** while still holding SOFT  
3. Then show confirm for another **≤45s**

**Failure mode:** `sweepExpired` can delete SOFT at T+45s while the holder is still waiting for admission **or** mid-confirm after a long admission queue. Tab becomes FREE. Another worker can HARD/SOFT acquire. Original holder then:

- still shows UI (admission already granted / confirm open), or  
- on approve calls `hardReacquireAfterConfirm` which may fail with `TAB_LOCKED` **after** the user already approved  

That is exactly the “user white-clicks approve on a doomed op” failure Q1 was designed to ban — just via TTL, not via concurrent SOFT.

**Fix (pick one, prefer A):**

- **A (recommended):** Order = L2 admission → then SOFT/HELD_PENDING_L2 → then confirm dialog. Soft deadline = confirm timeout only.  
- **B:** Keep order but set `softDeadline = ADMISSION_TIMEOUT_MS + confirmTimeoutMs` and refresh soft on admission grant.

#### F2 · SOFT leak when hard re-acquire fails after approve (bug)

**Where:** `server.ts:1298–1317`.

On approve, if `hardReacquireAfterConfirm` returns `!ok`, the code returns the tool error **without** `releaseSoftOrPendingL2`. Admission slot is already freed in `finally`, but SOFT / HELD_PENDING_L2 remains until TTL.

**Fix:** Mirror the deny path — call `releaseSoftOrPendingL2` (or force-free SOFT for this confirmId) before return.

#### F3 · Exception between soft hold and decision (bug)

**Where:** `server.ts:1090–1262`.

`try/finally` only releases L2 admission. If the confirm IIFE throws (tray race edge, unexpected), `decision` is unset; soft is not released on the subsequent throw.

**Fix:** Outer `try/finally` that releases soft on any exit without successful hard re-acquire.

#### F4 · “FIFO” is scan-skip, not strict head-of-line (doc / product)

**Where:** `l2-admission.ts:31–43` `tryDequeue`.

Dequeuer walks the queue and admits the **first waiter that `canAdmit`**, skipping a head waiter blocked on per-run cap=1 so a later different-run waiter can jump. Throughput-positive; not pure FIFO.

**Fix:** Either document as “FIFO among currently admissible waiters” in ADR §4 + file header, or implement strict HOL (and accept head-of-line blocking). Do not leave “FIFO” unqualified.

#### F5 · L2 tab soft path hardcodes `evaluate` (dormant bug)

**Where:** `server.ts:1037` `toolName === "evaluate"` vs `TAB_L2_TOOLS` in `constants.ts:62`.

Future `TAB_L2_TOOLS` additions skip SOFT. Use `TAB_L2_TOOLS.has(toolName)`.

### 4.2 Single-flight — UX / security product

#### F6 · Flight acquired after L2 approve (bug-ux · ADR spirit)

**Where:** `server.ts:2397–2449`.

Flow: L2 confirm (user approves) → issue token → companion case → `tryAcquireFlight` → may return `SHELL_BUSY` / `NETSEC_BUSY`.

User already consented; the op is then rejected for an in-process lock they were never told about. Mirrors the SOFT post-confirm TAB_LOCKED anti-pattern ADR forbids for tabs.

**Fix (prefer small):**

- Before requesting L2 for `shell_exec` / `netsec_port_scan`, `tryAcquireFlight` **or** a non-holding `isFlightBusy` probe; if busy, return recoverable `*_BUSY` **without** showing L2.  
- Or: reserve flight slot for the duration of L2 (release on deny/timeout; keep through execute on approve). Careful: do not hold flight across 45s if that serializes unrelated host ops excessively — probe-first is cheaper.

Note: workers are HARD_DENIED shell/netsec by default; this still hits normal/orchestrator-elevated and concurrent parent threads, which is the multi-agent storm case ADR §4 cares about.

### 4.3 Fleet UI

#### F7 · Integration test expects pre-lease `list_tabs` shape (CI bug)

**Where:** `companion/tests/integration/ws-roundtrip.test.ts` (compiled fail at deepEqual).

Actual tab objects include `locked_by_thread_id` / `lease_state` / `lease_expires_at` (null when free) — ADR-required metadata. Test still expects `{ id, url }` only.

**Fix:** Update assertion to allow lock fields (or assert them explicitly). GATE 1 should not ship with a red suite.

#### F8 · `paused` shadows `holding_tabs` in fleet status (product)

**Where:** `fleet.ts:50–52`, worst_status rollup ~70–73.

ADR: pause keeps leases. UI status prefers `paused` over `holding_tabs`, so FleetStrip can show “已暂停” while tabs remain exclusively held — operator may not force-release.

**Fix:** Prefer `holding_tabs` when locks.length > 0 even if paused (or composite status `paused+holding`).

#### F9 · Dual poll / dual confirm surfaces (suggestion)

FleetStrip 4s + Cockpit 5s independent `fleet.status` polls; Side Panel MinimalConfirm + Cockpit ConfirmElevated both can answer non-origin-bound multi-agent confirms (originWs only forced for host_computer / nonce). First-wins is OK; dual UI is intentional Confirm Center stretch. Accept for P1; P2 should push fleet events from companion on lease change and keep a single elevated confirm surface when Cockpit is open.

#### F10 · HITL enterWorker message swap (suggestion)

`FleetStrip` `enterWorker` → `SET_ACTIVE_THREAD` + `thread.select`. Cockpit compact chat is `state.messages` tail — depends on SW rehydrate. Verify contract; if laggy, show “切换中…” or bind messages to activeThreadId explicitly.

---

## 5. ADR claim checklist (P1 remaining)

| ADR / progress claim | Status |
|----------------------|--------|
| L2 FIFO admission 1/run, 2/process + finally release | **Partial** — caps + finally OK; soft/admission ordering + deadline wrong; FIFO not pure |
| shell/netsec process single-flight | **Partial** — execute-path OK; post-approve busy violates confirm authority |
| FleetStrip counts / worst / pending / stop-all / open Dashboard | **Met** for P1 strip |
| Confirm Center worker/tab/run identity | **Met** |
| Cockpit fleet counts | **Met** (not full grid — P2 OK) |
| Unit tests lease + L2 + flight + force-release | **Met** for unit; **integration red** on list_tabs metadata |

---

## 6. Ordered must_fix (GATE 1 gate)

1. **Cover SOFT exclusivity for the full L2 path:** acquire L2 admission **before** SOFT (preferred), **or** set/refresh `softDeadline ≥ admission wait + confirm timeout` so SOFT cannot expire while holder is still in the confirm path. (F1)
2. **Release SOFT/HELD_PENDING_L2 on `hardReacquireAfterConfirm` failure** after user approve (`server.ts` ~1305–1317). (F2)
3. **Guarantee soft release on any non-success exit** of the L2 block (throw / timeout / deny) via a single `finally` paired with `tabL2SoftHeld`. (F3)
4. **Probe or reserve single-flight before L2 for `shell_exec` / `netsec_port_scan`** so approve cannot be followed by `*_BUSY`. (F6)
5. **Update `ws-roundtrip` (and any sibling) `list_tabs` expectations** for lock metadata fields so companion test suite is green. (F7)
6. **Use `TAB_L2_TOOLS.has(toolName)`** instead of `toolName === "evaluate"` for soft-hold. (F5)
7. **Fleet status: prefer/compose holding_tabs when paused worker still holds leases.** (F8)
8. **Document or implement true FIFO** for L2 admission (`tryDequeue` skip-head vs HOL) and align ADR §4 wording. (F4)

Nits (not blocking GATE 1): dual fleet poll, Cockpit layout shift on ConfirmElevated, dead `"unknown"` status, double `threadManager.get` in L2 path, stop-all uses `window.confirm` vs Confirm Center pattern.

---

## 7. Dual-pass notes

- **Claude CLI (`claude -p`, permission bypass):** Verdict APPROVE_WITH_CHANGES; primary must_fix = hard-reacquire SOFT leak, post-L2 single-flight busy, FIFO wording, TAB_L2_TOOLS literal, dual poll, paused shadows locks.
- **Independent audit:** Same verdict; elevates **softDeadline vs 60s admission** (F1) as the highest-severity Q1 hole (not fully called out by CLI pass) and flags red integration test as CI gate.
- **Consensus:** Do not REJECT the architecture; do not APPROVE clean. Ship only after must_fix 1–5 at minimum (1–4 correctness/UX; 5 CI).

---

## 8. Recommended merge bar

**Minimum for APPROVE flip:** must_fix **1–5** implemented + unit tests for:

- admission wait longer than old 45s soft without free-stealing  
- hard re-acquire fail releases soft  
- shell_exec L2 path returns BUSY **without** confirm when flight held  
- list_tabs lock fields accepted by integration test  

must_fix 6–8 can ride the same PR if cheap.

---

*Artifact path: `docs/audit/reviews/multi-agent-gate1-claude.md`*
)

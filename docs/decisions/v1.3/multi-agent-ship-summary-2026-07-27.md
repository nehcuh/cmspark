# Multi-Agent Ship Summary — ADR-015 P0 / P1 / P2-lite

| Field | Value |
|-------|--------|
| **Date** | 2026-07-27 |
| **Branch** | `feat/multi-agent-p0` |
| **Worktree** | `/Users/huchen/Projects/cmspark/.claude/worktrees/multi-agent-p0` |
| **HEAD (at write)** | `32d46f6` — `fix(multi-agent): GATE2 must_fix — spawn whitelist, cancel L2, exclusive evaluate` |
| **ADR** | [ADR-015](../../adr/015-multi-agent-orchestrator-tab-lock.md) |
| **Product usage** | [mission-pack-usage.md §10](../../mission-pack-usage.md) |
| **Scope** | P0 kernel + P1 (FleetStrip / L2 FIFO / single-flight) + P2-lite (TabQueue + deferred markers) |

---

## 1. Executive summary

Multi-agent orchestration lands as **workers = child threads** under a narrow-tool **orchestrator**, with **Companion-authoritative tab exclusive leases** (not prompt-only locks). Side Panel shows **FleetStrip**; L2 stays in the existing Confirm Center (Cockpit-capable). Full Dashboard grid is **not** in this ship.

| Layer | Status |
|-------|--------|
| **P0** (lease SM, `isToolAllowed`, spawn HITL, caps, cancel drain) | **Delivered** |
| **P1** (FleetStrip, Confirm identity, L2 FIFO, shell/netsec single-flight) | **Delivered** |
| **P2-lite** (extension `TabQueue` + tests; deferred labels) | **Delivered** |
| **P2 full** (Dashboard grid / lease map / WS multi-worker E2E) | **Not this ship** |

**Test snapshot** `[executed]` @ worktree 2026-07-27:

- companion: **1909 pass / 0 fail** (18 skipped; full suite)
- GATE2 unit coverage: spawn browser whitelist, `rejectForWorker` mid-confirm, `POST_CONFIRM_CANCELLED`, auto-approve evaluate exclusivity

---

## 2. P0 delivered

| Item | Location / notes |
|------|------------------|
| Tab lease map + SM (`FREE` → `SOFT_RESERVED` 互斥 → `HELD_PENDING_L2` → `HARD_HELD` → `FORCE_RELEASING`) | `companion/src/orchestrator/tab-lease.ts` |
| Caps (§3.5): 5 workers/run, 5 multi-agent LLM loops, 2 tabs/worker, 10 process tabs, L2 1/run · 2/process, idle 120s, hard 600s | `orchestrator/constants.ts` |
| `isToolAllowed` **before** L2 / dispatch; gate **fail-closed** (`ORCHESTRATOR_GATE_ERROR`) | `createToolExecutor` in `server.ts` |
| `pendingToolCalls.thread_id` + `tabId`; `rejectPendingForThread` | `server.ts` |
| Multi-agent `TAB_ID_REQUIRED`; no silent active-tab fallback | executor + `BrowserBridge` |
| `spawn_worker` + non-empty whitelist + `WORKER_HARD_DENY` (evaluate **allowed**, Q2) | `orchestrator/spawn.ts` |
| Spawn whitelist from **pre-promotion** parent capability (`null` → roleAllow − HARD_DENY) | GATE2 fix `32d46f6` |
| Real spawn HITL: L2 `security_token` only; LLM `user_confirmed` **not** trusted | `L2_GATE_TOOLS` / spawn path |
| Optional `pack.apply` after spawn (role template; no `capability_profile` lift) | companion spawn case |
| `list_tabs` lock metadata; `create_tab` auto HARD-hold; `list_tab_locks` | executor + tools |
| host_computer × Chrome/Chromium blocked while **any** tab lease (Q4) | `server.ts` |
| Cancel / stop: `rejectForWorker` **before** lease drain; pending-aware FORCE_RELEASING | `security-confirmation.ts`, `message-router.ts`, `server.ts` |
| Post-cancel approve: **no** free-path re-HARD (`POST_CONFIRM_CANCELLED`) | `hardReacquireAfterConfirm` |
| `evaluate` / `TAB_LEASE_TOOLS` always exclusive HARD (incl. auto-approve domains) | early lease gate |
| Unit tests: lease SM, spawn WL, force-release drain | `companion/tests/orchestrator-tab-lease.test.ts` |

---

## 3. P1 delivered

| Item | Location / notes |
|------|------------------|
| **FleetStrip** (count, worst status, pending confirm badge, open Cockpit, stop-all) | `chrome-extension/.../FleetStrip.tsx` |
| fleet WS: `fleet.status` / `stop_all` / `worker.pause|resume` / `tab.force_release` | `message-router.ts` + `orchestrator/fleet.ts` |
| Confirm Center multi-agent identity: `worker_id`, `parent_thread_id`, `orchestrator_run_id`, `tab_id`, role label | `security-confirmation.ts` + UI |
| Confirm **stop** authoritative: `stop_thread` + `stop_thread_id` → deny + abort + reject + leases | payload + `handleSecurityConfirmationResponse` |
| L2 **scan-skip FIFO** admission (1/run, 2/process); order: flight → admission → SOFT → confirm; `finally` release | `l2-admission.ts` + `server.ts` |
| shell_exec / netsec **process single-flight** reserved **before** L2; re-entrant same owner | `single-flight.ts` |
| `max_concurrent_multi_agent_llm_loops=5` on multi-agent `chat.create` | `llm-loop-gate.ts` |
| Filter LLM tool schemas by thread `tool_whitelist` | `llm/adapter.ts` |
| `ask_user` binary HITL via Confirm Center | tool + companion case |
| `wait_workers` **poll-only** snapshot (not true barrier) | by design |
| Pause ≠ cancel: pause aborts LLM, **keeps** leases + open L2 | ADR §3.4 |
| HITL enter (Q5): switch active thread only; **no** auto lease steal | FleetStrip enter |
| Unit tests: L2 caps, multi-admit, flight, llm-loop, rejectForWorker | `companion/tests/orchestrator-l2-flight.test.ts` |

---

## 4. P2-lite delivered

| Item | Location / notes |
|------|------------------|
| Extension **per-tab serialize queue** (defense-in-depth under Companion lease) | `chrome-extension/src/background/tab-queue.ts` + `browser-bridge.ts` |
| TabQueue unit tests | `chrome-extension/tests/tab-queue.test.ts` |
| ADR + usage: **shared-observer** and **auto-spawn** explicitly deferred | ADR-015 progress table; mission-pack-usage §10.6 |

---

## 5. Deferred / not this ship

| Item | Decision | Rationale |
|------|----------|-----------|
| **shared-observer** read-only shared lease | Defer | Keep full exclusivity for read+write; dual-track SM is a separate product+ADR change |
| **auto-spawn** / silent fan-out | Defer / no | Spawn remains explicit L2 only |
| Full Dashboard grid / lease map / audit trail UI | P2 full | FleetStrip + Cockpit counts only |
| `wait_workers` true barrier | Open | Poll-only by design this phase |
| Extension mid-CDP `tool.abort` | Open | Companion reject + FORCE_RELEASING best-effort; no host CDP cancel |
| SOFT wait-queue (vs pure `TAB_BUSY_CONFIRMING`) | P1 optional | Reject-other is correct for Q1 |
| `ask_user` free-text answers | Open | Binary approve/deny only |
| WS multi-worker E2E integration suite | Open | Kernel unit-covered; full WS E2E pending |
| Soft/confirm residual ms skew (mitigated +2s + confirm-bound expire) | Residual | Not ship-blocking after GATE2 skew fix |
| host Chrome string heuristic residual | Residual | Q4 intent met |

---

## 6. Gate verdicts

### GATE 1 (implementation: L2 FIFO · single-flight · Fleet · lease races)

| Reviewer | Artifact | Initial verdict | After `48a84c4` |
|----------|----------|-----------------|-----------------|
| **Claude** | [`docs/audit/reviews/multi-agent-gate1-claude.md`](../../audit/reviews/multi-agent-gate1-claude.md) | **APPROVE_WITH_CHANGES** (76%) | must_fix **HOLD** (re-checked in GATE2) |
| **Pi** | [`docs/audit/reviews/multi-agent-gate1-pi.md`](../../audit/reviews/multi-agent-gate1-pi.md) | **BLOCK** (84%) | must_fix **HOLD** |

**GATE1 must_fix landed** (`48a84c4`):

1. L2 order: **admission → SOFT → confirm**; `softDeadline` = confirm timeout (+ later skew)
2. SOFT release on hard-reacquire fail / non-success exit (`finally`)
3. shell/netsec flight **before** L2
4. `tryDequeue` multi-admit (scan-skip FIFO); documented in ADR §4
5. Every sweep pending-aware; FORCE_RELEASING drain/GC
6. Confirm Center `stop_thread` / `stop_thread_id` authoritative companion drain
7. Orchestrator gate fail-closed; `TAB_L2_TOOLS.has`; list_tabs lock metadata tests green
8. Fleet prefers `holding_tabs` when paused + locks present

### GATE 2 (final ship: false exclusivity · cancel · product spawn)

| Reviewer | Artifact | Verdict @ review HEAD | Review HEAD |
|----------|----------|----------------------|-------------|
| **Claude** | [`docs/audit/reviews/multi-agent-gate2-claude.md`](../../audit/reviews/multi-agent-gate2-claude.md) | **no-ship** (88%) | `13b6822` |
| **Pi** | [`docs/audit/reviews/multi-agent-gate2-pi.md`](../../audit/reviews/multi-agent-gate2-pi.md) | **BLOCK** (86%) | post-`48a84c4` |

**GATE2 must_fix landed** (`32d46f6`) — code + unit tests; **formal dual re-review not re-run at HEAD**:

| # | must_fix | Status |
|---|-----------|--------|
| 1 | Worker whitelist from **pre-promotion** parent (`null` → roleAllow − HARD_DENY) | **Done** + test |
| 2 | `rejectForWorker` on `chat.abort` / `fleet.stop_all` / `worker_cancel` / `stop_thread` before lease drain | **Done** + test |
| 3 | Refuse free-path re-HARD after cancel (`POST_CONFIRM_CANCELLED`) | **Done** + test |
| 4 | `evaluate` / tab tools exclusive under auto-approve (early HARD) | **Done** + test |
| 5 | Tests for 2–4 | **Done** in `orchestrator-*-*.test.ts` |

**Ship stance (docs, not a new dual-review):**

- GATE1: **cleared** (must_fix hold).
- GATE2: **must_fix implemented at `32d46f6`**; merge bar from GATE2 Claude §9 is met on unit evidence. Recommend a short GATE2 re-pass for formal **ship** stamp if process requires dual reviewer flip; residual debt in §5 remains non-blocking for P0+P1+P2-lite.

---

## 7. How to test FleetStrip + tab locks

### 7.1 Automated (preferred regression bar)

From the worktree:

```bash
cd /Users/huchen/Projects/cmspark/.claude/worktrees/multi-agent-p0

# Companion — lease / L2 / flight / cancel / spawn
npm --prefix companion test -- --test-name-pattern 'orchestrator|GATE2|lease|L2|fleet|spawn|rejectForWorker'

# Or full companion suite
npm --prefix companion test

# Extension — TabQueue (+ rest of suite)
npm --prefix chrome-extension test -- --test-name-pattern 'tab-queue|TabQueue'
npm --prefix chrome-extension test
```

**Key unit cases to stay green:**

| Test | File | Asserts |
|------|------|---------|
| SOFT exclusive (Q1) | `orchestrator-tab-lease.test.ts` | second worker blocked |
| GATE2 spawn browser WL | same | null-parent + tool_allow retains evaluate/click |
| auto-approve evaluate exclusive | same | peer `TAB_LOCKED` |
| free-path re-HARD refused | same | `POST_CONFIRM_CANCELLED` |
| pending-aware cancel release | same | FORCE_RELEASING → complete |
| L2 process/run caps + multi-admit | `orchestrator-l2-flight.test.ts` | FIFO scan-skip |
| shell/netsec single-flight | same | BUSY + re-entrant owner |
| GATE2 rejectForWorker mid-confirm | same | admission clears; zombie approve no-op |
| TabQueue serialize | `chrome-extension/tests/tab-queue.test.ts` | per-tab ordering |

### 7.2 Manual — FleetStrip

1. Start companion + load extension build from this worktree (`chrome-extension` `npm run dev` / prod build).
2. Open Side Panel; ensure WS paired.
3. In a normal thread, ask the model to act as orchestrator and **`spawn_worker`** with browser tools (or narrow tools already include spawn).
4. **Confirm Center** must show spawn L2 — approve once.
5. Side Panel **FleetStrip** should show worker count / status badge; optional open Cockpit for Confirm identity (`worker_id` / `tabId` / run).
6. **Pause** one worker: LLM stops; leases **remain** (pause ≠ cancel).
7. **Stop all**: open L2 dialogs for that worker **close** (denied); leases release; no zombie approve re-HARD.
8. **Enter** worker from FleetStrip: active thread switches; follow-up chat works; mutating another worker’s tab still needs force-release / wait.

### 7.3 Manual — tab locks

1. Spawn **two** workers (two L2 spawn confirms; max 5/run).
2. Give worker-A a task that uses a concrete `tabId` (list_tabs first; multi-agent forbids silent active-tab).
3. While A holds HARD (or SOFT mid-confirm), have B target the **same** `tabId` → expect recoverable `TAB_LOCKED` or `TAB_BUSY_CONFIRMING` — **not** a second confirm.
4. Deny A’s confirm → soft frees; B may then acquire.
5. Approve A → HARD; after A finishes / cancel, B can acquire.
6. With any lease held, try `host_computer` against Chrome/Chromium UI → blocked (Q4).
7. Force-release from UI (`tab.force_release` / fleet path): pending-aware path if CDP in-flight.

### 7.4 Observability

- Capability / multi-agent audit stream: `~/.cmspark-agent/logs/capability-audit.jsonl` (spawn / L2 / lease / force-release / HITL).
- Thread metadata: `~/.cmspark-agent/threads/index.json` (`parent_thread_id`, `orchestrator_run_id`, `tool_whitelist`, worker labels).

---

## 8. Commit timeline (this branch)

```
73a0899 feat(multi-agent): P0 tab lease, spawn_worker, isToolAllowed gate (ADR-015)
2a41cef feat(multi-agent): FleetStrip + Confirm Center (ADR-015 P1)
6ab49f3 feat(multi-agent): L2 FIFO admission, shell/netsec single-flight, tab queue
748f481 feat(multi-agent): close ADR-015 kernel gaps (llm cap, spawn HITL, whitelist)
48a84c4 fix(multi-agent): GATE1 must_fix — L2 order, soft/flight, stop, sweeps
13b6822 fix(multi-agent): P2 polish — TabQueue tests, defer shared-observer/auto-spawn
32d46f6 fix(multi-agent): GATE2 must_fix — spawn whitelist, cancel L2, exclusive evaluate
```

---

## 9. Kernel invariants (do not regress)

1. `isToolAllowed` before L2 and dispatch.  
2. L2 admission acquire → `finally { releaseL2Admission }`.  
3. shell/netsec flight acquire → `finally { releaseFlight }`.  
4. multi-agent LLM loop gate → `finally { releaseMultiAgentLlmLoop }`.  
5. Worker whitelist **non-empty**; spawn **must not** lift `capability_profile` / enable modules.  
6. Tab lease authority = Companion; extension queue = depth only.  
7. Cancel/stop **denies** worker-stamped L2 **before** lease free; no free-path re-HARD after cancel.  
8. Spawn = explicit HITL only (`security_token`).

---

## 10. Related artifacts

| Path | Role |
|------|------|
| `docs/adr/015-multi-agent-orchestrator-tab-lock.md` | Locked Q1–Q5 + progress |
| `docs/decisions/v1.3/multi-agent-orchestrator-synthesis-2026-07-27.md` | Design synthesis |
| `docs/decisions/v1.3/multi-agent-orchestrator-review-synthesis-2026-07-27.md` | Pre-impl review synthesis |
| `docs/audit/reviews/multi-agent-gate1-*.md` | GATE1 |
| `docs/audit/reviews/multi-agent-gate2-*.md` | GATE2 (pre-`32d46f6`) |
| `docs/mission-pack-usage.md` §10 | Operator how-to |
| `scratch/multi-agent-ship.md` | Short bullet summary |

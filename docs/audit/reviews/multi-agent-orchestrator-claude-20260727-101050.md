# Adversarial Design Review — Multi-Agent Orchestrator + Tab Lock

**Reviewer**: Claude (claude-opus-4-7 via Claude Code CLI)
**Date**: 2026-07-27
**Target**: `docs/decisions/v1.3/multi-agent-orchestrator-synthesis-2026-07-27.md` (run `wf_019fa14c28077b72b178c58657e736c8`, 18→14 survivors)
**Charter**: `multi-agent-orchestrator-review-brief-2026-07-27.md`
**User hard rule**: while a sub-agent operates a tab, no other agent may operate that tab until lock release.
**Code spot-checks executed**: `chrome-extension/src/background/browser-bridge.ts:1-200`, `companion/src/security-confirmation.ts:1-401`, `companion/src/threads/thread-manager.ts:240-522`, `companion/src/server.ts` (grep on `createToolExecutor`/`pendingToolCalls`/`tabUrlCache`/`COMPUTER_TASK_BUSY`/`L2_GATE_TOOLS`), `companion/src/llm/adapter.ts` (grep on `__thread_id`/`MAX_TOOL_CALL_ROUNDS`/`pinned_tabs`), `docs/adr/014-mission-pack-enterprise-modules.md`. All synthesis code anchors in the grounding block independently verified to match the repo.

---

## 1. Overall verdict

**APPROVE_WITH_CHANGES.** Confidence **78%**.

The synthesis is the best artifact this design round could have produced: it identifies the real correctness gap (per-tool RTT locking is insufficient; multi-tool episode lease is required), gets the enforcement placement right (Companion `createToolExecutor` before `ws.send(tool.execute)`, mirroring `host_computer` `COMPUTER_TASK_BUSY` at `server.ts:609-612,2437-2445`), and refuses the most tempting wrong answers (Extension-only locking, prompt-only locks, holding HARD across the 45s L2 wait, null worker whitelist, pinned-tabs-as-ownership). It also correctly calls out that `isToolAllowed` (`thread-manager.ts:499-504`) has **zero call sites** — the entire capability-downgrade story is theater until that's wired.

It is **not ready for P0 code** as written. The state machine has two load-bearing holes that the synthesis treats as "implementation details" but are actually product forks: (a) the SOFT_RESERVED→approve→re-acquire race that lets a user approve a doomed action, and (b) the L2-on-an-already-held-tab path that the state machine does not describe at all. Worker-cancel is correctly specified in shape but is **impossible to implement today** because `pendingToolCalls` (`server.ts:139`) is keyed by `tool_call_id` with no `thread_id` binding — synthesis lists that fix in P1 when it is a P0 prerequisite for the cancel path it puts in P0. Finally, several "implementation details" are in fact product decisions the synthesis silently makes (e.g., `evaluate` in `WORKER_HARD_DENY`).

The 22% uncertainty is split: ~10% on whether the SOFT_RESERVED race can be made acceptable to users without killing parallelism; ~7% on whether the Chrome-side UX (user typing in URL bar while agent holds lock) is even in scope; ~5% on whether HITL "act as holder" can be cleanly implemented without a lease-transfer primitive that the synthesis refuses to specify.

---

## 2. Attack the tab lock model

The hard rule is binary: **a tab under sub-agent operation is untouchable by other agents until release.** The synthesis's state machine is the right *shape* but under-specifies three transitions that violate the hard rule in practice, plus four auxiliary gaps.

### 2.1 State machine (synthesis §"Tab lock model")

> FREE \| SOFT_RESERVED(holder,confirm_id,deadline≤45s) \| HARD_HELD(holder,renewed_at,idle_ttl,hard_max_deadline) \| FORCE_RELEASING. Transitions: FREE → HARD_HELD (no L2 path) OR SOFT_RESERVED (L2 path, intent only, non-blocking to other SOFT). SOFT_RESERVED → user approve → hard re-acquire: if still free-or-same-holder → HARD_HELD else TAB_LOCKED post-confirm (recoverable). …

#### 2.1.1 SOFT_RESERVED→approve→TAB_LOCKED is a product fork, not an implementation detail

This is the most dangerous hole. Open question #5 ("should SOFT_RESERVED block other workers' soft intents") is treated as a tuning knob; it is not. The choice is binary and shapes the whole UX:

- **(a) Block early** (SOFT_RESERVED exclusive across workers): user never approves a doomed action. Cost: a worker that soft-reserves and whose user is slow blocks every other worker from soft-reserving that tab for ≤45s. With the proposed cap (≤1 active L2/run + ≤2 global, locked conclusion #9), this serializes multi-worker browser-mutate work.
- **(b) Accept post-confirm TAB_LOCKED** (synthesis default): user clicks Approve, system says "lol no, someone else grabbed it." User has now mentally approved an action that did not happen. They may walk away. The worker must re-request confirm — now the user sees the **same logical action twice** and either approves again (whack-a-mole) or denies (silent worker death).

The synthesis picks (b) implicitly with the parenthetical "recoverable" and then asks the question as if it were a knob. It is not. **Recommendation: pick (a) — block early — for P0**, accept the throughput hit, and revisit if real-world multi-worker browser-mutate workloads actually saturate the cap. The user's hard rule is about correctness, not throughput; honoring it must mean never letting the user approve an action that the system already knows it cannot execute.

#### 2.1.2 L2-on-an-already-held-tab is not in the state machine

The state machine has FREE→SOFT_RESERVED→HARD_HELD for the entry case. It does **not** describe: worker A holds HARD_HELD on tab 1, worker A then issues a second mutate tool on tab 1 that requires L2 (e.g., `evaluate`). Locked conclusion #6 says "same-holder re-entrant renew on each tab-tool entry" and locked conclusion #7 says "Do NOT hold exclusive lease across full SecurityConfirmationManager wait (default 45s)." These two statements **contradict** for the same-tab-L2 case:

- If we renew HARD_HELD on tab-tool entry, we hold HARD across the 45s L2 wait — violates #7.
- If we drop to SOFT_RESERVED for the L2 wait, we lose exclusivity on a tab we are actively operating — another worker can HARD-acquire it in the window, and now worker A's L2-approved tool lands on a tab the system thinks belongs to B.

The synthesis's state machine diagram is silent on this transition. **Must be specified as P0**: same-holder + same-tab + L2 tool → lease enters a `HELD_PENDING_L2(holder, confirm_id)` sub-state that **retains exclusivity** (other workers still see TAB_LOCKED with this holder) but does not start the idle_ttl countdown. On approve → renew HARD_HELD. On deny/timeout → return to HARD_HELD with the prior renewed_at preserved (do not release).

#### 2.1.3 TOCTOU between re-acquire and CDP dispatch is real and unaddressed

Synthesis (TAB_LOCK-4 reason): "hard re-acquire/renew immediately before dispatch." Good — but the dispatch itself is `ws.send(tool.execute)` followed by Extension `BrowserBridge.execute` followed by `chrome.debugger.attach` + CDP commands. `ensureAttached` (`browser-bridge.ts:119-155`) has a retry loop up to 10×500ms = ~5s waiting for a non-blank URL. During that window:

- The lease is held by the worker.
- Chrome itself can mutate the tab out from under the holder (user typing in URL bar, page-initiated navigation, manual tab close).
- The lock is in Companion's head only — Chrome is not aware of it.

Consequence: the worker can land CDP `Input.dispatchMouseEvent` on a tab whose content has changed since the LLM decided to click. This is a **stale-state risk**, not a lock-correctness risk per se, but it directly undermines the user's hard rule in spirit (the tab was "operated" by Chrome/user, then by the worker, with no sequencing).

**The synthesis must acknowledge this and pick a policy** (one of):

- (i) Subscribe to `chrome.tabs.onUpdated` in the Extension and push `tab.navigated` (`server.ts:3902` already does this); on receipt during an active lease, force-release with reason `EXTERNAL_MUTATION`. Strict, may be noisy.
- (ii) Best-effort: stamp the lease with the URL at acquire time; on each tab-tool dispatch, compare current `tabUrlCache` to stamped URL; mismatch → fail with `TAB_STALE`.
- (iii) Accept the risk and document it.

Synthesis currently does (iii) silently. Pick one.

#### 2.1.4 `list_tabs` must surface lock state or LLMs will hammer TAB_LOCKED

`list_tabs` is correctly exempt from the lock (TAB_LOCK-2 counter). But its return value today is just tab metadata. Under multi-agent, an LLM that picks a tabId and gets `TAB_LOCKED` has **no signal** about *why* or *who* or *when it will free*. It will retry, possibly with different params but same tab, possibly annoying the holder.

The synthesis's `TAB_LOCKED` error payload includes `holder_thread_id` (locked conclusion #6) — good. But that only fires after a refuse. **`list_tabs` output must include `locked_by_thread_id` / `locked_by_worker_id` / `lease_expires_at` per entry** so the orchestrator/worker LLM can pick a free tab up front. Without this, multi-agent browser work degrades into retry storms.

This is listed nowhere in the synthesis. **P0 addition.**

#### 2.1.5 `create_tab` leaves a race window

`create_tab` is exempt (no target tab). It returns a new tabId. The creator will typically want to operate the new tab immediately. Between `tool.result({id: newTabId})` arriving at the Companion and the worker's next tool dispatch, **another worker can HARD-acquire the new tabId** — it is FREE, after all.

Natural fix: `create_tab` auto-HARD_HELDs the new tab to the calling worker for ≤idle_ttl, renewable. Synthesis is silent. **P0 addition.**

#### 2.1.6 Renew trigger must be tab-tool entry only, not `tab.navigated`

TAB_LOCK-5 reason mentions "navigate same tabId → retain." Correct. But the synthesis does not say whether **page-initiated** navigation (no worker action) renews the idle_ttl. If it does, a page with a `meta refresh` or SPA router can hold a lease forever simply by emitting nav events. **Must specify:** renew fires on worker tab-tool dispatch only; `tab.navigated` from the Extension updates `tabUrlCache` and may invalidate (per 2.1.3) but does not refresh idle_ttl.

#### 2.1.7 Multi-tab cap is unbounded

Synthesis: "worker may hold a bounded multi-tab set acquired lazily." No number. A worker that grabs 5 tabs and then goes idle (or whose LLM loops) blocks 5 tabs. **Must specify:** per-worker cap (e.g., ≤3) and process-wide cap (e.g., ≤10) in P0; treat as open question only for tuning.

#### 2.1.8 Deadlock observation requires an orchestrator tool the synthesis doesn't list

Scenario: worker A holds {1,2}, worker B holds {3,4}. A issues navigate({tabId:3}) → TAB_LOCKED with holder=B. B issues click({tabId:1}) → TAB_LOCKED with holder=A. Both retry. The orchestrator is the only entity that can see this and break it (abort one worker, instruct release). But locked conclusion #2's orchestrator tool surface is `spawn/wait/collect/ask_user + read-only status (list_workers/get_worker_status)`. **No `list_tab_locks`.** Without it the orchestrator is blind to the deadlock. **Must add** `list_tab_locks` (or fold into `get_worker_status`) as a read-only orchestrator tool.

### 2.2 Enforcement layer

TAB_LOCK-4 places authoritative enforcement in Companion `createToolExecutor` (`server.ts:369-497`) before `ws.send(tool.execute)`. Verified: `L2_GATE_TOOLS` is at `server.ts:482`, `pendingToolCalls.set` at `server.ts:1550`, `tabUrlCache` at `server.ts:155`. Extension dual-check is demoted to P1 defense-in-depth. **This is correct** given dual-layer A1 (CLAUDE.md A1; `docs/architecture.md` §1.3-1.4).

**But** there is one cheap defense-in-depth that should be P0, not P1: when Extension `BrowserBridge.execute` calls `chrome.debugger.attach` (`browser-bridge.ts:146`) and Chrome returns "Another debugger is already attached," the Extension today throws a generic `Debugger attach failed for tab ${tabId}: ${e.message}` (`browser-bridge.ts:153`). Under multi-agent races (e.g., during the SOFT→HARD window the synthesis itself identifies), this leaks as an opaque error to the LLM. **Even in P0**, the Extension should map that specific Chrome error to a structured `{success:false, data:{error_code:'TAB_LOCKED_EXT'}}` so the LLM and audit see a consistent signal. Not the full queue — just the error-code mapping.

### 2.3 Read vs write

Locked conclusion #6: "P0: all tab-targeted tools including pure reads (screenshot/get_page_*/evaluate/osascript_eval after hard url→unique tabId resolve) require the lease; silent active-tab default forbidden under multi-agent (require explicit tabId). Optional shared-observer mode is non-default and later only."

**Correct call.** Read-only exclusivity in P0 is the only way to make the user's hard rule actually hold; a shared-observer mode is a real P2 enhancement, not a refactoring. The killed TAB_LOCK-2 correctly notes that `analyze_image`/`screenshot` have optional `tabId` with active-tab fallback (`browser-bridge.ts`, `analyzeImage`/`screenshot` cases at lines 54-59) — so under multi-agent the silent fallback must be banned at `createToolExecutor` (require explicit numeric `tabId`).

**One gap:** the synthesis bans silent active-tab default but does not specify the failure mode. Should missing-`tabId` under multi-agent return `{success:false, data:{error_code:'TAB_ID_REQUIRED'}}` or auto-resolve via `tab-resolver.ts` and then take the lock? Recommend: refuse with `TAB_ID_REQUIRED`. Auto-resolve + lock hides the ambiguity from the LLM and the user.

### 2.4 Lease vs per-tool

TAB_LOCK-3 (multi-tool episode lease) is the synthesis's strongest contribution. Per-tool RTT locking is correctly killed: `pendingToolCalls` (`server.ts:139-144`) only covers a single round-trip; the window between `tool.result` (`server.ts:1581-1584`) and the next holder's `pendingToolCalls.set` (1550) is a legal interleave under per-tool locking. The renewal-on-each-tab-tool-entry + idle_ttl + hard_max pattern mirrors `host_computer` `COMPUTER_TASK_BUSY` and is sound.

**Caveat the synthesis does not raise:** the lease's idle_ttl must be **long enough to absorb one LLM round-trip** (LLM call + tool selection + next dispatch). Today `MAX_TOOL_CALL_ROUNDS = 100` (`adapter.ts:96`) with each round potentially taking 5-30s of LLM time. If idle_ttl < LLM latency, the lease expires mid-thinking. **Recommendation:** idle_ttl ≥ 120s default; hard_max ≥ 600s; both overridable per pack and capped per worker.

### 2.5 L2 while holding lock

Covered in 2.1.2 above. The synthesis's locked conclusions #6 (renew on each tab-tool entry) and #7 (do not hold HARD across full 45s L2 wait) contradict for the same-tab-same-holder-L2 case. **Must be resolved with a `HELD_PENDING_L2` sub-state** that retains exclusivity without firing idle_ttl.

### 2.6 Deadlock

Beyond the worker↔worker deadlock in 2.1.8:

- **Holder vs orchestrator:** orchestrator is correctly forbidden browser mutate by default (locked conclusion #2). Even if elevated, tab lease still binds (locked conclusion #2: "Elevation still cannot bypass tab lease"). Sound.
- **HITL vs holder:** see §4.2 — synthesis says enter-worker "does not steal or transfer tab exclusive locks without explicit force-release" but also says "human second-mutate requires force-release or acting as holder identity." The "acting as holder identity" path is **unspecified**. Must pick one mechanism in P1 (see open question #3 in §7).
- **Cancel vs in-flight CDP:** the diagnosis `[C-LLM-1]` (cited in TAB_LOCK-5 evidence and ORCHESTRATOR_WORKER_MODEL-5 evidence) is that `chat.abort` does not cancel in-flight `tool.execute`. Locked conclusion #11 specifies the cancel path correctly (abort + reject pending + release leases) **but** the pending entries are keyed by `tool_call_id` only (`server.ts:139`), so the cancel implementation cannot identify which entries belong to the canceled worker without first adding `thread_id` to the map entry. **This is a P0 prerequisite** that the synthesis lists as P1 ("bind thread_id for cancel/ownership"). It must be P0 — see §5.

### 2.7 Other tab-axis issues

- **`osascript_eval` URL→tabId resolution.** TAB_LOCK-2 counter: "osascript_eval: require unique tabUrlCache/list_tabs match to one tabId or fail TAB_AMBIGUOUS." Sound. `osascript_eval` is companion-side (`COMPANION_TOOLS` path, no `tabId` normalize) — verify in P0 implementation that the gate fires for it too, not only for Extension-bound tools.
- **Cookie tools are exempt.** Correct — domain-scoped, not tab-scoped.
- **`set_tab_url` if revived** (TAB_LOCK-2 counter parenthetical). The "if revived" hedge suggests it may be dead today. Verify before P0; if alive, it must take the lock.

---

## 3. Attack the orchestrator/worker model

### 3.1 Worker = Thread (ORCHESTRATOR_WORKER_MODEL-1) — sound

Verified: `Thread` interface (`thread-manager.ts:259-272`) carries `tool_whitelist`, `pinned_tabs`, `active_skill_ids`, `skill_selection_mode`, `knowledge_selection_mode`, `mcp_selection_mode`, `active_mcp_server_ids`, plus Pack-applied `mission_pack_id`/`workspace_root` (ADR-014 §1, `pack-engine.ts:469-470`). `abortControllers` is keyed by `thread_id` (`message-router.ts:41`). Reusing this for workers is correct and avoids a duplicate security gate.

**But** the synthesis quietly requires Thread to grow fields it doesn't have today: `parent_thread_id`, `orchestrator_run_id`, `worker_role_label`, `capability_elevation_level`. TAB_LOCK-5 evidence notes "parent/role/run/status fields not implemented yet." This is a **schema migration** that must happen in P0 — `create()` (`thread-manager.ts:245-281`) doesn't accept these fields today, and the `Thread` interface (around line 259) doesn't define them. Without them, audit can't attribute (locked conclusion #12), and HITL enter-worker has nothing to display.

### 3.2 Narrow orchestrator tool surface (ORCHESTRATOR_WORKER_MODEL-2) — sound, with one caveat

The narrow default (`spawn/wait/collect/ask_user` + read-only `list_workers`/`get_worker_status`) correctly forces coordination via spawn+collect and prevents the orchestrator from competing for tabs. Sound.

The synthesis's own self-critique in ORCHESTRATOR_WORKER_MODEL-2 reason is the right one: "a correctly global H3 would already block parent steal of leased tabs even with full tools — narrow tools are still necessary for planning-layer isolation, cost control, and confirm-queue sanity, not as a substitute for tab lease enforcement." This is honest and correct.

**Caveat:** the orchestrator needs at least one more read-only tool — `list_tab_locks` (see §2.1.8). Without it, deadlock observation and intervention are impossible.

### 3.3 Spawn approval (ORCHESTRATOR_WORKER_MODEL-3) — sound

User-approved single or batch confirm before `chat.create`; auto-spawn opt-in and limited to non-elevated packs; never silent fan-out of L2/enterprise. Matches brief H5/H6 and non-goals. Sound.

**One ambiguity:** "batch confirm" — does one user-yes spawn N workers, or N user-yeses? For cost/safety, **recommend single confirm per spawn plan** (the orchestrator proposes a plan with N worker specs; user approves the plan once; system spawns all N; further spawns require a new confirm). Batch-of-N-as-one-confirm matches human mental model ("yes, do this multi-step plan") without becoming a rubber-stamp.

### 3.4 Pack as worker template (ORCHESTRATOR_WORKER_MODEL-4, SECURITY_L2_AND_CAPABILITY-2 killed→counter) — sound, with the `evaluate` problem

The formula in locked conclusion #4:
> effective = (parent.tool_whitelist===null ? role_pack.tools.allow : parent.tool_whitelist ∩ role_pack.tools.allow) \ WORKER_HARD_DENY \ role_pack.tools.deny. WORKER_HARD_DENY default = {shell_exec, netsec_port_scan, osascript_eval, host_computer, host_write, host_read, host_app, evaluate}.

This is correct set arithmetic and correctly handles the null-parent-whitelist hole (today `tool_whitelist: null` means "all tools" per `thread-manager.ts:265,499-504`).

**The `evaluate` inclusion in `WORKER_HARD_DENY` is a silent product call.** `evaluate` is the escape hatch for SPAs that the structured tools can't reach (the codebase's own comment at `browser-bridge.ts:188-190` calls out ISOLATED-vs-MAIN world scripting for "some SPAs block ISOLATED"). A worker that cannot `evaluate` cannot:

- Extract data the structured `get_page_text`/`get_element_info` can't reach.
- Trigger app-side event listeners (e.g., React `onChange` via `nativeInputValueSetter`).
- Read shadow DOM.

Workers with click/type/fill_form/screenshot/get_page_* but no `evaluate` are useful for happy-path automation and near-useless for adversarial SPAs. The synthesis puts `evaluate` in `WORKER_HARD_DENY` without justifying the cost. **This is a product call** (open question §7 #2). Engineering default should probably be **`evaluate` allowed under standard L2** (same path as today's interactive threads), not default-denied.

### 3.5 Concurrency caps (ORCHESTRATOR_WORKER_MODEL-5) — sound shape, wrong unit

The synthesis caps "≤1 active force-confirm dialog per orchestrator_run + small process-wide cap (e.g. ≤2)" (locked conclusion #9, SECURITY_L2_AND_CAPABILITY-1). The cap-on-fan-out instinct is correct. **The unit is wrong.**

Per-run caps mean: orchestrator spawns 4 workers; 2 need L2 in parallel; workers 3-4 queue behind workers 1-2's confirms. With 45s timeout started only on admission (good), workers 3-4 may wait ≤90s for their confirm to even appear. That is unacceptable UX for any real orchestrator.

**Recommendation:** cap is per-worker-thread (1 active L2 per worker), with a global cap that scales with worker count (e.g., `global_cap = max(2, n_workers)`). Per-run is the wrong axis.

### 3.6 Confirm storms (SECURITY_L2_AND_CAPABILITY-1) — sound structure, see 3.5 for cap unit

FIFO queue per run, identity fields on every request, `originWs` preserved, no broadcast approve API. Sound. Verified the `originWs` binding exists today (`security-confirmation.ts:104-112,282-297`) and `respond()` privileged path is single-caller (tray only) (`security-confirmation.ts:343-374`).

**Gap:** the synthesis requires every confirm request to carry `worker_id + parent_thread_id + orchestrator_run_id + tabId`. Today's `security.confirmation.request` payload (`security-confirmation.ts:197-225`) carries none of these — only `tool_name`, `dangerous_apis`, `code_preview`, risk fields, whitelist candidates. The `PendingConfirmation` interface (`security-confirmation.ts:115-145`) does carry `toolName` and `relevantDomains`/`relevantApps` but no worker/run/thread identity. **Adding these is a P0 schema change** to both the manager's internal struct and the wire payload. Listed implicitly in P0 but should be explicit.

### 3.7 Shell/netsec single-flight (SECURITY_L2_AND_CAPABILITY-3) — sound

Verified: `companion/src/capability/shell.ts` `shellExec` and `companion/src/netsec/scan.ts` `netsecPortScan` have no mutex today (cited in synthesis evidence). The proposal to add a host_computer-style process-wide single-flight (≤1 in-flight shell_exec, ≤1 in-flight netsec_port_scan across the entire Companion process, regardless of worker count) is correct and directly analogous to `COMPUTER_TASK_BUSY` (`server.ts:609-612,2437-2445`).

**One nit:** "single-flight (or strict low concurrency=1)" — pick one. Concurrency=1 with queue is more flexible (workers don't get hard errors; they wait) but adds queue-management surface. Single-flight with `BUSY` recoverable error is simpler and matches the existing host_computer pattern (`computerTaskAbort` map). Recommend single-flight with recoverable busy for symmetry.

### 3.8 Non-inheriting enterprise modules (SECURITY_L2_AND_CAPABILITY-5) — sound

Process-global `capability_profile` (extension cannot forge enterprise, ADR-014 §2), per-thread `netsec_task_auth` (`message-router.ts netsec.authorize_task` cited), community refusal of shell/netsec spawn roles. Sound. The residual risk noted — "worker tool surfaces must be explicit allowlists; default `tool_whitelist: null` fails open" — is exactly the `isToolAllowed` wiring issue (§5, MUST-FIX #2).

### 3.9 Audit (locked conclusion #12, killed SECURITY_L2_AND_CAPABILITY-4) — sound upgrade

The killed proposal correctly identified that the original audit rule was forgeable (attribution from tool args) and had no privileged writer. The counter — Companion-only privileged `AuditWriter`, `actor_role∈{user,orchestrator,worker}`, `worker_id?`, `orchestrator_run_id?`, `thread_id`, `tool_name`, `decision/outcome`, `confirmation_id?`, SoT = `capability-audit.jsonl` (append-only 0o600), fail-closed preferred on elevation/L2 approve — is correct. Verified `capability-audit.jsonl` is the existing SoT (`companion/src/packs/audit-log.ts`; ADR-014 §4; CLAUDE.md A9).

**One concern:** "fail-closed preferred on elevation/L2 approve if audit write fails." This is right for elevation/L2-approve (high blast radius). But applying it to **every** audit event (start/finish/disconnect) means a transient disk-full takes down the whole orchestrator. **Recommendation:** fail-closed only for elevation/L2-approve/spawn; mark `audit_degraded` and continue for start/finish/disconnect; surface `audit_degraded` in the Dashboard.

---

## 4. Attack Dashboard / HITL

### 4.1 Placement (DASHBOARD_AND_HITL-1) — sound

Full-page Cockpit window (extend existing `chrome.windows` cockpit shell or sibling fleet window); 320px Side Panel shows only FleetStrip (worker count, worst status, pending-confirm badge, open-dashboard + stop-all). Matches approved UI redesign (D8/D10'/D12'/D14 cited). Sound.

**One ambiguity the synthesis flags but doesn't resolve (open question #6):** extend existing Cockpit shell vs sibling fleet window. This matters for confirm-storm UX: a single shared Cockpit can host a single Confirm Center cleanly; multiple sibling windows risk confirm fragmentation (which window shows the next L2?). **Recommendation: single Cockpit window** as Confirm Center authority; sibling windows only for transient fleet views.

### 4.2 HITL enter-worker (DASHBOARD_AND_HITL-3) — partially specified

> HITL enter-worker switches the dashboard (and optionally Panel) activeThreadId to that worker thread for transcript/follow-up only; it does not steal or transfer tab exclusive locks to the human without an explicit force-release action.

This is correct as far as it goes, but the **practical HITL use case is "I see the worker about to do the wrong thing on tab 3; let me take over and click the right thing."** If the human cannot act as the holder, HITL enter is reduced to "watch and yell." The synthesis's parenthetical — "human second-mutate requires force-release or acting as holder identity" — acknowledges the second path exists but **does not specify it.**

Three implementable options:

- **(A) Lease transfer.** On `enter_as_holder`, transfer the lease from `worker_thread_id` to `user_session_id`. Worker's pending tab-tools refuse with `TAB_LOCKED` until user force-releases back. Clean, but introduces a transfer primitive the synthesis otherwise refuses.
- **(B) Human-as-holder sub-thread.** Spawn a child thread under the worker (or under the orchestrator) with the human as the LLM-driver; inherit the lease. Heavyweight; breaks the "I am taking over" UX.
- **(C) Force-release-only.** Human must force-release the worker's lease, then operate under no lock (or under a fresh lock in their own session). Simplest, but breaks the hard rule's invariant for the window between force-release and human-acquire.

**Pick (A) in P1.** It's the cleanest and the synthesis already half-implies it ("acting as holder identity"). Specify `transfer_lease(tab_id, from_thread_id, to_user_session)` as a privileged Dashboard action with audit.

### 4.3 Pause / Cancel / Stop-all (DASHBOARD_AND_HITL-3) — sound shape, two bugs

**Pause:** "freezes that worker's LLM loop + new dispatch while holding leases until timeout/resume." Wait — *until timeout*? If pause suspends the LLM loop but the lease's idle_ttl keeps ticking, the lease expires while paused and another worker grabs it. **Pause must suspend idle_ttl and hard_max too**, otherwise pause > idle_ttl silently transfers ownership. Synthesis does not say this. **P1 fix.**

**Cancel:** correctly specified as `chat.abort(thread_id)` + reject worker-owned `pendingToolCalls` + release worker's leases. **Prerequisite:** `pendingToolCalls` entries must carry `thread_id` (today they don't; `server.ts:139`). This is the same P0 blocker as §2.6. Without it, cancel cannot identify the entries to reject.

**Stop-all:** separate explicit control. Sound. Should it cascade-abort the orchestrator too, or only workers? Synthesis is silent. **Recommendation:** Stop-all aborts orchestrator + all workers + releases all leases + flushes the L2 queue for that `orchestrator_run_id`. Document explicitly.

### 4.4 Confirm Center (DASHBOARD_AND_HITL-2) — sound, with one cross-surface ambiguity

> All high-risk confirmations for orchestrator and workers share one global Confirm Center … respondFrom remains originWs-bound; … multi-worker spawn must not broaden respond APIs or allow cross-worker confirmation_id approval.

Sound in spirit. The cross-surface issue I raised in §1: if Panel and Cockpit are separate WS connections (likely — Cockpit is `chrome.windows`, separate popup/window context), `originWs` of the request must be the connection where the confirm should be answered. If the user can answer in either surface, `originWs` check breaks.

**Resolution options:**

- (i) Request payload carries `preferred_surface`; client only shows approve/deny UI on that surface; `originWs` of request = the WS of that surface.
- (ii) Request broadcast to all surfaces; first surface to call `respondFrom` wins; `originWs` check is relaxed to "any active WS for this user session."
- (iii) Confirm Center is single-surface (Cockpit only); Panel MinimalConfirm is observe-only.

**Recommendation: (iii) for P0** (Panel observes, Cockpit acts); revisit (i)/(ii) in P2 if UX demands. Simpler, preserves `originWs` semantics unchanged.

### 4.5 Confirm payload identity (DASHBOARD_AND_HITL-2) — P0 schema change

Same as §3.6: every `security.confirmation.request` must carry `worker_id + parent_thread_id + orchestrator_run_id + tabId (when tab-scoped)`. Today's payload has none. P0 schema change.

---

## 5. Ordered MUST-FIX before any P0 code

Engineering can start once these are nailed. Each is referenced back to the section that justifies it.

1. **Add `thread_id` (and ideally `worker_id`, `orchestrator_run_id`) to `pendingToolCalls` entries.** Today (`server.ts:139-144`) the map is keyed by `tool_call_id` only. Without this, worker-cancel is impossible and audit cannot attribute tool outcomes to workers. **P0 prerequisite for the cancel path.** (§2.6, §4.3, §3.6)

2. **Wire `isToolAllowed` at `createToolExecutor` entry, as the first check.** Today defined at `thread-manager.ts:499-504` with zero call sites outside the file (verified). Defense-in-depth: also filter adapter LLM tool schema per thread (`adapter.ts:438` currently exposes `[...getToolDefinitions(), ...mcpTools, ...mcpMetaTools]` unfiltered). Without this, every `tool_whitelist` rule — worker downgrade, WORKER_HARD_DENY, orchestrator narrow surface — is theater. **Single most load-bearing capability fix.** (§3.4, §3.8)

3. **Grow the `Thread` schema with `parent_thread_id`, `orchestrator_run_id`, `worker_role_label`, `capability_elevation_level`.** `create()` (`thread-manager.ts:245-281`) and the `Thread` interface must accept these. Without them, audit attribution and HITL display are impossible. (§3.1, §3.9)

4. **Add `worker_id + parent_thread_id + orchestrator_run_id + tabId` to `security.confirmation.request` payload and `PendingConfirmation`.** Today (`security-confirmation.ts:115-145,197-225`) absent. Required for Confirm Center display, audit, and stop_thread targeting. (§3.6, §4.5)

5. **Resolve the L2-on-already-held-tab state transition.** Add `HELD_PENDING_L2` sub-state: same-holder + same-tab + L2 tool → retain exclusivity, do not start idle_ttl, do not drop to SOFT_RESERVED. (§2.1.2)

6. **Pick SOFT_RESERVED exclusivity.** Recommendation: block early (SOFT_RESERVED exclusive across workers) for P0; revisit if real workloads saturate. (§2.1.1)

7. **Specify TOCTOU policy for Chrome-side mutation during a lease.** Pick one of: (i) `chrome.tabs.onUpdated` → force-release with reason `EXTERNAL_MUTATION`; (ii) URL stamp at acquire + mismatch check on dispatch → `TAB_STALE`; (iii) accept and document. (§2.1.3)

8. **Add `locked_by_thread_id`/`locked_by_worker_id`/`lease_expires_at` to `list_tabs` output.** Without this, LLMs pick locked tabs and hammer TAB_LOCKED. (§2.1.4)

9. **Auto-HARD_HELD new tab to creator on `create_tab`.** (§2.1.5)

10. **Specify renew trigger = worker tab-tool dispatch only (not `tab.navigated`).** (§2.1.6)

11. **Multi-tab caps: per-worker (e.g., ≤3) + process-wide (e.g., ≤10).** Numbers in open questions for tuning, but caps must exist in P0. (§2.1.7)

12. **Add `list_tab_locks` (or fold into `get_worker_status`) as orchestrator read-only tool.** Required for deadlock observation. (§2.1.8)

13. **Per-worker L2 cap (not per-run); global cap = `max(2, n_workers)`.** (§3.5)

14. **Decide `evaluate` in WORKER_HARD_DENY.** Recommendation: allow under standard L2 for workers. (§3.4)

15. **Pause suspends idle_ttl + hard_max.** (§4.3)

16. **Map Extension `chrome.debugger.attach` "another debugger attached" error to structured `TAB_LOCKED_EXT`.** Cheap defense-in-depth; do in P0 even if full Extension queue is P1. (§2.2)

17. **HITL "act as holder": specify `transfer_lease` privileged Dashboard action.** (§4.2)

18. **Confirm Center: single-surface (Cockpit) for P0; Panel MinimalConfirm observe-only.** (§4.4)

19. **Audit fail-closed only for elevation/L2-approve/spawn; `audit_degraded` + continue for start/finish/disconnect.** (§3.9)

20. **`osascript_eval` URL→unique-tabId resolution gate for workers.** Verify the gate fires on the companion-side `COMPANION_TOOLS` path, not only on Extension-bound tools. (§2.7)

Items 1-4 are blockers — without them, P0 code cannot be written correctly. Items 5-12 are tab-lock correctness. Items 13-15 are UX/cost. Items 16-20 are defense-in-depth and product-policy locks.

---

## 6. What the synthesis got right

For balance, and because the brief explicitly asks: the synthesis is genuinely good. Highlights:

1. **Dual-layer enforcement placement.** TAB_LOCK-4 placing authoritative enforcement in Companion `createToolExecutor` (not the Extension) is correct, mirrors `host_computer`, and respects dual-layer A1. Verified `createToolExecutor` is at `server.ts:369`, L2 gate at 482, dispatch at 1550.

2. **Multi-tool episode lease.** TAB_LOCK-3's identification that per-`pendingToolCalls` RTT locking leaves a legal interleave window is the single most important correct call in the document. The renewal + idle_ttl + hard_max pattern is the right shape.

3. **Worker = Thread, not new runtime.** ORCHESTRATOR_WORKER_MODEL-1 reuses ThreadManager / chat.create / abortControllers / pack.apply / history. Avoids a duplicate security gate. Sound reuse.

4. **Killed Extension-only locking.** "Extension per-tab queue is P1 defense-in-depth only" is correct — Companion can still multi-dispatch via WS, so Extension-only locking is a false guarantee.

5. **Killed holding HARD across full 45s L2.** Right — would deadlock multi-worker evaluate/navigate and strand leases on `rejectAll` (`security-confirmation.ts:383-398`).

6. **Killed null worker `tool_whitelist`.** Correctly identified as capability theater given `isToolAllowed`'s zero call sites.

7. **Killed pinned-tabs-as-ownership.** Correct — today `pinned_tabs` is soft affinity with no exclusivity (verified `thread-manager.ts:266`; `tab-resolver.ts` cited); promoting it would reify multi-thread pin collision as fake ownership.

8. **Shell/netsec single-flight.** SECURITY_L2_AND_CAPABILITY-3 correctly identifies that `shell.ts`/`netsec/scan.ts` have no mutex today and adds a host_computer-style single-flight. Catches a real silent-fan-out hole.

9. **Tab leases orthogonal to host_computer.** TAB_LOCK-5 keeps two registries separate. Right — host tools have no tabId domain; conflating produces false busy and wrong cancel UX.

10. **Privileged AuditWriter.** Killed SECURITY_L2_AND_CAPABILITY-4's forgeable-attribution hole; counter requires Companion-stamped trusted context. Correct.

11. **Audit SoT = capability-audit.jsonl.** Aligns with ADR-014 §4 and CLAUDE.md A9 (existing `~/.cmspark-agent/logs/capability-audit.jsonl`, 0o600, append-only, rotated).

12. **L2 FIFO admission.** Right instinct; just needs the cap unit fixed (per-worker, not per-run).

13. **Cancel shape.** Abort + reject pending + release leases is the right three-step structure. The fact that it cannot be implemented today is a `pendingToolCalls` schema gap (MUST-FIX #1), not a synthesis error.

14. **Confirm Center content split.** Panel MinimalConfirm + Cockpit ConfirmElevated matches the approved UI redesign and preserves the existing `originWs` / tray-privileged `respond()` contracts.

15. **Honest residual notes.** Multiple proposals (TAB_LOCK-4, TAB_LOCK-5, ORCHESTRATOR_WORKER_MODEL-2/5, SECURITY_L2_AND_CAPABILITY-5, DASHBOARD_AND_HITL-2/3) include explicit "residual risk" or "slight overclaim" caveats. This is the right adversarial-workflow output shape.

The 4-of-18 kill rate is plausible. The 14 survivors are mostly sound; the holes are in **what they don't say**, not in what they say wrong.

---

## 7. Open product calls only a human can decide

These are product forks where engineering can recommend but the user owns the call:

1. **SOFT_RESERVED exclusivity (block early vs post-confirm TAB_LOCKED).** Trade-off: UX throughput vs user-approves-doomed-action. Engineering recommends block early (§2.1.1); product must own.

2. **`evaluate` in WORKER_HARD_DENY.** Default-deny makes workers near-useless for adversarial SPAs (the codebase's own `browser-bridge.ts:188-190` acknowledges ISOLATED-world fallback is sometimes required). Allow under standard L2, or deny and accept the limitation? (§3.4)

3. **HITL "act as holder" mechanism.** Lease transfer to user_session (cleanest, introduces new primitive) vs human-as-holder sub-thread (heavyweight) vs force-release-only (breaks invariant). Engineering recommends transfer; product owns. (§4.2)

4. **L2 cap shape.** Per-worker vs per-run vs combined. Cost/UX. Engineering recommends per-worker with global = `max(2, n_workers)`. (§3.5)

5. **Numeric caps.** Max concurrent workers per orchestrator_run, max LLM loops process-wide, per-worker max simultaneous tab leases, idle_ttl (recommend ≥120s), hard_max (recommend ≥600s). Engineering proposes defaults; user signs. (Open question §2.1.4, §2.1.7 of synthesis)

6. **Pure-read exclusivity in P0 vs P1 shared-observer.** Synthesis picks exclusive-for-all in P0; product can defer to P1 if scan-only workers become a real need. (Synthesis open question)

7. **`host_computer` targeting Chrome while tab lease exists.** Forbid? Force-release first? Accept as separate host surface? Today `host_computer` can mutate page content via coordinate-clicks without `tabId` (TAB_LOCK-5 reason residual). (Synthesis open question)

8. **Dashboard placement.** Extend existing Cockpit shell vs sibling chrome.windows fleet window. Confirm-storm UX hinges on this. Engineering recommends single Cockpit. (§4.1)

9. **Chrome-side mutation during a lease.** User typing in URL bar, page-initiated navigation, manual tab close — Chrome doesn't honor Companion's lock. Add UX warning ("agent X is operating this tab")? Listen to `chrome.tabs.onUpdated` and force-release? Accept the risk? (§2.1.3)

10. **Soft reservation cross-worker policy.** Same fork as #1 but more specifically: if two workers want L2 on the same tab, does the second worker's confirm prompt fire (yes = post-confirm TAB_LOCKED risk; no = early busy). (§2.1.1)

11. **Confirm storm caps under stress.** What happens when global cap is saturated for >N seconds? Refuse new spawns? Queue with backpressure? Surface to user as "system busy"? Engineering default: queue + surface; product may want a hard refuse.

---

## 8. Summary

The synthesis is the right artifact: it identifies the multi-tool episode lease as the correct unit, places enforcement in the right layer, refuses the tempting wrong answers, and is honest about residual risks. It is **not implementable as written** because (a) the SOFT_RESERVED→approve→re-acquire race is treated as an implementation detail when it is a product fork, (b) the L2-on-already-held-tab state transition is unspecified and the existing locked conclusions contradict each other on it, (c) worker-cancel is correctly shaped but is impossible to implement without adding `thread_id` to `pendingToolCalls` (a P0 prerequisite the synthesis mis-sequenced into P1), and (d) several "engineering defaults" (notably `evaluate` in `WORKER_HARD_DENY`) are silent product calls.

**Recommendation: APPROVE_WITH_CHANGES.** Resolve MUST-FIX items 1-4 (blockers) before any P0 PR; items 5-12 must be in the P0 spec document but can be implemented in parallel; items 13-20 can land in P0 or early P1. The 11 open product calls in §7 require user input before P0 spec lock.

Confidence 78%. The remaining 22% is dominated by the SOFT_RESERVED race (can it be made acceptable without killing parallelism?) and the HITL lease-transfer question (can it be implemented without a primitive the synthesis refuses to specify?). Both are resolvable; neither is free.

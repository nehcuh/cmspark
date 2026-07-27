# Review: Cairn-inspired MissionBoard × CMspark (brief 2026-07-27)

| Field | Value |
|-------|-------|
| **Reviewer** | Claude (Opus 4.x, CLI) |
| **Date** | 2026-07-27 |
| **Subject** | `docs/decisions/v1.3/cairn-inspired-mission-board-brief-2026-07-27.md` (PRIMARY) |
| **Cross-read** | ADR-014 (Mission Pack), ADR-015 (Multi-Agent Orchestrator/Tab Lock), `multi-agent-ship-summary-2026-07-27.md`, current `appsec-prd-review` pack, `orchestrator/spawn.ts`, `server.ts` `collect_handback` (~L2480) |
| **Mode** | Plan review only — no product code touched |
| **Confidence** | see §1 |

---

## 1. Verdict

**APPROVE_WITH_CHANGES — confidence 78%**

The direction is correct: extracting Cairn's **protocol** (Fact / Intent / Hint + structured handback + Origin/Goal explicit) without vendoring its runtime is the right move for CMspark. It composes cleanly onto the existing primitives we already shipped (ADR-014 Pack-as-thread-template, ADR-015 worker=child Thread + tab lease + L2). The single highest-leverage idea — **structured handback that kills hallucinated "scan complete" outputs** — is worth the entire brief.

The 22% discount is concentrated in three places, any one of which can flip to a BLOCK if mis-handled:

1. **Draft order builds the kernel before measuring the protocol.** The brief's own "alternative A→C→B" is the correct path; the default A→B(min)→C→E→D risks committing persistence + tools before we have evidence the protocol beats the current prompt-only AppSec pack.
2. **Authorship / trust model for Facts is under-specified.** Worker LLM output is not ground truth — it is the most prompt-injection-exposed surface in the system. Treating worker-authored Facts as authoritative inputs to orchestrator reasoning is a security hole.
3. **Complete authority is a classic reward-hacking surface.** "Goal supported by facts → Complete" must not be LLM-self-approvable; it has to mirror the spawn HITL pattern in ADR-015 §6 (`security_token`, no `user_confirmed` trust).

The open forks in §3 of the brief are exactly the right forks to be asking. My answers are in §4 below.

---

## 2. Attack the draft plan

### 2.1 Order is wrong for a learning bet

Draft default: **A → B(minimal) → C → E → D**.
Brief alternative: **A → C (prompt-only) → B**.

The brief itself flags this; I'm making the call: **the alternative is correct, the default is wrong.** Reasoning:

- We have not validated that structured Fact/Intent/Hint produces *better AppSec reviews* than the current prompt-only pack (`companion/src/packs/builtin/appsec-prd-review/pack.yaml`). The current pack already asks for "结构化报告 — 风险列表/证据/修复建议" via `system_prompt_append`; whether typing it as Fact/Intent moves the needle on coverage, false-positive, or hallucination is an empirical question.
- Phase B's persistence decision is load-bearing (see §2.2) and should not be made before Phase C evidence.
- The kernel changes (new tools, new WS methods, persistence) are reversible only with cost; a prompt-only pack change is one-file and trivially rollback-able.

**Recommendation:** flip the order to A → C(prompt-only) → measure → B(minimal, conditional) → E → D. Make the measurement gate explicit (see §5 P0).

### 2.2 Persistence is unresolved and load-bearing

Brief Open Fork #1 lists three options: thread field / separate board store / knowledge docs. The draft Phase B says "choose one" without choosing. This is the single decision that propagates everywhere:

- **Separate `~/.cmspark-agent/boards/` store** is a new namespace, a new persistence path, a new audit surface, a new snapshot/restore problem under Pack uninstall (ADR-014 §4 atomic apply / rollback), and a new TOCTOU/symlink class to harden (we just paid this tax for Obsidian in ADR-008 §A6). **Reject.**
- **Knowledge docs** are wrong shape: Knowledge is read-mostly, pack-scoped, user-curated. Board state is per-Thread, mutable, run-scoped. **Reject.**
- **Thread metadata field** (e.g. `thread.mission_board: { origin, goal, facts[], intents[], hints[] }`) is the correct fit. It already has lifecycle (created with Thread, dies with Thread), already has a snapshot path (Pack apply takes a snapshot of thread fields), already has audit adjacency (thread index already records `orchestrator_run_id`).

**Recommendation:** commit to **thread metadata field**, explicitly, in ADR-016. No new top-level dir.

### 2.3 Authorship and trust model is not specified

Brief Open Fork #2: "Who may write Facts?" — the draft lists options without deciding. This is security-critical, not stylistic.

Threat model:

- Worker LLM reads page content (PRD HTML, screenshot, page text). Pages are **adversarial** (prompt-injection is a known surface — `page-sanitizer` exists for exactly this reason; ADR-006 §A4).
- If a worker writes `Fact { claim: "session_token_leaked_in_url", confidence: 0.95, evidence: "/auth?token=..." }` because the page *told it to*, the orchestrator accepts this as confirmed and propagates it into the final report, the exported Obsidian note, and possibly the audit log. We've turned prompt-injection into a structured-trust propagation channel.
- Same risk for `Intent`: a malicious page could spawn divergent Intents that drain the orchestrator's 5-worker budget (ADR-015 §3.5 `max_workers_per_orchestrator_run=5`).

**Required in ADR-016:**

1. **Provenance**: every Fact carries `{ worker_id, tab_id, url, evidence_excerpt, tool_call_id }`. No anonymous Facts.
2. **Trust tier**: explicit `trust: llm_asserted | tool_verified | user_confirmed`. Default `llm_asserted`. Orchestrator prompt must treat `llm_asserted` as hypothesis, not truth.
3. **Cap on Intents per worker** (suggest 3) to bound injection-driven fan-out; mirrors ADR-015's "5 workers / run" cap philosophy.
4. **`complete` requires ≥1 `tool_verified` or `user_confirmed` Fact for any claim that touches severity ≥ High.** LLM-only facts cannot terminate a goal.

### 2.4 Complete authority is a footgun

Brief Open Fork #5: "Complete authority: orchestrator LLM vs user confirm complete?"

Answer: **neither LLM-only nor always-user-confirm.** Borrow the spawn HITL pattern (ADR-015 §6: "Spawn = explicit HITL only"):

- **Auto-complete** allowed only when *all* of: goal has no `severity ≥ High` Intents open; ≥1 terminating Fact is `tool_verified` or `user_confirmed`; orchestrator_run_id has no in-flight worker LLM loops; no pending L2 confirms.
- **Force user confirm** when any of the above fail.
- The `board_complete` tool must require `security_token` (not `user_confirmed` flag from LLM); same shape as `spawn_worker` in `L2_GATE_TOOLS`.

### 2.5 Conflicts with ADR-015 specifics

- **Orchestrator tool surface (ADR-015 §1, `ORCHESTRATOR_TOOL_ALLOWLIST` in `companion/src/orchestrator/constants.ts`)** is currently 8 tools (`spawn_worker`, `wait_workers`, `collect_handback`, `ask_user`, `list_workers`, `get_worker_status`, `list_tab_locks`, `list_tabs`). Adding `board_read` / `board_add_fact` / `board_add_intent` / `board_complete` either (a) bloats this allowlist, or (b) gets folded into existing tools (`collect_handback` already exists — extend it). **Recommendation: fold, don't add.** `collect_handback` becomes the structured Fact/Intent write path; `board_read` is a read on thread metadata, no new tool needed (the orchestrator already has the board in its own Thread state).
- **Pause ≠ cancel (ADR-015 §3.4):** pause keeps leases and open L2 confirms. If a paused worker has open Intents, what happens to them? The draft is silent. **Recommendation:** pause freezes Intent heartbeat reap (see §2.6); cancel reaps all of the worker's open Intents as `abandoned`.
- **`wait_workers` is poll-only by design** (ADR-015 progress table, "明确延期"). If the orchestrator now needs to poll board state, it can do so via `collect_handback` — no change to the poll-only contract. Don't sneak a barrier in through the board back-door.
- **L2 admission ordering (ADR-015 §4):** board tools are not L2 tools themselves (they're metadata writes), so they don't enter `acquireL2Admission`. But `board_complete` *should* be an L2-gated tool (force-confirm), which means it joins `L2_GATE_TOOLS` and goes through the existing `flight → admission → SOFT → confirm → hard re-acquire` order.

### 2.6 Heartbeat / abandoned Intent cleanup is missing

Brief §1 extracted "claim + heartbeat on intents" from Cairn; draft Phase B doesn't include it. Without it:

- Worker crashes / pause / cancel → Intent stays `open` forever → orchestrator polls `wait_workers`, sees open Intents, never completes.
- After enough abandoned Intents, the 5-worker cap is exhausted by ghost Intents.

**Recommendation:** Intent carries `heartbeat_at`; orchestrator's `wait_workers` poll reaps Intents with `now - heartbeat_at > 2 * idle_ttl_ms` (240s given current `idle_ttl_ms=120_000`) as `abandoned`. Cancel path reaps immediately. Audit each reap.

### 2.7 WS surface is growing in the wrong direction

Draft Phase B lists WS methods `board.get` / `board.patch_hint` / `board.set_goal`. This contradicts ADR-015's design choice (and the implementation in `fleet.status` / `worker_cancel` / etc.) to put multi-agent operations **through tools, not bare WS methods**, so they pass through `isToolAllowed`, audit, and L2 gates uniformly.

**Recommendation:** board operations go through tools only. No `board.*` WS family. UI reads board state via the existing thread snapshot mechanism (`thread.get` already returns thread metadata).

### 2.8 Handback validation rule is under-specified

Draft Phase B: "Handback validation: reject free-form-only handbacks when board mode on." Good instinct, but what's the rule?

**Recommendation:** `board_mode: prompt_only_v1` pack flag adds a per-handback contract enforced via existing `llm-extract.ts`:

- Handback must include ≥1 Fact with `{ claim, evidence, trust }`.
- If `intent_id` was passed to the worker, the Fact must reference that `intent_id` (closed-loop).
- Free-form-only handback → recoverable error `HANDBACK_MISSING_STRUCTURE` (consistent with ADR-014 §4 error grading).
- Orchestrator can still retry the worker with a corrective prompt; mirrors existing "LLM hallucinated tabId → recoverable, LLM retries via list_tabs" pattern in `Common Issues`.

### 2.9 No measurement gate

Phase E (Verify) says "Manual AppSec scenario." That's not a bar; it's a demo. We need:

- N=5–10 sample PRDs run through AppSec v1 (current) and AppSec v2 (board-mode prompt-only).
- Independent review (Claude + Pi is fine) scoring: finding coverage, false-positive count, hallucination count (claims with no evidence).
- v2 must not regress on any of the three vs v1 to greenlight Phase B.

Without this, we're shipping protocol for protocol's sake.

### 2.10 Minor conflicts / loose ends

- **License:** "learning protocol not code" is the correct framing; AGPL-3.0 does not extend to ideas/methods. But the brief should explicitly say **"we will not copy Cairn's JSON schema field names verbatim"** — reimplementing semantics with our own schema is safe; lifting `IntentID`/`FactID` field names + structure verbatim is a derivative-work gray zone. Costs us nothing to be explicit.
- **Map Cairn Reason→Orchestrator, Explore→Worker** is clean *for our model* but note: Cairn's Reason is itself a worker on the board, not a separate runtime. We're 1:1 mapping onto Thread; that's fine, just call it out so future readers don't try to literally port Cairn's task semantics.
- **"User messages can be Hints (run-visible)"** is interesting but introduces a new cross-thread propagation path (worker threads don't currently read parent messages). Either (a) propagate tagged Hints to workers via `collect_handback` enrichment, or (b) keep Hints orchestrator-only initially. Defer (a) to Phase B; ship (b) in Phase C.
- **Board state vs tab lease state coupling:** when `FORCE_RELEASING` drains a tab (ADR-015 §3.2), should the worker's open Intents on that tab also be reaped? **Recommendation:** yes; tie Intent reap to lease release in the same audit transaction.
- **`max_concurrent_multi_agent_llm_loops=5` (ADR-015 §3.5) interaction:** board doesn't change the cap, but orchestrator will do more Reason turns reading board state — effective throughput per orchestrator run drops. Not a blocker; just calibrate expectations.
- **Audit trail:** every board mutation (`add_fact`, `add_intent`, `complete`, `reap_intent`) writes to `~/.cmspark-agent/logs/capability-audit.jsonl` (ADR-014 §4). Same writer, same 0o600 / append / rotate discipline.

---

## 3. Steal vs reject from Cairn (ranked)

### 3.1 Steal (highest → lowest value)

1. **Fact / Intent / Hint taxonomy.** Clean separation of "what we know" / "what we want to know" / "what we suspect." Maps onto our existing typed-message model with minimal new vocabulary. The single biggest cognitive win.
2. **Structured handback validation.** Workers return typed claims, not free-form prose. Directly kills the "LLM hallucinated scan-complete" failure mode and is the highest-leverage bug-fix in the AppSec pack today. Implementable via existing `llm-extract.ts`.
3. **Explicit Origin + Goal as typed fields**, not prose in `system_prompt_append`. Turns "review this PRD" into a queryable, auditable contract.
4. **Stigmergy (worker↔worker never chats; only board writes).** We already enforce this via Thread isolation (ADR-015 §1, workers are child Threads); Cairn's pattern is a useful reinforcement and a clean mental model for the orchestrator prompt.
5. **Claim provenance.** Every Fact carries the worker/tab/url that produced it. We'd want this anyway for audit; Cairn makes it first-class.
6. **Heartbeat on Intents.** Bounded reaping of abandoned exploration. Pairs naturally with our `idle_ttl_ms` lease.
7. **Complete when goal supported by facts (with caveats in §2.4).** Clean termination criterion. Steal the *idea*, not the auto-complete semantics.
8. **Structured JSON output contracts** as the worker→orchestrator interface. Same shape as our existing `llm-extract` (profile/summary) — proven pattern, low risk.

### 3.2 Reject (highest → lowest risk)

1. **Vendoring Cairn code or copying its JSON schema verbatim.** AGPL-3.0 + derivative-work gray zone. Reimplement semantics with our own schema; pay the small cost of being explicit in ADR-016.
2. **Docker attack-lab as default.** We already gate this via ADR-014 enterprise modules (`netsec`, `shell` default-off, `capability_profile=enterprise` for shell/netsec). Don't bring attack lab into community CWS.
3. **"No roles" model.** Cairn treats Bootstrap/Reason/Explore as task types, not roles. Our Pack + role-template model (ADR-014/015) is strictly more expressive for our product (Pack = role kit; thread = role instance). Don't flatten.
4. **Full state-space search semantics (branching factor, frontier, parent links).** Overkill for an AppSec review Pack. We're not building a planner; we're typing the worker↔orchestrator interface.
5. **Auto-spawn silent fan-out.** Already deferred in ADR-015 §6 ("Spawn = explicit HITL only"). Cairn's silent spawning conflicts; keep our explicit HITL.
6. **Task-tree graph visualization as P0.** FleetStrip + Cockpit counts (already shipped per multi-agent-ship-summary §3) cover operator awareness. Graph viz is P2+ and only after measurement shows the protocol earns its keep.
7. **Cairn's "no LLM in the loop on Reason" framing.** Cairn sometimes frames Reason as deterministic. Our orchestrator *is* an LLM Thread (ADR-015 §1); pretending otherwise will produce a confused implementation.

---

## 4. Recommended phase order

**A → C (prompt-only) → Measure → B-min (conditional) → E → D**

| Phase | Content | Gate to next |
|-------|---------|--------------|
| **A** | ADR-016 draft: schema (ours, not Cairn's), persistence = thread metadata, authorship/trust/complete rules per §2.3–2.4, no new WS family, board ops as tools, audit to `capability-audit.jsonl`. | ADR reviewed by Claude+Pi; license paragraph explicit. |
| **C (prompt-only)** | Extend `appsec-prd-review/pack.yaml` with `board_mode: prompt_only_v1`; extend `system_prompt_append` to require typed Fact/Intent/Complete output; add a `llm-extract` schema for AppSec findings (severity/url/evidence/confidence/trust). **No persistence, no new tools, no WS.** Pack-level only. | Pack loads cleanly on existing engine; unit test for llm-extract schema green. |
| **Measure** | Run N=5–10 PRDs through v1 and v2; Claude+Pi score coverage / FP / hallucination. | v2 not worse on any of the three; ideally strictly better on ≥1. |
| **B-min (conditional)** | If Measure passes: persist board as `thread.mission_board` field (no new dir); enrich `collect_handback` to parse structured payload; reject free-form-only with `HANDBACK_MISSING_STRUCTURE`; add Intent heartbeat reap in `wait_workers` poll; audit all mutations. | Unit tests for: structured parse, free-form reject, heartbeat reap, cancel→reap. |
| **E** | Verify: replay GATE2-style test plan; manual end-to-end AppSec scenario; re-review ADR-016 if schema changed during B. | Test bar = ship-summary §7 equivalent; dual sign-off. |
| **D** | UI: Side Panel board list (Facts open vs closed Intents, Hints); Cockpit badges. Graph viz is **later than D**, not in D. | UI behind a Pack flag, default off in community. |

**Phases explicitly not in this order:** any kernel work before measurement; any new top-level persistence dir; any new WS message family; auto-spawn; shared-observer lease interaction with board.

---

## 5. P0 — smallest mergeable vertical

**Scope:** structured Fact/Intent handback *as a prompt-only Pack change*, no kernel, no persistence, no new tools, no WS. ~1–2 days.

**Changes (3 files):**

1. **`docs/adr/016-mission-board-fact-intent-hint.md` (new)** — schema, persistence decision (thread metadata, *not* a new dir), authorship/trust rules (§2.3), complete authority (§2.4), license paragraph ("ideas only, schema reimplemented"), explicit non-goals (no auto-spawn, no shared-observer, no new WS family).
2. **`companion/src/packs/builtin/appsec-prd-review/pack.yaml`** — add `board_mode: prompt_only_v1`; extend `system_prompt_append` with the JSON output contract (Fact[] with `{claim, evidence, trust, intent_id?}`, Intent[] with `{id, claim, heartbeat_at}`, Complete `{summary, supported_by: Fact_id[]}`).
3. **`companion/src/llm/llm-extract.ts`** — add `appsec_board_v1` extraction schema (typed findings, severity enum, evidence required).

**Out of scope for P0 (do not pull these in):**

- Persistence (thread field write) — Phase B-min.
- New tools (`board_*`) — fold into `collect_handback` later.
- WS methods — none.
- UI — Phase D.
- Worker-side Fact authoring tools — Phase B-min; P0 keeps Fact authoring as a *prompt contract* the worker's last assistant message must satisfy.

**Pass criteria:**

- Pack loads on existing engine (no engine change).
- `collect_handback`'s existing return shape is unchanged (worker's last assistant message content); a *future* B-min change will parse the JSON payload out of that content. P0 doesn't touch `server.ts`.
- Manual run: 1 PRD review through AppSec v2 pack produces a typed Fact/Intent/Complete JSON in the worker's final assistant message; llm-extract parses it; orchestrator's existing `collect_handback` surfaces it without code change.

**Why this slice:** it tests the protocol thesis (does typing handback as Fact/Intent improve AppSec output quality?) at minimum blast radius. One pack file + one extract schema + one ADR. Fully reversible by reverting the pack file. If measurement fails, we've spent ~1 day, not ~2 weeks of kernel work.

---

## 6. Must-not-do next 30 days

1. **Do not vendor Cairn code or copy its JSON schema field names verbatim.** Reimplement semantics; pay the cost of being explicit in ADR-016's license paragraph.
2. **Do not add a new top-level persistence dir** (`~/.cmspark-agent/boards/`). Use thread metadata. We just paid the symlink/TOCTOU tax for Obsidian (ADR-008 §A6); don't pay it again for board state.
3. **Do not add a `board.*` WS message family.** Board operations go through tools (consistency with ADR-015; uniform `isToolAllowed` + L2 + audit path).
4. **Do not make `board_complete` LLM-self-approvable.** It must require `security_token` like `spawn_worker` (ADR-015 §6). Auto-complete only under the strict conditions in §2.4.
5. **Do not treat worker-authored Facts as trusted.** They are LLM output exposed to page-borne prompt injection. Provenance + trust tier + `tool_verified` requirement for high-severity claims (§2.3).
6. **Do not enable board tools or board-mode Pack on the community CWS profile default.** Default off; Pack may opt in; high-risk operations still go through L2 (consistency with ADR-014 §2 dual-channel).
7. **Do not auto-spawn workers to fill open Intents.** Preserves ADR-015 §6 deferred decision ("Spawn = explicit HITL only"). The brief's non-goals already say this — keep it that way.
8. **Do not merge Phase B before Phase C measurement gate.** No measurement, no kernel.
9. **Do not block P0 on full Dashboard grid or graph visualization.** Both are P2+ (multi-agent-ship-summary §5).
10. **Do not propagate user Hints across threads in P0.** Keep Hints orchestrator-only; cross-thread propagation is a Phase B design decision with its own prompt-injection surface.
11. **Do not skip the dual (Claude + Pi) ADR-016 review** before Phase B code. Same bar ADR-015 used.

---

## 7. Concrete next 3 engineering tasks

### Task 1 — Draft ADR-016 (no code)

**File:** `docs/adr/016-mission-board-fact-intent-hint.md` (new)

**Contents:**

- Schema (ours): `MissionBoard { origin, goal, facts: Fact[], intents: Intent[], hints: Hint[], complete?: Complete }`, with `Fact = { id, claim, evidence, trust: 'llm_asserted'|'tool_verified'|'user_confirmed', provenance: { worker_id, tab_id?, url?, tool_call_id? }, intent_id?, created_at }`, `Intent = { id, claim, heartbeat_at, status }`, `Hint = { id, body, source: 'user'|'orchestrator', created_at }`, `Complete = { summary, supported_by: Fact_id[], completed_at }`.
- Persistence: thread metadata field `thread.mission_board`; snapshot/restore under Pack apply/uninstall reuses ADR-014 §4 path. **No new top-level dir.**
- Authorship: workers write Facts + Intents (via `collect_handback` structured payload); orchestrator reads + writes Hints + (HITL-gated) Complete; users write Hints via existing chat on the orchestrator thread (orchestrator-only initially).
- Trust: `llm_asserted` default; severity ≥ High claims require `tool_verified` or `user_confirmed` to terminate goal.
- Complete authority: HITL pattern mirroring `spawn_worker` in ADR-015 §6; auto-complete only under §2.4 conditions.
- License: protocol ideas only; schema reimplemented; no Cairn code vendored; no verbatim field-name copying.
- Non-goals: auto-spawn, shared-observer lease, new WS family, new persistence dir, cross-thread Hint propagation in v1.
- Audit: every mutation → `capability-audit.jsonl` (ADR-014 §4 discipline).

**DoD:** dual (Claude + Pi) review recorded under `docs/audit/reviews/adr-016-*.md`; any BLOCK resolved before Task 2.

### Task 2 — AppSec Pack v2 (prompt-only board)

**Files:**

- `companion/src/packs/builtin/appsec-prd-review/pack.yaml` — add `board_mode: prompt_only_v1`; extend `system_prompt_append` to require JSON output matching the ADR-016 schema (Fact[]/Intent[]/Complete). Keep tools unchanged.
- `companion/src/llm/llm-extract.ts` — add `appsec_board_v1` schema: typed findings (`severity: 'info'|'low'|'medium'|'high'|'critical'`, `url?`, `evidence` required, `confidence: 0..1`, `trust` default `llm_asserted`).

**Out of scope:** no `server.ts` change, no new tool, no persistence, no UI.

**DoD:**

- Pack loads via existing `pack-engine.ts`; no engine change.
- Existing AppSec pack unit tests stay green.
- Manual run on 1 sample PRD produces parseable JSON in worker's final assistant message; llm-extract returns typed object.
- Run on N=5–10 sample PRDs (v1 vs v2) for measurement gate; record under `docs/audit/reviews/appsec-v2-measurement-<date>.md`.

### Task 3 — Enrich `collect_handback` (only after Task 2 measurement passes)

**File:** `companion/src/server.ts` around L2480 (`case "collect_handback"`).

**Change:** when caller passes `expect_structured: true` (set automatically when caller thread's Pack has `board_mode`), parse the worker's last assistant message via the `appsec_board_v1` llm-extract schema; return structured `facts` / `intents` / `complete` fields alongside the existing `last_assistant` blob. If parse fails or returns no Facts, return recoverable error `HANDBACK_MISSING_STRUCTURE` (orchestrator LLM can retry the worker with a corrective prompt — same shape as existing tabId-hallucination retry pattern).

**Heartbeat reap (in same phase):** `wait_workers` poll path reaps Intents with `now - heartbeat_at > 2 * idle_ttl_ms` as `abandoned`; cancel path reaps immediately; both write audit entries.

**Unit tests** (`companion/tests/orchestrator-*.test.ts`):

- Structured handback parse success.
- Free-form-only handback → `HANDBACK_MISSING_STRUCTURE`.
- Heartbeat reap after `2 * idle_ttl_ms`.
- Cancel → immediate reap of worker's open Intents.
- Audit entry written for each mutation.

**Out of scope:** persistence (still prompt-only at the worker level; orchestrator can hold the parsed board in its own Thread context as ephemeral LLM state — Phase B-min later if measurement shows we need cross-turn durability). UI. New tools.

**DoD:** unit tests green; manual run end-to-end (spawn worker → worker returns structured handback → orchestrator reads structured `facts`/`intents` → user-typed Complete via HITL); audit log shows the chain.

---

## 8. Summary

The brief is good. The protocol thesis is sound and the architecture accommodates it without new runtime. Three things to fix before code:

1. **Flip the order** — measure prompt-only Pack before kernel.
2. **Specify authorship/trust** — worker Facts are LLM output, not ground truth; provenance + trust tier + verified-required-for-high-severity.
3. **HITL on Complete** — same shape as `spawn_worker`; no LLM self-approval.

Plus one decision to commit to in ADR-016: **thread metadata, not a new dir.**

P0 = ADR + one pack file + one llm-extract schema, ~1–2 days, fully reversible.

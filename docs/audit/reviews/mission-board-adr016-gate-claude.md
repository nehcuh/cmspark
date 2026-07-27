# DECISION GATE — ADR-016 MissionBoard Adversarial Review

| Field | Value |
|-------|--------|
| **Reviewer** | Claude dual pass (`claude -p --permission-mode bypassPermissions`) + independent ADR cross-read |
| **Date** | 2026-07-27 |
| **Mode** | Decision gate only — **no product code** reviewed or written |
| **Subject (PRIMARY)** | `docs/adr/016-mission-board.md` (status: **Proposed**) |
| **Subject (lock source)** | `docs/decisions/v1.3/cairn-mission-board-plan-synthesis-2026-07-27.md` |
| **Cross-read** | ADR-015 (`docs/adr/015-multi-agent-orchestrator-tab-lock.md`); prior plan reviews `cairn-mission-board-plan-claude-20260727-131845.md` / `…-pi-…`; `companion/src/orchestrator/constants.ts` (`ORCHESTRATOR_TOOL_ALLOWLIST` = 8 tools); `server.ts` `L2_GATE_TOOLS` (spawn HITL); `Thread` interface in `thread-manager.ts` (no `mission_board` yet) |
| **Checks forced** | AGPL safety · trust tiers · complete HITL · thread metadata · ADR-015 conflict · over-scope |
| **Verdict** | **APPROVE_WITH_CHANGES** |
| **Confidence** | **72%** |

---

## 1. Executive verdict

**APPROVE_WITH_CHANGES.** Confidence **72%**.

Direction is correct and most high-stakes locks from the Claude+Pi synthesis are actually written into ADR-016:

- Learn Cairn **protocol**, do **not** vendor AGPL code.
- Persist board as **`thread.mission_board`** (reject `boards/` dir and Knowledge-as-board).
- **`board_complete` = L2 `security_token` HITL** (mirror `spawn_worker`).
- Trust taxonomy `llm_asserted | tool_verified | user_confirmed`, default `llm_asserted`.
- Prefer fold structured writes into **`collect_handback`**; keep `wait_workers` **poll-only**.
- Phase 1 = single-thread true board + schema; Intent claim / graph UI deferred; measurement gate before multi-agent Intent.

That is enough to approve **as a product direction** and to allow **Task 1 (ADR text) to finish**. It is **not** enough to greenlight Task 2/3 product code without closing the **must_fix** set below. Several security- and concurrency-critical rules are still written at “建议 / 可 / 或” strength. Writing kernel against slash-decisions will produce divergent implementations that pass code review and fail threat review.

**Discount (28%)** is concentrated in:

1. Trust-tier **server enforcement** under-specified (reject vs silent downgrade; `tool_verified` without evidence soft-allowed in P0).
2. Board **host Thread** non-deterministic (“parent/orchestrator **或** 约定宿主”).
3. Orchestrator **tool surface** self-contradiction (fold-only rhetoric vs four `board_*` tools).
4. AGPL controls are **principles**, not **controls** (no notices / clean-room / scan hook).
5. Cancel → Intent `abandoned` placement vs ADR-015 cancel chain not locked (Phase 3, but must be locked *before* Phase 3 code; recorded here as must_fix for the ADR, not as a Phase 1 merge blocker if Phase 3 is still deferred in text).

**Not REJECT** because: Complete HITL is locked hard; persistence location is locked; non-goals and 30-day must-not-do are strong; ADR-015 invariants (poll-only wait, no auto-spawn, tab lease untouched, spawn L2) are preserved in intent; over-scope is mostly controlled by phase gates.

---

## 2. Evidence base

### Inspected (docs)

| Artifact | Role |
|----------|------|
| `docs/adr/016-mission-board.md` | Subject ADR (Proposed, no product code) |
| `docs/decisions/v1.3/cairn-mission-board-plan-synthesis-2026-07-27.md` | PRIMARY lock source (Claude 78% + Pi 82% → synthesis) |
| `docs/adr/015-multi-agent-orchestrator-tab-lock.md` | Conflict surface: allowlist, L2, pause/cancel, wait poll-only, caps |
| `docs/adr/014-mission-pack-enterprise-modules.md` (referenced) | Pack ≠ runtime; audit channel |
| Prior plan reviews | `docs/audit/reviews/cairn-mission-board-plan-{claude,pi}-20260727-131845.md` |

### Inspected (code — existence / invariants only)

| Artifact | Finding |
|----------|---------|
| `companion/src/orchestrator/constants.ts` | `ORCHESTRATOR_TOOL_ALLOWLIST` length **8**; `max_workers=5`; `idle_ttl_ms=120_000`; `WORKER_HARD_DENY` |
| `companion/src/server.ts` ~652–662 | `L2_GATE_TOOLS` includes `spawn_worker` / `ask_user`; LLM `user_confirmed` not trusted |
| `companion/src/threads/thread-manager.ts` | `Thread` has `orchestrator_run_id` / `parent_thread_id` / pack fields; **no** `mission_board` yet — ADR claim “尚未实现产品代码” is accurate |
| `companion/THIRD_PARTY_NOTICES` | Exists; **no** Cairn entry yet |

### Executed

```text
claude -p --permission-mode bypassPermissions  → independent adversarial pass
  → VERDICT=APPROVE_WITH_CHANGES  MUST_FIX_COUNT=5  (confidence ~68%)
This gate document merges that pass with an independent ADR-015 conflict read.
```

Evidence tags used below: `[inspected]` static doc/code; `[executed]` CLI dual pass; `[assumed]` reasoned without runtime exercise.

---

## 3. Check-by-check findings

### 3.1 AGPL safety — **PARTIAL FAIL** (must_fix MF-4)

| Sub-check | Result | Anchor |
|-----------|--------|--------|
| Ideas-only / no vendor stated | **PASS** | ADR §1.2, §2.7, §2.8, §2.9 #1; synthesis §2.2 / §5 #1 |
| Explicit reject of Cairn schema **原文** | **PASS** (principle) | §1.2 “明确不抄…schema 原文”; §2.8 |
| No Cairn package in deps (policy) | **PASS** (policy) | §2.7 |
| Clean-room / non-copying **control** | **FAIL** | No: no-open-source-during-impl rule, no `THIRD_PARTY_NOTICES` entry, no `LICENSES/cairn-inspiration.md`, no CI identity grep |
| Derivative gray zone acknowledged | **WEAK** | Combined Fact/Intent/Hint + provenance shape is more than pure “idea”; ADR correctly forbids verbatim schema but does not document *what was reimplemented vs observed* |

**Judgment:** AGPL-3.0 does **not** infect ideas/methods. Reimplementing semantics under CMspark’s own schema is the correct legal posture. The residual risk is **process**, not principle: a future contributor opening Cairn while “fixing” field names produces a weak paper trail. For a decision gate, that is a **must_fix on the ADR text** (controls + notices), not a REJECT of the product direction.

**Not a must_fix:** inventing novel taxonomy names for the sake of legal theater. Generic English words `facts` / `intents` / `hints` are not Cairn-owned. Keep the taxonomy; document independence.

---

### 3.2 Trust tiers — **FAIL (lock incomplete)** (must_fix MF-1)

| Sub-check | Result | Anchor |
|-----------|--------|--------|
| Three tiers defined | **PASS** | §2.3.2 |
| Default `llm_asserted` | **PASS** | §2.3.2 |
| LLM cannot mark `user_confirmed` | **PARTIAL** | Stated; enforcement is “剥离/**或**降级” — slash, not lock |
| `tool_verified` requires real evidence | **FAIL for P0** | §2.3.3: “建议…P0 **可 warn**，P1 可 hard-require” → tier is decorative in the proving phase |
| Actor × tier matrix | **PARTIAL** | §2.4 allows Worker/Orc/User write Facts; no hard rule that only `actor_type:user` (UI-stamped) may set `user_confirmed` |
| External reports keep tier | **PASS** | §2.3.2 / §2.9 #7 |
| Audit records trust | **PASS** | §2.6 `board.fact_added` |

**Threat model (from prior plan review, still valid):** Worker reads adversarial page content. Structured Fact with `trust: tool_verified` and empty/fake evidence is a **prompt-injection → structured-trust promotion** channel. Soft-warn in P0 is how that channel ships.

**Required lock shape (normative):**

```
write(Fact):
  if actor_type ∈ {worker, orchestrator, system}:
    trust ∈ {llm_asserted, tool_verified} only
    if trust was user_confirmed → REJECT (audit board.trust_rejected); do not silent-downgrade
  if actor_type === user (UI-originated stamp only):
    trust may be user_confirmed
  if trust === tool_verified:
    require evidence.length ≥ 1 and ≥1 evidence entry with non-null tool_call_id
    (P0 hard-require, not warn)
```

Silent downgrade hides self-elevation attempts from audit. Prefer **reject + recoverable error** so the orchestrator can retry with correct tier.

---

### 3.3 Complete HITL — **PASS** (do not regress)

| Sub-check | Result | Anchor |
|-----------|--------|--------|
| `board_complete` / equivalent must L2 `security_token` | **PASS** | §2.3.6, §2.4, §2.7, §4.2 |
| Ban LLM `user_confirmed` self-batch complete | **PASS** | §2.3.6 |
| Align with `spawn_worker` pattern | **PASS** `[inspected]` | ADR-015 progress + `L2_GATE_TOOLS` includes `spawn_worker` |
| `complete_proposal` must not silent-complete | **PASS** | §2.5.2 |
| Folded into handback flag still L2 | **PASS** | §2.3.6 last row |

**This is the strongest security lock in the ADR.** Implementation that allows complete without Confirm Center + `security_token` is an automatic gate fail.

**Nit (non-blocking):** synthesis §3 Phase 1 still says “用户确认完整报告 **或** L2 `board_complete`（二选一）”. ADR §2.3.6 supersedes. Mark synthesis stale; do not re-open the fork in code.

**should_fix:** When `board_complete` lands, add it to `L2_GATE_TOOLS` **and** to orchestrator allowlist in the same PR; document Confirm Center identity fields (`orchestrator_run_id`, thread, goal_summary) like spawn.

---

### 3.4 Thread metadata — **PASS location / PARTIAL lifecycle**

| Sub-check | Result | Anchor |
|-----------|--------|--------|
| Storage = `thread.mission_board` | **PASS** | §2.2 locked |
| Reject `~/.cmspark-agent/boards/` | **PASS** | §2.2, §2.8 |
| Reject Knowledge-as-board | **PASS** | §2.2, §2.8 |
| Peer of `orchestrator_run_id` / pack fields | **PASS** | §2.2; fits `Thread` shape `[inspected]` |
| Default null / off | **PASS** | §2.2, §2.5.1 |
| Pack snapshot does not roll back run facts | **PASS direction** | §4.1 |
| `pack.apply` over existing board | **UNSPECIFIED** | “另议” residue |
| `pack.uninstall` vs board | **UNSPECIFIED** | §4.1 hand-wave |
| Archive / restore | **UNSPECIFIED** | — |

**Location decision is correct and load-bearing** (prior plan reviews converged here). Lifecycle gaps are **should_fix** for Phase 1 merge quality, not architectural rejection — default “board lives with Thread; Pack snapshot excludes facts/intents/hints” is already almost enough if made explicit.

**Recommended lifecycle lock (should_fix SF-1):**

- `pack.apply`: may set `board_mode` + initial `goal`/`origin` only when null; **never** wipe facts/intents/hints.
- `pack.uninstall`: does **not** clear `mission_board`.
- Archive/delete Thread: board goes with Thread (already §2.2).
- Snapshot: pack assembly fields only; optional diagnostic copy of `origin`/`goal` only.

---

### 3.5 Conflict with ADR-015 — **MIXED** (must_fix MF-2, MF-3; MF-5 for Phase 3)

| Sub-check | Result | Notes |
|-----------|--------|-------|
| No new swarm runtime | **PASS** | Board = Thread field; stack on Pack + multi-agent |
| `wait_workers` poll-only, no barrier | **PASS** | §2.5.3, §4.2 — explicit |
| No auto-spawn / no shared-observer | **PASS** | §2.8, §4.2 |
| Tab lease / host_computer rules unchanged | **PASS** | §2.7, §4.2 |
| `isToolAllowed` still gates writes | **PASS** | §2.5, §2.7 |
| Caps: workers 5, intent caps stack | **PASS** | §2.3.4 + §4.2 |
| Spawn still L2 only; board cannot bypass | **PASS** | §4.2 |
| Pause freezes Intent heartbeat (Phase 3) | **PASS intent** | §2.3.4 / §4.2 |
| Cancel → claimed intents `abandoned` | **ORDER UNSPECIFIED** | ADR-015 cancel chain is ordered: deny L2 → reject pending → release lease. Board mutation placement not locked → **MF-5** |
| Orchestrator allowlist | **CONFLICT / AMBIGUITY** | Rhetoric: fold into handback. Surface: up to `board_read` + `board_add_hint` + `board_set_goal` + `board_complete` (+ handback). Today allowlist = **8** tools `[inspected]`. 4 new tools = **+50%**. **MF-3** |
| Board host Thread | **AMBIGUOUS** | §2.5.2 “parent/orchestrator **或** 约定宿主”. **MF-2** |
| Worker whitelist for `board_read` | **MISSING** | Workers need non-null whitelist (ADR-015). Pack mapping §4.1 does not say how `board_read` is granted to Explore roles |

**No hard contradiction** that forces REJECT (e.g. ADR-016 does not reintroduce auto-spawn or barrier wait). Conflicts are **underspecification** where ADR-015 is already precise.

---

### 3.6 Over-scope — **MOSTLY PASS** (should_fix polish)

| Sub-check | Result | Notes |
|-----------|--------|-------|
| Phase 0 = ADR only, no product code | **PASS** | Matches file status |
| Phase 1 single-thread board, no Intent claim | **PASS** | §5 |
| No graph UI / big Dashboard in early phases | **PASS** | §2.8, §5 Phase 4 |
| Measurement gate before multi-agent Intent | **PASS** | Phase 2 |
| Reject fake board / prompt-only without schema | **PASS** | §2.8; synthesis §3 (Pi win) |
| AppSec methodology rewrite deferred | **PASS** | Phase 5; Phase 1 light Pack append |
| Tool sprawl risk | **RISK** | Same as MF-3; “optional” tools invite scope creep in first PR |
| Intent open recording “可选” in P0 | **RISK** | §2.3.4 — tighten to “handback intent increments only; no intent tools” |
| Severity field in P0 Fact schema | **SCOPE CREEP risk** | No writer rules; AppSec-shaped field in generic board |

Phase plan is one of the better parts of the ADR. Over-scope failure mode is **implementer freedom on optional tools**, not a five-phase fantasy.

---

## 4. What is solid (do not regress)

Any future PR or ADR edit that weakens these is an automatic re-gate:

1. **No Cairn vendor / no AGPL file copy** (§1.2, §2.7–2.9).
2. **`thread.mission_board` only** — no top-level boards dir, no Knowledge-as-board (§2.2).
3. **`board_complete` (or equivalent) requires L2 `security_token`** — no LLM self-complete (§2.3.6).
4. **Default Fact trust = `llm_asserted`**; external narrative must carry tier (§2.3.2).
5. **`wait_workers` remains poll-only** — board must not become a hidden barrier (§2.5.3).
6. **Tab lease / `WORKER_HARD_DENY` / spawn HITL / max_workers=5** unchanged by board (§4.2).
7. **No auto-spawn, no shared-observer** (§2.8, ADR-015 Deferred).
8. **Board mode default off**; free-text handback when off (§2.5.1–2.5.2).
9. **Audit mutations to `capability-audit.jsonl`** with trust + provenance (§2.6).
10. **Phase 2 measurement gate** before Intent claim scheduling (§5).
11. **Pack ≠ Board** (§2.1, §4.1).
12. **Reject fake-board demo without schema validation** (§2.8).

---

## 5. must_fix (blocks product implementation)

> Only items that must be locked in ADR-016 **before** Task 2/3 product code. Nits and Phase-4 UI are excluded.

### MF-1 — Trust-tier write-path enforcement must be a hard lock (security)

**Why blocks:** “服务端剥离/降级” is not a decision. Soft-warn on `tool_verified` without evidence makes the tier system non-binding in P0 — the phase that is supposed to prove the protocol. Implementers will pick silent downgrade (easy) and lose audit signal of self-elevation.

**Required ADR text (normative, not 建议):**

1. Non-user actors **cannot** set `user_confirmed` → **reject write** + audit `board.trust_rejected` (not silent downgrade).
2. `trust: tool_verified` → **hard-require** `evidence.length ≥ 1` with ≥1 `tool_call_id` (P0, not P1).
3. `user_confirmed` only from **UI-originated** user path (`actor_type: user` + confirmation stamp), never from LLM tool args.
4. Orchestrator prompts / export paths **must** treat `llm_asserted` as hypothesis.

### MF-2 — Board host Thread must be a single deterministic rule (correctness)

**Why blocks:** §2.5.2 “合并进 parent/orchestrator **或** 约定 board 宿主 Thread” allows two concurrent designs. Audit joins, cancel races, and multi-worker handback merges need one host.

**Required ADR text:**

- **Board host = orchestrator/parent Thread** (the Thread that owns the run / is the single-thread AppSec conversation).
- Worker Threads **do not** own `mission_board` (may only contribute via handback merge into host).
- Single-thread board mode: the active user Thread is the host.
- Remove “或” ambiguity from §2.5.2 and update §4.2 mapping table.

### MF-3 — Orchestrator tool surface: pick Path A or Path B (architecture / ADR-015)

**Why blocks:** §2.5 “优先 fold…少增 board.*” vs §2.5/§5 listing up to four `board_*` tools is an internal fork. ADR-015’s narrow allowlist is a security property (`ORCHESTRATOR_TOOL_ALLOWLIST` is currently 8 tools). Leaving both paths open defaults to the larger surface.

**Required ADR text — lock exactly one:**

| Path | Surface | Notes |
|------|---------|-------|
| **A (recommended)** | Writes: structured `collect_handback` only. New L2 tool: **`board_complete` only**. `board_read` = host Thread field read (orchestrator) or optional **worker** tool if Pack whitelist grants it — not a bare WS method. Hint/goal: `board_add_hint` / `board_set_goal` **deferred** or UI→companion non-LLM path. | Matches “fold first”; +1 allowlist entry max for complete. |
| **B** | Explicitly allow `board_read`, `board_add_hint`, `board_set_goal`, `board_complete` on orchestrator allowlist; document growth **8 → 12**; update ADR-015 allowlist list in a one-line cross-ref; require Pack whitelist grants for workers. | Acceptable if product insists on tools, but must be deliberate. |

Do **not** ship “optional” as “implementer chooses A and B”.

### MF-4 — AGPL controls, not only principles (licensing paper trail)

**Why blocks:** Without a written control set, “we only learned the protocol” is assertion, not evidence. Gate for a protocol inspired by AGPL work needs a minimal paper trail before code lands.

**Required ADR §2.7 addition:**

1. Implementation of `companion/src/board/**` (or chosen path) **without Cairn source open** during authoring (clean-room instruction for implementers).
2. Update `companion/THIRD_PARTY_NOTICES`: *Cairn (oritera/Cairn) — not linked; protocol ideas only; AGPL-3.0; schema and code reimplemented independently.*
3. Add short `docs/licenses/cairn-inspiration.md` (or under `docs/decisions/`) listing stolen **ideas** vs rejected **artifacts**.
4. **Forbidden:** copy Cairn source files, paste schema JSON verbatim, add Cairn as dependency.

CI grep for Cairn-unique identifiers is **recommended** (should_fix), not required to unblock.

### MF-5 — Cancel → Intent abandoned placement in ADR-015 chain (concurrency; lock now, implement Phase 3)

**Why blocks Phase 3 code:** ADR-015 cancel order is strict. “cancel → abandoned” without step index causes audit-out-of-order and mutation-after-lease-release races.

**Required ADR §4.2 text:**

- On worker cancel / `fleet.stop_all` / `chat.abort`: mutate that worker’s claimed/open intents to `abandoned` **in the same phase as L2 deny / worker-stamped confirm reject** (step aligned with ADR-015 cancel (1)), **before** pending tool reject drainage and **before** tab lease release.
- Audit `board.intent_status` (or `board.abandoned`) must be ordered **before** lease-release audit rows for that worker.
- Pause: freeze heartbeat reap only; **do not** abandon (already stated — keep).

Phase 1 may ship without Intent claim, but the **decision** must not remain open or Phase 3 will re-litigate under time pressure.

---

## 6. should_fix (non-blocking; fix before or during first merge slice)

| ID | Item | Why |
|----|------|-----|
| SF-1 | Lock Pack apply/uninstall/snapshot board lifecycle (see §3.4) | Avoid silent fact wipe / snapshot bloat |
| SF-2 | Lock audit event prefix to `board.*` (drop “可微调前缀”) | Grepability / enterprise audit |
| SF-3 | P0 Intent: “handback increments only; no intent-mutation tools” | Kill “可选” scope creep |
| SF-4 | Either remove `severity` from P0 Fact schema or lock writer rules | Prevent AppSec leakage into generic board |
| SF-5 | Pin `board_mode` field path (`pack.yaml` top-level vs manifest) + Thread observability | Implementer thrash |
| SF-6 | `complete_proposal` must not auto-call complete; may only surface to orchestrator / `ask_user` | Defense in depth beyond §2.5.2 |
| SF-7 | Define `HANDBACK_MISSING_STRUCTURE` recovery contract (max retries, corrective prompt) | Avoid infinite retry loops |
| SF-8 | Mark synthesis Phase 1 “complete 二选一” **superseded** by ADR §2.3.6 | Doc drift |
| SF-9 | Pick single code root: `companion/src/board/` **or** `orchestrator/board*` before Task 2 | Avoid dual modules |
| SF-10 | Worker Pack whitelist: document how Explore roles get `board_read` if Path A/B grants it | ADR-015 non-null whitelist |
| SF-11 | Optional CI: fail if `Cairn`/`oritera` appears under `companion/src/board/**` | Cheap AGPL hygiene |
| SF-12 | Phase 1 success criteria: also require `schema_version===1` + audit `board.handback_applied` | Measurable |

---

## 7. nits

- §2.2 TS interface vs §2.3 JSON drafts — state “Zod/TS is authoritative; JSON is illustrative”.
- Provenance `message_id`: clarify assistant message vs tool-call message for audit joins.
- Intent `priority` default and who may raise it.
- Prefer not using identifier `Cairn` in product code comments (docs only) to avoid noisy license scans.
- Glossary for stigmergy / Reason / Explore would help readers who skip the brief.
- §5 Phase 1 row still echoes synthesis’s softer Complete language in places — align headings with §2.3.6.

---

## 8. Attack scenarios (adversarial)

### A1 — Prompt-injection elevates trust

Malicious PRD/HTML instructs worker: emit Fact with `trust: "user_confirmed"` or `tool_verified` and empty evidence.  
**Today ADR:** may soft-warn / ambiguous strip.  
**With MF-1:** reject; audit `board.trust_rejected`; report stays honest.

### A2 — LLM declares mission complete

Orchestrator calls `board_complete` with fabricated `user_confirmed: true` in tool args (no token).  
**ADR:** must fail like spawn without `security_token`.  
**Regression test required:** mirror spawn HITL unit test.

### A3 — Allowlist bloat as privilege creep

Implementer adds `board_add_fact` / `board_patch` / WS `board.*` for “dashboard speed”.  
**ADR non-goals** ban WS family; MF-3 forces explicit path.  
**Gate:** any new bare WS `board.*` = reject.

### A4 — Dual host Thread under multi-worker

Worker A merges to parent; Worker B merges to self; orchestrator reads empty board.  
**MF-2** eliminates.

### A5 — Cancel race leaves open Intents forever (Phase 3)

Worker cancelled after claim; intents stay `claimed`; orchestrator never completes.  
**MF-5** + heartbeat (Phase 3) required.

### A6 — AGPL accidental copy

Contributor pastes Cairn schema fragment into Zod.  
**MF-4** paper trail + notices; optional CI.

### A7 — Scope: severity drives complete policy too early

P0 starts encoding “severity≥High needs tool_verified to complete” before measurement.  
**ADR Phase 5** owns that; SF-4 keeps P0 schema lean.

---

## 9. Comparison to synthesis locks

| Synthesis lock (§2.3) | In ADR-016? | Gate note |
|----------------------|-------------|-----------|
| Thread field `mission_board` | Yes §2.2 | Solid |
| Fact + provenance + trust | Yes §2.3 | Enforcement incomplete → MF-1 |
| Complete = L2 security_token | Yes §2.3.6 | Solid |
| Fold handback; few board tools | Partial | Rhetoric vs list → MF-3 |
| Audit capability-audit.jsonl | Yes §2.6 | Solid |
| Intent caps | Yes §2.3.4 | Solid |
| pause/cancel board semantics | Partial | Order missing → MF-5 |
| No AGPL vendor | Yes | Controls missing → MF-4 |
| No fake board | Yes | Solid |
| Phase order ADR → schema+handback+Pack | Yes §5 | Solid |

ADR-016 successfully **codifies** the synthesis. The remaining work is **hardening locks from prose to single-choice rules**.

---

## 10. Verdict and go / no-go

| Question | Answer |
|----------|--------|
| Approve product direction? | **Yes** |
| Approve ADR as final for implementation? | **Not yet** — close MF-1…MF-5 in ADR text |
| Allow Task 2/3 code now? | **No** until must_fix merged into ADR-016 (or a short “ADR-016a lock errata” accepted by same gate) |
| REJECT? | **No** — no fatal conflict with ADR-015; Complete HITL and persistence are right |

### Final verdict

# **APPROVE_WITH_CHANGES**

**must_fix count: 5** (MF-1 trust enforcement · MF-2 board host · MF-3 tool surface path · MF-4 AGPL controls · MF-5 cancel/intent order)

After MF-1…MF-5 land in ADR-016, re-gate is optional short review; Task 2 (schema + Thread field) and Task 3 (handback validation + AppSec Pack light append) may start under Path A or B as locked.

---

## 11. Suggested ADR delta checklist (for authors)

- [ ] §2.3.2 — replace “剥离/降级” with reject + audit rules (MF-1)
- [ ] §2.3.3 — `tool_verified` evidence hard-require in P0 (MF-1)
- [ ] §2.5.2 — single board host = parent/orchestrator Thread (MF-2)
- [ ] §2.5 / §5 — Path A **or** Path B tool list, delete the other (MF-3)
- [ ] §2.7 — THIRD_PARTY_NOTICES + clean-room + inspiration note (MF-4)
- [ ] §4.2 — cancel chain step for intent abandoned (MF-5)
- [ ] (optional) SF-* items in same edit pass

---

*Gate author: Claude dual-pass + independent ADR-015 cross-read. Artifact path: this file.*

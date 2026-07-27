# Cairn MissionBoard Plan — Pi Adversarial Review

**Date**: 2026-07-27 13:18:45 UTC  
**Reviewer**: Pi (adversarial, constructive consensus)  
**Primary brief**: `docs/decisions/v1.3/cairn-inspired-mission-board-brief-2026-07-27.md`  
**Read artifacts**: ADR-014 (Mission Pack), ADR-015 (Multi-Agent / Tab Lock), Ship Summary (multi-agent P0/P1/P2-lite), companion source tree (`orchestrator/`, `server.ts`, `message-router.ts`)  
**Method**: Static analysis of brief against implemented kernel + architectural invariants; threat-model the proposed phases against ADR-014/015 contracts.

---

## 1. Verdict: **APPROVE_WITH_CHANGES** (confidence 82%)

The direction is **correct**: Cairn's blackboard protocol is the right abstraction to learn from. Structured Fact/Intent/Hint on a MissionBoard slots into the existing Orchestrator→Worker model without requiring a new runtime. The brief's non-goals are disciplined (no AGPL fork, no silent fan-out, no Pack replacement).

**Confidence is discounted by 18%** because of four unresolved architectural risks — any one of which can waste 2+ weeks if decided wrong:

| Risk | Severity | Mitigation |
|------|----------|------------|
| **Waterfall spec-then-build** (Phase A→B split) | HIGH | Merge A+B into one "kernel spec+impl" phase |
| **Prompt-only board as escape hatch** (alt path A→C) | HIGH | Reject; hard schema from day one |
| **AppSec Pack v2 over-coupling** (Phase C scope) | MEDIUM | Decouple board from any specific Pack; prove protocol on generic integration first |
| **Persistence ambiguity** (fork #1 unresolved) | MEDIUM | Decide in ADR-016: Thread metadata field (strong preference) |

With these addressed, the plan is **mergeable in 3 engineering tasks** (see §7) and does not conflict with the ADR-014/015 kernel invariants.

---

## 2. Attack the plan

### A1 — Waterfall: Phase A (spec) decoupled from Phase B (kernel) is wasteful

**Anchor**: Brief §2 "Phase A — Spec only (ADR + schema)" then "Phase B — Companion kernel (thin)".

**Attack**: For a protocol this small — a JSON schema, 4–6 tools, and in-thread state — the spec **is** the implementation's type definitions. Splitting them into separate phases creates:
- Spec drift: schema decisions made without the constraint of companion's existing Thread metadata model will be revised in Phase B anyway.
- False consensus: ADR-016 approved before anyone tries to wire `board_add_fact` through `createToolExecutor`'s `isToolAllowed` gate — the moment you do, you discover that board writes need a role check (who may write Facts?) that the spec overlooked.
- The brief itself admits this: fork #4 ("Prompt-only first vs hard schema enforcement from day one?") is a question you can only answer by attempting the hard-schema implementation.

**Recommendation**: Collapse A+B into **one phase**: draft ADR-016 alongside a companion branch with Zod schemas + 3 tools. Ship the ADR and the branch together as a "protocol kernel" mergeable slice. The ADR records decisions; the code proves them.

### A2 — "Prompt-only board" escape hatch is dangerous and should be rejected now

**Anchor**: Brief §2 alt order: "A → C (prompt-only board in pack without persistence) → B if we want faster UX demo."

**Attack**: This is the **most dangerous sentence in the brief**. Here's why:

1. **Prompt-only boards don't constrain LLMs.** If the board is purely system-prompt instructions ("please output a JSON Fact when you find something"), the Orchestrator and Workers will drift from the format within 3 turns. We have evidence of this from every prompt-only contract in the industry — without schema validation at the tool boundary, the output degrades.

2. **It creates a false sense of progress.** "UX demo" means users see a board but the board lies (missed Facts, duplicate Intents, malformed entries). When we later add hard schema, we break the UX the demo sold. The demo becomes a liability.

3. **It duplicates ADR-015's "prompt-only lock" veto.** ADR-015 explicitly rejected prompt-only locks (§否决: "Prompt-only 锁"). The same reasoning applies: structural invariants that matter for correctness (`∀ intents, ∃! holder`) cannot be enforced by system prompts.

4. **Cairn's value is the structured contract, not the concept of a board.** The protocol *is* the validation. Without validation, we're just adding a text field to Thread and calling it a "board."

**Recommendation**: Strike the prompt-only alt path. Hard schema from day one. If the schema proves wrong, we evolve it — but at least we know it's wrong from evidence (validation errors), not from user confusion.

### A3 — Phase C bundles AppSec Pack v2 with board protocol; these are independent

**Anchor**: Brief §2 "Phase C — AppSec Pack v2: Rewrite/extend appsec-prd-review (or new pack) to use board."

**Attack**: The board protocol is a **generic coordination substrate**. AppSec is one consumer. Bundling them:
- Makes the board's API decisions hostage to one pack's needs (e.g., "Facts must have CVSS scores" leaks into the generic schema).
- Delays board validation: you can't test the board lifecycle (claim→explore→fact→complete) until AppSec v2 is written.
- Ignores easier integration targets: the board should be demonstrable with a trivial pack first (e.g., "search 3 pages and collect structured summaries").

**Recommendation**: Split Phase C into C1 (board integration on existing `collect_handback` flow, pack-agnostic) and C2 (AppSec Pack v2 rewrite, consuming the now-stable board API). C1 can merge in the same slice as B.

### A4 — Persistence fork (#1) is the architectural linchpin; deferring it blocks everything

**Anchor**: Brief §3 fork #1: "Persistence: thread field vs separate board store vs knowledge docs?"

**Attack**: This is not a "nice to decide later" fork. It determines:
- Whether the board survives companion restart (thread field: yes, via `~/.cmspark-agent/threads/`; in-memory: no).
- Whether board state is visible to the LLM as context (thread field: yes, appended to system prompt; separate store: needs explicit tool reads).
- Whether `collect_handback` writes to the same store that `spawn_worker` reads from (thread field: yes, same Thread; separate store: needs cross-reference by `orchestrator_run_id`).

The **only answer consistent with ADR-014 and ADR-015** is: **Thread metadata field**. Workers are Threads; the board is Thread-scoped; the board lives on the Thread that owns it (Orchestrator's Thread, or a dedicated board Thread). A separate board store duplicates the Thread lifecycle (create, archive, delete) and creates orphan boards when workers are force-released.

**Recommendation**: Decide now: board state is a JSON field on Thread metadata (`thread.board: MissionBoardState`), persisted to `~/.cmspark-agent/threads/<id>/metadata.json` alongside existing `tool_whitelist`/`parent_thread_id`/`orchestrator_run_id`. Include in ADR-016.

### A5 — Missing: board as audit artifact, not just coordination tool

**Anchor**: Brief §2 mentions tools but nowhere mentions audit.

**Attack**: ADR-015's audit trail (`capability-audit.jsonl`) captures spawn/L2/lease/force-release. A MissionBoard with structured Facts/Intents/Hints is the **natural semantic audit layer** above raw tool calls. If we don't write board events to audit:
- Post-hoc "what did this orchestration actually achieve?" is unanswerable without replaying LLM transcripts.
- Enterprise module compliance (ADR-014's `capability_profile: enterprise`) has no structured record of findings.

**Recommendation**: Every board mutation (`board_add_fact`, `board_add_intent`, `board_complete`) writes an audit event to `~/.cmspark-agent/logs/capability-audit.jsonl` with `board_op`, `thread_id`, `orchestrator_run_id`, timestamp, and the validated entry. This is <10 lines of code and gives enterprise users a compliance artifact for free.

### A6 — Fork #2 (who may write Facts?) is a role-design question, not a permission toggle

**Anchor**: Brief §3 fork #2: "Who may write Facts? Only worker after Explore? Orchestrator too? User?"

**Attack**: The brief treats this as a permission question. It's actually a **protocol-trust question**:

- **Workers write Facts from Explore**: These are evidence-backed claims ("found XSS in /login param `redirect`"). Trust level: medium (worker may hallucinate findings; structured handback validation mitigates).
- **Orchestrator writes Facts from synthesis**: These are conclusions drawn from multiple workers ("threat model complete: 3 HIGH, 2 MEDIUM findings across 5 pages"). Trust level: higher (orchestrator has broader context).
- **User writes Facts via Hints**: These are ground-truth injections ("the login page IS the attack surface"). Trust level: highest (human judgment).

The right model: **all three can write Facts, but with provenance tags** (`source: 'worker' | 'orchestrator' | 'user'`). The `board_complete` tool checks: "does the goal statement have supporting Facts from at least one non-user source?" (prevents user from completing without agent work).

**Recommendation**: Allow all three roles to write Facts, tag provenance. Complete authority requires Facts from worker/orchestrator sources. Do not over-engineer a permission matrix for a 6-tool system.

### A7 — The brief doesn't address the existing `collect_handback` contract

**Anchor**: ADR-015 defines `collect_handback` as orchestrator tool that collects worker output. Brief §1.3 says "collect_handback = Fact increments only (structured)."

**Attack**: Today, `collect_handback` returns free-text handback from workers. The brief wants to constrain it to structured Facts only "when board mode on." This is a **breaking change to the worker contract**:

- Workers must know that their handback will be parsed as Facts, so they must output the board schema.
- If a worker outputs free text and board mode is on, what happens? Reject? Parse-best-effort? LLM re-prompt?
- The `spawn_worker` tool must communicate "board mode on, handback format = Fact[]" to the worker's system prompt.

This is solvable but needs explicit design. The brief's "board mode on/off" flag (fork #3) is the entry point: when board mode is on, `spawn_worker` injects a board-specific handback instruction into the worker's system prompt (via `system_prompt_append`, leveraging ADR-014's Pack apply mechanism).

**Recommendation**: Add to Phase B: `spawn_worker` accepts `board_mode: boolean`. When true, worker system prompt appends structured handback format (JSON schema inline). `collect_handback` in board mode validates output against Fact schema and auto-files to board on success; on failure, returns validation errors to orchestrator for re-prompt.

---

## 3. What to steal from Cairn (ranked) vs what to reject

### Steal (ranked by value-to-effort ratio)

| Rank | Concept | Why | Integration point |
|------|---------|-----|-------------------|
| **1** | **Structured Fact / Intent / Hint schema** | The blackboard is Cairn's core innovation. Typed entries with validation prevent the board from becoming a hallucinated scratchpad. | `companion/src/orchestrator/board-schema.ts` (Zod schemas) |
| **2** | **Explicit `complete` when goal ⊂ facts** | Termination condition as structural check, not LLM self-declaration. Eliminates the "orchestrator says done but workers found nothing" failure mode. | `board_complete` tool with `canComplete(): boolean` validation |
| **3** | **Origin + Goal as first-class board fields** | Makes every run auditable and replayable. Origin = "what triggered this" (page URL, PR link, user request). Goal = "what does success look like" (structured checklist). | Board state on Thread metadata |
| **4** | **Intent claim (atomic) + heartbeat (liveness)** | Workers claim Intents atomically (CAS on board). Heartbeat proves they're still exploring. Maps to ADR-015's HARD_HELD tab lease + TTL. This is the **bridge** between board coordination and tab-lock correctness. | `board_claim_intent` tool with thread_id ownership check; heartbeat via existing tool-call activity |
| **5** | **Structured output contracts per action** | Cairn mandates JSON schema for Bootstrap/Reason/Explore outputs. We already have `tool_whitelist` and structured handback; board mode extends this to Fact/Intent format. | `collect_handback` output validation |

### Reject (and why)

| Rank | Concept | Rejection reason |
|------|---------|-----------------|
| **1** | **AGPL code** | Already stated in brief. No debate. |
| **2** | **Docker attack-lab as default** | Different product; CMspark is browser-first. AppSec pack runs against live pages, not CTF containers. |
| **3** | **Flat worker model (no roles)** | CMspark has Orchestrator↔Worker asymmetry, capability elevation levels, and L2 gating. Cairn's "all workers equal" would bypass our security model. |
| **4** | **Graph visualization as core** | Nice-to-have UI (Phase D) but NOT a protocol concern. Cairn's graph is a debugging tool; our FleetStrip + Dashboard serve the same observability role. Don't let graph-viz requirements leak into the board protocol. |
| **5** | **Cairn's exploration budget model** | We already have: tab lease TTL (120s idle, 600s hard max), worker cap (5/run), L2 admission (1/run, 2/process). Adding a third budget system (Cairn's "exploration budget") creates confusion. Our existing caps ARE the budget. |
| **6** | **Agent-to-agent chat (not in Cairn, but Cairn explicitly rejects it)** | Agree with Cairn here: stigmergy (board-based) coordination is correct. No direct agent-to-agent messages. Already consistent with ADR-015 (workers don't talk to each other; only orchestrator collects). |

---

## 4. Recommended phase order

```
Phase A' — Kernel spec + impl (merged, 2-3 days)
    ├── ADR-016: MissionBoard data model, persistence, provenance, security
    ├── Zod schemas: Fact, Intent, Hint, Goal, Board
    ├── 3 tools: board_add_fact, board_set_goal, board_read
    ├── In-thread board state (Thread metadata field)
    ├── Handback → Fact auto-file (board mode on collect_handback)
    ├── Audit event per board mutation
    └── Unit tests: schema validation, fact provenance, handback parse

Phase B' — Intent claim + heartbeat (~2 days)
    ├── board_add_intent tool (with atomic claim: thread_id ownership)
    ├── Heartbeat: existing tool-call activity counts as implicit heartbeat
    ├── board_complete with canComplete() structural check
    ├── spawn_worker board_mode flag
    └── Unit tests: claim/release, heartbeat TTL, complete gate

Phase C' — First pack integration (pack-agnostic, ~2 days)
    ├── Generic board usage in collect_handback flow (any pack)
    ├── Integration test: orchestrator spawns 2 workers, board tracks facts
    ├── Verify: board survives companion restart (thread metadata persistence)
    └── AppSec Pack v2 scope ONLY after this proves the protocol works

Phase D' — UI (after protocol proves useful, ~3 days)
    ├── Side Panel: Fact count, open Intents, Hint list
    ├── FleetStrip badge: "N open intents"
    ├── Hint input affordance (user → board user message as Hint)
    └── Graph visualization deferred to P2

Phase E' — Verify + harden (~1 day)
    ├── Full AppSec scenario: threat model → spawn workers → board facts → complete
    ├── Re-review ADR-016 vs implementation
    └── Code freeze
```

**Why this order beats the brief's proposals:**

| Brief order | Problem | Fixed in A'–E' |
|-------------|---------|----------------|
| A→B sequential | Waterfall spec-then-build, see A1 | Merged into A' |
| A→C (alt path) | Prompt-only board escape hatch, see A2 | Rejected; hard schema always |
| D before prove-out | UI before protocol works | D' moved after C' verify |
| C = AppSec v2 | Board coupled to one pack, see A3 | C' is pack-agnostic; AppSec v2 is follow-on |

---

## 5. P0 smallest vertical for first merge

**The mergeable slice is Phase A'**: a single-thread MissionBoard (no multi-agent intent claim yet) with:

| Component | File | Content |
|-----------|------|---------|
| ADR | `docs/adr/016-mission-board.md` | Data model, persistence decision, provenance, `board_complete` gate semantics |
| Schema | `companion/src/orchestrator/board-schema.ts` | Zod: `Fact`, `Intent`, `Hint`, `Goal`, `BoardState` (re-export types) |
| Tools | `companion/src/server.ts` (or new `board-tools.ts`) | `board_read` (get full board state), `board_add_fact` (validate + append + audit), `board_set_goal` (set origin+goal on board) |
| Board state | Thread metadata field `board: BoardState` | Read from `thread.metadata.board` on thread load; write on mutation |
| Handback | `companion/src/server.ts` `collect_handback` path | When `board_mode: true` on the run, parse handback as Fact[] and auto-file |
| Audit | `companion/src/server.ts` (`AuditWriter`) | `board_op` events to `capability-audit.jsonl` |
| Tests | `companion/tests/orchestrator-board-schema.test.ts` | Schema validation, reject malformed facts, fact list ordering, board serialization round-trip, handback parse success/failure |

**Explicitly excluded from P0** (to keep the slice mergeable in <3 days):
- `board_add_intent` / intent claim / heartbeat (Phase B')
- `board_complete` with `canComplete()` (Phase B')
- Multi-agent integration (board works on single-thread orchestrator first)
- Any UI changes (no FleetStrip badge, no Side Panel board list)
- AppSec Pack v2

**Why this slice is correct**: It proves the board protocol works as a structured coordination substrate BEFORE we add the complexity of multi-agent intent claims. A single orchestrator writing Facts to its own board and reading them back is a fully testable, reviewable, mergeable unit of work.

---

## 6. Must-not-do next 30 days

| # | Prohibition | Rationale | Risk if violated |
|---|-------------|-----------|------------------|
| **1** | **Do NOT implement full AppSec Pack v2 as the board's first consumer** | The board protocol must prove itself with a generic integration first. AppSec v2 is a separate product decision with its own scope (threat model taxonomy, checklist format, finding severity). Coupling board design to AppSec means the board API inherits domain-specific cruft. | Board schema becomes AppSec-specific; other packs can't use it without refactor; AppSec v2 scope bloat delays board merge by weeks. |
| **2** | **Do NOT build any UI (Phase D) before the protocol is proven in tests and manual runs** | UI before protocol works = building a dashboard for a car whose engine doesn't start. The board's utility must be verifiable from audit logs and tool outputs alone. If it's not useful without UI, the protocol is wrong. | Wasted UI work that must be rewritten when the board schema evolves; users see a board that "lies" during schema changes. |
| **3** | **Do NOT implement intent claim + heartbeat (Phase B') before single-thread board (Phase A') is merged and green** | Intent claim requires the tab-lease integration (`board_claim_intent` ↔ `SOFT_RESERVED` / `HARD_HELD`). That's an ADR-015 coupling. Single-thread board has no coupling besides Thread metadata. | Builds on an untested foundation; intent claim bugs cascade into tab-lease bugs (false exclusivity, zombie intents). |
| **4** | **Do NOT add board state as a separate persistence store** | Thread metadata field is the only answer consistent with ADR-014 (Pack = Thread fields) and ADR-015 (Worker = Thread). A separate store creates orphan boards, dual lifecycle, and cross-reference bugs. See §A4. | Orphan board entries when threads are deleted; board state not visible to LLM context without explicit tool reads; two sources of truth for run state. |
| **5** | **Do NOT touch Cairn source code, attempt interop, or reference Cairn in user-facing tool names** | AGPL risk even from reading source for design inspiration (clean-room: read the paper/concept, not the code). Tool names like `cairn_board_read` imply a Cairn dependency that doesn't exist. Use `cmspark_` prefix or no prefix: `board_read`, `board_add_fact`. | AGPL contamination if any Cairn code is read; user confusion about product boundaries. |
| **6** | **Do NOT add a "board mode on/off" per-pack flag until Phase B'** | Fork #3 is real but premature. For P0 (single-thread board), board mode is implicit: `collect_handback` looks for `board: BoardState` on the thread. If present, parse handback as Facts. If absent, free-text as today. No flag needed yet. The flag becomes necessary in Phase B' when `spawn_worker` must decide whether to inject board instructions into worker system prompt. | Premature abstraction; flag without multi-agent intent claim is dead code. |
| **7** | **Do NOT change the existing worker spawn, tab lease, or L2 admission to accommodate the board** | The board is a coordination substrate ABOVE these primitives, not a replacement. Intent claim in Phase B' uses existing tab lease (the intent is "I am exploring tab X"), not a new lock. Facts written to board do not bypass L2. | Breaks ADR-015 kernel invariants; introduces new locking primitive that interacts badly with tab lease state machine. |

---

## 7. Concrete next 3 engineering tasks

### Task 1 — ADR-016: MissionBoard data model + persistence decision

**File**: `docs/adr/016-mission-board.md`

**Deliverables**:
- Board data model: `BoardState { origin, goal, facts: Fact[], intents: Intent[], hints: Hint[], completed_at }`
- Fact schema: `{ id, content: string, source: 'worker'|'orchestrator'|'user', evidence?: string, thread_id, timestamp }`
- Intent schema: `{ id, description: string, claimed_by_thread_id?: string, claimed_at?, heartbeat_at?, status: 'open'|'claimed'|'done'|'cancelled' }`
- Hint schema: `{ id, content: string, source_message_id: string, timestamp }`
- Goal schema: `{ statement: string, acceptance_criteria: string[] }`
- Persistence decision: Thread metadata field `board: BoardState` on orchestrator Thread. Rationale: consistent with ADR-014 Pack model, survives companion restart, visible to LLM context.
- Security: board tools whitelisted to orchestrator by default; worker writes via `collect_handback` proxy only; provenance tags for audit.
- `board_complete` gate: `canComplete()` returns true when goal has ≥1 supporting Fact from non-user source AND no open Intents (Phase B', spec-only here).
- Explicit non-goals: graph visualization, agent-to-agent chat, Cairn interop.

### Task 2 — Companion board schema + validation + unit tests

**File**: `companion/src/orchestrator/board-schema.ts`  
**Tests**: `companion/tests/orchestrator-board-schema.test.ts`

**Deliverables**:

```typescript
// board-schema.ts — Zod schemas (illustrative, not prescriptive)
import { z } from 'zod';

export const FactSchema = z.object({
  id: z.string().uuid(),
  content: z.string().min(1).max(4000),
  source: z.enum(['worker', 'orchestrator', 'user']),
  evidence: z.string().optional(),
  thread_id: z.string(),
  timestamp: z.string().datetime(),
});
export type Fact = z.infer<typeof FactSchema>;

export const IntentSchema = z.object({
  id: z.string().uuid(),
  description: z.string().min(1),
  claimed_by_thread_id: z.string().optional(),
  claimed_at: z.string().datetime().optional(),
  heartbeat_at: z.string().datetime().optional(),
  status: z.enum(['open', 'claimed', 'done', 'cancelled']),
});
export type Intent = z.infer<typeof IntentSchema>;

export const HintSchema = z.object({
  id: z.string().uuid(),
  content: z.string().min(1),
  source_message_id: z.string(),
  timestamp: z.string().datetime(),
});
export type Hint = z.infer<typeof HintSchema>;

export const GoalSchema = z.object({
  statement: z.string().min(1),
  acceptance_criteria: z.array(z.string()),
});
export type Goal = z.infer<typeof GoalSchema>;

export const BoardStateSchema = z.object({
  origin: z.string(),
  goal: GoalSchema,
  facts: z.array(FactSchema),
  intents: z.array(IntentSchema),
  hints: z.array(HintSchema),
  completed_at: z.string().datetime().optional(),
});
export type BoardState = z.infer<typeof BoardStateSchema>;

// Validation helper
export function validateFact(input: unknown): { ok: true; fact: Fact } | { ok: false; error: string } {
  const result = FactSchema.safeParse(input);
  if (result.success) return { ok: true, fact: result.data };
  return { ok: false, error: result.error.message };
}

// Serialization for Thread metadata
export function serializeBoard(board: BoardState): string {
  return JSON.stringify(BoardStateSchema.parse(board));
}

export function deserializeBoard(raw: string): BoardState {
  return BoardStateSchema.parse(JSON.parse(raw));
}

export function createEmptyBoard(origin: string, goal: Goal): BoardState {
  return { origin, goal, facts: [], intents: [], hints: [] };
}
```

**Unit tests** (minimal set):
- `validateFact` rejects: missing `id`, empty `content`, invalid `source`, non-UUID `id`
- `validateFact` accepts valid Fact with all fields
- `createEmptyBoard` returns valid BoardState with empty arrays
- `serializeBoard` → `deserializeBoard` round-trip identity
- BoardState rejects: facts array with non-Fact entry, missing `origin`
- Intent status transitions: open → claimed → done/cancelled (reject invalid transitions)
- Handback parse: valid Fact[] → ok; mixed valid/invalid → aggregate errors; free-text → reject

### Task 3 — Minimal board tools in companion + collect_handback integration

**Files**: `companion/src/server.ts` (tool dispatch) or new `companion/src/orchestrator/board-tools.ts`  
**Tests**: extend existing `orchestrator-*.test.ts` or new `orchestrator-board-tools.test.ts`

**Deliverables**:

Three new tools registered in companion's tool dispatch (orchestrator-whitelisted only):

| Tool | Input | Behavior | Error codes |
|------|-------|----------|-------------|
| `board_set_goal` | `{ origin: string, goal: { statement, acceptance_criteria } }` | Create or replace board on current thread. Serialize to `thread.metadata.board`. Audit: `board_op: set_goal`. | `BOARD_ALREADY_COMPLETED` (if completed_at set) |
| `board_add_fact` | `{ fact: FactInput (omit id, timestamp, thread_id) }` | Validate with `FactSchema`, generate id/timestamp/thread_id, append to board. Audit: `board_op: add_fact`. Return `{ ok: true, fact }`. | `BOARD_NOT_INITIALIZED`, `BOARD_VALIDATION_ERROR`, `BOARD_ALREADY_COMPLETED` |
| `board_read` | `{}` (no input) | Return full board state from thread metadata. | `BOARD_NOT_INITIALIZED` |

**`collect_handback` integration** (in existing `executeCompanionTool` switch case for `collect_handback`):

```
if (orchestratorThread.metadata.board) {
  // Board mode: parse worker handback as Fact[]
  const facts = tryParseFacts(handback);
  if (facts.ok) {
    for (const fact of facts) {
      board_add_fact_internal(board, fact, worker.thread_id);
    }
    return { collected: facts.length, facts };
  } else {
    return { error: 'BOARD_HANDBACK_PARSE_ERROR', details: facts.error };
  }
}
// Else: free-text handback as today
```

**Key design decisions** (to be recorded in ADR-016):
1. Board lives on the orchestrator's Thread, not on a separate store.
2. Workers do NOT have direct `board_add_fact` — they write via `collect_handback` proxy only. This ensures the orchestrator is the single authority on board state.
3. `board_set_goal` is idempotent (overwrites previous goal if board exists, creates if absent). Rejects if `completed_at` is set.
4. `board_add_fact` appends. No edit/delete/overwrite of facts. Immutable append-only for audit trail.
5. No `board_add_intent` or `board_complete` yet — these are Phase B'.

**Unit tests**:
- `board_set_goal` creates board on thread with no prior board
- `board_set_goal` overwrites goal on existing board (facts preserved)
- `board_set_goal` rejects when `completed_at` is set
- `board_add_fact` appends to facts array, generates UUID and timestamp
- `board_add_fact` rejects invalid fact payload
- `board_add_fact` rejects when board not initialized
- `board_read` returns full state
- `board_read` returns `BOARD_NOT_INITIALIZED` when no board set
- `collect_handback` in board mode: valid Fact[] → auto-filed, count returned
- `collect_handback` in board mode: invalid JSON → parse error returned to orchestrator
- `collect_handback` without board: free-text passthrough (backward compat)

---

## Appendix: Response to open forks (§3)

As promised, here are explicit answers to each fork with rationale anchored in ADR-014/015:

| Fork | Answer | Rationale |
|------|--------|-----------|
| **1. Persistence** | **Thread metadata field** | See §A4. Consistent with ADR-014 Pack model and ADR-015 Worker=Thread. Survives restart. Visible to LLM context. Single lifecycle. |
| **2. Who may write Facts?** | **All three, provenance-tagged** | See §A6. Workers via `collect_handback` proxy; orchestrator directly via `board_add_fact`; user via `board_add_fact` with `source: 'user'`. `board_complete` gate requires non-user Facts. |
| **3. Board mode on/off** | **Implicit in P0 (board present → mode on); explicit flag in P1 per-pack** | See §6 item 6. No flag needed for single-thread board. Flag becomes necessary when `spawn_worker` must inject board instructions into worker system prompt. |
| **4. Prompt-only first?** | **Hard schema from day one. Reject prompt-only.** | See §A2. ADR-015 vetoed prompt-only locks for the same structural reason. Validation is the protocol's value. |
| **5. Complete authority** | **Structural gate: `canComplete()` checks goal ⊂ facts ∧ no open intents. Orchestrator calls `board_complete`, L2 confirms.** | Orchestrator initiates, user confirms via L2. This matches ADR-015's pattern: agent proposes, human approves. The structural check prevents premature completion. |
| **6. Priority vs ADR-015 debt** | **Board is a NEW workstream, not ADR-015 debt repayment. Ship board P0 in parallel with ADR-015 WS E2E work — they don't conflict.** | Board touches Thread metadata + new tools. ADR-015 open items are WS E2E + Dashboard grid + `tool.abort`. Different files, different test suites. No merge conflict risk. |
| **7. License risk** | **Zero risk if clean-room.** | Read the Cairn paper/concept/README. Do NOT read Cairn source code. The structured blackboard idea predates Cairn (Tuple Spaces, Linda, 1986). We implement our own schemas, tools, and lifecycle. No AGPL code, no derivative work. |

---

**Review complete.** The plan is good direction with correct non-goals. Fix the four architectural risks (waterfall spec-build, prompt-only escape hatch, AppSec over-coupling, persistence ambiguity) and this is a 2-week mergeable workstream that strengthens the Orchestrator→Worker model without touching kernel invariants.


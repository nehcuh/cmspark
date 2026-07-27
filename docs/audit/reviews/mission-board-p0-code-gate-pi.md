# MissionBoard P0 — Pi Adversarial CODE GATE

**Date**: 2026-07-27  
**Reviewer**: Pi (adversarial code gate; constructive, not performative)  
**Role**: CODE GATE — product code for MissionBoard P0 **must not claim gate-cleared** until must_fix closed  
**Worktree**: `/Users/huchen/Projects/cmspark/.claude/worktrees/multi-agent-p0`  
**Commits inspected**: `aae5536` (P0 kernel schema/service) · `2fad77f` (structured collect_handback + AppSec pack)  
**Primary artifacts**:
- `companion/src/board/{schema,service,index}.ts`
- `companion/src/server.ts` (`collect_handback`, `board_read`, `L2_GATE_TOOLS`)
- `companion/src/orchestrator/constants.ts` (`ORCHESTRATOR_TOOL_ALLOWLIST`)
- `companion/src/bridge/tool-definitions.ts`
- `companion/src/threads/thread-manager.ts` (`mission_board` / worker host guard)
- `companion/src/packs/builtin/appsec-prd-review/pack.yaml`
- ADR-016 + Appendix A (G1–G14)
- Prior decision gate: `docs/audit/reviews/mission-board-adr016-gate-pi.md`

**Mandated focus**:
1. False structure  
2. Complete without HITL  
3. Handback bypass  
4. AGPL contamination  

**Method**: Static adversarial read of P0 implementation against ADR-016 Appendix A hard gates + live kernel integration. Board unit tests executed: **34/34 pass** `[executed]`. Full companion suite observed green in same environment (1943 pass / 0 fail / 18 skipped) `[executed]`. `pi -p` second pass not required for ground truth — findings are file-anchored. Evidence tags: `[inspected]` / `[executed]`.

---

## Verdict: **BLOCK** (confidence 88%)

P0 delivers a **real schema + single write path + structured handback fold** — not a pure prompt fake board. That is meaningful progress on Task 2 and part of Task 3.

It does **not** satisfy ADR-016 stage-1 success criteria or Appendix A gates required to ship as “MissionBoard P0 complete”:

| Appendix A | Status | Note |
|------------|--------|------|
| G1 server-stamp trust/provenance | **HOLD** | Client trust stripped; server re-stamps `[inspected: service.resolveTrustForFact]` |
| G2 non-user `user_confirmed` REJECT | **HOLD** | Covered by unit test `[executed]` |
| G3 `tool_verified` resolvable id | **HOLD in unit / FAIL in prod wire** | Resolver optional; **server never passes it** |
| G4 delimiter frames on model re-entry | **FAIL** | Helpers exist; `board_read` returns raw board |
| G5 hard `canComplete` | **FAIL — missing** | No complete path at all |
| G6 Confirm Center complete digest | **FAIL — missing** | `board_complete` not in L2 list |
| G7 host = orch / sole; workers never | **HOLD** | Host rules + `tm.update` worker throw |
| G8 `mutateMissionBoard` + lock | **HOLD** | Uses `withThreadLock` |
| G9 Path A tool closed set incl. `board_complete` | **FAIL** | No `board_complete`; allowlist only +`board_read` |
| G10 schema caps | **HOLD** | Caps match ADR §2.2.3 |
| G11 `complete_proposal` non-mutating | **HOLD** | Explicit ignore + test |
| G12 export/report trust labels | **FAIL / N/A** | No export path wiring; `board_read` keeps trust field but no framed presentation |
| G13 cancel → intent abandoned order | **FAIL / deferred** | No cancel cascade to board intents |
| G14 AGPL paper trail | **HOLD** | Notices + inspiration + no dep |

**Bottom line**: shipping this as gate-cleared would be **false safety** — structured handback exists, but mission “complete” remains prose / social-engineerable, and empty/weak structure can still succeed.

---

## Executive summary (mandated focuses)

| Focus | Verdict | Worst residual failure |
|-------|---------|------------------------|
| **False structure** | **BLOCK-class** | `empty_ok: true` or intent-only JSON → `collect_handback` success with zero evidence facts; AppSec pack *teaches* that path |
| **Complete without HITL** | **BLOCK-class** | No `board_complete`, no `canComplete`, no L2 — product success stays free-text / `complete_proposal` social pressure; structural complete impossible *or* latent `tm.update` status poke |
| **Handback bypass** | **PASS with holes** | Board-on prose correctly rejected; residual: model-chosen `empty_ok`, production `tool_verified` dead, re-collect fact duplication |
| **AGPL contamination** | **PASS** | No Cairn dep/source; clean-room comments; notices + `docs/licenses/cairn-inspiration.md` present |

---

## What P0 got right (do not reopen)

1. **Thread field, not second store** — `Thread.mission_board` + `board_mode`; no `~/.cmspark-agent/boards/` `[inspected]`.  
2. **Zod authority + caps** — `BOARD_CAPS` match ADR §2.2.3; empty claim rejected; max facts/intents enforced on merge.  
3. **Single write path** — `mutateMissionBoard` → load → op → size check → schema → `tm.update` under `withThreadLock` `[inspected]`.  
4. **Workers never host** — `isBoardHostThread` + `ThreadManager.update` throw on worker `mission_board` `[executed tests]`.  
5. **Trust stamp discipline (kernel)** — client `user_confirmed` from worker REJECT + audit; default `llm_asserted`; `complete_proposal` does not set `status` `[executed]`.  
6. **Prose handback rejection when board on** — `HANDBACK_MISSING_STRUCTURE` recoverable + `board.handback_rejected` audit `[executed]`.  
7. **Path A mostly closed** — no public `board_add_fact` / `board_add_intent` / WS `board.*`; only fold + `board_read` (+ internal `addHint`, no tool).  
8. **Pack flag** — `appsec-prd-review` sets `board_mode: true` and ships JSON contract in `system_prompt_append` `[inspected]`.  
9. **AGPL hygiene paper trail** — see §AGPL below.

---

## Attack findings

### F1 — P0 BLOCK: False structure (JSON shape ≠ evidence)

**Anchors**:
- `schema.ts` `parseHandbackPayload`: empty `facts`+`intents` allowed when `empty_ok: true`  
- Intent-only payload (facts `[]`, intents non-empty) succeeds without any claim/evidence  
- `HandbackPayloadSchema.schema_version`: `literal(1).or(z.number().int().positive())` — accepts arbitrary positive versions  
- Pack prompt (`appsec-prd-review/pack.yaml` L59): *「若确实无发现可设 empty_ok: true」*  
- Production `collectWorkerHandback` → `applyHandbackPayload` **never** supplies `resolveToolCall` (`server.ts` case `collect_handback`)  

**Traces**:

**T1 — Empty success theater**  
1. Worker last assistant: `{"schema_version":1,"facts":[],"intents":[],"empty_ok":true,"summary":"scan complete"}`  
2. `collect_handback` → success, `board.handback_applied` with `facts_added: 0`  
3. Orchestrator / human sees “structured handback OK” with **zero** board evidence  

**T2 — Intent-only structure**  
1. Worker emits only `intents:[{description:"maybe later",status:"done"}]`  
2. Parser accepts (non-empty intents)  
3. Board gains no Facts; “done” intent is self-declared  

**T3 — tool_verified dead in production**  
1. Unit tests pass resolvable ids via injected `resolveToolCall`  
2. Live server path omits resolver → any requested `tool_verified` hits “no resolver” REJECT  
3. Net effect: **all live Facts are `llm_asserted`** unless a future user path stamps `user_confirmed`  
4. Hard `canComplete` (when implemented) cannot see `tool_verified` evidence from real tool loops  

**T4 — Injection plane still privileged**  
- `formatUntrustedFactFrame` / `formatUntrustedHintFrame` exist and are unit-tested  
- `boardReadForTool` returns **raw** `MissionBoard` JSON — no delimiter wrap, no system “data not instructions” enforcement at the tool boundary `[inspected: service.boardReadForTool]`  
- Malicious page → worker claim → persisted Fact → `board_read` re-enters orchestrator as structured mission memory (ADR decision-gate F1 residual, **still open**)

**Why this is false structure**: Zod acceptance proves **syntax**, not **epistemic structure**. ADR’s product promise was “kill prose hallucination,” not “accept empty JSON as mission progress.”

**must_fix**:
1. Treat `empty_ok` as **audited exceptional** only: require non-empty `summary` reason; rate-limit / surface in UI; do **not** teach as default “no findings” success without host-side policy flag.  
2. Wire production `resolveToolCall` from worker/host message tool_call records (or demote path with `board.trust_demoted` audit — never silent).  
3. Apply delimiter framing in **every** model-facing board projection (`board_read` response and any auto-digest); keep raw board only for UI/export with trust badges.  
4. Tighten handback `schema_version` to **exact** `1` until a migration path exists.

---

### F2 — P0 BLOCK: Complete without HITL (missing complete plane)

**Anchors**:
- Grep of `companion/src/**/*.ts`: **no** `board_complete`, **no** `canComplete` implementation  
- `ORCHESTRATOR_TOOL_ALLOWLIST`: `spawn_worker`, `wait_workers`, `collect_handback`, `board_read`, `ask_user`, … — **no** `board_complete` `[inspected]`  
- `L2_GATE_TOOLS` in `server.ts`: evaluate / shell / spawn / ask_user — **no** `board_complete` `[inspected]`  
- `tool-definitions.ts`: no `board_complete` function definition  
- `complete_proposal` returned to orchestrator on successful collect (`collectWorkerHandback` data) while explicitly non-mutating for status  

**Traces**:

**T1 — Reward hack via narrative complete**  
1. Worker handback: one `llm_asserted` fact + `complete_proposal: { goal_summary: "done", empty_complete: true }`  
2. Status remains `open` (good — G11 holds)  
3. Orchestrator chat / summary still tells user “mission complete”; no L2 Confirm Center, no trust histogram, no supporting id check  
4. Product outcome = **complete without HITL** at the only surface humans actually read  

**T2 — Structural complete impossible (integrity gap)**  
- There is no legal tool path to set `status=completed` under L2 + `canComplete`  
- ADR stage-1 checkbox “facts ≥ 1 **or** audited empty_complete” cannot be met through product tools  
- Either teams ship prose-complete forever, or someone adds a half-baked complete later without G5/G6  

**T3 — Latent status poke**  
- `ThreadManager.update` accepts arbitrary `mission_board` object for non-worker threads with **no status-transition guard** (only worker-host ban)  
- Any future/internal caller can write `status: "completed"` without L2, digest, or canComplete  
- Not an exposed LLM tool today, but the persistence layer does not encode the complete invariant

**Why L2-on-spawn is not enough**: Spawn HITL gates **capability elevation**. Complete HITL gates **claiming goal satisfaction**. Different threat; ADR locked both. P0 implements neither complete tool nor predicate.

**must_fix**:
1. Implement `board_complete` tool (orchestrator-only) + allowlist entry + `L2_GATE_TOOLS` membership.  
2. Implement hard `canComplete` **before and after** L2 approve (G5): goal non-empty or `empty_goal_ok`; supporting ids exist; ≥1 supporting Fact `trust ∈ {tool_verified,user_confirmed}` **or** explicit audited `empty_complete` with non-empty reason from Confirm Center (not LLM flag alone).  
3. Confirm Center payload (G6): goal, trust histogram, claim previews, residual_risks, empty_complete flag.  
4. Reject LLM `user_confirmed` / pre-set `security_token` on complete (same pattern as spawn).  
5. Optional defense-in-depth: only `mutateMissionBoard` ops may set `status`; reject raw `update({ mission_board: { status: completed }})` outside complete op (or validate transitions in `update`).

---

### F3 — Handback bypass (mostly closed; residual soft-bypasses)

**What holds**:
| Path | Result |
|------|--------|
| Board mode on + prose last assistant | `HANDBACK_MISSING_STRUCTURE` + audit |
| Board mode on + empty assistant | same |
| Board mode off + prose | free-form success (ADR-015 compat) — intentional |
| `mission_board` present even if `board_mode` false | still requires structure |
| Worker host board | blocked |
| Parentless worker structured collect | `BOARD_HOST_INVALID` fail-closed |

**Residual bypass / abuse**:

| ID | Issue | Severity |
|----|-------|----------|
| H1 | **`empty_ok: true`** model-chosen empty merge success (see F1) | **High** (false structure) |
| H2 | **No `resolveToolCall` wire** → cannot earn real `tool_verified` on live path | **High** (evidence integrity) |
| H3 | **Re-collect idempotency**: same worker message collected N times appends N fact copies (no message_id dedupe) | Medium (inflation / confusion) |
| H4 | **`expect_structured`** forces structured parse when board off — OK for tests; LLM can enable stricter path but not bypass board-on | Low |
| H5 | **`extractFirstJsonObject`** may latch onto incidental `{...}` in prose if parseable and passes schema (weak claims) | Medium |
| H6 | **Cancel cascade (G13)** not implemented — abandoned intents not board-synced on `worker_cancel` | Medium (scheduling honesty; phase-3-ish but ADR lists as hard gate) |

**Not a bypass (confirm)**: `complete_proposal` cannot set `status` — tested and code-voided.

**must_fix**:
1. Close H1/H2 as under F1.  
2. Deduplicate handback apply by worker `message_id` (or content hash) so re-collect is idempotent.  
3. Prefer fenced ```json``` over first-brace extract when both present; reject multi-object ambiguity.  
4. Track G13 cancel→intent abandoned as explicit P0.5/P1 with audit order, or formally defer in ADR if not blocking stage-1 — **do not silently claim G13 done**.

---

### F4 — AGPL contamination: **PASS**

| Check | Result |
|-------|--------|
| `companion/package.json` / lockfile `cairn` / `oritera` | **Absent** `[inspected]` |
| `companion/src/board/**` identifiers `Cairn` / `oritera` | **None** (only “no third-party AGPL” hygiene comments) `[inspected]` |
| `companion/THIRD_PARTY_NOTICES` Cairn entry | **Present** — not linked; protocol ideas only; AGPL-3.0 `[inspected]` |
| `docs/licenses/cairn-inspiration.md` | **Present** — ideas vs rejected artifacts + clean-room instructions `[inspected]` |
| `companion/src/computer/model-license.ts` Cairn section | **Present** (parallel notice surface) |
| Vendored Cairn source / schema paste | **Not found** |
| Schema independence | Fact/Intent/Hint trichotomy is **documented protocol idea**; Zod shapes use CMspark caps, provenance, trust tiers, ULID-like ids — not a verbatim Cairn dump `[inspected]` |

**Residual risk (non-blocking)**: vocabulary overlap (Fact/Intent/Hint) is intentional per ADR; keep CI grep recommendation (ADR §2.7.5) as non-blocking hygiene. **Do not open Cairn source while editing `board/**`.**

**No AGPL must_fix for this gate.** Maintain paper trail on future edits.

---

## Integration surface map (P0 as shipped)

```
Pack board_mode:true ──► Thread.board_mode
                              │
Worker last assistant JSON ──► collect_handback (server)
                              │
                    collectWorkerHandback
                              │
              board off? ──yes──► free-text last_assistant (no board write)
                              │ no
                    parseHandbackPayload
                              │
              empty_ok / facts / intents
                              │
                    applyHandbackPayload ──► mutateMissionBoard(host)
                              │
                    board_read ◄── raw MissionBoard (no frame)
                              │
                    board_complete  ✗ MISSING
                    canComplete     ✗ MISSING
                    L2 complete     ✗ MISSING
```

---

## Tests vs gates

| Area | Tests | Gate coverage |
|------|-------|---------------|
| Schema / caps / prose reject / empty_ok | `board-schema.test.ts` | Syntax only |
| Trust reject / tool_verified with **injected** resolver / complete_proposal non-mutate / worker host | `board-service.test.ts` | G1/G2/G11 partial G3 |
| collect free-form vs structured / board_read / allowlist names | `board-collect-handback.test.ts` | Handback fold |
| canComplete / board_complete L2 / Confirm digest | **None** | **G5/G6 absent** |
| Production resolveToolCall integration | **None** | G3 live path |
| Delimiter used on board_read | Frame unit only | **G4 incomplete** |
| Export trust labels | **None** | G12 |
| Cancel intent abandoned order | **None** | G13 |

`[executed]` board tests: **34 pass / 0 fail**.

---

## must_fix (gate clearance list)

Ordered for merge readiness:

1. **`board_complete` + L2 + allowlist + tool definition** (G5/G6/G9) — cannot claim complete without HITL.  
2. **Hard `canComplete`** with supporting facts / trust predicate **or** audited `empty_complete` from Confirm Center (not LLM-only).  
3. **Confirm Center digest** for complete (goal, trust histogram, claim previews, residual_risks, empty flag).  
4. **Wire `resolveToolCall`** on live `collect_handback` / `applyHandbackPayload` from recorded tool results.  
5. **Close false-structure holes**: tighten `empty_ok` policy; exact `schema_version: 1`; prefer fenced JSON.  
6. **Apply UNTRUSTED_BOARD_* framing** on all model-facing board projections (`board_read` minimum).  
7. **Handback idempotency** by source `message_id` to prevent fact duplication.  
8. **Status transition integrity**: completed only via complete mutation path.  
9. **Tests**: canComplete matrix (empty board reject, all-llm_asserted reject, tool_verified accept, empty_complete path); L2 token strip/self-approve reject; live resolver integration; framed board_read snapshot.  
10. **Explicit G12/G13**: implement or document ADR deferral — do not imply done.

---

## Non-blocking nits

- `addHint` exported without tool — fine for P0; if exposed later, keep worker forbid + allowlist.  
- `isBoardHostThread`: any non-`worker` is host (including mis-tagged roles) — prefer explicit `orchestrator` | sole-user rule when roles are always stamped.  
- ADR text still says “Task 2/3 未开工产品代码” in §5 — **stale**; implementation exists; update ADR status table.  
- `max_open_intents_per_worker` / `per_run` constants defined but **not enforced** on handback intent append.  
- Pack allowlist for AppSec does not include multi-agent tools (expected for single-thread); orchestrator path still needs complete tool on orch allowlist when multi-agent.

---

## Verdict rationale

| If we APPROVE_WITH_CHANGES | Reality |
|---------------------------|---------|
| “Schema + handback is enough for P0” | ADR stage-1 **explicitly** requires `board_complete` / `canComplete` / L2 digest |
| “complete_proposal non-mutate saves us” | Only blocks status field; **does not** block human-facing false complete |
| “empty_ok is product-needed” | Allowed as **exception** with audit — currently a **model-soft success** with pack coaching |

Therefore: **BLOCK**. Kernel pieces (schema, host, mutate, prose reject, trust stamp, AGPL) are solid foundations. **Do not mark MissionBoard P0 code-gate cleared** until complete plane + false-structure + live tool_verified wire are closed.

---

## Evidence index

| Path | Role |
|------|------|
| `companion/src/board/schema.ts` | Caps, handback parse, `empty_ok`, frames |
| `companion/src/board/service.ts` | mutate, trust, handback fold, board_read, **no complete** |
| `companion/src/server.ts` L652–662, L2481–2499 | L2 tools; collect/board_read wire; **no resolveToolCall** |
| `companion/src/orchestrator/constants.ts` L27–37 | Allowlist without `board_complete` |
| `companion/src/bridge/tool-definitions.ts` L631–660 | Tools surface |
| `companion/src/packs/builtin/appsec-prd-review/pack.yaml` | `board_mode: true` + empty_ok coaching |
| `companion/THIRD_PARTY_NOTICES` | Cairn AGPL notice |
| `docs/licenses/cairn-inspiration.md` | Ideas vs rejected artifacts |
| `docs/adr/016-mission-board.md` Appendix A | Hard gates G1–G14 |
| `companion/tests/board-*.test.ts` | 34 pass `[executed]` |

---

*Pi adversarial CODE GATE — MissionBoard P0. End of review.*

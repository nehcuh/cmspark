# MissionBoard P0 Ship Note — ADR-016 vertical slice

| Field | Value |
|-------|--------|
| **Date** | 2026-07-27 |
| **Branch** | `feat/multi-agent-p0` |
| **Worktree** | `/Users/huchen/Projects/cmspark/.claude/worktrees/multi-agent-p0` |
| **HEAD (at write)** | `bfeeb5e` — `fix(mission-board): close P0 code-gate must_fix (G3–G6/G9/G12/G13)` |
| **ADR** | [ADR-016](../../adr/016-mission-board.md) (Accepted + Appendix A hard gates) |
| **Related** | ADR-014 Mission Pack · ADR-015 Multi-Agent · [cairn synthesis](./cairn-mission-board-plan-synthesis-2026-07-27.md) · [multi-agent ship](./multi-agent-ship-summary-2026-07-27.md) |
| **Scope** | Stage-1 P0 vertical slice: true board schema + structured handback + complete HITL + AppSec pack light touch |

---

## 1. Executive summary

MissionBoard P0 lands as a **real, schema-validated coordination board** on `Thread.mission_board` (not a prompt-only “fake board”, not a second store under `~/.cmspark-agent/boards/`). It sits **on top of** Pack (ADR-014) and multi-agent (ADR-015): workers never host the canonical board; structured `collect_handback` folds into the parent/host; `board_complete` is L2 Confirm Center only with a hard `canComplete` predicate.

| Layer | Status |
|-------|--------|
| **Task 1** — ADR-016 Accepted + Appendix A must_fix | **Delivered** (`319ce7e`) |
| **Task 2** — Schema + `mutateMissionBoard` + host rules + audit | **Delivered** (`aae5536`) |
| **Task 3** — Structured handback + AppSec pack + `board_complete` | **Delivered** (`2fad77f` + `bfeeb5e`) |
| **Code-gate must_fix** (G3–G6/G9/G12/G13) | **Closed** (`bfeeb5e`) |
| Stage 2 measurement / Stage 3 Intent claim / Stage 4 UI | **Deferred** (this note) |

**Final verify** `[executed]` @ worktree 2026-07-27:

| Check | Result |
|-------|--------|
| `npx tsc --noEmit -p companion/tsconfig.json` | **pass** (exit 0) |
| `npx tsc -p companion/tsconfig.test.json` | **pass** (exit 0) |
| Board tests (`board-schema`, `board-service`, `board-collect-handback`, `board-complete`) | **all pass** |
| Orchestrator tests (`orchestrator-tab-lease`, `orchestrator-l2-flight`) | **all pass** (ADR-015 no regression) |
| Combined targeted run | **84 pass / 0 fail** |

---

## 2. What shipped

### 2.1 Kernel (Task 2)

| Item | Location / notes |
|------|------------------|
| Zod schema authority + `BOARD_CAPS` (facts 200 / intents 50 / hints 50 / claim 2k / board JSON 512k) | `companion/src/board/schema.ts` |
| `Thread.mission_board` + `board_mode`; defaults null/false | `companion/src/threads/thread-manager.ts` |
| Single write path `mutateMissionBoard` under `withThreadLock` | `companion/src/board/service.ts` |
| Host = orchestrator parent **or** sole single-thread; **workers never host** | `isBoardHostThread`; worker `tm.update({ mission_board })` throws |
| Server-stamp `provenance` / `trust` / `actor_type` / ids (G1) | strip client values; re-stamp from acting context |
| Non-user `user_confirmed` → **REJECT** + `board.trust_rejected` (G2) | no silent demote |
| `tool_verified` requires resolvable `tool_call_id` (G3) | unit + **prod** `resolveToolCallFromThreadMessages` on live collect |
| Audit events `board.*` into capability audit stream | ensure / handback / trust / complete / abandon |
| AGPL paper trail (G14) | `THIRD_PARTY_NOTICES` + `docs/licenses/cairn-inspiration.md`; clean-room comments in `src/board` |

### 2.2 Handback + tools (Task 3)

| Item | Location / notes |
|------|------------------|
| Board-on: prose `collect_handback` → `HANDBACK_MISSING_STRUCTURE` (recoverable) | `server.ts` + service fold |
| Board-off: free-form last-assistant handback **preserved** (ADR-015 compat) | tested |
| Structured JSON merge (facts/intents) into **parent host only** | prefer fenced JSON; exact `schema_version: 1` |
| `empty_ok` only with non-empty summary reason | reject bare empty success |
| Handback idempotency by worker `message_id` | re-collect does not duplicate |
| `complete_proposal` **non-mutating** (G11) | never sets `status` / never auto L2 |
| `board_read` framed projection + trust labels (G4/G12) | `UNTRUSTED_BOARD_*` frames; neutralize delimiter breakout |
| `board_complete` on Path A closed set + `ORCHESTRATOR_TOOL_ALLOWLIST` + `L2_GATE_TOOLS` (G5/G6/G9) | Confirm Center + `security_token`; LLM `user_confirmed` rejected |
| Hard `canComplete` (G5) | supporting ids exist + ≥1 `tool_verified\|user_confirmed` **or** audited `empty_complete` + reason |
| Confirm digest (G6) | goal + trust histogram + claim previews + residual + empty flag |
| Cancel → abandon worker intents on host **before** pending reject + lease release (G13) | `abandonWorkerIntents` wired into cancel/stop path |
| Pack apply/uninstall clears `board_mode=false` when non-board pack | no sticky board mode |

### 2.3 AppSec pack (community)

| Item | Location / notes |
|------|------------------|
| `board_mode: true` on apply | `companion/src/packs/builtin/appsec-prd-review/pack.yaml` |
| `system_prompt_append` ships JSON handback contract + **data ≠ instruction** rule (G4) | shared rule text; no new high-risk tools |
| Tools remain allowlist browser/read skill only | no shell/netsec lift |

### 2.4 Commits (product)

```text
319ce7e docs(mission-board): Accept ADR-016 with decision-gate must_fix
aae5536 feat(mission-board): P0 kernel — schema, thread field, service, audit
2fad77f feat(mission-board): P0 Task 3 — structured collect_handback + AppSec pack
bfeeb5e fix(mission-board): close P0 code-gate must_fix (G3–G6/G9/G12/G13)
```

---

## 3. Gate verdicts

### 3.1 Plan synthesis (pre-ADR)

| Reviewer | Artifact | Verdict |
|----------|----------|---------|
| Claude | `docs/audit/reviews/cairn-mission-board-plan-claude-20260727-131845.md` | **APPROVE_WITH_CHANGES** (~78%) |
| Pi | `docs/audit/reviews/cairn-mission-board-plan-pi-20260727-131845.md` | **APPROVE_WITH_CHANGES** (~82%) |

**Lock**: ADR first → schema + handback hard validation + AppSec pack **same slice**; no fake board; no AGPL vendor.

### 3.2 Decision gate (ADR-016 text)

| Reviewer | Artifact | Initial | After Appendix A must_fix |
|----------|----------|---------|----------------------------|
| Claude | `docs/audit/reviews/mission-board-adr016-gate-claude.md` | **APPROVE_WITH_CHANGES** (72%) | must_fix written into ADR → **Accepted** (`319ce7e`) |
| Pi | `docs/audit/reviews/mission-board-adr016-gate-pi.md` | **APPROVE_WITH_CHANGES** (74%) | same |

Focus of must_fix: server trust stamp, host Thread lock, Path A tool closed set, AGPL controls, cancel→intent order, no empty complete default.

### 3.3 Code gate (Task 2/3 product)

| Reviewer | Artifact | @ `2fad77f` (pre-fix) | After `bfeeb5e` |
|----------|----------|-------------------------|-----------------|
| Claude | `docs/audit/reviews/mission-board-p0-code-gate-claude.md` | **BLOCK** (84%) — G3 partial, G4/G5/G6/G9/G12/G13 fail | must_fix **closed in code + unit tests** |
| Pi | `docs/audit/reviews/mission-board-p0-code-gate-pi.md` | **BLOCK** (88%) — same blocker set | same |

Appendix A scorecard after `bfeeb5e` `[inspected]` + board tests `[executed]`:

| ID | Gate | Post-fix |
|----|------|-----------|
| G1 | Server-stamp trust/provenance | **PASS** |
| G2 | Non-user `user_confirmed` REJECT | **PASS** |
| G3 | `tool_verified` resolvable id (prod wire) | **PASS** (`resolveToolCallFromThreadMessages` on collect) |
| G4 | Delimiter frames + data≠instruction + caps | **PASS** (framed `board_read`/handback; pack rule) |
| G5 | Hard `canComplete` | **PASS** |
| G6 | L2 Confirm digest | **PASS** |
| G7 | Host = orch/sole; workers never | **PASS** |
| G8 | Single `mutateMissionBoard` + lock | **PASS** (WS cannot set board; internal update still possible — residual di) |
| G9 | Path A closed set incl. `board_complete` | **PASS** |
| G10 | Schema caps | **PASS** |
| G11 | `complete_proposal` non-mutating | **PASS** |
| G12 | Export/summary trust labels | **PASS** (framed export path; no Obsidian board export yet) |
| G13 | Cancel → abandon intents before lease release | **PASS** (wired + unit) |
| G14 | AGPL paper trail | **PASS** |
| G15 | Checklist applied | Meta — this ship note is the P0 claim surface |

**Ship claim**: P0 vertical slice is **code-gate must_fix closed** and unit-verified. Formal dual-pass **re-review** of `bfeeb5e` by Claude/Pi CLI is optional; ground truth is Appendix A + green board/orchestrator tests. Stage-1 product success criteria still leave **live AppSec conversation** and **measurement gate** outside this commit (see §5 deferred).

### 3.4 ADR-015 regression

Orchestrator tab-lease + L2-flight suites remain green (84 combined with board). Board-off free-form handback preserved. No new community high-risk tools.

---

## 4. How to try AppSec board

Prereqs: Companion running, extension loaded, Side Panel open. Full pack UI: [docs/mission-pack-usage.md](../../mission-pack-usage.md).

### 4.1 Single-thread (P0 happy path)

1. Side Panel → **任务包** → enable module **`appsec`** if banner shows.
2. Select the working **thread** (this thread is the board host when not multi-agent).
3. Apply pack **「应用安全审查」** (`appsec-prd-review`).  
   - Expect: `board_mode: true`; `mission_board` initialized empty/open (audit `board.ensure` or equivalent).
4. Open a target page (PRD / product page) in Chrome.
5. Ask for a STRIDE / page security review in natural language.
6. Model should emit human-readable findings **and** a fenced JSON handback (`schema_version: 1`, `facts` / `intents`).
7. If multi-agent is not in play, fold is via worker/host paths when using orchestrator; on sole-thread, board tools + structured assistant content still feed the host board through collect / complete paths.
8. Call or allow **`board_read`**: tool result should show **framed** claims (`UNTRUSTED_BOARD_*`) and trust tiers — `llm_asserted` must **not** read as “confirmed”.
9. To finish: orchestrator/host calls **`board_complete`** → Confirm Center L2 shows goal + trust histogram + claim previews → human approve with `security_token`.  
   - Empty board complete only with explicit **`empty_complete`** + reason (audited).  
   - All-`llm_asserted` supporting set without empty path is **rejected** by `canComplete`.

### 4.2 Multi-agent (optional, same board)

1. Promote / run as **orchestrator** thread (ADR-015); spawn Explore worker(s) with AppSec-capable whitelist (spawn remains L2 HITL).
2. Worker returns structured JSON in last assistant message.
3. Orchestrator **`collect_handback`**: prose rejected when board on; structured merge into **parent** only; `tool_verified` only if `tool_call_id` resolves on worker/host recorded tool results.
4. **`board_complete`** only from host (workers rejected).
5. Cancel / stop worker: open intents for that worker → `abandoned` on host **before** lease release.

### 4.3 Quick automated re-check

```bash
cd companion
npx tsc --noEmit -p tsconfig.json
npx tsc -p tsconfig.test.json
node --test \
  .test-dist/tests/board-schema.test.js \
  .test-dist/tests/board-service.test.js \
  .test-dist/tests/board-collect-handback.test.js \
  .test-dist/tests/board-complete.test.js \
  .test-dist/tests/orchestrator-tab-lease.test.js \
  .test-dist/tests/orchestrator-l2-flight.test.js
```

---

## 5. Deferred (not this ship)

| Item | Phase / note |
|------|----------------|
| **Stage 2 measurement gate** — 5–10 real PRD/pages; handback parse rate; hallucination-complete rate | Do **not** expand tool surface / Intent scheduling until measured |
| **Live AppSec E2E** one conversation with `facts.length ≥ 1` or audited empty_complete | Stage-1 success checkbox still manual |
| **Intent claim / heartbeat / abandoned reclaim** multi-agent scheduling | Stage 3 |
| **`spawn_worker` bind `intent_id`** | Stage 3 |
| **Side Panel board UI** (Facts / Open Intents / Hints list + trust badges) | Stage 4 |
| **FleetStrip open-intent badge** | Stage 4 |
| Graph visualization | Post Stage 4 |
| AppSec Pack v2 threat-model depth + severity completion rules | Stage 5 |
| Public `board_add_fact` / `board_add_intent` / WS `board.*` | **Rejected** (Path A non-goal) |
| Obsidian / NotebookLM export of board with trust | G12 minimal path only; full export wiring later |
| Formal Claude/Pi **code re-pass** after `bfeeb5e` | Optional; unit + Appendix A is ship ground truth |
| shared-observer / auto-spawn / full Dashboard | Still deferred per ADR-015 |

---

## 6. Rollback

- Apply a non-board pack or set `board_mode: false` → structured handback requirement off; free-form handback restored.
- Ignore `mission_board` field on older clients.
- No AGPL dependency; no new default high-risk tools → store surface unchanged.

---

## 7. References

| Doc | Role |
|-----|------|
| [ADR-016](../../adr/016-mission-board.md) | Decision + Appendix A hard gates |
| [ADR-015](../../adr/015-multi-agent-orchestrator-tab-lock.md) | Orchestrator / tab lease |
| [ADR-014](../../adr/014-mission-pack-enterprise-modules.md) | Pack / modules |
| [mission-pack-usage.md](../../mission-pack-usage.md) | Operator try path |
| [cairn-inspiration.md](../../licenses/cairn-inspiration.md) | Ideas vs non-copied artifacts |
| Code gates | `docs/audit/reviews/mission-board-p0-code-gate-*.md` |
| Decision gates | `docs/audit/reviews/mission-board-adr016-gate-*.md` |

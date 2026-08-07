# Correctness Lane — S52 post-ship multi-adv
**Range**: 14e1b28..d34bac2
**Recommendation**: PASS_WITH_NITS
**Status**: WATCH

## Findings

### F1 — Severity: LOW (structural residual)
- File: companion/src/llm/adapter.ts:559-602
- Status: OPEN
- Description: Mid-loop M2 re-attach is nested inside the same `try` as meta persistence (`threadManager.get` / `update`). If anything in that block throws *before* `attachRollingSummaryToMessages` (e.g. unexpected throw from `get`/`update` plumbing), the catch swallows it and the request stays on plain M1 omit while the outer logger/`thread.context_compacted` still report `mode: "m1"`. In normal paths `get`/`attach` do not throw; residual is coupling, not a demonstrated production failure.
- Evidence: [inspected] re-attach at L571-580 is inside the meta `try` that ends at L600-602 with empty catch; LLM `messages` mutation is not guarded separately from meta I/O.

### F2 — Severity: LOW (observability / dead code)
- File: companion/src/llm/adapter.ts:587
- Status: OPEN
- Description: Meta write uses `mode: keepSummary && mode === "m1" && phase === "mid_loop" ? "m2" : mode` after the re-attach branch already assigns `mode = "m2"`. The ternary is dead under current control flow. Harmless, but suggests dual writers for the same label and could diverge if someone reorders the re-attach block later.
- Evidence: [inspected] L571-577 sets `mode = "m2"` before L584-595; ternary condition `mode === "m1"` is then false whenever re-attach ran.

### F3 — Severity: LOW (test fidelity)
- File: companion/tests/context-budget.test.ts:154-196
- Status: OPEN
- Description: “S51 P0 mid_loop re-attach” unit test only composes `compactMessagesTurnSafe` + `attachRollingSummaryToMessages`. It does **not** exercise `runContextBudgetPass` (prevMeta keep, mode flip, `thread.context_compacted` payload, meta dual-truth). A regression that only broke the adapter orchestration (e.g. re-attach behind a wrong condition, or mode left as m1 on the WS event) would still pass this test. Prior S51 meta wipe was exactly an orchestration bug.
- Evidence: [inspected] test never imports adapter / mocks ThreadManager; pure two-pass transform only. `shouldRunM2(..., "mid_loop") === false` is covered separately L247-261.

### F4 — Severity: LOW (packaging residual)
- File: scripts/installer.nsi:10-11; scripts/build-windows-exe.ps1:41-45
- Status: OPEN
- Description: (1) NSIS still has hardcoded fallback `PRODUCT_VERSION "0.4.0"` when built without `/DPRODUCT_VERSION=` — preferred path injects SoT correctly, but manual `makensis scripts/installer.nsi` can ship stale version after a bump if fallback is not updated. (2) Extension vs companion version mismatch is `Write-Warning` only, not fail-closed — a drifted MV3 manifest can ship with a matching companion zip name.
- Evidence: [inspected] `!ifndef PRODUCT_VERSION` fallback L10-11; ps1 cross-check L41-45 warning only. Gates assert injection machinery exists, not dynamic equality of fallback ↔ package.json.

### F5 — Severity: INFO (prior residual, now fixed at tip)
- File: companion/src/packs/pack-engine.ts:411-419
- Status: CONFIRMED_FIXED
- Description: Pre-S51 adversarial residual claimed hard-delete of a trashed row that still holds a cookie would re-restore cruise if `thread.list` never cleared it. At tip, `alreadyTrashed` skips `restoreTrustFromThreadCookie` and only clears journal + cookie. Migration test asserts cruise stays OFF.
- Evidence: [inspected] L413-419; test `S51 migration: pre-fix trash cookie...` packs-engine.test.ts:550-620.

### F6 — Severity: INFO (by design, not a defect)
- File: companion/src/llm/adapter.ts:570-580; companion/src/llm/context-budget-m2.ts:88-89
- Status: OPEN (documented residual)
- Description: Re-attached summary is the **pre_loop** M2 text; mid_loop head-drops (large tool results) are not re-summarized (`shouldRunM2` always false for mid_loop). Mode is labeled `m2` for UI/meta even though content is stale relative to the latest drop set. Preferable to wiping M2; operators should not treat mid_loop `mode:m2` as “fresh summary of this compact pass.”
- Evidence: [inspected] intentional latency trade-off; re-attach uses `prevMeta.rolling_summary` / `keepSummary` without regenerating.

---

## P0-2 re-verify (mid_loop M2)

- **Verdict**: FIXED
- **Evidence** [inspected]:
  1. **Re-attach path**: After mid_loop M1 compact (`shouldRunM2` false → no new generate), `keepSummary` is `rollingSummary || prevMeta?.rolling_summary` (L561-563). When `phase === "mid_loop" && keepSummary && mode === "m1"`, adapter calls `attachRollingSummaryToMessages(messages, compact.droppedCount, keepSummary)`, sets `mode = "m2"`, `rollingSummary = keepSummary`, and restores sha/bytes (L571-580).
  2. **No double notices**: `compactMessagesTurnSafe` strips all omit/summary notices then inserts exactly one plain omit (context-budget.ts:281-288). `attachRollingSummaryToMessages` finds `isOmitNotice` and **replaces in-place** (L335-338); only splices if none found. Unit test asserts `filter(isOmitNotice).length === 1` and `[context_summary]` + prior bullets retained.
  3. **Meta dual-truth**: Meta write uses `rolling_summary: keepSummary || rollingSummary` and mode upgraded to m2 on re-attach path; does not wipe prior summary on mid_loop M1 (the S51 dual-write hole). After re-attach, `rollingSummary` is also set so `thread.context_compacted` event (L622-630) carries `mode: "m2"` and `rolling_summary` — UI modal and request path agree.
  4. **Request consumption**: `messages` is mutated before the next LLM round; mid_loop pass is awaited at adapter.ts:1188 after tool results are pushed.
  5. **Gap**: No adapter-level integration test (see F3); static path is correct.

---

## Trust release re-verify

- **Idempotency**: `releaseTrustBeforeThreadGone` restores (if not already trashed) then clears `mission_pack_trust_snapshot` via `threadManager.update` (or in-place fallback). Second call hits `!isPackTrustSnapshot` → `false`. [inspected] pack-engine.ts:409-444; packs-engine.test.ts:468-473.
- **trash → Settings OFF → hard-delete**: Soft path release+clear, user flips cruise OFF, hard path second release returns false, cruise stays false. [inspected] test L481-547.
- **alreadyTrashed / migration**: Cookie present + `trashed_at` set → clear without restore; cruise stays false. [inspected] L411-419 + test L550-620.
- **A/B clobber**: Trash A (release+clear) → apply B elevates → hard-delete A no-ops; B cruise remains true. [inspected] test L623-679. `findOtherTrustHolders` uses non-trashed `list()` so B apply is allowed after A trash.
- **Call sites pass TM**: `thread.delete`, `batch_delete`, `cleanup_empty` all pass `threadManager`. [inspected] message-router.ts:1193, 1259, 1355.
- **List sweep**: `clearTrustCookieWithoutRestore` on `only_trashed` before `purgeExpiredTrash` — no re-restore; no unit test of the helper itself (coverage gap only). [inspected] message-router.ts:1388-1405.
- **Single hard-delete broadcast**: `thread.deleted` mode hard on single-delete path (multi-panel sync). [inspected] L1206-1210.

---

## Packaging scripts correctness

| Check | Verdict | Notes |
| --- | --- | --- |
| companion/package.json SoT for package.sh / create-dmg / ps1 | PASS | node/ps1 read version from companion package.json |
| Info.plist stamp | PASS | `__CMSPARK_VERSION__` + post-stamp grep fail-closed |
| create-dmg no `s/0.2.0/` trap | PASS | gates assert |
| ps1 injects `/DPRODUCT_VERSION=` into NSIS | PASS | preferred path |
| NSIS fallback hardcode | WATCH | F4 — manual makensis drift |
| Ext version lock-step | WATCH | warning only (F4); both currently 0.4.0 |
| Gates | PASS for machinery | static string checks; do not assert live version equality |

---

## Test coverage gaps

- No orchestration test for `runContextBudgetPass` mid_loop: seed `runtime_context_budget.rolling_summary`, force mid compact, assert request message has `[context_summary]` + event/meta `mode: "m2"` (F3).
- No direct unit test for `clearTrustCookieWithoutRestore` or message-router `thread.list` trash sweep (manual path covered only via release migration tests).
- No test that `threadManager.update` persistence of null cookie survives subsequent `trash()` (static inspection shows trash only sets `trashed_at` — OK).
- Packaging gates do not fail if NSIS fallback ≠ companion version or if extension version drifts.
- Trust tests correctly call release APIs directly (good); they do not go through full `handleMessage` WS handlers (acceptable for unit scope).

---

## Summary

S52 tip correctly closes the two user-facing correctness holes in scope:

1. **mid_loop M2**: Prior rolling summary is re-attached into the LLM request (not only meta/UI), with single notice replacement and mode/event alignment → **P0-2 FIXED**.
2. **Trust trash cookie**: Release is restore-then-clear, idempotent, skips restore when already trashed, and tests cover Settings flip + A/B clobber + migration → **Trust P0 FIXED**.

Remaining issues are low-severity: re-attach coupled to meta try, dead mode ternary, thin adapter orchestration tests (tests can pass for the pure helper while adapter regresses), and packaging fallback/warning soft gates. No incomplete error path that re-elevates cruise or double-fires restore under the documented lifecycle. No wrong-mode dual-truth between request and meta on the happy path after re-attach.

**Recommendation**: **PASS_WITH_NITS** — ship-quality for P0; tighten F3 test and optionally fail-closed packaging version drift when convenient.

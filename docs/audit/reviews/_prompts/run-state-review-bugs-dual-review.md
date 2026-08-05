# Dual external re-review: run-state review-bugs (PR #117 post-merge fixes)

**Stage:** Code implementation (T3 Trust)  
**Date:** 2026-08-05  
**Batch id:** `run-state-review-bugs`  
**Branch:** `fix/run-state-review-bugs` (working tree; may be uncommitted)  
**Base:** `origin/main` @ `4a2d02f`  
**Prior multi-adversarial:** all 4 lanes **APPROVE_WITH_NITS** — see synthesis below  

## Required reading

1. **Adversary synthesis (mandatory)**  
   `docs/audit/reviews/run-state-review-bugs-adversary-synthesis-20260805.md`

2. **Lane reports (skim; do not rubber-stamp)**  
   - `docs/audit/reviews/run-state-review-bugs-lane-security-20260805.md`  
   - `docs/audit/reviews/run-state-review-bugs-lane-correctness-20260805.md`  
   - `docs/audit/reviews/run-state-review-bugs-lane-architecture-20260805.md`  
   - `docs/audit/reviews/run-state-review-bugs-lane-compat-20260805.md`

3. **Diff**  
   `docs/audit/reviews/run-state-review-bugs-diff-20260805-090257.patch`  
   Also re-run `git diff origin/main` / `git status` yourself.

4. **Live source (file:line)**  
   - `companion/src/server.ts` — `userFullAutonomy` + `forceConfirm` algebra  
   - `companion/src/computer/executor.ts` — `reL2` cruise vs `forceInteractive` / `reL2ShouldPrompt`  
   - `companion/src/orchestrator/fleet.ts` — `open_intents_by_run`  
   - `chrome-extension/src/sidepanel/utils/thread-busy.ts` — `resolveOpenIntentsForRun`  
   - `App.tsx` / `ChatView.tsx` / `RunBusyChip.tsx` / `useWebSocket.ts`  
   - Tests: `security-gates.test.ts`, `computer-executor.test.ts`, `thread-busy.test.ts`, `orchestrator-tab-lease.test.ts`

5. **Checklist**  
   `docs/audit/reviews/_templates/dual-review-capability-checklist.md`

## Capability declaration (implementer)

```text
Surface:      n/a (no new tools)
L2-classes:   (none new; restores critical forceConfirm floors)
Compose:      fleet snapshot additive field open_intents_by_run
Autonomy:     multi-worker RunBusy honesty; three-flag cruise residual elevation
Trust:        monotonic restore M3' domain≠content; danger re-L2 always HITL under cruise
Channel:      community
```

## Product claims under review

1. Full-autonomy **three-flag** cruise does **not** auto-approve re-L2 for `computer.danger_detected` / `computer.experimental_suggestion` (and still prompts for other `reL2ShouldPrompt` true tags).  
2. Critical forceConfirm for evaluate/osascript (and other criticalApis) is waived **only** when all three flags are on — **not** under domain whitelist alone, god-mode alone, or `auto_approve_dangerous` alone.  
3. When active thread has `orchestrator_run_id`, RunBusy uses run-scoped open intents; **does not** fall back to process-wide `open_intent_count`.  
4. Tests assert the restored floors (partial flags forceConfirm) and three-flag waive paths.  
5. **Not claiming**: default-on cruise; autopilot matrix copy refresh; complete FocusBand process-wide intent cleanup.

## Your job

Independent **security + correctness + design-fidelity** re-review of the **diff**.

1. **Do not rubber-stamp** multi-adv synthesis. Confirm or refute each claim with file:line.  
2. Hunt residual bypasses:
   - Partial-flag skip of critical evaluate  
   - Cruise still silencing danger/experimental  
   - `enterpriseSkip` / `hostComputerTrustSkip` interaction that re-opens holes  
   - Host without `orchestrator_run_id` sticky intent edge  
3. Trust monotonicity: this change should **restore** floors, not invent new elevation except keeping three-flag product residual.  
4. Tests: are inverted M3' cases real? Is the stale section banner (adversary N1) blocking or nit?  
5. Apply ADR-020 checklist.  
6. Prefer executing targeted tests if tools allow:
   - `security-gates` M3'/full-autonomy patterns  
   - `computer-executor` danger under cruise  
   - `thread-busy` resolveOpenIntentsForRun  
   - fleet open_intents_by_run  

## Verdict rules

- **REJECT** if confirmed HIGH: partial-flag critical waive still present; cruise skips danger re-L2; forceConfirm algebra wrong; intentional security floor missing without explicit HANDOFF.  
- **APPROVE_WITH_NITS** if floors restored with non-blocking nits (stale comments/banners, FocusBand process-wide intents, matrix copy, missing positive budget cruise test).  
- **APPROVE** only if ready to merge with no nits worth tracking.

End with exactly one line:

VERDICT: APPROVE  
or  
VERDICT: APPROVE_WITH_NITS  
or  
VERDICT: REJECT  

# Cooperation failure recovery (#612)

## Evidence and scope

Issue: https://github.com/nehcuh/cmspark/issues/612. Office prerequisite landed in PR #617, base `c570cb80c5799057e067ae0b55e6a3e4548288c3`.

Archived vw2ob1 evidence shows three failed workers followed by three rejected `cooperation_review` calls and the existing parent circuit breaker. Worker scripts and raw parameters are unavailable; legitimate null completions are a separately reproduced defect, not a proven explanation of those historical scripts.

## Implementation plan

1. `companion/src/orchestrator/cooperation-plan.ts`: accept all-negative review only when both current runtime and collected result are failed. Keep all current owner/run/attempt/source/settlement/reference validation. Failure stays unaccepted and cannot unlock dependants. Expose a pure current planned-attempt recovery clamp; repair same-version checkpoint recovery without invalidating unchanged decisions; clamp nested snapshot results.
2. `companion/src/orchestrator/cooperation-state.ts`: apply the plan clamp after existing worker recovery accounting, during idempotent recollection, and in snapshots. Preserve failure versions, ACP/unplanned semantics and paused/blocked/cancelled/recollect actions. Exhausted retry suggestions become `revise_plan`. Three attempts limit worker creation/replacement, not explicit user continuation of an existing worker.
3. Update the existing cooperation tool description to document failed negative review and bounded recovery.
4. `chrome-extension/src/background/browser-bridge.ts` and `companion/src/tool/site-op-memory.ts`: preserve genuine host-produced typed null/undefined completion across JSON transport. Malformed/untyped empty results, exceptions and dead worlds remain failures. The probe never reexecutes the original expression. Existing site bans and generic circuit breaker thresholds remain intact.
5. Extend existing cooperation plan/state, browser bridge and site memory tests using real dispatch/producer results. Add a cross-boundary regression using actual bridge results after JSON serialization.

## Observable acceptance

- Three distinct failed workers can receive negative review without producing the parent review-loop failure; each remains failed/unaccepted and dependent tasks blocked.
- Failed positive/mixed review, stale source, stale attempt, uncollected or unsettled execution, foreign ownership, launch failure whose collected status is `ready`, paused/cancelled/security-blocked workers remain rejected.
- No cache, plan checkpoint, nested snapshot or reloaded projection advertises retry budget beyond remaining planned creation attempts; no budget increase or automatic execution.
- Genuine null and undefined completion succeed once and do not accrue site failure counts; malformed empty output, real throw/dead world, and existing third-operation bans continue to fail.
- Complete relevant host suites, three fresh production reproductions, Linux ARM64 validation and builds. Independent adversary then Pi rereview of the same full diff, plus Kimi and all required CI green, before merging. T3 blast radius.

No production configuration changes, automatic retries, threshold increases or new grants are part of this batch.

## Capability declaration (ADR-020)

Surface: existing cooperation tools and browser evaluation result handling. L2 classes: no new tools or approval bypass; worker spawn still requires existing confirmation. Compose: current producer result → persisted plan/cache → negative review or existing recovery advice. Autonomy: record failed criteria only; no automatic worker replacement. Trust: all owner/run/attempt/source/execution/ref checks remain, failed results cannot become accepted; only authenticated host-produced completion metadata is recognized. Channel: existing Companion/extension bridge and existing tool result envelope. Blast tier: T3.

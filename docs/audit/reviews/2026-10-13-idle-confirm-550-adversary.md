# Independent adversarial component review — #550

Reviewer: Codex subagent `/root/itcra_ui_diagnosis`, non-implementer. Read-only source/necessary isolated probes; no product-file modification, live configuration, private data or GitHub action.

Base: `e44af42f0f3999f23306e41159edb8b12e3dbdff`.
Worktree: `/Users/huchen/.codex/worktrees/issue-convergence/cmspark`.
FULL diff SHA256: `6cb049b0491f1cf03ff0e58a5c1bcb2fb5ffb4a8336ec9ec5eea946aa4c35c5e` (independently matched actual git diff).
FULL context packet SHA256: `50f4691ac9acbb7fd150c0e81fd6ed5f7cabeec79ec7f8697688ab052de2ac0b`.

Scope reviewed: complete patch, complete tab-lease source and complete orchestrator-tab-lease test source from context.md, adjacent production hook registration in server.ts, Fleet snapshot ordering and lease constants. The change is one additional guard on the idle-worker/Fleet cleanup path plus three regression cases. T3 conservative classification is appropriate: it touches an existing ownership gate, adds no dispatch/approval authority, changes no confirmation timeout or max-lease cap.

## Outcome

No reproducible newly introduced P0/P1/P2 defect found. New guard correctly keeps exclusive SOFT_RESERVED and HELD_PENDING_L2 ownership while actual human confirmation remains live, and is scoped to those two states. Truly idle/no-confirm cleanup remains active; explicit denial/cancellation remains independent of this idle-read guard. Existing mutation/create/CDP protections are evaluated first and remain intact.

## Adversarial paths examined

- **Live-confirm exclusivity:** exact confirm ID and holder are passed to existing hook. Both states keep the original holder; another worker cannot acquire that tab. When live confirmation becomes false and other holds are absent, idle cleanup releases it.
- **Production hook visibility:** server registers hasPendingForTab, reject/discard hooks and hasPendingConfirmation together. It first checks pending confirm ID, then worker ownership fallback. Completely unregistered hooks remain fail-closed earlier in resolveHasPending. The optional absent confirmation hook means false in the existing helper; no production partially registered hook path was found. This is not claimed to be a new arbitrary-hook security mechanism.
- **Hook exception:** existing keepSoftForLiveConfirm catches registry exceptions and retains the lease. A failed hook cannot silently unlock a rival's write lease. Explicit cancellation can still free the lease afterward; it does not call the new idle guard.
- **Hard cap:** keepSoftForLiveConfirm never writes hardMaxDeadline. Existing HARD/HELD_PENDING_L2 sweeps still apply that cap; independent fake-clock probe confirmed HELD_PENDING_L2 frees after its unchanged cap even with a live confirmation predicate. Do not overclaim new all-state absolute-cap behavior: existing SOFT sweep is governed by its confirmation/soft predicate, and this patch does not redesign it.
- **Soft timestamp interpretation:** reused helper writes softDeadline=t+skew, so an early idle snapshot may reduce an originally later numeric soft deadline. This is not a monotonic TTL extension. Actual live confirmation remains the governing predicate, the 45-second human confirmation timer is unchanged, and once confirmation ends the DoD intentionally allows ordinary idle release. No incorrect authorization/ownership transition was established from this timestamp detail. Avoid describing the patch as increasing the confirmation window.
- **Cancellation/zombie response:** releaseLeasesForThreadPendingAware/releaseTabLease remain separate, deliberately stronger cancellation operations. After explicit cancel, hardReacquireAfterConfirm refuses POST_CONFIRM_CANCELLED and cannot recreate a FREE lease. The guard does not change pending-drain/FORCE_RELEASING paths.
- **Scope/mutation/create/CDP:** no table/state/constant/schema changes. Existing pending/mutation/create holds still suppress idle cleanup, hard-max pending drain remains unchanged, and worker active/paused predicates still skip cleanup before per-lease checks. Production Fleet cleanup then listTabLocks/sweep remains the existing sequence.

## Independent verification

Ran nvm use22 (Node22.23.2) and the canonical Companion runner on existing compiled exact-source fixtures:

`node scripts/run-tests.mjs .test-dist/tests/orchestrator-tab-lease.test.js .test-dist/tests/orchestrator-l2-flight.test.js`

**61 passed / 0 failed / 0 skipped**, exit0. These include the three new regressions, rival exclusion, post-confirm cancellation, current hard-max pending drain, mutation/create/CDP guards, cold hook failure and Fleet active-set failure cases.

Additionally ran an isolated fake-clock probe against the compiled production lease module with a fresh temporary CMSPARK_DATA_DIR (removed afterward), no live files:

1. SOFT_RESERVED: unchanged hardMaxDeadline, rival denied, explicit cancellation frees, zombie approval rejected.
2. HELD_PENDING_L2: same four assertions.
3. HELD_PENDING_L2: unchanged hard-cap expiry frees despite live-confirm hook.
4. Throwing confirm hook: idle cleanup retains but explicit cancellation still works.

All four probe trajectories passed. No direct unisolated node --test invocation or product edit was used.

## Supplied machine evidence and remaining gates

Frozen card reports baseline new regression run **43 tests /40 passed/3 failed**, demonstrating meaningful red cases; fixed full host canonical **5885 tests /5833 passed/52 existing skips/0 failed**, host exit0/build0. Those full counts are attributed supplied evidence, not this lane's rerun. Linux fresh snapshot was still `linux_pending:true` at review time. This source component verdict does not substitute prior-source Linux results or fresh CI/merge gates; root must append final same-diff Linux evidence and complete the standard review/CI sequence before landing.

No required implementation/test nit identified for this minimal batch. Deadline commentary above clarifies existing semantics and bounds the claim; it is not a request to expand #550 into a lease redesign.

VERDICT: APPROVE

# #758 independent adversarial review — cycle 2

Reviewer: independent non-author Codex agent `/root/platform_adversary_758`; 2026-10-22. Incremental review of the single confirmed P2 repair; the full cycle-1 report and its review of unchanged source remain applicable. Base `57b808651dccede3555ac64ebbd45aead393ab73`; frozen full staged delta `/tmp/cmspark-758-review-r2.diff`, independently verified SHA-256 `42f177f1070d293a44774e7076d31f42233e4f999718b5505876f820bdea15b4`.

## Confirmed repair

The standalone Windows notification resource omission is fixed. `companion/src/activity/notifications.ts` now resolves a fixed `activity-bin` resource adjacent to the executable or flattened JS before any development package lookup. Its development fallback explicitly uses filesystem `createRequire(__filename)`; the offending bare embedder `require.resolve` is gone. Existing fixed generic notification arguments, actual child exit semantics, failure/unknown outcomes and private task-content exclusion are retained.

The new `scripts/stage-activity-notifier.mjs` resolves the actual locked notifier package, validates both executable files and LICENSE before creating output, then copies those exact bytes into `activity-bin`. Both supported producers invoke it: `scripts/package.sh` in its Windows arm and `scripts/build-windows-exe.ps1` with explicit nonzero failure handling. The pure JS notifier remains bundled; no externalization, permission or runtime capability expansion was introduced.

The new `scripts/tests/activity-notifier-package.test.cjs` uses real esbuild output in an independent directory outside project `node_modules`, exercises the actual resolver, verifies absent-resource rejection, runs the actual staging producer, compares both binaries and LICENSE byte-for-byte, verifies successful exact-path resolution, deletes the resources and requires failure again. Invalid source also refuses without creating the destination. The main CI build invokes this regression. This directly addresses the deployment-consumer gap missed by the development/native `.test-dist` controls.

## Independent verification

On Node22.23.2, in a clean environment, executed:

```bash
node --test scripts/tests/activity-notifier-package.test.cjs
git diff --cached --check
```

Results: **1 PASS / 0 FAIL / 0 CANCEL / 0 SKIP**, exit 0; diff check exit 0. No executable notification binary was launched. Re-read the appended machine evidence and preserved cycle-1 failure. The macOS fixture fix canonicalizes its owned temporary root at creation and retains strict path comparison; it does not weaken source identity or the missing-resource negative controls.

## Outcome / trajectory / component

- **Outcome:** the only cycle-1 blocker is resolved for the stated resource-closure contract. The independent bundle test proves staging and resolver behavior, not Windows PE execution or visible delivery.
- **Trajectory:** one bounded fix addresses the demonstrated defect, retains the original RED evidence and leaves unrelated production boundaries unchanged. Cycle 2 of the maximum 3; no further source blocker or actionable nit found.
- **Component:** reviewed resolver, staging helper, both package entry points, regression and its CI invocation. The original complete platform review is reused for unchanged capture, OCR, authentication, import and todo behavior.

Capability remains T3 read-only selected-window capture with local OCR, separate model consent and human confirmation. This verdict permits proceeding to Pi review and then exact-head platform CI. **Windows native DoD is still pending hosted execution**; this report does not certify merge-readiness, an actual SEA runtime launch, real GNOME/KDE locks, real chat accuracy, or a human seeing a notification. Pi must read both full adversary reports and the same frozen updated delta; prior platform gates remain required.

VERDICT: APPROVE

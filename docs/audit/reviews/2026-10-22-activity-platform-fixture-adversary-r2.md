# #758 owned WPF fixture — P2 closure review

Reviewer: independent non-author `/root/platform_adversary_758`; 2026-10-22. Bounded incremental review of the sole compiler-close blocker in the preserved initial REJECT report. Base `e2f661e302623090bbd25d175cbd49c6d58a101b`; reviewed frozen complete diff `/tmp/cmspark-758-fixture-rethink-r2.diff`, independently verified SHA-256 `16a46aa1e42b93938eb8bd9d6f5da724e145becfbdd5b3b9075bb117dad50096`. No delegation, implementation edits, CI launch or desktop operation.

The confirmed P2 is resolved. `runOwnedCompiler758` retains the actual Promise returned by the real promisified `execFile`, registers a Promise on that child's actual `close` before awaiting the operation, and joins close in `finally`. Therefore an abort/error rejection cannot return to `buildOwnedWpf758`'s output cleanup, controller directory removal or surface callback completion before the compiler child actually closes. The original rejection remains the result; no replacement success or timeout extension is introduced. A synchronous producer throw propagates directly without inventing a child/close receipt.

The default compiler is now this joined producer. Compiler argv, fixed Framework64 source/references, 10-second compile timeout within the existing 90-second case, 10-second readiness wait, buffer limit, signal and hide-window settings are unchanged from the first review. Product, UI, packaging, workflow, original native assertions and GUI close/lease behavior remain unchanged. The initial architectural/C# assessment is reused; no new concrete blocker found.

The added control uses **real execFile and actual owned Node child events**, despite injecting the start boundary for observability. Across three bounded CPU comparisons, the old producer rejects while `close=false`; the actual new helper rejects only after `close=true`. This is an appropriate process-lifecycle regression and does not mislabel its inert compiler files or Node process as a compiled C# binary, GUI or Windows acceptance.

Independent clean-environment Node22.23.2 execution through the canonical runner:

```bash
node scripts/run-tests.mjs \
  .test-dist/tests/activity-fixture-observation-758.test.js \
  .test-dist/tests/activity-platform-758.test.js \
  .test-dist/tests/activity-752.test.js
git diff --cached --check
```

**46 PASS / 0 FAIL / 0 CANCEL / 0 SKIP**, exit 0; diff check exit 0. Independent retained log `/tmp/cmspark-758-fixture-adversary-r2-controls.log`. The original REJECT and preparation filename mistake remain disclosed, not converted into product/native evidence.

Outcome: the demonstrated compiler cleanup/lease ordering gap is closed. Trajectory: one causal test-only repair and actual-process control, without unrelated #723 experimentation. Component: the joined default producer now supports the explicit compiler-close DoD while retaining failure and cleanup semantics.

T1 capability is unchanged: test-owned GUI in GHA Windows only, no added user tool/L2/autonomy/trust/channel; existing T3 product/main approvals are reused for unchanged source. This permits the planned **single changed-head native acceptance**. Actual C# compilation, GUI readiness and current Windows product native results are still NOT_RUN locally, earlier readiness causes remain UNKNOWN, and neither this approval nor a future isolated #758 pass waives the known main #723 gate or full merge conditions.

VERDICT: APPROVE

# #758 Windows fixture observation — independent bounded review

Reviewer: non-author Codex agent `/root/platform_adversary_758`; 2026-10-22. Base `ef5ead11119894a2879ba0ff2e99dfc75230252c`; final reviewed diff `/tmp/cmspark-758-observer-final.diff`, independently verified SHA-256 `0b2ef7afdc0f05a95d30b000b4a15c8388d58801c1632244756e076ebd3465ef`.

Scope is T1 test observability: three test/fixture files and the preserved CI evidence document. No production or workflow modification. Original T3 source reviews remain applicable to unchanged bytes. This report does not diagnose or claim to fix the actual Windows `OWNED_ACTIVITY_FIXTURE_NOT_READY` failure.

The native controller now drains the owned child stderr continuously while retaining only its first 4KiB. Fixed phase values are last observations, not readiness or causation. The owned PowerShell fixture publishes an atomic first-failure receipt containing phase, exception type/HResult and a message capped at 512 characters. Setup failures still exit nonzero; caught UI event failures record failure and close. Existing activation/focus calls belong to the original owned fixture and are unchanged; no rescue activation or product-side input was added.

The final controller's close path calls `check(false)`: it can preserve an existing first-failure receipt but cannot accept readiness after observing child close. The author detected this distinction in the initial observer version, retained the actual failing control and corrected it before this approval. A filesystem callback now explicitly invokes `check()` so its event argument cannot be mistaken for the boolean option. Completion still unsubscribes close/abort/watch observers and clears the original timer.

Reviewed that the **10-second readiness and 90-second native-test budgets**, HWND/PID/foreground and local OCR assertions, occlusion/minimized refusal, notification assertion, and release only after actual child close are unchanged. The observer does not waive failure, expand permissions, change platform conditions or modify CI. It provides additional evidence for a subsequent changed-head Windows run; an unchanged retry is not a proposed fix.

Independent clean-environment Node22.23.2 execution through the canonical runner:

```bash
node scripts/run-tests.mjs \
  .test-dist/tests/activity-fixture-observation-758.test.js \
  .test-dist/tests/activity-platform-758.test.js
git diff --cached --check
```

**15 PASS / 0 FAIL / 0 CANCEL / 0 SKIP**, exit 0; diff check exit 0. Independent log `/tmp/cmspark-758-observer-adversary-final.log`. The three observer controls execute the actual extracted/transpiled controller, proving failure precedence, stderr preservation/unsubscription and rejection of ready-plus-already-observed-close. No native desktop, notification binary, user data, installed app or model was accessed by this review.

Outcome: the final increment preserves refusal semantics while improving finite first-error evidence. Trajectory: the original Windows failure and observer RED are retained rather than explained away or hidden by larger budgets. Component: controller, owned PowerShell fixture and actual-controller CPU controls are consistent; no remaining concrete observer blocker found. Windows runtime cause and original native DoD remain **UNKNOWN / NOT PASSED** pending the real subsequent evidence.

VERDICT: APPROVE

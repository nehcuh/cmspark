I have read `pi-context.md` in full (all 4,960 lines: both complete frozen diffs, all production context, complete r6–r9 adversary reports for both lanes, both complete Kimi reports, the final machine card, and the 22-file manifest), and cross-checked the standalone `adversary-contract.md`, `adversary-security.md`, `kimi.md`, `machine.json`, and `itcra-source-manifest.json`. No source was mutated; no secrets, Cookies, QR pixels, or private pages were accessed.

---

# Joint component adjudication — r9

## 1. Frozen-input verification

| Artifact | Card value | Confirmation |
|---|---|---|
| CMspark diff | `cafbf36c…f42e` | Matches `machine.json`; byte-identical to the r8-approved patch. |
| ITCra diff | `c53d4316…ead4d` | Matches `machine.json`; supersedes r8 `508b1467…`. |
| CMspark base | `0b1be2e5…9f4` | Used by both lanes. |
| ITCra 22-file manifest | embedded + standalone identical | `itcra-source-manifest.json` content matches the packet; r9 contract lane reports all 22 hashes recomputed and matching. |
| Card/manifest hash note | `ebfa49…` vs `27e6ad…` | **Refuted as divergence.** The packet's final "EVIDENCE METADATA CLARIFICATION" confirms `ebfa49…` = `/tmp/itcra-joint-linux-r5/source-manifest.json` (all 1,785 files, both repos), while `27e6ad…` = the 22-file ITCra delivery manifest; the final card now names both. Kimi r9's "manifest mismatch" note predates/overlaps this clarification. |

The inline early "MACHINE CARD" (Linux `in_progress`, truncated real_native_joint) is superseded by the FINAL MACHINE CARD / `machine.json` (Linux ARM64 ITCra 127 pass, Companion 23 pass/build0). Disclosed warnings are pre-existing (Starlette TestClient/httpx deprecation; Linux SDK stdio finalizer) and not suppressed.

## 2. Component verdicts

- **ITCra component — APPROVE (with non-blocking nits).** Every reproducible r6→r8 counterexample is closed in source, with real-producer/real-endpoint regressions. No P0/P1 remains; the residual items below are bounded, UX/robustness or test-coverage gaps, not authority bypasses or unfenced data effects.
- **CMspark component — APPROVE.** The native fixes and review-metadata hardening are correct and hash-unchanged from the previously approved package.

Both r9 adversary lanes (contract and security) independently reached APPROVE; the r9 Kimi review reached APPROVE for both components. I confirm those judgments, and attach the nits in §4.

## 3. Confirmed closures with exact evidence

- **J6-C1 (P1, r6):** config/input invalidators now include `waiting_browser` (`capabilities.py:172`, `main.py` model/scope/cancel/new-job paths) and call `cancel_browser_waits`; `decision_sync` re-reads original job/status/pending-ID association and `job_inputs_current` before claim and again before remote execute. Endpoint test submits an old proof with no intervening wake → 409, no claim, effects 0.
- **J6-C2 (P2, r6):** `orchestration.py` `except BrowserWaiting: raise` before the optional-diagram error handler; Worker persists exact wait IDs and releases the claim; diagram-stage regression resumes only the original diagram, reusing prior completed stages with one open/read.
- **J7-C1 (P2, r7):** central `fence_change_jobs` inside scope PATCH, both upload commits, and successful collector result; 4-parameter endpoint test mutates each sibling, then drives Companion readiness with no Worker wake → no new effect.
- **J8-C1 (P2, r8):** `prepare_operation` now fresh-loads/re-fences after the remote prepare response and again under the final dispatch transaction; `cancel_browser_waits` unions `browser_waits` with **all** ledger operations carrying `job_id`, including handle-less `preparing` rows (`JOB_STOPPED_DURING_PREPARE`). Slow-prepare regression across scope/model/cancel/reclaim asserts 409, retained cancelled handle, zero effects.
- **r6 S1/S2, r7 S3, and Kimi r7 P1-1/P1-2/P2-1/P2-2/P2-4/P2-5:** all repaired — threadpool offload of whole sync workflows + offloaded scrypt; claim/actor/time committed before effect and dispatch-loss committed as `outcome_unknown`/`DECISION_DISPATCH_UNCONFIRMED` with audit retained and no replay; `decision_submitted` metadata suppresses consumed review so close-after-submit does not cancel accepted work; 2 s execute transport timeout bounds the writer-lock hold; `proof()` validates timezone-aware future expiry and pinned `operation_digest`; per-pending-ID dismissal.
- **CMspark #627:** `inspectDocument(policy, rule?: Rule | null)` + `args: [guard.policy, guard.rule ?? null]`; the test asserts `request.args[1] === null` and no `undefined`, and the isolated checker throws `TypeError` on undefined. `publicOperation` exposes only `site.origin/path` and whitelisted `type/name/role/aria-label/data-action`, excluding `element_token` and URL query. Tests assert no private query/target-id leak.

## 4. External Kimi non-blocking P2 labels — assessed against reproduced evidence

I confirm these as **non-blocking**, with one refutation:

1. **`enterprise_open` lacks a post-remote admission recheck (Kimi r9 P2-1; residual of the r8 audit ask).** Confirmed in source: `open_session` stores the row, then POSTs `/sessions` and merges the result with no `job_admission` re-read. **Bounded newly admitted side effect:** the only effect is opening a tab to a URL already inside `policy.navigation`; no read/exfiltration path, sessions carry no `job_id` and are skipped by cancellation, and all subsequent operations are job/lease fenced; session expires ≤8 h. **P2/P3 nit, not blocking.**
2. **Session-type `browser_waits` IDs silently skipped by `cancel_browser_waits` (Kimi r9 P2-2).** Confirmed: `store.get('enterprise_operation', id)` → `None` → `continue`. The Companion protocol has no session-cancel endpoint; the session is left to natural expiry. Safe; test gap only. **P3.**
3. **NaN/non-finite prepare args → 500 not 400 (Kimi r9 P2-4; security-lane item 4).** Confirmed: `canonical(..., allow_nan=False)` raises `ValueError` uncaught in the body-budget check. Fail-closed before any effect; no authority bypass. **P3 robustness.**
4. **Failed decision POST leaves the panel inert until manual 刷新 (Kimi r9 P2-3; security-lane item 3).** Cosmetic; epoch fences are intact and stale decisions cannot execute. **P3 UX.**
5. **Card/manifest hash self-check (Kimi r9).** **Refuted as a real gap** — resolved by the metadata clarification in §1.
6. **Transient Companion 503 at model-driven `enterprise_open`/`prepare` fails the job rather than converting to a bounded wait (Kimi r7 P2-3).** Still a consistency tradeoff: only read-outage keeps the wait; open/prepare 503 is conservatively `outcome_unknown` with no unsafe automatic retry. **P2/P3 documented tradeoff, not a defect.**

## 5. Contract tradeoffs vs newly admitted effects

- **Tradeoffs (not defects):** visible-DOM coverage incomplete / no workbook export; iframe/popup SSO unsupported; no default enterprise domains, unknown sites deny; four-tool legacy adapter does not implement the contract; version/health is not contract discovery; matching offline artifacts still unproven by source tests.
- **Newly admitted effects found at source level:** only the bounded late-open navigation above (already-authorized URL, no data). Human dispatch is fenced by the two-transaction claim and Companion's one-use proof, so no duplicate effect was established. The NaN path is a rejected request, not an admitted effect.

## 6. Overall merge — forbidden

**PR #626 must remain draft and BLOCKED. This component approval does not authorize merge and never waives T4.** Real evidence is partial only: a user-reported scan, native Chrome reaching the configured portal, and a private *calibrated new* session returning ready — with no body/QR/Cookie exported. `same_original_session_resume_verified=false`, `actual_sso_completed=false`, `scan_completed=false`, `post_login_readiness_calibrated=false`, `second_enterprise_principal=false`, `real_case_receipts=false`. This is **not** original-session auto-resume. Missing: actual business documents/qualified business URLs, a second enterprise identity, full 23 P0 receipts, and the T4 human bake-off. The 16 isolated checks are `actual_renderer_with_simulated_chrome_api_adapter` — explicitly not enterprise acceptance. Machine/component success must not be reported as implementation false claim of real acceptance.

---

**VERDICT: APPROVE_WITH_NITS (component only)**

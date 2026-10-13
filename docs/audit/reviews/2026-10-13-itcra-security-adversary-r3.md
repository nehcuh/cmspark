# #618 independent security adversary — round 3

Source decision: REJECT, two confirmed P1 blockers. R2 S4/S5/N1 repairs pass their focused regressions; no residual finding against those repaired branches except the overlapping-login destination case below.

Reviewed base `e44af42f0f3999f23306e41159edb8b12e3dbdff` and full frozen 30-file `/tmp/cmspark-itcra-618-r3.diff`, 2688 lines, SHA256 `7c45896c7ff08b1879e6ba499b803e68ff055a44277cdbb4bbe3a71d7047f9d9`. Hash verified at start/finish. Read complete r3 machine card, complete source diff, actual implementation/test/contract and r2 report context. Original supplied handoff R1–R5, target/acceptance/ownership sections informed the separate delivery assessment below. Subsequent steering restricted this lane to repository materials and synthetic local exercises; no additional private documents were accessed.

Independent non-implementer. No implementation edits, staging, commits, production credentials, real browser sessions or enterprise network targets used. Temporary synthetic data/profile directories used by checks were cleaned. This report is the only authored file. Review tools remained available; the source REJECT is supported by observations, not a review-service availability failure.

## P1 S6 — Authentication writes can undo completed revocation and policy changes across processes

Locations: `companion/src/outbound-mcp/outbound-grants.ts:265`, `:319–320`, `:340–345`; store replacement `:136–137` and `companion/src/io.ts:17–21`. New enterprise dependency: `companion/src/outbound-mcp/enterprise-http.ts:48`; live authority consumer `outbound-grants.ts:381–386`.

`verifyOutboundGrantToken()` loads the entire grant file, authenticates one record, then updates `last_used_at` by saving that old entire file. Another administrator process can complete revocation or a restrictive policy update after the authentication load and before its save/rename. The authentication save replaces the newer file with the old authority, including `revoked_at:null` or the earlier policy revision. Atomic rename prevents torn JSON, not stale-writer rollback. The subsequent supposedly live `requireEnterpriseGrant()` reloads the rolled-back store and accepts it.

An unrelated legacy grant request can undo an enterprise revocation because metadata save contains all records. Enterprise authentication also loses its own concurrent revocation: its extra `requireEnterpriseGrant()` check occurs before the later stale full-file save. Single-thread tests cannot establish this monotonicity. This write pattern predates #618, but the new enterprise authority explicitly relies on it for authenticated REST and live revocation; inherited code does not waive the demonstrated failure.

Externally observable outcome: administrator revoke returns success and is visible on disk, then a concurrent ordinary authentication restores the credential. Further enterprise requests/dispatch rechecks accept the revoked grant. A policy revision rollback can likewise restore earlier authority and make the old session policy digest valid again. This is persistent authority resurrection, not the documented limitation that cancellation cannot roll back an effect already dispatched.

### Independent cross-process reproduction

Used freshly compiled exact r3 modules with Node 22.23.2. Created a fresh temporary `CMSPARK_DATA_DIR` before imports, registered a synthetic `business-a` instance/profile and generated a temporary public authority key. Issued finite enterprise and legacy grants in the same real store. Synthetic tokens stayed in process memory/child environment; they were not printed or passed on command arguments.

The authentication child invoked the actual compiled `verifyOutboundGrantToken()`. A test scheduler shim paused its actual `fs.renameSync` after the production helper had written its temporary metadata snapshot. The separate parent process then invoked actual `revokeOutboundGrant()` against the same file, verified revoked state on disk, and released the child rename. Neither verification logic nor revoke logic was replaced. The shim chooses a valid OS scheduling interleaving; real separate processes perform the two store mutations.

The relevant scheduler code was supplied to the child with `node -e` (no reproduction file written):

```js
const originalRename = fs.renameSync
let paused = false
fs.renameSync = (temporary, destination) => {
  if (destination === syntheticStorePath && !paused) {
    paused = true
    process.send({phase: "before-auth-rename"})
    const cells = new Int32Array(new SharedArrayBuffer(4))
    while (!fs.existsSync(syntheticReleasePath)) Atomics.wait(cells, 0, 0, 10)
  }
  return originalRename(temporary, destination)
}
const auth = actualGrantsModule.verifyOutboundGrantToken(syntheticToken)
process.send({phase: "result", ok: auth.ok})
```

Parent's message handler calls actual revoke, observes the changed record, then writes the temporary release marker. A second run authenticates the enterprise token itself. A third run changes policy revision through the actual atomic JSON helper from a separate process before releasing the authentication write.

Measured results, exit 0:

```json
{"case":"legacy-auth-overwrites-admin-enterprise-revoke","admin_revocation_observed":true,"legacy_auth_ok":true,"revoked_after_auth":false,"enterprise_live_after_auth":true}
{"case":"enterprise-auth-overwrites-own-revoke","auth_ok":true,"revoked_after_auth":false}
{"case":"legacy-auth-overwrites-policy-update","admin_revision_observed":"r2","revision_after_auth":"r1"}
```

All children exited successfully; the isolated namespace and release markers were removed. This independently confirms the root's differently scheduled `timingSafeEqual`/admin-child counterexample.

Repair: stop authentication metadata from rewriting authority snapshots, and make all authority writers participate in a cross-process transaction/locking protocol from reload through mutation/commit. Revocations must remain monotonic and policy updates/issuance must not be lost. Merely reloading immediately before save, locking only rename, or suppressing metadata only for enterprise tokens is insufficient; unrelated legacy writes and concurrent administrator writers remain able to overwrite authority. A separate append-only/non-authority usage record is suitable for best-effort last_used metadata. Add deterministic actual-process tests for legacy and enterprise auth versus revoke/revoke-all/policy change, plus concurrent authority issuance/revocation writers. Verify later live checks continue to reject the revoked grant and retain the newer policy revision.

Confidence: confirmed on real synthetic store with separate OS processes; no real credential or site involved.

## P1 S7 — Overlapping same-origin login scopes retain the previous document instead of the pre-login target

Locations: `chrome-extension/src/background/enterprise-browser.ts:31`, `:111–112` (snapshot history); consumers `companion/src/outbound-mcp/enterprise-service.ts:150–153`, `:249–250`, `:324–330`.

The new onUpdated history accepts navigation URLs only when they are outside the login scope. The contract also supports same-origin QR/login markers with overlapping navigation/login paths. In a modal/SPA login configuration where both scopes include `/app`, every legitimate business URL is excluded from the event history. After observing ready A, navigation to B followed immediately by same-document login at B before a ready-B inspection leaves `last_business_url=A`. The actual inspector correctly reports current URL B and `login_required`, but supplies A as the business destination; service copies it into the pending operation and restores A after login. It can then complete a read using the wrong document, repeating the earlier stale-target failure in the supported overlapping-scope configuration.

The r3 native pre-SSO retention case explicitly resets login scope to disjoint `/login`. It proves that case, not the overlapping configuration. A conservative choice to omit ambiguous history is reasonable; silently returning a stale A destination is the failure.

Focused actual-producer reproduction: bundle actual `enterprise-browser.ts` in memory, use controlled synthetic Chrome APIs, configure navigation/evidence/login all as origin `https://synthetic.invalid`, path `/app`, and visible ready/login markers. Open/inspect ready `/app/A`, send the actual registered onUpdated callback for `/app/B`, set the same document's current URL to B and its visible marker to login_required, then call the actual `executeEnterpriseBrowser(list_tabs, inspect)` producer before any ready-B inspection. Measured result, exit 0:

```json
{"case":"overlapping-navigation-login-pre-sso-B","state":"login_required","current_url":"https://synthetic.invalid/app/B","last_business_url":"https://synthetic.invalid/app/A"}
```

This is source-producer evidence with a controlled API/DOM adapter; the downstream wrong restore follows the real service's recorded history consumption/frozen-destination branch. A full enterprise SSO interaction was not performed.

Repair: preserve a trusted intended/pre-login business destination for overlapping scopes, or explicitly fail ambiguous restoration rather than substituting an older history entry. Do not treat scope overlap alone as proof that every changed business URL is a login URL. Track verified/intended business navigation and actual login markers through the transition, ensuring the private frozen destination remains B. Add the same-origin overlapping-scope A→B→login→callback trajectory to the actual producer and service tests. Assert restored/read target B and zero replay; missing trustworthy B must produce an explicit failure with no A text.

Confidence: confirmed producer mismatch and exact consuming control flow. The disjoint-login fixes remain valid.

## Repaired r2 findings and other checked boundaries

- S4: `enterprise-service.ts:314` inspects waiting-login metadata without the pending rule. Lines 323–343 restore the frozen destination first, then inspect/bind its click/type target and create a fresh dangerous challenge. Canonical cases cover callback without target for normal click, search type and write; only restoration runs before the dangerous proof, and the signed action runs once afterward. Ready B is frozen at prepare (`:249`); pre-SSO disjoint-scope B history is consumed within navigation bounds (`:150–153`). S7 isolates the remaining overlap failure.
- S5: durable instance registration now requires subject (`enterprise-policy.ts:114–131`), rejects conflicting re-registration/unbound old records, and checks exact subject at issuance/live use (`outbound-grants.ts:186`, `:386`). Actual stored-record mutation and same-business-subject multi-human tests pass. This establishes local binding, not the site's authenticated principal; the latter remains a joint case.
- N1: rebind (`enterprise-service.ts:257`) and completion (`:360`) delete stale error_code. Recovered completed envelopes now omit obsolete READINESS_CHANGED; regression passes.
- R1 target/readiness/expiry repairs remain: per-document ISOLATED WeakMap identity is part of target digest; final effect tick verifies element identity, URL, readiness/login and finite session/approval deadline; cloned nodes, late login, delayed actors and reload/attribute negatives pass. Navigation authority stays separate from evidence export. Raw guard/lookalike/mutated/cross-tool/consumed permits fail at actual executor gates.
- Exact peer/epoch and dispatch-origin result correlation, bounded output/state, grant/session lease identity, single-use Ed25519 purpose separation, cancellation and durable outcome_unknown/restart behavior remain intact in reviewed paths. S6 invalidates the claim that live grant reload alone makes revocation monotonic; it does not forge a permit or human signature.
- Enterprise tool.start payloads remain suppressed; normal logs contain metadata/result keys and fixed errors. Private target/navigation histories are process-memory only, absent from durable/public operation evidence. Login presentation is separately signed/human-only/no-store. No new general profile tools or credential/script/cookie surface was introduced.
- Acceptance still requires required observations backed by retrieved/hash-checked/scalar receipts of appropriate kinds. Missing/fail/skip/mock cases fail. Absent/false workbook capability blocks A12. Driver provenance requires real ITCra observations even though the validator fixtures pass.

## Independent verification

Selected Node 22.23.2 through nvm. From `/Users/huchen/Projects/cmspark/companion`, freshly compiled with the local compiler and ran the canonical isolated runner:

```sh
./node_modules/.bin/tsc -p tsconfig.test.json
node scripts/run-tests.mjs .test-dist/tests/enterprise-policy.test.js .test-dist/tests/enterprise-service.test.js .test-dist/tests/enterprise-http.test.js .test-dist/tests/enterprise-bridge.test.js .test-dist/tests/enterprise-gates.test.js
```

Result: **19/19 pass**, 0 failures/skips, exit 0. Compilation exited 0. Tests use the canonical temporary configuration isolation. This does not exercise cross-process authority races or overlapping pre-login history, hence passing does not refute S6/S7.

From repository root, ran `node scripts/itcra-browser-isolated-check.mjs`: **13 checks pass**, exit 0. Fresh synthetic loopback server, dedicated temporary Chrome profile, actual renderer/ISOLATED DOM/CDP, simulated extension event adapter. No enterprise site or real user profile contacted; images not saved; cleanup completed. Includes search input effect and disjoint pre-SSO B history, as well as prior target/readiness/expiry/capture cases.

Ran `node --test scripts/tests/itcra-browser-acceptance.test.mjs`: **4/4 pass**, exit 0. Their p0 mock report is a validator fixture only; no real joint pass is claimed. S6 cross-process and S7 in-memory producer exercises exited 0 and recorded counterexamples above. Staged/unstaged `git diff --check` exited 0; frozen hash unchanged at finish.

Full Companion 5901/5849 + 52 existing skips, frontend 1520, fresh ARM 70/build and broad machine evidence are reported by the machine card and were read as supporting evidence; they were not rerun as this reviewer's own broad results.

## Original-handoff delivery limitations, separate from source defects

R1–R5 require actual ITCra-driven normal operations without repeated local approval, correct-user automatic no-store SSO presentation and same-task continuation, independent ITCra dangerous-action authorization, stable recorded contracts, isolation and offline delivery. Required P0 A1–A11/A13–A24 remain real joint obligations; A12 original workbook completeness is P1 and required for phase=all. These goals cannot be fulfilled merely by source tests or an unauthenticated status 200 login entry.

The latest live entry observation in the machine card/contract establishes a reachable main-frame login page and bounded candidate marker counts. It does not establish human login, principal isolation, authenticated readiness, remote RBAC popup/signing UI, callback continuation, real effects, original workbook export, or matching offline-installed artifacts. This reviewer did not repeat that live observation. ITCra UI/signer/driver, real test identity and complete joint bake-off remain pending. Those honest limitations are not treated as new source implementation findings, and cannot be relabelled a full delivery pass.

S6/S7 require repair, focused process/overlap regressions, a new frozen source diff and independent rereview. Mandatory T4 human boundary approval and real joint acceptance remain in force even if a later source review approves.

VERDICT: REJECT

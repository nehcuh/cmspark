# #618 independent contract / product / state-machine adversary — r4

VERDICT: APPROVE

**Source review only.** No new confirmed blocking source finding in this lane. C1–C7 and the reported grant-store revocation-loss boundary have reviewable repairs and passing focused regressions. This is not a statement that R1–R5 are jointly delivered, nor approval to merge, release, install policies or replace an application. T4 human boundary approval and real joint enterprise bake-off remain mandatory.

## Scope and evidence

- Read the complete 3,028-line/31-file frozen diff `/tmp/cmspark-itcra-618-r4.diff` against `e44af42f0f3999f23306e41159edb8b12e3dbdff`, actual source/contract/ADR/spec/plan, complete r4 machine card, previous contract reports and governing handoff context.
- Frozen SHA256: `ccbf20fb4c1e8a6c0045c675d7f40db225fb7214f09d062ef01f00b6ee4f50db`. Original handoff v1.1 was read fully in r1; its unchanged SHA256 remains `52010d7a4ba59134e33263b271040e10a762157b177b3073185b4f78adb068b7`. No acceptance requirement was dropped for this review.
- Independently ran Node22.23.2 via `nvm use 22`, fresh local Companion test compiler and canonical isolated runner on the six enterprise/concurrency suites: **22/22 pass**, zero failure/skip. Independently ran actual acceptance entry/validator tests: **4/4 pass**. git diff --check passes.
- These tests use synthetic DOM/API adapters, private temporary test stores, actual producer/JSON/service paths and actual separate OS processes. Local test sockets are isolated loopback fixtures. No real enterprise browser, identity, credentials, external network/site or ITCra source was used in this round. Only this report was added; no implementation edits, staging or commits.
- Broad host5904/5852+52 existing skips, frontend1520, fresh ARM73/build and native16 are **attributed machine-card results**, not independently repeated by this lane in r4. The full native rehearsal source was reviewed. Its fixture corrections and final evidence category are disclosed; API event adapters remain simulated and the native checks are not installed-extension or real enterprise SSO evidence.

## R3 blocker closure

### C7 — Unknown same-path destination now stops without old-document evidence

At `chrome-extension/src/background/enterprise-browser.ts:31`–36, a changed overlapping navigation/login URL without explicit intent clears the previous URL and marks the target ambiguous. `business_target_unavailable` crosses the actual producer/JSON boundary. At `companion/src/outbound-mcp/enterprise-service.ts:150`, the signal clears the stale session destination; prepare at `:249` rejects a login-waiting non-navigation operation lacking a destination **before** storing its handle/arguments/snapshot.

The independently rerun actual producer→JSON→service regression reproduces the original readyA→normal-clickB→same-path-login-before-ready sequence. Result: RETURN_TARGET_NOT_RETAINED, click count1, restore count0, no A text and no private URL in persisted state. The later qualified readyB→same-URL modal login→callback-home sequence returns B once, restores once and leaves the completed click count1. The separately retained C5/C6 service positives still complete normal click/type once and leave dangerous tasks waiting for a fresh target-bound human proof.

Explicit open/navigate intent is retained privately until a verified ready document. The full reviewed native rehearsal adds positive checks for this case and the qualified same-URL case; the card records final16 pass. The new unknown cross-route overlap support limit is clearly documented in the contract and ADR, instead of silently reporting another document as success. It satisfies the handoff's requirement to declare unsupported cases and never convert failure to successful evidence.

### Grant-store revocation loss — authority and usage writes are separated

At `companion/src/outbound-mcp/outbound-grants.ts:336`–341, authentication writes usage metadata only to a per-grant sidecar. It no longer writes the authority file loaded before token verification. Public listing overlays valid usage timestamps for compatibility. Supported issue/revoke/revoke-all paths use `mutateGrants` at `:142`: exclusive file lock before fresh load, held through atomic commit, explicit GRANT_STORE_BUSY/UNAVAILABLE, no stale-lock stealing.

Independently rerun child-process tests exercise legacy **and** enterprise authentication paused after a real authority read against revoke, revoke-all and newer policy (six interleavings). The authority bytes remain the committed version after authentication resumes; revoked keys stay rejected and newer revision remains. A held actual issuer makes each contending supported writer fail explicitly; authentication does not alter the authority bytes; after issuer completion the final revoke persists and the issued sibling remains. The scheduling shims select interleavings, but do not replace production verification or authority mutation logic. Test children are stopped and awaited.

The contract accurately restricts manual edits to quiesced/offline migration, recommends supported revoke/new issuance for changes, and requires operator quiescence before recovery from a crashed writer's stale lock. It does not claim revoke succeeded when contention prevents the commit. This closes the supplied r3 rollback counterexample for the supported mutation protocol.

## Earlier boundaries retained

| Finding/boundary | r4 source and independently rerun evidence |
| --- | --- |
| C1 acceptance receipts | Every case-required observation must be in the union of retrieved, hashed receipts; required kinds are enforced and validated measurements retained. Actual-main incomplete-counter negative fails even with passed driver assertions. |
| C2 A12 | workbook_export=false/absent hard-fails required A12 before driver dispatch. Current v1 cannot pass phase=all. P0 and single-case scope remain distinct. |
| C3 first deployment | Ordinary Bridge startup persists profile UUID; cold module restart retains it. The actual bootstrap-producer test passes. |
| C4 separated permissions | Navigation uses navigation/login source scope independently of evidence export; scoped unknown readiness can recover by navigation; text/screenshot still require export scope. Existing producer/service regressions pass. |
| C5 correct prepared target | Ready B after completed click is frozen per operation; ordinary SSO and late pre-effect READINESS_CHANGED recover B without replay, remove stale error_code and avoid private URL persistence. |
| C6 target-bearing recovery | Authentication/readiness is inspected before matching the action target; restoration precedes callback target matching. Normal click/type execute once; dangerous tasks generate a fresh waiting_human challenge with zero business action until approval. |
| Identity topology | Instance registration fixes business subject/profile; conflicting or old unbound authorities fail at issuance/live use. Same-subject shared-account humans still require ITCra RBAC. Actual site principal remains unqualified. |
| Target/atomic effect | Private WeakMap node identity, exact snapshot/document binding, actual readiness/login and finite deadline checks remain in the effect tick. Producer replacement/marker/expiry/reload negatives pass; native outcomes are attributed to the card. |

## Outcome / trajectory / component assessment

| Dimension | Assessment and evidence limit |
| --- | --- |
| Normal operation outcome | The branded permit reaches the real URL/L2/executor path without confirmation requests; ordinary keys retain their gates. The real-executor gate test passes zero-confirmation/tool.start counts. This source mechanism does not substitute for real A16/A17/A24 UI/site instrumentation. |
| Login continuation trajectory | Supported main-frame/disjoint or qualified same-origin targets retain the same session and original operation. Completed stages do not replay; callback restoration is bounded to once. Unknown overlapping cross-route history fails explicitly without old evidence. Login iframe/popup remains explicitly unsupported. |
| Dangerous lifecycle | Prepare has no business effect; separate human proof binds the operation/target/identity. Approved execution is claimed once; denied/cancelled/expired/replayed/changed and ambiguous outcomes remain explicit. ITCra human UI/RBAC authorization and close/timeout handling remain real joint acceptance work. |
| Handles/recovery/concurrency | Concrete bindings, immutable request digests, durable claims, bounded state, coalesced monitor work, cancellation before/after dispatch, restart termination and unknown results prevent automatic effect replay. Crash-lock recovery has an explicit operator procedure. |
| Async202/disconnect | Source distinguishes completed202 handoff/ordinary poll end from incomplete execute response close. Cancellation after dispatch reports unknown rather than promising rollback. The HTTP suite proves auth/body/envelope bounds; the full network-disconnect race still needs real A11 acceptance evidence. No source defect is confirmed here. |
| Identity/channel isolation | Exact grant/subject/instance/profile/peer/session checks and independent approval versus presentation purposes remain. Login image is human-only/no-store, not durable evidence; no worker signing tool is added. Actual SSO principal and separate real-user presentation/RBAC tests remain pending. |
| SDK/API usability | Explicit discovery, opaque handle prepare/execute/status/cancel, fixed-subject worker client and bounded host errors are coherent. ITCra owns saved checkpoints, authenticated UI/signer and adapter migration. Existing installed0.6.13/four-tool adapter cannot be inferred compatible from health/version alone. |
| Readiness/data coverage | Visible configured markers decide readiness; unknown is not ready. Text says visible_dom/incomplete/workbook_complete=false; frame capture checks and wrong-tab fallback failure remain explicit. No original workbook/all-sheet completeness claim. |
| Acceptance integrity | Required case sets, missing/skipped/failed/malformed/mock-labelled evidence, incomplete receipt observations and unsupported A12 fail. A driver can fabricate purported complete observations; actual provenance is deliberately left to real joint instrumentation and human review, not claimed solved by hashes or labels. |
| Offline/release delivery | No new startup download/service dependency is introduced by this source. Matching offline artifacts/hashes/runtime and disconnected deployment qualification are pending. Source build/card evidence is not an installed-package deployment pass. |

## Honest delivery limits and approval boundary

The source, contract and machine card accurately classify the authorized live entry retry: HTTP/HTTPS home entry reached main-frame SSO login.aspx/status200 and visible unique #qrcode/#btnLogin/#loginBody candidates were observed. This is entry connectivity and candidate-marker evidence only. It is not a human login, verified authenticated ready marker/principal, correct-user image display, post-login continuation or full A-case pass. This lane did not revisit the real site.

ITCra-owned authenticated UI/RBAC/human signer/checkpoint/driver, dedicated real test identities/site readiness markers, matching offline-installed artifacts and joint P0 cases remain absent/unmeasured. Workbook export remains explicitly unsupported. The existing deployment protocol preflight is failed with all23 P0 cases missing; no source report should relabel it passed.

These known, declared delivery limitations do not create an undisclosed source defect in the reviewed CMspark implementation. They still prevent claiming joint completion and keep the T4 human+real-bake-off merge/release gate closed. Further Pi/Kimi/CI and the other independent source lane remain part of the agreed workflow. This report authorizes no deployment or live configuration action.

Findings: **no confirmed residual P0/P1/P2 source finding in this lane** after full rereview and the focused checks above. Source-only verdict: **APPROVE**.

Final frozen source SHA256: `ccbf20fb4c1e8a6c0045c675d7f40db225fb7214f09d062ef01f00b6ee4f50db`.

VERDICT: APPROVE

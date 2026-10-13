# #618 independent contract / product / state-machine adversary — r3

VERDICT: REJECT

The exact r2 C5/C6 cases are repaired, and the fixed-subject instance boundary passes its focused negatives. One additional P1 wrong-document trajectory is independently reproduced when business and login path scopes overlap. The root reviewer also reports a separate concurrent revocation-loss blocker; that result is attributed below, not presented as this lane's independent reproduction. T4 human approval and real joint bake-off remain mandatory regardless of source review.

## Scope and independent checks

- Complete frozen diff: `/tmp/cmspark-itcra-618-r3.diff`, 2,688 lines/30 source files against `e44af42f0f3999f23306e41159edb8b12e3dbdff`. SHA256 `7c45896c7ff08b1879e6ba499b803e68ff055a44277cdbb4bbe3a71d7047f9d9`. Read the full diff, actual sources, current contract/ADR/spec/plan, complete r3 machine card and r2 report.
- Original handoff v1.1 was read fully in r1 and remains unchanged: SHA256 `52010d7a4ba59134e33263b271040e10a762157b177b3073185b4f78adb068b7`. Its R1–R5 and A1–A24 observable acceptance obligations remain the standard, including correct same-session continuation and explicit unsupported outcomes.
- Fresh Node22.23.2 through `nvm use 22`; local Companion compiler followed by the canonical isolated runner for five enterprise suites: **19/19 pass**. Acceptance validator/entry-point tests: **4/4 pass**. Native isolated Chrome rehearsal: **13 checks pass**. These checks are classified simulated/isolated-native, never real enterprise acceptance.
- Added an independent in-memory counterexample connecting the **actual bundled executeEnterpriseBrowser producer → JSON → actual freshly compiled EnterpriseBrowserService**, with private temporary instance/grant/state and a controlled DOM/Chrome API event adapter. No user browser, private enterprise site, real identity, live credentials/configuration or ITCra edits. Temporary data removed; no implementation changes, staging or commits. Only this report added.
- Broad host5901/5849+52 skips, frontend1520 and fresh ARM70/build results are attributed to the implementer's machine card. This lane independently reran the focused19, acceptance4 and native13 checks, not those broad runs.

## Previous finding closure

| Boundary | Verified source/trajectory result |
| --- | --- |
| C1 evidence completeness | Required observation aggregation and kinds persist; partial retrieved measurements fail. Actual entry-point negative test passes, and successful validator output retains measured metadata. Synthetic labels/counters remain subject to real provenance qualification. |
| C2 A12 capability | Required A12 fails WORKBOOK_EXPORT_UNSUPPORTED before driver dispatch when workbook_export is false; absent also fails by the same strict `!==true` branch, independently tested in r2 with unchanged runner. Full delivery is not asserted. |
| C3 profile bootstrap | Ordinary Bridge construction initializes UUID before grant registration; cold module restart retains it. Actual startup-producer test passes. |
| C4 navigation independence | Authorized scoped navigation is independent of evidence rights and unknown business readiness; text remains denied. Actual Bridge/native tests pass. |
| C5 exact ready-B case | Prepare freezes actual ready B after completed click A→B. Both SSO-before-run and late pre-effect READINESS_CHANGED variants return B, restore once, do not replay the completed click and clear stale errors. Focused service test passes. C7 below exposes a remaining pre-ready same-path variant. |
| C6 callback target absence | Waiting-login first probes without the rule, restores B, then matches targets on B. Normal click/type complete once; dangerous click remains waiting_human with zero business effect until a fresh signed proof. Producer/service tests pass. |
| Immutable business identity | Instance registration now requires fixed subject; conflicting registration/issuance, mutated persisted grant subject and legacy missing-subject records fail closed. Same business subject may have multiple authorized human grants; real site principal still requires joint qualification. |
| Actual effect boundary | Native negatives for identical replacement node, late login marker, expiry, changed attributes and same-URL reload pass with zero unintended effects. Private node identity and finite deadline remain bound to the approved dispatch. |

## Independently reproduced P1 blocker

### C7 — Overlapping same-origin scopes keep stale history and complete the wrong document

**Location:** `chrome-extension/src/background/enterprise-browser.ts:31`; history consumed by `companion/src/outbound-mcp/enterprise-service.ts:150`–153 and frozen at `:249`–250.

The event observer retains a navigation URL only when it is **outside** every login scope. A valid marker-based same-origin policy can overlap business and login paths, as needed when a QR/login view is rendered on the requested business route. If a normal click moves A→B and B requires login before a ready inspection, the observer rejects B solely because it is in login scope, leaving prior A as last_business_url. The marker probe correctly reports login_required at B, but the service trusts the stale A history as the requested target. After the callback it restores A and completes the original pending read with A's text.

This is not an incorrectly classified administrator read-only action: the rule is a normal next-page interaction, readiness/login markers correctly distinguish states, and all sites/tools are authorized. The failure is target-history ambiguity being resolved to an earlier document and reported as success. The contract advertises same-origin marker support and promises not to substitute another document's text. Its description of history excluding login scopes does not make a wrong-document completed result an explicit unsupported outcome.

**Concrete producer-to-service reproduction:**

1. Use one subject-bound dedicated instance and a valid administrator policy with navigation/evidence/login all `https://business.test/app`, ready `#ready`, login `#login`, and a normal `#next` click rule.
2. Open and inspect ready `/app/A`; actual producer records A privately.
3. Execute the normal click once. The controlled browser emits the real onUpdated URL shape for `/app/B`, then displays `#login` at B before any ready B inspection. The observer ignores that URL due to its overlapping login scope.
4. Prepare/execute get_page_text while B is login_required. No login text is exported; the operation is waiting. Actual producer metadata carries stale A history, and the service freezes A.
5. Set the same session's authenticated callback to ready `/app/home`; tick twice. The first tick restores once, the second completes the read.

Observed actual producer/service output:

```json
{"loginAt":"https://business.test/app/B","sessionState":"login_required","completedClickEffects":1,"restoreNavigations":1,"resultState":"completed","returnedText":"https://business.test/app/A"}
```

The returned synthetic body text identifies the wrong document. The test preserves actual producer snapshot/target fields and JSON serialization; no manually assumed response keys or fake service implementation are used. Existing pre-SSO event/native tests deliberately use disjoint `/app` and `/login` scopes, so they do not cover this overlap.

**Repair / observable acceptance:** do not promote an older ready/open URL as the current operation destination after an ambiguous overlapping-path navigation. Track a trustworthy pending business target separately from known login views using explicit request/target provenance or a qualified adapter/marker mechanism. When the original destination cannot be established, return an explicit unsupported/unknown failure and no business evidence instead of completing A. Do not blindly treat every overlapping login URL as an authenticated business page or expose login tickets. Add an actual producer→service negative/positive for A→B→same-path QR before ready inspection; successful continuation must return B once, or a declared unsupported result must contain no A evidence. Preserve the disjoint-path and ready-B positives, bounded history, no raw URL persistence and dangerous fresh-proof behavior.

## Separately reported revocation blocker

The root reviewer supplied a local isolated machine reproduction against the frozen shared grant store: legacy authentication reads the full file, a separate process revokes an enterprise grant before legacy `last_used_at` persistence, then that stale full-file write restores the enterprise grant's prior unrevoked record. Its reported result is `enterprise_revocation_preserved=false`, after which requireEnterpriseGrant accepts the revoked grant. This lane inspected the shared load/save path but did not rerun the interposed timingSafeEqual/child-process counterexample; independent security confirmation belongs to that lane's report. It is a separate blocking A8 concern and prevents an unconditional revocation-monotonicity claim. Live rereading before effects cannot protect a tombstone already lost from persistence.

## Outcome / trajectory / component assessment

| Dimension | Source evidence and remaining practical limit |
| --- | --- |
| Normal no-prompt path | Branded permits reach actual URL/L2/dispatch gates; existing ordinary HITL remains. Real-executor zero-confirmation/source tests pass. No real A16/A17/A24 complete-enterprise pass is claimed. |
| SSO task continuation | Ready-B and disjoint pre-SSO B histories plus callback-target restoration pass; C7 leaves supported same-path history able to complete the wrong document. |
| Dangerous lifecycle | Prepared actions have no effect; login generates fresh waiting_human challenge; proof validation/consumption/replay, denied/cancelled/expired and unknown outcome paths remain explicit. Real popup/RBAC approval is pending. |
| Handles/recovery/concurrency | Request digests, durable dispatch claims, bounded state, restart termination/unknown results and coalesced monitor work preserve no automatic replay. Stale retry error is removed on successful rebind/completion. |
| Identity | Immutable subject/profile registration and exact grant/peer/session negatives pass; actual enterprise SSO principal mapping is still a joint gate. |
| API/SDK/human channels | Opaque worker handles, host errors and no worker signing method remain consistent. Presentation signatures are distinct from action approval; no login pictures/URLs in durable/public business output. |
| Readiness/coverage | Visible marker distinction is real; unknown is not ready, iframe/popup explicitly unsupported, visible-DOM extraction declares incomplete/workbook_complete=false. |
| Acceptance/offline/version | Required missing/unbacked cases fail; A12 unsupported fails phase=all; installed0.6.13/health do not establish new contract support. Matching offline-installed package hashes and disconnected deployment qualification remain pending. |

The documented authorized live HTTP/HTTPS entry observations are accurately separated from full delivery: status200/main-frame login.aspx and unique visible #qrcode/#btnLogin/#loginBody are candidate login-marker evidence only. They do not establish actual human login, authenticated readiness/principal, correct user screenshot presentation, post-login task continuation, dangerous popup authorization or real A-case completion. This lane did not revisit the private site. The machine card, contract and research keep the distinction explicit.

Absent ITCra-owned UI/RBAC/signer/checkpoint/driver, real dedicated test identities/ready markers, matching offline-installed artifacts and P1 original-workbook export are honest known delivery limitations. They are not counted as newly discovered source bugs. They still prevent claiming R1–R5 jointly complete or approving merge/release without the agreed T4 human and real-bake-off gates.

Repair C7 and resolve the reported revocation blocker, freeze another full diff and independently verify the exact counterexamples before advancing source approval. No implementation mutation was performed during this review.

Final frozen diff SHA256: `7c45896c7ff08b1879e6ba499b803e68ff055a44277cdbb4bbe3a71d7047f9d9`.

VERDICT: REJECT

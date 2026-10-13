# #618 independent contract / product / state-machine adversary — r1

VERDICT: REJECT

Four P1 source blockers are reproducible. No P0 authority bypass was confirmed in this lane. This verdict evaluates the frozen source and its delivery contract; it does not approve merge/release. T4 human boundary approval and a real joint enterprise bake-off remain required independently of the repairs below.

## Scope and method

- Base: `e44af42f0f3999f23306e41159edb8b12e3dbdff`. Full 2,282-line frozen diff: `/tmp/cmspark-itcra-618-r1.diff`, SHA256 `e0eca1f21407925704bc1c6c27050ae841dc2944b9b99b0b32739f196e681aaa`.
- Read the full ITCra handoff v1.1, SHA256 `52010d7a4ba59134e33263b271040e10a762157b177b3073185b4f78adb068b7`; the actual contract, ADR-029, spec, plan, machine card; the full frozen diff and adjacent executor, bridge screenshot, startup, lifecycle, admission and lease paths.
- Independent non-implementer product/contract/state-machine lane. Routing selected the adversarial reviewer workflow; this is the already dispatched read-only lane, not another dispatch or implementation pass.
- Node `22.23.2` through `nvm use 22`. Fresh Companion test compilation, then its canonical isolated runner on all five enterprise suites: **12/12 pass**. Acceptance validator tests: **3/3 pass**. These existing positives do not exercise the counterexamples below.
- Additional tests used in-memory bundles of the actual extension enterprise producer, controlled DOM/Chrome API adapters, temporary private test credentials and an in-memory acceptance driver. They used no user browser, real grant, enterprise identity, private site or production configuration. Temporary test artifacts were removed. Their evidence is **simulated**, not real enterprise acceptance.
- Only this report was added; no implementation edits, staging or commits were performed.

## P1 blockers

### C1 — Evidence receipts need not cover the observations that decide a case

**Location:** `scripts/itcra-browser-acceptance.mjs:65` (also 66 and 126–128).

`validateCase` accepts required observations from the driver's response. `archiveEvidence` only checks that each receipt contains at least one allowed measurement matching that response. It never requires the union of retrieved receipt measurements to contain the case's required observations. A receipt for one unrelated counter therefore authenticates the whole passed case. The final report also drops the observations, leaving the omitted measurements unrecoverable from its archived artifacts.

**Observable reproduction:** invoke the actual `main` with an in-memory driver that supplies all expected observation values but, for every case, supplies only a canonical, correctly hashed receipt with `measurements:{local_confirmation_requests:0}`. Label its response `real_enterprise` and give it one passed check. All receipts are fetched and validated. A18's receipt has no real-SSO, same-session-resume or completed-stage-replay measurements; A19's receipt has no approval/effect counters; A12's receipt has no workbook measurements. The runner still returns passed. This is missing evidence being promoted to passed, not merely a dishonest driver forging a complete set of purported observations.

Observed actual entry-point output:

```json
{"passed":true,"phase":"all"}
{"exit":0,"passed":true,"cases":24,"A12":"passed"}
```

The mock label was deliberately misrepresented in this negative test; no real SSO or effect was executed. Existing tests reject an explicitly simulated label and invalid hashes but do not reject this evidence omission.

**Repair / acceptance:** define the complete required measurement set once per case, including the conditional prompt, SSO, approval and denial assertions. Require matching measurements for every member across retrieved receipts before returning passed; retain the validated measurements in the reviewable report/receipts. Require evidence kinds appropriate to the actual assertions. Add a negative test through `main` where driver observations pass but receipts omit one mandatory measurement. It must return nonzero with a concrete missing-evidence error. A malicious trusted driver can still fabricate measurements; actual provenance remains a real-bake-off/human responsibility.

### C2 — `phase=all` can pass despite discovered `workbook_export:false`

**Location:** `scripts/itcra-browser-acceptance.mjs:121` (also 123–128).

Discovery only checks contract version and subject. Its explicit `workbook_export:false` is ignored, so the runner executes A12 and trusts a driver's success claim. This contradicts `docs/itcra-enterprise-browser-contract.md:65`: v1 unsupported workbook export must keep A12 missing, not passed. The known P1 export delivery gap is honest; ignoring it in the acceptance result is the source defect.

**Observable reproduction:** the same actual `main` negative test returned capabilities `{ok:true,data:{contract_version:1,subject:"user-a",workbook_export:false}}`, supplied passing driver responses for all 24 cases and retrieved correctly hashed receipts. The result was exit **0**, `passed:true`, A12 `passed`. This condition is independent of C1: a complete receipt set would still leave the capability mismatch unchecked.

**Repair / acceptance:** if A12 is required and discovered workbook export is unsupported or absent, record A12 as missing/unsupported and fail the whole phase. Do not silently drop it. Add an entry-point test with otherwise valid complete receipts and `workbook_export:false`; p0 remains separately evaluable, `all` must fail. Enabling A12 later requires the implementation/capability and real workbook evidence to agree.

### C3 — Fresh extension profile cannot follow the documented registration sequence

**Location:** `chrome-extension/src/background/enterprise-browser.ts:119`; bootstrap documentation at `docs/itcra-enterprise-browser-contract.md:9`.

The profile ID is generated lazily by `enterpriseProfileId`, whose only caller in the complete extension source is enterprise execution at line 119. Ordinary extension startup and pairing do not create it. The contract tells the administrator to read this value before registering the instance and issuing the first enterprise grant. That read is empty on a fresh dedicated profile. An enterprise probe cannot bootstrap it before a grant exists because the REST service requires an already registered instance/grant. Guessing and registering a UUID does not help: the first probe generates a different UUID, and registration refuses replacement.

**Observable reproduction:** import/bundle the actual enterprise producer with empty `chrome.storage.local`. Storage remains empty. Execute the first probe with a supplied placeholder profile ID. It returns `ENTERPRISE_PROFILE_MISMATCH` and only then writes a freshly generated UUID. Observed output:

```json
{"initial_storage_read":null}
{"first_enterprise_probe":"ENTERPRISE_PROFILE_MISMATCH","profile_created_after_probe":true}
```

`rg -n 'enterpriseProfileId|enterprise_profile_id' chrome-extension/src` confirms no startup call. Both new extension tests and the native Chrome rehearsal inject an existing UUID, so they bypass this first-install path. No real Chrome startup was run; the absence of a startup producer is established by the complete caller search and startup source, and the lazy generation behavior by the actual producer test.

**Repair / acceptance:** initialize and persist the ID during normal dedicated extension startup, or provide an explicit supported local bootstrap command/UI that precedes registration and is documented. Ensure service-worker restart retains the same ID. Test fresh storage through normal startup/bootstrap, then registration, grant issuance and first profile probe with no temporary wrong registration or manual state deletion.

### C4 — Navigation authority incorrectly depends on evidence-export authority

**Location:** `chrome-extension/src/background/enterprise-browser.ts:134` (navigate branch at 157–160); an additional readiness obstruction is `companion/src/outbound-mcp/enterprise-service.ts:226`–227.

The common non-login gate requires the current URL to be in `policy.evidence` before checking the tool/mode. That requirement applies to navigate, scroll, click and type as well as actual export. A policy can correctly authorize navigation while withholding data export, but an otherwise ready navigation-only page cannot navigate to another authorized page. Giving it evidence scope to enable navigation unnecessarily widens export authority. The handoff appendix D explicitly separates navigation, data export, login presentation and interaction; A3 also requires navigation with export denied.

**Observable reproduction:** actual enterprise producer in a controlled DOM, current URL `https://business.test/navigation-only` with a visible authenticated `#ready`; navigation scope `https://business.test/`, evidence scope only `/evidence`. Inspection returns `ready`. Navigate to authorized `https://business.test/evidence` with that exact snapshot. It returns `EVIDENCE_FORBIDDEN`; `chrome.tabs.update` count is **0**. Source and destination are both navigation-authorized. The same common gate blocks approved interactions on such a page. Separately, navigating away from an allowed page with unknown readiness markers is rejected by `prepare` before navigation can restore a supported page.

Observed output:

```json
{"source_state":"ready","navigate_result":{"success":false,"error":"EVIDENCE_FORBIDDEN"},"navigateEffects":0,"source_navigation_authorized":true,"destination_navigation_authorized":true}
```

**Repair / acceptance:** apply evidence scope to text/business-screenshot export; apply navigation scope and exact-session/document checks to navigation; apply the separately authorized rule/tool and navigation constraints to interactions. Decide explicitly which login/unsupported source states can safely navigate to a preauthorized destination without exposing data, rather than requiring business readiness for every mode. Test ready navigation-only source→allowed destination succeeds with zero confirmations while text/screenshot from that source remain denied. Do not broaden evidence scope to repair this behavior.

## Outcome, trajectory and component assessment

| Dimension | Source evidence and practical limit |
| --- | --- |
| Normal no-prompt execution | Branded permits traverse the actual executor URL/L2 gates without local confirmation; ordinary keys retain their gates. Existing real-executor test counts zero confirmations/tool.start broadcasts. C4 prevents the independent-authority cases from completing. No A16/A17/A24 real enterprise pass is established. |
| SSO and same-session continuation | Separate purpose-bound presentation proof; no URL/title/image persistence; waiting normal operation resumes through `tick` and completed operation does not replay. Main-frame/same-origin support is explicit; iframe/popup is explicitly unsupported. Actual enterprise QR/RBAC/UI/checkpoint integration is unmeasured, not an invented source bug. C3 prevents clean deployment bootstrap. |
| Dangerous lifecycle | Prepare has no action effect; approved proof is consumed synchronously before queued work; denied becomes cancelled/HUMAN_DENIED, caller cancel is terminal, timeout becomes cancelled/APPROVAL_EXPIRED; changed snapshot fails; replay cannot authorize a second effect. Existing tests exercise approved/denied/cancelled/replayed cases. Expiry is inspected in source but is not a distinct persisted-suite positive in these 12 tests. No UI-level approval/close/RBAC acceptance is claimed. |
| Handles, idempotency and recovery | Concrete grant/subject/session keys, strict argument digests, durable dispatch claim and terminal ambiguous results. Restart kills waits and preserves completed metadata with `data_not_retained`; reconnect cannot replay approval. Finite store capacity and deliberate recovery constraints are honestly documented. |
| Async response/disconnect | Successful completed 202 does not cancel work; incomplete response close attempts cancellation, after-dispatch cancellation reports outcome_unknown. Correct distinction is present in source. The HTTP test only exercises capability/auth/body bounds; it does not dynamically test the 202/abnormal-close race. This remains an evidence gap for A11, not a confirmed source failure here. |
| Identity and human channels | Dedicated process/profile topology, exact one-peer epoch, concrete grant+subject bindings, signed purpose separation and no worker signing method. Cross-subject/sibling/peer negatives pass in the source suites. Actual multiple real enterprise identities and ITCra RBAC remain required joint evidence. |
| SDK/API usability | Explicit contract discovery and opaque handles; worker SDK has normal execute/status/cancel and host error decoding, intentionally no signer. Deployment bootstrap and independent navigation need C3/C4 repairs. Human UI owns real action labels/context/RBAC; that work remains pending. |
| Readiness and coverage | Actual visible markers determine readiness rather than origin membership; unknown does not become ready. Text is explicitly visible DOM/incomplete/workbook_complete=false; it does not claim complete WPS data. A12 remains a real delivery limitation and must be enforced by C2. |
| Acceptance evidence | Correct required p0/all sets, missing/skipped/fail and openly simulated labels are rejected. C1/C2 allow concrete unsupported/unbacked claims to become pass, so existing validator positives do not establish honest complete acceptance. |
| Offline/version compatibility | Contract does not infer compatibility from installed 0.6.13 or health; matching source discovery is required. No new startup network dependency was observed. Matching offline packages/hashes and disconnected startup verification remain undelivered/unmeasured, clearly acknowledged by the contract/card. |

## Delivery boundary and decision

Absent ITCra UI/RBAC/signer/driver, real enterprise SSO identities, real isolation evidence, matching offline-installed artifacts and P1 original-workbook export are known and honestly declared delivery limitations. They are not counted as undisclosed implementation bugs. They still prevent claiming R1–R5 jointly delivered or releasing/merging the T4 feature without the agreed approval and bake-off.

The four findings above are source defects within CMspark-owned delivery: acceptance can issue incorrect pass results, fresh registration cannot follow its own contract, and navigation is coupled to export permission. Repair them, freeze a new complete diff and independently rerun the counterexamples plus the applicable machine gates. Existing source test pass counts and honest limitations do not override these observable failures.

VERDICT: REJECT

# #618 independent contract / product / state-machine adversary — r2

VERDICT: REJECT

The four r1 findings are closed. Two new P1 trajectory defects in the SSO target-restoration change are reproduced in the actual service: it can complete a read with the wrong business document, and it cannot restore pending interactions when the callback page lacks their target. No P0 authority bypass was confirmed in this lane. Source review remains separate from T4 human approval, real joint bake-off and release approval.

## Scope and independent evidence

- Full 2,529-line diff `/tmp/cmspark-itcra-618-r2.diff`, SHA256 `3b777c9ff4abba3dbc9f5209e8970bab2c34b98dab46be1e507b57766682c477`, against `e44af42f0f3999f23306e41159edb8b12e3dbdff`. Read all source changes, tests, SDK, runner and actual contract/spec/plan/ADR; source handoff v1.1 was read fully in r1 and remains the governing acceptance standard. Read `2026-10-13-itcra-enterprise-machine-r2.md`.
- Node22.23.2 with `nvm use 22`; fresh Companion test compilation and canonical isolated runner for all five enterprise suites: **16/16 pass**. Acceptance tests: **4/4 pass**. Independently ran native dedicated Chrome rehearsal: **11 checks pass**, including same-descriptor replacement, late login marker, actual effect deadline and navigation without export.
- Independently exercised actual acceptance `main` using a private temporary credential directory and an in-memory synthetic driver. Complete synthetic measurement receipts pass the validator baseline; partial receipts with every required kind present fail; false and absent workbook capability each hard-fail A12 without driver dispatch. This is validator testing, **not real acceptance**.
- The new trajectory counterexamples run the freshly compiled actual `EnterpriseBrowserService` with isolated instance/grant/state and a controlled runner. No live grant, private browser/profile, enterprise identity or user data was used. Browser URLs/text in the reproduction are synthetic `business.test` values. Temporary artifacts were removed. Only this report was added; no implementation edits, staging or commits.
- The machine card's broad host/ARM64/build results are attributed to the implementer's exact-source runs. This lane independently repeated the targeted checks above, not all 5,898 tests or ARM64 builds.

## R1 finding closure

| Finding | Verified r2 behavior |
| --- | --- |
| C1 receipt coverage | `requiredObservations` supplies the complete set, retrieved receipt measurements are aggregated, required kinds are present and validated measurements remain in the report. Independent actual-main partial-receipt run returns exit1, A18 `REQUIRED_RECEIPT_MEASUREMENTS_MISSING`. The driver supplies all kinds but only `local_confirmation_requests:0` per receipt, so this tests the missing-measurement boundary rather than only kind validation. |
| C2 unsupported A12 | Independent actual-main runs with workbook_export=false **and absent** return exit1, A12 `WORKBOOK_EXPORT_UNSUPPORTED`, A12 driver-call count0, even with otherwise complete receipts. P0 remains separately evaluable. |
| C3 fresh profile bootstrap | Ordinary Bridge constructor invokes profile initialization, and the ordinary service-worker startup actually constructs a Bridge. The actual Bridge producer test passes fresh empty storage, then cold module reload with the same UUID and only one storage write. |
| C4 navigation independence | Actual Bridge and native Chrome navigation without evidence scope succeed; text remains denied. Service navigation can recover a scoped unsupported source. No broadening of evidence rights is required. |

Security r1 repair boundaries also pass this lane's native rerun: replacement nodes get distinct private tokens; late ready→login transition and expired execution deadline have zero new click effects. Dangerous proof consumption and terminal ambiguous/cancelled handling remain intact. The two findings below concern the newly added restoration trajectory, not reopening those repaired defects.

## New P1 blockers

### C5 — The restored operation destination can be a stale earlier stage

**Location:** `companion/src/outbound-mcp/enterprise-service.ts:243` (destination assignment in prepare); related update at `:344` and restore/rebind at `:319` and `:327`.

`prepare` copies `this.destinations.get(session.handle)` into the operation destination instead of binding the currently inspected business URL. That session map is initialized by open and updated only after explicit `navigate` operations. An authorized click that changes the business URL leaves it stale. A subsequent read may therefore be prepared and inspected at B, enter SSO waiting, and later be rebound to A during automatic restoration. This violates the contract's promise that another document's text is never substituted for the requested link, and breaks same-session continuation after completed stages.

**Observable reproduction, actual service:**

1. Open `https://business.test/app/A`.
2. Prepare/execute an administrator-verified normal `next` click. Its controlled browser effect moves the same owned tab to `/app/B` and changes document/generation. The click is completed, effect count1.
3. Prepare `get_page_text` while the browser is ready at B; the service accepts and snapshots B.
4. Before execute's inspect, the browser moves to the configured `/login` SSO page; execute enters waiting_login with zero read result.
5. After login, callback lands ready at `/app/home`. First tick performs one restore navigation; second tick completes the original read handle.

Observed output:

```json
{"preparedAt":"https://business.test/app/B","completedClickEffects":1,"restoredNavigations":1,"state":"completed","returnedText":"https://business.test/app/A"}
```

The synthetic text identifies the document fetched. The completed click is not dispatched twice, but its completed navigation stage is semantically undone and the resumed read reports success with A's evidence. All URLs are in the same allowed navigation/evidence scope; authority rejection does not prevent this wrong-document result. The existing restoration test uses explicit navigate, which updates the map, so it misses this case.

**Repair / acceptance:** freeze an operation's real requested business URL from its trusted ready preparation snapshot. For work prepared during login, retain a verified current business destination rather than an arbitrarily stale open/explicit-navigate value; update that tracking without turning the callback page into the request destination. If the original destination cannot be established, stop explicitly instead of returning another stage's evidence. Keep private URLs out of durable state. Add completed-click A→B, prepared-read B, SSO callback home regression: the same read handle returns B's evidence, click effect count stays1 and restore remains bounded to once. Include a late pre-effect READINESS_CHANGED variant.

### C6 — Target matching runs on the callback page before restoration can reach the target page

**Location:** `companion/src/outbound-mcp/enterprise-service.ts:307` and `:315` (before restoration at 316–325).

`run` always inspects with the requested action rule. For a pending click/type, a normal authenticated callback/home page often has the configured business readiness marker but not the original page's button/input. The actual extension inspection then reports target_mismatch. The service fails SITE_OR_TARGET_UNSUPPORTED at line315 before attempting the target restore at line316. Consequently the new restoration works for text/screenshot but cannot provide the declared continuation for ordinary or dangerous interactions on a different callback page.

**Observable reproduction, actual service:** open an authorized target, place it in login_required, prepare/execute a normal `next` click and leave the same operation waiting. Mark the callback `/app/home` authenticated/ready but with no `#next` target. The controlled runner returns the extension's real target_mismatch state for inspection with that rule. One tick returns:

```json
{"state":"failed","error":"SITE_OR_TARGET_UNSUPPORTED","restoreNavigations":0}
```

No pending click effect occurs. Extension source `enterprise-browser.ts:55`–56 establishes this state when an otherwise ready document has no matching rule element. The existing restore test only prepares get_page_text, which has no rule and therefore cannot reveal this ordering defect. The same issue affects a write action waiting for login: it never reaches the restored target to generate the required target-bound human challenge.

**Repair / acceptance:** while recovering a login-waiting operation, inspect session readiness/navigation independently of its action target, restore the frozen requested destination under existing navigation authority, then inspect and bind the action rule on that destination. Continue to reject unsupported login forms, forbidden destinations and absent targets on the intended page. A restored dangerous task must enter waiting_human and require a fresh target-bound proof; login remains insufficient authority. Add pending read-only click, type and dangerous click cases whose authenticated callback lacks their targets: restore once, normal effect once, dangerous effect zero before human approval.

## Outcome / trajectory / component assessment

The source now faithfully rejects unbacked acceptance observations and unsupported workbook export, bootstraps profile identity and separates navigation from export. Machine positives establish these source boundaries. The actual native renderer checks establish node/marker/deadline enforcement for the tested DOM cases with a simulated extension API adapter; they are not installed-extension or enterprise SSO evidence.

The remaining SSO trajectory cannot claim the observable DoD of correct same-session task continuation: C5 returns the wrong stage's evidence as completed, and C6 prematurely terminates pending interactions on an otherwise supported callback. Coalesced monitor/execute scheduling, durable keys, consumed proofs, cancelled/expired/unknown outcomes and restart no-replay still protect effect counts; they do not resolve either wrong-target restoration issue.

No additional confirmed source defect was found in concrete-grant/subject/peer isolation, separate human presentation purpose, SDK lack of signing authority, ordinary HITL preservation, explicit incomplete visible-DOM provenance, async202 versus ordinary poll end, or version discovery. The incomplete-response close path is reviewed in source; the current HTTP suite still does not dynamically exercise its full disconnect race. Real A11/A18/A19/A23/A24 acceptance remains pending.

Known absent ITCra-owned UI/RBAC/checkpoint signer/driver, real enterprise identity and exact site markers, matching offline-installed artifacts and P1 original-workbook export remain honest delivery limitations. The supplied SSO URL is configuration input, and the reported failed isolated load is not a real SSO pass. These limitations are not counted as hidden source bugs. They independently prevent claiming R1–R5 jointly delivered or approving a T4 merge/release without human approval and real bake-off.

Repair C5/C6, freeze another complete diff, rerun the specific source/native/acceptance gates and independently review the new restoration trajectory. No implementation mutation was performed during this rereview.

VERDICT: REJECT

# #618 independent security adversary — round 2

VERDICT: REJECT — 2 P1 source blockers; 1 nonblocking P2 cleanup. R1 S1/S2/S3 are repaired and their regressions pass.

Independent non-implementer review of base `e44af42f0f3999f23306e41159edb8b12e3dbdff` and complete newly frozen `/tmp/cmspark-itcra-618-r2.diff`, 2529 lines, SHA256 `3b777c9ff4abba3dbc9f5209e8970bab2c34b98dab46be1e507b57766682c477`. Hash verified at start and finish. Read the r2 machine card, full 30-file diff, actual updated sources/tests and adjacent server/actuator/lease/result/logging boundaries. The review did not modify/stage/commit source, issue production grants, inspect private credentials/browser data, mutate ITCra or replace the application. Only this report was created.

The verdict evaluates source safety and promised P0 continuity. It does not grade the explicitly pending ITCra authenticated UI/RBAC/checkpoint signer/acceptance driver or P1 workbook export as completed. ADR-029 T4 still prohibits merge/release without human approval and real joint bake-off. The supplied SSO URL is configuration input; failed unauthenticated public-page loading is not login evidence. No real enterprise SSO or installed-extension acceptance was performed by this reviewer.

## P1 S4 — SSO restoration checks the original action target on the callback page before restoring it

Locations: `companion/src/outbound-mcp/enterprise-service.ts:307`, `:315`, `:316`; actual target producer `chrome-extension/src/background/enterprise-browser.ts:56`. Regression gap: `companion/tests/enterprise-service.test.ts:74`.

`run()` inspects the current page using the pending click/type rule. On a successfully authenticated callback/home page that does not contain the original link's button/input, the real inspector returns `target_mismatch`. `run()` rejects that state as `SITE_OR_TARGET_UNSUPPORTED` at line 315 before it reaches the original-destination restore block at lines 316–325. The waiting operation becomes permanently `failed`, with zero restoration navigations. A dangerous operation never reaches the new target-bound human challenge; a normal click/type likewise fails to continue.

This is an ordinary supported main-frame SSO trajectory: request `/app/record`, encounter login, authenticate, return to an allowed `/app/home` that has the authenticated ready marker but not the original record's `#delete`/`#next` target. The restore feature exists precisely to return from a different callback destination, so requiring the original action target on that destination defeats it. Failing closed prevents wrong effects, but does not implement the advertised same-session continuation.

The new restoration test uses `get_page_text`, which has no rule, and the service harness synthesizes rule targets regardless of URL. It therefore does not exercise this target-bearing trajectory. This is a source omission, independent of absent ITCra UI/real SSO configuration.

Focused isolated reproduction against the exact compiled r2 service:

1. Set a fresh temporary `CMSPARK_DATA_DIR` before importing any Companion module; register a synthetic instance and finite subject-specific Ed25519 policy. Grant create_tab/navigate/click and a write `#delete` rule, navigation `/app`, login `/login`, no evidence export.
2. Open original `https://business.test/app/record`; controlled browser reports `login_required`. Prepare/execute the dangerous click without proof while waiting-login; no business effect runs.
3. Change controlled browser to `ready` on `https://business.test/app/home`. Its inspector reports `target_mismatch` whenever a rule is requested there, matching the real producer's line 56 behavior when the selector has zero matches. Use branded permit checks/single-use dispatch in the runner.
4. Tick the service and read its public operation result.

Measured output (opaque random handles omitted):

```json
{
  "case": "SSO_callback_without_pending_rule",
  "operation": {
    "state": "failed",
    "tool": "click",
    "effect": "write",
    "error_code": "SITE_OR_TARGET_UNSUPPORTED"
  },
  "browser": {
    "state": "ready",
    "url": "https://business.test/app/home",
    "navigations": 0,
    "effects": 0
  }
}
```

The focused exercise exited 0 and cleaned the temporary data directory. It is a controlled API/service reproduction, not a real-enterprise acceptance case.

Repair: while an operation is waiting-login, first inspect current navigation/authentication without its action rule. Preserve unsupported iframe/popup and out-of-scope rejection. Restore the retained original destination at most once using the explicit navigate authority before requiring the pending action's target. Once the original document is ready, inspect the rule, bind the live target/document digest, and generate a fresh challenge for dangerous operations. Do not reuse any consumed pre-login proof. Add both read-only click/type and dangerous-action cases where the callback page has valid readiness but lacks the original target. Assert one restoration, zero premature effects, then waiting_human/fresh proof for write.

Confidence: high; directly reproduced service failure and exact producer/control-flow evidence.

Related destination defect in the same restore boundary: `prepare()` copies `destinations.get(session.handle)` at lines 243–244 rather than the actual observed business URL. That cache updates only at explicit enterprise navigate completion (line 344), while a verified read-only click can perform ordinary site/SPA navigation from A to B. Preparing a read on B therefore retains A as its future SSO destination; the restore branch can later return to A and provide A's text for the task prepared on B. The independent contract reviewer reproduced this trajectory and notified the parent; this security lane independently confirms the stale-cache control flow but did not duplicate that second dynamic exercise. Repair must choose the actual verified business destination at prepare/observe time, including pre-SSO navigation, as well as restore before action-target inspection. Do not infer it solely from the last explicit navigate request.

## P1 S5 — A registered browser instance is not bound to one business subject

Locations: `companion/src/outbound-mcp/enterprise-policy.ts:114`, `:118`, `:130`; grant issuance `companion/src/outbound-mcp/outbound-grants.ts:186` and live use `:386`.

The chosen topology requires a dedicated process/profile for one authenticated user or one expressly shared business identity. The durable instance record contains instance_id/profile_id only. Issuance and every live grant check compare those fields but never bind the registered browser to a single subject. A local administrator can issue distinct `subject=user-a` and `subject=user-b` grants against the same instance/profile; both are live and both target the same authenticated browser. The service reports each grant's claimed subject, while the browser's cookies/storage remain shared. Exact-grant and same-handle checks prevent borrowing A's operation handle but do not prevent B from opening a fresh session in A's registered browser.

Fresh isolated exact-source grant exercise registered `single-profile` once, issued two finite enterprise grants differing only in caller/subject, and called `requireEnterpriseGrant` for both. Both succeeded:

```json
{
  "case": "distinct_subjects_same_registered_browser",
  "accepted": [
    {"subject":"user-a","instance_id":"same-registered-instance","profile_id":"single-profile"},
    {"subject":"user-b","instance_id":"same-registered-instance","profile_id":"single-profile"}
  ]
}
```

The output above substitutes a readable label for the shared random UUID. No tokens/private files/real browser data were read; the temporary data directory was cleaned. This demonstrates accepted conflicting subject topology, not measured live enterprise data leakage. It requires administrator configuration, so it is not an Agent-side grant-forgery attack. It is a missing source invariant for the declared browser/subject isolation model: existing documentation alone cannot make the matching-profile check enforce the business subject.

Repair: bind registration to a fixed subject/business identity and compare it at issuance and every live use. Fail closed for old/unbound records rather than silently choosing the first caller. For an explicitly shared account, multiple authorized humans should map through ITCra RBAC to the same registered business subject; distinct personal subjects require separate instances/profiles. If shared-personal-subject operation is intended instead, it needs a separate explicit authority model and contract, not an implicit consequence of issuing another grant. Add tests rejecting conflicting subjects on the same registration and proving same-business-subject authorized-human routing remains supported.

Confidence: confirmed issuance/live-use acceptance and source enforcement omission; actual SSO account isolation remains a mandatory joint case.

## P2 N1 — Recovered operations retain their obsolete pre-effect error

Locations: `companion/src/outbound-mcp/enterprise-service.ts:343`, `:348`, `:351`, public projection `:174`.

A recoverable `READINESS_CHANGED` stores `op.error_code` and returns a normal operation to waiting-login. Successful resumed execution sets `state=completed` and deletes the challenge but does not clear that old error. Public completed results consequently include both valid data and `error_code=READINESS_CHANGED`. State remains unambiguous for a careful client, so this does not block source acceptance, but clients displaying/persisting `error_code` can present a stale failure after success.

Repair: clear obsolete retry error on successful completion, or expose it under a separate historical field rather than the current error field. Extend the existing pre-effect-login-resume test to check the completed envelope's error state. This finding is source-control-flow analysis, not a separately recorded native failure.

## R1 repairs independently verified

| R1 finding | R2 source boundary | Observed result |
| --- | --- | --- |
| S1 identical replacement node inherits old target | `enterprise-browser.ts:65–73` private per-document ISOLATED WeakMap identity; `:109–112` final live identity comparison | Native clone/replacement is refused; replacement handler count stays 0. Signed-old-target service regression returns APPROVAL_TARGET_CHANGED with 0 effects. |
| S2 login transition after final snapshot still clicks | `enterprise-browser.ts:97–100` expiry/URL/visible ready/login checks in the actual effect tick | Native late marker transition returns READINESS_CHANGED with 0 effects. Normal pre-effect failure waits/resumes; consumed dangerous proof is not reused. |
| S3 navigation requires export authority | `enterprise-browser.ts:146–156` separate navigation/action/evidence branches; service `:237–240`, `:313–315` | Native and real-bridge navigation without evidence succeeds; text remains EVIDENCE_FORBIDDEN. |

The action deadline is minted at `enterprise-service.ts:133` from session expiry, 30 sec maximum and approval expiry, passed at `:334`, and rechecked within `actDocument` at `enterprise-browser.ts:97`. Native 250 ms actor delay beyond a 100 ms authority deadline returns ENTERPRISE_DEADLINE_EXPIRED with 0 effects. Text/capture discard output after expired deadline. This closes the r1 follow-up for delayed dangerous DOM execution; it does not imply post-dispatch revocation/cancel can roll back an effect.

Identity bootstrap now runs during ordinary BrowserBridge startup (`browser-bridge.ts:115`) and retries after storage rejection (`enterprise-browser.ts:20`). The actual startup/cold-module retention test passes. No grant-based bootstrap dependency remains.

Acceptance now retrieves and hash-checks receipts, requires appropriate evidence kinds and collective coverage of every required observation (`scripts/itcra-browser-acceptance.mjs:75–93`), retains measured scalars, and rejects unsupported/absent workbook_export before A12 dispatch (`:146`). The actual entry-point negative cases pass. Driver provenance still requires independent real UI/site observations; scalar receipts cannot substitute for real joint instrumentation.

The scheduled-operation set coalesces repeated execute/slow monitor work (`enterprise-service.ts:163–166`); the 20-repeat regression passes. The original-destination restoration remains confined to an explicitly granted navigate tool and process-memory destinations, with one restore attempt. S4 is its confirmed ordering failure for target-bearing tasks.

## Verification

Reviewer selected Node 22.23.2 with nvm. Fresh independent runs:

```sh
# cwd /Users/huchen/Projects/cmspark/companion
node scripts/run-tests.mjs .test-dist/tests/enterprise-policy.test.js .test-dist/tests/enterprise-service.test.js .test-dist/tests/enterprise-http.test.js .test-dist/tests/enterprise-bridge.test.js .test-dist/tests/enterprise-gates.test.js
# cwd /Users/huchen/Projects/cmspark
node scripts/itcra-browser-isolated-check.mjs
node --test scripts/tests/itcra-browser-acceptance.test.mjs
```

- Canonical Companion targeted suites: **16/16 pass**, 0 failures/skips, exit 0. Canonical runner isolates configuration data.
- Native Chrome rehearsal: **11 checks pass**, exit 0: target effect, identical replacement denial, late login denial, actor expiry, navigation without export, attribute mutation denial, same-URL reload denial, credential denial, incomplete visible text, owned-tab capture and same-origin login separation. Fresh temporary Chrome profile/real renderer ISOLATED DOM/CDP; extension API adapter simulated. Images not saved; cleanup completed.
- Acceptance validator/actual entry-point fixtures: **4/4 pass**, exit 0. Their mock p0 report is a validator fixture only; it is not a real joint pass.
- Focused S4 service reproduction: failed operation/no restore/zero effects as recorded above; clean isolated data and exit 0.
- Focused S5 grant reproduction: conflicting subjects both accepted on one registered browser, exit 0; clean isolated data.
- Staged/unstaged `git diff --check`: exit 0. Frozen diff hash unchanged at finish.

The machine card separately reports full host 5898/5846 + 52 existing skips, frontend 1520, fresh ARM 67 and production builds passing. Those broad runs were read as supporting evidence, not rerun/claimed as this reviewer's own execution.

## Full boundary review

Read all 30 frozen files again, including prior unchanged authority/HTTP/admission/SDK/documentation hunks and every updated fixture/native/acceptance hunk. Reviewed concrete grant/subject/change/instance/profile/session bindings; immutable policy/argument digest; WeakSet branding; exact authenticated peer object/epoch and origin-bound result correlation; old-grant/raw-guard rejection; actual URL/L2/exfil replacement paths; per-grant/session lease; finite expiry, revocation, cancellation, durable single-use/once-only dispatch, ambiguous outcomes and restart termination.

No additional confirmed authority forgery, approval-purpose substitution, duplicated business dispatch or confidential persistence/logging defect was found. Enterprise parameter broadcasts remain suppressed, logs expose only metadata/fixed error literals, output budgets remain bounded, state retains claims/digests rather than private destinations/typed values/selectors/images/text, and human presentation is separate signed/no-store authority. The site's marker/rule/effect classification remains an administrator verification input. Node identity prevents replacement ABA; it is not proof of a business entity's meaning if a site silently repurposes an unchanged node, so that semantic mapping still belongs in site qualification and real bake-off.

S4/S5 must be repaired with targeted regressions and a fresh frozen review round. A later source APPROVE still leaves real ITCra human/SSO integration, matching offline build, T4 human boundary approval and required joint bake-off outstanding. Original workbook export remains explicitly unsupported; phase=all cannot pass.

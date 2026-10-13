# #618 independent security adversary — round 1

VERDICT: REJECT — 3 P1 source blockers. No P0 severity finding. These findings concern required P0 behavior, not the acknowledged pending ITCra integration or P1 workbook export.

Reviewed base `e44af42f0f3999f23306e41159edb8b12e3dbdff` and complete frozen source diff `/tmp/cmspark-itcra-618-r1.diff`, 2282 lines, SHA256 `e0eca1f21407925704bc1c6c27050ae841dc2944b9b99b0b32739f196e681aaa`. Hash verified at review start and finish. Read the machine card, every source/test/document/script hunk, actual changed source, and adjacent execution gates. Independent non-implementer; no source changes, staging, commits, production grant issuance, application replacement or external chat messages.

ADR-029 T4 remains binding. This is source review only. Existing ITCra UI/RBAC/checkpoint signer/acceptance driver and original workbook export remain explicitly pending. Machine PASS and the isolated native Chrome evidence below do not establish real enterprise SSO, installed-extension compatibility, joint acceptance, merge or release approval.

## Blockers

### P1 S1 — Identical replacement DOM targets inherit an old approval

Location: `chrome-extension/src/background/enterprise-browser.ts:65`, `:98`, `:100`, `:101`; binding consumers `companion/src/outbound-mcp/enterprise-service.ts:236` and `:301`.

The target snapshot identifies only tag, six attribute values, and optional text. Document ID/navigation generation identify the document but not the element. Replacing the approved button with a different node with the same selector and descriptor leaves every snapshot field and operation digest unchanged. The final actuator queries the selector again and clicks that replacement node. Thus a human proof for an earlier target can authorize a new target in the same SPA document; exactly-once transport dispatch does not prevent an effect on a different business record.

Native reproduction: the supplied isolated Chrome rehearsal creates `#next[data-action=next]`, captures the real renderer snapshot, then clones/replaces the node, preserving its descriptor while installing a different click handler. Calling the real actuator with the old expected snapshot returns `success:true, executed:true`; the replacement handler runs once. Main-frame URL, Chrome loader/document identity and generation remain unchanged. This is target ABA, not navigation ABA; the existing same-URL reload and changed-attribute tests do not cover it.

Repair: retain per-document element identity in the ISOLATED world, for example a private WeakMap from element to random identifier. Include that identifier in the snapshot/digest and require the exact live element identity inside the final effect tick. Replacement must invalidate the pending operation/approval even when all visible attributes match. Site adapters must additionally bind the business entity/context they intend to approve; element identity alone cannot detect an existing node whose application-side meaning changes without observable attributes. Add native replacement and service-level signed-old-target regression cases.

Confidence: confirmed by actual Chrome DOM/CDP execution with a simulated extension API adapter.

### P1 S2 — Readiness/login checks finish before the atomic effect

Location: `chrome-extension/src/background/enterprise-browser.ts:83`, `:88`, `:89`, `:100`, `:101`, `:153`.

Readiness, login markers and source scope are inspected in a separate asynchronous `executeScript` call. `snapshot()` then awaits `chrome.tabs.query`, and execution later performs another asynchronous `executeScript`. `actDocument()` checks URL and target descriptor but never rechecks authenticated readiness or visible login markers. A same-document session expiration/QR transition during this gap can therefore leave the same button present and cause a business click after the page has entered `login_required`. Pinning `documentIds` prevents a fresh-document reload from passing, but does not prevent this transition inside the existing document.

Native reproduction: configure overlapping business/login scope, keep the same document and target, then remove `#ready` and append visible `#login` in the `chrome.tabs.query` await after the final snapshot's inspection script. The actuator returns `success:true, executed:true` and clicks once more. An immediate subsequent inspection reports `login_required`. An ordinary same-origin login transition, rather than a new URL or target attribute mutation, is sufficient. This breaks the intended waiting-login and target-bound approval behavior before any integration with ITCra.

Repair: pass the trusted policy to `actDocument()` and recheck source scope, visible login markers, authenticated ready markers and exact live target inside the same synchronous ISOLATED-world tick before click/type/scroll. Fail closed or enter waiting-login if readiness changes; require new target-bound approval after any relevant transition. Add a deterministic final-inspection-to-effect regression, including a native same-document marker transition.

Confidence: confirmed by actual Chrome DOM/CDP execution with a simulated extension API adapter.

### P1 S3 — Export permission is required for every navigation/action

Location: `chrome-extension/src/background/enterprise-browser.ts:133` and `:134`; affected navigate branch `:157`; Companion correctly separates destination navigation at `companion/src/outbound-mcp/enterprise-service.ts:208`.

The general precondition for every non-login-screenshot mode requires the current page to be in `policy.evidence`. A valid navigation-only policy can have `tools:[create_tab,navigate]`, nonempty navigation/readiness and `evidence:[]`; it can open a ready tab and prepare navigation but cannot execute it. The actuator returns `EVIDENCE_FORBIDDEN` before reaching the separately scoped navigate branch. Click/type/scroll are likewise unnecessarily tied to evidence export. This contradicts separate navigation/export authority and required A3 (`navigation_succeeded:true`, `export_rejected:true`). It also pushes deployment administrators to grant evidence access merely to permit navigation.

Focused reproduction against the actual actuator source: inspect a ready `/app` document with `evidence:[]`, then request navigation to allowed `/app/other` using that exact expected snapshot. Result: `success:false,error:EVIDENCE_FORBIDDEN`; no `tabs.update` runs. The existing tests use identical navigation/evidence scopes, masking the coupling.

Repair: apply evidence scope to text/business-screenshot modes only. Navigation and allowed DOM actions should require current business navigation scope/readiness and their own rule/destination authority without acquiring export rights. Preserve evidence denial for read/capture. Add a service-through-actuator navigation-only policy regression and a navigation-allowed/export-denied case.

Confidence: confirmed by a focused in-memory bundle of actual actuator source with controlled Chrome/DOM APIs. This case does not rely on a real enterprise site.

## Verification and reproduced outputs

Node `v22.23.2` selected through `source ~/.nvm/nvm.sh && nvm use 22`. Canonical Companion runner under `/Users/huchen/Projects/cmspark/companion`:

```sh
node scripts/run-tests.mjs .test-dist/tests/enterprise-policy.test.js .test-dist/tests/enterprise-service.test.js .test-dist/tests/enterprise-http.test.js .test-dist/tests/enterprise-bridge.test.js .test-dist/tests/enterprise-gates.test.js
```

Result: 12 tests, 12 pass, 0 failures/skips, exit 0; the runner uses temporary data directories. Existing tests passing does not refute S1–S3 because they cover changed target attributes/new document identities and matching navigation/evidence scopes, not the reproduced boundaries.

Native S1/S2 run used the existing `scripts/itcra-browser-isolated-check.mjs` machinery through an in-memory data-URL import. No reproduction source file was written. It launched a fresh temporary headless Chrome user-data profile, real CDP ISOLATED contexts and real DOM nodes, then closed Chrome and removed its profile. The extension API adapter remains simulated, as in the supplied rehearsal. No login images were saved. Measured output:

```json
{"evidence_kind":"isolated_native_chrome_with_api_adapter","same_document_replacement":{"success":true,"data":{"executed":true}},"replacement_effects":1,"after_login_transition":{"success":true,"data":{"executed":true}},"observed_state":"login_required","effects_after_login":2}
```

The native augmentation was inserted after the rehearsal's initial successful target click and before its existing target-mutation tests:

```js
await send("Runtime.evaluate", {
  expression: "const old=document.querySelector('#next');const clone=old.cloneNode(true);clone.onclick=()=>window.replacementEffects=(window.replacementEffects||0)+1;old.replaceWith(clone);"
})
const replacement = await execute("click", {tabId}, {
  mode: "act", rule, expected: inspected.data
})
assert.equal(replacement.success, true)
assert.equal((await send("Runtime.evaluate", {
  expression: "window.replacementEffects", returnByValue: true
})).result.value, 1)

policy.login.push({origin, path: "/app"})
const readyAgain = await execute("list_tabs", {tabId}, {mode: "inspect", rule})
let moveToLogin = true
chrome.tabs.query = async () => {
  if (moveToLogin) {
    moveToLogin = false
    await send("Runtime.evaluate", {
      expression: "document.querySelector('#ready').remove();const login=document.createElement('main');login.id='login';login.textContent='Synthetic QR';document.body.append(login);"
    })
  }
  return []
}
const afterLogin = await execute("click", {tabId}, {
  mode: "act", rule, expected: readyAgain.data
})
assert.equal(afterLogin.success, true)
assert.equal((await execute("list_tabs", {tabId}, {mode: "inspect", rule})).data.state, "login_required")
assert.equal((await send("Runtime.evaluate", {
  expression: "window.replacementEffects", returnByValue: true
})).result.value, 2)
```

A separate in-memory esbuild bundle of actual `enterprise-browser.ts` reproduced S1/S2 with controlled APIs and S3 without importing Companion configuration or touching user data:

```json
{"case":"same-document_target_replacement","prepared":true,"executed":{"success":true,"data":{"executed":true}},"clicked":["record-B"]}
{"case":"ready_to_login_between_snapshot_and_act","state_when_clicked":"login_required","result":{"success":true,"data":{"executed":true}},"clicked":["record-B"]}
{"case":"navigation_only_policy","state":"ready","result":{"success":false,"error":"EVIDENCE_FORBIDDEN"}}
```

Two initial reviewer harness attempts failed before exercising source: a direct preload lacked `CMSPARK_TEST_RUN_DIR`, and an incorrect in-memory CJS loader filename caused a Node assertion. A subsequent loader attempt used the wrong exports object and failed before execution. These are reviewer harness errors, not product failures; successful outputs above come from corrected in-memory loading. Canonical test results and native reproduction exited 0. Both staged/unstaged `git diff --check` passed.

## Security boundaries checked without another confirmed blocker

- Outcome: REST authenticates the concrete grant, rejects unknown/body-overflow fields, binds subject/instance/profile/policy and finite lifetime, and rejects enterprise keys on legacy raw-tab invocation. Narrow tools stay within existing profile arrays. Internal probe/inspect and separately signed human presentation are distinct from normal business tool invocation.
- Trajectory: service checks live grant/policy/session before dispatch and after results; permits bind tool/arguments/exact peer object and epoch. Exactly one authenticated extension peer is required. Reconnect invalidates old sessions. The final dispatch consumes a branded object once. Raw guard JSON is stripped; copied/mutated/cross-tool/consumed permits fail. No authority is obtained from Agent approval booleans.
- Actual gates: examined server orchestration, multi-agent pregate, cookie/download/image admissions, L2/URL permit paths, final L1 actuator selection, result origin correlation, dual-entry tab lease ownership and post-result recheck. Lease holder includes grant+session. Branded enterprise options are the intentional replacement for personal URL/L2/disclosure prompts; ordinary grant gates remain in place. S3 is the confirmed failure in browser-side mode/scope enforcement.
- Late events: cancellation/revocation/policy change/expiry are checked at service/permit boundaries; cancellation after durable dispatch is explicitly outcome-unknown and cannot promise rollback. Restart terminates pending and preserves ambiguous dispatch as terminal. Idempotency keys cannot silently change parameters and completed/unknown operations are not replayed. S2 concerns a browser state change before its actual effect, rather than a claim that cancellation can undo an already dispatched effect.
- Human authority: exact canonical Ed25519 payload, nonce, session/operation digest, grant/subject/change/instance/profile/policy/peer/expiry and purpose prevent cross-purpose proof substitution; approval/presentation is consumed before dispatch/capture. Private signer is absent from the worker SDK. No private key issuance is delegated to Agent tools. Independent ITCra authenticated human routing is still an integration obligation, not an achieved source behavior.
- Confidentiality: enterprise tool.start parameter broadcast suppressed; logger gets enterprise marker and result keys rather than URL/text/image payload. Extension errors use fixed literals. State stores claims/digests, not raw URLs/arguments/selectors/text/images. Images/text remain bounded process-memory outputs; presentation is separately signed, human-only-labelled and no-store. Reviewed producer-to-JSON fixture is honestly simulated. Original export is false/incomplete.
- Acceptance honesty: required cases/missing/fail/skip/mock fail phase validation; evidence receipts are retrieved/hash-checked/scalar-whitelisted. There is no real joint result in the current machine card. Receipt provenance and real ITCra human/SSO instrumentation still require external verification, as declared.

Review covered all 30 frozen files, including CLI/policy/grant authority, permit/service/HTTP, server/admissions/lifecycle, extension bridge/actuator, five Companion suites, extension suite, recorded fixture, ADR/research/spec/plan/contract/policy example, Python SDK and both acceptance/native scripts plus acceptance tests. No summary-only approval.

Required next step: repair S1–S3, add focused replacement/readiness/navigation-only regressions, freeze a new full source diff, and repeat independent review and machine gates. Even a later source APPROVE leaves T4 human approval and real joint bake-off outstanding.

R2 follow-up noted by the implementing parent after this review: the serialized actuator guard currently carries no finite session/approval deadline, so a dispatched call delayed inside the extension could reach its effect after authority expires. Parent intends to bind a bounded deadline into the guard and check it at the actual action/capture boundary. This additional expiry trajectory was not independently reproduced in r1; the service/permit expiry checks above must not be read as proof of extension-time expiry enforcement. R2 should include a delayed-actuator expiry negative case. Already-dispatched cancellation/revocation still cannot promise rollback.

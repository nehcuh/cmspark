# Implementation plan — #618

Approach approved: extend REST/grant. Plan applies to CMspark only; ITCra integration instructions/SDK are delivered for its owner. No live credentials/configuration are modified.

## Batch 1: authority (T3 foundation, no automatic execution yet)

1. Add `companion/src/outbound-mcp/enterprise-policy.ts`: strict bounded policy/action/authority schemas, URL canonicalization, stable digest, instance file, live policy identity. Reject aliases/path traversal, expiry, invalid keys, wrong profile and missing explicit target constraints.
2. Extend `outbound-grants.ts`: optional normalized policy on a specific grant; invalid stored enterprise policy is denied, never silently downgraded. Lookup live concrete record for rechecks; expiry/revocation work before/after waits. No caller-level borrowing.
3. Extend `grant-cli.ts`: explicit `--enterprise-config` and administrator instance registration; secret token printed once as before, permission summaries contain no raw URLs/keys. Old CLI behavior remains.
4. Add `companion/tests/enterprise-policy.test.ts`: real grant/CLI records under isolated data dir; URL/path negatives, sibling/caller/profile, expiry/revoke, malformed persistence.

## Batch 2: browser and trusted execution (T4)

5. Add `chrome-extension/src/background/enterprise-browser.ts`: actual profile UUID, probe/metadata, document and frame identities, trusted-scope markers, synchronous target matching before constrained DOM click/type, bounded evidence and screenshot checks. Export no credential values. Add Bridge interception for server-owned enterprise guard; ordinary bridge unchanged.
6. Add `companion/src/outbound-mcp/enterprise-permit.ts`: WeakSet-branded, single dispatch, immutable argument/guard digest, current live-policy recheck. Copy guard only from validated invoke option; reject JSON lookalikes.
7. Update `server.ts`, `tool/l2-admission.ts`, `tool/url-cookie-admission.ts`: trusted permit recognized at actual admissions; silence enterprise parameter broadcasts, redact raw URLs/targets in logs, preserve ordinary gates. No safety token/approval boolean supplied by the caller.
8. Update `ws/lifecycle.ts`: enterprise runner uses exactly one authenticated Chrome peer and stable peer epoch; legacy runner stays compatible; options propagate permits. No confirmation-response authority is added.
9. Add `companion/src/outbound-mcp/enterprise-service.ts`: bounded durable handles/state/idempotency/operation claims; per-session serialization; login continuation; Ed25519 challenge/presentation validation; cancellation/expiry/restart/output rechecks; action audit and no image/text persistence.
10. Add `companion/src/outbound-mcp/enterprise-http.ts` and mount in `companion-http.ts`: grant-only versioned routes, strict request bodies, async accepted versus disconnected request semantics, no-store login image responses. Reject legacy invoke for enterprise-bound keys.
11. Add `companion/tests/enterprise-service.test.ts`, `enterprise-http.test.ts`, `enterprise-gates.test.ts`, `enterprise-bridge.test.ts` and `chrome-extension/tests/enterprise-browser.test.ts`: actual producers, JSON and HTTP payloads, no manually invented output contract. Use isolated browser/profile/data namespaces, no user business data.

## Batch 3: delivery and bake-off

12. Create `docs/itcra-enterprise-browser-contract.md`: exact API/envelopes/errors, signing canonicalization, permitted tools/targets, login scope and compatibility, restart/unknown-outcome semantics, ITCra adapter/UI/RBAC/checkpoint integration.
    Add ADR `docs/adr/029-itcra-enterprise-browser-authority.md` and isolated native Chrome rehearsal `scripts/itcra-browser-isolated-check.mjs` for document/target/CDP assertions. Rehearsal uses a fresh profile and a declared extension-API adapter, not real enterprise SSO evidence.
13. Create `scripts/itcra-browser-acceptance.mjs`, `scripts/tests/itcra-browser-acceptance.test.mjs`, `docs/examples/itcra-enterprise-policy.json`, `examples/itcra-enterprise-client.py`: restricted credential-file injection, explicit p0/all required sets, missing/fail/skip nonzero, evidence category and hashes, human presentation/approval never model approve tools.
14. Record sanitized real producer fixtures under `companion/tests/fixtures/enterprise-browser/`; add deployment/offline/identity/revoke instructions to contract. A12 file export must either deliver verified original workbook coverage via authorized export or remain an explicit missing P1 outcome; do not claim webpage completeness.
15. Test/build on Node22 host plus Linux ARM64, actual isolated Chrome bridge tests, supply-chain/build compatibility. Independent adversary reviews same full frozen diff; Pi reads complete report+diff; Kimi supplementary. Prepare PR with gaps and real joint results accurately classified. T4 human review/bake-off before merge.

If a planned trust boundary fails its adversarial case, return to this plan and repair the contract before implementation. Missing live ITCra/SSO credentials blocks real joint acceptance, not isolated code/test work.

## Review round 1 repairs (return to Plan)

Both independent reports REJECT with native/scripted counterexamples. Same file scope: isolate-world WeakMap node identity in target snapshot; readiness/login and finite session/approval deadline in the atomic act/capture boundary; initialize profile UUID on ordinary Bridge startup with retry after storage failure; navigation uses navigation/login source scope independently of evidence/readiness, with no data export. Preserve the original requested business target privately during SSO waiting, restore it at most once if callback lands elsewhere, then fail explicitly instead of collecting another document. Extend existing service/bridge/native/acceptance tests for these counterexamples. Acceptance receipts must collectively back every required observation, retain measured metadata, and discovered workbook_export=false hard-fails A12. Freeze new full source diff only after machine checks, then both independent rereviews before Pi/Kimi.

2026-10-13 SSO steering: user supplied `https://sso.cmschina.com.cn/login.aspx`; treat as exact login scope input, not a completed real-login test or new deployment instruction. Automatic routing diagnostic 6104dbb7-b37 split the quoted question into deployment/fallback steps and marked unavailable skills; that blocked diagnostic plan is not executed. Required deep-diagnosis skill source exists/readable and was reloaded. Refined route resolves single builtin/deep-diagnosis-optimization (source_file verified); rebuild continues these exact repair steps plus machine/native ARM64, independent adversaries, Pi/Kimi, CI, and T4 human/real-bake-off gates. Existing RIPER/eval-gate files remain available. No verification step is removed.

## Review round 2 repairs (return to Plan)

Same source scope. Bind immutable instance registration to explicit business subject; enforce at grant issue and live use, with old unbound records denied. Update CLI, contract and policy tests. Multiple ITCra humans may share the same registered business subject only through ITCra RBAC.

For SSO continuation, freeze the verified current business URL at prepare rather than stale open/explicit-navigation cache. Extension keeps bounded private owned-tab navigation observations (navigation scope excluding login, or actual ready snapshot); expose only internal last_business_url, never durable/public URLs. Preserve an operation's pre-login target through callback redirects. While waiting_login, inspect readiness without the action rule, restore original destination at most once under navigate authority, then inspect/bind its target; dangerous tasks require fresh signed approval. Clear obsolete error_code on successful rebind/completion. Add actual producer event, completed-click A→B/read B, pending-during-login B, callback without targets for click/type/write, late pre-effect resume, private persistence and wrong-subject regressions.

Rerun targeted and full host checks, fresh Linux ARM64 build/tests, native Chrome rehearsal and acceptance validator. Freeze r3 full diff then independent security/product rereviews, Pi and Kimi. Real enterprise SSO probe is read-only in fresh browser; no credentials or QR are consumed by the model. Keep T4 human + real joint bake-off gate.

## Review round 3 repairs (return to Plan)

S6 confirmed by independent separate OS processes: move authentication last-used metadata to separate private per-grant usage files in outbound-grants.ts, leaving authority JSON read-only in verification. Public listing overlays valid usage timestamp for compatibility. Serialize all supported authority writers (issue/revoke/revoke-all) with exclusive local lock acquired before load through atomic commit; contention returns explicit GRANT_STORE_BUSY, unavailable storage explicit error, never unsafe automatic stale-lock removal. Crash recovery requires operator quiescence, not timeout lock stealing. Add companion/tests/outbound-grant-concurrency.test.ts actual child-process auth vs revoke/revoke-all/policy change and actual held issuer vs contending writers; tests control timing, not replace production authority logic. Existing legacy/context/disclosure/CLI tests and both full host/build/ARM regressions.

S7/C7: enterprise-browser.ts invalidates private destination when a changed URL overlaps navigation/login scopes and differs from the known requested/ready target. Add internal business_target_unavailable metadata; enterprise-service.ts deletes stale session destination on this signal and rejects prepare during login with RETURN_TARGET_NOT_RETAINED. Marker-confirmed ready document resets history; explicit requested target and verified same-URL modal login remain supported. Unknown cross-route overlapping login cannot choose A or export evidence. Extend actual producer→JSON→service regression and native Chrome overlap negative/recovery positive; preserve disjoint-path, ready-B, same-URL and callback-target positives.

Update contract/ADR/spec with grant mutation/usage semantics and explicit unknown-target support limit. No general tool/authority expansion, no live policy or foreign source edits. Rerun MACHINE then freeze complete r4 diff and both independent adversaries before Pi/Kimi/CI/T4 human+real bake-off.

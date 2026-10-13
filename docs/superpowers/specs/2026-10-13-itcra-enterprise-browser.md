# ITCra enterprise browser v1 (#618)

User selected extension of the existing REST/grant path on 2026-10-13. Baseline: main e44af42f plus research commit c2b41bcd. Source handoff v1.1 SHA25652010d7a4ba59134e33263b271040e10a762157b177b3073185b4f78adb068b7. Issue predates this spec.

## Product and ownership

Authorized normal actions run without desktop approval. Login images go only to authenticated ITCra human presentation; business evidence is separate. Dangerous actions require an independently signed, single-use human attestation and never an Agent boolean. CMspark owns the policy, browser/session/operation API, verification, fixtures, acceptance runner and integration contract. ITCra owns its authenticated UI/RBAC and saved review checkpoint integration. Supplied project directories authorize locating local deployments; they do not constitute evidence of enterprise SSO acceptance.

## Chosen boundaries

- One dedicated Chrome profile per user or explicitly authorized business identity, paired to a separate Companion data directory/port. Administrator registers server instance and actual extension profile UUID. Multiple authenticated Chrome peers are ambiguous and refused. Peer replacement invalidates old sessions; tab numbers from another browser never become authority.
- Enterprise policy is stored on the concrete grant, with fixed subject/business identity, instance/profile, policy revision, finite expiry, canonical origin/path navigation, evidence and login scopes, a subset of existing profile tools, site readiness/login markers and administrator action rules. No general outbound profile expansion (#228). Instance registration immutably binds the fixed business subject; old unbound/conflicting subject records fail closed at issuance and live use.
- Normal/dangerous interaction classification uses a fixed administrator rule and actual target attributes/document/navigation. Unknown rules, credential fields, mismatched targets or unclassifiable effects are blocked. Normal selectors represent administrator-verified read-only effects; arbitrary selectors/coordinates/scripts are not enterprise input.
- Service-owned session/operation handles, immutable argument/target digest, grant/identity/instance/profile/policy bindings. Prepare has zero business side effects; execution is claimed durably once before dispatch. Repeating a key returns the existing record. Ambiguous dispatched outcomes are terminal and never automatically repeated.
- Ed25519 public authority key is registered locally. ITCra's private signing key is separate from execution grants and only available to its authenticated human backend. Approval binds operation/challenge/digest/subject/grant/session/instance/revision/nonce/expiry. Presentation has a separate signed audience and cannot approve actions.
- Existing URL/L2/exfil/lease/execution gates consume an unforgeable in-process permit minted after live grant/policy checks. Model parameters are stripped of enterprise flags. Ordinary grants retain existing HITL. Every dispatch/output rechecks live authorization, exact peer and target.
- Redirect and same-origin login supported through configured markers, never origin alone. Authentication iframe/popup scope is declared and either verified by a supported adapter or explicitly unsupported; unknown is never ready. Waiting operations resume within the original session after readiness, without rerunning completed actions.
- Non-active screenshot uses the correct owned tab. Wrong-tab fallback is refused. Login images are no-store, human channel only, never retained in state/audit/fixtures/models. Text reads omit login/out-of-scope frames and report incomplete visible-document coverage.
- Restart explicitly terminates waiting sessions/approvals; executing operations become outcome-unknown, completed metadata stays queryable without claiming retained plaintext. It does not dispatch old pending requests or replay approval. State corruption fails closed instead of resetting idempotency.

## API

Versioned namespace `/outbound-mcp/v1/enterprise`: capabilities, session open/status/login-snapshot, operation prepare/status/execute/cancel. All require the concrete cmg grant, except human-signed proof is additionally required for presentation and dangerous execution. No ws_secret fallback. Old enterprise-bound grants cannot use ordinary raw-tab invoke as an escape hatch. Contract has explicit feature discovery; installed0.6.13 without discovery is unsupported rather than guessed compatible.

## Acceptance

P0 A1–A11,A13–A24; phase=all adds A12. Isolated machine cases cover policy/URL aliases, grant siblings, wrong identity/profile/tab/peer, restart/expiry/revoke, normal prompt counts zero, actual same-tool read/write separation, valid/denied/tampered/replayed/cancelled/expired approvals, exactly-once effects, login resume, capture changes and old HITL. Real Bridge→JSON→HTTP producer outputs provide fixtures. Real enterprise SSO and ITCra UI/RBAC/resume evidence are separate from simulated tests. Required missing/skipped/failed cases make the joint report fail; no synthetic evidence is promoted to real.

T4. Machine→independent adversary→Pi, Kimi and native ARM64 verification precede reviewable PR. Concrete human approval and bake-off are required before merging the complete enterprise authority feature. No production policy issuance, installed application replacement or public deployment occurs as a side effect of development.

ADR-020: Surface authenticated enterprise REST/admin CLI; L2 constrained existing browser capabilities and bound human proof; Compose grant×subject×instance×session×target; Autonomy explicit normal actions and pending-task continuation only; Trust deny by default/current authority/single use; Channel existing authenticated extension bridge, separately authenticated human presentation.

Authority persistence: authentication usage is separate metadata; supported grant issue/revoke writers serialize load→commit across processes with explicit contention. Revocation/policy state cannot be rolled back by usage telemetry. Ambiguous same-origin cross-route login without trusted requested/current destination fails RETURN_TARGET_NOT_RETAINED and emits no earlier document evidence; explicit intent and qualified same-URL login remain supported.

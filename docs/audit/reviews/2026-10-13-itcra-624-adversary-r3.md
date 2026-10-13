# Independent adversarial review: #624 capacity recovery, r3

Reviewer: Codex independent diagnosis/review agent, not the implementer. Source read-only; this report is the only artifact written.

Base: `20a8bdd73630c151a29fbab04992674000ae0f02`.
Complete frozen diff: `/tmp/cmspark-624-r3.diff`,582 lines; independently verified SHA256 `7ed35a331a37d40dae989df26dff6f4e7bd6d97ac5762f89752efc4a9db59e1e`.
Machine card: `/tmp/cmspark-624-machine-r3.json`.

## Scope and evidence

Read the complete frozen eleven-file diff, the full Kimi r2 review `/tmp/cmspark-624-review/kimi-r2.md`, the fresh machine card, and adjacent authority writer/reader, enterprise state/service/HTTP, production shutdown, daemon termination, extension history and atomic persistence context. Where a combined tool read was truncated, reread the omitted diff section separately; no approval is based on the parent summary alone.

The card reports full host5915 tests /5863 pass /52 existing skips /0 failures; targeted38/38; fresh Linux ARM64 38/38 with build exit0; host build exit0. Parent performed those runs. This reviewer did not independently rerun the full suite. Prior independent Node22.23.2 module-resolution verification still applies: compiled test context resolves the child module to `.test-dist/src/outbound-mcp/enterprise-state.js`, not a `.ts` source file.

Review is limited to the T3 local administrator recovery component. It is not overall PR#626 merge approval; unfinished ITCra human-channel/RBAC and real joint acceptance remain separate T4 gates.

## Findings

No confirmed component correctness/security defect or necessary nit remains.

The r1 production shutdown blocker remains fixed in the complete r3 snapshot: `ws/lifecycle.ts` calls `closeEnterpriseHttp()` before awaited teardown; that function permanently fences enterprise admission and closes only an existing singleton. Both HTTP entry and lazy singleton creation reject after shutdown starts. Normal stop therefore releases the state lock, while late requests cannot recreate it.

The Kimi r2 remaining grant-lock nit is fixed in r3. `mutateGrants()` now captures dev/inode from the owned open descriptor and unlinks only when `lstatSync` identifies the same regular file; ENOENT is tolerated, other cleanup failures surface, and the descriptor is closed in finally. The descriptor remains open through comparison/unlink, matching the state-writer guard. The new test enters the actual locked `withRevokedEnterpriseGrants()` callback, explicitly replaces its lock as an administrator fault injection, then proves exiting the old authority writer preserves the successor lock and that another real revocation fails GRANT_STORE_BUSY. This exercises the production helper rather than only testing a copied lock algorithm.

Under supported operation no writer removes another live owner's lock. These guards also prevent the tested delayed old-owner cleanup from deleting a replacement. The documented mandatory offline quiescence remains necessary; inode comparison is not being presented as authorization to perform live lock removal.

## DoD and adversarial trace

- Both128-session/1024-operation cap tests create claims through actual service producers. Existing idempotent requests are found before the cap check; overflow leaves durable state unchanged. No terminal or pending claims are silently evicted.
- Service state writer lock is acquired before reading/recovering state and held for instance lifetime. Competing services/rotation reject STATE_BUSY; real separate-process contention exercises the actual module. Repeated close cannot release a later owner.
- Explicit close sets a permanent instance fence before abort/release. Authority, persistence, scheduling/tick and existing dispatch permit rechecks enforce it. Held probe completion after rotation cannot create a tab or overwrite active/archive files. An already-dispatched effect remains ambiguous and is not replayed.
- Production shutdown closes the real lazy HTTP owner before async teardown and denies late admission without recreating it. Actual loopback coverage checks no lock for an uninitialized shutdown, lock creation on first request, lock removal, repeated503/SERVICE_SHUTTING_DOWN and fresh lifecycle restart.
- Rotation is a strict local CLI action with required --quiesced and unknown-argument rejection; no recovery HTTP endpoint or new outbound tool/profile exists. The acknowledgement explicitly depends on administrator-confirmed actual browser/process shutdown.
- State-lock→grant-lock ordering has no inverse supported path. Revoked-authority inspection and archive/reset execute inside the same authority transaction, excluding supported issue/revoke writers during the decision. Every referenced grant must exist and have a valid explicit revoked timestamp. Merely expired, missing or corrupt authority does not permit reset.
- Shared8MiB bounded read envelope covers maximum bindings/challenges for the structured128/1024 limits. File size is checked before reading and against resulting bytes. Malformed rotation entries normalize to STATE_CORRUPT before any archive or replacement.
- A unique non-overwriting0600 archive in a0700 directory is written and flushed before atomic reset. Archive-open/reset-rename faults preserve original state bytes and release owned locks. Old state is an operator record, not a replay source.
- New grant/request namespace supports fresh work; old bearer, session/operation handles and proof paths fail before additional effects. Revoked grant records remain revoked. Recovery does not revive prior browser output or return-target evidence.
- Documentation requires stopping Companion AND closing the dedicated enterprise browser/profile, accounts for ambiguous already-dispatched outcomes, and explains the extension's independent128-owned-tab-history budget. Companion JSON rotation alone is not described as recovering extension history.
- Crashed writer lock recovery stays offline/manual; no PID/age-based lock stealing, automatic ambiguous retry or authority downgrade was added.

## Evaluation layers

Outcome: supported rotation after explicit revocation and actual quiescence restores bounded capacity and fresh work while rejecting old namespaces. Ordinary production stop/restart now works with the new lifetime lock.

Trajectory: source preserves claims until administrative revocation, private archive before reset, writer exclusion, close/shutdown fences and no replay. The final sibling grant-lock cleanup fix removes the remaining reported nit without expanding capability.

Component: host/Linux/build machine evidence is green on this exact frozen diff. Tests cover actual producers, cap boundaries, process contention, replacement-owner preservation for both locks, late work, production lazy singleton shutdown and failure preservation. No source defect identified during this independent final review.

Approval is for this component snapshot only. A later source change requires renewed diff/machine/review gates. CI on the final PR head, human review and real joint acceptance remain required before overall#626 merge.

VERDICT: APPROVE

# Independent adversarial review: #624 capacity recovery, r1

Reviewer: Codex independent diagnosis/review agent, not the implementer. Read-only source review; this report is the only file written.

Base: `20a8bdd73630c151a29fbab04992674000ae0f02`.
Frozen diff: `/tmp/cmspark-624-r1.diff`, 426 lines; independently verified SHA256 `f670aa8c0260c7416c19e10b28543bfd89c8c0fc29c14575d3910ec57872febb`.
Machine card: `/tmp/cmspark-624-machine.json`.

## Scope and evidence

Read the complete frozen diff, including all eight source/test/document paths. Read adjacent service lifecycle, enterprise HTTP singleton, grant persistence/verification, atomic file writer, CLI argument validation, extension managed-tab history, daemon shutdown, and production WebSocket/server shutdown. Machine evidence reports host 5912 tests / 5860 pass / 52 existing skips / zero failures; targeted 35 pass; fresh Linux ARM64 35 pass and build success; host build success. Those runs were performed by the parent; this reviewer did not claim an independent rerun.

This is the T3 local administrative capacity recovery component. Unfinished ITCra UI/RBAC and real joint acceptance are outside this batch's defect scope, and this review makes no overall PR #626 merge-ready claim.

## Confirmed finding

### [P2] Release/fence the enterprise singleton on production graceful shutdown

Changed location: `companion/src/outbound-mcp/enterprise-service.ts:49` (lifetime persistent state lock acquisition); corresponding release at lines 76–81 depends on `close()` being called.

The production owner is the lazy singleton in `companion/src/outbound-mcp/enterprise-http.ts:10–23`. Its only close calls are the configuration-directory replacement and `resetEnterpriseHttpForTests()`. Neither the frozen diff nor adjacent production shutdown connects it to normal daemon termination. `companion/src/ws/lifecycle.ts:1625–1677` shuts down ACP, MCP, history, WebSocket/HTTP and daemon locks, but never closes this enterprise singleton. `companion/src/daemon.ts:502–525` exits after that callback with `process.exit(0)`.

Concrete sequence: start Companion, send an authenticated enterprise request (including capabilities), which constructs the singleton and creates `enterprise-browser-state.json.lock`; stop Companion normally using its graceful daemon stop/SIGTERM; start Companion again or run the documented rotation command. The enterprise lock file persists because Node descriptor closure does not unlink the filename. New service/rotation therefore returns `STATE_BUSY`. The published recovery procedure's normal stop → revoke → rotate sequence fails unless the operator additionally performs the stale-lock repair documented only for a crashed writer. Ordinary stop/restart also regresses even when no capacity limit was reached.

Required fix: add an explicit production enterprise shutdown function which closes an already-created singleton and permanently fences new enterprise admission during shutdown without constructing a missing singleton. Call it before asynchronous teardown. Do not reuse the test reset function as-is: clearing the singleton alone lets another request lazily create a new service while ACP/MCP/HTTP teardown awaits. Add a meaningful production lifecycle test covering first request → graceful shutdown → lock released, request during teardown denied without recreation, then restart or rotation succeeds. Genuine crashed-process stale-lock recovery must remain manual/fail closed.

## Checks which hold

- Recovery acquires state lock before read and uses the grant writer lock around strict authority inspection, archive and reset. Supported issuer/revoker writers cannot change authority between inspection and replacement.
- Referenced missing/unrevoked/expired-only grants cannot justify reset; malformed authority is not silently interpreted as revocation. Valid explicit revoked timestamps are required.
- Session/operation claims remain intact at both caps; rotation is an explicit local administrator action, with no new HTTP endpoint, outbound tool, or expanded profile.
- The irrevocable per-instance close fence precedes abort/release and is checked by authority, persistence, scheduling/tick and the existing dispatch permit rechecks. The late-probe and dispatched-effect tests exercise actual service paths; old instances cannot persist over the fresh store after close.
- Repeated close does not remove a subsequent owner's lock under the supported ownership protocol. Separate-process contention exercises the actual lock module.
- Archive uses a unique non-overwriting file, mode0600, inside a mode0700 directory; archive is flushed before replacement. The tests inject archive open failure and reset rename failure, preserving original claim bytes.
- Fresh grant namespaces reject prior tokens/handles/approval paths; a dispatched ambiguous operation is archived without replay. Archive remains a record for operator reconciliation, not a resumable work queue.
- Documentation accurately requires Companion AND dedicated browser quiescence, distinguishes writer exclusion from actual browser stop, and explains the independent extension128-tab-history cap.

## Evaluation layers

Outcome: component recovery succeeds in the directly instantiated service tests, but the real production graceful stop/restart/recovery path is broken by the confirmed lifecycle finding.

Trajectory: no automatic eviction, authority downgrade, silent lock stealing, or automatic replay was introduced. The explicit local-admin revocation/quiescence protocol is appropriate. The missing shutdown connection defeats the intended operational trajectory and must be repaired before this batch is approved.

Component: locking, strict revoked-only check, failure preservation and close fences are otherwise coherent. Machine coverage meaningfully tests cap boundaries, producer-created claims, cross-process contention and late async completions, but currently substitutes explicit test `close()` for production singleton teardown.

No separate style/opinion findings. No assertion that the remaining T4 joint acceptance or PR merge gate has passed.

VERDICT: REJECT

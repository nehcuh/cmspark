# Independent adversarial review: #624 capacity recovery, r2

Reviewer: Codex independent diagnosis/review agent; not the implementer. Read-only source review. This report is the only written artifact.

Base: `20a8bdd73630c151a29fbab04992674000ae0f02`.
Complete frozen diff: `/tmp/cmspark-624-r2.diff`, 552 lines; independently verified SHA256 `aea43d7ec17617bde22808dfe6be4ef71842c5e018cb50895c066c0d6ea68ef2`.
Machine card: `/tmp/cmspark-624-machine-r2.json`.

## Scope and method

Read the entire frozen diff across eleven paths, not only the r1→r2 incremental fixes. Read adjacent complete enterprise HTTP handling, service admission/persistence/permit dispatch and async operation lifecycle, grant writer/verification/issuance/revocation, daemon graceful shutdown, production server shutdown, extension owned-tab history, atomic JSON helper, compiled-test runner and tsconfig. Read the complete Kimi r1 report `/tmp/cmspark-624-review/kimi-r1.md` and cross-checked its claims against actual source/runtime.

Machine card reports: full host5914 tests,5862 pass,52 existing skips,0 failures; targeted37/37; fresh Linux ARM6437/37 and build exit0; host build exit0. Parent ran these tests; this reviewer did not claim an independent full rerun. Independently ran a read-only Node22 module-resolution check described below.

Scope is T3 local administrator capacity recovery only. ITCra UI/RBAC and real joint acceptance remain separate T4 work. This report does not approve overall PR#626 merge or claim real enterprise acceptance.

## r1 blocker disposition

The confirmed r1 P2 production graceful-shutdown defect is fixed.

`companion/src/ws/lifecycle.ts` imports `closeEnterpriseHttp` and calls it at the very beginning of the production shutdown callback, before any awaited ACP/MCP/history/HTTP teardown. `companion/src/outbound-mcp/enterprise-http.ts` sets `shuttingDown=true` before closing an existing singleton, never constructs a missing singleton to stop it, and denies both HTTP entry and lazy service creation after shutdown begins. Existing service `close()` sets the irreversible per-instance fence before abort/release. Consequently ordinary daemon stop releases the state lock; late HTTP requests cannot reacquire it during teardown.

The new actual loopback HTTP test creates the production lazy singleton through a capabilities request, observes lock creation, closes it, proves repeated requests receive503/SERVICE_SHUTTING_DOWN without recreating the lock, then simulates a fresh module lifecycle through the test reset and obtains a new writer successfully. It also checks shutdown before first request does not create a lock. Production call-site placement was verified by adjacent source inspection.

## Other Kimi r1 findings disposition

1. Replacement-lock release: new state lock captures the open descriptor's dev/inode, compares the current path using `lstatSync`, and unlinks only the same regular file while the original descriptor remains open. Explicit administrator replacement fault injection verifies that the original owner's close does not remove the successor lock. Repeated close also cannot release a newer owner's lock. The pre-existing grant writer helper's analogous manual-replacement concern is outside this batch; supported recovery forbids live lock removal.
2. Malformed rotation-entry error normalization: entry iteration/identifier failures now normalize to STATE_CORRUPT before archive/reset. Invalid data remains fail closed, original state intact.
3. Full-store byte budget: both restart loading and rotation share ENTERPRISE_STATE_BYTES=8MiB, checked before file reads and again against actual bytes. This comfortably covers1024 bounded maximum-field approval challenges plus128 bounded sessions, rather than assuming a minimal fixture's2MiB envelope. Structured128/1024 limits remain enforced.
4. Claimed runtime TypeScript-loading dependency is false. `companion/tsconfig.test.json` emits source/tests into `.test-dist`; the canonical runner executes compiled `.test.js` paths. The test's `require.resolve('../src/outbound-mcp/enterprise-state')` is therefore relative to `.test-dist/tests`, not the TypeScript source directory. Independently checked with Nodev22.23.2 and `createRequire` anchored to the compiled test: it resolves `/Users/huchen/Projects/cmspark/companion/.test-dist/src/outbound-mcp/enterprise-state.js`. No TypeScript strip-types support is needed for the spawned child.

## Adversarial checks and DoD

- Both cap boundaries retain existing claims before denying new work; idempotent lookup precedes capacity rejection. Tests use producer-created128 sessions and1024 pending write operations and assert unchanged durable state on overflow.
- Lifetime state writer exclusion precedes read/restart recovery/save. Rotation uses the same lock and is rejected while a live service owns it. A real separate-process test exercises actual lock contention.
- Local administrative quiescence acknowledgement is required. No recovery HTTP endpoint, outbound tool, or profile expansion was added. Documentation says writer exclusion does not prove browser shutdown, and requires stopping Companion and the dedicated enterprise browser.
- State lock→grant writer lock ordering is coherent. Every referenced grant must exist and have an explicit valid revoked timestamp; expired-only/missing/corrupt authority does not justify clearing claims. Supported grant mutation is excluded through archive/reset, and revocation remains durable afterwards.
- Archive is unique/non-overwriting0600 in a0700 directory; file is flushed before atomic active-store replacement. Archive-open and reset-rename fault injection preserve original state; archives do not turn into executable work queues.
- Closed service cannot authorize, save, schedule/tick or dispatch through existing permit rechecks. Held-probe completion after close/rotation cannot create a tab or overwrite the fresh store. An already-dispatched effect remains an archived ambiguous claim and is never replayed.
- Fresh grant creates a distinct request namespace. Prior bearer fails verification; prior handles are unavailable; prior approval cannot authorize a fresh operation. Tests cover no revival and zero additional effects.
- Extension has its own128-history budget. The recovery procedure explicitly closes old tabs/profile to recover it; Companion-only JSON reset is not described as sufficient.
- Stale-lock recovery remains explicit/offline, not age/PID based stealing. Manual modification of a live state/authority store is outside the supported protocol. No hidden permission downgrade or automatic retry of ambiguous effects was introduced.

## Evaluation layers

Outcome: capacity can be restored through supported administrator rotation after explicit revocation and actual process/browser quiescence, while old authority/claim namespaces remain unusable.

Trajectory: mandatory quiescence, revoked-only locked authority validation, private archive-before-reset, permanent close/shutdown fences and no replay all hold. The former production stop/restart break is repaired at its real lifecycle call site.

Component: tests exercise real service-produced claims, both budgets, writer contention, async late completion, archive failure preservation and the production lazy HTTP owner. Build/host/Linux machine evidence is green on the reviewed snapshot. No confirmed correctness/security defect or necessary nit remains in this batch.

This is source-component approval, not CI/head/human/joint-acceptance approval for PR#626. Source changes require a new frozen diff and refreshed gate evidence.

VERDICT: APPROVE

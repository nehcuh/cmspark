All checks complete. Summary of the review:

## Verification performed

**R2 scope (commit `304d33d`, patch confirmed identical to live git diff — not stale):**

1. **C1 restart residual** ✅ — `captureCruiseSnapshot` persists a 0o600 atomic tmp+rename file to `DATA_DIR/unattended-cruise-snapshot.json` (unattended-grant.ts:146-160); `reconcileUnattendedCruiseOnBoot` (unattended-grant.ts:208-224) is wired into `startServer` (server.ts:6572-6601); restore/discard both clear the file (unattended-grant.ts:166,184). Ordering is safe: the boot reconcile only fires when the file exists, which implies DATA_DIR exists (persist does `mkdirSync` recursive), so `saveConfig`'s `atomicWriteJSON` works even though the reconcile block runs before `initServices()`.
2. **Bare disarm fix** ✅ — `restoreCruiseFromSnapshot` no-ops without a snapshot unless `forceNull` (unattended-grant.ts:192-196); message-router gates on `had_grant || hadSnapshot || clear_cruise===true` (message-router.ts:3286-3294); `disarmUnattended` now reports `had_grant` and it is stripped from the public status response. Settings' `clear_cruise:false` non-unattended tier path now safely no-ops on bare disarm.
3. **Tests** ✅ — 29/29 unattended-grant (incl. 3 new r2 tests: bare-disarm no-op, forceNull wipe, durable-file boot reconcile), 63/63 security-gates, `tsc --noEmit` clean.

**R1 regression spot-checks:** C5 pack-engine phrase gate (pack-engine.ts:1618), C6 `WORKER_HARD_DENY` re-enforce (thread-manager.ts:862), C7 `normalizeShellCwd` (shell.ts:201), C8 `normalizeNetsecPorts` (scan.ts:20) all intact; those files are untouched by this commit. C1 lifecycle traced end-to-end including TTL-expiry-then-disarm ordering (exactly-once restore, no double-restore).

**ADR-020 checklist:** capability declared in prompt (Surface L2 / pack phrase / Autonomy lifecycle / Trust restore+boot); no new tools, gates, or primary UI; no `securityConfirmations.request` changes; trust monotonicity preserved (three-flag cruise remains sole waive path; the change only removes a clobber, never loosens); Pack-first and no-new-runtime hold. C10 deferral with FREEZE comments is acceptable per scope.

## Non-blocking nits

1. `resetUnattendedGrantForTests()` (unattended-grant.ts:123-129) resets the path override to null **before** calling `clearCruiseSnapshotFile()`, so running the test suite on a dev machine with a live armed session would delete the real durable snapshot — leaving dual-written cruise flags in place after restart (fail-open direction). Test-only and low-probability, but the hook should clear via an override or a guarded path.
2. The actual message-router gating fix (`had_grant || hadSnapshot || clear_cruise`) has no direct integration test — only the primitives are unit-covered. A test sending a bare `security.unattended.disarm` message and asserting flags unchanged would lock in the r2 behavior.
3. Minor doc drift: `reconcileUnattendedCruiseOnBoot`'s doc comment says "after … initDataDir" but the call site runs before `initServices()`; functionally safe (file existence implies dir existence), but the comment is misleading.

VERDICT: APPROVE_WITH_NITS

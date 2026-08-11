All 30 unattended-grant tests pass, including the 4 r2 lifecycle tests + the new `shouldRestoreCruiseOnDisarm` unit test. (The earlier computer-executor/computer-uia-watch failures are pre-existing in this worktree, untouched by r3 — not a regression.)

## Verification matrix

**1. `resetUnattendedGrantForTests` file/path order — FIXED.** unattended-grant.ts:129-130 now calls `clearCruiseSnapshotFile()` while `cruiseSnapshotPathOverride` still points at the test path, then nulls the override. No risk of unlinking a real `DATA_DIR` snapshot during test runs.

**2. `shouldRestoreCruiseOnDisarm` pure gate — DONE.**
- Pure boolean predicate at unattended-grant.ts:210-216 (no side effects, no I/O).
- Wired into message-router.ts:292-299 replacing the inline `status.had_grant || hadSnapshot || rest.clear_cruise === true`. Logic preserved verbatim (3 OR conditions). The hoisted `clearCruise` const (line 291) replaces the prior `void rest.clear_cruise` consumption marker.
- Unit-tested with all 4 boolean combinations at computer-unattended-grant.test.ts:366-372 (passing).

**3. Boot reconcile comment accurate.** unattended-grant.ts:218-223 now reads "Call after registerCruiseRestoreHandler. Safe before full initServices — file presence implies the snapshot dir already existed (persist does mkdir recursive)." Verified against `persistCruiseSnapshotFile` line 71 (`fs.mkdirSync(path.dirname(p), { recursive: true })`). Comment matches reality.

**4. No regression.**
- Durable snapshot still persisted on arm (captureCruiseSnapshot→persistCruiseSnapshotFile, lines 149-157).
- Boot reconcile wired at server.ts:6577-6590 with handler registration first.
- Bare disarm no-op confirmed by `no snapshot → restore without forceNull is no-op` test.
- TTL-expire-then-disarm ordering unchanged (expireGrantIfNeeded → restoreCruiseFromSnapshot once via expireRestoreDone gate).
- 30/30 unattended tests pass; r1 regression spots (C5/C6/C7/C8) untouched by this commit.

**5. Wave 0–2 COMPLETE.** r1 approved Wave 0–2; r2 confirmed bare-disarm + C1 residual fixes; r3 only absorbs the 3 Pi r2 nits. C10 god-file split explicitly DEFERRED with FREEZE comments — acceptable per scope.

## ADR-020 checklist
- Diff is pure refactor (extract pure predicate) + test + comment fix → no Surface/Compose/Autonomy/Trust/Channel declaration required (checklist exempts "pure docs/test/refactor").
- No new tools, gates, or primary UI. No `securityConfirmations.request` changes. No Pack-first concern.
- Trust monotonicity preserved: the change only removes a clobber bug (bare disarm wiping flags); it never loosens any gate. Three-flag cruise remains the sole waive path.
- P1 watchlist: P1-1 (auto_approve) — diff reads but doesn't change gate logic; P1-2/P1-3/P1-4 untouched.

No blocking issues. No non-blocking residual worth flagging — all three Pi r2 nits are absorbed faithfully and the pure-gate extraction is arguably stronger than the requested integration test.

VERDICT: APPROVE

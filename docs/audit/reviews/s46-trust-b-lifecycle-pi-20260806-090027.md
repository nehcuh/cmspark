I've completed a full inspection of the diff, the live working tree, and the relevant code paths. Summary of verification:

**Verified correct (acceptance criteria):**
- **P0-1 restore on leave** — `unapplyPack` (pack-engine.ts:1433-1458) restores from thread cookie + releases journal; `uninstallPack` (1484-1502) reads cookie before `restoreSnapshot` nulls it; `deleteUserPack` delegates to `uninstallPack` (940-957); switch A→B restores A's trust before writing B (1210-1216). Tested (uninstall, switch→non-trust, A→B both trust).
- **P0-2 failure paths** — trust-apply fail, blocked, assets-fail, patch-fail all `restoreTrustFromThreadCookie` + `clearTrustJournal` (1266-1273, 1288-1292, 1340-1343, 1407-1410). Journal written `applying` before the durable `saveConfig` (1248).
- **P0-3 install strip** — `sanitizeManifestForInstall` forces `origin:installed` (unless builtin) and deletes `trust` (395-414); `rewritePackYaml` omits trust (417-447); zip delegates to directory path (1050+); post-rename defense-in-depth re-check (1012-1020). Tested with a spoofed `origin:user` + `trust.skip_l2` pack.
- **P0-4 spawn** — `applyPack` defaults `allowTrust:false` (1206); spawn passes explicit false (server.ts:3213-3217); UI `pack.apply` and save+apply are `user_gesture`-gated with `allowTrust:true` (message-router.ts:1960, 2069); `pack.apply` exists only in the WS RPC schema, not LLM tool definitions. Tested (allowTrust:false no-elevation + control).
- **Residuals 5-9** — single holder `trust_holder_conflict` (1225-1238, tested); journal `applying`/`held` + `reconcilePackTrustOnBoot` (263-356) wired into `initServices` (server.ts:555-570, both branches tested); Downloads now home-bounded (skill-install.ts:96-130, evil-segment test added); UI honesty (has_trust badge/modal, high-risk copy) — data flows through `pack.list` → `PackListItem` → `confirmPack`; docs updated (ADR-020, architecture §7.5, mission-pack-usage §2c/§10, design SoT D4).
- **Tests**: `npx tsx --test` on both files — 32 pass, 0 fail (re-ran myself).
- **ADR-020 declaration present** (Surface n/a / Compose pack / Autonomy single / Trust gated / Channel unchanged). No new confirm family (originWs n/a — no `securityConfirmations.request` touched). No "中层 Agent" language, no new Side Panel chrome.

**Non-blocking nits:**

1. **Thread-delete / `cleanup_empty` leaks Trust** — `thread.delete` (message-router.ts:1076) and `thread.cleanup_empty` (1078-1086) call `threadManager.delete()` (thread-manager.ts:319-333) with no `unapplyPack`/cookie-restore/`releaseTrustJournalIfMatch`. Deleting the trust-holding conversation leaves global elevation + an orphaned `held` journal until next boot; if another trust pack is applied in-session first, its `captureTrustSnapshot` bakes in the stale elevation and `markTrustHeld` overwrites the journal, so boot reconcile can no longer recover it (sticky cruise until manual reset). Narrow trigger, pre-existing, and outside the enumerated acceptance list — but it's the one "leave scene" path that violates the P0-1 invariant. Recommend restoring the cookie + releasing the journal before delete.

2. **Stale config in switch-away blocked check** — for a non-trust B after a trust A, `computeApplyBlocked` (1285) uses `config` captured at line 1194, i.e., *before* the switch-away restore at 1210-1216. A module A enabled via Trust can let B pass its module gate right before it's restored to disabled → B applies but the module is off (fail-closed at call time). `config = getConfig()` after the restore fixes it.

3. **Failure-path tests missing** — the blocked/assets-fail/patch-fail rollback branches (1288-1292, 1340-1343, 1407-1410) have no direct test (only the `applying`-journal boot case). Add one that applies Trust then forces a failure and asserts flags restored + journal cleared.

4. Cosmetic: `rollbackTrust`'s `reason.includes("rollback")` clause is dead code — all callers already gate on `trustJustWritten`.

VERDICT: APPROVE_WITH_NITS

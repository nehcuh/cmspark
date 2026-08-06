## Review summary — S46 Trust B restore lifecycle

I inspected the live working tree (not just the patch file — git status confirms it matches), read every changed file end-to-end, ran `npx tsx --test tests/packs-engine.test.ts tests/skill-install.test.ts` (**32/32 pass**), and cross-checked `thread-manager.ts:494-499` to confirm `mission_pack_trust_snapshot` is a first-class `applyPackPatch` field.

### P0 verification (all confirmed in code, not just diff)

1. **Restore on leave** — `unapplyPack` (pack-engine.ts:1434-1458), `uninstallPack` (1483-1506), `deleteUserPack` (delegates to uninstall), switch A→B (1210-1216) all restore. Cookie is captured **before** `restoreSnapshot` nulls it (1486) — order is correct.
2. **Post-trust failure paths** — `applyUserPackTrust` fail (1265-1273), `computeApplyBlocked` (1296-1299), `installAssetsFromValidated` throw (1340-1344), `applyPackPatch` throw (1410-1415) all call `rollbackTrust`/restore + `clearTrustJournal`.
3. **Install strip** — `sanitizeManifestForInstall` (395-414) + `rewritePackYaml` (417-448); defense-in-depth re-validate after rename (1010-1026). Test `installPackFromDirectory strips origin=user + trust` confirms a spoofed `origin:user`+`trust.skip_l2` pack.yaml cannot survive install.
4. **spawn `allowTrust:false`** — `server.ts:3214` explicit; `applyPack` default-deny (1203); UI paths (`pack.apply`, save+apply) pass `allowTrust:true` (message-router.ts:1962, 2070). All four entry points grep-verified.

### Residuals

5. **Single holder** — `findOtherTrustHolders` (1226-1238) returns `trust_holder_conflict`. Test confirms second-thread apply is blocked, then succeeds after first unapplies.
6. **Crash journal** — `markTrustApplying`→`markTrustHeld` lifecycle; `reconcilePackTrustOnBoot` (319-357) wired at `server.ts:563`. Both "applying" and orphan "held" branches tested.
7. **skill_install Downloads** — bare path-segment heuristic removed; only `~/Downloads`·`~/下载` (realpath under home) + tmp + data dir qualify (skill-install.ts:103-137). Evil `/usr/local/Downloads/...` test confirms denied.
8. **UI honesty** — `has_trust`/`trust_skip_l2` on `PackListItem`; `⚠️ Trust` marker + modal warning in PacksPanel.tsx.
9. **Docs** — ADR-020 exception added, architecture §7.5 lifecycle paragraph, mission-pack-usage §2c/§10, design SoT D4 revision.

### ADR-020 checklist

- Surface/Compose/Autonomy/Trust/Channel declaration provided and consistent (`pack` · `single` · user_gesture+allowTrust+restore+journal).
- No new "中层 Agent" runtime; pack-first honored.
- Trust monotonicity preserved: Trust B is opt-in via UI gesture only, with full restore on leave/fail; spawn path can't elevate.
- No new `securityConfirmations.request` calls → originWs check n/a.

### Nits (non-blocking)

- `releaseTrustJournalIfMatch` (pack-engine.ts:380-388): the `if (packId != null && j.pack_id !== packId && j.phase === "held")` block has an empty body and `clearTrustJournal()` runs unconditionally — `packId` is effectively unused. Confusing but functionally correct.
- `rollbackTrust` (pack-engine.ts:1288-1293): the `reason.includes("rollback")` fallback is unreachable given every call site already gates on `trustJustWritten`. Defensive but dead.
- `sanitizeManifestForInstall` does not recompute `min_capability` after stripping a trust block (a trust-derived L1 label persists). Cosmetic only; doesn't affect gating since `requires_modules` is preserved.
- `unapplyPack` (pack-engine.ts:1453) casts `trustSnap as PackTrustSnapshot` without `isPackTrustSnapshot` guard; safe in practice because stored cookies always come from `captureTrustSnapshot()` deep-clone, but a guard would be more defensive.

VERDICT: APPROVE_WITH_NITS

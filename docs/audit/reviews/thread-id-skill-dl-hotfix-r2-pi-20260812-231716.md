All verification complete. Final review summary:

## Review summary

**Patch freshness**: `git diff` of working tree vs the R2 patch file — byte-identical (0 diff lines). Not stale.

**B1 — L2 preview picker = install picker**: FIXED. `SkillEngine.pickSkillMdEntryResult` (`skill-engine.ts:880`) shared by both `skillInstallOverwritePreview` (`skill-install.ts:241`) and install via `pickSkillMdEntry` (`skill-engine.ts:914`). Multiple `skills/*/SKILL.md` → fail-closed with candidate list (`skill-engine.ts:899-910`), test added and passing.

**B2 — DOWNLOAD_TIMEOUT recovery**: FIXED. Gated on `!forceRedownload && !!(filenameHint || urlContains)` (`browser-download-handler.ts:306`); `minCompletedAfterMs` floor on `endTime||startTime`, missing timestamps fail-closed (`downloads-find.ts:113-129`). Not exposed via public tool schema. Both new tests pass: force_redownload does NOT cache-recover; stale shelf does not beat fresh post-op complete.

**B3 — atomic extract**: FIXED. Extract to `.{safeName}.extract-tmp-{pid}-{ts}` then `renameSync` into dest (`skill-engine.ts:1030-1075`); failure removes only tmp, pre-existing skill preserved (test passes).

**B4 — FromPath**: FIXED. `importSkillFolderFromPath` (`skill-engine.ts:932`), `skillInstall` prefers it (`skill-install.ts:406`), real-engine + on-disk monorepo zip integration test passes.

**Tests**: companion 101/101 pass; extension full suite 649/649 pass; both `tsc` typechecks clean.

**ADR-020**: No new tools/gates/primary UI; `SKILL_INSTALL_CAPABILITY` declaration intact; no new confirmation family, no autonomy change, no originWs regression (no new `request`), trust monotonicity preserved (recovery returns the user's own already-downloaded file, same trust as pre-existing `prefer_existing`).

## Nits (non-blocking)

1. `browser-download-handler.ts:133` — the 2s recovery floor (`nowFn() - 2_000`) is looser than the waiter's 50ms identity guard in `download-waiter.ts`. A complete matching download that finished <2s *before* registration could theoretically be latched. Deliberate + documented skew, but the inconsistency with BD-WAITER's own discipline is worth noting.
2. `skill-engine.ts:1070-1071` — `rmSync(destDir)` then `renameSync` leaves a non-atomic window (rename failure after rm ⇒ skill lost). Same-fs rename makes this unlikely; a rename-to-backup pattern would be stricter.
3. R1-M5 residual, unaddressed: zip entries with lying header `size=0` still call `getData()` before the post-budget check (`skill-engine.ts:1058`); bounded by the 100MiB compressed cap but still a memory spike risk for adversarial archives.
4. `skill-install.ts:243-247` — multi-SKILL.md zip yields an empty L2 preview (`name: null`) rather than surfacing the candidate error; install then fails with the explicit message. Fail-closed, slightly awkward UX.
5. R2 prompt declares ADR-020 axes only in prose, not the formal declaration block — acceptable here (no tools/gates/primary UI added), just noting.

No blocking issues; all four R1 HIGH blockers verified fixed with passing tests.

VERDICT: APPROVE_WITH_NITS

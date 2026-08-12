I've completed my independent review. Here is my assessment.

## Verification performed

- Patch file vs live working tree: **hunks identical** (only the stat-block header differs) — not stale.
- Ran test suites: companion `skills.test.ts` + `skill-install.test.ts` **108/108 pass**; chrome-extension **648/648 pass**. The 15 companion failures in the full suite are all in `computer-executor.test.ts` / `computer-uia-watch.test.ts` — unrelated to this diff (pre-existing).
- Re-checked all four adversarial claims against the actual code, plus the ADR-020 checklist.

## Blocking issues (REJECT)

**B1 — L2 preview picker diverges from install picker (introduced by this diff).**
- Install now uses `pickSkillMdEntry` (prefers `skills/` subtree + deepest path): `companion/src/skills/skill-engine.ts:878-897`.
- Preview still uses first-in-zip-order `entries.find(…endsWith("SKILL.md"))`: `companion/src/skills/skill-install.ts:240-241`.
- Pre-diff, the install picker was *identical* to the preview picker (`entries.find(endsWith("SKILL.md"))`); this diff changed only the install side, creating the divergence exactly when monorepo zips (the headline feature) are used.
- Consumer: `companion/src/tool/l2-admission.ts:242` binds `name=${prev.name}` + `overwrite=` into the L2 confirm token; `companion/src/security-policy.ts:118-121` uses preview for overwrite disclosure. A monorepo zip can show the wrong skill name in the dialog and a wrong overwrite flag — the user may confirm an install that silently overwrites an existing skill the dialog said was fresh (or vice versa). Trust-gate disclosure integrity is broken.

**B2 — DOWNLOAD_TIMEOUT recovery re-latches stale completes, ignores `force_redownload` (introduced by this diff).**
- `chrome-extension/src/background/browser-download-handler.ts:300-331`: on any `DOWNLOAD_TIMEOUT` the code runs `findPreferredExistingDownload` with no time floor (search is `state:"complete"` ordered by `-startTime`, most-recent-wins — `downloads-find.ts:158-166`) and no `forceRedownload` gate. A click that produced no download returns a days-old matching file as tool success (`source: "cache_after_timeout"`).
- This bypasses the exact guard the waiter implements (`download-waiter.ts` `registeredAtMs` rejects pre-registration items).
- The unit test locks the bad semantics in: `chrome-extension/tests/browser-download-handler.test.ts:281` passes `force_redownload: true` and asserts success with `cache_after_timeout` at line 294 — contradicting the documented `force_redownload` contract ("click again, don't reuse cache", handler line 66-67).

**B3 — Overwrite install destroys the old skill before extraction completes.**
- `companion/src/skills/skill-engine.ts:978` `fs.rmSync(destDir, {recursive:true})` precedes extraction; any mid-extract failure (disk full, truncated 46MB zip, IO) triggers the catch cleanup at line 1046 → old skill lost, install failed.
- Pre-existing pattern, but this diff raises budgets 5× (`MAX_ZIP_EXTRACT_BYTES` 25MB→120MB, files 500→2000, lines 867-868) and targets exactly the large-pack flow where mid-extract failure becomes materially more likely — amplified blast radius on a touched path. Needs atomic tmp-dir + rename.

**B4 — Production `importSkillFolderFromPath` path is untested.**
- `companion/tests/skill-install.test.ts:14-60` `makeEngine` stub has no `importSkillFolderFromPath`, so `skill-install.ts:408-411` always takes the base64 fallback in tests; the new stat/realpath/AdmZip(path) branch is never exercised.
- The zip_path test (skill-install.test.ts:88-104) writes a plain-text fake "zip" — only the stub makes it pass; real AdmZip validation is uncovered at the skillInstall layer.
- The engine-level monorepo test (`skills.test.ts`) does cover `pickSkillMdEntry` + subtree scoping via the shared `importSkillFolderFromZip`, so the core logic is tested — this is a coverage gap at the orchestration/entry layer rather than a logic bug.

## Nits (non-blocking)

- M2: recovery is a silent no-op for the most common flow — `text="Download ZIP"` strips to empty `recoverHint` (`browser-download-handler.ts:302-310`), and `runDownloadsFind` requires a hint, so recovery only works when the agent supplied `filenameHint`/`urlContains`.
- M1: multiple `skills/*/SKILL.md` in one zip → silent deepest/zip-order pick (`skill-engine.ts:886-897`); should fail closed or enumerate (exacerbates B1).
- M6: new hint suggests `path=` for oversized zips (`skill-install.ts:416-420`), but `importSkillFromPath`→`readDirectoryFiles` reads all files as UTF-8 (`skill-engine.ts:1102`) — binary font/theme assets (the exact packs this diff targets) get mangled.
- M3: history **day** groups stay collapsed during search (`ThreadList.tsx:961-964` uses `expandedDays.has(...)` with no `searchActive` force-open, while month/pinned groups force-open) — the copy-#id-and-paste-to-search workflow may not reveal the matched row.
- M4: clipboard failure is silent — `execCommand("copy")` return ignored, "已复制" shown even on failure (`StatusRail.tsx` copyActiveThreadId, `ThreadList.tsx:484-513`).
- M5: header `size=0` zip entries skip the pre-check and materialize via `getData()` before the post-check (`skill-engine.ts:1009-1023`) — pre-existing.
- ADR-020: implementer prompt lacks the Surface/Compose/Autonomy/Trust/Channel declaration block (diff adds primary UI chrome + modifies download tooling). No new tools/gates/confirms; `SKILL_INSTALL_CAPABILITY` already declared at `skill-install.ts:586`; skill_install remains L2-default with the three-flag cruise waive; no `securityConfirmations.request` changes (originWs N/A). Treat as nit, not blocker.

VERDICT: REJECT

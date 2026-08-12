I have completed independent verification of all four claimed blockers. Here is my review.

---

## Independent Review — thread-id-skill-dl-hotfix

I read the actual diff and re-traced each claimed blocker against the real code paths (not the adversarial summary). All four are confirmed; one is pre-existing-not-regression but in-scope as an incomplete fix.

### Blocking issues (HIGH / P1)

**B1. L2 preview SKILL.md picker ≠ install picker (token-binding integrity break)**

- **Preview picker** — `companion/src/skills/skill-install.ts:240-242`:
  ```
  const skillMd = entries.find(
    (e) => e.entryName.endsWith("SKILL.md") || e.entryName.endsWith("SKILL.md/"),
  )
  ```
  First match in central-directory order. Case-sensitive.
- **Install picker** — `companion/src/skills/skill-engine.ts:878-898` (`pickSkillMdEntry`): filters with case-insensitive `/(^|\/)SKILL\.md$/i`, prefers entries under `skills/`, then sorts by deepest path descending.
- **Token binding** — `companion/src/tool/l2-admission.ts:242,257` burns `name=${prev.name}` and `overwrite=${prev.overwrite}` from the preview into the L2 admission string. The user confirms that string; the executor then writes whatever `pickSkillMdEntry` chose.
- **Manifestation**: a monorepo zip with e.g. `repo-main/SKILL.md` (depth 2) and `repo-main/skills/foo/SKILL.md` (depth 3) → preview may pick the root one while install prefers `skills/foo`. Confirm dialog says name=root overwrite=false; install writes name=foo. Token-bound authorization no longer matches the durable write. Trust-system integrity violation, exactly the kind ADR-020's "trust monotonicity" forbids.
- **Fix**: extract `pickSkillMdEntry` to non-private and call it from both sites; or fail-closed when >1 candidate.

**B2. `DOWNLOAD_TIMEOUT` recovery ignores `force_redownload` and has no time floor**

- `chrome-extension/src/background/browser-download-handler.ts:301-338`: on timeout, calls `findPreferredExistingDownload({ filenameHint, urlContains, limit: 1, ... })` and returns `source: "cache_after_timeout"` if hit. No `force_redownload` check; no `endTime >= registeredAt` floor.
- `findPreferredExistingDownload` → `filterCompletedDownloads` in `chrome-extension/src/background/downloads-find.ts:82-126` filters by state/path/filename/url only — no timestamp gate.
- Net effect: a click path that was invoked *because* `force_redownload=true` (line 67-72: `forceRedownload=true` ⇒ `preferExisting=false`) can silently return a stale shelf item the user explicitly asked to bypass. This is a trust-monotonicity violation (deeper Surface / explicit user flag must not be silently defeated) and an ADR-020 P1.
- The unit test **locks the wrong semantics in**: `chrome-extension/tests/browser-download-handler.test.ts:275-296` passes `force_redownload: true` *and* `prefer_existing: false`, then asserts `r.success === true` with `source === "cache_after_timeout"`. The implementer has encoded "force_redownload is overridable by cache recovery" as the contract.
- **Fix**: (a) skip recovery when `forceRedownload`; (b) only accept items whose `endTime/startTime ≥ waiter.registeredAt`; (c) rewrite the test to assert `success === false` for the `force_redownload=true` case and a separate test for the legit shelf-recovery case (no `force_redownload`, fresh endTime).

**B3. Overwrite install wipes destDir before extract (in-scope incomplete fix)**

- `companion/src/skills/skill-engine.ts:977-980`:
  ```
  if (fs.existsSync(destDir)) { fs.rmSync(destDir, { recursive: true }) }
  fs.mkdirSync(destDir, { recursive: true })
  ```
  Then the extract loop runs. On any mid-extract throw (budget exceeded, path traversal, disk write error) the `catch` at 1044-1050 does another `rmSync(destDir, recursive, force)`. The pre-existing skill is gone; the new skill is also gone — silent data loss.
- This pattern is **pre-existing** (not introduced by this PR), so technically a non-regression. **However**, this PR's whole purpose is to *raise* the extract budgets from 25MiB/500 → 120MiB/2000 (skill-engine.ts:872-873) precisely so that large packs (dashiai-ppt ~81MiB / ~365 files) install. That materially widens the failure window. Shipping the budget bump without the atomic-extract fix makes the existing latent bug substantially more reachable on the exact use-case the PR targets.
- **Fix**: extract to `destDir + ".tmp.<pid>"`, then `fs.renameSync` after success; on failure leave the old skill intact. Cleanup any stale `.tmp` dir on next start.

**B4. Production `importSkillFolderFromPath` path is untested**

- `companion/src/skills/skill-install.ts:407-415` prefers `eng.importSkillFolderFromPath(resolved)` when present (production), falling back to base64. The new method is at `companion/src/skills/skill-engine.ts:909-915`.
- `companion/tests/skills.test.ts:947` (the new monorepo test) and the existing zip-budget test both call `engine.importSkillFolder(zip.toBuffer().toString("base64"))` directly — never FromPath, never the install wrapper's branch.
- The four lines unique to FromPath (`path.resolve`, `fs.existsSync`, `fs.statSync(...).isFile()`, `new AdmZip(resolved)`) are simple but untested. If AdmZip's path-mode differs from buffer-mode for any input (e.g., non-UTF8 path on Windows, large file streaming behavior), the production path is the one that regresses.
- **Fix**: add a test that writes the zip to a real tmp file and calls `skillInstall(engine, { zip_path: tmp })` through the wrapper, asserting both `imported.destPath` and that the engine stub *didn't* get a base64 string.

### Additional notes (non-blocking)

- **N1 (capability declaration)**: per ADR-020 checklist, the implementer prompt is missing the Surface/Compose/Autonomy/Trust/Channel block. Since this PR adds only a minor Surface chip (thread-id badge + search-field expansion) and bug-fixes existing tools — no new tool, no new gate, no new autonomy axis — this is a NIT, not blocking. The skill_install axis already has an in-code declaration (`SKILL_INSTALL_CAPABILITY`, skill-install.ts:586-594).
- **N2**: `chrome-extension/src/background/browser-download-handler.ts:303-310` — the `recoverHint` derived from `text` strips `"download zip"` / `"下载"` but a bare hint like `"zip"` or `"下载 zip"` would still over-broad-match. Non-blocking but worth tightening.
- **N3**: `chrome-extension/src/sidepanel/components/StatusRail.tsx:166-180` and `ThreadList.tsx:275-290` — clipboard failure is swallowed silently and the UI still shows "已复制". Cosmetic; non-blocking.
- **N4**: `skill-engine.ts:892-896` deepest-wins sort for multi-`skills/*/SKILL.md` zips is silent (no diagnostic). With B1 fixed (single source of truth), this is benign.

### Verification performed

- `git diff --stat` matches the patch file exactly (518/71 across 9 files). Patch is not stale.
- `node --test .test-dist/tests/skills.test.js` → 98 pass / 0 fail.
- `npm test` (chrome-extension) → 648 pass / 0 fail.
- `npm test` (companion) → 2743 pass / 15 fail; all 15 failures are pre-existing in `computer-uia-watch.test.js` / `executor` computer-use tests / `resolveAllowDirToOffer` — none in files touched by this PR.

### Verdict rationale

B1 and B2 each independently break the project's stated trust model (L2 token binding; `force_redownload` user directive). B2 is the more serious because the unit test explicitly asserts the broken semantics, so the contract is being cemented, not just momentarily violated. B3 is an incomplete fix on the exact use-case the PR ships. B4 is a real coverage gap on the production-only code branch.

Fix B1 (unify picker), B2 (gate recovery on `!forceRedownload && endTime ≥ registeredAt`, rewrite the test), B3 (extract-then-rename), B4 (one integration test through `skillInstall({zip_path})`) before merge.

VERDICT: REJECT

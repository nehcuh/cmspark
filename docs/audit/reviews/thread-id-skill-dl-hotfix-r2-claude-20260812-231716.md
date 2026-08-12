All four R1 blockers verified fixed in code and tests. Let me finalize.

## Independent Review — `thread-id-skill-dl-hotfix-r2`

### Patch freshness
`git diff HEAD --stat` matches the R2 patch file exactly (10 files, +739/−96). Not stale.

### B1 — Unified SKILL.md picker ✓
- `SkillEngine.pickSkillMdEntryResult` is now **public static** at `companion/src/skills/skill-engine.ts:880-912` (case-insensitive `/^|\/)SKILL\.md$/i`, prefers `skills/`).
- `skillInstallOverwritePreview` calls it at `companion/src/skills/skill-install.ts:241-248` — lock-step with install.
- Multi `skills/*/SKILL.md` → **fail-closed** with candidate list (skill-engine.ts:900-909), no silent deepest-wins. Test `multiple skills/*/SKILL.md fail-closed (no silent pick)` passes.

### B2 — `DOWNLOAD_TIMEOUT` recovery ✓
- `!forceRedownload && !!(filenameHint || urlContains)` gate at `browser-download-handler.ts:306-307`.
- `operationStartMs = nowFn() - 2_000` (line 131-132) → passed as `minCompletedAfterMs` (line 314).
- `filterCompletedDownloads` enforces the floor at `downloads-find.ts:123-129`, fail-closed on missing timestamps.
- Two new tests pass: `force_redownload + TIMEOUT must NOT recover` asserts `r.success === false`; `TIMEOUT recovers only post-op complete (not stale shelf)` asserts `download_id === 58`. The previous test that *cemented* the broken semantics is gone.

### B3 — Atomic extract ✓
- `tmpDir = .${safeName}.extract-tmp-${pid}-${Date.now()}` under skills root (skill-engine.ts:969-972).
- Extract writes into tmp; on full success `rmSync(destDir) + renameSync(tmpDir, destDir)` (lines 1077-1080).
- On failure only `tmpDir` is removed (line 1083); pre-existing skill preserved. Test `failed extract preserves pre-existing skill (atomic tmp)` passes.

### B4 — FromPath integration ✓
- `skillInstall zip_path: real engine FromPath monorepo (B4 production path)` (skills.test.ts:941-968) writes a real zip to disk, calls `skillInstall(engine, { zip_path })` with a real `SkillEngine`, asserts `importSkillFolderFromPath` exists, the skill tree installs, and monorepo noise (`README.md`) is excluded.

### Test execution (fresh)
- `node --test companion/.test-dist/tests/skills.test.js` → 101 pass / 0 fail.
- `node --test chrome-extension/.test-dist/tests/{browser-download-handler,thread-timeline,downloads-find}.test.js` → 51 pass / 0 fail.
- `npx tsc --noEmit` clean for both packages.

### ADR-020 checklist
- Surface: L0/L1 UI chip (thread-id badge + copy) + search-field expansion; **no new tool, no new gate, no new primary UI entry**. `skill_install` changes are hardening of an existing L2 tool.
- Composition: existing skill axis; budgets raised with subtree billing + atomic commit.
- Autonomy: n/a (no new agent runtime, no new gate).
- Trust monotonicity: **improved** — L2 token binding now uses the same picker as install (B1); `force_redownload` user directive is now respected (B2). No regressions.
- originWs: no new `securityConfirmations.request` calls; n/a.
- The implementer prompt lacks the explicit Surface/Compose/Autonomy/Trust/Channel block, but the change is bug-fix + UI affordance, not a new tool/gate — nit only.

### Residual nits (non-blocking)
- **N1** (M5 from adversarial): zip entries with header `size=0` still pre-pass the central-directory budget check; only the post-`getData()` byte counter catches them. Between `getData()` invocation and the post-check, transient memory can balloon for a single entry. The post-extract `extractBytes` guard still aborts before commit, so this is a transient-memory concern not a durable-write concern. Pre-existing; the budget bump (25→120 MiB) widens the window slightly but atomic-commit keeps failure reversible.
- **N2**: The 2s skew in `operationStartMs = nowFn() - 2_000` could let a shelf item that completed in the 2s before the click be latched. Mitigation: explicit `filenameHint`/`urlContains` required, and Chrome typically returns newest-first. Acceptable.
- **N3** (M6 from adversarial — `path` import reading binary as utf-8): the `path` branch in `skillInstallOverwritePreview`/install still uses `fs.readFileSync(skillMd, "utf-8")` for the SKILL.md frontmatter only; binary assets are not read there. The actual extract path uses AdmZip (binary-safe). Not in scope here, but worth tracking.
- **N4**: Missing explicit ADR-020 capability declaration block in the implementer prompt — nit per checklist.

All four R1 blockers (B1–B4) are genuinely resolved at the claimed file:line with passing tests, no security regression introduced, and trust-monotonicity is improved rather than weakened. Residual concerns are non-blocking.

VERDICT: APPROVE_WITH_NITS

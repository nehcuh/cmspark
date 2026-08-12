# Dual-review R2: thread-id + skill zip + download recovery (post-blocker fix)

## Round-1 verdict
Claude + Pi both **REJECT** (20260812-225323). Internal four-lane also REJECT.

## What changed since R1 (must re-verify)

### B2 fixed — DOWNLOAD_TIMEOUT recovery
- Skip recovery when `force_redownload`
- Require explicit `filenameHint` / `urlContains` (no weak text-derived hints)
- `minCompletedAfterMs` floor on completes (`endTime`/`startTime` ≥ op start − 2s skew)
- Tests: force_redownload must **not** cache-recover; stale shelf must not win over fresh post-op complete

### B1 fixed — L2 preview picker = install picker
- `SkillEngine.pickSkillMdEntryResult` exported; used by `skillInstallOverwritePreview` and install
- Multi `skills/*/SKILL.md` → **fail-closed** with candidate list (no silent deepest-wins)

### B3 fixed — atomic extract
- Extract to `.${safeName}.extract-tmp-*` under skills root, then `rename` into dest
- On failure only tmp is removed; pre-existing skill preserved (test added)

### B4 fixed — FromPath integration
- Real `SkillEngine` + on-disk monorepo zip through `skillInstall({ zip_path })`

### Nits
- History **day** groups force-open when search has matches
- Clipboard: only show「已复制」when copy succeeds (`execCommand` return checked)

## Scope files
Same as R1 plus `downloads-find.ts` (minCompletedAfterMs).

## Prior review artifacts
- `docs/audit/reviews/thread-id-skill-dl-hotfix-adversarial-20260812.md`
- `docs/audit/reviews/thread-id-skill-dl-hotfix-claude-20260812-225323.md`
- `docs/audit/reviews/thread-id-skill-dl-hotfix-pi-20260812-225323.md`

## Instructions
1. Diff working tree vs HEAD; confirm B1–B4 fixes are real (file:line).
2. Refute residual HIGH issues if any; list nits only if non-blocking.
3. ADR-020: Surface UI chips + existing L2 skill_install; no new autonomy gate expected.
4. End with exactly one line:
   `VERDICT: APPROVE` | `VERDICT: APPROVE_WITH_NITS` | `VERDICT: REJECT`

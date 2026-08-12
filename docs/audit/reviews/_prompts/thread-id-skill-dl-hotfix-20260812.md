# Dual-review task: thread-id UI + large skill zip + download timeout recovery

## Product intent

1. **Thread ID UX**: Always show short `#id` on thread list rows and StatusRail; click copies bare id; local search covers alias/id/preview/tags/tldr/bullets.
2. **Large skill install**: Raise skill zip budgets so packs like dashiai-ppt (~46MB zip / ~81MB extract / ~365 files) can install; monorepo zips extract only the chosen `SKILL.md` subtree; prefer `importSkillFolderFromPath` (no base64 blow-up).
3. **Download recovery**: On `browser_download` `DOWNLOAD_TIMEOUT`, scan `chrome.downloads` for a complete match so the agent does not ignore the browser download shelf (thread `x9xinc` gap).

## Files in scope (uncommitted vs HEAD)

- `chrome-extension/src/sidepanel/utils/thread-timeline.ts`
- `chrome-extension/src/sidepanel/components/ThreadList.tsx`
- `chrome-extension/src/sidepanel/components/StatusRail.tsx`
- `chrome-extension/tests/thread-timeline.test.ts`
- `chrome-extension/src/background/browser-download-handler.ts`
- `chrome-extension/tests/browser-download-handler.test.ts`
- `companion/src/skills/skill-engine.ts`
- `companion/src/skills/skill-install.ts`
- `companion/tests/skills.test.ts`

## Internal four-lane adversarial summary (already run)

Full write-up: `docs/audit/reviews/thread-id-skill-dl-hotfix-adversarial-20260812.md`

**Internal synthesis: REQUEST CHANGES / REJECT**

Confirmed HIGH / P1 blockers claimed by adversaries (verify or refute with file:line):

1. **L2 preview SKILL.md picker ≠ install `pickSkillMdEntry`** — wrong name/overwrite in confirm dialog vs actual install.
2. **DOWNLOAD_TIMEOUT recovery** re-latches pre-existing completes (no time floor); ignores `force_redownload`; unit test locks this in.
3. **Overwrite install** deletes dest before extract completes → data loss on mid-extract failure.
4. **Production FromPath path** not covered by skill_install unit tests (stub only base64).

UI lane was CONDITIONAL PASS (day groups stay collapsed during search; silent clipboard failures).

## What you must do

1. Read the real diff (`git diff` / the dual-review diff patch path given by the harness).
2. Independently re-check the four blockers — do **not** rubber-stamp the internal report; refute with evidence if wrong.
3. Note any additional CRITICAL/HIGH issues.
4. Capability (ADR-020): this is primarily Surface (UI) + local install tools (skill_install already L2) + download tooling — flag if trust/autonomy gates regressed.
5. End with exactly one of:
   - `VERDICT: APPROVE`
   - `VERDICT: APPROVE_WITH_NITS`
   - `VERDICT: REJECT`

If REJECT or APPROVE_WITH_NITS, list concrete file:line items before the VERDICT line.

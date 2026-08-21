# Independent adversarial review — HEAD `be52585` post-#207 unreviewed delta

**Date**: 2026-08-21
**Base**: `e8900bc` (merge of PR #207 Mode C opencode/kimi task delivery)
**Head**: `be52585` (merge of PR #209)
**Frozen patch**: `docs/audit/reviews/head-be52585-post207-diff-20260821-090024.patch`
**SHA256**: `e6e3b78abe388fef11012a096324b544194f2d439055f4dbbfa81103303c3929`

## Why this range

`2b97cfa..2576b53` (PR #206) already has a 3-lane independent adversary synthesis (`head-2576b53-acp-discover-independent-adversary-synthesis-20260820.md`, REQUEST_CHANGES).
`2576b53` working-tree Mode C fix shipped as PR #207 and has a 2-lane synthesis (`head-2576b53-acp-modec-fix-independent-adversary-synthesis-20260820.md`, APPROVE_WITH_NITS).

This review covers **unreviewed production commits after #207**:

| PR | Commit | Claim |
|----|--------|--------|
| #208 | `f244422` + `90613c0` | Local Windows packaging: NSIS `Bin/` search, ASCII-only `installer.nsi` (GBK/makensis), 7-Zip install-dir probe when zip/7z not on PATH, Git Bash `require()` cwd-relative |
| #209 | `511bc87` | `companion/scripts/run-tests.mjs`: run `settings-web.test.js` with `--experimental-test-isolation=none` to dodge Node 22 IPC V8 deserialize flake |

Plus **lane D only**: residual re-check that #207 Mode C P1s still hold at HEAD (do not re-litigate already-closed P1s unless HEAD regressed).

## Capability declaration (implementer claim — challenge it)

```text
Surface:      n/a (packaging + test runner; no Side Panel Surface)
L2-classes:   none
Compose:      none
Autonomy:     n/a
Trust:        packaging path probes must not introduce new exec of untrusted bins; test isolation change must not leak state into CI green
Channel:      community
```

Blast: T1/T2 (test runner + local packaging). Not T3 unless you find a new execution surface (unsigned 7z path, installer script injection, CI skip).

## Rules (mandatory)

1. You are an **independent adversary**, not the implementer. Do not rubber-stamp PR bodies.
2. Read the **frozen patch** and **live files at HEAD**. `[executed]` for claims that can be run; `[inspected]` for static. Never invent file:line.
3. Score **outcome / trajectory / component**. Machine-checkable > prose.
4. Do not reward length. Do not treat "tests exist" as "tests pin the bug".
5. Final line of your report MUST be exactly one of:
   `VERDICT: APPROVE`
   `VERDICT: APPROVE_WITH_NITS`
   `VERDICT: REJECT`
6. REJECT = blocking issues with file:line before the verdict.
7. APPROVE_WITH_NITS = non-blocking nits only.
8. Tag every claim `[executed]` / `[inspected]` / `[assumed]`.
9. You may mutate a **private copy** of tests (e.g. `.test-dist-mut`) to mutation-kill; restore/delete before finishing. Do not dirty the git worktree you were given except writing your report if asked.

## ADR-020 checks

Read `docs/audit/reviews/_templates/dual-review-capability-checklist.md`. Challenge missing declaration if tools/gates/primary UI were added (they should not have been).
